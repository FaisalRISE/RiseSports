import { describe, it, expect } from "vitest";
import { calcRtgChange, calcExp, getTier, TIERS, MAX_DELTA, type Phase } from "./index";

/** The legacy formula, kept verbatim so the regression it caused stays visible. */
const legacyCalc = (m: number, c: number, e: number, d: number, p = "group", gW = 12, gL = 12) => {
  const K = 32;
  const r = calcExp(m, c), l = e + d;
  const marg = l > 0 ? Math.max(0, (e - d) / l) : 0, mov = Math.sqrt(marg);
  const n = 1 + 0.6 * mov, R = 1 - 0.35 * (1 - marg);
  const S = p === "final" ? 1.5 : p === "semi" ? 1.3 : p === "quarter" ? 1.15 : 1;
  const rel = (g: number) => (g < 10 ? 1.6 : g < 30 ? 1.2 : 1);
  return {
    wG: Math.max(1, Math.round(Math.min(60, K * (1 - r) * n * S * rel(gW)))),
    lL: Math.max(1, Math.round(Math.min(60, K * r * R * S * rel(gL)))),
  };
};

const PHASES: Phase[] = ["group", "quarter", "semi", "final"];

describe("conservation — the bug this port exists to fix", () => {
  it("winner's gain always equals loser's loss", () => {
    for (const wr of [400, 800, 1000, 1200, 1600, 2000]) {
      for (const lr of [400, 800, 1000, 1200, 1600, 2000]) {
        for (const [sw, sl] of [[11, 0], [11, 9], [15, 13], [21, 19], [25, 3]]) {
          for (const phase of PHASES) {
            for (const games of [0, 5, 15, 40]) {
              const { wG, lL } = calcRtgChange(wr, lr, sw, sl, { phase, winnerGames: games, loserGames: 40 - games });
              expect(wG).toBe(lL);
            }
          }
        }
      }
    }
  });

  it("a long season of random matches leaves the pool total unchanged", () => {
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const players = Array.from({ length: 16 }, () => 1000);
    const startTotal = players.reduce((s, v) => s + v, 0);

    for (let i = 0; i < 5000; i++) {
      const a = Math.floor(rand() * 16);
      let b = Math.floor(rand() * 16);
      if (b === a) b = (b + 1) % 16;
      const sw = 11, sl = Math.floor(rand() * 11);
      const { wG, lL } = calcRtgChange(players[a], players[b], sw, sl, {
        phase: PHASES[Math.floor(rand() * 4)],
        winnerGames: Math.floor(rand() * 50),
        loserGames: Math.floor(rand() * 50),
      });
      players[a] += wG;
      players[b] -= lL;
    }
    expect(players.reduce((s, v) => s + v, 0)).toBe(startTotal);
  });

  it("the legacy formula demonstrably did NOT conserve", () => {
    // evenly matched, comfortable win: winner gained more than the loser lost
    const even = legacyCalc(1000, 1000, 11, 5);
    expect(even.wG).toBeGreaterThan(even.lL);

    // heavy favourite wins: loser was punished far harder than the winner gained
    const favourite = legacyCalc(1600, 1000, 11, 5);
    expect(favourite.lL).toBeGreaterThan(favourite.wG);

    // the fixed engine does neither
    expect(calcRtgChange(1000, 1000, 11, 5).wG).toBe(calcRtgChange(1000, 1000, 11, 5).lL);
    expect(calcRtgChange(1600, 1000, 11, 5).wG).toBe(calcRtgChange(1600, 1000, 11, 5).lL);
  });
});

describe("rating behaviour", () => {
  it("beating a stronger opponent is worth more than beating a weaker one", () => {
    const upset = calcRtgChange(1000, 1600, 11, 9).wG;
    const expectedWin = calcRtgChange(1600, 1000, 11, 9).wG;
    expect(upset).toBeGreaterThan(expectedWin);
  });

  it("a bigger margin moves the rating more", () => {
    const narrow = calcRtgChange(1000, 1000, 11, 9).wG;
    const blowout = calcRtgChange(1000, 1000, 11, 0).wG;
    expect(blowout).toBeGreaterThan(narrow);
  });

  it("knockout matches count for more than group games", () => {
    const group = calcRtgChange(1000, 1000, 11, 5, { phase: "group" }).wG;
    const final = calcRtgChange(1000, 1000, 11, 5, { phase: "final" }).wG;
    expect(final).toBeGreaterThan(group);
  });

  it("provisional players move faster than settled ones", () => {
    const settled = calcRtgChange(1000, 1000, 11, 5, { winnerGames: 50, loserGames: 50 }).wG;
    const provisional = calcRtgChange(1000, 1000, 11, 5, { winnerGames: 2, loserGames: 2 }).wG;
    expect(provisional).toBeGreaterThan(settled);
  });

  it("never returns zero or an unbounded swing", () => {
    const tiny = calcRtgChange(3000, 100, 11, 10, { phase: "group", winnerGames: 99, loserGames: 99 });
    expect(tiny.wG).toBeGreaterThanOrEqual(1);
    const huge = calcRtgChange(100, 3000, 11, 0, { phase: "final", winnerGames: 0, loserGames: 0 });
    expect(huge.wG).toBeLessThanOrEqual(MAX_DELTA);
  });

  it("a 0-0 scoreline does not divide by zero", () => {
    expect(Number.isFinite(calcRtgChange(1000, 1000, 0, 0).wG)).toBe(true);
  });
});

describe("expectation and tiers", () => {
  it("equal ratings expect an even match", () => {
    expect(calcExp(1000, 1000)).toBeCloseTo(0.5, 10);
  });

  it("400 points of advantage is roughly a 10-to-1 expectation", () => {
    expect(calcExp(1400, 1000)).toBeCloseTo(10 / 11, 6);
  });

  it("tiers cover the whole range with no gaps", () => {
    for (let i = 0; i < TIERS.length - 1; i++) {
      expect(TIERS[i + 1].min).toBe(TIERS[i].max + 1);
    }
    expect(getTier(0).name).toBe("Beginner");
    expect(getTier(9999).name).toBe("Pro+");
    expect(getTier(-5).name).toBe("Beginner");   // out of range falls back, never undefined
  });
});
