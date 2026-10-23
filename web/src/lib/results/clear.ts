import "server-only";

/* Clearing, resetting and deleting matches, and starting a category again —
 * step 8. The organiser's corrections, each ONE transaction that never leaves a
 * rating moved with no record behind it.
 *
 * Lock order, the same in all three, and compatible with every other writer:
 *   the EVENT row (FOR NO KEY UPDATE) — scoring changes, draws, the order of
 *     play and removing a category take it first too, so they queue;
 *   then the match rows, in ONE statement sorted by id;
 *   then the people, ONCE, inside the revert (`lockPeople`).
 * A rating writer takes a match then people and never the event, so nothing
 * here can wait on one in a circle.
 *
 * A clear or reset sets `reset_rev` to the match's new rev, which fences off
 * every phone still holding rallies from before it (pushLog answers "reset";
 * lib/offline/queue).
 */

import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  divisions, groups, matches, registrations, teams, tournaments, type Division, type Match, type Team, type Tournament,
} from "@/lib/db/schema";
import { dependentsOf, groupSlot, type Dependent } from "@/lib/brackets";
import { DrawChanged, deleteUnplayed, drawSignature, lockedIds, requireDivision } from "@/lib/draw/guard";
import { hasPlay, matchResult } from "@/lib/results";
import { CLEARED, writeResultIn } from "@/lib/results/write";
import { revertTournamentResultsIn } from "@/lib/rating/apply";
import { fixtureDeletionProblem, groupMembers, pairRemovalProblem } from "@/lib/tournamentState";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The event row first: every writer of many of an event's matches takes it. */
const lockEvent = (tx: Tx, tournamentId: string) =>
  tx.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.id, tournamentId)).for("no key update");

/** A category's rows, groups and teams — the dependency graph, and who is in
    which group. Three sequential reads (never Promise.all in a transaction). */
async function categoryGraph(tx: Tx, divisionId: string) {
  const rows = await tx
    .select({
      id: matches.id, divisionId: matches.divisionId, round: matches.round, bracket: matches.bracket,
      groupId: matches.groupId, createdAt: matches.createdAt, slotA: matches.slotA, slotB: matches.slotB,
      teamAId: matches.teamAId, teamBId: matches.teamBId,
    })
    .from(matches)
    .where(eq(matches.divisionId, divisionId));
  const gs = await tx
    .select({ id: groups.id, divisionId: groups.divisionId, key: groups.key })
    .from(groups)
    .where(eq(groups.divisionId, divisionId));
  const ts = await tx
    .select({
      id: teams.id, name: teams.name, groupId: teams.groupId, withdrawnAt: teams.withdrawnAt,
      seed: teams.seed, createdAt: teams.createdAt,
    })
    .from(teams)
    .where(eq(teams.divisionId, divisionId));
  return { rows, groups: gs, teams: ts };
}

/** Lock these match rows in ONE statement, sorted, and return them. */
const lockMatches = (tx: Tx, ids: string[]) =>
  ids.length === 0
    ? Promise.resolve([] as Match[])
    : tx.select().from(matches).where(inArray(matches.id, [...new Set(ids)])).orderBy(asc(matches.id)).for("no key update");

/**
 * Empty the knockout sides that were filled from a match or group whose result
 * has just gone, while they have not started: the team and its line-up, rev + 1
 * and reset_rev with it (a phone that queued rallies for the old pairing must
 * not land them on whoever is filled in next). The side shows "Winner
 * Semi-Final 1" again until it is filled. Guarded on the match still having no
 * play, so a side that started meanwhile is never emptied under its rallies.
 */
async function emptySides(tx: Tx, deps: Dependent[]) {
  for (const d of deps) {
    const team = d.side === "a" ? matches.teamAId : matches.teamBId;
    await tx
      .update(matches)
      .set({
        ...(d.side === "a" ? { teamAId: null, lineupA: [] } : { teamBId: null, lineupB: [] }),
        rev: sql`${matches.rev} + 1`,
        resetRev: sql`${matches.rev} + 1`,
        updatedAt: new Date(),
      })
      .where(and(
        eq(matches.id, d.id),
        sql`${team} is not null`,
        sql`jsonb_array_length(${matches.log}) = 0`,
        sql`${matches.typedScoreA} is null`,
      ));
  }
}

