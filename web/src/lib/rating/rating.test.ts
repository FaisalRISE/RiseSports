import { describe, it, expect } from "vitest";
import {
  calcRtgChange,
  calcExp,
  getTier,
  marginMultiplier,
  phaseMultiplier,
  verificationWeight,
  provisionalMultiplier,
  seedFromDupr,
  TIERS,
  MAX_DELTA,
  type Phase,
} from "./index";

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

const PHASES: Phase[] = ["social", "group", "quarter", "semi", "final"];

/* ────────────────────────────────────────────────────────────────────────
   The spec's own acceptance table. These are hand-computed in
   `rise-rating-spec 4.md` §11 and are the reason the constants changed:
   the previous reconstruction returned 25 / 4 / 35 / 47 for these.
   ──────────────────────────────────────────────────────────────────────── */
describe("spec §11 — the numbers the spec says must come out", () => {
  it("1: 1000 v 1000, wins 11–7 → +16 / −16", () => {
    const r = calcRtgChange(1000, 1000, 11, 7);
    expect([r.wG, r.lL]).toEqual([16, 16]);
  });

  it("2: 1200 beats 800, 11–4 → +3 / −3", () => {
    const r = calcRtgChange(1200, 800, 11, 4);
    expect([r.wG, r.lL]).toEqual([3, 3]);
  });

  it("3: 800 beats 1200, 11–9 (upset) → +26 / −26", () => {
    const r = calcRtgChange(800, 1200, 11, 9);
    expect([r.wG, r.lL]).toEqual([26, 26]);
  });

  it("4: 800 beats 1200, 11–0 (blowout upset) → +36 / −36", () => {
    const r = calcRtgChange(800, 1200, 11, 0);
    expect([r.wG, r.lL]).toEqual([36, 36]);
  });

  it("5: best of 3 (11–7, 9–11, 11–6), equal ratings → +15 / −15", () => {
    // §4.2: points are summed across ALL games in the match, not per game
    const r = calcRtgChange(1000, 1000, 11 + 9 + 11, 7 + 11 + 6);
    expect([r.wG, r.lL]).toEqual([15, 15]);
  });

  it("6: provisional 750 (3 matches) beats settled 1000, 11–8 → +39 / −25, ledger +14", () => {
    const r = calcRtgChange(750, 1000, 11, 8, { winnerGames: 3, loserGames: 40 });
    expect([r.wG, r.lL, r.imbalance]).toEqual([39, 25, 14]);
  });

  it("7: self-reported social play is a fraction of tournament value", () => {
    const full = calcRtgChange(1000, 1000, 11, 5);
    const casual = calcRtgChange(1000, 1000, 11, 5, { phase: "social", verification: "self" });
    // §4.3 × §4.4 = 0.8 × 0.30. NOTE §11 case 7's own arithmetic says "× 0.5",
    // which contradicts §4.4's table; the table is normative, so 0.24 it is.
    expect(casual.delta / full.delta).toBeCloseTo(0.8 * 0.3, 1);
  });

  // case 8 (repeat opponents × 0.6) is §8 anti-gaming and needs match history,
  // so it is not implemented in this pure per-match function.
});

