/* The match clock's CLIENT-SAFE half — the vocabulary and the formatting.
 *
 * The arithmetic that maintains the stored record lives in `timing.ts` and
 * stays on the server. What has to ship is smaller and duller: the shape of the
 * record so a console can render it, the list of pause reasons so a referee can
 * pick one, and "12:05". None of that is worth protecting, and a clock that
 * cannot tick in the browser is not a clock.
 *
 * The split is the point. `timing.ts` keeps `import "server-only"`, so the
 * moment a component reaches for the record arithmetic instead of this, the
 * BUILD fails rather than the algorithm quietly shipping.
 */

export type PauseReason = "timeout" | "injury" | "weather" | "other";

export const PAUSE_REASONS: { id: PauseReason; label: string }[] = [
  { id: "timeout", label: "Timeout" },
  { id: "injury", label: "Injury" },
  { id: "weather", label: "Weather" },
  { id: "other", label: "Other" },
];

/** The stored record, as the console reads it. */
export type TimingView = {
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

/**
 * One device's report of time that passed, ALREADY SPLIT into buckets.
 *
 * The device is the only thing that knows whether the referee had the clock
 * paused during the milliseconds it measured. The server's `running` flag is a
 * copy of that knowledge and is stale for any device that paused with no
 * signal — so the split is made where the pause was, not where the record is.
 *
 * `pause` carries the device's pause state AFTER this tick; `undefined` means
 * it did not change. That is why `null` and `undefined` are different here and
 * the distinction is load-bearing: `null` means "resume", missing means
 * "leave it alone".
 */
export type Tick = {
  playMs: number;
  pausedMs: number;
  pause?: PauseReason | null;
};

export const EMPTY_TICK: Tick = { playMs: 0, pausedMs: 0 };

/** Nothing measured and nothing changed — not worth a write of its own. */
export const tickIsEmpty = (t: Tick): boolean =>
  t.playMs <= 0 && t.pausedMs <= 0 && t.pause === undefined;

/** "12:05". Minutes and seconds, which is how a match is talked about. */
export function fmtClock(ms: number): string {
  const total = Math.floor(Math.max(0, ms) / 1000);
  const m = Math.floor(total / 60);
  return `${m}:${String(total % 60).padStart(2, "0")}`;
}

/** "24 min", for the post-event summary the spec describes. */
export const fmtMinutes = (ms: number): string => `${Math.round(Math.max(0, ms) / 60000)} min`;
