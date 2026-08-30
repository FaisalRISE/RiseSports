import { describe, it, expect } from "vitest";
import {
  standings, PICKLEBOSS_TIEBREAK, OSL_TIEBREAK, DEFAULT_TIEBREAK,
  type TeamRef, type StandingsMatch,
} from "./index";

const teams = (...names: string[]): TeamRef[] =>
  names.map((name, i) => ({ id: name, name, seed: i }));

const m = (a: string, b: string, sa: number, sb: number): StandingsMatch => ({
  teamAId: a, teamBId: b, scoreA: sa, scoreB: sb, played: true,
});

const order = (rows: { teamId: string }[]) => rows.map((r) => r.teamId);

describe("accumulation", () => {
  const t = teams("A", "B", "C");
  const ms = [m("A", "B", 15, 10), m("A", "C", 15, 13), m("B", "C", 12, 15)];

  it("counts played, won, lost, for and against", () => {
    const rows = standings(t, ms, { tieBreak: DEFAULT_TIEBREAK });
    const A = rows.find((r) => r.teamId === "A")!;
    expect([A.played, A.won, A.lost]).toEqual([2, 2, 0]);
    expect([A.pointsFor, A.pointsAgainst, A.diff]).toEqual([30, 23, 7]);
    expect(A.points).toBe(4); // 2 per win
  });

  it("ignores unplayed matches entirely", () => {
    const rows = standings(t, [...ms, { teamAId: "A", teamBId: "B", scoreA: 0, scoreB: 0, played: false }],
      { tieBreak: DEFAULT_TIEBREAK });
    expect(rows.find((r) => r.teamId === "A")!.played).toBe(2);
  });

  it("ranks from 1 with no gaps", () => {
    const rows = standings(t, ms, { tieBreak: DEFAULT_TIEBREAK });
    expect(rows.map((r) => r.rank)).toEqual([1, 2, 3]);
  });

  it("includes teams that have not played yet", () => {
    const rows = standings(teams("A", "B", "C", "D"), ms, { tieBreak: DEFAULT_TIEBREAK });
    expect(rows).toHaveLength(4);
    expect(rows.find((r) => r.teamId === "D")!.played).toBe(0);
  });

  it("awards draw points only where the sport allows draws", () => {
    const drawn = [m("A", "B", 10, 10)];
    const noDraws = standings(teams("A", "B"), drawn, { tieBreak: DEFAULT_TIEBREAK });
    expect(noDraws.every((r) => r.points === 0)).toBe(true);
    expect(noDraws.every((r) => r.played === 1)).toBe(true); // still counted as played

    const withDraws = standings(teams("A", "B"), drawn, { tieBreak: DEFAULT_TIEBREAK, allowDraws: true });
    expect(withDraws.every((r) => r.points === 1 && r.drawn === 1)).toBe(true);
  });
});

describe("the three formats break ties differently — the reason this is configurable", () => {
  /* A four-team round robin where A, B and D all finish on two wins.
   *   overall difference : A +15, D +13, B +6
   *   head-to-head among the tied three: D +8, A 0, B -8  (each won one)
   * Pickleboss takes difference before head-to-head, OSL takes head-to-head
   * first, so the SAME results must produce a DIFFERENT champion. */
  const t = teams("A", "B", "C", "D");
  const ms = [
    m("B", "A", 15, 13),   // B beat A narrowly
    m("A", "C", 15, 0),
    m("A", "D", 15, 13),   // A beat D narrowly
    m("B", "C", 15, 1),
    m("D", "B", 15, 5),    // D beat B heavily
    m("D", "C", 15, 10),
  ];

  it("all three tied teams really are level on wins and points", () => {
    const rows = standings(t, ms, { tieBreak: DEFAULT_TIEBREAK });
    const byId = Object.fromEntries(rows.map((r) => [r.teamId, r]));
    expect([byId.A.won, byId.B.won, byId.D.won]).toEqual([2, 2, 2]);
    expect([byId.A.points, byId.B.points, byId.D.points]).toEqual([4, 4, 4]);
    expect([byId.A.diff, byId.D.diff, byId.B.diff]).toEqual([15, 13, 6]);
  });

  it("Pickleboss ranks on point difference: A first", () => {
    expect(order(standings(t, ms, { tieBreak: PICKLEBOSS_TIEBREAK }))).toEqual(["A", "D", "B", "C"]);
  });

  it("OSL §2.8 ranks on head-to-head: D first", () => {
    expect(order(standings(t, ms, { tieBreak: OSL_TIEBREAK }))).toEqual(["D", "A", "B", "C"]);
  });

  it("both agree on who finishes last", () => {
    expect(order(standings(t, ms, { tieBreak: PICKLEBOSS_TIEBREAK })).at(-1)).toBe("C");
    expect(order(standings(t, ms, { tieBreak: OSL_TIEBREAK })).at(-1)).toBe("C");
  });
});

