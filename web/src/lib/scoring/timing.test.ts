import { describe, it, expect } from "vitest";
import {
  emptyTiming, readTiming, startTiming, addMeasured, applyTick, pauseTiming, resumeTiming,
  stopTiming, reopenTiming, fmtClock, fmtMinutes, tickIsEmpty, type Timing,
} from "./timing";

/* Nothing here reads a clock — the device's measurement arrives as an argument
 * — so a whole match can be played out in this file. That is the point of the
 * design as well as what makes it testable. */

const started = (): Timing => startTiming(emptyTiming(), "2026-09-14T19:00:00.000Z");
const MIN = 60_000;
const play = (ms: number) => ({ playMs: ms, pausedMs: 0 });
const rest = (ms: number) => ({ playMs: 0, pausedMs: ms });

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
    expect(addMeasured(emptyTiming(), 5 * MIN, 0).playingMs).toBe(0);
  });
});

describe("accumulating", () => {
  it("adds play", () => {
    const t = addMeasured(addMeasured(started(), 30_000, 0), 45_000, 0);
    expect(t.playingMs).toBe(75_000);
    expect(t.pausedMs).toBe(0);
  });

  it("adds both buckets from one report", () => {
    const t = addMeasured(started(), 30_000, 5_000);
    expect(t.playingMs).toBe(30_000);
    expect(t.pausedMs).toBe(5_000);
  });

  it("files paused time as paused EVEN WHILE THE RECORD SAYS RUNNING", () => {
    /* The case this design exists for: a referee pauses for an injury with no
       signal. Their phone knows the clock is stopped; the stored record still
       says running, because the pause never reached it. Routing by the record
       would bill that injury break as play. The device splits, the record obeys. */
    const t = applyTick(started(), { playMs: 0, pausedMs: 4 * MIN });
    expect(t.running).toBe(true);
    expect(t.playingMs).toBe(0);
    expect(t.pausedMs).toBe(4 * MIN);
  });

  it("ignores a negative delta, which can only be a broken clock", () => {
    expect(addMeasured(started(), -5000, -5000)).toEqual(started());
  });

  it("ignores nonsense", () => {
    expect(addMeasured(started(), NaN, 0).playingMs).toBe(0);
    expect(addMeasured(started(), Infinity, 0).playingMs).toBe(0);
  });

  it("counts nothing once the match has ended", () => {
    const t = stopTiming(addMeasured(started(), MIN, 0), "2026-09-14T19:01:00.000Z");
    expect(addMeasured(t, 10 * MIN, 0).playingMs).toBe(MIN);
  });
});

describe("pausing", () => {
  it("folds in the play up to the moment it is pressed, then stops", () => {
    const t = applyTick(started(), { ...play(3 * MIN), pause: "injury" });
    expect(t.playingMs).toBe(3 * MIN);
    expect(t.running).toBe(false);
    expect(t.pauseReason).toBe("injury");
    expect(t.pauseCount).toBe(1);
  });

  it("folds BEFORE it flips — the ordering a caller cannot get wrong", () => {
    /* Two correct calls in the wrong order give the same numbers a different,
       wrong home: the three minutes played before the injury become paused
       time. applyTick is one call precisely so that cannot be written. */
    const wrongWayRound = addMeasured(pauseTiming(started(), "injury"), 3 * MIN, 0);
    expect(wrongWayRound.playingMs).toBe(3 * MIN);
    expect(applyTick(started(), { ...play(3 * MIN), pause: "injury" }).pausedMs).toBe(0);
  });

  it("counts each pause once", () => {
    let t = applyTick(started(), { ...play(MIN), pause: "timeout" });
    t = applyTick(t, { ...rest(30_000), pause: null });
    t = applyTick(t, { ...play(MIN), pause: "timeout" });
    expect(t.pauseCount).toBe(2);
  });

  it("does nothing when already paused, so a double tap cannot double-count", () => {
    const once = pauseTiming(started(), "other");
    const twice = pauseTiming(once, "other");
    expect(twice).toBe(once);
    expect(twice.pauseCount).toBe(1);
  });

  it("does nothing before the match has started", () => {
    expect(pauseTiming(emptyTiming()).pauseCount).toBe(0);
  });

  it("relabels a pause already under way without counting a second one", () => {
    /* The referee paused for a timeout and then reached for Injury. That is one
       break with a better name on it, and the console would otherwise show a
       reason the record disagreed with. */
    let t = applyTick(started(), { ...play(MIN), pause: "timeout" });
    t = applyTick(t, { ...rest(30_000), pause: "injury" });
    expect(t.pauseReason).toBe("injury");
    expect(t.pauseCount).toBe(1);
    expect(t.running).toBe(false);
    expect(t.pausedMs).toBe(30_000);
  });

  it("resumes, folding the pause into paused time and clearing the reason", () => {
    let t = applyTick(started(), { ...play(2 * MIN), pause: "weather" });
    t = applyTick(t, { ...rest(5 * MIN), pause: null });
    expect(t.playingMs).toBe(2 * MIN);
    expect(t.pausedMs).toBe(5 * MIN);
    expect(t.running).toBe(true);
    expect(t.pauseReason).toBeNull();
  });

  it("does nothing when resuming something already running", () => {
    const t = started();
    expect(resumeTiming(t)).toBe(t);
  });

  it("leaves the pause state alone when the tick does not mention it", () => {
    /* undefined means "I only measured time"; null means "resume". The two are
       different on purpose, and a rally tick sends neither flag. */
    const paused = applyTick(started(), { ...play(MIN), pause: "injury" });
    const later = applyTick(paused, rest(MIN));
    expect(later.running).toBe(false);
    expect(later.pauseReason).toBe("injury");
    expect(later.pauseCount).toBe(1);
  });

  it("knows a tick with nothing in it", () => {
    expect(tickIsEmpty({ playMs: 0, pausedMs: 0 })).toBe(true);
    expect(tickIsEmpty({ playMs: 0, pausedMs: 0, pause: null })).toBe(false);
    expect(tickIsEmpty({ playMs: 1, pausedMs: 0 })).toBe(false);
  });
});

