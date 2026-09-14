import { describe, it, expect } from "vitest";
import {
  halfHourSlots, reserveSlot, leaveSlot,
  kotcStart, kotcPickWinner, kotcNextRound, kotcRoundComplete, kotcEveryone,
  ladderAdd, ladderRemove, ladderChallenge,
  type KotcState, type LadderEntry,
} from "./rotations";

const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i + 1}`);
/* Identity shuffle, so the opening draw is predictable. */
const noShuffle = () => 0;

describe("half-hour slots", () => {
  it("splits an evening into halves of an hour", () => {
    expect(halfHourSlots("20:00", "22:00")).toEqual([
      "20:00–20:30", "20:30–21:00", "21:00–21:30", "21:30–22:00",
    ]);
  });

  it("drops a trailing part-slot rather than inventing one", () => {
    expect(halfHourSlots("20:00", "21:15")).toEqual(["20:00–20:30", "20:30–21:00"]);
  });

  it("handles an evening that runs past midnight", () => {
    expect(halfHourSlots("23:00", "00:30")).toEqual(["23:00–23:30", "23:30–00:00", "00:00–00:30"]);
  });

  it("falls back to an hour when the times make no sense", () => {
    expect(halfHourSlots("20:00", "20:00")).toHaveLength(2);
  });
});

describe("reserving a slot", () => {
  const slot = "20:00–20:30";

  it("takes a place", () => {
    expect(reserveSlot({}, slot, "p1", 4)).toEqual({ [slot]: ["p1"] });
  });

  it("does not book the same person twice", () => {
    const once = reserveSlot({}, slot, "p1", 4);
    expect(reserveSlot(once, slot, "p1", 4)).toBe(once);
  });

  it("refuses once the slot is full", () => {
    let s = {};
    for (const id of ids(4)) s = reserveSlot(s, slot, id, 4);
    const full = s;
    expect(reserveSlot(full, slot, "p5", 4)).toBe(full);
    expect((full as Record<string, string[]>)[slot]).toHaveLength(4);
  });

  it("keeps slots independent of each other", () => {
    let s = reserveSlot({}, "20:00–20:30", "p1", 1);
    s = reserveSlot(s, "20:30–21:00", "p1", 1);
    expect(s).toEqual({ "20:00–20:30": ["p1"], "20:30–21:00": ["p1"] });
  });

  it("gives a place back, and only that person's", () => {
    let s = reserveSlot({}, slot, "p1", 4);
    s = reserveSlot(s, slot, "p2", 4);
    expect(leaveSlot(s, slot, "p1")).toEqual({ [slot]: ["p2"] });
  });

  it("ignores a person who was not in the slot", () => {
    const s = reserveSlot({}, slot, "p1", 4);
    expect(leaveSlot(s, slot, "p9")).toBe(s);
  });
});

describe("King of the Court — the draw", () => {
  it("needs four players", () => {
    expect(kotcStart(ids(3), 2, noShuffle)).toBeNull();
    expect(kotcStart(ids(4), 2, noShuffle)).not.toBeNull();
  });

  it("is two against two, however many players fit a court elsewhere", () => {
    const s = kotcStart(ids(8), 2, noShuffle)!;
    for (const c of s.courts) {
      expect(c.a).toHaveLength(2);
      expect(c.b).toHaveLength(2);
    }
  });

  it("benches whoever does not make a full four", () => {
    const s = kotcStart(ids(10), 3, noShuffle)!;
    expect(s.courts).toHaveLength(2);
    expect(s.bench).toHaveLength(2);
  });

  it("puts everyone somewhere, exactly once", () => {
    const s = kotcStart(ids(11), 3, noShuffle)!;
    const all = kotcEveryone(s);
    expect(all).toHaveLength(11);
    expect(new Set(all).size).toBe(11);
  });

  it("never uses more courts than are booked", () => {
    const s = kotcStart(ids(12), 2, noShuffle)!;
    expect(s.courts).toHaveLength(2);
    expect(s.bench).toHaveLength(4);
  });
});

describe("King of the Court — closing a round", () => {
  /* Three courts, no bench: the promotion and demotion chain in isolation. */
  const threeCourts = (): KotcState => ({
    courts: [
      { a: ["a1", "a2"], b: ["b1", "b2"], winner: null },
      { a: ["c1", "c2"], b: ["d1", "d2"], winner: null },
      { a: ["e1", "e2"], b: ["f1", "f2"], winner: null },
    ],
    bench: [],
    crowns: {},
    round: 1,
  });

  const allWinA = (s: KotcState) =>
    s.courts.reduce((acc, _, i) => kotcPickWinner(acc, i, "a"), s);

  it("will not close while a court has no result", () => {
    const s = kotcPickWinner(threeCourts(), 0, "a");
    expect(kotcRoundComplete(s)).toBe(false);
    expect(kotcNextRound(s)).toBe(s);
  });

  it("keeps the King court's winners on it", () => {
    const next = kotcNextRound(allWinA(threeCourts()));
    expect(next.courts[0].a).toEqual(["a1", "a2"]);
  });

  it("moves the winners below up, and the losers above down", () => {
    const next = kotcNextRound(allWinA(threeCourts()));
    /* Court 1 is challenged by court 2's winners. */
    expect(next.courts[0].b).toEqual(["c1", "c2"]);
    /* Court 2 now holds court 1's losers, challenged by court 3's winners. */
    expect(next.courts[1].a).toEqual(["b1", "b2"]);
    expect(next.courts[1].b).toEqual(["e1", "e2"]);
    /* Court 3 holds court 2's losers. */
    expect(next.courts[2].a).toEqual(["d1", "d2"]);
  });

  it("crowns whoever held the King court", () => {
    let s = kotcNextRound(allWinA(threeCourts()));
    expect(s.crowns).toEqual({ a1: 1, a2: 1 });
    s = kotcNextRound(allWinA(s));
    expect(s.crowns.a1).toBe(2);
  });

  it("counts the rounds", () => {
    expect(kotcNextRound(allWinA(threeCourts())).round).toBe(2);
  });

  it("loses nobody across a round", () => {
    const before = kotcEveryone(threeCourts()).sort();
    const after = kotcEveryone(kotcNextRound(allWinA(threeCourts()))).sort();
    expect(after).toEqual(before);
  });

  it("brings the bench on at the bottom, and sends the bottom losers to the back", () => {
    const s: KotcState = {
      courts: [{ a: ["a1", "a2"], b: ["b1", "b2"], winner: "a" }],
      bench: ["x1", "x2", "y1"],
      crowns: {},
      round: 1,
    };
    const next = kotcNextRound(s);
    expect(next.courts[0].a).toEqual(["a1", "a2"]);
    expect(next.courts[0].b).toEqual(["x1", "x2"]);
    /* The pair that lost goes behind whoever was still waiting. */
    expect(next.bench).toEqual(["y1", "b1", "b2"]);
  });

  it("plays the same four again when nobody is waiting", () => {
    /* One court, no bench: "winners stay on" with nobody to come on. */
    const s: KotcState = {
      courts: [{ a: ["a1", "a2"], b: ["b1", "b2"], winner: "a" }],
      bench: [],
      crowns: {},
      round: 1,
    };
    const next = kotcNextRound(s);
    expect(next.courts[0].a).toEqual(["a1", "a2"]);
    expect(next.courts[0].b).toEqual(["b1", "b2"]);
    expect(next.bench).toEqual([]);
  });

  it("does not bring on a bench of one", () => {
    /* Half a pair cannot take a court; they wait for company. */
    const s: KotcState = {
      courts: [{ a: ["a1", "a2"], b: ["b1", "b2"], winner: "b" }],
      bench: ["x1"],
      crowns: {},
      round: 1,
    };
    const next = kotcNextRound(s);
    expect(next.courts[0].a).toEqual(["b1", "b2"]);
    expect(next.bench).toEqual(["x1"]);
  });

  it("clears the winners ready for the next round", () => {
    const next = kotcNextRound(allWinA(threeCourts()));
    expect(next.courts.every((c) => c.winner === null)).toBe(true);
  });
});

describe("the ladder", () => {
  const order = ["p1", "p2", "p3", "p4"];
  const today = "2026-09-17";

  it("adds somebody to the bottom, once", () => {
    expect(ladderAdd(order, "p5")).toEqual([...order, "p5"]);
    expect(ladderAdd(order, "p2")).toEqual(order);
  });

  it("takes somebody off", () => {
    expect(ladderRemove(order, "p2")).toEqual(["p1", "p3", "p4"]);
  });

  it("swaps places when the challenger wins", () => {
    const res = ladderChallenge(order, [], "p4", "p2", true, today);
    expect(res.ok && res.order).toEqual(["p1", "p4", "p3", "p2"]);
  });

  it("changes nothing when the challenger loses", () => {
    const res = ladderChallenge(order, [], "p4", "p2", false, today);
    expect(res.ok && res.order).toEqual(order);
  });

  it("records a loss as well as a win", () => {
    const res = ladderChallenge(order, [], "p4", "p2", false, today);
    expect(res.ok && res.log[0]).toEqual({ challenger: "p4", defender: "p2", won: false, at: today });
  });

  it("refuses a challenge downwards", () => {
    /* The legacy engine swaps whatever it is handed and leaves this to the
       screen, so any other path to it can invert the ladder silently. */
    const res = ladderChallenge(order, [], "p2", "p4", true, today);
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("above you");
  });

  it("refuses somebody challenging themselves", () => {
    expect(ladderChallenge(order, [], "p2", "p2", true, today).ok).toBe(false);
  });

  it("refuses a player who is not on the ladder", () => {
    expect(ladderChallenge(order, [], "p9", "p2", true, today).ok).toBe(false);
    expect(ladderChallenge(order, [], "p4", "p9", true, today).ok).toBe(false);
  });

  it("keeps the newest six results, newest first", () => {
    let log: LadderEntry[] = [];
    let cur = order;
    for (let i = 0; i < 8; i++) {
      const res = ladderChallenge(cur, log, "p4", "p1", false, `2026-09-${10 + i}`);
      if (!res.ok) throw new Error(res.error);
      cur = res.order;
      log = res.log;
    }
    expect(log).toHaveLength(6);
    expect(log[0].at).toBe("2026-09-17");
  });

  it("lets somebody who won climb again next week", () => {
    const first = ladderChallenge(order, [], "p4", "p3", true, today);
    if (!first.ok) throw new Error(first.error);
    expect(first.order).toEqual(["p1", "p2", "p4", "p3"]);

    const second = ladderChallenge(first.order, first.log, "p4", "p1", true, today);
    expect(second.ok && second.order).toEqual(["p4", "p2", "p1", "p3"]);
  });
});
