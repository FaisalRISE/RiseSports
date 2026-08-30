/* RISE Rating engine — implements `Files for claude code/rise-rating-spec 4.md`.
 *
 * An earlier port fixed the legacy conservation bug but reconstructed the tuning
 * constants, because the spec was believed to be unavailable. It is not: the
 * file is on local disk, gitignored, which is why it is absent from the repo.
 * Checked against its §11 table, that reconstruction overshot every case by
 * 30–55% (case 1 expects 16, it returned 25). The constants below are the
 * spec's, and §11 is now a literal test.
 *
 * ── What the legacy engine got wrong ──────────────────────────────────────
 * `app.source.js:593-601` computed the two sides independently:
 *     wG = K * (1 - r) * (1 + 0.6*mov)          * phase * rel(winnerGames)
 *     lL = K *      r  * (1 - 0.35*(1-margin))  * phase * rel(loserGames)
 * so a match almost never moved both sides by the same amount:
 *   - evenly matched (r = 0.5): the winner's multiplier is >= 1 and the loser's
 *     <= 1, so rating was MINTED on every such match;
 *   - heavy favourite (r = 0.9): winner gained K*0.1, loser lost K*0.9 — a
 *     player punished nine times harder for losing a match they were expected
 *     to lose.
 *
 * ── Why the margin multiplier is centred on 1 ─────────────────────────────
 * Spec §4.2. The legacy shape `1 + 0.6*sqrt(m)` is floored at 1, so a bigger
 * margin always means MORE rating in the pool. `0.75 + 0.5*sqrt(m)` straddles
 * 1 instead, so margin changes how much rating MOVES without changing how much
 * EXISTS. That is the whole point, and it is why the reconstruction ran hot.
 *
 * ── Conservation, and where it is deliberately broken ─────────────────────
 * One shared delta is computed and applied to both sides, so the pool total is
 * invariant. §5 then knowingly breaks that for provisional players — they must
 * converge faster than settled ones — and requires the resulting imbalance to
 * be LOGGED rather than hidden. `calcRtgChange` returns that imbalance so the
 * caller can write a ledger row; the pool total is then invariant net of the
 * ledger, which is the property the season test asserts.
 *
 * ── Not implemented here (need match history, not a single result) ────────
 * §6.1 carry guard · §7 reliability index · §8 repeat-opponent damping, daily
 * cap and sandbagging detection. Those belong in the layer that has a player's
 * history, not in a pure per-match function.
 */

/** Stage of the competition. `social` is open play — spec §4.3. */
export type Phase = "social" | "group" | "quarter" | "semi" | "final";

/** How trustworthy the score is — spec §4.4. Orthogonal to phase: a
 *  self-reported final is 1.5 × 0.3. Weight follows verification, never
 *  payment. */
export type Verification = "organiser" | "certified" | "confirmed" | "self";

export const K_BASE = 32;
/** Spec §4.5 clamps the shared delta to [1, 40]. The provisional multiplier is
 *  applied AFTER this, so an applied movement can legitimately exceed it. */
export const MAX_DELTA = 40;
export const MIN_DELTA = 1;

/** Standard Elo expectation for a player rated `mine` against `theirs`. */
export const calcExp = (mine: number, theirs: number): number =>
  1 / (1 + Math.pow(10, (theirs - mine) / 400));

/** Spec §4.2. Bounded [0.75, 1.25] and centred on 1 — see the note above. */
export function marginMultiplier(scoreW: number, scoreL: number): number {
  const total = scoreW + scoreL;
  const ratio = total > 0 ? Math.max(0, (scoreW - scoreL) / total) : 0;
  return Math.min(1.25, Math.max(0.75, 0.75 + 0.5 * Math.sqrt(ratio)));
}

/** Spec §4.3. */
export const phaseMultiplier = (p: Phase): number =>
  p === "final" ? 1.5 : p === "semi" ? 1.3 : p === "quarter" ? 1.15 : p === "social" ? 0.8 : 1;

