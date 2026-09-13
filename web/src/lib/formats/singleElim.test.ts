import { describe, it, expect } from "vitest";
import { singleElimMatches, thirdPlaceMatch, roundLabel } from "./singleElim";
import type { Entrant } from "@/lib/brackets";

/* The properties that matter for a knockout an organiser has to run on the day:
 * every match is reachable, nobody is asked to play a fixture that does not
 * exist, and a seed reference always points at a round that is really there. */

const teams = (n: number): Entrant[] =>
  Array.from({ length: n }, (_, i) => ({ id: `t${i + 1}`, name: `Team ${i + 1}`, strength: 1000 - i * 10 }));

/** Every reference a bracket makes must name a round the bracket contains. */
const danglingRefs = (ms: ReturnType<typeof singleElimMatches>) => {
  const rounds = new Set((ms ?? []).map((m) => m.round));
  const refs = (ms ?? []).flatMap((m) => [m.slotA, m.slotB]).filter((s): s is string => !!s);
  return refs.map((r) => r.slice(2)).filter((r) => !rounds.has(r));
};

describe("roundLabel", () => {
  it("names a round from how many matches are in it", () => {
    expect(roundLabel(1, 0)).toBe("Final");
    expect(roundLabel(2, 0)).toBe("Semi-Final 1");
    expect(roundLabel(4, 3)).toBe("Quarter-Final 4");
    expect(roundLabel(8, 0)).toBe("Round of 16 1");
    expect(roundLabel(16, 15)).toBe("Round of 32 16");
  });
});

describe("singleElimMatches", () => {
  it("refuses to draw a bracket for fewer than two teams", () => {
    expect(singleElimMatches(teams(0))).toBeNull();
    expect(singleElimMatches(teams(1))).toBeNull();
  });

  it("draws a two-team bracket as a single final", () => {
    const ms = singleElimMatches(teams(2))!;
    expect(ms).toHaveLength(1);
    expect(ms[0].round).toBe("Final");
    expect([ms[0].teamAId, ms[0].teamBId].sort()).toEqual(["t1", "t2"]);
  });

  it("draws a full eight-team bracket: 4 + 2 + 1", () => {
    const ms = singleElimMatches(teams(8))!;
    expect(ms).toHaveLength(7);
    expect(ms.filter((m) => m.round.startsWith("Quarter-Final"))).toHaveLength(4);
    expect(ms.filter((m) => m.round.startsWith("Semi-Final"))).toHaveLength(2);
    expect(ms.filter((m) => m.round === "Final")).toHaveLength(1);
  });

  it("gives the first round real teams and later rounds references", () => {
    const ms = singleElimMatches(teams(8))!;
    for (const m of ms.filter((x) => x.round.startsWith("Quarter-Final"))) {
      expect(m.teamAId).toBeTruthy();
      expect(m.teamBId).toBeTruthy();
      expect(m.slotA).toBeNull();
    }
    const final = ms.find((m) => m.round === "Final")!;
    expect(final.teamAId).toBeNull();
    expect(final.slotA).toBe("W:Semi-Final 1");
    expect(final.slotB).toBe("W:Semi-Final 2");
  });

  /* The whole point of seeding: the two best teams cannot knock each other out
     early. Quarter-finals 1 and 2 feed Semi-Final 1, quarter-finals 3 and 4 feed
     Semi-Final 2 — so the top two must sit in different halves. */
  it("puts the top two seeds in opposite halves, so they can only meet in the final", () => {
    const ms = singleElimMatches(teams(8))!;
    const qf = ms.filter((m) => m.round.startsWith("Quarter-Final"));
    const halfOf = (id: string) => {
      const i = qf.findIndex((m) => m.teamAId === id || m.teamBId === id);
      expect(i, `${id} was not drawn into a quarter-final`).toBeGreaterThanOrEqual(0);
      return Math.floor(i / 2);
    };
    expect(halfOf("t1")).not.toBe(halfOf("t2"));
  });

  /* And the strongest should meet the weakest first, not another contender. */
  it("draws the top seed against the bottom seed in the first round", () => {
    const ms = singleElimMatches(teams(8))!;
    const top = ms.find((m) => m.teamAId === "t1" || m.teamBId === "t1")!;
    expect([top.teamAId, top.teamBId]).toContain("t8");
  });

  /* A bye is not a match. Creating a row for one puts a fixture nobody can play
     on the order of play, and the organiser has to work out why. */
  it("creates no match for a bye, and advances that team into the next round", () => {
    const ms = singleElimMatches(teams(5))!;
    /* Five teams in an eight slot bracket: one real quarter-final, three byes. */
    const qf = ms.filter((m) => m.round.startsWith("Quarter-Final"));
    expect(qf).toHaveLength(1);

    /* The three teams that had a bye appear in the semi-finals as real teams,
       not as references waiting on a match that was never created. */
    const semis = ms.filter((m) => m.round.startsWith("Semi-Final"));
    const realSides = semis.flatMap((m) => [m.teamAId, m.teamBId]).filter(Boolean);
    expect(realSides).toHaveLength(3);
  });

  it("never leaves a reference pointing at a round that does not exist", () => {
    for (const n of [2, 3, 4, 5, 6, 7, 8, 9, 12, 16, 17, 31, 32]) {
      const ms = singleElimMatches(teams(n));
      expect(danglingRefs(ms), `${n} teams`).toEqual([]);
    }
  });

  it("always ends in exactly one final, whatever the entry count", () => {
    for (const n of [2, 3, 5, 6, 7, 9, 11, 16, 23, 32]) {
      const ms = singleElimMatches(teams(n))!;
      expect(ms.filter((m) => m.round === "Final"), `${n} teams`).toHaveLength(1);
    }
  });

  it("gives every team exactly one first appearance", () => {
    for (const n of [2, 3, 5, 8, 11, 16]) {
      const ms = singleElimMatches(teams(n))!;
      const placed = ms.flatMap((m) => [m.teamAId, m.teamBId]).filter((x): x is string => !!x);
      expect(new Set(placed).size, `${n} teams`).toBe(n);
      expect(placed.length, `${n} teams — nobody drawn twice`).toBe(n);
    }
  });
});

describe("thirdPlaceMatch", () => {
  it("pairs the two losing semi-finalists", () => {
    const ms = singleElimMatches(teams(8))!;
    const third = thirdPlaceMatch(ms)!;
    expect(third.round).toBe("Third Place");
    expect(third.slotA).toBe("L:Semi-Final 1");
    expect(third.slotB).toBe("L:Semi-Final 2");
  });

  it("offers nothing when there are no semi-finals to lose", () => {
    expect(thirdPlaceMatch(singleElimMatches(teams(2))!)).toBeNull();
  });
});
