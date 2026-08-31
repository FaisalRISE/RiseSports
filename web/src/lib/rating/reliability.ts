import "server-only";

/* Spec §7 — the Reliability Index.
 *
 * The spec calls this the most commercially valuable part, and the reasoning is
 * worth keeping in front of whoever edits this file:
 *
 *   A rating without a reliability signal is WORSE than no rating, because it
 *   looks authoritative when it isn't.
 *
 * That matters most for the thing RiseR is for. An organiser seeding a draw
 * from a number built on four matches against the same two friends will produce
 * a bad draw and blame the rating. Showing "1120 · Advanced+ · Reliability: Low
 * — 78% of wins came with stronger partners" lets them seed anyway, with their
 * eyes open.
 *
 * ── The rule that is easy to get wrong ───────────────────────────────────
 * RECENCY DECAYS RELIABILITY, NEVER THE RATING. An inactive player's number
 * stays exactly where they left it; only confidence in it drops. Quietly
 * sliding people down for not playing is, in the spec's words, the fastest way
 * to lose a community — and it would also mean a returning player is seeded
 * below their actual level, which is the opposite of the point. */

export type ReliabilityInput = {
  /** Completed matches, all formats. */
  matches: number;
  /** How many DIFFERENT opponents — four friends is not fifteen. */
  distinctOpponents: number;
  /** Fraction of wins earned alongside a partner 200+ points stronger. */
  carriedShare: number;
  /** Wins so far. Zero means there is NO EVIDENCE of independence either way. */
  wins?: number;
  /** Days since the last completed match, or null if never played. */
  daysSinceLastPlayed: number | null;
};

export type ReliabilityBand = "High" | "Medium" | "Low";

export type Reliability = {
  score: number;
  band: ReliabilityBand;
  parts: { volume: number; diversity: number; independence: number; recency: number };
  /** The one sentence to show beside the rating. */
  reason: string;
};

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

/** Spec §7 weights: volume 35, diversity 25, independence 25, recency 15. */
export function reliabilityOf(input: ReliabilityInput): Reliability {
  const volume = clamp01(input.matches / 30) * 35;
  const diversity = clamp01(input.distinctOpponents / 15) * 25;
  /* Spec §7 reads `(1 - carriedShare) * 25`, which hands full marks to someone
     who has never won a game — carriedShare is 0 because there is nothing to
     divide, not because they earned it alone. Awarding 25 for no evidence is
     the exact failure this index exists to prevent, so no wins scores zero. */
  const independence = (input.wins ?? 1) === 0 ? 0 : (1 - clamp01(input.carriedShare)) * 25;

  /* 15 within 30 days, decaying linearly to 0 at 180. Never played scores 0 —
     no evidence is not the same as stale evidence, but neither earns points. */
  const d = input.daysSinceLastPlayed;
  const recency =
    d == null ? 0
    : d <= 30 ? 15
    : d >= 180 ? 0
    : 15 * (1 - (d - 30) / 150);

  const score = Math.round(volume + diversity + independence + recency);
  const band: ReliabilityBand = score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";

  return { score, band, parts: { volume, diversity, independence, recency }, reason: reasonFor(input, score) };
}

/* Name the WEAKEST component, because that is the one an organiser can act on:
   "play more people" is useful, "your score is 38" is not. */
function reasonFor(input: ReliabilityInput, score: number): string {
  if (input.matches === 0) return "No matches played yet";

  const carried = Math.round(clamp01(input.carriedShare) * 100);
  const candidates: { gap: number; text: string }[] = [
    { gap: 35 - clamp01(input.matches / 30) * 35, text: `Only ${input.matches} match${input.matches === 1 ? "" : "es"} so far` },
    { gap: 25 - clamp01(input.distinctOpponents / 15) * 25, text: `Played only ${input.distinctOpponents} different opponent${input.distinctOpponents === 1 ? "" : "s"}` },
    { gap: clamp01(input.carriedShare) * 25, text: `${carried}% of wins came with stronger partners` },
    {
      gap: input.daysSinceLastPlayed == null ? 15 : 15 - (input.daysSinceLastPlayed <= 30 ? 15 : input.daysSinceLastPlayed >= 180 ? 0 : 15 * (1 - (input.daysSinceLastPlayed - 30) / 150)),
      text: input.daysSinceLastPlayed == null ? "Never played" : `Last played ${input.daysSinceLastPlayed} days ago`,
    },
  ];
  /* Name the weakest component whenever one is materially weak — NOT only when
     the total is low. A player can score High while 80% of their wins came with
     a much stronger partner, and that is precisely the case an organiser
     seeding a draw needs told about. */
  const worst = candidates.sort((a, b) => b.gap - a.gap)[0];
  if (worst.gap < 5 && score >= 70) return "Well established across enough opponents";
  return worst.text;
}

/* ── Deriving the inputs from stored history ─────────────────────────────── */

export type PlayedMatch = {
  matchId: string;
  playedAt: Date;
  opponentIds: string[];
  partnerIds: string[];
  won: boolean;
  /** This player's rating at the time. */
  myRating: number;
  /** Partner ratings at the time, for the carry test. */
  partnerRatings: number[];
};

/** Spec §7: `carriedShare` is the fraction of WINS with a partner 200+ above. */
export function reliabilityFromHistory(history: PlayedMatch[], now: Date): Reliability {
  if (history.length === 0) {
    return reliabilityOf({ matches: 0, distinctOpponents: 0, carriedShare: 0, wins: 0, daysSinceLastPlayed: null });
  }

  const opponents = new Set<string>();
  let wins = 0;
  let carriedWins = 0;
  let last = 0;

  for (const m of history) {
    for (const o of m.opponentIds) opponents.add(o);
    if (m.won) {
      wins++;
      if (m.partnerRatings.some((r) => r - m.myRating > 200)) carriedWins++;
    }
    last = Math.max(last, m.playedAt.getTime());
  }

  return reliabilityOf({
    matches: history.length,
    distinctOpponents: opponents.size,
    carriedShare: wins === 0 ? 0 : carriedWins / wins,
    wins,
    daysSinceLastPlayed: Math.floor((now.getTime() - last) / 86_400_000),
  });
}