/* ── Clear one result, or reset a match being played ─────────────────── */

export type ClearProblem = "clear-stale" | "clear-blocked";
/** `already`: the clear this page asked for had happened before it arrived (a
 *  retry, or another organiser) — nothing was done now, and any play since is
 *  left alone, so the page must not say the match is back to not played. */
export type ClearAnswer = {
  problem: ClearProblem | null; matchId: string; touched: string[]; already?: boolean;
  /** No such match in this event — deleted since the page was opened (removing
      a pair deletes played matches too). */
  gone?: boolean;
};

/**
 * Clear a match's result — or reset it to 0–0 while it is being played —
 * taking back every rating change it made. Organiser only (the caller checks).
 *
 * `token` is the rev the organiser's page showed. Refused when:
 *   - the match changed since that page was rendered ("clear-stale") — unless
 *     a clear has landed since (reset_rev beyond the token: a retry after a
 *     lost reply, or two organisers pressing it), which answers done and leaves
 *     any play after that clear alone; and unless the match has nothing on it
 *     now, which is reset anyway: harmless at 0–0, and it fences off every
 *     phone, which is what the organiser pressed for;
 *   - a match that waits on this one has started or has a result
 *     ("clear-blocked"): a correction must not change who is in a match
 *     already under way (Faisal). This covers a knockout match fed from this
 *     match's GROUP too.
 */
export async function clearMatch(t: Tournament, matchId: string, token: number): Promise<ClearAnswer> {
  return db.transaction(async (tx): Promise<ClearAnswer> => {
    await lockEvent(tx, t.id);
    const [seen] = await tx
      .select({ id: matches.id, divisionId: matches.divisionId })
      .from(matches)
      .where(and(eq(matches.id, matchId), eq(matches.tournamentId, t.id)));
    if (!seen) return { problem: null, matchId, touched: [], gone: true };

    const graph = await categoryGraph(tx, seen.divisionId);
    const deps = dependentsOf(graph.rows, graph.groups, seen.id);
    const locked = await lockMatches(tx, [seen.id, ...deps.map((d) => d.id)]);
    const target = locked.find((m) => m.id === seen.id);
    if (!target) return { problem: null, matchId, touched: [] };

    if (target.resetRev > token) return { problem: null, matchId, touched: [], already: true };
    if (target.rev !== token) {
      const busy = (await lockedIds([target], tx)).size > 0;
      if (busy) return { problem: "clear-stale", matchId, touched: [] };
    }

    const depRows = locked.filter((m) => m.id !== target.id);
    if ((await lockedIds(depRows, tx)).size > 0) return { problem: "clear-blocked", matchId, touched: [] };

    const written = await writeResultIn(tx, { tournament: t, match: target }, CLEARED, target.rev, { reset: true });
    if (!written) return { problem: "clear-stale", matchId, touched: [] };
    await emptySides(tx, deps);
    return { problem: null, matchId, touched: [target.id, ...depRows.map((m) => m.id)] };
  });
}

/* ── Delete a match ───────────────────────────────────────────────────── */

export type RemoveProblem =
  | "match-played" | "match-started" | "match-stale" | "match-feeds" | "group-short" | "pair-stranded"
  | "match-changed" | "match-confirm";

/**
 * Delete a match — only one nobody has played and nothing waits on.
 *
 * Refused while it has a result or a rating ("match-played": clear it first)
 * or play ("match-started": reset it first) — the rating history it made would
 * otherwise go with it while the players' ratings stayed moved; RESTRICT
 * (migration 0022) refuses that in the database too. Refused when a knockout
 * match waits on it ("match-feeds"). An unplayed GROUP fixture may go, even
 * with a knockout drawn, but never so that the group cannot finish
 * (`fixtureDeletionProblem`, step 8b): two or more members left with no match
 * ("group-short"), or a member left with none ("pair-stranded" — a pair that
 * pulled out is given walkovers or removed, never left in the table at nought
 * played). Deleting a fixture no longer takes a pair out of the table — the
 * table is the group's MEMBERS — so a place the knockout asks of the group is
 * no longer the delete's concern; removing a pair checks that.
 * `token` is the rev the page showed; a delete with none, or of a match that
 * changed since, is refused.
 */
