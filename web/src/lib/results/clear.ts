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

import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { divisions, groups, matches, tournaments, type Division, type Match, type Tournament } from "@/lib/db/schema";
import { dependentsOf, groupSlot, type Dependent } from "@/lib/brackets";
import { DrawChanged, deleteUnplayed, drawSignature, lockedIds, requireDivision } from "@/lib/draw/guard";
import { hasPlay, matchResult } from "@/lib/results";
import { CLEARED, writeResultIn } from "@/lib/results/write";
import { revertTournamentResultsIn } from "@/lib/rating/apply";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** The event row first: every writer of many of an event's matches takes it. */
const lockEvent = (tx: Tx, tournamentId: string) =>
  tx.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.id, tournamentId)).for("no key update");

/** A category's rows and groups, as the dependency graph reads them. */
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
  return { rows, groups: gs };
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
export type ClearAnswer = { problem: ClearProblem | null; matchId: string; touched: string[]; already?: boolean };

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
    if (!seen) return { problem: null, matchId, touched: [] };

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
  | "match-played" | "match-started" | "match-stale" | "match-feeds" | "group-short" | "match-changed" | "match-confirm";

/**
 * Delete a match — only one nobody has played and nothing waits on.
 *
 * Refused while it has a result or a rating ("match-played": clear it first)
 * or play ("match-started": reset it first) — the rating history it made would
 * otherwise go with it while the players' ratings stayed moved; RESTRICT
 * (migration 0022) refuses that in the database too. Refused when a knockout
 * match waits on it ("match-feeds"). An unplayed GROUP fixture may go even with
 * a knockout drawn — the way to drop a pair's remaining matches — but not when
 * the group would be left unable to fill a place the knockout asks of it
 * ("group-short"): no fixture left, or fewer teams than the highest place a
 * knockout slot names. `token` is the rev the page showed; a delete with none,
 * or of a match that changed since, is refused.
 */
export async function removeMatchIn(
  t: Tournament, matchId: string, token: number | null,
): Promise<{ problem: RemoveProblem | null }> {
  try {
    return await db.transaction(async (tx) => {
      await lockEvent(tx, t.id);
      const [m] = await tx
        .select()
        .from(matches)
        .where(and(eq(matches.id, matchId), eq(matches.tournamentId, t.id)))
        .for("update");
      if (!m) return { problem: null };

      if ((await lockedIds([m], tx)).size > 0) {
        return { problem: hasPlay(m) && !matchResult(t, m) ? "match-started" : "match-played" };
      }
      if (token === null) return { problem: "match-confirm" };
      if (m.rev !== token) return { problem: "match-stale" };

      const graph = await categoryGraph(tx, m.divisionId);
      const deps = dependentsOf(graph.rows, graph.groups, m.id);
      if (deps.some((d) => d.kind === "tie")) return { problem: "match-feeds" };

      if (m.groupId) {
        const group = graph.groups.find((g) => g.id === m.groupId);
        const left = graph.rows.filter((r) => r.groupId === m.groupId && r.id !== m.id);
        const teamsLeft = new Set(left.flatMap((r) => [r.teamAId, r.teamBId]).filter(Boolean));
        const asked = Math.max(0, ...graph.rows.flatMap((r) => [r.slotA, r.slotB])
          .map(groupSlot)
          .filter((s): s is { key: string; rank: number } => !!s && s.key === group?.key)
          .map((s) => s.rank));
        if (left.length === 0 || teamsLeft.size < asked) return { problem: "group-short" };
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
