import "server-only";

/* What a match's RESULT is — one definition.
 *
 * A match has a result in exactly one of two ways: somebody typed the final
 * score (both boxes filled), or the referee's rally log has been played to the
 * end. Seven places used to work that out for themselves — the group tables,
 * the knockout resolver, the podium, the rating engine, the order of play, the
 * print pack and the public page — and an eighth, the manage screen's match
 * list, got it wrong: it read only the rally log, so a typed 11–7 showed as 0–0
 * and never as final. Written eight times, the copies drift; so every caller
 * asks here, and later changes (a chess "½–½", a walkover) touch one place.
 *
 * This is about the SCORE only. "Are both teams known?" is a separate question
 * that some callers add on top — the podium and the rating engine refuse a
 * result whose sides are still placeholders — and it stays at those call sites.
 */

import { viewMatch, allowsDraws, noLiveCourt, type MatchView } from "@/lib/matchState";
import type { Match, Outcome } from "@/lib/db/schema";

export type MatchResult = {
  a: number;
  b: number;
  /** Null when level — a draw where the sport allows one, else no result to
   *  act on (a level pickleball score decides nothing). */
  winner: "a" | "b" | null;
  /** Level AND the sport allows draws (chess, carrom). */
  draw: boolean;
  source: "typed" | "live";
  /** Why this result moves no rating — a walkover, a retirement, a game
   *  stopped early — or null for an ordinary result. It counts in the table
   *  either way. */
  outcome: Outcome | null;
  /** The score as every screen prints it: "11–7", "11–0 w/o", "9–7 ret.". */
  display: string;
};

type ResultTournament = Parameters<typeof viewMatch>[0];
type ResultMatch = Parameters<typeof viewMatch>[1];

const SUFFIX: Record<Outcome, string> = { walkover: " w/o", retired: " ret.", unrated: "" };

function build(
  t: ResultTournament, a: number, b: number, source: MatchResult["source"], outcome: Outcome | null = null,
): MatchResult {
  return {
    a,
    b,
    winner: a > b ? "a" : b > a ? "b" : null,
    draw: a === b && allowsDraws(t.sport),
    source,
    outcome,
    display: `${a}–${b}${outcome ? SUFFIX[outcome] : ""}`,
  };
}

/**
 * The match's result, or null while it has none.
 *
 * Pass `view` when the caller has already replayed the match for something else
 * (live flags, the OSL pair) — the replay is the expensive part.
 */
export function matchResult(t: ResultTournament, m: ResultMatch, view?: MatchView): MatchResult | null {
  const v = view ?? viewMatch(t, m);
  if (v.typed) return build(t, m.typedScoreA!, m.typedScoreB!, "typed", v.outcome);
  /* Rallies finish a match only where the court can: a carrom event moved to
     a set number of boards still replays its rallies against carrom's default
     target, and 26–10 read as a finished game — frozen, and rated — although
     under a number of boards no point count ever ends a match. */
  if (v.over && !noLiveCourt(t, m)) return build(t, v.a, v.b, "live");
  return null;
}

/** "Aces win, 2–1": who won and how, in the words every other screen uses —
 *  "0–2 w/o", "9–7 ret.". A draw is just its score. */
export function resultSentence(r: MatchResult, nameA: string, nameB: string): string {
  return r.winner ? `${r.winner === "a" ? nameA : nameB} win, ${r.display}` : r.display;
}

/**
 * Has anything been recorded on this match — a rally, or either typed box?
 *
 * The one test for "started". It decides what a redraw may throw away and what
 * the scheduler may move, so a half-typed score counts: it is somebody's work.
 */
export function hasPlay(m: Pick<Match, "log" | "typedScoreA" | "typedScoreB">): boolean {
  return (m.log as unknown[]).length > 0 || m.typedScoreA !== null || m.typedScoreB !== null;
}

/** The manage screen's line for one match: its score and whether it is over. */
export function matchLine(
  t: ResultTournament,
  m: ResultMatch,
  view?: MatchView,
): { score: string; tag: "" | " · live" | " · final"; finished: boolean } {
  const v = view ?? viewMatch(t, m);
  const r = matchResult(t, m, v);
  if (r) return { score: r.display, tag: " · final", finished: true };
  return { score: `${v.a}–${v.b}`, tag: v.rallies > 0 ? " · live" : "", finished: false };
}
