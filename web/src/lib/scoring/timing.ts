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
 * ordering and never subtracted. Every function here takes the elapsed delta as
 * an argument rather than reading a clock, so:
 *
 *   - the only thing that ever becomes a duration is a delta measured by
 *     `performance.now()` on one device within one page session, which is
 *     exactly what the spec asks for;
 *   - these functions are pure, so the arithmetic is testable without a clock;
 *   - nothing that crosses the wire can be misinterpreted later.
 *
 * The delta rides along with the rally write that was happening anyway (see
 * `commitLog`), so a reload loses at most the time since the last point — and
 * costs no extra round trips.
 *
 * Server timestamps were the other candidate and are wrong here: a match
 * scored offline would have its start stamped at reconnect.
 */

export type PauseReason = "timeout" | "injury" | "weather" | "other";

export type Timing = {
  /** ISO wall clock. For ORDERING only — never subtract it from anything. */
  startedAt: string | null;
  endedAt: string | null;
  /** Accumulated play, from monotonic deltas. */
  playingMs: number;
  /** Accumulated pause, likewise. */
  pausedMs: number;
  pauseCount: number;
  pauseReason: PauseReason | null;
  /** True while the clock is counting play rather than pause. */
  running: boolean;
};

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
 * Fold in time measured since the last write.
 *
 * Which bucket it lands in follows `running`, so a paused match accrues paused
 * time and a running one accrues play — the caller does not choose.
 */
export function addElapsed(t: Timing, elapsedMs: number): Timing {
  const d = delta(elapsedMs);
  if (!t.startedAt || t.endedAt || d === 0) return t;
  return t.running
    ? { ...t, playingMs: t.playingMs + d }
    : { ...t, pausedMs: t.pausedMs + d };
}

/** Pause, folding in the play measured up to this moment. */
export function pauseTiming(t: Timing, elapsedMs: number, reason: PauseReason = "other"): Timing {
  if (!t.startedAt || t.endedAt || !t.running) return t;
  const folded = addElapsed(t, elapsedMs);
  return { ...folded, running: false, pauseReason: reason, pauseCount: folded.pauseCount + 1 };
}

/** Resume, folding in the pause measured up to this moment. */
export function resumeTiming(t: Timing, elapsedMs: number): Timing {
  if (!t.startedAt || t.endedAt || t.running) return t;
  const folded = addElapsed(t, elapsedMs);
  return { ...folded, running: true, pauseReason: null };
}

/**
 * Stop on the point that wins the match.
 *
 * A match stopped while paused keeps its pause in `pausedMs` — the pause was
 * real time in the hall, and only `playingMs` claims to be play.
 */
export function stopTiming(t: Timing, elapsedMs: number, atISO: string): Timing {
  if (!t.startedAt || t.endedAt) return t;
  const folded = addElapsed(t, elapsedMs);
  return { ...folded, endedAt: atISO, running: false, pauseReason: null };
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

/** "12:05". Minutes and seconds, which is how a match is talked about. */
export function fmtClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

/** "24 min", for the post-event summary the spec describes. */
export const fmtMinutes = (ms: number): string => `${Math.round(Math.max(0, ms) / 60000)} min`;

export const PAUSE_REASONS: { id: PauseReason; label: string }[] = [
  { id: "timeout", label: "Timeout" },
  { id: "injury", label: "Injury" },
  { id: "weather", label: "Weather" },
  { id: "other", label: "Other" },
];
