import { describe, it, expect } from "vitest";
import {
  emptyTiming, readTiming, startTiming, addElapsed, pauseTiming, resumeTiming,
  stopTiming, reopenTiming, fmtClock, fmtMinutes, type Timing,
} from "./timing";

/* Every function takes its elapsed delta as an argument, so a whole match can
 * be played out here with no clock at all — which is the point of the design as
 * well as what makes it testable. */

const started = (): Timing => startTiming(emptyTiming(), "2026-09-14T19:00:00.000Z");
const MIN = 60_000;

describe("starting", () => {
  it("does not run before the first point", () => {
    const t = emptyTiming();
    expect(t.running).toBe(false);
    expect(t.startedAt).toBeNull();
  });

  it("starts, and records a wall-clock time for ordering", () => {
    const t = started();
    expect(t.running).toBe(true);
    expect(t.startedAt).toBe("2026-09-14T19:00:00.000Z");
  });

  it("is idempotent, so an undo does not reset the clock", () => {
    const t = started();
    const again = startTiming(t, "2026-09-14T19:30:00.000Z");
    expect(again.startedAt).toBe("2026-09-14T19:00:00.000Z");
    expect(again).toBe(t);
  });

  it("counts nothing before it has started", () => {
    expect(addElapsed(emptyTiming(), 5 * MIN).playingMs).toBe(0);
  });
});

describe("accumulating", () => {
  it("adds play while running", () => {
    const t = addElapsed(addElapsed(started(), 30_000), 45_000);
    expect(t.playingMs).toBe(75_000);
    expect(t.pausedMs).toBe(0);
  });

  it("adds PAUSE while paused, without the caller choosing", () => {
    /* The bucket follows `running`, so a console that just reports "this much
       time passed" cannot put it in the wrong one. */
    let t = addElapsed(started(), 2 * MIN);
    t = pauseTiming(t, 0);
    t = addElapsed(t, 90_000);
    expect(t.playingMs).toBe(2 * MIN);
    expect(t.pausedMs).toBe(90_000);
  });

  it("ignores a negative delta, which can only be a broken clock", () => {
    const t = addElapsed(started(), -5000);
    expect(t.playingMs).toBe(0);
  });

  it("ignores nonsense", () => {
    expect(addElapsed(started(), NaN).playingMs).toBe(0);
    expect(addElapsed(started(), Infinity).playingMs).toBe(0);
  });

  it("counts nothing once the match has ended", () => {
    const t = stopTiming(addElapsed(started(), MIN), 0, "2026-09-14T19:01:00.000Z");
    expect(addElapsed(t, 10 * MIN).playingMs).toBe(MIN);
  });
});

describe("pausing", () => {
  it("folds in the play up to the moment it is pressed", () => {
    const t = pauseTiming(started(), 3 * MIN, "injury");
    expect(t.playingMs).toBe(3 * MIN);
    expect(t.running).toBe(false);
    expect(t.pauseReason).toBe("injury");
    expect(t.pauseCount).toBe(1);
  });

  it("counts each pause once", () => {
    let t = pauseTiming(started(), MIN);
    t = resumeTiming(t, 30_000);
    t = pauseTiming(t, MIN);
    expect(t.pauseCount).toBe(2);
  });

  it("does nothing when already paused, so a double tap cannot double-count", () => {
    const once = pauseTiming(started(), MIN);
    const twice = pauseTiming(once, MIN);
    expect(twice).toBe(once);
    expect(twice.pauseCount).toBe(1);
  });

  it("does nothing before the match has started", () => {
    expect(pauseTiming(emptyTiming(), MIN).pauseCount).toBe(0);
  });

  it("resumes, folding the pause into paused time and clearing the reason", () => {
    let t = pauseTiming(started(), 2 * MIN, "weather");
    t = resumeTiming(t, 5 * MIN);
    expect(t.playingMs).toBe(2 * MIN);
    expect(t.pausedMs).toBe(5 * MIN);
    expect(t.running).toBe(true);
    expect(t.pauseReason).toBeNull();
  });

  it("does nothing when resuming something already running", () => {
    const t = started();
    expect(resumeTiming(t, MIN)).toBe(t);
  });
});

