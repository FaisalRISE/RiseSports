import "server-only";

/* Whole-tournament derived state, computed on the server.
 *
 * This is where the group tables, the resolved knockout slots and the final
 * placings come from. Like the scoring engine, none of it reaches the browser —
 * pages receive finished rows and names. */

import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, matches, teams, tournaments, type Group, type Match, type Team, type Tournament } from "@/lib/db/schema";
import { viewMatch, tieBreakFor, allowsDraws } from "@/lib/matchState";
import { standings, type Row, type StandingsMatch } from "@/lib/standings";
import { resolveRef, refLabel, rowsByLabel, type RefResolver } from "@/lib/brackets";
import { matchResult } from "@/lib/results";

export type LoadedTournament = {
  tournament: Tournament;
  groups: Group[];
  teams: Team[];
  matches: Match[];
};

export async function loadTournament(slug: string): Promise<LoadedTournament | null> {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  if (!t) return null;
  const [g, tm, ms] = await Promise.all([
    db.select().from(groups).where(eq(groups.tournamentId, t.id)),
    db.select().from(teams).where(eq(teams.tournamentId, t.id)),
    db.select().from(matches).where(eq(matches.tournamentId, t.id)),
  ]);
  return {
    tournament: t,
    groups: [...g].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key)),
    teams: tm,
    matches: ms,
  };
}

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/**
 * The same load, inside a caller's transaction and after its locks — one
 * statement at a time, because a transaction holds one connection and
 * `Promise.all` on it pipelines (lib/db/index.ts). "Fill resolved slots" reads
 * this way under the event lock, so it cannot fill a slot from a table read
 * before a pair was removed.
 */
export async function loadTournamentIn(tx: Tx, t: Tournament): Promise<LoadedTournament> {
  const g = await tx.select().from(groups).where(eq(groups.tournamentId, t.id));
  const tm = await tx.select().from(teams).where(eq(teams.tournamentId, t.id));
  const ms = await tx.select().from(matches).where(eq(matches.tournamentId, t.id));
  return {
    tournament: t,
    groups: [...g].sort((a, b) => a.position - b.position || a.key.localeCompare(b.key)),
    teams: tm,
    matches: ms,
  };
}

/** A match reduced to what the standings engine needs: a settled score or nothing. */
function toStandingsMatch(t: Tournament, m: Match): StandingsMatch {
  const v = viewMatch(t, m);
  /* Only a FINISHED match counts. A match in progress must not move the table,
     or the standings would swing on every rally. */
  const r = matchResult(t, m, v);
  return { teamAId: m.teamAId, teamBId: m.teamBId, scoreA: r ? r.a : v.a, scoreB: r ? r.b : v.b, played: r !== null };
}

/* ── Who is in a group (step 8b) ───────────────────────────────────────────
 * A group's table is its MEMBERS, not whoever appears in its fixtures: a pair
 * left alone in a group of two after the other pair was removed has no fixture
 * left, and still wins the group (Faisal, 2026-10-11). These few pure rules are
 * the ONE definition — the tables, the print pack, the manage page and the
 * server's refusals all read them. */

type MemberTeam = Pick<Team, "id" | "groupId" | "withdrawnAt" | "seed" | "createdAt">;
type Fixture = { id?: string; teamAId: string | null; teamBId: string | null };

/**
 * A group's ACTIVE members: the teams drawn into it (`teams.group_id`), and
 * anyone in its fixtures who has no membership recorded at all — a group drawn
 * before the column existed and not backfilled — minus every withdrawn pair.
 * Sorted by seed, then when added, then id, because the standings' last
 * tie-break is the order they are given, and the teams load in no order.
 */
