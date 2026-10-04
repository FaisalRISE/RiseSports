/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Which final scores a match could really end on.
 *
 * The rating engine asked only "did the winner reach the target, by the
 * margin?" (the old `validScore`), which accepts finals no game produces:
 * 15–4 in a game to 11, or 23–20 in badminton, where the game was over at
 * 22–20. A typed result has to be judged by the SAME rules the referee's
 * console plays, and the rating engine has to reach the same verdict — or the
 * table counts a result the ratings quietly skip, and nobody is told. This is
 * that one judgement, and everything that needs it asks here.
 *
 * One check cannot fit every sport, so an ENDING says which kind of match it
 * is (Faisal's answers, 2026-09-29, are what shape each):
 *
 *  - points  One game, a point a rally — pickleball, badminton, table tennis.
 *            Judged by walking the only path that could reach the score with
 *            the engine's own `rallyOver`.
 *  - games   Games won in a best-of-N match ("Yes, sometimes" — typed as 2–1).
 *            Chosen per stage, e.g. groups one game and the knockout best of 3.
 *  - boards  Carrom. Both endings are played: first to 25, where the last board
 *            can carry the winner past 25 and it never ends level; or a fixed
 *            number of boards, most points wins, and it can end level. Only in
 *            carrom's OWN scoring (one point decides): a carrom event the
 *            organiser set to win by two, or to the Pickleboss preset, is played
 *            point by point on the console and judged as `points`.
 *  - sets    Tennis and padel: sets won, and — when given — the games in each
 *            set, which is how Faisal wants them recorded (6–4 3–6 10–8).
 *  - result  Chess, until step 10 gives it result buttons and rated draws. It
 *            keeps exactly the check the rating engine made before.
 *
 * Pure: no clock, no database. The only thing it reads is the rules it is
 * handed, which the caller has already resolved for the match. */

import { rallyOver } from "./replay";
import type { Rules } from "./rules";
import { sportOf, type SportId } from "@/lib/sports/registry";

export type Ending =
  | { kind: "points"; rules: Rules }
  | { kind: "games"; bestOf: number }
  /** `target` null is a fixed number of boards: most points wins, level allowed. */
  | { kind: "boards"; target: number | null; cap: number | null }
  | { kind: "sets"; bestOf: number }
  | { kind: "result"; rules: Rules | null };

/** One set's games, side A then side B. */
export type SetScore = readonly [number, number];

export type ScoreProblemCode =
  | "not-a-score"
  | "level"
  | "unfinished"
  | "past-the-end"
  | "both-past-the-target"
  | "set-invalid"
  | "set-level"
  | "tiebreak-not-deciding"
  | "set-after-the-end"
  | "sets-disagree";

export type ScoreProblem = {
  code: ScoreProblemCode;
  /** One plain sentence for whoever typed it, naming what is wrong. */
  sentence: string;
  /** The score they most likely meant, in the order they typed it. */
  suggestion?: { a: number; b: number };
};

/**
 * The ending a match in this sport is judged by.
 *
 * `bestOf` above one makes a points sport a games-won match; `carromBoards`
 * makes carrom a fixed number of boards. Neither has a setting yet — they come
 * with the result screens (step 7 onwards) — so every caller today gets one
 * game, first-to-the-target carrom, and best-of-3 sets.
 */
export function endingFor(
  sport: SportId,
  rules: Rules | null,
  opts: { bestOf?: number; carromBoards?: boolean } = {},
): Ending {
  const sp = sportOf(sport);
  if (sp.setBased) return { kind: "sets", bestOf: opts.bestOf ?? 3 };
  if (sp.id === "ch") return { kind: "result", rules };
  if (sp.id === "cr") {
    if (opts.carromBoards) return { kind: "boards", target: null, cap: null };
    /* Carrom's OWN scoring — first to the target, one point decides — is
       where the last board can carry the winner past the target. The cap
       that comes with it is not a carrom rule: saving the scoring form with
       "win by two" unticked stores cap = target (`buildScoring`), and OSL
       does the same; read as "stop at 25" it refused a real 29–18. So in
       that shape the cap is dropped. Any OTHER shape the organiser set — win
       by two, a golden point above the target, the Pickleboss preset — is
       played point by point on the console (it ends 27–25 or 17–15), so it
       is judged point by point here too, or the table would count a final
       the ratings refuse. */
    if (!rules) return { kind: "boards", target: 25, cap: null };
    const carromShape = rules.winBy === 1 && (rules.cap == null || rules.cap === rules.target);
    return carromShape ? { kind: "boards", target: rules.target, cap: null } : { kind: "points", rules };
  }
  if ((opts.bestOf ?? 1) > 1) return { kind: "games", bestOf: opts.bestOf! };
  if (!rules) return { kind: "result", rules: null };
  return { kind: "points", rules };
}

/**
 * Why this final score could not have happened, or null when it could.
 *
 * `a` and `b` are the two sides as typed: points, games won, boards' points or
 * sets won, by the ending. For sets, `sets` may carry each set's games; the
 * sets-won pair must then agree with them.
 */
export function finalScoreProblem(
  ending: Ending,
  a: number,
  b: number,
  sets?: readonly SetScore[],
): ScoreProblem | null {
  if (!isScore(a) || !isScore(b)) return NOT_A_SCORE;
  switch (ending.kind) {
    case "points": return pointsProblem(ending.rules, a, b);
    case "games": return bestOfProblem(ending.bestOf, a, b, "game");
    case "boards": return boardsProblem(ending, a, b);
    case "sets": return setsProblem(ending.bestOf, a, b, sets);
    case "result": return resultProblem(ending.rules, a, b);
  }
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

/** No real final reaches four figures, and the walk below is as long as the
    loser's score: an unbounded one could be made to run for ever. The score
    boxes already stop at 999 (`recordResult`). */
export const MAX_SCORE = 999;
const isScore = (n: number) => Number.isInteger(n) && n >= 0 && n <= MAX_SCORE;
const dash = (x: number, y: number) => `${x}–${y}`;

const NOT_A_SCORE: ScoreProblem = {
  code: "not-a-score",
  sentence: `A score is a whole number from 0 to ${MAX_SCORE}.`,
};

/** A game, one point a rally. The last rally is always the winner's: a point
 *  to the loser can never end a game in the winner's favour. So the only path
 *  worth walking is the one that stays level longest — alternate up to the
 *  loser's score, then the winner runs on — and every other path passes
 *  through states at least as "over" as it (a bigger lead, a higher score).
 *  If this one ends early, they all do. The brute-force test holds the walk to
 *  every path, for every preset. */
function pointsProblem(r: Rules, a: number, b: number): ScoreProblem | null {
  if (a === b) return { code: "level", sentence: "A game can't end level — somebody has to win." };
  const aWon = a > b;
  const w = aWon ? a : b;
  const l = aWon ? b : a;
  /* States are walked as (winner, loser); sentences and suggestions go back in
     the order they were typed. */
  const typed = (x: number, y: number) => (aWon ? { a: x, b: y } : { a: y, b: x });
  const over = (x: number, y: number) => rallyOver(x, y, r);
  /* The score a game ends at. Normally the target; but a golden point set
     BELOW it puts the cap first (to 11 with the two-point rule stopping at 5
     ends at 6), and a sentence naming 11 would point at a score the same
     check refuses. */
  const end = r.cap != null && r.cap < r.target ? r.cap : r.target;
  const ended = (x: number, y: number): ScoreProblem => {
    const at = typed(x, y);
    return {
      code: "past-the-end",
      sentence: `A game to ${end} ends at ${dash(at.a, at.b)} — ${dash(a, b)} can't happen. Did you mean ${dash(at.a, at.b)}?`,
      suggestion: at,
    };
  };

  for (let k = 0; k < l; k++) {
    if (over(k + 1, k)) return ended(k + 1, k);
    if (over(k + 1, k + 1)) return ended(k + 1, k + 1);
  }
  for (let x = l + 1; x < w; x++) if (over(x, l)) return ended(x, l);
  if (over(w, l)) return null;

  const tail =
    w < end
      ? `a game to ${end} ends when someone reaches ${end}.`
      : `at ${dash(r.target - 1, r.target - 1)} play goes on until someone leads by ${r.winBy}${
          r.cap != null ? ` or reaches ${r.cap}` : ""
        }.`;
  return { code: "unfinished", sentence: `${dash(a, b)} isn't a finished game: ${tail}` };
}

/** Games won in a best-of-N match, or — with "set" — sets won in one. */
function bestOfProblem(bestOf: number, a: number, b: number, unit: "game" | "set"): ScoreProblem | null {
  const need = Math.floor(bestOf / 2) + 1;
  const units = (n: number) => `${n} ${unit}${n === 1 ? "" : "s"}`;
  if (a === b) {
    return { code: "level", sentence: `A best-of-${bestOf} match can't end level — someone has to win ${units(need)}.` };
  }
  const w = Math.max(a, b);
  const l = Math.min(a, b);
  if (w > need) {
    const suggestion = l < need ? (a > b ? { a: need, b: l } : { a: l, b: need }) : undefined;
    return {
      code: "past-the-end",
      sentence: `A best-of-${bestOf} match ends when someone wins ${units(need)} — ${dash(a, b)} can't happen.${
        suggestion ? ` Did you mean ${dash(suggestion.a, suggestion.b)}?` : ""
      }`,
      ...(suggestion ? { suggestion } : {}),
    };
  }
  if (w < need) {
    return { code: "unfinished", sentence: `${dash(a, b)} isn't finished: a best-of-${bestOf} match is won with ${units(need)}.` };
  }
  return null;
}

/** Carrom. First to the target (the last board may carry the winner past it,
 *  so there is no ceiling unless one is set), or a fixed number of boards. */
function boardsProblem(e: Extract<Ending, { kind: "boards" }>, a: number, b: number): ScoreProblem | null {
  if (e.target == null) return null; // fixed boards: most points wins, and level is a result
  const t = e.target;
  if (a === b) return { code: "level", sentence: `A carrom match to ${t} can't end level.` };
  const w = Math.max(a, b);
  const l = Math.min(a, b);
  if (w < t) return { code: "unfinished", sentence: `${dash(a, b)} isn't finished: a match to ${t} ends when someone reaches ${t}.` };
  if (l >= t) {
    return {
      code: "both-past-the-target",
      sentence: `Only one side can reach ${t} — the match ends the moment somebody does, so ${dash(a, b)} can't happen.`,
    };
  }
  if (e.cap != null && w > e.cap) {
    return { code: "past-the-end", sentence: `A match to ${t} stops at ${e.cap} — ${dash(a, b)} can't happen.` };
  }
  return null;
}

/** Tennis and padel. Sets won, and — when the games are given — each set. */
function setsProblem(bestOf: number, a: number, b: number, sets?: readonly SetScore[]): ScoreProblem | null {
  if (!sets || sets.length === 0) return bestOfProblem(bestOf, a, b, "set");

  const need = Math.floor(bestOf / 2) + 1;
  let sa = 0;
  let sb = 0;
  for (const [i, set] of sets.entries()) {
    const [x, y] = set;
    if (!isScore(x) || !isScore(y)) return NOT_A_SCORE;
    if (sa === need || sb === need) {
      return {
        code: "set-after-the-end",
        sentence: `The match was over after set ${i} — set ${i + 1} can't have been played.`,
      };
    }
    const deciding = sa === need - 1 && sb === need - 1;
    const problem = setProblem(x, y, i + 1, deciding);
    if (problem) return problem;
    if (x > y) sa++;
    else sb++;
  }
  if (sa !== need && sb !== need) {
    return {
      code: "unfinished",
      sentence: `${dash(sa, sb)} in sets isn't finished: a best-of-${bestOf} match is won with ${need} sets.`,
    };
  }
  if (sa !== a || sb !== b) {
    return {
      code: "sets-disagree",
      sentence: `The sets add up to ${dash(sa, sb)}, not ${dash(a, b)}.`,
      suggestion: { a: sa, b: sb },
    };
  }
  return null;
}

/**
 * A tennis or padel match that did NOT finish normally — a retirement, or time
 * called — recorded without a rating. It may have stopped part-way through a
 * set, so the LAST set may be unfinished — but only at a score that set really
 * passes through: a set is over at 6–4, so it never stood at 9–2. Every set
 * before it is a finished set, no set comes after the match was already won,
 * and nobody has won more sets than a best of N allows. The typed sets won say
 * who the match was AWARDED to, which after a retirement need not be who led —
 * unless the sets show the match already WON, and then it was won by that side.
 * Without this, "2–0 ret." could be stored with three sets the other side won,
 * and "0–2 ret." over 6–4 6–4 handed the match to the side that lost it.
 */
export function stoppedSetsProblem(
  bestOf: number, a: number, b: number, sets?: readonly SetScore[],
): ScoreProblem | null {
  if (!isScore(a) || !isScore(b)) return NOT_A_SCORE;
  const won = bestOfProblem(bestOf, a, b, "set");
  if (won && won.code !== "unfinished") return won;
  if (!sets || sets.length === 0) return null;

  const need = Math.floor(bestOf / 2) + 1;
  let sa = 0;
  let sb = 0;
  for (const [i, [x, y]] of sets.entries()) {
    if (!isScore(x) || !isScore(y)) return NOT_A_SCORE;
    if (sa === need || sb === need) {
      return { code: "set-after-the-end", sentence: `The match was over after set ${i} — set ${i + 1} can't have been played.` };
    }
    const deciding = sa === need - 1 && sb === need - 1;
    /* The deciding set is a match tie-break to 10 (Faisal: best of 3 with a
       tie-break decider), so a deciding set stopped short of 10 is a
       tie-break in progress — 6–4 in it is not a set won. Counted as one, a
       retirement at 6–4 in the tie-break read as "the match already won". */
    if (i === sets.length - 1 && deciding && Math.max(x, y) < 10) break;
    const problem = setProblem(x, y, i + 1, deciding);
    if (problem) {
      if (i < sets.length - 1) return problem;
      /* The set it stopped in. */
      if (!passesThrough(x, y, deciding)) {
        return {
          code: "set-invalid",
          sentence: `Set ${i + 1}, ${dash(x, y)}: a set is over before it gets there, so the match can't have stopped at that score.`,
        };
      }
      break;
    }
    if (x > y) sa++;
    else sb++;
  }
  /* The sets show the match DECIDED: then it was not cut short, whatever it
     is labelled, and the sets won are what the sets say — "1–0 ret." over
     6–4 6–3 printed a score no set agrees with. Undecided when it stopped,
     it may be awarded either way. */
  if (sa === need || sb === need) {
    const won = sa === need ? "a" : "b";
    if ((a > b ? "a" : "b") !== won) {
      return {
        code: "sets-disagree",
        sentence: `The sets show the match already won, ${dash(sa, sb)} in sets — it can't be awarded to the other side.`,
      };
    }
    if (a !== sa || b !== sb) {
      return {
        code: "sets-disagree",
        sentence: `The sets show the match won ${dash(sa, sb)} in sets, so that is the score to record.`,
        suggestion: { a: sa, b: sb },
      };
    }
  }
  return null;
}

/** A set score some unfinished set stands at on its way to the end: up to 6–5
 *  or 6–6 in games, or — as the deciding set — a match tie-break short of its
 *  end (9–3, 11–10). */
function passesThrough(x: number, y: number, deciding: boolean): boolean {
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  const games = hi <= 5 || (hi === 6 && lo >= 5);
  const tiebreak = hi < 10 || hi - lo <= 1;
  return games || (deciding && tiebreak);
}

/** One set: to 6 by 2 (6–0 to 6–4), 7–5, or 7–6 on a tie-break — or, only as
 *  the deciding set, a match tie-break to 10 won by 2 (10–8, 11–9, …). */
function setProblem(x: number, y: number, n: number, deciding: boolean): ScoreProblem | null {
  if (x === y) return { code: "set-level", sentence: `Set ${n} can't end level (${dash(x, y)}).` };
  const hi = Math.max(x, y);
  const lo = Math.min(x, y);
  const regular = (hi === 6 && lo <= 4) || (hi === 7 && (lo === 5 || lo === 6));
  const tiebreak = hi >= 10 && hi - lo >= 2 && (hi === 10 || hi - lo === 2);
  if (regular || (deciding && tiebreak)) return null;
  if (tiebreak) {
    return {
      code: "tiebreak-not-deciding",
      sentence: `Set ${n}, ${dash(x, y)}: a tie-break to 10 only decides the last set, when the sets are level.`,
    };
  }
  return {
    code: "set-invalid",
    sentence: `Set ${n}, ${dash(x, y)}, isn't a finished set: a set ends 6–0 to 6–4, 7–5, or 7–6 on a tie-break${
      deciding ? ", and a deciding set can be a tie-break to 10, won by 2" : ""
    }.`,
  };
}

/** Chess, until step 10: exactly the check the rating engine made before. */
function resultProblem(r: Rules | null, a: number, b: number): ScoreProblem | null {
  const w = Math.max(a, b);
  const l = Math.min(a, b);
  const fine =
    w > l &&
    (!r ||
      (!(r.cap != null && w > r.cap) &&
        w >= r.target &&
        (w - l >= r.winBy || (r.cap != null && w === r.cap))));
  return fine ? null : { code: "unfinished", sentence: `${dash(a, b)} isn't a result this match can end on.` };
}
