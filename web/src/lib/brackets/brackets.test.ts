import { describe, it, expect } from "vitest";
import {
  seedOrder, seedBracket, buildLoserBracket, advanceDE, resolveRef, refLabel, isSeedRef,
  type Entrant, type Round, type BracketMatch,
} from "./index";

const team = (n: number): Entrant => ({ id: `t${n}`, name: `Team ${n}`, strength: 1000 - n });
const teams = (n: number) => Array.from({ length: n }, (_, i) => team(i + 1));

describe("seedOrder", () => {
  it("puts 1 against the bottom seed and keeps the top two apart", () => {
    expect(seedOrder(2)).toEqual([0, 1]);
    expect(seedOrder(4)).toEqual([0, 3, 1, 2]);
    expect(seedOrder(8)).toEqual([0, 7, 3, 4, 1, 6, 2, 5]);
  });

  it("is a permutation of every slot", () => {
    for (const n of [2, 4, 8, 16, 32]) {
      expect([...seedOrder(n)].sort((a, b) => a - b)).toEqual(Array.from({ length: n }, (_, i) => i));
    }
  });

  it("seeds 1 and 2 land in opposite halves, so they can only meet in the final", () => {
    for (const n of [4, 8, 16, 32]) {
      const ord = seedOrder(n);
      expect(ord.indexOf(0) < n / 2).toBe(true);
      expect(ord.indexOf(1) >= n / 2).toBe(true);
    }
  });
});

describe("seedBracket", () => {
  it("refuses a bracket of fewer than two", () => {
    expect(seedBracket([])).toBeNull();
    expect(seedBracket(teams(1))).toBeNull();
  });

  it("builds log2(n) rounds ending in a single final", () => {
    const r = seedBracket(teams(8))!;
    expect(r.map((x) => x.length)).toEqual([4, 2, 1]);
  });

  it("pairs the top seed against the bottom seed in round one", () => {
    const r = seedBracket(teams(8))!;
    expect([r[0][0].p1?.id, r[0][0].p2?.id]).toEqual(["t1", "t8"]);
  });

  it("orders by strength, not by array order", () => {
    const shuffled = [team(5), team(1), team(8), team(3)];
    const r = seedBracket(shuffled)!;
    expect(r[0][0].p1?.id).toBe("t1"); // strongest, regardless of input order
  });

  it("gives byes to the top seeds and advances them automatically", () => {
    const r = seedBracket(teams(5))!;   // padded to 8, so three byes
    const byes = r[0].filter((m) => m.isBye);
    expect(byes).toHaveLength(3);
    for (const b of byes) {
      expect(b.played).toBe(true);
      expect(b.winner).not.toBeNull();
    }
    // the top seed had a bye and is already in round two
    const inRound2 = r[1].flatMap((m) => [m.p1?.id, m.p2?.id]);
    expect(inRound2).toContain("t1");
  });

  it("a full bracket has no byes", () => {
    for (const n of [2, 4, 8, 16]) {
      expect(seedBracket(teams(n))!.flat().some((m) => m.isBye)).toBe(false);
    }
  });

  it("numbers matches uniquely", () => {
    const nums = seedBracket(teams(8))!.flat().map((m) => m.matchNum);
    expect(new Set(nums).size).toBe(nums.length);
  });
});