export async function removeMatchIn(
  t: Tournament, matchId: string, token: number | null,
): Promise<{ problem: RemoveProblem | null; gone?: boolean }> {
  try {
    return await db.transaction(async (tx) => {
      await lockEvent(tx, t.id);
      const [m] = await tx
        .select()
        .from(matches)
        .where(and(eq(matches.id, matchId), eq(matches.tournamentId, t.id)))
        .for("update");
      if (!m) return { problem: null, gone: true };

      if ((await lockedIds([m], tx)).size > 0) {
        return { problem: hasPlay(m) && !matchResult(t, m) ? "match-started" : "match-played" };
      }
      if (token === null) return { problem: "match-confirm" };
      if (m.rev !== token) return { problem: "match-stale" };

      const graph = await categoryGraph(tx, m.divisionId);
      const deps = dependentsOf(graph.rows, graph.groups, m.id);
      if (deps.some((d) => d.kind === "tie")) return { problem: "match-feeds" };

      if (m.groupId) {
        const fixtures = graph.rows.filter((r) => r.groupId === m.groupId);
        const members = groupMembers(graph.teams, fixtures, m.groupId).map((x) => x.id);
        const problem = fixtureDeletionProblem(members, fixtures, m.id);
        if (problem) return { problem: problem.code };
      }

      await deleteUnplayed(tx, [m.id]);
      return { problem: null };
    });
  } catch (e) {
    /* A result or a rating landed between the check and the DELETE: the DELETE
       re-checks, and RESTRICT refuses a match with rating history — either way
       the match stays, and the organiser is told, never shown a 500. */
    if (e instanceof DrawChanged || foreignKeyRefused(e)) return { problem: "match-changed" };
    throw e;
  }
}

/** A 23503 anywhere on the cause chain — drizzle wraps the driver's error. */
function foreignKeyRefused(e: unknown): boolean {
  for (let c: unknown = e, i = 0; c && i < 6; c = (c as { cause?: unknown }).cause, i++) {
    if ((c as { code?: unknown }).code === "23503") return true;
  }
  return false;
}

/* ── Remove a pair that pulled out (step 8b) ──────────────────────────── */

type PlanRow = Pick<Match, "id" | "round" | "groupId" | "teamAId" | "teamBId" | "slotA" | "slotB">;
type PlanTeam = Pick<Team, "id" | "groupId" | "withdrawnAt" | "seed" | "createdAt">;

export type PairProblem =
  | "pair-in-knockout" | "pair-blocked" | "pair-group-short" | "pair-strands-group"
  | "pair-confirm" | "pair-stale" | "pair-changed";

/**
 * What removing a pair would do, and whether it may — ONE reading for the
 * manage page (which shows the reason instead of a button the server would
 * refuse, and the question) and the server (which decides under its locks).
 * `rows` and `teamRows` are the pair's CATEGORY; `recorded` is "has play, a
 * result or a rating on record" (`lockedIds`).
 *
 *   - `knockout`: a knockout match they are named in — any match outside a
 *     group, drawn or added by hand (Faisal, decision 6: give the walkover
 *     there instead). A hand-added row can be a Final or a `W:` feeder.
 *   - `fed`: every knockout side that waits on a place in their GROUP, found
 *     by the group's key, not through their fixtures — they may have none
 *     left, and the table still changes when they go. A fed match that has
 *     started or has a result `blocks`; a filled, unstarted side is emptied.
 *   - `groupProblem`: `pairRemovalProblem` — too few pairs left for the
 *     places the knockout asks (Faisal, 2026-10-15: walkovers instead), or
 *     pairs left with no match between them. A category that DRAWS a knockout
 *     from its groups (`knockoutToCome`: shape groups_ko) asks at least one
 *     place of every group even before the knockout is drawn — a group emptied
 *     then could never be drawn from, and the knockout could never be drawn
 *     at all without throwing away every result (the review of 8b).
 */
