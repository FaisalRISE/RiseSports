import { describe, it, expect } from "vitest";
import { buildBlock, buildSchedule, courtGames, midTime, type Entrant } from "./pairings";

/* What these tests are for: balanced and mexicano both sort by rating and
 * differ only in how they deal. Swapping them is invisible in the output shape
 * and completely changes the evening — so each is pinned by what the mode is
 * FOR (close games / level-matched games), not by the array it returns. */

/** n players rated 1000, 990, 980 … so the order is unambiguous. */
const players = (n: number): Entrant[] =>
  Array.from({ length: n }, (_, i) => ({ personId: `p${i + 1}`, rating: 1000 - i * 10 }));

/** A deterministic stand-in for Math.random, so "random" mode is testable. */
const fixedRand = () => 0.5;

const ratingOf = (e: Entrant[]) => new Map(e.map((x) => [x.personId, x.rating]));
const courtTotal = (ids: string[], r: Map<string, number>) =>
  ids.reduce((s, id) => s + (r.get(id) ?? 0), 0);

describe("courtGames", () => {
  it("gives four players three games, every partnership exactly once", () => {
    const games = courtGames(["a", "b", "c", "d"]);
    expect(games).toHaveLength(3);

    const partnerships = games
      .flatMap((g) => [g.lineupA, g.lineupB])
      .map((side) => [...side].sort().join("+"))
      .sort();
    expect(partnerships).toEqual(["a+b", "a+c", "a+d", "b+c", "b+d", "c+d"]);
  });

  it("has everyone play everyone, in a court of four", () => {
    const games = courtGames(["a", "b", "c", "d"]);
    const opponents = new Map<string, Set<string>>();
    for (const g of games) {
      for (const x of g.lineupA) for (const y of g.lineupB) {
        (opponents.get(x) ?? opponents.set(x, new Set()).get(x)!).add(y);
        (opponents.get(y) ?? opponents.set(y, new Set()).get(y)!).add(x);
      }
    }
    for (const p of ["a", "b", "c", "d"]) expect(opponents.get(p)?.size).toBe(3);
  });

  it("is a singles game for two, and a round robin for three", () => {
    expect(courtGames(["a", "b"])).toEqual([{ lineupA: ["a"], lineupB: ["b"] }]);
    expect(courtGames(["a", "b", "c"])).toHaveLength(3);
  });

  it("gives one game each, and equal sit-outs, for five or more", () => {
    const games = courtGames(["a", "b", "c", "d", "e"]);
    expect(games).toHaveLength(5);
    const appearances = new Map<string, number>();
    for (const g of games) {
      for (const p of [...g.lineupA, ...g.lineupB]) {
        appearances.set(p, (appearances.get(p) ?? 0) + 1);
      }
    }
    expect([...appearances.values()]).toEqual([4, 4, 4, 4, 4]);
  });

  it("schedules nothing for fewer than two", () => {
    expect(courtGames(["a"])).toEqual([]);
    expect(courtGames([])).toEqual([]);
  });
});

describe("balanced evens the courts out", () => {
  it("puts the strongest and the weakest together", () => {
    const e = players(8);
    const block = buildBlock(e, { courts: 2, perCourt: 4, mode: "balanced" });
    const court1 = block.courts[0].personIds;

    /* Snake: court 1 takes the best (p1) and the worst of the seated (p8). */
    expect(court1).toContain("p1");
    expect(court1).toContain("p8");
  });

  it("makes the court totals close", () => {
    const e = players(8);
    const r = ratingOf(e);
    const block = buildBlock(e, { courts: 2, perCourt: 4, mode: "balanced" });
    const totals = block.courts.map((c) => courtTotal(c.personIds, r));
    /* 1000+930+960+970 vs 990+940+950+980 — twenty points apart at most. */
    expect(Math.abs(totals[0] - totals[1])).toBeLessThanOrEqual(20);
  });

  it("is closer than mexicano on the same players — the reason both exist", () => {
    const e = players(8);
    const r = ratingOf(e);
    const spread = (mode: "balanced" | "mexicano") => {
      const totals = buildBlock(e, { courts: 2, perCourt: 4, mode }).courts
        .map((c) => courtTotal(c.personIds, r));
      return Math.abs(totals[0] - totals[1]);
    };
    expect(spread("balanced")).toBeLessThan(spread("mexicano"));
  });
});

describe("mexicano matches like with like", () => {
  it("puts the top four on one court", () => {
    const block = buildBlock(players(8), { courts: 2, perCourt: 4, mode: "mexicano" });
    expect(block.courts[0].personIds).toEqual(["p1", "p2", "p3", "p4"]);
    expect(block.courts[1].personIds).toEqual(["p5", "p6", "p7", "p8"]);
  });
});

