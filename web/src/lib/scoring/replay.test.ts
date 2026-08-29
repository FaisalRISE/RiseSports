import { describe, it, expect } from "vitest";
import { resolveRules, buildScoring } from "./rules";
import { replayRallies, rallyStats, rallyOver, rallyGolden, type Side, type MatchLike } from "./replay";
import { loadLegacy } from "./__fixtures__/legacy";
import { SPORT_IDS, sportOf, type SportId } from "@/lib/sports/registry";

const legacy = loadLegacy();

/** Deterministic PRNG so a failure is reproducible. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function randomLog(n: number, rand: () => number): Side[] {
  return Array.from({ length: n }, () => (rand() < 0.5 ? "a" : "b"));
}

const POINT_SPORTS = SPORT_IDS.filter((s) => sportOf(s).scoring !== null);

describe("resolveRules", () => {
  it("returns null for set-based sports and matches legacy for the rest", () => {
    expect(resolveRules("tn")).toBeNull();
    expect(resolveRules("pd")).toBeNull();
    for (const s of SPORT_IDS) {
      expect(resolveRules(s)).toEqual(legacy.resolveRules(s));
    }
  });

  it("defaults an unknown or missing sport to pickleball", () => {
    expect(resolveRules(undefined)?.sport).toBe("pb");
    expect(resolveRules("zz" as SportId)?.sport).toBe("pb");
  });

  it("honours overrides and treats empty string as absent", () => {
    expect(resolveRules("pb", { target: 15 })?.target).toBe(15);
    expect(resolveRules("pb", { target: "" })?.target).toBe(11);
    expect(resolveRules("pb", { sideOut: false })?.sideOut).toBe(false);
    // switchAt was silently dropped in an earlier version; pin it
    expect(resolveRules("pb", { switchAt: 6 })?.switchAt).toBe(6);
  });
});

describe("replayRallies matches the legacy engine", () => {
  for (const sport of POINT_SPORTS) {
    it(`${sport}: identical derived state across 400 random logs`, () => {
      const rules = resolveRules(sport)!;
      const legacyRules = legacy.resolveRules(sport);
      const rand = rng(0x5eed + sport.charCodeAt(0));
      for (let i = 0; i < 400; i++) {
        const m: MatchLike = {
          log: randomLog(1 + Math.floor(rand() * 60), rand),
          server: rand() < 0.5 ? "a" : "b",
          posA: rand() < 0.5 ? 0 : 1,
          posB: rand() < 0.5 ? 0 : 1,
        };
        expect(replayRallies(m, rules)).toEqual(legacy.replayRallies(m, legacyRules));
      }
    });
  }

  it("matches legacy under tournament overrides (win-by-2, cap, golden)", () => {
    const rand = rng(99);
    for (const [target, winBy2, golden] of [
      [15, true, "auto"], [11, false, ""], [21, true, "none"], [25, true, 24],
    ] as const) {
      const over = buildScoring(target, winBy2, golden, null, "");
      const rules = resolveRules("pb", over)!;
      const legacyRules = legacy.resolveRules("pb", over);
      for (let i = 0; i < 200; i++) {
        const m: MatchLike = { log: randomLog(1 + Math.floor(rand() * 70), rand), server: "a" };
        expect(replayRallies(m, rules)).toEqual(legacy.replayRallies(m, legacyRules));
      }
    }
  });
});

describe("rallyStats matches the legacy engine", () => {
  it("per-side and per-player splits are identical (O(n) rewrite is faithful)", () => {
    const rand = rng(4242);
    const teamPlayers = { a: ["a1", "a2"], b: ["b1", "b2"] };
    for (const sport of POINT_SPORTS) {
      const rules = resolveRules(sport)!;
      const legacyRules = legacy.resolveRules(sport);
      for (let i = 0; i < 120; i++) {
        const m: MatchLike = {
          log: randomLog(1 + Math.floor(rand() * 40), rand),
          server: rand() < 0.5 ? "a" : "b",
          posA: rand() < 0.5 ? 0 : 1,
        };
        expect(rallyStats(m, rules, teamPlayers)).toEqual(legacy.rallyStats(m, legacyRules, teamPlayers));
      }
    }
  });

  it("returns null without rules, like legacy", () => {
    expect(rallyStats({ log: ["a"] }, null)).toBeNull();
  });
});

describe("scoring rules behave as the rulebook says", () => {
  const pb = resolveRules("pb")!;

  it("side-out: only the serving side scores", () => {
    // a serves; b wins the first rally -> side-out, no points scored
    expect(replayRallies({ log: ["b"], server: "a" }, pb)).toMatchObject({ a: 0, b: 0, serving: "b" });
  });

  it("side-out: the opening service turn has one server", () => {
    // first fault hands serve straight over rather than to a second server
    const s = replayRallies({ log: ["b"], server: "a" }, pb);
    expect(s.serving).toBe("b");
    expect(s.serverNum).toBe(1);
  });

  it("badminton is rally scored — every rally is a point", () => {
    const bd = resolveRules("bd")!;
    const s = replayRallies({ log: ["a", "b", "b"], server: "a" }, bd);
    expect([s.a, s.b]).toEqual([1, 2]);
  });

  it("table tennis alternates serve every 2 points, then every point at deuce", () => {
    const tt = resolveRules("tt")!;
    const serveAfter = (n: number) =>
      replayRallies({ log: Array<Side>(n).fill("a"), server: "a" }, tt).serving;
    expect([serveAfter(0), serveAfter(1), serveAfter(2), serveAfter(3), serveAfter(4)])
      .toEqual(["a", "a", "b", "b", "a"]);
  });

  it("win-by-2 keeps a game alive past the target", () => {
    const r = resolveRules("bd")!; // to 21, win by 2, cap 30
    expect(rallyOver(21, 20, r)).toBe(false);
    expect(rallyOver(22, 20, r)).toBe(true);
    expect(rallyOver(30, 29, r)).toBe(true); // cap
  });

  it("golden point is flagged when both sides are level with the win-by spent", () => {
    const r = resolveRules("bd")!;
    expect(rallyGolden(29, 29, r)).toBe(true);
    expect(rallyGolden(28, 28, r)).toBe(false);
  });

  it("under side-out, game point is only shown to the side holding serve", () => {
    // 10-10 to 11: whoever serves is the only one who can convert
    const log: Side[] = [];
    let a = 0, b = 0, serving: Side = "a";
    // drive to 10-10 under side-out by alternating hold/side-out
    while (a < 10 || b < 10) {
      const s = replayRallies({ log, server: "a" }, pb);
      a = s.a; b = s.b; serving = s.serving;
      log.push(a < 10 ? serving : (serving === "a" ? "b" : "a"));
      if (log.length > 500) break;
    }
    const st = replayRallies({ log, server: "a" }, pb);
    if (st.a === 10 && st.b === 10) {
      expect(st.gamePoint).toEqual([st.serving]);
    }
  });

  it("an empty log is a legal 0-0 state, not a crash", () => {
    expect(replayRallies({ log: [] }, pb)).toMatchObject({ a: 0, b: 0, over: false, winner: null });
    expect(replayRallies({}, pb)).toMatchObject({ a: 0, b: 0 });
  });

  it("undo is just dropping the last entry", () => {
    const log: Side[] = ["a", "a", "b", "a", "b", "b"];
    const full = replayRallies({ log, server: "a" }, pb);
    const undone = replayRallies({ log: log.slice(0, -1), server: "a" }, pb);
    expect(undone).toEqual(replayRallies({ log: log.slice(0, 5), server: "a" }, pb));
    expect(full).not.toEqual(undone);
  });
});
