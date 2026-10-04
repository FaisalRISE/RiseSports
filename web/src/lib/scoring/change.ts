import "server-only";

/* Changing an event's scoring once matches have been played.
 *
 * Faisal, 2026-09-29: a change applies to every match not yet finished —
 * including one being played now — and finished results stand. Before this, a
 * change simply rewrote `tournaments.scoring`, and every match was re-judged by
 * it on the next read: an 11–7 played to 11 stopped being "over" when the event
 * moved to 15, and dropped out of the table and the podium.
 *
 * So the save does this, in ONE transaction:
 *   1. freezes every finished match not frozen yet under the OLD scoring (a
 *      match finished before step 7 shipped has no freeze; one finished since
 *      was frozen by `writeResult` the moment it ended);
 *   2. looks at every match being played. Under the NEW scoring it plays on;
 *      or it is now over — then it is finished where it stands, frozen under
 *      the new scoring, its clock stopped, and rated after the commit. NOTHING
 *      is saved, and the organiser is told which match, when the new rules
 *      would have ended a game already (14–4 when the event moves to 11), or
 *      would COUNT ITS RALLIES DIFFERENTLY — moving from service to rally
 *      scoring turned a live 5–3 into a finished 11–9, re-scoring points
 *      already played. "Apply to matches being played" is about how they END,
 *      never about re-counting what happened;
 *   3. moves the `rev` of every match of the event, then saves the scoring.
 * and reports back what happened in plain lines.
 *
 * ── Why every rev moves ──────────────────────────────────────────────────
 * A rally or a typed result works its result out from the event and the match
 * as it READ them, and is guarded only by `rev`. Locking the rows here queues
 * its UPDATE but cannot change what it already read, so without a new rev a
 * tap read just before the save was judged by the old rules just after it — a
 * game finished at 11 the organiser had just been told plays on to 15, or one
 * that counted as won under 11 with no rating and no freeze. With the rev
 * moved, that write goes stale and is worked out again from a fresh read: a
 * phone's queue retries on its own, a single tap reloads.
 *
 * ── Locks ────────────────────────────────────────────────────────────────
 * The EVENT row first — read here, under the lock, rather than trusted from the
 * caller, so two saves cannot judge the matches by a scoring that is no longer
 * current — then every match of the event in id order. The order of play and
 * the draws take the event row first too, so the three queue instead of each
 * holding rows the other wants. Only event and match rows: the rating engine
 * takes a match before any person, and nobody holding a person waits on a
 * match, so this can queue behind a rating but never close a circle with one.
 */

import { asc, eq, notInArray, and, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches, teams, tournaments, type Match, type MatchRules } from "@/lib/db/schema";
import { endingOf, eventRules, noLiveCourt, viewMatch } from "@/lib/matchState";
import { hasPlay, matchResult } from "@/lib/results";
import { finalScoreProblem } from "@/lib/scoring/final";
import { readTiming, stopTiming } from "@/lib/scoring/timing";
import { applyMatchRatings, revertMatchRatings } from "@/lib/rating/apply";

export type ScoringSaved = { ok: true; lines: string[] } | { ok: false; error: string };

/** How many live matches are named one by one before "…and N more". */
const NAMED = 3;

/** "to 15", "8 boards", or nothing for a sport scored in sets. */
const label = (r: MatchRules): string | null =>
  r.boards != null ? `${r.boards} boards` : r.rules ? `to ${r.rules.target}` : null;

