import { describe, it, expect } from "vitest";
import { matchResult, hasPlay, matchLine } from "./index";
import { viewMatch } from "@/lib/matchState";
import type { Match, Tournament } from "@/lib/db/schema";

/* Real match rows through the real `viewMatch`: what is checked is "which score
 * is the result", not whether a helper copies the object it was handed. */

const event = (sport: string) =>
  ({ id: "t1", slug: "cup", name: "Cup", sport, format: "standard", scoring: null }) as unknown as Tournament;

let n = 0;
const match = (over: Partial<Match>): Match => ({
  id: `m${++n}`, tournamentId: "t1", divisionId: "d1", round: "Group A · R1",
  court: null, scheduledAt: null, groupId: null, teamAId: "ta", teamBId: "tb",
  slotA: null, slotB: null, log: [], server: "a", posA: 0, posB: 0,
  lineupA: [], lineupB: [], ackedGates: [], typedScoreA: null, typedScoreB: null,
  timing: null, rev: 0, updatedAt: new Date(), createdAt: new Date(),
  ...over,
} as unknown as Match);

/* Badminton scores every rally, so a run of "a" is a readable log: 21 of them
   is a finished 21–0, five is a match still being played. */
const rallies = (k: number) => Array.from({ length: k }, () => "a");

describe("what a match's result is", () => {
  it("is the typed pair when both boxes are filled", () => {
    expect(matchResult(event("pb"), match({ typedScoreA: 11, typedScoreB: 7 }))).toEqual({
      a: 11, b: 7, winner: "a", draw: false, source: "typed", display: "11–7",
    });
  });

  it("is the replayed score once a refereed match is over", () => {
    const r = matchResult(event("bd"), match({ log: rallies(21) as never }));
    expect(r).toMatchObject({ a: 21, b: 0, winner: "a", source: "live", display: "21–0" });
  });

  it("is nothing while a refereed match is still being played", () => {
    expect(matchResult(event("bd"), match({ log: rallies(5) as never }))).toBeNull();
  });

  it("is nothing with only one box typed", () => {
    expect(matchResult(event("pb"), match({ typedScoreA: 11 }))).toBeNull();
  });

  it("is a draw only where the sport allows one", () => {
    expect(matchResult(event("ch"), match({ typedScoreA: 1, typedScoreB: 1 })))
      .toMatchObject({ winner: null, draw: true });
    /* Level in pickleball decides nothing — no winner, and not a draw either. */
    expect(matchResult(event("pb"), match({ typedScoreA: 9, typedScoreB: 9 })))
      .toMatchObject({ winner: null, draw: false });
  });

  it("uses a view the caller already has", () => {
    const m = match({ log: rallies(21) as never });
    const v = viewMatch(event("bd"), m);
    expect(matchResult(event("bd"), m, v)).toEqual(matchResult(event("bd"), m));
  });
});

describe("has anything been recorded", () => {
  it("counts a rally, and either typed box on its own", () => {
    expect(hasPlay(match({}))).toBe(false);
    expect(hasPlay(match({ log: ["a"] as never }))).toBe(true);
    expect(hasPlay(match({ typedScoreA: 3 }))).toBe(true);
    /* The three old checks looked at box A only, so a score half-typed into
       box B was "not started" and a redraw would throw it away. */
    expect(hasPlay(match({ typedScoreB: 3 }))).toBe(true);
  });
});

describe("the manage screen's line for a match", () => {
  it("shows a typed result as final", () => {
    expect(matchLine(event("pb"), match({ typedScoreA: 11, typedScoreB: 7 })))
      .toEqual({ score: "11–7", tag: " · final", finished: true });
  });

  /* The expression the list used before, kept so the reason for this module
     stays visible: it read the rally log only. */
  it("used to show that same typed result as 0–0, not final", () => {
    const m = match({ typedScoreA: 11, typedScoreB: 7 });
    const v = viewMatch(event("pb"), m);
    const oldScore = `${v.a}–${v.b}`;
    const oldTag = v.over ? " · final" : v.rallies > 0 ? " · live" : "";
    expect([oldScore, oldTag]).toEqual(["0–0", ""]);
  });

  it("shows a match in play as live, with its running score", () => {
    expect(matchLine(event("bd"), match({ log: rallies(5) as never })))
      .toEqual({ score: "5–0", tag: " · live", finished: false });
  });
});
