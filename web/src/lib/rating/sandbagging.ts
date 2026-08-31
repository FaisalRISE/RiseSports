import "server-only";

/* Spec §8.1 — under-rated (sandbagging) detection.
 *
 * The point of RiseR is to help an organiser seed a draw. A player whose rating
 * sits well below the level they actually play at wrecks that draw, whether
 * they are doing it deliberately or simply improved faster than their rating
 * caught up. Either way the organiser wants to know BEFORE the draw, not after
 * the final.
 *
 *     performanceRating = avgOpponentRating + 400 * (winRate - 0.5)
 *
 * computed over rolling windows of 10 matches. Flagged when performance exceeds
 * the current rating by 150 across TWO CONSECUTIVE windows — one hot streak is
 * not evidence, and a single window would flag half the club after a good
 * night.
 *
 * ── It never touches the rating ──────────────────────────────────────────
 * The spec is explicit: flag it and let a human decide. That is the right call
 * and not merely caution. An automatic correction is unappealable, it lands on
 * the improving player as readily as the dishonest one, and the same signal it
 * fires on — beating stronger opponents — is exactly what the rating is already
 * supposed to reward through the normal delta. Correcting twice for one fact
 * would double-count it. */

export const WINDOW = 10;
export const MARGIN = 150;

export type RatedMatch = {
  /** Mean rating of the opponents AT THE TIME, which is what §8.1 is defined
   *  against — recovering it later is impossible once ratings have moved. */
  avgOpponentRating: number;
  won: boolean;
  /** Oldest first. */
  playedAt: Date;
};

export type Sandbagging = {
  underRated: boolean;
  /** Performance rating of each complete window, oldest first. */
  windows: number[];
  /** How far the latest window sits above the current rating. */
  gap: number | null;
};

/** §8.1's formula, exposed so a disputed flag can be shown its working. */
export const performanceRating = (avgOpponentRating: number, winRate: number): number =>
  Math.round(avgOpponentRating + 400 * (winRate - 0.5));

/**
 * @param history oldest first
 * @param currentRating the player's rating now
 */
export function detectSandbagging(history: RatedMatch[], currentRating: number): Sandbagging {
  /* Partial windows are ignored rather than scaled up. Three wins out of three
     is a 100% win rate and would clear any threshold, so counting it would flag
     every player on their third match. */
  const complete = Math.floor(history.length / WINDOW);
  if (complete === 0) return { underRated: false, windows: [], gap: null };

  const windows: number[] = [];
  for (let w = 0; w < complete; w++) {
    const slice = history.slice(w * WINDOW, (w + 1) * WINDOW);
    const wins = slice.filter((m) => m.won).length;
    const avgOpp = slice.reduce((s, m) => s + m.avgOpponentRating, 0) / slice.length;
    windows.push(performanceRating(avgOpp, wins / slice.length));
  }

  const last = windows[windows.length - 1];
  const prev = windows.length >= 2 ? windows[windows.length - 2] : null;

  const over = (p: number | null) => p != null && p > currentRating + MARGIN;
  return {
    underRated: over(last) && over(prev),
    windows,
    gap: last - currentRating,
  };
}

/** Neutral wording. This is a prompt to look, not an accusation of cheating —
 *  it fires just as readily on a player who is simply improving fast. */
export const sandbaggingNote = (s: Sandbagging): string | null =>
  s.underRated
    ? `Winning well above this rating (${s.gap! > 0 ? "+" : ""}${s.gap}) — worth a look before seeding`
    : null;