describe("double elimination", () => {
  it("sizes the losers' bracket from the winners' bracket", () => {
    expect(buildLoserBracket(2)).toEqual([]);        // too small to need one
    expect(buildLoserBracket(4).map((r) => r.length)).toEqual([1, 1]);
    expect(buildLoserBracket(8).map((r) => r.length)).toEqual([2, 2, 1, 1]);
    expect(buildLoserBracket(16).map((r) => r.length)).toEqual([4, 4, 2, 2, 1, 1]);
  });

  /** Play a whole 8-team double elimination, higher seed always winning. */
  function simulate(n: 4 | 8) {
    let wb: Round[] = seedBracket(teams(n))!;
    let lb: Round[] = buildLoserBracket(n);
    let gf: BracketMatch | null = null;
    let champion: Entrant | null = null;

    const playable = (rounds: Round[]) =>
      rounds.flatMap((rd, r) => rd.map((m, i) => ({ m, r, i })))
        .filter(({ m }) => !m.played && m.p1 && m.p2);

    // higher seed (lower number) wins
    const better = (a: Entrant, b: Entrant) => (Number(a.id.slice(1)) < Number(b.id.slice(1)) ? [11, 5] : [5, 11]);

    for (let guard = 0; guard < 100; guard++) {
      const w = playable(wb)[0];
      if (w) {
        const [sA, sB] = better(w.m.p1!, w.m.p2!);
        const res = advanceDE(wb, lb, gf, "W", w.r, w.i, sA, sB);
        wb = res.wb; lb = res.lb; gf = res.gf;
        continue;
      }
      const l = playable(lb)[0];
      if (l) {
        const [sA, sB] = better(l.m.p1!, l.m.p2!);
        const res = advanceDE(wb, lb, gf, "L", l.r, l.i, sA, sB);
        wb = res.wb; lb = res.lb; gf = res.gf;
        continue;
      }
      if (gf?.p1 && gf?.p2 && !gf.played) {
        const [sA, sB] = better(gf.p1, gf.p2);
        const res = advanceDE(wb, lb, gf, "G", 0, 0, sA, sB);
        champion = res.champion;
        gf = res.gf;
      }
      break;
    }
    return { wb, lb, gf, champion };
  }

  it("an 8-team run reaches a grand final and crowns the top seed", () => {
    const { gf, champion } = simulate(8);
    expect(gf?.played).toBe(true);
    expect(champion?.id).toBe("t1");
  });

  it("the grand final is contested by the winners' and losers' bracket survivors", () => {
    const { gf } = simulate(8);
    expect(gf?.p1).not.toBeNull();
    expect(gf?.p2).not.toBeNull();
    expect(gf?.p1?.id).not.toBe(gf?.p2?.id);
  });

  it("every match that could be played was played", () => {
    const { wb, lb } = simulate(8);
    for (const m of [...wb.flat(), ...lb.flat()]) {
      if (m.p1 && m.p2) expect(m.played).toBe(true);
    }
  });

  it("a first-round loser is routed into the losers' bracket, not eliminated", () => {
    const wb = seedBracket(teams(8))!;
    const lb = buildLoserBracket(8);
    const res = advanceDE(wb, lb, null, "W", 0, 0, 5, 11); // t8 beats t1
    expect(res.loserTeam?.id).toBe("t1");
    expect(res.lb.flat().flatMap((m) => [m.p1?.id, m.p2?.id])).toContain("t1");
  });

  it("works for four teams too", () => {
    expect(simulate(4).champion?.id).toBe("t1");
  });

  it("does not mutate the brackets passed in", () => {
    const wb = seedBracket(teams(8))!;
    const before = JSON.stringify(wb);
    advanceDE(wb, buildLoserBracket(8), null, "W", 0, 0, 11, 5);
    expect(JSON.stringify(wb)).toBe(before);
  });
});

describe("seed references", () => {
  const resolver = {
    groupPlacing: (key: string, rank: number) => (key === "A" && rank === 1 ? "winnerA" : null),
    tieWinner: (code: string) => (code === "SF1" ? "wSF1" : null),
    tieLoser: (code: string) => (code === "SF1" ? "lSF1" : null),
  };

  it("resolves group placings and tie outcomes", () => {
    expect(resolveRef("A1", resolver)).toBe("winnerA");
    expect(resolveRef("W:SF1", resolver)).toBe("wSF1");
    expect(resolveRef("L:SF1", resolver)).toBe("lSF1");
  });

  it("returns null while a slot is still undecided, rather than guessing", () => {
    expect(resolveRef("B2", resolver)).toBeNull();
    expect(resolveRef("W:SF2", resolver)).toBeNull();
    expect(resolveRef("nonsense", resolver)).toBeNull();
  });

  it("recognises the reference syntax", () => {
    expect(["A1", "F6", "W:SF1", "L:QF2"].every(isSeedRef)).toBe(true);
    expect(["", "A", "1", "A10", "Winner"].some(isSeedRef)).toBe(false);
  });

  it("labels an unfilled slot readably", () => {
    expect(refLabel("A1")).toContain("group A");
    expect(refLabel("W:SF1")).toBe("Winner SF1");
    expect(refLabel("L:SF1")).toBe("Loser SF1");
  });
});