/** Spec §4.4.
 *
 *  NOTE a contradiction inside the spec: §4.4's table gives self-reported 0.30,
 *  but §11 case 7's arithmetic ("base × 0.8 × 0.5 = 40%") implies 0.5. The
 *  table is the normative definition, so 0.30 is used and case 7 is asserted
 *  against the table rather than against its own multiplication. Worth
 *  resolving with Faisal. */
export const verificationWeight = (v: Verification): number =>
  v === "organiser" ? 1 : v === "certified" ? 0.85 : v === "confirmed" ? 0.6 : 0.3;

/** Spec §5. A new player must converge faster than a settled one. */
export const provisionalMultiplier = (matchesPlayed: number): number =>
  matchesPlayed < 10 ? 1.6 : matchesPlayed < 30 ? 1.2 : 1;

export type RtgChange = {
  /** Points the winner gains, after their own provisional multiplier. */
  wG: number;
  /** Points the loser loses, after their own provisional multiplier. */
  lL: number;
  /** The shared, conserved delta before either provisional multiplier. */
  delta: number;
  /** `wG - lL`. Non-zero only when the two sides differ in provisional status.
   *  Spec §5 requires this to be written to `rating_ledger` every match, so the
   *  drift is visible rather than silent. */
  imbalance: number;
};

export type RtgOptions = {
  phase?: Phase;
  /** How the result was captured. Defaults to an organiser-entered match. */
  verification?: Verification;
  /** Completed matches by the winner, for the provisional multiplier. */
  winnerGames?: number;
  /** Completed matches by the loser. */
  loserGames?: number;
};

/**
 * Rating change for one completed match, per spec §4.5:
 *
 *     delta = clamp(32 * (1 - expectedWinner) * M * G * W, 1, 40)
 *
 * then §5 applies each player's own provisional multiplier to their movement.
 *
 * @param winnerRating rating of the side that won
 * @param loserRating  rating of the side that lost
 * @param scoreW       winner's points, summed across all games in the match
 * @param scoreL       loser's points
 */
export function calcRtgChange(
  winnerRating: number,
  loserRating: number,
  scoreW: number,
  scoreL: number,
  {
    phase = "group",
    verification = "organiser",
    /* Default to settled. A caller that does not know the match count should
       not accidentally get the provisional boost. */
    winnerGames = 30,
    loserGames = 30,
  }: RtgOptions = {},
): RtgChange {
  const expected = calcExp(winnerRating, loserRating);

  const raw =
    K_BASE *
    (1 - expected) *
    marginMultiplier(scoreW, scoreL) *
    phaseMultiplier(phase) *
    verificationWeight(verification);

  const delta = Math.max(MIN_DELTA, Math.min(MAX_DELTA, raw));

  const wG = Math.round(delta * provisionalMultiplier(winnerGames));
  const lL = Math.round(delta * provisionalMultiplier(loserGames));

  return { wG, lL, delta: Math.round(delta), imbalance: wG - lL };
}

/* ---------- tiers ---------- */

export type Tier = { name: string; min: number; max: number; emoji: string };

/** Spec §1. The boundaries are on a "do not adjust" list — the whole point of a
 *  conserved system is that they keep meaning the same thing over time. Note
 *  the floor is 100, not 0: §8 sets 100 as the rating floor. */
export const TIERS: Tier[] = [
  { name: "Beginner", min: 100, max: 599, emoji: "⬜" },
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

/** Spec §3: seed from a verified DUPR. 3.0 → 750 · 4.5 → 1125 · 6.0 → 1500. */
export const seedFromDupr = (dupr: number): number => Math.round((dupr - 2.0) * 250 + 500);

/** Spec §12.2 organiser placement bands, for a cohort with no DUPR. */
export const SEED_BANDS = [
  { label: "Learning the game, still finding consistency", seed: 550 },
  { label: "Rallies comfortably, knows the rules, plays socially", seed: 700 },
  { label: "Solid club player, wins a reasonable share", seed: 850 },
  { label: "Strong club player, wins most social games", seed: 1000 },
  { label: "Competes in tournaments and places", seed: 1150 },
  { label: "Top of the local scene", seed: 1300 },
] as const;

/** Spec §3: no DUPR and no organiser placement. */
export const DEFAULT_SEED = 750;
