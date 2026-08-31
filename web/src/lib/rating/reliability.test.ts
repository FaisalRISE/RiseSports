import { describe, it, expect } from "vitest";
import { reliabilityOf, reliabilityFromHistory, type PlayedMatch } from "./reliability";

/* Spec §7. The reason this exists, in the spec's own words: a rating without a
 * reliability signal is worse than no rating, because it looks authoritative
 * when it isn't. That matters most for seeding — an organiser drawing from a
 * number built on four games against the same two friends will make a bad draw
 * and blame the rating. */

const settled = { matches: 40, distinctOpponents: 20, carriedShare: 0, daysSinceLastPlayed: 5 };

describe("reliabilityOf", () => {
  it("a well-established player scores High", () => {
    const r = reliabilityOf(settled);
    expect(r.score).toBe(100);
    expect(r.band).toBe("High");
  });

  it("a brand new player scores Low", () => {
    const r = reliabilityOf({ matches: 0, distinctOpponents: 0, carriedShare: 0, daysSinceLastPlayed: null });
    expect(r.band).toBe("Low");
    expect(r.reason).toMatch(/no matches/i);
  });

  /* The volume and diversity components are what stop four games looking like
     forty. */
  it("volume and diversity are capped, not unbounded", () => {
    const a = reliabilityOf({ ...settled, matches: 30, distinctOpponents: 15 });
    const b = reliabilityOf({ ...settled, matches: 300, distinctOpponents: 150 });
    expect(a.score).toBe(b.score);
  });

  it("playing the same few people costs diversity", () => {
    const many = reliabilityOf({ ...settled, distinctOpponents: 15 });
    const few = reliabilityOf({ ...settled, distinctOpponents: 2 });
    expect(few.score).toBeLessThan(many.score);
    expect(few.reason).toMatch(/different opponent/i);
  });

  /* The carry problem seen from the other end: independence is what tells an
     organiser this rating may not be the player's own. */
  it("being carried costs independence and says so", () => {
    const own = reliabilityOf({ ...settled, carriedShare: 0 });
    const carried = reliabilityOf({ ...settled, carriedShare: 0.8 });
    expect(carried.score).toBeLessThan(own.score);
    expect(carried.reason).toMatch(/80% of wins came with stronger partners/);
  });

  /* THE RULE THAT IS EASY TO GET WRONG. Recency decays RELIABILITY, never the
     rating. An inactive player keeps their number; only confidence in it drops.
     Sliding ratings down for absence would also mean a returning player is
     seeded below their real level, which is the opposite of the point. */
  it("inactivity lowers reliability and nothing else", () => {
    const fresh = reliabilityOf({ ...settled, daysSinceLastPlayed: 5 });
    const stale = reliabilityOf({ ...settled, daysSinceLastPlayed: 200 });
    expect(stale.score).toBeLessThan(fresh.score);
    expect(fresh.score - stale.score).toBe(15); // exactly the recency component
    expect(stale.parts.volume).toBe(fresh.parts.volume);
    expect(stale.parts.diversity).toBe(fresh.parts.diversity);
    expect(stale.parts.independence).toBe(fresh.parts.independence);
  });

  it("recency decays linearly between 30 and 180 days", () => {
    expect(reliabilityOf({ ...settled, daysSinceLastPlayed: 30 }).parts.recency).toBe(15);
    expect(reliabilityOf({ ...settled, daysSinceLastPlayed: 180 }).parts.recency).toBe(0);
    expect(reliabilityOf({ ...settled, daysSinceLastPlayed: 105 }).parts.recency).toBeCloseTo(7.5, 5);
  });

  it("bands split at 70 and 40", () => {
    const at = (score: number) => reliabilityOf({ matches: score, distinctOpponents: 15, carriedShare: 0, daysSinceLastPlayed: 5 });
    expect(reliabilityOf({ matches: 40, distinctOpponents: 20, carriedShare: 0, daysSinceLastPlayed: 5 }).band).toBe("High");
    expect(at(2).band).toBe("Medium");
    expect(reliabilityOf({ matches: 1, distinctOpponents: 1, carriedShare: 1, daysSinceLastPlayed: 200 }).band).toBe("Low");
  });

  /* The reason names the WEAKEST component, because that is the one an
     organiser can act on. "Play more people" is useful; "your score is 38" is
     not. */
  it("names the weakest component", () => {
    expect(reliabilityOf({ matches: 2, distinctOpponents: 15, carriedShare: 0, daysSinceLastPlayed: 5 }).reason)
      .toMatch(/2 matches so far/);
  });
});

describe("reliabilityFromHistory", () => {
  const now = new Date(2026, 5, 1);
  const day = (d: number) => new Date(now.getTime() - d * 86_400_000);

  const m = (over: Partial<PlayedMatch>): PlayedMatch => ({
    matchId: "m", playedAt: day(1), opponentIds: ["o1"], partnerIds: [],
    won: true, myRating: 800, partnerRatings: [], ...over,
  });

  it("counts distinct opponents, not appearances", () => {
    const r = reliabilityFromHistory(
      [m({ opponentIds: ["o1", "o2"] }), m({ opponentIds: ["o1", "o2"] }), m({ opponentIds: ["o3"] })],
      now,
    );
    /* Three matches, three distinct opponents — not six. */
    expect(r.parts.diversity).toBeCloseTo((3 / 15) * 25, 5);
  });

  /* §7: carriedShare is the fraction of WINS with a partner 200+ above. */
  it("counts a win as carried only when the partner is 200+ stronger", () => {
    const carried = reliabilityFromHistory(
      [m({ won: true, myRating: 700, partnerRatings: [1000] })],
      now,
    );
    expect(carried.parts.independence).toBe(0);

    const own = reliabilityFromHistory(
      [m({ won: true, myRating: 700, partnerRatings: [850] })],
      now,
    );
    expect(own.parts.independence).toBe(25);
  });

  /* carriedShare is a fraction of WINS. A loss beside a strong partner says
     nothing — you were not carried to a defeat. Paired with a genuine solo win
     so the case is about the loss being ignored, not about having no wins. */
  it("a loss alongside a stronger partner is not 'carried'", () => {
    const r = reliabilityFromHistory(
      [
        m({ won: false, myRating: 700, partnerRatings: [1200] }),
        m({ won: true, myRating: 700, partnerRatings: [720] }),
      ],
      now,
    );
    expect(r.parts.independence).toBe(25);
  });

  /* Never having won is NO EVIDENCE of independence, not proof of it. The
     spec's bare `(1 - carriedShare) * 25` would hand full marks to someone who
     has never won a game, which is the "authoritative when it isn't" failure
     this whole index exists to prevent. */
  it("scores no independence for a player who has never won", () => {
    const r = reliabilityFromHistory([m({ won: false })], now);
    expect(r.parts.independence).toBe(0);
  });

  it("no history at all is Low, not an error", () => {
    const r = reliabilityFromHistory([], now);
    expect(r.band).toBe("Low");
    expect(r.score).toBe(0);
  });

  it("uses the most recent match for recency", () => {
    const r = reliabilityFromHistory([m({ playedAt: day(300) }), m({ playedAt: day(2) })], now);
    expect(r.parts.recency).toBe(15);
  });
});
