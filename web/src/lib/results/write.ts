import "server-only";

/* THE writer of a match's score, shared by every action that changes one.
 *
 * It used to live inside app/t/[slug]/actions.ts; step 8's clear, reset and
 * restart need the same write, and a second copy of what a write sets would
 * drift from the first within a release. Moved, not changed: the rally path is
 * exactly what it was.
 */

import { revalidatePath } from "next/cache";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches, type Match, type Outcome, type Tournament } from "@/lib/db/schema";
import { allowsDraws, endingOf, eventRules, viewMatch } from "@/lib/matchState";
import { normaliseResult, resultProblem, type ResultRefusalCode } from "@/lib/results/record";
import { matchResult, hasPlay, type MatchResult } from "@/lib/results";
import { applyMatchRatings, revertMatchRatingsIn } from "@/lib/rating/apply";
import type { Side } from "@/lib/scoring/replay";
import type { Timing } from "@/lib/scoring/timing";

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** A match and its event, as the actions load them. */
export type MatchCtx = { match: Match; tournament: Tournament };

/** Everything a write may set about a match's score. */
export type Next = {
  log: Side[];
  ackedGates: number[];
  typedScoreA: number | null;
  typedScoreB: number | null;
  outcome: Outcome | null;
  sets: [number, number][] | null;
  /** Undefined leaves the clock as it is. */
  timing?: Timing | null;
};

/**
 * A match with nothing on it — what a clear, a reset and a restart write. The
 * teams, line-ups, who serves first, the court and the time on the order of
 * play are NOT part of a result and stay. `rules` (the freeze) follows: a
 * match with no play has none.
 */
export const CLEARED: Next = {
  log: [], ackedGates: [], typedScoreA: null, typedScoreB: null, outcome: null, sets: null, timing: null,
};

/** Same result — score, winner and why it moves no rating, if it does not. */
function sameResult(x: MatchResult | null, y: MatchResult | null): boolean {
  if (!x || !y) return x === y;
  return x.a === y.a && x.b === y.b && x.winner === y.winner && x.outcome === y.outcome;
}

/** The columns a write sets, from what it writes. One definition for every path. */
function valuesFor(ctx: MatchCtx, next: Next, expectedRev: number, reset: boolean) {
  const { tournament: t, match: m } = ctx;
  const after = { ...m, ...next, timing: next.timing === undefined ? m.timing : next.timing };
  const result = matchResult(t, after);   // judged by the frozen rules if it has them, else today's
  const rules = hasPlay(after) ? (m.rules ?? (result ? eventRules(t) : null)) : null;
  return {
    log: next.log,
    ackedGates: next.ackedGates,
    typedScoreA: next.typedScoreA,
    typedScoreB: next.typedScoreB,
    outcome: next.outcome,
    sets: next.sets,
    rules,
    ...(next.timing !== undefined ? { timing: next.timing as unknown as Record<string, unknown> | null } : {}),
    rev: expectedRev + 1,
    /* A clear or reset fences off every phone still holding rallies from
       before it: pushLog answers a push at a lower rev with "reset". */
    ...(reset ? { resetRev: expectedRev + 1 } : {}),
    updatedAt: new Date(),
  };
}

/**
 * The TRANSACTIONAL part of a write, inside the caller's transaction: the
 * guarded UPDATE, then the revert of whatever rating the match had — under the
 * match row's lock, which the UPDATE (or the caller) took first: the rating
 * engine's order, match then people. False when the rev guard missed.
 *
 * Nothing after the commit happens here — no rating applied, nothing
 * revalidated. Applying a rating INSIDE the caller's transaction would wait on
 * this very row's lock from another pooled connection, for ever.
 */
export async function writeResultIn(
  tx: Tx, ctx: MatchCtx, next: Next, expectedRev: number, opts: { reset?: boolean } = {},
): Promise<boolean> {
  const values = valuesFor(ctx, next, expectedRev, opts.reset ?? false);
  const updated = await tx
    .update(matches)
    .set(values)
    .where(and(eq(matches.id, ctx.match.id), eq(matches.rev, expectedRev)))
    .returning({ id: matches.id });
  if (updated.length === 0) return false;
  await revertMatchRatingsIn(tx, ctx.match.id);
  return true;
}

/**
 * Write a match's score — every rally, undo, correction and typed result, under
 * a guard on `rev` so a stale device cannot roll the match back.
 *
 * It asks ONE question — did the RESULT change? Unchanged (every mid-game
 * rally): one guarded UPDATE, outside any transaction — the hot path stays one
 * round trip. Changed: `writeResultIn` in a transaction of its own, so the
 * UPDATE and the revert of the match's old rating move together. The new
 * rating, if the result earns one, is applied after the commit;
 * `applyMatchRatings` re-checks the result under its own lock.
 *
 * It also freezes the scoring the match is judged by (`matches.rules`, see
 * lib/matchState `matchRules`): stamped the moment it first has a result, kept
 * while it has any play, dropped when it has none.
 *
 * A rating failure is logged, never thrown: the score is committed, and a rally
 * that would not save because of a rating is a problem on court right now.
 */
