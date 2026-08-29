/* RISE Rating engine.
 *
 * Ported from app.source.js:593-601, WITH THE CONSERVATION BUG FIXED.
 *
 * The legacy formula was:
 *     r  = expected score for the winner
 *     wG = K * (1 - r) * (1 + 0.6*mov) * phase * rel(winnerGames)
 *     lL = K *      r  * (1 - 0.35*(1-margin)) * phase * rel(loserGames)
 *
 * Two independent expressions, so a match almost never moved the two sides by
 * the same amount and the pool total drifted every game. Two concrete failures:
 *
 *   - Evenly matched (r = 0.5): the winner's multiplier (1 + 0.6*mov) is >= 1
 *     while the loser's (1 - 0.35*(1-margin)) is <= 1, so the winner always
 *     gained more than the loser lost. Rating was minted on every such match.
 *   - Heavy favourite (r = 0.9): the winner gained K*0.1 while the loser lost
 *     K*0.9 — a player was punished nine times harder for losing a match they
 *     were expected to lose. Rating was destroyed.
 *
 * Elo's actual rule is that both sides move by the same amount: the winner
 * scores 1 against an expectation of r, the loser scores 0 against an
 * expectation of (1 - r), so both deltas are K*(1 - r). This implementation
 * computes ONE delta and applies it to both sides, so the pool total is
 * invariant and `wG === lL` always.
 *
 * NOTE: the repo's CLAUDE.md points at `Files for claude code/rise-rating-spec 4.md`
 * §11 for the intended fix. That file is not in the repository, so this is a
 * principled reconstruction rather than an implementation of that spec — check
 * it against §11 before treating the numbers as final. The conservation
 * property itself is not in doubt; the tuning constants may be.
 */

export type Phase = "group" | "quarter" | "semi" | "final";

export const K_BASE = 32;
export const MAX_DELTA = 60;
export const MIN_DELTA = 1;

/** Standard Elo expectation for a player rated `mine` against `theirs`. */
export const calcExp = (mine: number, theirs: number): number =>
  1 / (1 + Math.pow(10, (theirs - mine) / 400));

/** Knockout matches count for more than a group game. */
export const phaseMultiplier = (p: Phase): number =>
  p === "final" ? 1.5 : p === "semi" ? 1.3 : p === "quarter" ? 1.15 : 1;

/** A provisional rating should move faster than a settled one. Because the
 *  delta is shared, this is a property of the PAIRING, not of one player:
 *  the less either rating is trusted, the more informative the result is. */
export const reliability = (games: number): number => (games < 10 ? 1.6 : games < 30 ? 1.2 : 1);

export type RtgChange = {
  /** Points the winner gains. */
  wG: number;
  /** Points the loser loses. Equal to wG — the pool total never changes. */
  lL: number;
};

export type RtgOptions = {
  phase?: Phase;
  /** Completed matches by the winner, for reliability weighting. */
  winnerGames?: number;
  /** Completed matches by the loser. */
  loserGames?: number;
};

/**
 * Rating change for a completed match.
 *
 * @param winnerRating rating of the side that won
 * @param loserRating  rating of the side that lost
 * @param scoreW       winner's points
 * @param scoreL       loser's points
 */
export function calcRtgChange(
  winnerRating: number,
  loserRating: number,
  scoreW: number,
  scoreL: number,
  { phase = "group", winnerGames = 12, loserGames = 12 }: RtgOptions = {},
): RtgChange {
  const expected = calcExp(winnerRating, loserRating);

  const total = scoreW + scoreL;
  const margin = total > 0 ? Math.max(0, (scoreW - scoreL) / total) : 0;
  /* sqrt keeps a narrow win from being worth almost nothing while stopping a
     blowout from dominating: margin 0.25 -> 0.5 of the available bonus. */
  const movMultiplier = 1 + 0.6 * Math.sqrt(margin);

  /* One reliability figure for the match, from both sides, so the delta stays
     symmetric. Two per-player figures would reintroduce the drift. */
  const rel = (reliability(winnerGames) + reliability(loserGames)) / 2;

  const raw = K_BASE * (1 - expected) * movMultiplier * phaseMultiplier(phase) * rel;
  const delta = Math.max(MIN_DELTA, Math.round(Math.min(MAX_DELTA, raw)));

  return { wG: delta, lL: delta };
}

/* ---------- tiers ---------- */

export type Tier = { name: string; min: number; max: number; emoji: string };

export const TIERS: Tier[] = [
  { name: "Beginner", min: 0, max: 599, emoji: "⬜" },
  { name: "Beginner+", min: 600, max: 749, emoji: "🟫" },
  { name: "Intermediate", min: 750, max: 899, emoji: "🥉" },
  { name: "Intermediate+", min: 900, max: 1049, emoji: "🥈" },
  { name: "Advanced", min: 1050, max: 1199, emoji: "🔷" },
  { name: "Advanced+", min: 1200, max: 1349, emoji: "💎" },
  { name: "Pro", min: 1350, max: 1499, emoji: "🥇" },
  { name: "Pro+", min: 1500, max: 9999, emoji: "👑" },
];

export const getTier = (rating: number): Tier =>
  TIERS.find((t) => rating >= t.min && rating <= t.max) ?? TIERS[0];
