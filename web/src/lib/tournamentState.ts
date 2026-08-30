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
import { resolveRef, refLabel, type RefResolver } from "@/lib/brackets";

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

/** A match reduced to what the standings engine needs: a settled score or nothing. */
function toStandingsMatch(t: Tournament, m: Match): StandingsMatch {
  const v = viewMatch(t, m);
  const [a, b] = v.typed ? [m.typedScoreA ?? 0, m.typedScoreB ?? 0] : [v.a, v.b];
  /* Only a FINISHED match counts. A match in progress must not move the table,
     or the standings would swing on every rally. */
  const played = v.typed || v.over;
  return { teamAId: m.teamAId, teamBId: m.teamBId, scoreA: a, scoreB: b, played };
}

export type GroupTable = { group: Group; rows: Row[]; complete: boolean };

export function groupTables(loaded: LoadedTournament): GroupTable[] {
  const { tournament: t } = loaded;
  const tieBreak = tieBreakFor(t);
  const draws = allowsDraws(t.sport);
  const byId = new Map(loaded.teams.map((x) => [x.id, x]));

  return loaded.groups.map((g) => {
    const ms = loaded.matches.filter((m) => m.groupId === g.id);
    const ids = new Set<string>();
    for (const m of ms) {
      if (m.teamAId) ids.add(m.teamAId);
      if (m.teamBId) ids.add(m.teamBId);
    }
    const entrants = [...ids]
      .map((id) => byId.get(id))
      .filter((x): x is Team => !!x)
      .map((x) => ({ id: x.id, name: x.name, seed: x.seed }));

    const sm = ms.map((m) => toStandingsMatch(t, m));
    return {
      group: g,
      rows: standings(entrants, sm, { tieBreak, allowDraws: draws }),
      complete: ms.length > 0 && sm.every((m) => m.played),
    };
  });
}

/** Resolver that fills knockout slots from group placings and earlier ties. */
export function refResolver(loaded: LoadedTournament, tables: GroupTable[]): RefResolver {
  const byKey = new Map(tables.map((tb) => [tb.group.key, tb]));
  const byRound = new Map(loaded.matches.map((m) => [m.round, m]));

  const outcome = (code: string, want: "w" | "l"): string | null => {
    const m = byRound.get(code);
    if (!m) return null;
    const v = viewMatch(loaded.tournament, m);
    const [a, b] = v.typed ? [m.typedScoreA ?? 0, m.typedScoreB ?? 0] : [v.a, v.b];
    if (!(v.typed || v.over) || a === b) return null;
    const winner = a > b ? m.teamAId : m.teamBId;
    const loser = a > b ? m.teamBId : m.teamAId;
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