export async function writeResult(
  ctx: MatchCtx, next: Next, expectedRev: number,
): Promise<{ ok: true; rev: number } | { ok: false; reason: "stale" }> {
  const { tournament: t, match: m } = ctx;
  const after = { ...m, ...next, timing: next.timing === undefined ? m.timing : next.timing };
  const before = matchResult(t, m);
  const result = matchResult(t, after);

  if (sameResult(before, result)) {
    const updated = await db
      .update(matches)
      .set(valuesFor(ctx, next, expectedRev, false))
      .where(and(eq(matches.id, m.id), eq(matches.rev, expectedRev)))
      .returning({ id: matches.id });
    if (updated.length === 0) return { ok: false, reason: "stale" };
  } else {
    const written = await db.transaction((tx) => writeResultIn(tx, ctx, next, expectedRev));
    if (!written) return { ok: false, reason: "stale" };
  }
  /* On EITHER path, a finished result that earns a rating is offered to the
     engine. On the changed path that is the new rating. On the unchanged path
     it is a repair: a match can be finished with no rating — its teams were
     filled in after it was played, or an apply failed — and every later write
     of the same result used to take the cheap path and leave it so for ever.
     The engine answers "already" in two queries when the rating is there. A
     mid-game rally has no result, so the hot path still does nothing extra. */
  if (result?.winner && !result.outcome) await rate(m.id);

  revalidateMatch(t.slug, m.id);
  return { ok: true, rev: expectedRev + 1 };
}

/** Offer a finished match to the rating engine. Logged, never thrown. */
export async function rate(matchId: string) {
  try {
    await applyMatchRatings(matchId);
  } catch (e) {
    console.error("rating apply failed for match", matchId, e);
  }
}

/* ── A result typed in ─────────────────────────────────────────────── */

export type RecordReply =
  | { ok: true; rev: number }
  | {
      ok: false;
      code: ResultRefusalCode | "live" | "stale" | "organiser-only";
      /** One plain sentence for whoever typed it. */
      error: string;
      /** The score they probably meant, in the order they typed it. */
      suggestion?: { a: number; b: number };
      /** Code "live": the rallies that typing would replace. */
      live?: { a: number; b: number; rallies: number };
    };

export type TypedResult = {
  a: number; b: number; expectedRev: number;
  outcome: Outcome | null; sets: [number, number][] | null; replaceLive: boolean;
};

/**
 * Record a result typed in — the final score, a walkover, or a game that did
 * not finish normally. ONE set of rules for every way in: a PIN referee's typed
 * result (`recordResult`) and the organiser's Walkover button (`giveWalkover`).
 * The caller has authorised `ctx` and parsed the input.
 *
 * Idempotent: the same result again is ok at the current rev, even from an
 * older one. Replacing live rallies is a choice (`replaceLive`), never a side
 * effect: without it a match with rallies answers "live".
 */
export async function recordTypedResult(ctx: MatchCtx, v: TypedResult): Promise<RecordReply> {
  const { tournament: t, match: m } = ctx;

  const ending = endingOf(t, m);
  const r = normaliseResult(ending, { a: v.a, b: v.b, outcome: v.outcome, sets: v.sets });

  const log = (m.log as Side[]) ?? [];
  const same =
    m.typedScoreA === r.a && m.typedScoreB === r.b && (m.outcome ?? null) === r.outcome &&
    JSON.stringify(m.sets ?? null) === JSON.stringify(r.sets) && log.length === 0;
  if (same) {
    /* The same result again — a retry after a lost reply, or somebody saving
       it twice. Also the way to repair a finished match that has no rating:
       the engine answers "already" in two queries when it has one. */
    if (r.a !== r.b && !r.outcome) await rate(m.id);
    return { ok: true, rev: m.rev };
  }

  const problem = resultProblem(m, ending, r, allowsDraws(t.sport));
  if (problem) return { ok: false, ...problem };

  if (log.length > 0 && !v.replaceLive) {
    const view = viewMatch(t, m);
    return {
      ok: false, code: "live",
      error: `This match is being refereed live — ${view.a}–${view.b} after ${log.length} ${log.length === 1 ? "rally" : "rallies"}. Typing a result replaces those rallies.`,
      live: { a: view.a, b: view.b, rallies: log.length },
    };
  }

  const res = await writeResult(
    ctx,
    {
      log: [], ackedGates: [],   // an OSL rotation re-arms if the match is ever refereed again
      typedScoreA: r.a, typedScoreB: r.b, outcome: r.outcome, sets: r.sets,
      timing: null,              // a typed result has no play time to report
    },
    v.expectedRev,
  );
  if (res.ok) return res;
  return { ok: false, code: "stale", error: "This match changed on another device a moment ago — look at it again before saving." };
}

/** Every page that shows a match's score. */
export function revalidateMatch(slug: string, matchId: string) {
  revalidatePath(`/t/${slug}`);
  revalidatePath(`/t/${slug}/manage`);
  revalidatePath(`/t/${slug}/score/${matchId}`);
  revalidatePath(`/t/${slug}/ratings`);
}