describe("americano rotates so everyone partners everyone", () => {
  it("changes who shares a court between blocks", () => {
    const e = players(8);
    const opts = { courts: 2, perCourt: 4, mode: "americano" as const };
    const first = buildBlock(e, { ...opts, block: 0 }).courts[0].personIds;
    const second = buildBlock(e, { ...opts, block: 1 }).courts[0].personIds;
    expect(second).not.toEqual(first);
  });

  it("ignores rating entirely", () => {
    /* Same people, ratings reversed: americano must produce the same courts. */
    const a = players(8);
    const b = a.map((p, i) => ({ ...p, rating: 100 + i * 10 }));
    const opts = { courts: 2, perCourt: 4, mode: "americano" as const };
    expect(buildBlock(a, opts).courts.map((c) => c.personIds))
      .toEqual(buildBlock(b, opts).courts.map((c) => c.personIds));
  });
});

describe("using the courts that are booked", () => {
  /* The legacy rule counts only courts it can fill COMPLETELY
     (app.source.js:8883), so six people on two booked courts play on one and
     two sit out all evening beside an empty court somebody paid for. These
     pin the replacement. */
  it("spreads six across both courts rather than benching two", () => {
    const block = buildBlock(players(6), { courts: 2, perCourt: 4, mode: "random", rand: fixedRand });
    expect(block.courts.map((c) => c.personIds.length)).toEqual([3, 3]);
    expect(block.benched).toEqual([]);
  });

  it("splits seven as four and three", () => {
    const block = buildBlock(players(7), { courts: 2, perCourt: 4, mode: "random", rand: fixedRand });
    expect(block.courts.map((c) => c.personIds.length)).toEqual([4, 3]);
    expect(block.benched).toEqual([]);
  });

  it("still prefers full courts when it can fill them", () => {
    const block = buildBlock(players(8), { courts: 2, perCourt: 4, mode: "random", rand: fixedRand });
    expect(block.courts.map((c) => c.personIds.length)).toEqual([4, 4]);
  });

  it("never leaves one person alone on a court", () => {
    /* Five in singles across four booked courts is two courts of two and one
       person out — not two, two and a one. */
    const block = buildBlock(players(5), { courts: 4, perCourt: 2, mode: "random", rand: fixedRand });
    expect(block.courts.map((c) => c.personIds.length)).toEqual([2, 2]);
    expect(block.benched).toHaveLength(1);
  });

  it("benches whoever genuinely does not fit", () => {
    const block = buildBlock(players(10), { courts: 2, perCourt: 4, mode: "mexicano" });
    expect(block.benched).toEqual(["p9", "p10"]);
  });

  it("uses fewer courts than booked rather than thinning them out", () => {
    /* Eight people, four booked courts: two courts of four, not four of two. */
    const block = buildBlock(players(8), { courts: 4, perCourt: 4, mode: "random", rand: fixedRand });
    expect(block.courts).toHaveLength(2);
    expect(block.benched).toEqual([]);
  });

  it("still fields one court when there are not enough for a full one", () => {
    const block = buildBlock(players(3), { courts: 2, perCourt: 4, mode: "random", rand: fixedRand });
    expect(block.courts).toHaveLength(1);
    expect(block.courts[0].personIds).toHaveLength(3);
  });

  it("seats everyone it can, and benches the rest, whatever the mode", () => {
    for (const mode of ["random", "balanced", "mexicano", "americano"] as const) {
      const block = buildBlock(players(11), { courts: 2, perCourt: 4, mode, rand: fixedRand });
      const seated = block.courts.flatMap((c) => c.personIds);
      expect(seated).toHaveLength(8);
      expect(block.benched).toHaveLength(3);
      /* Nobody on a court and on the bench at once, nobody on two courts. */
      expect(new Set([...seated, ...block.benched]).size).toBe(11);
    }
  });
});

describe("midTime", () => {
  it("halves an ordinary evening", () => {
    expect(midTime("20:00", "22:00")).toBe("21:00");
    expect(midTime("18:30", "21:30")).toBe("20:00");
  });

  it("handles a session that runs past midnight", () => {
    /* Without the wrap this returns 11:15 in the morning. */
    expect(midTime("22:00", "00:30")).toBe("23:15");
  });
});

describe("buildSchedule", () => {
  const game = {
    courts: 2, perCourt: 4, scheduleMode: "balanced" as const,
    rotation: "fixed", startTime: "20:00", endTime: "22:00",
  };

  it("is one block for a game that does not reshuffle", () => {
    const blocks = buildSchedule(players(8), game);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].label).toBe("20:00–22:00");
  });

  it("is two labelled halves for a game that reshuffles", () => {
    const blocks = buildSchedule(players(8), { ...game, rotation: "rotate" });
    expect(blocks).toHaveLength(2);
    expect(blocks.map((b) => b.label)).toEqual(["20:00–21:00", "21:00–22:00"]);
  });

  it("schedules nothing at all for fewer than two players", () => {
    expect(buildSchedule(players(1), game)).toEqual([]);
    expect(buildSchedule([], game)).toEqual([]);
  });

  it("never puts one person on both sides of a game", () => {
    for (const mode of ["random", "balanced", "mexicano", "americano"] as const) {
      const blocks = buildSchedule(players(9), { ...game, scheduleMode: mode }, fixedRand);
      for (const b of blocks) for (const c of b.courts) for (const g of c.games) {
        const all = [...g.lineupA, ...g.lineupB];
        expect(new Set(all).size, `${mode} ${c.court}`).toBe(all.length);
      }
    }
  });
});