describe("conservation — the bug this port exists to fix", () => {
  it("both sides move by the same amount when neither is provisional", () => {
    for (const wr of [400, 800, 1000, 1200, 1600, 2000]) {
      for (const lr of [400, 800, 1000, 1200, 1600, 2000]) {
        for (const [sw, sl] of [[11, 0], [11, 9], [15, 13], [21, 19], [25, 3]]) {
          for (const phase of PHASES) {
            const r = calcRtgChange(wr, lr, sw, sl, { phase, winnerGames: 40, loserGames: 40 });
            expect(r.wG).toBe(r.lL);
            expect(r.imbalance).toBe(0);
          }
        }
      }
    }
  });

  it("a long season leaves the pool unchanged NET OF THE LEDGER", () => {
    /* §5 deliberately breaks strict conservation for provisional players so
       they converge quickly, and requires the imbalance to be logged. The
       invariant is therefore pool-minus-ledger, not pool alone — asserting the
       stronger version would force the provisional boost back out. */
    let seed = 7;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const players = Array.from({ length: 16 }, () => 1000);
    const games = Array.from({ length: 16 }, () => 0);
    const startTotal = players.reduce((s, v) => s + v, 0);
    let ledger = 0;

    for (let i = 0; i < 5000; i++) {
      const a = Math.floor(rand() * 16);
      let b = Math.floor(rand() * 16);
      if (b === a) b = (b + 1) % 16;
      const r = calcRtgChange(players[a], players[b], 11, Math.floor(rand() * 11), {
        phase: PHASES[Math.floor(rand() * PHASES.length)],
        winnerGames: games[a],
        loserGames: games[b],
      });
      players[a] += r.wG;
      players[b] -= r.lL;
      games[a]++; games[b]++;
      ledger += r.imbalance;
    }
    expect(players.reduce((s, v) => s + v, 0) - ledger).toBe(startTotal);
  });

  it("once everyone is settled the pool total is exactly invariant", () => {
    let seed = 11;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    const players = Array.from({ length: 12 }, () => 1000);
    const start = players.reduce((s, v) => s + v, 0);
    for (let i = 0; i < 3000; i++) {
      const a = Math.floor(rand() * 12);
      let b = Math.floor(rand() * 12);
      if (b === a) b = (b + 1) % 12;
      const r = calcRtgChange(players[a], players[b], 11, Math.floor(rand() * 11), {
        winnerGames: 99, loserGames: 99,
      });
      players[a] += r.wG;
      players[b] -= r.lL;
    }
    expect(players.reduce((s, v) => s + v, 0)).toBe(start);
  });

  it("the legacy formula demonstrably did NOT conserve", () => {
    const even = legacyCalc(1000, 1000, 11, 5);
    expect(even.wG).toBeGreaterThan(even.lL);          // minted rating
    const favourite = legacyCalc(1600, 1000, 11, 5);
    expect(favourite.lL).toBeGreaterThan(favourite.wG); // destroyed rating
    const fixed = calcRtgChange(1600, 1000, 11, 5, { winnerGames: 40, loserGames: 40 });
    expect(fixed.wG).toBe(fixed.lL);
  });
});

describe("the multipliers", () => {
  it("margin is centred on 1, not floored at it", () => {
    // the reconstruction's bug: a floored multiplier means a bigger margin
    // always adds rating to the pool
    expect(marginMultiplier(11, 11)).toBeCloseTo(0.75, 6);
    expect(marginMultiplier(11, 0)).toBeCloseTo(1.25, 6);
    const even = marginMultiplier(11, 7);
    expect(even).toBeGreaterThan(0.9);
    expect(even).toBeLessThan(1.1);
  });

  it("margin stays inside [0.75, 1.25] for any scoreline", () => {
    for (const [a, b] of [[0, 0], [1, 0], [99, 0], [11, 11], [25, 24]]) {
      const m = marginMultiplier(a, b);
      expect(m).toBeGreaterThanOrEqual(0.75);
      expect(m).toBeLessThanOrEqual(1.25);
    }
  });

  it("stage multipliers match §4.3", () => {
    expect(PHASES.map(phaseMultiplier)).toEqual([0.8, 1, 1.15, 1.3, 1.5]);
  });

  it("verification weights match §4.4", () => {
    expect(verificationWeight("organiser")).toBe(1);
    expect(verificationWeight("certified")).toBe(0.85);
    expect(verificationWeight("confirmed")).toBe(0.6);
    expect(verificationWeight("self")).toBe(0.3);
  });

  it("verification is orthogonal to stage — a self-reported final is 1.5 × 0.3", () => {
    const organiserFinal = calcRtgChange(1000, 1000, 11, 5, { phase: "final" });
    const selfFinal = calcRtgChange(1000, 1000, 11, 5, { phase: "final", verification: "self" });
    expect(selfFinal.delta / organiserFinal.delta).toBeCloseTo(0.3, 1);
  });

  it("provisional bands match §5", () => {
    expect([provisionalMultiplier(0), provisionalMultiplier(9)]).toEqual([1.6, 1.6]);
    expect([provisionalMultiplier(10), provisionalMultiplier(29)]).toEqual([1.2, 1.2]);
    expect([provisionalMultiplier(30), provisionalMultiplier(99)]).toEqual([1, 1]);
  });

  it("an unknown match count is treated as settled, not provisional", () => {
    // a caller that does not track match counts must not silently get the boost
    const r = calcRtgChange(1000, 1000, 11, 5);
    expect(r.imbalance).toBe(0);
  });
});

