"use client";

/* The measuring end of the match clock.
 *
 * ── Why the measurement has to be here and nowhere else ───────────────────
 * The spec is explicit: device-monotonic elapsed time, never the difference
 * between two wall-clock stamps, because an offline device whose clock corrects
 * on reconnect produces silently wrong durations. So the only clock read in the
 * whole feature is `performance.now()`, and only ever as a DIFFERENCE between
 * two readings in the same page load. What crosses the wire is that difference
 * in milliseconds — never the reading itself, which would mean nothing on the
 * server or after a reload.
 *
 * ── Why this hook also owns the pause ─────────────────────────────────────
 * Because the pause decides which bucket the milliseconds belong in, and this
 * is the only place that knows both. A referee who pauses for an injury in a
 * hall with no signal has a phone that knows the clock is stopped and a stored
 * record that still says it is running. Sending one number and letting the
 * server route it would bill that injury break as play. So the split is made
 * here, at the pause, and `Tick` carries both halves.
 *
 * The pause therefore never fails: it takes effect on the device the instant it
 * is tapped, and the record catches up with the next write that lands. A pause
 * button that throws during an injury would be worse than no pause button.
 *
 * ── Why the displayed clock is a maximum ──────────────────────────────────
 * `stored + what this device has measured since` is wrong for a moment after
 * every successful write: the milliseconds move from "measured here" to "in the
 * record", and the re-rendered record arrives a beat later. Taking the larger
 * of the two means the number on screen only ever goes up, which is the one
 * thing a clock has to do.
 *
 * ── What it never does ────────────────────────────────────────────────────
 * It does not decide the score, the rules or when the match is over. It is
 * handed `live` and reports milliseconds.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { type PauseReason, type Tick, type TimingView } from "@/lib/scoring/clock";

export type MatchClock = {
  /** Play time to show, in ms. Never goes backwards. */
  displayMs: number;
  paused: boolean;
  reason: PauseReason | null;
  /** The clock is running: the match has begun, is not over, and is not paused. */
  ticking: boolean;
  /** Take everything measured since the last claim, for one write. */
  claim: () => Tick;
  /** Put a claim back when its write did not land. */
  restore: (t: Tick) => void;
  /** Pause with a reason, or resume with null. Applies here immediately. */
  setPaused: (reason: PauseReason | null) => void;
};

/* Module level, taking the ref, because it reads a clock: inside the component
   body React's purity rule cannot tell that it is only ever called from an
   event handler or an interval. */
function sinceMark(mark: { current: number | null }): number {
  const now = performance.now();
  const since = mark.current == null ? 0 : now - mark.current;
  mark.current = now;
  /* Nothing is counted before the first reading of this session: there is no
     earlier moment to measure from. The hour ceiling catches a device suspended
     mid-match that woke with a huge gap. */
  return Number.isFinite(since) && since > 0 && since < 3_600_000 ? Math.round(since) : 0;
}

export type UseMatchClockArgs = {
  /** The stored record, as the server last rendered it. */
  timing: TimingView | null;
  /** True once the match has begun and until it is won. */
  live: boolean;
};

export function useMatchClock({ timing, live }: UseMatchClockArgs): MatchClock {
  const storedMs = timing?.playingMs ?? 0;
  const storedPaused = !!timing?.startedAt && !timing.endedAt && !timing.running;

  /* The record as it stood when this console opened. Everything this device
     measures is added to it, and `Math.max` against the live stored value
     settles the two — see the note at the top. */
  const [baseMs] = useState(storedMs);
  const [measuredMs, setMeasuredMs] = useState(0);

  /* Null until this device's referee touches the pause, and then it wins.
     Deriving the pause in render rather than mirroring the record into state
     keeps the clock out of the cascading-render trap, and matches who is
     actually in charge: the phone in the referee's hand, not a record that may
     be a write behind. */
  const [override, setOverride] = useState<{ reason: PauseReason | null } | null>(null);
  const paused = override ? override.reason !== null : storedPaused;
  const reason = override ? override.reason : (timing?.pauseReason ?? null);

  const mark = useRef<number | null>(null);
  /* Measured but not yet accepted by the server, split at the moment it was
     measured. Separate from the pause flag so a failed write can put its share
     back rather than lose it. */
  const pending = useRef({ playMs: 0, pausedMs: 0 });
  /* A pause change waiting to travel. `undefined` is "nothing to say", which is
     why it is not simply `PauseReason | null`. */
  const pauseChange = useRef<PauseReason | null | undefined>(undefined);
  /* What `gather` needs when it runs from a timer, kept current from an effect
     rather than written during render. */
  const flags = useRef({ live, paused });
  useEffect(() => {
    flags.current = { live, paused };
  }, [live, paused]);

  /** Move the time since the last reading into the bucket it belongs in, and
   *  report how much of it was play. */
  const gather = useCallback((): number => {
    const d = sinceMark(mark);
    /* The mark advances even when the match is not live, so the minutes a
       console spends open before the first point — or after the last one — are
       discarded rather than banked and charged to the next rally. */
    if (!flags.current.live || d === 0) return 0;
    if (flags.current.paused) {
      pending.current.pausedMs += d;
      return 0;
    }
    pending.current.playMs += d;
    return d;
  }, []);

  /* One beat a second while the match is live. It keeps the clock on screen
     moving and, just as importantly, keeps paused time accumulating without the
     referee having to touch anything. */
  useEffect(() => {
    if (!live) return;
    /* Start measuring from now: whatever the console was doing before the first
       point is not part of the match. */
    mark.current = performance.now();
    const h = window.setInterval(() => {
      const played = gather();
      if (played > 0) setMeasuredMs((m) => m + played);
    }, 1000);
    return () => {
      /* The last fraction of a second before the match ended is still play. */
      gather();
      window.clearInterval(h);
    };
  }, [live, gather]);

  const claim = useCallback((): Tick => {
    const played = gather();
    if (played > 0) setMeasuredMs((m) => m + played);
    const out: Tick = { playMs: pending.current.playMs, pausedMs: pending.current.pausedMs };
    if (pauseChange.current !== undefined) out.pause = pauseChange.current;
    pending.current = { playMs: 0, pausedMs: 0 };
    pauseChange.current = undefined;
    return out;
  }, [gather]);

  const restore = useCallback((t: Tick) => {
    pending.current.playMs += t.playMs;
    pending.current.pausedMs += t.pausedMs;
    /* Only if nothing newer is waiting: the referee may have tapped Resume
       while the failed write was still on the wire, and putting the old pause
       back would undo it. */
    if (t.pause !== undefined && pauseChange.current === undefined) pauseChange.current = t.pause;
  }, []);

  const setPaused = useCallback(
    (next: PauseReason | null) => {
      /* Fold what has passed BEFORE flipping, or the play before an injury
         break is filed as part of the break. */
      const played = gather();
      if (played > 0) setMeasuredMs((m) => m + played);
      /* Written here as well as mirrored from the effect: a pause is followed
         immediately by a write, and that write must not measure the next
         milliseconds into the bucket the referee has just left. */
      flags.current = { ...flags.current, paused: next != null };
      pauseChange.current = next;
      setOverride({ reason: next });
    },
    [gather],
  );

  return {
    displayMs: Math.max(storedMs, baseMs + measuredMs),
    paused,
    reason,
    ticking: live && !paused,
    claim,
    restore,
    setPaused,
  };
}
