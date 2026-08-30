import { describe, it, expect } from "vitest";
import { resolveRules } from "@/lib/scoring/rules";
import { replayRallies, type Side } from "@/lib/scoring/replay";
import {
  oslRuleOverrides, oslPairIndex, oslGateReached, oslPendingRotation, oslPruneAcks,
  oslPairSlots, oslLineupIssues, oslChampionship, oslPointsFor, oslPlaceByRecord,
  OSL_MAX_POINTS, OSL_SPORTS, PAIR_LABELS,
  type LineupPlayer, type SportRanking,
} from "./osl";

const rules = (sport: "pb" | "bd" | "tt") => resolveRules(sport, oslRuleOverrides())!;
const M = (id: string, gender: "M" | "F" = "M"): LineupPlayer => ({ id, name: id, gender });
const F = (id: string) => M(id, "F");

describe("OSL match rules (3.2, 3.3, 5.6)", () => {
  it("is rally scored to 25 with a golden point at 24 and ends changing at 14", () => {
    const r = rules("pb");
    expect(r.target).toBe(25);
    expect(r.winBy).toBe(1);
    expect(r.golden).toBe(24);
    expect(r.sideOut).toBe(false); // 3.2 — every rally is a point, whoever served
    expect(r.switchAt).toBe(14);
  });

  it("first to 25 wins outright — no win-by-2", () => {
    const r = rules("pb");
    const log: Side[] = [];
    for (let i = 0; i < 25; i++) log.push("a");
    for (let i = 0; i < 24; i++) log.splice(1, 0, "b"); // interleave to 25-24
    const s = replayRallies({ log, server: "a" }, r);
    expect([s.a, s.b]).toEqual([25, 24]);
    expect(s.over).toBe(true);
    expect(s.winner).toBe("a");
  });

  it("golden point is flagged at 24-24", () => {
    const r = rules("pb");
    const log: Side[] = [];
    for (let i = 0; i < 24; i++) log.push("a", "b");
    const s = replayRallies({ log, server: "a" }, r);
    expect([s.a, s.b]).toEqual([24, 24]);
    expect(s.golden).toBe(true);
    expect(s.over).toBe(false);
  });

  it("table tennis keeps its own serve rule (7.1) inside the OSL format", () => {
    expect(rules("tt").serve).toBe("alt2");
    expect(rules("pb").serve).toBe("sideout"); // model, overridden to rally scoring by sideOut:false
  });
});

describe("three-pair rotation (3.2)", () => {
  it("rotates on the LEADING score at 7 and 14, never resetting the score", () => {
    expect(oslPairIndex(0)).toBe(0);
    expect(oslPairIndex(6)).toBe(0);
    expect(oslPairIndex(7)).toBe(1);
    expect(oslPairIndex(13)).toBe(1);
    expect(oslPairIndex(14)).toBe(2);
    expect(oslPairIndex(24)).toBe(2);
  });

  it("maps pairs to the declared six in order: A=0,1 B=2,3 C=4,5", () => {
    expect(oslPairSlots(0)).toEqual([0, 1]);
    expect(oslPairSlots(1)).toEqual([2, 3]);
    expect(oslPairSlots(2)).toEqual([4, 5]);
  });

  it("blocks scoring at each gate until the referee confirms", () => {
    expect(oslPendingRotation(6, [])).toBe(0);
    expect(oslPendingRotation(7, [])).toBe(7);
    expect(oslPendingRotation(7, [7])).toBe(0);
    expect(oslPendingRotation(14, [7])).toBe(14);
    expect(oslPendingRotation(14, [7, 14])).toBe(0);
  });

  it("never blocks a finished match", () => {
    expect(oslPendingRotation(25, [], true)).toBe(0);
  });

  it("undoing back below a gate re-arms that confirmation", () => {
    expect(oslPruneAcks(6, [7])).toEqual([]);
    expect(oslPruneAcks(13, [7, 14])).toEqual([7]);
    expect(oslPruneAcks(20, [7, 14])).toEqual([7, 14]);
  });

  it("gate 14 is the ends change too, so it is confirmed once (5.6)", () => {
    expect(oslGateReached(14)).toBe(14);
    expect(rules("pb").switchAt).toBe(oslGateReached(14));
  });
});

describe("line-up legality (3.1, 3.2)", () => {
  it("accepts five men and a woman in a mixed pair", () => {
    expect(oslLineupIssues([M("m1"), M("m2"), M("m3"), M("m4"), M("m5"), F("w1")])).toEqual([]);
  });

  it("rejects six men — a woman must be in the playing six", () => {
    const issues = oslLineupIssues([M("m1"), M("m2"), M("m3"), M("m4"), M("m5"), M("m6")]);
    expect(issues).toContain("At least one woman must be in the playing six");
  });

  it("rejects two women paired together, naming the pair", () => {
    const issues = oslLineupIssues([F("w1"), F("w2"), M("m1"), M("m2"), M("m3"), M("m4")]);
    expect(issues.some((i) => i.startsWith(PAIR_LABELS[0]))).toBe(true);
  });

  it("accepts two women when they are in different mixed pairs", () => {
    expect(oslLineupIssues([F("w1"), M("m1"), M("m2"), F("w2"), M("m3"), M("m4")])).toEqual([]);
  });

  it("catches a duplicate and an incomplete six", () => {
    expect(oslLineupIssues([M("m1"), M("m1"), M("m2"), M("m3"), M("m4"), F("w1")]))
      .toContain("A player is listed twice");
    expect(oslLineupIssues([M("m1"), null, null, null, null, null])).toEqual(["Pick all six players"]);
  });
});

