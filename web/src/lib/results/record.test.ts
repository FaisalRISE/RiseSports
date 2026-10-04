import { describe, it, expect } from "vitest";
import { normaliseResult, resultProblem, walkoverScore, type ResultInput } from "./record";
import { endingFor } from "@/lib/scoring/final";
import { resolveRules, buildScoring } from "@/lib/scoring/rules";

/* The rules for TYPING a result, without a database. The action
 * (`recordResult`) bounds its numbers before it asks, so some of what is
 * pinned here cannot be reached through it — which is exactly why it is pinned
 * here: the rule has to hold for the next caller too. */

const pb = endingFor("pb", resolveRules("pb", undefined));
const tennis = endingFor("tn", resolveRules("tn", undefined));
const carrom25 = endingFor("cr", resolveRules("cr", undefined));
const boards = endingFor("cr", resolveRules("cr", undefined), { carromBoards: true });
const knockout = { teamAId: "a", teamBId: "b", groupId: null };
const group = { ...knockout, groupId: "g" };
const typed = (a: number, b: number, extra: Partial<ResultInput> = {}): ResultInput =>
  ({ a, b, outcome: null, sets: null, ...extra });

describe("the score a walkover is recorded at", () => {
  it("is what a finished game's winner has", () => {
    expect(walkoverScore(pb)).toBe(11);
    expect(walkoverScore(tennis)).toBe(2);
    expect(walkoverScore(carrom25)).toBe(25);
    expect(walkoverScore(boards)).toBe(1);
    /* A golden point below the target ends the game there, so that is the
       winning score. */
    const low = endingFor("bd", resolveRules("bd", { target: 21, ...buildScoring(21, true, 19, null) }));
    expect(walkoverScore(low)).toBe(20);
  });

  it("goes to the side typed higher", () => {
    expect(normaliseResult(pb, typed(0, 1, { outcome: "walkover" }))).toEqual({ a: 0, b: 11, outcome: "walkover", sets: null });
  });
});

describe("what may be recorded", () => {
  it("needs both teams", () => {
    expect(resultProblem({ ...knockout, teamBId: null }, pb, typed(11, 7), false)?.code).toBe("teams");
  });

  it("a result without a rating may stand where the rules refuse it, but never malformed", () => {
    expect(resultProblem(knockout, pb, typed(9, 7, { outcome: "unrated" }), false)).toBeNull();
    expect(resultProblem(knockout, pb, typed(1000, 7, { outcome: "unrated" }), false)?.code).toBe("invalid");
  });

  it("a level score: a draw in a group where the sport has them, never in a knockout", () => {
    expect(resultProblem(group, boards, typed(20, 20), true)).toBeNull();
    expect(resultProblem(knockout, boards, typed(20, 20), true)?.code).toBe("knockout-level");
    expect(resultProblem(group, pb, typed(11, 11), false)?.code).toBe("invalid");
  });

  it("keeps the games in each set only where the match has sets", () => {
    expect(normaliseResult(pb, typed(11, 7, { sets: [[6, 4]] })).sets).toBeNull();
    expect(normaliseResult(tennis, typed(2, 0, { sets: [[6, 4], [6, 3]] })).sets).toEqual([[6, 4], [6, 3]]);
    expect(normaliseResult(tennis, typed(2, 0, { sets: [] })).sets).toBeNull();
  });
});

