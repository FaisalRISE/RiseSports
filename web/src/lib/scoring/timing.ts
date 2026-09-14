import "server-only";

/* How long a match actually took.
 *
 * Per `Files for claude code/match-timing-spec.md` v2.0: starts on the first
 * point, stops on the point that wins it, pause and resume for timeouts and
 * injuries, and `playingTime = totalElapsed − pausedTime`. One record per
 * match, no aggregates, and **no feed into the rating** — the spec is firm.
 *
 * ── The rule that shapes all of this ─────────────────────────────────────
 * "Use device-monotonic elapsed time, not the difference between two
 * wall-clock timestamps. When an offline device reconnects and its clock
 * corrects, timestamp subtraction silently produces wrong durations."
 *
 * ── Why the legacy shape could not be ported as-is ───────────────────────
 * The legacy record stores `mono` — a raw `performance.now()` reading — and
 * subtracts a later reading from it. That works in an app whose entire state
 * lives in one page's localStorage. It cannot work here: `performance.now()`
 * is measured from THIS page load, so the moment the record reaches Postgres
 * and is read back — after a reload, or on the second device at the other end
 * of the court — the stored number means nothing.
 *
 * ── What is stored instead ───────────────────────────────────────────────
 * Only ACCUMULATED milliseconds, plus a wall-clock `startedAt` that is used for
 * ordering and never subtracted. Nothing here reads a clock, so:
 *
 *   - the only thing that ever becomes a duration is a delta measured by
 *     `performance.now()` on one device within one page session, which is
 *     exactly what the spec asks for;
 *   - these functions are pure, so the arithmetic is testable without a clock;
 *   - nothing that crosses the wire can be misinterpreted later.
 *
 * ── Where the buckets are decided ────────────────────────────────────────
 * The DEVICE splits its measurement into play and pause before sending it, and
 * `addMeasured` is the only function here that folds time in at all. That is
 * deliberate: a referee who pauses for an injury with no signal has a phone
 * that knows the clock is stopped and a server record that still says
 * `running: true`. Routing by the record would bill that injury break as play.
 * So the record accumulates what it is told and mirrors the device's flag; it
 * never infers.
 *
 * The tick rides along with the rally write that was happening anyway (see
 * `commitLog`), so a reload loses at most the time since the last point — and
 * costs no extra round trips.
 *
 * Server timestamps were the other candidate and are wrong here: a match
 * scored offline would have its start stamped at reconnect.
 */

import { type PauseReason, type Tick, type TimingView } from "./clock";

export type { PauseReason, Tick };
export { PAUSE_REASONS, fmtClock, fmtMinutes, EMPTY_TICK, tickIsEmpty } from "./clock";

export type Timing = TimingView;

export const emptyTiming = (): Timing => ({
  startedAt: null,
  endedAt: null,
  playingMs: 0,
  pausedMs: 0,
  pauseCount: 0,
  pauseReason: null,
  running: false,
});

/** Anything absent or malformed reads as a fresh record rather than throwing. */
export function readTiming(value: unknown): Timing {
  const base = emptyTiming();
  if (!value || typeof value !== "object") return base;
  const v = value as Partial<Timing>;
  const ms = (n: unknown) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : 0);
  return {
    startedAt: typeof v.startedAt === "string" ? v.startedAt : null,
    endedAt: typeof v.endedAt === "string" ? v.endedAt : null,
    playingMs: ms(v.playingMs),
    pausedMs: ms(v.pausedMs),
    pauseCount: ms(v.pauseCount),
    pauseReason: v.pauseReason ?? null,
    running: v.running === true,
  };
}

/** Deltas are clamped: a negative one can only come from a broken clock. */
const delta = (ms: number): number => (Number.isFinite(ms) && ms > 0 ? Math.round(ms) : 0);

/**
 * Start on the first point. Idempotent — a match already started stays started,
 * so re-running it after an undo does not reset the clock.
 */
export function startTiming(t: Timing, atISO: string): Timing {
  if (t.startedAt) return t;
  return { ...t, startedAt: atISO, running: true };
}

/**
 * Fold in time a device measured, already split into its two buckets.
 *
 * The ONE place a duration enters the record. Nothing else adds milliseconds,
 * which is what makes "playingTime excludes pauses" a property of one function
 * rather than a convention spread across the call sites.
 */
export function addMeasured(t: Timing, playMs: number, pausedMs: number): Timing {
  if (!t.startedAt || t.endedAt) return t;
  const p = delta(playMs);
  const q = delta(pausedMs);
  if (p === 0 && q === 0) return t;
  return { ...t, playingMs: t.playingMs + p, pausedMs: t.pausedMs + q };
}

/**
 * Mirror the device's pause onto the record.
 *
 * The count moves on the TRANSITION, never on the reason. A referee who pauses
 * for a timeout and then reaches for "Injury" is relabelling the break they are
 * already standing in, not starting a second one — so the reason changes and
 * `pauseCount` does not. Without the distinction the console would show a
 * reason the record disagreed with, which is a small lie in the one place the
 * record exists to be believed.
 */
export function pauseTiming(t: Timing, reason: PauseReason = "other"): Timing {
  if (!t.startedAt || t.endedAt) return t;
  if (!t.running) return t.pauseReason === reason ? t : { ...t, pauseReason: reason };
  return { ...t, running: false, pauseReason: reason, pauseCount: t.pauseCount + 1 };
}

/** Mirror the device's resume. */
export function resumeTiming(t: Timing): Timing {
  if (!t.startedAt || t.endedAt || t.running) return t;
  return { ...t, running: true, pauseReason: null };
}

/**
 * Apply one device tick: fold the measured time, then move the pause flag.
 *
 * Both halves in one function, in this order, on purpose. Flipping the flag
 * first and folding afterwards would file the minutes BEFORE an injury break
 * as paused time — the same wrong answer, arrived at by writing two correct
 * calls in the wrong order. There is no way to write them in the wrong order
 * from here.
 */
export function applyTick(t: Timing, tick: Tick): Timing {
  const folded = addMeasured(t, tick.playMs, tick.pausedMs);
  if (tick.pause === undefined) return folded;
  return tick.pause === null ? resumeTiming(folded) : pauseTiming(folded, tick.pause);
}

/**
 * Stop on the point that wins the match.
 *
 * A match stopped while paused keeps its pause in `pausedMs` — the pause was
 * real time in the hall, and only `playingMs` claims to be play.
 */
export function stopTiming(t: Timing, atISO: string): Timing {
  if (!t.startedAt || t.endedAt) return t;
  return { ...t, endedAt: atISO, running: false, pauseReason: null };
}

/**
 * Undo past the winning point: the match is live again.
 *
 * `endedAt` is cleared rather than kept, because a match with an end time that
 * is still being played is a record nobody can read. The play already counted
 * stays counted.
 */
export function reopenTiming(t: Timing): Timing {
  if (!t.endedAt) return t;
  return { ...t, endedAt: null, running: true };
}

/** What the clock on screen should read, before this session's own delta. */
export const playedMs = (t: Timing): number => t.playingMs;
