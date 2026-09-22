import { describe, it, expect } from "vitest";
import { phaseOf, categoryFormat, seedToRefile } from "./tournament";
import { pairsFormat } from "@/lib/rating";
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

/* The rating a CATEGORY's results move. `ev(n)` is an ordinary event with a
   minimum team size of n; the third argument is the category's gender rule. */
const ev = (minTeamSize: number, format = "standard") => ({ minTeamSize, format });

describe("categoryFormat", () => {
  it("reads doubles categories off the team composition", () => {
    const men = [player("a", "A"), player("b", "A"), player("c", "B"), player("d", "B")];
    expect(categoryFormat(men, ev(1), null)).toBe("md");

    const women = men.map((p) => ({ ...p, gender: "F" as const }));
    expect(categoryFormat(women, ev(1), null)).toBe("wd");
  });

  /* Faisal, 2026-09-22: an open category (no rule) whose PAIRS differ — some
     two men, some mixed — gets its own Open rating. It used to be mixed — and
     it used to be decided for the whole EVENT, so Men's Doubles beside
     Women's Doubles moved everybody's mixed. */
  it("gives an open category with a mixture of pairs its own Open doubles rating", () => {
    const mixedUp = [
      player("a", "A"), player("b", "A"),
      player("c", "B"), player("d", "B", { gender: "F" }),
    ];
    expect(categoryFormat(mixedUp, ev(1), null)).toBe("od");
    /* Every pair mixed is simply mixed doubles — how the wizard's untouched
       "Main" category runs a mixed event. */
    const allMixed = [
      player("a", "A"), player("b", "A", { gender: "F" }),
      player("c", "B"), player("d", "B", { gender: "F" }),
    ];
    expect(categoryFormat(allMixed, ev(1), null)).toBe("mx");
    /* Men's pairs and women's pairs together are a mixture too. */
    expect(categoryFormat([
      player("a", "A"), player("b", "A"),
      player("c", "B", { gender: "F" }), player("d", "B", { gender: "F" }),
    ], ev(1), null)).toBe("od");
    /* Open SINGLES stays the general bucket: singles and doubles are never one key. */
    expect(categoryFormat([player("a", "A"), player("b", "B", { gender: "F" })], ev(1), null)).toBe("gn");
  });

  it("lets the category's rule decide over who happens to be in it", () => {
    const pairs = [player("a", "A"), player("b", "A", { gender: "F" }), player("c", "B"), player("d", "B", { gender: "F" })];
    expect(categoryFormat(pairs, ev(1), "MX")).toBe("mx");
    /* A woman the organiser let into Men's Doubles is rated as men's doubles THERE. */
    expect(categoryFormat(pairs, ev(1), "M")).toBe("md");
    expect(categoryFormat(pairs, ev(1), "F")).toBe("wd");
  });

  it("reads a Mixed category as pairs even while its first team has one player", () => {
    expect(categoryFormat([player("a", "A")], ev(1), "MX")).toBe("mx");
    expect(categoryFormat([player("a", "A")], ev(1), "M")).toBe("ms");
  });

  it("reads singles off one-player teams", () => {
    expect(categoryFormat([player("a", "A"), player("b", "B")], ev(1), null)).toBe("ms");
    expect(categoryFormat([
      player("a", "A", { gender: "F" }), player("b", "B", { gender: "F" }),
    ], ev(1), null)).toBe("ws");
  });

  /* The first player of an empty doubles event is a team of one, and was filed
     as singles. */
  it("counts a team still being filled as the event's minimum size", () => {
    expect(categoryFormat([player("a", "A")], ev(2), null)).toBe("md");
    expect(categoryFormat([player("a", "A", { gender: "F" })], ev(2), null)).toBe("wd");
    /* Half-filled pairs: every team is one short. */
    expect(categoryFormat([player("a", "A"), player("b", "B"), player("c", "C")], ev(2), null)).toBe("md");
  });

  it("changes nothing at the default minimum of one, or for a complete roster", () => {
    expect(categoryFormat([player("a", "A")], ev(1), null)).toBe("ms");
    const pairs = [player("a", "A"), player("b", "A"), player("c", "B"), player("d", "B")];
    expect(categoryFormat(pairs, ev(1), null)).toBe(categoryFormat(pairs, ev(2), null));
    /* A nonsense minimum is read as one, not as "no teams". */
    expect(categoryFormat([player("a", "A")], ev(0), null)).toBe("ms");
  });

  it("reads a minimum above a pair as the general bucket, whatever the rule", () => {
    expect(categoryFormat([player("a", "A")], ev(6), null)).toBe("gn");
    /* A Mixed category with a reserve is still not a pairs event. */
    const squads = ["a", "b", "c"].map((n) => player(n, "A"));
    expect(categoryFormat(squads, ev(1), "MX")).toBe("gn");
  });

  /* OSL runs six-player teams. Its first player used to be filed as singles. */
  it("rates an OSL event in the general bucket from its first player", () => {
    expect(categoryFormat([player("a", "A")], ev(1, "osl"), null)).toBe("gn");
    expect(categoryFormat(["a", "b", "c", "d", "e", "f"].map((n) => player(n, "A")), ev(1), null)).toBe("gn");
  });

  it("does not crash on players with no team", () => {
    expect(categoryFormat([player("a", null)], ev(1), null)).toBe("gn");
    expect(categoryFormat([], ev(1), null)).toBe("gn");
  });
});

describe("pairsFormat", () => {
  it("reads what the pairs are", () => {
    expect(pairsFormat([["M", "M"], ["M", "M"]])).toBe("md");
    expect(pairsFormat([["F", "F"], ["F", "F"]])).toBe("wd");
    expect(pairsFormat([["M", "F"], ["F", "M"]])).toBe("mx");
    expect(pairsFormat([["M", "M"], ["M", "F"]])).toBe("od");
  });

  /* A team of one says nothing about its pair yet: judged only while nothing
     fuller exists. */
  it("judges full pairs once there are any", () => {
    expect(pairsFormat([["M", "F"], ["M"]])).toBe("mx");
    expect(pairsFormat([["F"]])).toBe("wd");
    expect(pairsFormat([])).toBe("md");
  });

  /* An unknown gender never makes a pair mixed or women's on its own. */
  it("counts an unknown gender as it always has", () => {
    expect(pairsFormat([[null, "F"], ["F", "F"]])).toBe("wd");
    expect(pairsFormat([[null, null]])).toBe("md");
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