describe("championship points (2.3, 2.5)", () => {
  it("uses the racket table for PB/BD/TT and the board table for CR/CH", () => {
    expect(oslPointsFor("pb", 1)).toBe(1000);
    expect(oslPointsFor("pb", 8)).toBe(300);
    expect(oslPointsFor("cr", 1)).toBe(800);
    expect(oslPointsFor("ch", 8)).toBe(100);
    expect(oslPointsFor("pb", 9)).toBe(0);
  });

  it("topping all five sports is worth 4,600", () => {
    expect(OSL_MAX_POINTS).toBe(4600);
  });

  it("every rank scores — even last place earns points", () => {
    for (const sport of OSL_SPORTS) {
      for (let rank = 1; rank <= 8; rank++) expect(oslPointsFor(sport, rank)).toBeGreaterThan(0);
    }
  });

  it("ranks teams by total, then most firsts, then most seconds", () => {
    const teams = ["t1", "t2", "t3"];
    const order = (first: string, second: string, third: string) => [first, second, third, "x", "x2", "x3", "x4", "x5"];
    const rankings: SportRanking[] = [
      { sport: "pb", order: order("t1", "t2", "t3"), provisional: false },
      { sport: "bd", order: order("t2", "t1", "t3"), provisional: false },
      { sport: "tt", order: order("t1", "t2", "t3"), provisional: false },
      { sport: "cr", order: order("t2", "t1", "t3"), provisional: false },
      { sport: "ch", order: order("t2", "t1", "t3"), provisional: false },
    ];
    const { rows, provisional } = oslChampionship(teams, rankings);
    expect(provisional).toBe(false);
    // t2 has three firsts to t1's two
    expect(rows[0].teamId).toBe("t2");
    expect(rows[0].firsts).toBe(3);
    expect(rows[1].teamId).toBe("t1");
    expect(rows[2].teamId).toBe("t3");
  });

  it("breaks an exact tie on most firsts, not arbitrarily", () => {
    const rankings: SportRanking[] = OSL_SPORTS.map((sport, i) => ({
      sport,
      // t1 wins the first three sports, t2 the last two, otherwise mirrored
      order: i < 3 ? ["t1", "t2"] : ["t2", "t1"],
      provisional: false,
    }));
    const { rows } = oslChampionship(["t1", "t2"], rankings);
    expect(rows[0].firsts).toBeGreaterThanOrEqual(rows[1].firsts);
  });

  it("marks the board provisional while any sport is unfinished", () => {
    const rankings: SportRanking[] = [{ sport: "pb", order: ["t1", "t2"], provisional: true }];
    expect(oslChampionship(["t1", "t2"], rankings).provisional).toBe(true);
  });

  it("is deterministic when everything ties — seed order, never random", () => {
    const rankings: SportRanking[] = [];
    const a = oslChampionship(["t1", "t2", "t3"], rankings, ["t3", "t2", "t1"]);
    const b = oslChampionship(["t1", "t2", "t3"], rankings, ["t3", "t2", "t1"]);
    expect(a.rows.map((r) => r.teamId)).toEqual(b.rows.map((r) => r.teamId));
    expect(a.rows[0].teamId).toBe("t3");
  });
});

describe("5th-8th placement (2.7)", () => {
  it("orders on wins, then point difference, then points scored", () => {
    const order = oslPlaceByRecord([
      { teamId: "lowDiff", wins: 2, pointsFor: 100, pointsAgainst: 90 },
      { teamId: "moreWins", wins: 3, pointsFor: 50, pointsAgainst: 49 },
      { teamId: "highDiff", wins: 2, pointsFor: 100, pointsAgainst: 50 },
    ]);
    expect(order).toEqual(["moreWins", "highDiff", "lowDiff"]);
  });

  it("falls back to seed order rather than drawing lots at random", () => {
    const tied = [
      { teamId: "b", wins: 1, pointsFor: 10, pointsAgainst: 10 },
      { teamId: "a", wins: 1, pointsFor: 10, pointsAgainst: 10 },
    ];
    expect(oslPlaceByRecord(tied, ["a", "b"])).toEqual(["a", "b"]);
    expect(oslPlaceByRecord(tied, ["a", "b"])).toEqual(oslPlaceByRecord(tied, ["a", "b"]));
  });
});