describe("playing time excludes pauses — the spec's one formula", () => {
  it("holds across a realistic match", () => {
    /* 10 minutes, a 4-minute injury break, then 8 more. */
    let t = started();
    t = applyTick(t, { ...play(10 * MIN), pause: "injury" });
    t = applyTick(t, { ...rest(4 * MIN), pause: null });
    t = applyTick(t, play(8 * MIN));
    t = stopTiming(t, "2026-09-14T19:22:00.000Z");

    expect(t.playingMs).toBe(18 * MIN);
    expect(t.pausedMs).toBe(4 * MIN);
    expect(t.pauseCount).toBe(1);

    /* totalElapsed − pausedTime === playingTime. */
    const total = t.playingMs + t.pausedMs;
    expect(total - t.pausedMs).toBe(t.playingMs);
  });
});

describe("stopping", () => {
  it("stamps the end without counting anything more", () => {
    const t = stopTiming(addMeasured(started(), 5 * MIN + 30_000, 0), "2026-09-14T19:05:30.000Z");
    expect(t.playingMs).toBe(5 * MIN + 30_000);
    expect(t.endedAt).toBe("2026-09-14T19:05:30.000Z");
    expect(t.running).toBe(false);
  });

  it("keeps a pause that was running when the match ended", () => {
    /* The pause was real time in the hall; only playingMs claims to be play. */
    let t = applyTick(started(), { ...play(6 * MIN), pause: "weather" });
    t = applyTick(t, rest(3 * MIN));
    t = stopTiming(t, "2026-09-14T19:09:00.000Z");
    expect(t.playingMs).toBe(6 * MIN);
    expect(t.pausedMs).toBe(3 * MIN);
  });

  it("does nothing twice", () => {
    const once = stopTiming(addMeasured(started(), MIN, 0), "2026-09-14T19:01:00.000Z");
    expect(stopTiming(once, "2026-09-14T19:06:00.000Z")).toBe(once);
  });

  it("does nothing on a match that never started", () => {
    expect(stopTiming(emptyTiming(), "2026-09-14T19:01:00.000Z").endedAt).toBeNull();
  });
});

describe("undoing past the winning point", () => {
  it("reopens the match rather than leaving an end time on a live one", () => {
    let t = stopTiming(addMeasured(started(), 10 * MIN, 0), "2026-09-14T19:10:00.000Z");
    t = reopenTiming(t);
    expect(t.endedAt).toBeNull();
    expect(t.running).toBe(true);
    /* What was played is still played. */
    expect(t.playingMs).toBe(10 * MIN);
  });

  it("counts again after reopening", () => {
    let t = stopTiming(addMeasured(started(), 10 * MIN, 0), "2026-09-14T19:10:00.000Z");
    t = addMeasured(reopenTiming(t), 2 * MIN, 0);
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
    let t = applyTick(started(), { ...play(7 * MIN), pause: "timeout" });
    t = applyTick(t, { ...rest(MIN), pause: null });
    expect(readTiming(JSON.parse(JSON.stringify(t)))).toEqual(t);
  });

  it("stores no raw performance.now() reading", () => {
    /* The legacy record keeps `mono`, a number from ONE page load. Persisting
       that is what this design exists to avoid. */
    const t = applyTick(applyTick(started(), { ...play(MIN), pause: "other" }), { ...rest(MIN), pause: null });
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
