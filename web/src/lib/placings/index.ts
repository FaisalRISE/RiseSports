import "server-only";

/* Who won.
 *
 * Nothing in the app answered that question. A final could be played and the
 * event page would show a score and move on — no podium, nothing on the
 * players' profiles, no record that anybody had won anything.
 *
 * ── Derived, never stored ────────────────────────────────────────────────
 * The legacy app keeps a `medals` array on each player
 * (`[{type, tournament, category, year}]`), written when a tournament ends.
 * That is a second copy of a fact the matches already contain, and it goes
 * wrong in the ordinary ways: a score corrected after the fact, a final undone
 * and replayed, a medal written twice by a double tap. Here the podium is
 * computed from the results every time it is asked for, so it cannot disagree
 * with the scoreboard and there is nothing to backfill.
 *
 * ── A placing is only real when the match that decides it has FINISHED ───
 * A final in progress has no winner, and a group table with a match left to
 * play has no champion. Both return nothing rather than a guess: "provisional
 * champion" is not a thing anybody wants printed.
 */

import { viewMatch } from "@/lib/matchState";
import type { GroupTable, LoadedTournament } from "@/lib/tournamentState";
import type { Match, Tournament } from "@/lib/db/schema";

export type Placing = "gold" | "silver" | "bronze";

export type Podium = {
  divisionId: string;
  /** Team ids, absent while undecided. */
  gold: string | null;
  silver: string | null;
  bronze: string | null;
  /** How it was decided, for wording on screen. */
  via: "final" | "table";
};

/** A finished match's winner and loser, or null while it is still in play. */
export function settled(
  t: Pick<Tournament, "sport" | "format" | "scoring">,
  m: Match,
): { winner: string; loser: string } | null {
  const v = viewMatch(t, m);
  const [a, b] = v.typed ? [m.typedScoreA ?? 0, m.typedScoreB ?? 0] : [v.a, v.b];
  if (!(v.typed || v.over)) return null;
  if (a === b) return null;
  const winnerId = a > b ? m.teamAId : m.teamBId;
  const loserId = a > b ? m.teamBId : m.teamAId;
  if (!winnerId || !loserId) return null;
  return { winner: winnerId, loser: loserId };
}

/* Round labels the draws produce. Matched exactly rather than by a regex over
   "final", because "Semi-Final 1" contains it and is not the final. */
const FINAL = "Final";
const THIRD = "Third Place";

/**
 * The podium for one category.
 *
 * A knockout decides it: the Final gives gold and silver, the Third Place
 * playoff gives bronze. **Without that playoff there is no bronze** — two
 * losing semi-finalists are joint third and awarding it to one of them would be
 * inventing a result. The organiser who wants a bronze turns the playoff on.
 *
 * A category with no final at all — a league, or a single group — is decided by
 * its table, but only once every match in it has been played.
 */
export function podiumFor(
  loaded: LoadedTournament,
  tables: GroupTable[],
  divisionId: string,
): Podium | null {
  const t = loaded.tournament;
  const mine = loaded.matches.filter((m) => m.divisionId === divisionId);
  if (mine.length === 0) return null;

  const final = mine.find((m) => m.round === FINAL);
  if (final) {
    const decided = settled(t, final);
    if (!decided) return null;
    const third = mine.find((m) => m.round === THIRD);
    const bronze = third ? (settled(t, third)?.winner ?? null) : null;
    return { divisionId, gold: decided.winner, silver: decided.loser, bronze, via: "final" };
  }

  /* No knockout. The table decides — but a table with a match still to play
     decides nothing, and that is the common case mid-event. */
  const mineTables = tables.filter((x) => x.group.divisionId === divisionId);
  if (mineTables.length !== 1) return null;
  const only = mineTables[0];
  if (!only.complete) return null;

  const [first, second, third] = only.rows;
  if (!first) return null;
  return {
    divisionId,
    gold: first.teamId,
    silver: second?.teamId ?? null,
    /* Only where a third place exists to take: a table of two has no bronze. */
    bronze: third?.teamId ?? null,
    via: "table",
  };
}

/** Every category's podium, skipping the ones not yet decided. */
export function podiums(loaded: LoadedTournament, tables: GroupTable[]): Podium[] {
  const ids = [...new Set(loaded.matches.map((m) => m.divisionId))];
  return ids.map((id) => podiumFor(loaded, tables, id)).filter((p): p is Podium => p !== null);
}

/** What a team won, if anything. */
export function placingOf(p: Podium, teamId: string): Placing | null {
  if (p.gold === teamId) return "gold";
  if (p.silver === teamId) return "silver";
  if (p.bronze === teamId) return "bronze";
  return null;
}

export const PLACING_LABEL: Record<Placing, string> = {
  gold: "Winner",
  silver: "Runner-up",
  bronze: "Third",
};

export const PLACING_MEDAL: Record<Placing, string> = {
  gold: "🥇",
  silver: "🥈",
  bronze: "🥉",
};