export async function changeScoring(
  t: { id: string },
  scoring: Record<string, unknown> | null,
): Promise<ScoringSaved> {
  const done = await db.transaction(async (tx) => {
    const [current] = await tx.select().from(tournaments).where(eq(tournaments.id, t.id)).for("no key update");
    if (!current) return { ok: false as const, error: "This event no longer exists." };
    const next = { ...current, scoring };
    const oldRules = eventRules(current);
    const newRules = eventRules(next);

    const rows = await tx
      .select().from(matches)
      .where(eq(matches.tournamentId, t.id))
      .orderBy(asc(matches.id))
      .for("no key update");
    const names = new Map(
      (await tx.select({ id: teams.id, name: teams.name }).from(teams).where(eq(teams.tournamentId, t.id)))
        .map((r) => [r.id, r.name]),
    );
    const vs = (m: Match) => `${names.get(m.teamAId ?? "") ?? "TBD"} v ${names.get(m.teamBId ?? "") ?? "TBD"}`;

    let kept = 0;
    const freeze: string[] = [];
    const endsNow: { m: Match; a: number; b: number }[] = [];
    const playing: { m: Match; a: number; b: number }[] = [];
    const reopened: Match[] = [];

    for (const m of rows) {
      if (matchResult(current, m)) {
        kept++;
        if (!m.rules) freeze.push(m.id);
        continue;
      }
      if (!hasPlay(m)) continue;
      /* A finished game reopened to correct it keeps the rules it was played
         to; it is named, so "plays on to 15" is never said of a game that will
         still end at 11. */
      if (m.rules) {
        reopened.push(m);
        continue;
      }

      const was = viewMatch(current, m);
      const now = viewMatch(next, m);
      if (was.a !== now.a || was.b !== now.b) {
        return {
          ok: false as const,
          error: `Not saved: ${vs(m)} is at ${was.a}–${was.b}, and these rules would count the rallies already played as ${now.a}–${now.b}. Change how points are scored when no match is being played, or finish that one first.`,
        };
      }
      const r = matchResult(next, m);
      if (!r) {
        playing.push({ m, a: now.a, b: now.b });
        continue;
      }
      if (finalScoreProblem(endingOf(next, m), r.a, r.b)) {
        return {
          ok: false as const,
          error: `Not saved: ${vs(m)} is at ${r.a}–${r.b}, and under these rules that game would already have ended. Correct that match first, or choose rules it hasn't passed.`,
        };
      }
      endsNow.push({ m, a: r.a, b: r.b });
    }

    if (freeze.length > 0) {
      await tx
        .update(matches)
        .set({ rules: oldRules, rev: sql`${matches.rev} + 1` })
        .where(and(inArray(matches.id, freeze), isNull(matches.rules)));
    }
    const at = new Date();
    for (const { m } of endsNow) {
      await tx
        .update(matches)
        .set({
          rules: newRules,
          timing: m.timing ? (stopTiming(readTiming(m.timing), at.toISOString()) as unknown as Record<string, unknown>) : m.timing,
          rev: m.rev + 1,
          updatedAt: at,
        })
        .where(eq(matches.id, m.id));
    }
    /* Every other match of the event: see "Why every rev moves" above. */
    const moved = [...freeze, ...endsNow.map((x) => x.m.id)];
    await tx
      .update(matches)
      .set({ rev: sql`${matches.rev} + 1` })
      .where(moved.length > 0
        ? and(eq(matches.tournamentId, t.id), notInArray(matches.id, moved))
        : eq(matches.tournamentId, t.id));
    await tx.update(tournaments).set({ scoring }).where(eq(tournaments.id, t.id));

    const newLabel = label(newRules);
    const lines = [newLabel ? `Saved. This event now plays ${newLabel}.` : "Saved."];
    if (kept > 0) lines.push(`${kept} finished ${kept === 1 ? "match keeps its result" : "matches keep their results"}.`);
    for (const x of endsNow) {
      lines.push(`${vs(x.m)} was at ${x.a}–${x.b}, which ends it under these rules — it is now finished.`);
    }
    for (const m of reopened) {
      const frozen = label(m.rules as MatchRules);
      lines.push(`${vs(m)} was reopened to correct it, and still finishes ${frozen ? frozen.replace(/^(\d+ boards)$/, "after $1") : "as it was played"} — the rules it was played to.`);
    }
    for (const x of playing.slice(0, NAMED)) {
      const court = x.m.court ? ` on Court ${x.m.court}` : "";
      const noCourt = noLiveCourt(next, x.m);
      lines.push(
        noCourt
          ? `${vs(x.m)} is being played now, ${x.a}–${x.b}${court}. ${noCourt.body}`
          : `${vs(x.m)} is being played now, ${x.a}–${x.b}${court}. It plays on ${newRules.rules && newRules.boards == null ? `to ${newRules.rules.target}` : "under these rules"}.`,
      );
    }
    if (playing.length > NAMED) lines.push(`…and ${playing.length - NAMED} more being played now, which play on under these rules too.`);
    return { ok: true as const, lines, rate: endsNow.map((x) => x.m.id) };
  });

  if (!done.ok) return done;

  /* After the commit, as every rating is, one match at a time — never a
     fan-out over a list. Taken back first: a match an old bug left with a
     rating and no result would otherwise keep that rating for this one (the
     engine answers "already"). Each in its own transaction, so no transaction
     ever locks people twice. */
  for (const id of done.rate) {
    try {
      await revertMatchRatings(id);
      await applyMatchRatings(id);
    } catch (e) {
      console.error("rating apply failed after a scoring change", id, e);
    }
  }
  return { ok: true, lines: done.lines };
}
