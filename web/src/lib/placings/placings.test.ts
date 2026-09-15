import { describe, it, expect } from "vitest";
import { podiumFor, podiums, placingOf, settled } from "./index";
import type { GroupTable, LoadedTournament } from "@/lib/tournamentState";
import type { Match, Tournament } from "@/lib/db/schema";

/* Built from real match rows and run through the real `viewMatch`, so what is
 * being checked is "does a finished final decide the podium", not "does this
 * function copy the object I handed it". */

const tournament = {
  id: "t1", slug: "cup", name: "Cup", sport: "pb", format: "standard", scoring: null,
} as unknown as Tournament;

let n = 0;
const match = (over: Partial<Match>): Match => ({
  id: `m${++n}`,
  tournamentId: "t1",
  divisionId: "d1",
  round: "Group A · R1",
  court: null,
  scheduledAt: null,
  groupId: null,
  teamAId: null,
  teamBId: null,
  slotA: null,
  slotB: null,
  log: [],
  server: "a",
  posA: 0,
  posB: 0,
  lineupA: [],
  lineupB: [],
  ackedGates: [],
  typedScoreA: null,
  typedScoreB: null,
  timing: null,
  rev: 0,
  updatedAt: new Date(),
  createdAt: new Date(),
  ...over,
} as unknown as Match);

const loaded = (matches: Match[]): LoadedTournament =>
  ({ tournament, groups: [], teams: [], matches }) as unknown as LoadedTournament;

/** A finished match, recorded the way a typed-in result is. */
const result = (round: string, a: string, b: string, sa: number, sb: number, divisionId = "d1") =>
  match({ round, divisionId, teamAId: a, teamBId: b, typedScoreA: sa, typedScoreB: sb });

const table = (
  divisionId: string,
  teamIds: string[],
  complete: boolean,
): GroupTable =>
  ({
    group: { id: `g-${divisionId}`, divisionId, key: "A" },
    rows: teamIds.map((teamId) => ({ teamId, name: teamId })),
    complete,
  }) as unknown as GroupTable;

describe("a finished match", () => {
  it("names a winner and a loser", () => {
    expect(settled(tournament, result("Final", "A", "B", 11, 7))).toEqual({ winner: "A", loser: "B" });
    expect(settled(tournament, result("Final", "A", "B", 7, 11))).toEqual({ winner: "B", loser: "A" });
  });

  it("names nobody while it is still being played", () => {
    expect(settled(tournament, match({ round: "Final", teamAId: "A", teamBId: "B", log: ["a", "a"] }))).toBeNull();
  });

  it("names nobody when a side is still a seed reference", () => {
    expect(settled(tournament, match({ round: "Final", teamAId: "A", slotB: "W:Semi-Final 2" }))).toBeNull();
  });
});

describe("a knockout decides the podium", () => {
  it("gold and silver from the final", () => {
    const p = podiumFor(loaded([result("Final", "A", "B", 11, 7)]), [], "d1")!;
    expect(p.gold).toBe("A");
    expect(p.silver).toBe("B");
    expect(p.via).toBe("final");
  });

  it("bronze from the third-place playoff", () => {
    const p = podiumFor(
      loaded([result("Final", "A", "B", 11, 7), result("Third Place", "C", "D", 11, 9)]),
      [], "d1",
    )!;
    expect(p.bronze).toBe("C");
  });

  it("gives NO bronze when there was no playoff for it", () => {
    /* Two losing semi-finalists are joint third. Handing it to one of them
       would be inventing a result the event never played. */
    const p = podiumFor(
      loaded([
        result("Semi-Final 1", "A", "C", 11, 5),
        result("Semi-Final 2", "B", "D", 11, 6),
        result("Final", "A", "B", 11, 7),
      ]),
      [], "d1",
    )!;
    expect(p.gold).toBe("A");
    expect(p.bronze).toBeNull();
  });

  it("decides nothing while the final is unplayed", () => {
    const p = podiumFor(
      loaded([
        result("Semi-Final 1", "A", "C", 11, 5),
        match({ round: "Final", teamAId: "A", teamBId: "B" }),
      ]),
      [], "d1",
    );
    expect(p).toBeNull();
  });

  it("is not fooled by a semi-final, which also contains the word", () => {
    const p = podiumFor(loaded([result("Semi-Final 1", "A", "B", 11, 7)]), [], "d1");
    expect(p).toBeNull();
  });
});

describe("a league is decided by its table", () => {
  const league = [result("Group A · R1", "A", "B", 11, 4), result("Group A · R2", "A", "C", 11, 6)];

  it("takes the top three once every match is played", () => {
    const p = podiumFor(loaded(league), [table("d1", ["A", "B", "C"], true)], "d1")!;
    expect([p.gold, p.silver, p.bronze]).toEqual(["A", "B", "C"]);
    expect(p.via).toBe("table");
  });

  it("decides nothing while a match is outstanding", () => {
    expect(podiumFor(loaded(league), [table("d1", ["A", "B", "C"], false)], "d1")).toBeNull();
  });

  it("gives no bronze when only two entered", () => {
    const p = podiumFor(loaded(league), [table("d1", ["A", "B"], true)], "d1")!;
    expect(p.silver).toBe("B");
    expect(p.bronze).toBeNull();
  });

  it("will not guess across several groups with no knockout", () => {
    /* Two group winners and nothing played between them is not a champion. */
    const p = podiumFor(
      loaded(league),
      [table("d1", ["A", "B"], true), table("d1", ["C", "D"], true)],
      "d1",
    );
    expect(p).toBeNull();
  });
});

describe("categories are separate", () => {
  it("decides each on its own final", () => {
    const all = loaded([
      result("Final", "MD-A", "MD-B", 11, 7, "md"),
      result("Final", "MX-A", "MX-B", 11, 9, "mx"),
    ]);
    const list = podiums(all, []);
    expect(list).toHaveLength(2);
    expect(list.find((p) => p.divisionId === "md")!.gold).toBe("MD-A");
    expect(list.find((p) => p.divisionId === "mx")!.gold).toBe("MX-A");
  });

  it("leaves out a category that has not finished", () => {
    const all = loaded([
      result("Final", "MD-A", "MD-B", 11, 7, "md"),
      match({ round: "Final", divisionId: "mx", teamAId: "MX-A", teamBId: "MX-B" }),
    ]);
    expect(podiums(all, []).map((p) => p.divisionId)).toEqual(["md"]);
  });

  it("does not let one category's final decide another's", () => {
    const all = loaded([result("Final", "MD-A", "MD-B", 11, 7, "md")]);
    expect(podiumFor(all, [], "mx")).toBeNull();
  });
});

describe("what a team won", () => {
  const p = podiumFor(
    loaded([result("Final", "A", "B", 11, 7), result("Third Place", "C", "D", 11, 9)]),
    [], "d1",
  )!;

  it("reads back for each place", () => {
    expect(placingOf(p, "A")).toBe("gold");
    expect(placingOf(p, "B")).toBe("silver");
    expect(placingOf(p, "C")).toBe("bronze");
  });

  it("is nothing for everybody else", () => {
    expect(placingOf(p, "D")).toBeNull();
    expect(placingOf(p, "never-entered")).toBeNull();
  });
});