export function pairPlan(
  teamId: string, rows: PlanRow[], groupRows: { id: string; key: string }[], teamRows: PlanTeam[],
  recorded: (id: string) => boolean, knockoutToCome = false,
) {
  const team = teamRows.find((x) => x.id === teamId);
  const mine = rows.filter((r) => r.teamAId === teamId || r.teamBId === teamId);
  const knockout = mine.find((r) => r.groupId === null) ?? null;
  const groupId = team?.groupId ?? mine.find((r) => r.groupId)?.groupId ?? null;
  const key = groupRows.find((g) => g.id === groupId)?.key ?? null;
  const fed = key === null ? [] : rows.flatMap((r) =>
    (["a", "b"] as const).flatMap((side) => {
      const s = groupSlot(side === "a" ? r.slotA : r.slotB);
      return s && s.key === key ? [{ row: r, side, rank: s.rank }] : [];
    }));
  const blocks = fed.find((f) => recorded(f.row.id))?.row ?? null;
  const emptied = fed
    .filter((f) => !recorded(f.row.id) && (f.side === "a" ? f.row.teamAId : f.row.teamBId))
    .map((f) => ({ id: f.row.id, side: f.side, round: f.row.round }));
  const fixtures = groupId ? rows.filter((r) => r.groupId === groupId) : [];
  const members = groupId ? groupMembers(teamRows, fixtures, groupId).map((x) => x.id) : [];
  const asked = Math.max(knockoutToCome ? 1 : 0, ...fed.map((f) => f.rank));
  const groupProblem = groupId ? pairRemovalProblem(members, fixtures, teamId, asked) : null;
  return { mine, knockout, groupId, groupKey: key, fed, blocks, emptied, groupProblem, members };
}

/**
 * The fingerprint "Remove the pair" carries: each of their matches — an
 * unplayed one by its id, a live one as `id:live`, a finished or rated one by
 * its rev, as the restart signs them — every knockout side it would empty, and
 * their approved online entries. A match played, finished or corrected since
 * the page was opened, a side filled since, or an entry approved since, makes
 * the question the organiser read untrue, and changes it.
 */
export function pairSignature(
  t: Pick<Tournament, "sport" | "format" | "scoring">, mine: Match[], recorded: (id: string) => boolean,
  emptied: { id: string; side: "a" | "b" }[], entryIds: string[],
): string {
  return drawSignature([
    ...mine.map((m) => !recorded(m.id) ? m.id : hasPlay(m) && !matchResult(t as Tournament, m) ? `${m.id}:live` : `${m.id}:${m.rev}`),
    ...emptied.map((d) => `${d.id}:${d.side}`),
    ...entryIds.map((id) => `entry:${id}`),
  ]);
}

export type PairAnswer = {
  problem: PairProblem | null;
  /** The team is not in this event (never was, or its category was removed). */
  gone?: boolean;
  /** It had already been removed — a retry, or another organiser. */
  already?: boolean;
  /** Matches deleted or emptied, for revalidating their score pages. */
  touched: string[];
  /** Knockout sides emptied, which "Fill resolved slots" fills again. */
  emptied?: number;
};

/**
 * Remove a pair that pulled out — ORGANISER ONLY (Faisal, 2026-10-11). Every
 * one of their matches goes, played ones too, and every rating change those
 * matches made is taken back; the pair stays on the team list marked
 * Withdrawn and is left out of every table, draw, seeding, list of who can play
 * and order of play; their approved online entry is withdrawn with a note.
 * Refused while they are in a knockout match, while a knockout match waiting
 * on their group has started, and when their group could not finish or fill
 * its places without them (`pairPlan`).
 *
 * ONE transaction. Lock order: the event row (as every writer of many of an
 * event's matches takes it), then the team FOR UPDATE — so an organiser adding
 * a player or a match to it waits, then finds it withdrawn — then their
 * matches and every knockout match fed by their group in ONE sorted statement,
 * then the people once (inside the revert). `token` is the page's
 * `pairSignature`.
 */
