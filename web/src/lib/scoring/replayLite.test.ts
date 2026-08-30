/* replayLite must agree with the server engine EXACTLY.
 *
 * Two copies of the scoring rules now exist — one server-only, one shipped to
 * the browser — because offline scoring needs the browser to derive the score
 * and the "hard to copy" design forbids shipping the real engine. That is a
 * deliberate trade (see the header of replayLite.ts), but it has an obvious
 * failure mode: the two drift and a referee's phone shows a different score to
 * the tournament table.
 *
 * So they are proven equivalent differentially over generated logs rather than
 * spot-checked. If you change one and not the other, this test says so.
 */

import { describe, it, expect } from "vitest";
import { replayRallies } from "./replay";
import { resolveRules, type Rules } from "./rules";
import { replayLite, supportsLite, liteOver, liteGolden, type LiteRules, type Side } from "./replayLite";

/** The server's Rules, narrowed to the plain data the client is sent. */
const toLite = (r: Rules): LiteRules => ({
  target: r.target,
  winBy: r.winBy,
  cap: r.cap,
  golden: r.golden,
  sideOut: r.sideOut,
  serve: r.serve as LiteRules["serve"],
  perCourt: r.perCourt,
});

/** Deterministic pseudo-random logs — a fixed seed so a failure is reproducible. */
function* logs(count: number, maxLen: number): Generator<Side[]> {
  let seed = 1234567;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let i = 0; i < count; i++) {
    const len = 1 + Math.floor(rand() * maxLen);
    const log: Side[] = [];
    for (let j = 0; j < len; j++) log.push(rand() < 0.5 ? "a" : "b");
    yield log;
  }
}

const SPORTS = ["pb", "bd", "tt"] as const;

describe("replayLite agrees with the server engine", () => {
  for (const sport of SPORTS) {
    const rules = resolveRules(sport, undefined as never);
    if (!rules) continue;
    const lite = toLite(rules);

    it(`${sport}: identical state over 400 generated logs`, () => {
      let checked = 0;
      for (const log of logs(400, 60)) {
        for (const server of ["a", "b"] as const) {
          for (const posA of [0, 1] as const) {
            const m = { log, server, posA, posB: 0 as const };
            const full = replayRallies(m, rules);
            const l = replayLite(m, lite);
            // compare every field the console renders
            expect({
              a: l.a, b: l.b, serving: l.serving, servePos: l.servePos,
              serverIdx: l.serverIdx, serverNum: l.serverNum, pos: l.pos,
              over: l.over, winner: l.winner, golden: l.golden, gamePoint: l.gamePoint,
              rallies: l.rallies,
            }).toEqual({
              a: full.a, b: full.b, serving: full.serving, servePos: full.servePos,
              serverIdx: full.serverIdx, serverNum: full.serverNum, pos: full.pos,
              over: full.over, winner: full.winner, golden: full.golden, gamePoint: full.gamePoint,
              rallies: full.rallies,
            });
            checked++;
          }
        }
      }
      expect(checked).toBeGreaterThan(1000);   // guard against a silently empty loop
    });

    it(`${sport}: agrees on an empty log`, () => {
      const m = { log: [] as Side[], server: "a" as const };
      expect(replayLite(m, lite)).toEqual(replayRallies(m, rules));
    });

    it(`${sport}: agrees rally-by-rally as a game is built up`, () => {
      // prefixes matter: this is exactly what the console shows mid-match
      const log: Side[] = [];
      for (let i = 0; i < 40; i++) {
        log.push(i % 3 === 0 ? "b" : "a");
        const m = { log: [...log], server: "a" as const };
        const full = replayRallies(m, rules);
        const l = replayLite(m, lite);
        expect([l.a, l.b, l.serving, l.servePos, l.over]).toEqual([
          full.a, full.b, full.serving, full.servePos, full.over,
        ]);
      }
    });
  }
});

describe("the boundary is explicit", () => {
  it("standard serve models are scored in the browser", () => {
    for (const sport of SPORTS) {
      const r = resolveRules(sport, undefined as never);
      expect(supportsLite(r ? toLite(r) : null, "standard")).toBe(true);
    }
  });

  it("OSL is NOT — its rotation is the part that stays on the server", () => {
    const r = resolveRules("pb", undefined as never)!;
    expect(supportsLite(toLite(r), "osl")).toBe(false);
  });

  it("a sport with no point engine is not scored in the browser", () => {
    expect(supportsLite(null, "standard")).toBe(false);
  });

  it("turn-based and set-based models are refused", () => {
    const base = toLite(resolveRules("pb", undefined as never)!);
    expect(supportsLite({ ...base, serve: "turns" }, "standard")).toBe(false);
    expect(supportsLite({ ...base, serve: "games" }, "standard")).toBe(false);
  });
});

describe("end conditions", () => {
  const r: LiteRules = { target: 15, winBy: 2, cap: 18, golden: 17, sideOut: false, serve: "rally", perCourt: 4 };

  it("win by 2 is enforced", () => {
    expect(liteOver(15, 14, r)).toBe(false);
    expect(liteOver(16, 14, r)).toBe(true);
  });

  it("the cap ends it regardless of margin", () => {
    expect(liteOver(18, 17, r)).toBe(true);
  });

  it("both sides on the golden score is the golden point", () => {
    expect(liteGolden(17, 17, r)).toBe(true);
    expect(liteGolden(16, 17, r)).toBe(false);
  });
});
