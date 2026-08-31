import { describe, it, expect } from "vitest";
import { phaseOf, ratingFormatFor } from "./tournament";
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
    expect(ratingFormatFor(men)).toBe("md");

    const women = men.map((p) => ({ ...p, gender: "F" as const }));
    expect(ratingFormatFor(women)).toBe("wd");

    const mixed = [
      player("a", "A"), player("b", "A", { gender: "F" }),
      player("c", "B"), player("d", "B", { gender: "F" }),
    ];
    expect(ratingFormatFor(mixed)).toBe("mx");
  });

  it("reads singles off one-player teams", () => {
    expect(ratingFormatFor([player("a", "A"), player("b", "B")])).toBe("ms");
    expect(ratingFormatFor([
      player("a", "A", { gender: "F" }), player("b", "B", { gender: "F" }),
    ])).toBe("ws");
  });

  /* OSL runs six-player teams, which is none of the conventional categories. */
  it("falls back to the general bucket for larger teams", () => {
    expect(ratingFormatFor(["a", "b", "c", "d", "e", "f"].map((n) => player(n, "A")))).toBe("gn");
  });

  it("does not crash on players with no team", () => {
    expect(ratingFormatFor([player("a", null)])).toBe("gn");
    expect(ratingFormatFor([])).toBe("gn");
  });
});