export async function removePairIn(t: Tournament, teamId: string, token: string): Promise<PairAnswer> {
  try {
    return await db.transaction(async (tx) => {
      await lockEvent(tx, t.id);
      const [team] = await tx
        .select()
        .from(teams)
        .where(and(eq(teams.id, teamId), eq(teams.tournamentId, t.id)))
        .for("update");
      if (!team) return { problem: null, gone: true, touched: [] };
      if (team.withdrawnAt) return { problem: null, already: true, touched: [] };

      const graph = await categoryGraph(tx, team.divisionId);
      const [division] = await tx.select({ shape: divisions.shape }).from(divisions).where(eq(divisions.id, team.divisionId));
      const knockoutToCome = division?.shape === "groups_ko";
      /* What the plan reads, locked, and then read again from the locked rows:
         the graph's read took no lock, so a rally or a fill may have landed on
         one of these rows since. Nothing new can be NAMED for this team in the
         meantime — adding a match takes the team, which this holds. */
      const first = pairPlan(team.id, graph.rows, graph.groups, graph.teams, () => false, knockoutToCome);
      const locked = await lockMatches(tx, [...first.mine, ...first.fed.map((f) => f.row)].map((r) => r.id));
      const recordedIds = await lockedIds(locked, tx);
      const fresh = new Map(locked.map((m) => [m.id, m]));
      const plan = pairPlan(team.id, graph.rows.map((r) => fresh.get(r.id) ?? r), graph.groups, graph.teams,
        (id) => recordedIds.has(id), knockoutToCome);

      if (plan.knockout) return { problem: "pair-in-knockout", touched: [] };
      if (plan.blocks) return { problem: "pair-blocked", touched: [] };
      if (plan.groupProblem) return { problem: plan.groupProblem.code, touched: [] };

      const entries = await tx
        .select({ id: registrations.id })
        .from(registrations)
        .where(and(eq(registrations.tournamentId, t.id), eq(registrations.teamId, team.id), eq(registrations.status, "approved")));
      if (!token) return { problem: "pair-confirm", touched: [] };
      const mine = locked.filter((m) => m.teamAId === team.id || m.teamBId === team.id);
      const sig = pairSignature(t, mine, (id) => recordedIds.has(id), plan.emptied, entries.map((e) => e.id));
      if (token !== sig) return { problem: "pair-stale", touched: [] };

      const recorded = mine.filter((m) => recordedIds.has(m.id)).map((m) => m.id);
      /* Write down the membership the plan relied on. A group drawn before
         0023, or a team its backfill skipped, has members known only through
         their FIXTURES — and this is about to delete some: the pair left alone
         in a group of two would drop out of its own table, and the group could
         never be decided. Recorded first, the pair left stays, wins the group,
         and the removed pair is named beside it. Only where nothing is recorded. */
      if (plan.groupId) {
        await tx
          .update(teams)
          .set({ groupId: plan.groupId })
          .where(and(inArray(teams.id, [...plan.members, team.id]), isNull(teams.groupId)));
      }
      await revertTournamentResultsIn(tx, recorded);
      /* `deleteUnplayed` deletes only rows with nothing on them and re-checks
         that inside its DELETE, so a played match is first cleared — in one
         statement, as the restart clears — and then goes through it like every
         other delete. */
      if (recorded.length > 0) {
        await tx.update(matches).set({ ...CLEARED, rules: null, updatedAt: new Date() }).where(inArray(matches.id, recorded));
      }
      await deleteUnplayed(tx, mine.map((m) => m.id));
      await emptySides(tx, plan.emptied.map((d) => ({ id: d.id, side: d.side, kind: "group" as const })));
      await tx.update(teams).set({ withdrawnAt: new Date() }).where(eq(teams.id, team.id));
      if (entries.length > 0) {
        /* The team stays, so the entry keeps pointing at it — unlike removing
           a category, which deletes the team. Withdrawn, it no longer holds the
           phone's one live entry, so the pair could enter again online. */
        await tx
          .update(registrations)
          .set({ status: "withdrawn", decidedAt: new Date(), note: "Removed from the event by the organiser after they pulled out." })
          .where(inArray(registrations.id, entries.map((e) => e.id)));
      }
      return { problem: null, touched: [...mine.map((m) => m.id), ...plan.emptied.map((d) => d.id)], emptied: plan.emptied.length };
    });
  } catch (e) {
    /* A result or a rating landed on one of their matches between the read
       and the DELETE: the DELETE re-checks, RESTRICT backs it, and the whole
       removal rolls back — said, never a 500. */
    if (e instanceof DrawChanged || foreignKeyRefused(e)) return { problem: "pair-changed", touched: [] };
    throw e;
  }
}