describe("rating behaviour", () => {
  it("beating a stronger opponent is worth more than beating a weaker one", () => {
    expect(calcRtgChange(1000, 1600, 11, 9).wG).toBeGreaterThan(calcRtgChange(1600, 1000, 11, 9).wG);
  });

  it("a bigger margin moves the rating more", () => {
    expect(calcRtgChange(1000, 1000, 11, 0).wG).toBeGreaterThan(calcRtgChange(1000, 1000, 11, 9).wG);
  });

  it("knockout matches count for more than group games, and social for less", () => {
    const social = calcRtgChange(1000, 1000, 11, 5, { phase: "social" }).wG;
    const group = calcRtgChange(1000, 1000, 11, 5, { phase: "group" }).wG;
    const final = calcRtgChange(1000, 1000, 11, 5, { phase: "final" }).wG;
    expect(social).toBeLessThan(group);
    expect(final).toBeGreaterThan(group);
  });

  it("provisional players move faster than settled ones", () => {
    const settled = calcRtgChange(1000, 1000, 11, 5, { winnerGames: 50, loserGames: 50 }).wG;
    const provisional = calcRtgChange(1000, 1000, 11, 5, { winnerGames: 2, loserGames: 50 }).wG;
    expect(provisional).toBeGreaterThan(settled);
  });

  it("the shared delta never leaves [1, 40]", () => {
    const tiny = calcRtgChange(3000, 100, 11, 10, { phase: "social", verification: "self" });
    expect(tiny.delta).toBeGreaterThanOrEqual(1);
    const huge = calcRtgChange(100, 3000, 11, 0, { phase: "final" });
    expect(huge.delta).toBeLessThanOrEqual(MAX_DELTA);
  });

  it("a 0-0 scoreline does not divide by zero", () => {
    expect(Number.isFinite(calcRtgChange(1000, 1000, 0, 0).wG)).toBe(true);
  });
});

describe("expectation, seeding and tiers", () => {
  it("equal ratings expect an even match", () => {
    expect(calcExp(1000, 1000)).toBeCloseTo(0.5, 10);
  });

  it("400 points of advantage is roughly a 10-to-1 expectation", () => {
    expect(calcExp(1400, 1000)).toBeCloseTo(10 / 11, 6);
  });

  it("DUPR seeds match §3", () => {
    expect([seedFromDupr(3.0), seedFromDupr(4.5), seedFromDupr(6.0)]).toEqual([750, 1125, 1500]);
  });

  it("tiers cover the whole range with no gaps, from the §8 floor of 100", () => {
    expect(TIERS[0].min).toBe(100);
    for (let i = 0; i < TIERS.length - 1; i++) {
      expect(TIERS[i + 1].min).toBe(TIERS[i].max + 1);
    }
    expect(getTier(100).name).toBe("Beginner");
    expect(getTier(9999).name).toBe("Pro+");
    expect(getTier(-5).name).toBe("Beginner");   // out of range falls back, never undefined
  });
});
