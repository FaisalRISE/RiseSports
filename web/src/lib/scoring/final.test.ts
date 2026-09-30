import { describe, it, expect } from "vitest";

import { endingFor, finalScoreProblem, type Ending } from "./final";
import { rallyOver } from "./replay";
import { buildScoring, resolveRules, type RuleOverrides, type Rules } from "./rules";
import { oslRuleOverrides } from "@/lib/formats/osl";
import { picklebossRuleOverrides } from "@/lib/formats/pickleboss";

/* Which final scores a match could really end on.
 *
 * The heart of it is the brute force below: for every rule set the app can
 * produce, enumerate every score a game can REACH from 0–0, a point a rally,
 * without passing a state that was already over — and require the check to
 * agree with that on every score from 0–0 to 40–40, both ways round. The check
 * walks one path instead of all of them; this is what makes that safe. */

const rules = (sport: "pb" | "bd" | "tt" | "cr", over?: RuleOverrides) => resolveRules(sport, over)!;
const points = (r: Rules): Ending => ({ kind: "points", rules: r });

const RULE_SETS: [string, Rules][] = [
  ["pickleball to 11", rules("pb")],
  ["badminton to 21, cap 30", rules("bd")],
  ["table tennis to 11", rules("tt")],
  ["OSL (pickleball)", rules("pb", oslRuleOverrides())],
  ["OSL (badminton)", rules("bd", oslRuleOverrides())],
  ["Pickleboss", rules("pb", picklebossRuleOverrides())],
  ["to 11, first to 11 (no win by 2)", rules("pb", { target: 11, ...buildScoring(11, false, "auto", null) })],
  ["to 15, win by 2, no ceiling", rules("pb", { target: 15, ...buildScoring(15, true, "none", null) })],
  ["to 21, golden point automatic", rules("pb", { target: 21, ...buildScoring(21, true, "auto", null) })],
  ["to 11, golden point at 13", rules("pb", { target: 11, ...buildScoring(11, true, 13, null) })],
  /* A golden point set BELOW the target puts the cap first: the game ends
     there, and the sentences must name that, not the target. */
  ["to 21, golden point at 19 (ends at 20)", rules("bd", { target: 21, ...buildScoring(21, true, 19, null) })],
  ["to 11, golden point at 5 (ends at 6)", rules("pb", { target: 11, ...buildScoring(11, true, 5, null) })],
];

