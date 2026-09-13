import "server-only";

/* A straight knockout: no group stage, teams seeded into a bracket.
 *
 * The seeding itself is `seedBracket` in lib/brackets, which was ported from
 * the legacy app, tested, and then called from nowhere for three milestones.
 * This module is the missing half — turning its rounds into the match rows the
 * rest of the app already understands.
 *
 * The representation is deliberately the SAME one the group→knockout draw uses:
 * a later round's sides are stored as seed references ("W:Semi-Final 1") rather
 * than resolved teams, so they fill themselves as results come in and a bracket
 * can never be seeded from a tie that has not finished. Only the first round
 * carries real team ids, because only the first round is known in advance.
 */

import { seedBracket, type Entrant } from "@/lib/brackets";

export type ElimMatch = {
  round: string;
  teamAId: string | null;
  teamBId: string | null;
  slotA: string | null;
  slotB: string | null;
};

/**
 * What to call a round, given how many matches are in it.
 *
 * `n` matches means `2n` teams entering, so the naming falls out of the count
 * rather than needing the bracket's depth. These strings are also the seed
 * references other matches point at, so they must be unique within a division —
 * which they are, since no two rounds of one bracket have the same size.
 */
export function roundLabel(matchesInRound: number, index: number): string {
  if (matchesInRound === 1) return "Final";
  const stem =
    matchesInRound === 2 ? "Semi-Final"
    : matchesInRound === 4 ? "Quarter-Final"
    : `Round of ${matchesInRound * 2}`;
  return `${stem} ${index + 1}`;
}

/**
 * Build the whole bracket for a straight knockout.
 *
 * Byes produce NO row. A bye is not a match — nobody turns up for it, and
 * `seedBracket` has already advanced the lone entrant into the next round,
 * where it appears as a real team id rather than a reference. Creating a row
 * for one would put an unplayable fixture on the order of play.
 *
 * Returns null when there are too few teams to draw anything.
 */
export function singleElimMatches(entrants: Entrant[]): ElimMatch[] | null {
  const rounds = seedBracket(entrants);
  if (!rounds) return null;

  const labelOf = (roundIdx: number, matchIdx: number) =>
    roundLabel(rounds[roundIdx].length, matchIdx);

  const out: ElimMatch[] = [];

  rounds.forEach((round, r) => {
    round.forEach((m, i) => {
      if (m.isBye) return;

      /* A side is a known team when seeding placed one there (round 0), or when
         a bye in the previous round advanced one into it. Otherwise it waits on
         the winner of the match that feeds it: match `i` of this round is fed
         by matches `2i` and `2i+1` of the one before. */
      const side = (who: Entrant | null, feeder: number) =>
        who ? { teamId: who.id, slot: null }
        : r === 0 ? { teamId: null, slot: null }
        : { teamId: null, slot: `W:${labelOf(r - 1, feeder)}` };

      const a = side(m.p1, i * 2);
      const b = side(m.p2, i * 2 + 1);

      out.push({
        round: labelOf(r, i),
        teamAId: a.teamId,
        teamBId: b.teamId,
        slotA: a.slot,
        slotB: b.slot,
      });
    });
  });

  return out;
}

/**
 * The third-place playoff, when a bracket has semi-finals to lose.
 *
 * Free, because `L:` seed references already resolve (lib/brackets): the two
 * losing semi-finalists fill themselves exactly as the winners fill the final.
 */
export function thirdPlaceMatch(matches: ElimMatch[]): ElimMatch | null {
  const semis = matches.filter((m) => m.round.startsWith("Semi-Final"));
  if (semis.length !== 2) return null;
  return {
    round: "Third Place",
    teamAId: null,
    teamBId: null,
    slotA: `L:${semis[0].round}`,
    slotB: `L:${semis[1].round}`,
  };
}