/* ── Start a category again ───────────────────────────────────────────── */

export type RestartProblem = "restart-gone" | "restart-empty" | "restart-confirm" | "restart-stale" | "restart-name";

/**
 * The fingerprint "Start this category again" carries: every match with play or
 * a rating, a FINISHED or rated one by its rev, a LIVE one only by its id — a
 * live match's rev moves with every rally, and signed by rev the button would
 * be stale within seconds on a busy day and never get through. A finished
 * match, or one that started or finished since the page was opened, changes it.
 */
export function restartSignature(t: Pick<Tournament, "sport" | "format" | "scoring">, recorded: Match[]): string {
  return drawSignature(recorded.map((m) => (hasPlay(m) && !matchResult(t as Tournament, m) ? `${m.id}:live` : `${m.id}:${m.rev}`)));
}

/**
 * Start a category again: clear EVERY result in it — live matches reset too
 * (Faisal) — and take back every rating change those results made. The teams,
 * groups, fixtures, bracket rows, courts and times stay; knockout sides filled
 * from results are emptied, so the draw is as it was drawn, and a redraw is
 * allowed again.
 *
 * Confirmed by the category's name typed in (Faisal) — `nameMatches`, the same
 * check the button makes (manage/sameName) — AND the page's fingerprint
 * (`restartSignature`). A category that is not this event's, or was removed
 * since the page was opened, is "restart-gone". EVERY match of the category gets a new
 * rev and reset_rev, unplayed ones too, so rallies a phone tapped offline
 * before the restart cannot land afterwards. The statement count is flat in
 * the number of matches (`revertTournamentResultsIn`).
 */
export async function restartCategory(
  t: Tournament, wanted: string | null, token: string, nameMatches: (name: string) => boolean,
): Promise<{ problem: RestartProblem | null; division: Division | null; touched: string[] }> {
  return db.transaction(async (tx) => {
    await lockEvent(tx, t.id);
    const division = await requireDivision(t.id, wanted, tx);
    if (!division) return { problem: "restart-gone", division: null, touched: [] };
    await tx.select({ id: divisions.id }).from(divisions).where(eq(divisions.id, division.id)).for("update");

    const all = await tx
      .select()
      .from(matches)
      .where(eq(matches.divisionId, division.id))
      .orderBy(asc(matches.id))
      .for("no key update");
    const recordedIds = await lockedIds(all, tx);
    const recorded = all.filter((m) => recordedIds.has(m.id));
    if (recorded.length === 0) return { problem: "restart-empty", division, touched: [] };
    if (!token) return { problem: "restart-confirm", division, touched: [] };
    if (token !== restartSignature(t, recorded)) return { problem: "restart-stale", division, touched: [] };
    if (!nameMatches(division.name)) {
      return { problem: "restart-name", division, touched: [] };
    }

    await revertTournamentResultsIn(tx, recorded.map((m) => m.id));
    await tx
      .update(matches)
      .set({
        /* The same columns a clear writes — spread, so a column added to
           CLEARED is cleared here too without anyone remembering to. */
        ...CLEARED,
        rules: null,
        teamAId: sql`case when ${matches.slotA} is null then ${matches.teamAId} end`,
        lineupA: sql`case when ${matches.slotA} is null then ${matches.lineupA} else '[]'::jsonb end`,
        teamBId: sql`case when ${matches.slotB} is null then ${matches.teamBId} end`,
        lineupB: sql`case when ${matches.slotB} is null then ${matches.lineupB} else '[]'::jsonb end`,
        rev: sql`${matches.rev} + 1`,
        resetRev: sql`${matches.rev} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(matches.divisionId, division.id));
    return { problem: null, division, touched: all.map((m) => m.id) };
  });
}