describe("playing time excludes pauses — the spec's one formula", () => {
  it("holds across a realistic match", () => {
    /* 10 minutes, a 4-minute injury break, then 8 more. */
    let t = started();
    t = pauseTiming(t, 10 * MIN, "injury");
    t = resumeTiming(t, 4 * MIN);
    t = stopTiming(t, 8 * MIN, "2026-09-14T19:22:00.000Z");

    expect(t.playingMs).toBe(18 * MIN);
    expect(t.pausedMs).toBe(4 * MIN);
    expect(t.pauseCount).toBe(1);

    /* totalElapsed − pausedTime === playingTime. */
    const total = t.playingMs + t.pausedMs;
    expect(total - t.pausedMs).toBe(t.playingMs);
  });
});

describe("stopping", () => {
  it("folds in the last play and stamps the end", () => {
    const t = stopTiming(addElapsed(started(), 5 * MIN), 30_000, "2026-09-14T19:05:30.000Z");
    expect(t.playingMs).toBe(5 * MIN + 30_000);
    expect(t.endedAt).toBe("2026-09-14T19:05:30.000Z");
    expect(t.running).toBe(false);
  });

  it("keeps a pause that was running when the match ended", () => {
    /* The pause was real time in the hall; only playingMs claims to be play. */
    let t = pauseTiming(started(), 6 * MIN, "weather");
    t = stopTiming(t, 3 * MIN, "2026-09-14T19:09:00.000Z");
    expect(t.playingMs).toBe(6 * MIN);
    expect(t.pausedMs).toBe(3 * MIN);
  });

  it("does nothing twice", () => {
    const once = stopTiming(addElapsed(started(), MIN), 0, "2026-09-14T19:01:00.000Z");
    expect(stopTiming(once, 5 * MIN, "2026-09-14T19:06:00.000Z")).toBe(once);
  });

  it("does nothing on a match that never started", () => {
    expect(stopTiming(emptyTiming(), MIN, "2026-09-14T19:01:00.000Z").endedAt).toBeNull();
  });
});

describe("undoing past the winning point", () => {
  it("reopens the match rather than leaving an end time on a live one", () => {
    let t = stopTiming(addElapsed(started(), 10 * MIN), 0, "2026-09-14T19:10:00.000Z");
    t = reopenTiming(t);
    expect(t.endedAt).toBeNull();
    expect(t.running).toBe(true);
    /* What was played is still played. */
    expect(t.playingMs).toBe(10 * MIN);
  });

  it("counts again after reopening", () => {
    let t = stopTiming(addElapsed(started(), 10 * MIN), 0, "2026-09-14T19:10:00.000Z");
    t = addElapsed(reopenTiming(t), 2 * MIN);
    expect(t.playingMs).toBe(12 * MIN);
  });

  it("does nothing to a match that is still live", () => {
    const t = started();
    expect(reopenTiming(t)).toBe(t);
  });
});

describe("reading a stored record", () => {
  it("survives anything that is not a timing record", () => {
    for (const junk of [null, undefined, 0, "", [], "nope"]) {
      expect(readTiming(junk)).toEqual(emptyTiming());
    }
  });

  it("drops a negative or non-numeric duration rather than trusting it", () => {
    const t = readTiming({ startedAt: "x", playingMs: -5, pausedMs: "60000", pauseCount: 2 });
    expect(t.playingMs).toBe(0);
    expect(t.pausedMs).toBe(0);
    expect(t.pauseCount).toBe(2);
  });

  it("round-trips a real one through JSON, as the database will", () => {
    let t = pauseTiming(started(), 7 * MIN, "timeout");
    t = resumeTiming(t, MIN);
    expect(readTiming(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  it("stores no raw performance.now() reading", () => {
    /* The legacy record keeps `mono`, a number from ONE page load. Persisting
       that is what this design exists to avoid. */
    const t = resumeTiming(pauseTiming(started(), MIN), MIN);
    expect(Object.keys(t).sort()).toEqual([
      "endedAt", "pauseCount", "pauseReason", "pausedMs", "playingMs", "running", "startedAt",
    ]);
  });
});

describe("display", () => {
  it("reads as minutes and seconds", () => {
    expect(fmtClock(0)).toBe("0:00");
    expect(fmtClock(65_000)).toBe("1:05");
    expect(fmtClock(12 * MIN + 5_000)).toBe("12:05");
    expect(fmtClock(90 * MIN)).toBe("90:00");
  });

  it("never shows a negative clock", () => {
    expect(fmtClock(-5000)).toBe("0:00");
  });

  it("rounds to whole minutes for the summary", () => {
    expect(fmtMinutes(19 * MIN + 29_000)).toBe("19 min");
    expect(fmtMinutes(19 * MIN + 31_000)).toBe("20 min");
  });
});
