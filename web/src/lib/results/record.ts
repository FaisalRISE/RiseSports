import "server-only";

/* What may be recorded as a match's result — the rules for TYPING one.
 *
 * Pure: the action (`recordResult`, app/t/[slug]/actions.ts) loads the match,
 * asks here, and writes. Kept apart so the rules can be tested without a
 * database, and so step 10's screen and anything after it ask the same thing.
 *
 * The final itself is judged by `finalScoreProblem` (lib/scoring/final) against
 * the match's OWN ending (`endingOf`), so a typed correction to a match played
 * to 11 is judged to 11 even after the event moved to 15. This adds what only a
 * recorded result has: both teams must be known, a knockout needs a winner, and
 * a result that moves no rating (`outcome`) may stand at a score short of the
 * end — a game stopped early, a retirement — but never past it, and never level.
 */

import { finalScoreProblem, stoppedSetsProblem, type Ending, type ScoreProblem } from "@/lib/scoring/final";
import type { Match, Outcome } from "@/lib/db/schema";

/**
 * Can a result be TYPED IN on a screen? Not until step 10. Until then a match
 * with no live court has no way to finish at all, so nothing may turn one
 * into such a match: "A set number of boards" for carrom is held back on the
 * Scoring card and refused by `setScoring`. Chosen, it left every match of
 * the event with no way to record a result — and a game being played lost
 * its court in the middle. Step 10 turns this on with its screen.
 */
export const RESULT_ENTRY_ON_SCREEN = false;

export type SetPair = [number, number];

export type ResultInput = {
  a: number;
  b: number;
  outcome: Outcome | null;
  /** Tennis and padel: the games in each set. Ignored for any other ending. */
  sets: SetPair[] | null;
};

export type ResultRefusalCode = "teams" | "invalid" | "knockout-level" | "no-winner";

export type ResultRefusal = {
  code: ResultRefusalCode;
  /** One plain sentence for whoever typed it. */
  error: string;
  /** The score they probably meant, in the order they typed it. */
  suggestion?: { a: number; b: number };
};

/** The score a walkover is recorded at: what a finished game's winner has —
 *  11 in a game to 11, 2 in a best of 3, 25 in carrom to 25. It counts in the
 *  table like any win and moves no rating. A fixed number of boards has no
 *  such score, so it is 1–0. */
export function walkoverScore(e: Ending): number {
  switch (e.kind) {
    case "points":
      return e.rules.cap != null && e.rules.cap < e.rules.target ? e.rules.cap : e.rules.target;
    case "games":
    case "sets":
      return Math.floor(e.bestOf / 2) + 1;
    case "boards":
      return e.target ?? 1;
    case "result":
      return 1;
  }
}

/** What would actually be stored. A walkover goes to the side typed higher,
 *  at `walkoverScore`; the games in each set are kept only where the ending
 *  has sets. */
export function normaliseResult(e: Ending, input: ResultInput): ResultInput {
  if (input.outcome === "walkover") {
    const w = walkoverScore(e);
    return input.a > input.b
      ? { a: w, b: 0, outcome: "walkover", sets: null }
      : input.b > input.a
        ? { a: 0, b: w, outcome: "walkover", sets: null }
        : { ...input, sets: null };   // level: refused below, as it stands
  }
  return { ...input, sets: e.kind === "sets" && input.sets && input.sets.length > 0 ? input.sets : null };
}

/** Why this result cannot be recorded on this match, or null when it can.
 *  Call with the output of `normaliseResult`. */
export function resultProblem(
  m: Pick<Match, "teamAId" | "teamBId" | "groupId">,
  e: Ending,
  r: ResultInput,
  draws: boolean,
): ResultRefusal | null {
  if (!m.teamAId || !m.teamBId) {
    return { code: "teams", error: "Both teams have to be known before a result can be recorded." };
  }

  if (r.a === r.b) {
    if (r.outcome) {
      return {
        code: "no-winner",
        error: r.outcome === "walkover"
          ? "Say which side the walkover goes to."
          : "A game stopped early or a retirement still has a winner — the scores can't be level.",
      };
    }
    /* A group table can hold a draw where the sport has them; a knockout
       cannot send "nobody" into the next round. */
    if (draws && m.groupId === null) {
      return { code: "knockout-level", error: "A knockout match needs a winner — the scores can't be level." };
    }
  }

  /* A walkover is a result by definition: nothing was played to judge. */
  if (r.outcome === "walkover") return null;

  const invalid = (p: ScoreProblem): ResultRefusal =>
    ({ code: "invalid", error: p.sentence, ...(p.suggestion ? { suggestion: p.suggestion } : {}) });

  /* Recorded without a rating (a game stopped early, a retirement): it may
     have stopped BEFORE its end — that is the whole point of 9–7 — but never
     past it. 111–4 "retired" in a game to 11 is a typing slip, and it would
     count in every points-difference tie-break. Tennis may have stopped part
     way through a set, so only its last set is waived. */
  if (r.outcome) {
    const p = e.kind === "sets"
      ? stoppedSetsProblem(e.bestOf, r.a, r.b, r.sets ?? undefined)
      : finalScoreProblem(e, r.a, r.b);
    return p && p.code !== "unfinished" ? invalid(p) : null;
  }

  const p = finalScoreProblem(e, r.a, r.b, r.sets ?? undefined);
  return p ? invalid(p) : null;
}