describe("a result recorded without a rating stops before the end, never after it", () => {
  it("points: short of the end is fine, past it is a slip — with the score meant", () => {
    expect(resultProblem(knockout, pb, typed(9, 7, { outcome: "retired" }), false)).toBeNull();
    expect(resultProblem(knockout, pb, typed(111, 4, { outcome: "retired" }), false)).toMatchObject({
      code: "invalid", suggestion: { a: 11, b: 4 },
    });
  });

  it("carrom to 25: both sides past 25 cannot have happened, stopped or not", () => {
    expect(resultProblem(knockout, carrom25, typed(26, 25, { outcome: "unrated" }), true)?.code).toBe("invalid");
    expect(resultProblem(knockout, carrom25, typed(20, 12, { outcome: "unrated" }), true)).toBeNull();
  });

  it("tennis: the set it stopped in may be part-played; every set before it is a finished set", () => {
    const r = (a: number, b: number, sets: [number, number][]) =>
      resultProblem(knockout, tennis, normaliseResult(tennis, typed(a, b, { outcome: "retired", sets })), false);
    expect(r(1, 0, [[6, 4], [3, 2]])).toBeNull();
    expect(r(1, 1, [[6, 4], [3, 6], [2, 1]])?.code).toBe("no-winner");
    expect(r(1, 0, [[6, 5], [3, 2]])).toMatchObject({ code: "invalid", error: expect.stringContaining("Set 1, 6–5") });
    expect(r(2, 0, [[0, 6], [0, 6], [0, 6]])?.error).toBe("The match was over after set 2 — set 3 can't have been played.");
    expect(r(3, 0, [[6, 4], [6, 4]])?.code).toBe("invalid");   // nobody wins three sets of a best of 3
  });

  /* A set is over at 6–4: it never stood at 9–2. The set it stopped in was
     waived whatever it said. */
  it("tennis: the set it stopped in stands at a score that set really passes through", () => {
    const r = (a: number, b: number, sets: [number, number][]) =>
      resultProblem(knockout, tennis, normaliseResult(tennis, typed(a, b, { outcome: "retired", sets })), false);
    expect(r(1, 0, [[6, 4], [6, 5]])).toBeNull();
    expect(r(1, 0, [[6, 4], [6, 6]])).toBeNull();
    expect(r(1, 0, [[6, 4], [5, 5]])).toBeNull();
    expect(r(2, 0, [[6, 4], [9, 2]])).toMatchObject({
      code: "invalid", error: "Set 2, 9–2: a set is over before it gets there, so the match can't have stopped at that score.",
    });
    expect(r(1, 0, [[6, 4], [7, 2]])?.code).toBe("invalid");
    /* A match tie-break to 10 only as the deciding set, and only short of its end. */
    expect(r(2, 1, [[6, 4], [3, 6], [8, 3]])).toBeNull();
    expect(r(2, 1, [[6, 4], [3, 6], [11, 10]])).toBeNull();
    expect(r(2, 1, [[6, 4], [3, 6], [12, 8]])?.code).toBe("invalid");
    expect(r(1, 0, [[6, 4], [11, 10]])?.code).toBe("invalid");
  });

  /* "0–2 ret." over 6–4 6–4 handed the match to the side that had lost it. */
  it("tennis: a match the sets show already won is not awarded to the other side", () => {
    const r = (a: number, b: number, sets: [number, number][]) =>
      resultProblem(knockout, tennis, normaliseResult(tennis, typed(a, b, { outcome: "retired", sets })), false);
    expect(r(0, 2, [[6, 4], [6, 4]])).toMatchObject({
      code: "invalid", error: "The sets show the match already won, 2–0 in sets — it can't be awarded to the other side.",
    });
    expect(r(2, 0, [[6, 4], [6, 4]])).toBeNull();
    /* Undecided when it stopped: awarded to either side. */
    expect(r(0, 2, [[6, 4], [3, 2]])).toBeNull();
  });

  /* Decided by the sets, it was not cut short: "1–0 ret." over 6–4 6–3
     printed a score no set agrees with. */
  it("tennis: a match the sets show decided is recorded at the sets' score", () => {
    const r = (a: number, b: number, sets: [number, number][]) =>
      resultProblem(knockout, tennis, normaliseResult(tennis, typed(a, b, { outcome: "retired", sets })), false);
    expect(r(1, 0, [[6, 4], [6, 3]])).toMatchObject({
      code: "invalid",
      error: "The sets show the match won 2–0 in sets, so that is the score to record.",
      suggestion: { a: 2, b: 0 },
    });
  });

  /* The decider is a match tie-break to 10, so 6–4 in it is a tie-break being
     played, not a set won. Read as a set, a retirement there was refused with
     "the match already won". */
  it("tennis: a retirement in the deciding tie-break short of 10 is a match still undecided", () => {
    const r = (a: number, b: number, sets: [number, number][]) =>
      resultProblem(knockout, tennis, normaliseResult(tennis, typed(a, b, { outcome: "retired", sets })), false);
    expect(r(1, 2, [[6, 4], [4, 6], [6, 4]])).toBeNull();
    expect(r(2, 1, [[6, 4], [4, 6], [7, 6]])).toBeNull();
  });
});
