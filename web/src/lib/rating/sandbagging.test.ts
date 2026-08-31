import { describe, it, expect } from "vitest";
import { detectSandbagging, performanceRating, WINDOW, MARGIN, type RatedMatch } from "./sandbagging";

/* Spec §8.1. This flag exists to protect a DRAW: a player rated well below the
 * level they play at ruins the seeding, whether they are hiding or simply
 * improving faster than the rating catches up. */

const at = (i: number) => new Date(2026, 0, 1 + i);

/** `n` matches against opponents of `opp`, winning `wins` of them. */
const run = (n: number, opp: number, wins: number, from = 0): RatedMatch[] =>
  Array.from({ length: n }, (_, i) => ({
    avgOpponentRating: opp,
    won: i < wins,
    playedAt: at(from + i),
  }));

describe("performanceRating", () => {
  it("is the opponent level when you win half", () => {
    expect(performanceRating(1000, 0.5)).toBe(1000);
  });

  it("rises above the opposition when you beat them more often", () => {
    expect(performanceRating(1000, 1)).toBe(1200);
    expect(performanceRating(1000, 0.75)).toBe(1100);
  });

  it("falls below when you lose more often", () => {
    expect(performanceRating(1000, 0)).toBe(800);
  });
});

describe("detectSandbagging", () => {
  /* Two full windows of beating much stronger opponents. Performance is 1200
     against a rating of 700 — nobody rated 700 does that twice. */
  it("flags a player winning well above their rating across two windows", () => {
    const history = [...run(WINDOW, 1000, WINDOW, 0), ...run(WINDOW, 1000, WINDOW, WINDOW)];
    const s = detectSandbagging(history, 700);
    expect(s.underRated).toBe(true);
    expect(s.windows).toHaveLength(2);
    expect(s.gap).toBe(500);
  });

  /* "Across TWO CONSECUTIVE windows" — one hot night is not evidence, and
     flagging on a single window would catch half the club after a good draw. */
  it("does not flag one good window", () => {
    const history = [...run(WINDOW, 500, 5, 0), ...run(WINDOW, 1000, WINDOW, WINDOW)];
    expect(detectSandbagging(history, 700).underRated).toBe(false);
  });

  it("does not flag a player performing at their rating", () => {
    const history = [...run(WINDOW, 700, 5, 0), ...run(WINDOW, 700, 5, WINDOW)];
    expect(detectSandbagging(history, 700).underRated).toBe(false);
  });

  /* A partial window is ignored, not scaled: three wins from three is a 100%
     win rate and would clear any threshold, flagging everyone on match three. */
  it("ignores an incomplete window", () => {
    const s = detectSandbagging(run(3, 1200, 3), 700);
    expect(s.underRated).toBe(false);
    expect(s.windows).toEqual([]);
    expect(s.gap).toBeNull();
  });

  it("needs two windows, so a single complete window never flags", () => {
    const s = detectSandbagging(run(WINDOW, 1200, WINDOW), 700);
    expect(s.windows).toHaveLength(1);
    expect(s.underRated).toBe(false);
  });

  it("uses the LATEST two windows, so an old streak stops counting", () => {
    const history = [
      ...run(WINDOW, 1200, WINDOW, 0),        // long ago: dominant
      ...run(WINDOW, 1200, WINDOW, WINDOW),   // and again
      ...run(WINDOW, 700, 5, WINDOW * 2),     // since then: ordinary
    ];
    expect(detectSandbagging(history, 700).underRated).toBe(false);
  });

  it("respects the 150-point margin", () => {
    /* Performance exactly 100 above the rating is not enough. */
    const history = [...run(WINDOW, 800, 5, 0), ...run(WINDOW, 800, 5, WINDOW)];
    const s = detectSandbagging(history, 800 - 100);
    expect(s.windows.every((w) => w === 800)).toBe(true);
    expect(s.underRated).toBe(false);

    /* 200 above is. */
    expect(detectSandbagging(history, 800 - MARGIN - 50).underRated).toBe(true);
  });

  it("handles no history at all", () => {
    expect(detectSandbagging([], 700)).toEqual({ underRated: false, windows: [], gap: null });
  });

  /* The rule is one-directional: it finds people rated too LOW. Someone losing
     badly is not flagged — their rating is already falling on its own. */
  it("never flags an over-rated player", () => {
    const history = [...run(WINDOW, 500, 0, 0), ...run(WINDOW, 500, 0, WINDOW)];
    expect(detectSandbagging(history, 1200).underRated).toBe(false);
  });
});
