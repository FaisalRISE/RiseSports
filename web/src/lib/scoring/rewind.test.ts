import { describe, it, expect } from "vitest";
import { rewindIndex } from "./rewind";
import { replayLite, type LiteRules, type Side } from "./replayLite";

/* Driven through the real scorer rather than hand-fed numbers: the whole point
 * of the search is that it agrees with whatever engine is handed to it. */

const RALLY: LiteRules = {
  target: 11, winBy: 2, cap: null, golden: null, sideOut: false, serve: "rally", perCourt: 4,
};
const SIDEOUT: LiteRules = { ...RALLY, sideOut: true, serve: "sideout" };

const scorer = (log: Side[], rules: LiteRules, side: Side) => (n: number) =>
  replayLite({ log: log.slice(0, n), server: "a", posA: 0, posB: 0 }, rules)[side];

const scoreOf = (log: Side[], rules: LiteRules, side: Side) =>
  replayLite({ log, server: "a", posA: 0, posB: 0 }, rules)[side];

describe("rewinding one point", () => {
  it("refuses when the side has no points", () => {
    const log: Side[] = ["a", "a"];
    expect(rewindIndex(log.length, scorer(log, RALLY, "b"))).toBeNull();
    expect(rewindIndex(0, scorer([], RALLY, "a"))).toBeNull();
  });

  it("under rally scoring, drops exactly the rally that scored it", () => {
    /* Every rally is a point, so this is the same as an undo when the side in
       question won the last one. */
    const log: Side[] = ["a", "b", "a", "a"];
    expect(rewindIndex(log.length, scorer(log, RALLY, "a"))).toBe(3);
    expect(rewindIndex(log.length, scorer(log, RALLY, "b"))).toBe(1);
  });

  it("under side-out, rewinds PAST the side-outs that followed", () => {
    /* a serves and scores twice, then loses the rally (a side-out, no point),
       then b loses it back (another side-out, still no point). Taking a point
       off a has to discard those two rallies as well — they only make sense
       after the point that preceded them. */
    const log: Side[] = ["a", "a", "b", "a"];
    expect(scoreOf(log, SIDEOUT, "a")).toBe(2);
    expect(scoreOf(log, SIDEOUT, "b")).toBe(0);

    const cut = rewindIndex(log.length, scorer(log, SIDEOUT, "a"));
    expect(cut).toBe(1);
    expect(scoreOf(log.slice(0, cut!), SIDEOUT, "a")).toBe(1);
  });

  it("always leaves that side exactly one point worse off", () => {
    /* The property the referee actually relies on, checked across a spread of
       logs in both serve models. */
    for (const rules of [RALLY, SIDEOUT]) {
      for (let seed = 1; seed <= 40; seed++) {
        const log: Side[] = [];
        let x = seed;
        for (let i = 0; i < 25; i++) {
          x = (x * 1103515245 + 12345) & 0x7fffffff;
          log.push(x % 2 === 0 ? "a" : "b");
        }
        for (const side of ["a", "b"] as Side[]) {
          const before = scoreOf(log, rules, side);
          const cut = rewindIndex(log.length, scorer(log, rules, side));
          if (before === 0) {
            expect(cut).toBeNull();
            continue;
          }
          expect(scoreOf(log.slice(0, cut!), rules, side)).toBe(before - 1);
        }
      }
    }
  });

  it("never lengthens the log", () => {
    const log: Side[] = ["a", "a", "a"];
    const cut = rewindIndex(log.length, scorer(log, RALLY, "a"));
    expect(cut).toBeLessThan(log.length);
    expect(cut).toBeGreaterThanOrEqual(0);
  });
});