describe("head-to-head is a mini-table between exactly the tied teams", () => {
  it("resolves a three-way tie on the results among those three only", () => {
    /* A, B, C each win one and lose one against each other; D is beaten by all.
       A beat B, B beat C, C beat A — circular, so h2h wins are level and the
       chain must fall through to difference within the tied block. */
    const t = teams("A", "B", "C", "D");
    const ms = [
      m("A", "B", 15, 13), m("B", "C", 15, 13), m("C", "A", 15, 13),
      m("A", "D", 15, 0), m("B", "D", 15, 5), m("C", "D", 15, 10),
    ];
    const rows = standings(t, ms, { tieBreak: OSL_TIEBREAK });
    expect(rows.at(-1)!.teamId).toBe("D");
    // the three tied teams are separated deterministically, not arbitrarily
    expect(order(rows).slice(0, 3).sort()).toEqual(["A", "B", "C"]);
    expect(order(standings(t, ms, { tieBreak: OSL_TIEBREAK }))).toEqual(order(rows));
  });

  it("ignores results against teams outside the tie", () => {
    /* P and Q are level on wins and difference. P beat Q. R is a whipping boy
       whose results must not colour the P-v-Q comparison. */
    const t = teams("P", "Q", "R");
    const ms = [m("P", "Q", 15, 13), m("Q", "R", 15, 0), m("P", "R", 15, 2)];
    const rows = standings(t, ms, { tieBreak: OSL_TIEBREAK });
    expect(rows[0].teamId).toBe("P");
  });
});

describe("determinism", () => {
  it("never leaves two teams in an arbitrary order", () => {
    // identical records in every respect
    const t = teams("A", "B");
    const ms = [m("A", "B", 10, 10)];
    const once = order(standings(t, ms, { tieBreak: DEFAULT_TIEBREAK }));
    const twice = order(standings([...t].reverse(), ms, { tieBreak: DEFAULT_TIEBREAK }));
    expect(once).toEqual(twice); // seed order wins, not array order
  });

  it("gives the same table however the fixtures are ordered", () => {
    const t = teams("A", "B", "C");
    const ms = [m("A", "B", 15, 10), m("B", "C", 15, 9), m("A", "C", 11, 15)];
    const forward = order(standings(t, ms, { tieBreak: PICKLEBOSS_TIEBREAK }));
    const reversed = order(standings(t, [...ms].reverse(), { tieBreak: PICKLEBOSS_TIEBREAK }));
    expect(forward).toEqual(reversed);
  });

  it("an empty group is a table of zeroes, not a crash", () => {
    const rows = standings(teams("A", "B"), [], { tieBreak: OSL_TIEBREAK });
    expect(rows.map((r) => r.played)).toEqual([0, 0]);
    expect(rows.map((r) => r.rank)).toEqual([1, 2]);
  });

  it("tolerates a match naming a team that is not in the group", () => {
    const rows = standings(teams("A", "B"), [m("A", "GHOST", 15, 0)], { tieBreak: OSL_TIEBREAK });
    expect(rows.find((r) => r.teamId === "A")!.played).toBe(0);
  });
});