export function groupMembers<T extends MemberTeam>(allTeams: T[], fixtures: Fixture[], groupId: string): T[] {
  const inFixtures = new Set(fixtures.flatMap((f) => [f.teamAId, f.teamBId]).filter(Boolean));
  return allTeams
    .filter((x) => !x.withdrawnAt && (x.groupId === groupId || (x.groupId == null && inFixtures.has(x.id))))
    .sort((a, b) => a.seed - b.seed || +a.createdAt - +b.createdAt || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/**
 * Is the group decided? Exactly one active member: yes — the pair left wins it,
 * with nothing to play. Otherwise every fixture played, there is at least one,
 * and every member is in one of them: a member left with no match at all would
 * otherwise sit at nought played above pairs who played and lost.
 */
export function groupDecided(memberIds: string[], fixtures: (Fixture & { played: boolean })[]): boolean {
  if (memberIds.length === 0) return false;
  if (!fixtures.every((f) => f.played)) return false;
  if (memberIds.length === 1) return true;
  if (fixtures.length === 0) return false;
  const inFixtures = new Set(fixtures.flatMap((f) => [f.teamAId, f.teamBId]));
  return memberIds.every((id) => inFixtures.has(id));
}

/**
 * Why a group FIXTURE may not be deleted, or null. With two or more members
 * left the group needs a match between them ("group-short", the group's only
 * match), and every member needs one ("pair-stranded" — that pair's last match:
 * the way to drop a pair that pulled out is a walkover or "Remove the pair").
 */
export function fixtureDeletionProblem(
  memberIds: string[], fixtures: Fixture[], matchId: string,
): { code: "group-short" } | { code: "pair-stranded"; teamId: string } | null {
  const left = fixtures.filter((f) => f.id !== matchId);
  const target = fixtures.find((f) => f.id === matchId);
  if (memberIds.length < 2) return null;
  if (left.length === 0) return { code: "group-short" };
  const inLeft = new Set(left.flatMap((f) => [f.teamAId, f.teamBId]));
  const stranded = [target?.teamAId, target?.teamBId].find((id) => id && memberIds.includes(id) && !inLeft.has(id));
  return stranded ? { code: "pair-stranded", teamId: stranded } : null;
}

/**
 * Why a pair may not be REMOVED from its group, or null (step 8b). Faisal,
 * 2026-10-15: a group left with fewer pairs than the knockout takes from it is
 * refused — walkovers instead, so the pair keeps its place and its knockout
 * opponent is walked over too ("pair-group-short", with the rank asked). And a
 * group must still be able to finish: two or more pairs left need a match
 * between them, each of them ("pair-strands-group").
 */
export function pairRemovalProblem(
  memberIds: string[], fixtures: Fixture[], teamId: string, askedRank: number,
): { code: "pair-group-short"; asked: number; left: number } | { code: "pair-strands-group" } | null {
  const stay = memberIds.filter((id) => id !== teamId);
  if (askedRank > stay.length) return { code: "pair-group-short", asked: askedRank, left: stay.length };
  const left = fixtures.filter((f) => f.teamAId !== teamId && f.teamBId !== teamId);
  if (stay.length >= 2) {
    const inLeft = new Set(left.flatMap((f) => [f.teamAId, f.teamBId]));
    if (left.length === 0 || stay.some((id) => !inLeft.has(id))) return { code: "pair-strands-group" };
  }
  return null;
}

/** A group's table: its members ranked, whether it is decided, and the names
    of the pairs removed from it (for the words beside the table). */
export type GroupTable = { group: Group; rows: Row[]; complete: boolean; members: string[]; withdrawn: string[] };

/** What one entrant is called in sentences about this event: a player in
    singles, a team when a side is more than two (OSL's six), a pair otherwise.
    "Remove the pair…" on a singles event was the review's example. */
export type EntrantNoun = { one: string; many: string };
export const PAIR: EntrantNoun = { one: "pair", many: "pairs" };
export function entrantNoun(t: Pick<Tournament, "maxTeamSize" | "format">): EntrantNoun {
  if (t.maxTeamSize === 1) return { one: "player", many: "players" };
  if (t.format === "osl" || t.maxTeamSize > 2) return { one: "team", many: "teams" };
  return PAIR;
}

/**
 * The sentence beside a group that entrants were removed from, or null: the
 * screen's table and the printed sheet say the same thing. Past tense, and
 * "the pair left" as the subject, because a team's name does not say whether
 * it takes "is" or "are".
 */
export function groupNote(table: GroupTable, noun: EntrantNoun = PAIR): string | null {
  const { rows, withdrawn, complete, group } = table;
  if (withdrawn.length === 0) return null;
  if (rows.length === 0) return `Every ${noun.one} in this group withdrew.`;
  if (complete && rows.length === 1) {
    return `${joinNames(withdrawn)} withdrew, so the ${noun.one} left, ${rows[0].name}, wins ${group.name ?? `Group ${group.key}`}.`;
  }
  return null;
}

function joinNames(names: string[]): string {
  return names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

export function groupTables(loaded: LoadedTournament): GroupTable[] {
  const { tournament: t } = loaded;
  const tieBreak = tieBreakFor(t);
  const draws = allowsDraws(t.sport);

  return loaded.groups.map((g) => {
    const ms = loaded.matches.filter((m) => m.groupId === g.id);
    const members = groupMembers(loaded.teams, ms, g.id);
    const entrants = members.map((x) => ({ id: x.id, name: x.name, seed: x.seed }));
    const sm = ms.map((m) => toStandingsMatch(t, m));
    return {
      group: g,
      rows: standings(entrants, sm, { tieBreak, allowDraws: draws }),
      complete: groupDecided(members.map((x) => x.id), sm),
      members: members.map((x) => x.id),
      withdrawn: loaded.teams.filter((x) => x.groupId === g.id && x.withdrawnAt).map((x) => x.name),
    };
  });
}

/**
 * Resolver that fills knockout slots from group placings and earlier ties.
 *
 * **Scoped to one division, and that is not optional.** Both lookups below are
 * keyed on strings that are unique in a single-category event and stop being
 * unique the moment there is a second: every category has a Group A, and every
 * category has a Semi-Final 1. Unscoped, the later row silently wins the Map
 * and `A1` in Men's Doubles resolves to the *Mixed* group winner — no error, no
 * warning, just the wrong pair walking onto court for a final.
 *
 * `divisionId` is a required argument for exactly that reason: there is no
 * sensible default, so every caller is made to say which category it means.
 */
export function refResolver(
  loaded: LoadedTournament,
  tables: GroupTable[],
  divisionId: string,
): RefResolver {
  const mine = loaded.matches.filter((m) => m.divisionId === divisionId);
  const byKey = new Map(
    tables.filter((tb) => tb.group.divisionId === divisionId).map((tb) => [tb.group.key, tb]),
  );
  /* The DRAWN bracket's row answers to a `W:`/`L:` label; a hand-added one only
     where the category has no drawn row of that label (`rowsByLabel`). A match
     added by hand and typed "Semi-Final 1" used to take over the reference — the
     Map kept whichever row came last — and fill the final from the wrong match. */
  const byRound = rowsByLabel(mine);

  const outcome = (code: string, want: "w" | "l"): string | null => {
    const m = byRound.get(code);
    if (!m) return null;
    const r = matchResult(loaded.tournament, m);
    if (!r?.winner) return null;
    const winner = r.winner === "a" ? m.teamAId : m.teamBId;
    const loser = r.winner === "a" ? m.teamBId : m.teamAId;
    return want === "w" ? winner : loser;
  };

  return {
    /* A placing is only trustworthy once the group is finished — quoting a
       leader mid-group would seed the knockout from a half-played table. */
    groupPlacing: (key, rank) => {
      const tb = byKey.get(key);
      if (!tb || !tb.complete) return null;
      return tb.rows[rank - 1]?.teamId ?? null;
    },
    tieWinner: (code) => outcome(code, "w"),
    tieLoser: (code) => outcome(code, "l"),
  };
}

/**
 * A resolver per category, built on demand.
 *
 * What every page and action actually needs: they walk a list of matches from
 * several categories and must resolve each one's slots inside its own. Handing
 * them one resolver is the bug; making each of them write this memo is four
 * chances to forget.
 */
export function resolverFactory(
  loaded: LoadedTournament,
  tables: GroupTable[],
): (divisionId: string) => RefResolver {
  const cache = new Map<string, RefResolver>();
  return (divisionId) => {
    let r = cache.get(divisionId);
    if (!r) {
      r = refResolver(loaded, tables, divisionId);
      cache.set(divisionId, r);
    }
    return r;
  };
}

export type ResolvedSlot = { teamId: string | null; label: string };

/** What a knockout match's two sides should show right now. */
export function resolveSlots(m: Match, r: RefResolver, nameOf: (id: string) => string): [ResolvedSlot, ResolvedSlot] {
  const side = (teamId: string | null, ref: string | null): ResolvedSlot => {
    if (teamId) return { teamId, label: nameOf(teamId) };
    if (ref) {
      const id = resolveRef(ref, r);
      return id ? { teamId: id, label: nameOf(id) } : { teamId: null, label: refLabel(ref) };
    }
    return { teamId: null, label: "TBD" };
  };
  return [side(m.teamAId, m.slotA), side(m.teamBId, m.slotB)];
}