/** Every final a game can reach, found by trying every path. */
function reachableFinals(r: Rules, max = 41): Set<string> {
  const finals = new Set<string>();
  const seen = new Set<string>();
  const stack: [number, number][] = [[0, 0]];
  while (stack.length) {
    const [a, b] = stack.pop()!;
    const key = `${a}-${b}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (rallyOver(a, b, r)) {
      finals.add(key);
      continue;
    }
    if (a < max) stack.push([a + 1, b]);
    if (b < max) stack.push([a, b + 1]);
  }
  return finals;
}

/** The rating engine's check before step 6, kept verbatim so the reason for
    each new refusal stays visible. */
function oldValidScore(r: Rules | null, w: number, l: number): boolean {
  if (!r) return w > l;
  if (w <= l) return false;
  if (r.cap != null && w > r.cap) return false;
  if (w < r.target) return false;
  if (w - l >= r.winBy) return true;
  return r.cap != null && w === r.cap;
}

describe("a game, a point a rally: the one path agrees with every path", () => {
  for (const [name, r] of RULE_SETS) {
    it(`agrees on every score to 40–40: ${name}`, () => {
      const finals = reachableFinals(r);
      const wrong: string[] = [];
      for (let a = 0; a <= 40; a++) {
        for (let b = 0; b <= 40; b++) {
          const possible = finals.has(`${a}-${b}`);
          const accepted = finalScoreProblem(points(r), a, b) === null;
          if (possible !== accepted) wrong.push(`${a}–${b} ${possible ? "happens" : "can't happen"}`);
        }
      }
      expect(wrong).toEqual([]);
    });

    /* It only ever refuses MORE than the old check did: whatever it accepts,
       the old check accepted too — wherever the game ends at or after the
       target. With a golden point BELOW the target the old check was wrong
       the other way (below). */
    if (r.cap == null || r.cap >= r.target) {
      it(`never accepts what the old check refused: ${name}`, () => {
        for (let a = 0; a <= 40; a++) {
          for (let b = 0; b <= 40; b++) {
            if (finalScoreProblem(points(r), a, b) === null) {
              expect(oldValidScore(r, Math.max(a, b), Math.min(a, b)), `${a}–${b}`).toBe(true);
            }
          }
        }
      });
    }
  }

  /* "To 21, golden point at 19" ends at 20: at 19–19 the next rally decides
     it. The console ends games on 20–0 and 20–19, and the old check refused
     both for not reaching 21 — a real result, no rating. */
  it("accepts the games a golden point below the target really ends, which the old check refused", () => {
    const r = rules("bd", { target: 21, ...buildScoring(21, true, 19, null) });
    for (const [w, l] of [[20, 0], [20, 19]]) {
      expect(finalScoreProblem(points(r), w, l)).toBeNull();
      expect(oldValidScore(r, w, l)).toBe(false);
    }
  });
});

describe("the finals it refuses, by name", () => {
  const pb = points(rules("pb"));
  const bd = points(rules("bd"));
  const osl = points(rules("pb", oslRuleOverrides()));

  it("15–4 in a game to 11: over at 11–4 — which the old check ACCEPTED", () => {
    expect(finalScoreProblem(pb, 15, 4)).toEqual({
      code: "past-the-end",
      sentence: "A game to 11 ends at 11–4 — 15–4 can't happen. Did you mean 11–4?",
      suggestion: { a: 11, b: 4 },
    });
    expect(oldValidScore(rules("pb"), 15, 4)).toBe(true);
  });

  it("23–20 in badminton: over at 22–20 — which the old check ACCEPTED", () => {
    expect(finalScoreProblem(bd, 23, 20)?.suggestion).toEqual({ a: 22, b: 20 });
    expect(oldValidScore(rules("bd"), 23, 20)).toBe(true);
  });

  it("11–10 and 9–7 aren't finished games", () => {
    expect(finalScoreProblem(pb, 11, 10)?.sentence).toBe(
      "11–10 isn't a finished game: at 10–10 play goes on until someone leads by 2.",
    );
    expect(finalScoreProblem(pb, 9, 7)?.sentence).toBe(
      "9–7 isn't a finished game: a game to 11 ends when someone reaches 11.",
    );
    expect(finalScoreProblem(bd, 29, 28)?.sentence).toBe(
      "29–28 isn't a finished game: at 20–20 play goes on until someone leads by 2 or reaches 30.",
    );
  });

  it("31–29 in badminton stops at the cap: 30–29", () => {
    expect(finalScoreProblem(bd, 31, 29)?.suggestion).toEqual({ a: 30, b: 29 });
  });

  it("26–24 under OSL: the golden point ends it at 25–24", () => {
    expect(finalScoreProblem(osl, 26, 24)?.suggestion).toEqual({ a: 25, b: 24 });
  });

  /* Even the LOSER's score is past the end: the game stopped before either
     side got there. The suggestion is where it stopped, with the side that won
     still winning — never the other side ahead. */
  it("stops a score where both sides are past the end at the point the game ended", () => {
    expect(finalScoreProblem(bd, 31, 30)?.suggestion).toEqual({ a: 30, b: 29 });
    expect(finalScoreProblem(osl, 26, 25)?.suggestion).toEqual({ a: 25, b: 24 });
    expect(finalScoreProblem(osl, 25, 26)?.suggestion).toEqual({ a: 24, b: 25 });
  });

  it("puts the suggestion back in the order it was typed", () => {
    expect(finalScoreProblem(pb, 4, 15)?.suggestion).toEqual({ a: 4, b: 11 });
  });

  it("accepts a game that ran on past the target by two", () => {
    expect(finalScoreProblem(pb, 13, 11)).toBeNull();
    expect(finalScoreProblem(bd, 30, 29)).toBeNull();
  });

  it("refuses a level score, a negative and a fraction", () => {
    expect(finalScoreProblem(pb, 7, 7)?.code).toBe("level");
    expect(finalScoreProblem(pb, -1, 11)?.code).toBe("not-a-score");
    expect(finalScoreProblem(pb, 11, 4.5)?.code).toBe("not-a-score");
  });
});

describe("games won in a best-of match", () => {
  const bo3: Ending = { kind: "games", bestOf: 3 };
  const bo5: Ending = { kind: "games", bestOf: 5 };

  it("accepts 2–0 and 2–1 in a best of 3, and 3–2 in a best of 5", () => {
    expect(finalScoreProblem(bo3, 2, 0)).toBeNull();
    expect(finalScoreProblem(bo3, 1, 2)).toBeNull();
    expect(finalScoreProblem(bo5, 3, 2)).toBeNull();
  });

  it("refuses a match played past its end, and says what was meant", () => {
    expect(finalScoreProblem(bo3, 3, 0)).toEqual({
      code: "past-the-end",
      sentence: "A best-of-3 match ends when someone wins 2 games — 3–0 can't happen. Did you mean 2–0?",
      suggestion: { a: 2, b: 0 },
    });
  });

  it("refuses an unfinished or level match", () => {
    expect(finalScoreProblem(bo3, 1, 0)?.code).toBe("unfinished");
    expect(finalScoreProblem(bo3, 1, 1)?.code).toBe("level");
    expect(finalScoreProblem(bo5, 2, 1)?.code).toBe("unfinished");
  });
});

describe("carrom: both endings Faisal's events use", () => {
  const firstTo25 = endingFor("cr", rules("cr"));
  const boards = endingFor("cr", rules("cr"), { carromBoards: true });

  it("first to 25: the last board may carry the winner past 25", () => {
    expect(firstTo25).toEqual({ kind: "boards", target: 25, cap: null });
    expect(finalScoreProblem(firstTo25, 29, 18)).toBeNull();
    expect(finalScoreProblem(firstTo25, 25, 0)).toBeNull();
  });

  it("first to 25: not finished below 25, never level, and only one side reaches 25", () => {
    expect(finalScoreProblem(firstTo25, 19, 14)).toEqual({
      code: "unfinished",
      sentence: "19–14 isn't finished: a match to 25 ends when someone reaches 25.",
    });
    expect(finalScoreProblem(firstTo25, 20, 20)).toEqual({ code: "level", sentence: "A carrom match to 25 can't end level." });
    expect(finalScoreProblem(firstTo25, 26, 25)).toEqual({
      code: "both-past-the-target",
      sentence: "Only one side can reach 25 — the match ends the moment somebody does, so 26–25 can't happen.",
    });
  });

  it("follows the event's own target", () => {
    const to29 = endingFor("cr", rules("cr", { target: 29 }));
    expect(to29).toEqual({ kind: "boards", target: 29, cap: null });
    expect(finalScoreProblem(to29, 27, 20)?.code).toBe("unfinished");
    expect(finalScoreProblem(to29, 33, 20)).toBeNull();
  });

  /* Saving the scoring form with "win by two" unticked stores cap = target, and
     OSL does the same. Neither is a carrom "stop at 25"; read as one, they
     refused a real last board past the target. */
  it("ignores the cap that comes with carrom's own scoring", () => {
    const saved = endingFor("cr", rules("cr", { target: 25, ...buildScoring(25, false, "auto", null) }));
    const osl = endingFor("cr", rules("cr", oslRuleOverrides()));
    expect(saved).toEqual({ kind: "boards", target: 25, cap: null });
    expect(osl).toEqual({ kind: "boards", target: 25, cap: null });
    expect(finalScoreProblem(saved, 29, 18)).toBeNull();
    expect(finalScoreProblem(osl, 29, 18)).toBeNull();
  });

  it("a fixed number of boards: most points wins, and a level result is a result", () => {
    expect(finalScoreProblem(boards, 19, 14)).toBeNull();
    expect(finalScoreProblem(boards, 20, 20)).toBeNull();
  });

  /* Every scoring setup the manage screen or a preset can give a carrom event,
     and whatever the referee console can end a game on under it must be a
     final this check accepts — or the table counts a result the ratings
     refuse. Win by two, a golden point above the target, the Pickleboss preset:
     the console plays those point by point (27–25, 17–15), so they are judged
     point by point, exactly. Carrom's own scoring keeps its last-board rule,
     which accepts everything the console can reach and more (29–18). */
  const CARROM: [string, Rules, "exact" | "at-least"][] = [
    ["carrom to 25", rules("cr"), "at-least"],
    ["carrom to 29", rules("cr", { target: 29 }), "at-least"],
    ["carrom saved with win-by-two unticked", rules("cr", { target: 25, ...buildScoring(25, false, "auto", null) }), "at-least"],
    ["carrom under OSL", rules("cr", oslRuleOverrides()), "at-least"],
    ["carrom, win by 2, no ceiling", rules("cr", { target: 25, ...buildScoring(25, true, "none", null) }), "exact"],
    ["carrom, win by 2, golden point automatic", rules("cr", { target: 25, ...buildScoring(25, true, "auto", null) }), "exact"],
    ["carrom under Pickleboss", rules("cr", picklebossRuleOverrides()), "exact"],
  ];
  for (const [name, r, how] of CARROM) {
    it(`accepts every final the console can end on: ${name}`, () => {
      const ending = endingFor("cr", r);
      expect(ending.kind).toBe(how === "exact" ? "points" : "boards");
      const finals = reachableFinals(r);
      const wrong: string[] = [];
      for (let a = 0; a <= 40; a++) {
        for (let b = 0; b <= 40; b++) {
          const possible = finals.has(`${a}-${b}`);
          const accepted = finalScoreProblem(ending, a, b) === null;
          if (how === "exact" ? possible !== accepted : possible && !accepted) wrong.push(`${a}–${b}`);
        }
      }
      expect(wrong).toEqual([]);
    });
  }
});

describe("tennis and padel: sets, and the games in each", () => {
  const bo3 = endingFor("tn", null);
  const bo5: Ending = { kind: "sets", bestOf: 5 };

  it("sets won alone: 2–1 and 2–0, not 3–0 or 1–1", () => {
    expect(finalScoreProblem(bo3, 2, 1)).toBeNull();
    expect(finalScoreProblem(bo3, 0, 2)).toBeNull();
    expect(finalScoreProblem(bo3, 3, 0)?.sentence).toBe(
      "A best-of-3 match ends when someone wins 2 sets — 3–0 can't happen. Did you mean 2–0?",
    );
    expect(finalScoreProblem(bo3, 1, 1)?.code).toBe("level");
  });

  it("the games in each set: regular sets, 7–5, 7–6, and a deciding tie-break to 10", () => {
    expect(finalScoreProblem(bo3, 2, 1, [[6, 4], [3, 6], [10, 8]])).toBeNull();
    expect(finalScoreProblem(bo3, 2, 1, [[7, 6], [6, 7], [7, 5]])).toBeNull();
    expect(finalScoreProblem(bo3, 2, 1, [[6, 4], [4, 6], [12, 10]])).toBeNull();
    expect(finalScoreProblem(bo3, 0, 2, [[4, 6], [0, 6]])).toBeNull();
    expect(finalScoreProblem(bo5, 3, 2, [[6, 4], [4, 6], [6, 3], [3, 6], [7, 6]])).toBeNull();
    expect(endingFor("pd", null)).toEqual({ kind: "sets", bestOf: 3 });
  });

  it("refuses a set that isn't finished, or is level", () => {
    expect(finalScoreProblem(bo3, 2, 0, [[6, 5], [6, 2]])).toEqual({
      code: "set-invalid",
      sentence: "Set 1, 6–5, isn't a finished set: a set ends 6–0 to 6–4, 7–5, or 7–6 on a tie-break.",
    });
    expect(finalScoreProblem(bo3, 2, 0, [[8, 6], [6, 2]])?.code).toBe("set-invalid");
    expect(finalScoreProblem(bo3, 2, 0, [[6, 6], [6, 2]])?.code).toBe("set-level");
  });

  it("allows the tie-break to 10 only as the deciding set", () => {
    expect(finalScoreProblem(bo3, 2, 0, [[10, 8], [6, 2]])?.code).toBe("tiebreak-not-deciding");
    expect(finalScoreProblem(bo3, 2, 1, [[6, 4], [3, 6], [13, 10]])?.code).toBe("set-invalid");
    expect(finalScoreProblem(bo3, 2, 1, [[6, 4], [3, 6], [9, 7]])?.code).toBe("set-invalid");
  });

  it("refuses a set played after the match was won", () => {
    expect(finalScoreProblem(bo3, 3, 0, [[6, 4], [6, 3], [6, 2]])?.sentence).toBe(
      "The match was over after set 2 — set 3 can't have been played.",
    );
  });

  it("refuses sets that don't finish the match, or disagree with the sets won", () => {
    expect(finalScoreProblem(bo3, 1, 1, [[6, 4], [3, 6]])?.code).toBe("unfinished");
    expect(finalScoreProblem(bo3, 2, 0, [[6, 4], [3, 6], [6, 1]])).toEqual({
      code: "sets-disagree",
      sentence: "The sets add up to 2–1, not 2–0.",
      suggestion: { a: 2, b: 1 },
    });
  });
});

describe("which ending each sport gets", () => {
  it("one game for the rally sports, games won when a stage is best of more", () => {
    expect(endingFor("pb", rules("pb")).kind).toBe("points");
    expect(endingFor("bd", rules("bd")).kind).toBe("points");
    expect(endingFor("tt", rules("tt")).kind).toBe("points");
    expect(endingFor("pb", rules("pb"), { bestOf: 3 })).toEqual({ kind: "games", bestOf: 3 });
  });

  /* Chess waits for its result buttons (step 10) and keeps the check the rating
     engine made before: 1–0 is a result, a level score is not (yet). */
  it("chess keeps the old check until it has result buttons", () => {
    const chess = endingFor("ch", resolveRules("ch", undefined));
    expect(chess.kind).toBe("result");
    expect(finalScoreProblem(chess, 1, 0)).toBeNull();
    expect(finalScoreProblem(chess, 0, 1)).toBeNull();
    expect(finalScoreProblem(chess, 1, 1)).not.toBeNull();
  });
});

describe("the wording and the typed order, for each kind of refusal", () => {
  const pb = points(rules("pb"));
  const bd = points(rules("bd"));
  const games: Ending = { kind: "games", bestOf: 3 };
  const sets = endingFor("tn", null);

  it("keeps the side that won winning when the score was typed loser first", () => {
    expect(finalScoreProblem(pb, 4, 15)).toEqual({
      code: "past-the-end",
      sentence: "A game to 11 ends at 4–11 — 4–15 can't happen. Did you mean 4–11?",
      suggestion: { a: 4, b: 11 },
    });
    expect(finalScoreProblem(games, 0, 3)).toEqual({
      code: "past-the-end",
      sentence: "A best-of-3 match ends when someone wins 2 games — 0–3 can't happen. Did you mean 0–2?",
      suggestion: { a: 0, b: 2 },
    });
    expect(finalScoreProblem(sets, 0, 3)?.suggestion).toEqual({ a: 0, b: 2 });
  });

  /* 3–2 in a best of 3: both sides are past the winning number, so there is no
     score to point at — 2–2 would be level, which this check refuses too. */
  it("offers no suggestion when both sides are past the winning number", () => {
    expect(finalScoreProblem(games, 3, 2)).toEqual({
      code: "past-the-end",
      sentence: "A best-of-3 match ends when someone wins 2 games — 3–2 can't happen.",
    });
    expect(finalScoreProblem(sets, 3, 2)?.suggestion).toBeUndefined();
  });

  it("says each refusal in words, with the right numbers", () => {
    expect(finalScoreProblem(bd, 23, 20)?.sentence).toBe("A game to 21 ends at 22–20 — 23–20 can't happen. Did you mean 22–20?");
    expect(finalScoreProblem(games, 1, 1)?.sentence).toBe("A best-of-3 match can't end level — someone has to win 2 games.");
    expect(finalScoreProblem(games, 1, 0)?.sentence).toBe("1–0 isn't finished: a best-of-3 match is won with 2 games.");
    expect(finalScoreProblem(sets, 1, 1)?.sentence).toBe("A best-of-3 match can't end level — someone has to win 2 sets.");
    expect(finalScoreProblem(sets, 1, 1, [[6, 4], [3, 6]])?.sentence).toBe(
      "1–1 in sets isn't finished: a best-of-3 match is won with 2 sets.",
    );
    expect(finalScoreProblem(sets, 2, 0, [[6, 6], [6, 2]])?.sentence).toBe("Set 1 can't end level (6–6).");
    expect(finalScoreProblem(sets, 2, 0, [[10, 8], [6, 2]])?.sentence).toBe(
      "Set 1, 10–8: a tie-break to 10 only decides the last set, when the sets are level.",
    );
  });

  /* "To 21, golden point at 19" ends at 20. Naming 21 pointed the organiser at
     a score the same check then refused. */
  it("names where a game really ends when a golden point sits below the target", () => {
    const early = points(rules("bd", { target: 21, ...buildScoring(21, true, 19, null) }));
    expect(finalScoreProblem(early, 19, 15)?.sentence).toBe(
      "19–15 isn't a finished game: a game to 20 ends when someone reaches 20.",
    );
    expect(finalScoreProblem(early, 21, 15)).toEqual({
      code: "past-the-end",
      sentence: "A game to 20 ends at 20–15 — 21–15 can't happen. Did you mean 20–15?",
      suggestion: { a: 20, b: 15 },
    });
  });

  /* The walk is as long as the loser's score. Unbounded, a huge one ran for a
     minute; past 2^53 it never ended. No real final reaches four figures. */
  it("refuses anything past 999 at once", () => {
    expect(finalScoreProblem(pb, 1000, 3)?.code).toBe("not-a-score");
    expect(finalScoreProblem(pb, 2 ** 53 + 4, 2 ** 53 + 2)?.code).toBe("not-a-score");
    expect(finalScoreProblem(pb, 998, 996)).toBeNull();
  });
});

describe("more of the set rules", () => {
  const bo3 = endingFor("tn", null);

  it("accepts any deciding tie-break to 10, not only 10–8", () => {
    expect(finalScoreProblem(bo3, 2, 1, [[6, 4], [3, 6], [10, 6]])).toBeNull();
    expect(finalScoreProblem(bo3, 2, 1, [[6, 4], [3, 6], [10, 0]])).toBeNull();
  });

  it("refuses a set that ran past 6 without being close", () => {
    expect(finalScoreProblem(bo3, 2, 0, [[7, 4], [6, 2]])?.code).toBe("set-invalid");
  });

  it("refuses a tie-break to 10 in set 2 of a best of 3, where the sets were not level", () => {
    expect(finalScoreProblem(bo3, 2, 0, [[6, 4], [10, 8]])?.code).toBe("tiebreak-not-deciding");
  });

  it("refuses a negative or fractional set score, and judges an empty list as sets won", () => {
    expect(finalScoreProblem(bo3, 2, 0, [[6, -1], [6, 2]])?.code).toBe("not-a-score");
    expect(finalScoreProblem(bo3, 2, 0, [[6, 3.5], [6, 2]])?.code).toBe("not-a-score");
    expect(finalScoreProblem(bo3, 2, 1, [])).toBeNull();
  });

  it("best of 5, chosen per stage, with the deciding tie-break only in the fifth", () => {
    const bo5 = endingFor("tn", null, { bestOf: 5 });
    expect(bo5).toEqual({ kind: "sets", bestOf: 5 });
    expect(finalScoreProblem(bo5, 3, 2, [[6, 4], [4, 6], [6, 3], [3, 6], [10, 8]])).toBeNull();
    expect(finalScoreProblem(bo5, 3, 1, [[6, 4], [4, 6], [10, 8], [6, 3]])?.code).toBe("tiebreak-not-deciding");
  });
});
