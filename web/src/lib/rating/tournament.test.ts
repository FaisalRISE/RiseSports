import { describe, it, expect } from "vitest";
import { phaseOf, ratingFormatFor, seedToRefile } from "./tournament";
import type { Player } from "@/lib/db/schema";

/* `tournamentRatings` itself now READS `rating_history` rather than deriving,
 * so its behaviour is covered end to end (e2e/event.mjs) rather than here — a
 * unit test would only be re-asserting that a SELECT returns what was inserted.
 * What stays here are the two decisions that are still pure, and that
 * lib/rating/apply.ts depends on.
 *
 * The properties the old derivation tests protected — conservation, upsets,
 * margin and stage weighting — did not go away: they live in rating.test.ts
 * against `calcRtgChange`, which is where they belong. */

const player = (id: string, teamId: string | null, over: Partial<Player> = {}): Player =>
  ({
    id, tournamentId: "t1", teamId, userId: null, personId: null, name: id,
    gender: "M", ratings: {}, createdAt: new Date(),
    ...over,
  }) as Player;

describe("phaseOf", () => {
  it("reads the phase out of the round label", () => {
    expect(phaseOf("Final")).toBe("final");
    expect(phaseOf("Grand Final")).toBe("final");
    expect(phaseOf("Semi-finals")).toBe("semi");
    expect(phaseOf("Quarter-finals")).toBe("quarter");
    expect(phaseOf("Round 1")).toBe("group");
    expect(phaseOf("Group A")).toBe("group");
  });

  /* "Semi-finals" contains "final". Without the guard a semi would be rated at
     the final's 1.5x instead of 1.3x. */
  it("does not mistake a semi-final or quarter-final for the final", () => {
    expect(phaseOf("Semi-final")).not.toBe("final");
    expect(phaseOf("Quarter-final")).not.toBe("final");
  });
});

describe("ratingFormatFor", () => {
  it("reads doubles categories off the team composition", () => {
    const men = [player("a", "A"), player("b", "A"), player("c", "B"), player("d", "B")];
    expect(ratingFormatFor(men, 1)).toBe("md");

    const women = men.map((p) => ({ ...p, gender: "F" as const }));
    expect(ratingFormatFor(women, 1)).toBe("wd");

    const mixed = [
      player("a", "A"), player("b", "A", { gender: "F" }),
      player("c", "B"), player("d", "B", { gender: "F" }),
    ];
    expect(ratingFormatFor(mixed, 1)).toBe("mx");
  });

  it("reads singles off one-player teams", () => {
    expect(ratingFormatFor([player("a", "A"), player("b", "B")], 1)).toBe("ms");
    expect(ratingFormatFor([
      player("a", "A", { gender: "F" }), player("b", "B", { gender: "F" }),
    ], 1)).toBe("ws");
  });

  /* The bug this parameter exists for: the first player of an empty doubles
     event is a team of one, and was filed as singles. */
  it("counts a team still being filled as the event's minimum size", () => {
    expect(ratingFormatFor([player("a", "A")], 2)).toBe("md");
    expect(ratingFormatFor([player("a", "A", { gender: "F" })], 2)).toBe("wd");
    /* Half-filled pairs: every team is one short. */
    expect(ratingFormatFor([player("a", "A"), player("b", "B"), player("c", "C")], 2)).toBe("md");
  });

  it("changes nothing at the default minimum of one, or for a complete roster", () => {
    expect(ratingFormatFor([player("a", "A")], 1)).toBe("ms");
    const pairs = [player("a", "A"), player("b", "A", { gender: "F" }), player("c", "B"), player("d", "B", { gender: "F" })];
    expect(ratingFormatFor(pairs, 1)).toBe(ratingFormatFor(pairs, 2));
    /* A nonsense minimum is read as one, not as "no teams". */
    expect(ratingFormatFor([player("a", "A")], 0)).toBe("ms");
  });

  it("reads a minimum above a pair as the general bucket", () => {
    expect(ratingFormatFor([player("a", "A")], 6)).toBe("gn");
  });

  /* OSL runs six-player teams, which is none of the conventional categories. */
  it("falls back to the general bucket for larger teams", () => {
    expect(ratingFormatFor(["a", "b", "c", "d", "e", "f"].map((n) => player(n, "A")), 1)).toBe("gn");
  });

  it("does not crash on players with no team", () => {
    expect(ratingFormatFor([player("a", null)], 1)).toBe("gn");
    expect(ratingFormatFor([], 1)).toBe("gn");
  });
});

describe("seedToRefile", () => {
  const seeded = (riseRatings: Record<string, number>, matchCount: Record<string, number> = {}) =>
    ({ riseRatings, matchCount });

  it("moves a newcomer's one unplayed seed to the key the event is rated in", () => {
    expect(seedToRefile(seeded({ "pb:ws": 1000 }), "pb", "pb:mx")).toBe("pb:ws");
  });

  it("never overwrites a rating already held under the key", () => {
    expect(seedToRefile(seeded({ "pb:ws": 1000, "pb:mx": 900 }), "pb", "pb:mx")).toBeNull();
    expect(seedToRefile(seeded({ "pb:mx": 1000 }), "pb", "pb:mx")).toBeNull();
  });

  /* A number with matches behind it is evidence, and an unplayed key beside
     it may be a real placement for another event. Leave both. */
  it("leaves anyone who has played the sport alone", () => {
    expect(seedToRefile(seeded({ "pb:ws": 1000, "pb:md": 950 }, { "pb:md": 3 }), "pb", "pb:mx")).toBeNull();
    expect(seedToRefile(seeded({ "pb:ms": 1000 }, { "pb:ms": 1 }), "pb", "pb:mx")).toBeNull();
  });

  it("only looks at the sport being played", () => {
    /* Badminton played, pickleball never: their pickleball seed may move. */
    expect(seedToRefile(seeded({ "pb:ws": 1000, "bd:md": 1200 }, { "bd:md": 5 }), "pb", "pb:mx")).toBe("pb:ws");
    /* No pickleball seed at all: nothing to move — a new sport starts fresh. */
    expect(seedToRefile(seeded({ "bd:md": 1200 }), "pb", "pb:mx")).toBeNull();
  });

  it("does not guess between two unplayed keys", () => {
    expect(seedToRefile(seeded({ "pb:ws": 1000, "pb:wd": 900 }), "pb", "pb:mx")).toBeNull();
  });
});
