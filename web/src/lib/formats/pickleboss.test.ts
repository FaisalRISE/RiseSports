import { describe, it, expect } from "vitest";
import { roundRobin, spreadRounds, splitIntoGroups } from "./roundRobin";
import { picklebossRuleOverrides, planGroups, knockoutRefsFromGroups, PICKLEBOSS_TARGET } from "./pickleboss";
import { resolveRules } from "@/lib/scoring/rules";
import { replayRallies, type Side } from "@/lib/scoring/replay";
import { isSeedRef } from "@/lib/brackets";

describe("round robin", () => {
  it("every team plays every other exactly once", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8]) {
      const pairs = roundRobin(n).flat();
      expect(pairs).toHaveLength((n * (n - 1)) / 2);
      const seen = new Set(pairs.map(([a, b]) => [a, b].sort((x, y) => x - y).join("-")));
      expect(seen.size).toBe(pairs.length);
    }
  });

  it("nobody plays twice in the same round", () => {
    for (const n of [4, 5, 6, 7, 8]) {
      for (const round of roundRobin(n)) {
        const players = round.flat();
        expect(new Set(players).size).toBe(players.length);
      }
    }
  });

  it("an odd count sits one team out each round rather than inventing a ghost match", () => {
    const rounds = roundRobin(5);
    for (const round of rounds) {
      expect(round.length).toBe(2);            // 5 teams -> 2 matches, 1 resting
      expect(round.flat().every((i) => i < 5)).toBe(true);
    }
  });

  it("handles degenerate sizes", () => {
    expect(roundRobin(0)).toEqual([]);
    expect(roundRobin(1)).toEqual([]);
    expect(roundRobin(2)).toEqual([[[0, 1]]]);
  });
});

describe("spreadRounds", () => {
  it("keeps every fixture, only reorders", () => {
    const rounds = roundRobin(6);
    const before = rounds.flat().map((p) => p.join("-")).sort();
    const after = spreadRounds(rounds).flat().map((p) => p.join("-")).sort();
    expect(after).toEqual(before);
  });

  it("reduces how often a team plays in consecutive rounds", () => {
    const rounds = roundRobin(8);
    const backToBack = (rs: number[][][]) => {
      let n = 0;
      for (let i = 1; i < rs.length; i++) {
        const prev = new Set(rs[i - 1].flat());
        for (const p of new Set(rs[i].flat())) if (prev.has(p)) n++;
      }
      return n;
    };
    expect(backToBack(spreadRounds(rounds))).toBeLessThanOrEqual(backToBack(rounds));
  });
});

describe("group draw", () => {
  it("snakes the seeds so group A does not take every strong pair", () => {
    const seeds = [1, 2, 3, 4, 5, 6, 7, 8];
    const groups = splitIntoGroups(seeds, 2);
    expect(groups[0]).toContain(1);
    expect(groups[1]).toContain(2);          // second seed heads the other group
    expect(groups.flat().sort((a, b) => a - b)).toEqual(seeds);
  });

  it("splits as evenly as the count allows", () => {
    const g = splitIntoGroups([1, 2, 3, 4, 5], 2);
    expect(g.map((x) => x.length).sort()).toEqual([2, 3]);
  });
});

describe("Pickleboss scoring preset", () => {
  const rules = resolveRules("pb", picklebossRuleOverrides())!;

  it("is to 15, win by 2, golden at 17, cap 18", () => {
    expect(rules.target).toBe(PICKLEBOSS_TARGET);
    expect(rules.winBy).toBe(2);
    expect(rules.golden).toBe(17);
    expect(rules.cap).toBe(18);
  });

  it("is rally scored, not side-out", () => {
    expect(rules.sideOut).toBe(false);
  });

  it("15-14 is not a win, 16-14 is", () => {
    const to = (a: number, b: number): Side[] => {
      const log: Side[] = [];
      for (let i = 0; i < Math.max(a, b); i++) {
        if (i < a) log.push("a");
        if (i < b) log.push("b");
      }
      return log;
    };
    expect(replayRallies({ log: to(15, 14) }, rules).over).toBe(false);
    expect(replayRallies({ log: to(16, 14) }, rules).over).toBe(true);
  });

  it("the two-point rule stops at 17: 18-17 wins", () => {
    const log: Side[] = [];
    for (let i = 0; i < 17; i++) log.push("a", "b");   // 17-17
    const at1717 = replayRallies({ log }, rules);
    expect(at1717.over).toBe(false);
    expect(at1717.golden).toBe(true);                  // next rally decides it
    log.push("a");                                     // 18-17
    expect(replayRallies({ log }, rules).over).toBe(true);
  });
});

describe("group planning", () => {
  const entrants = Array.from({ length: 12 }, (_, i) => `p${i + 1}`);

  it("plans one court per group with fixtures ready", () => {
    const plans = planGroups(entrants, 3, ["Court One", "Court Two", "Court Three"]);
    expect(plans.map((p) => p.key)).toEqual(["A", "B", "C"]);
    expect(plans.map((p) => p.court)).toEqual(["Court One", "Court Two", "Court Three"]);
    for (const p of plans) {
      expect(p.entrants).toHaveLength(4);
      expect(p.rounds.flat()).toHaveLength(6);   // 4 teams -> 6 fixtures
    }
  });

  it("every entrant is drawn exactly once across the groups", () => {
    const plans = planGroups(entrants, 5);
    expect(plans.flatMap((p) => p.entrants).sort()).toEqual([...entrants].sort());
  });

  it("copes with no court names", () => {
    expect(planGroups(entrants, 2)[0].court).toBeNull();
  });
});

describe("knockout draw from group placings", () => {
  it("cross-pairs winners against other groups' runners-up", () => {
    const refs = knockoutRefsFromGroups(2);
    expect(refs).toEqual([["A1", "B2"], ["B1", "A2"]]);   // the OSL semi-final shape
  });

  it("never pairs a group winner with its own runner-up", () => {
    for (const n of [2, 3, 4, 6]) {
      for (const [a, b] of knockoutRefsFromGroups(n)) {
        expect(a[0]).not.toBe(b[0]);
      }
    }
  });

  it("emits valid seed references the bracket can resolve", () => {
    for (const [a, b] of knockoutRefsFromGroups(4)) {
      expect(isSeedRef(a)).toBe(true);
      expect(isSeedRef(b)).toBe(true);
    }
  });

  it("returns nothing when nobody qualifies", () => {
    expect(knockoutRefsFromGroups(4, 0)).toEqual([]);
  });
});
