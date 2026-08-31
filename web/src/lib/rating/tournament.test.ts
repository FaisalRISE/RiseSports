import { describe, it, expect } from "vitest";
import { tournamentRatings, phaseOf, ratingFormatFor } from "./tournament";
import { DEFAULT_SEED } from "./index";
import type { Match, Player, Tournament } from "@/lib/db/schema";

/* Ratings are DERIVED from finished matches, never stored. These tests pin the
 * three properties that choice buys, because if any of them stops holding the
 * design should go back to a stored column with an applied-flag. */

const t = (over: Partial<Tournament> = {}): Tournament =>
  ({
    id: "t1", slug: "t", name: "T", sport: "pb", format: "standard",
    scoring: null, ownerId: null, scorerPinHash: null, startsAt: null,
    published: true, createdAt: new Date(),
    ...over,
  }) as Tournament;

const player = (id: string, teamId: string, over: Partial<Player> = {}): Player =>
  ({
    id, tournamentId: "t1", teamId, userId: null, name: id,
    gender: "M", ratings: {}, createdAt: new Date(),
    ...over,
  }) as Player;

/** A finished match, recorded as a typed score — the simplest kind of result. */
const match = (id: string, a: string, b: string, sa: number, sb: number, over: Partial<Match> = {}): Match =>
  ({
    id, tournamentId: "t1", round: "Round 1", court: null, scheduledAt: null,
    groupId: "g1", teamAId: a, teamBId: b, slotA: null, slotB: null,
    log: [], server: null, posA: null, posB: null, lineupA: [], lineupB: [],
    ackedGates: [], typedScoreA: sa, typedScoreB: sb, rev: 1,
    updatedAt: new Date(2026, 0, 1, 12, 0, 0), createdAt: new Date(),
    ...over,
  }) as Match;

describe("tournamentRatings", () => {
  const players = [player("p1", "A"), player("p2", "A"), player("p3", "B"), player("p4", "B")];

  it("moves the winners up and the losers down", () => {
    const rows = tournamentRatings(t(), players, [match("m1", "A", "B", 11, 4)]);
    const byId = new Map(rows.map((r) => [r.playerId, r]));
    expect(byId.get("p1")!.delta).toBeGreaterThan(0);
    expect(byId.get("p2")!.delta).toBeGreaterThan(0);
    expect(byId.get("p3")!.delta).toBeLessThan(0);
    expect(byId.get("p4")!.delta).toBeLessThan(0);
  });

  /* The conservation property spec §11 cares about. With everyone settled and
     both sides equally provisional, one delta leaves the losers and the same
     delta reaches the winners. */
  it("conserves the pool across a whole tournament", () => {
    const ms = [
      match("m1", "A", "B", 11, 4),
      match("m2", "B", "A", 11, 9, { updatedAt: new Date(2026, 0, 1, 13, 0, 0) }),
      match("m3", "A", "B", 11, 7, { updatedAt: new Date(2026, 0, 1, 14, 0, 0) }),
    ];
    const rows = tournamentRatings(t(), players, ms);
    const total = rows.reduce((s, r) => s + r.delta, 0);
    expect(total).toBe(0);
  });

  it("a match still in progress contributes nothing", () => {
    const unfinished = match("m1", "A", "B", 0, 0, { typedScoreA: null, typedScoreB: null });
    const rows = tournamentRatings(t(), players, [unfinished]);
    expect(rows.every((r) => r.delta === 0)).toBe(true);
    expect(rows.every((r) => r.played === 0)).toBe(true);
  });

  /* THE PROPERTY THAT JUSTIFIES DERIVING RATHER THAN STORING.
     Undo drops a rally, which can un-complete a match. With a stored rating
     that would need reversing; here the table simply recomputes to exactly
     where it was, because nothing was ever written. */
  it("un-completing a match returns the table to its previous state", () => {
    const before = tournamentRatings(t(), players, [match("m1", "A", "B", 11, 4)]);

    const withSecond = [
      match("m1", "A", "B", 11, 4),
      match("m2", "A", "B", 11, 6, { updatedAt: new Date(2026, 0, 1, 13, 0, 0) }),
    ];
    const during = tournamentRatings(t(), players, withSecond);
    expect(during.find((r) => r.playerId === "p1")!.current)
      .not.toBe(before.find((r) => r.playerId === "p1")!.current);

    // the second match is undone back to unfinished
    const undone = [
      match("m1", "A", "B", 11, 4),
      match("m2", "A", "B", 0, 0, { typedScoreA: null, typedScoreB: null, updatedAt: new Date(2026, 0, 1, 13, 0, 0) }),
    ];
    const after = tournamentRatings(t(), players, undone);
    expect(after).toEqual(before);
  });

  it("a draw moves nobody — there is no winner to move rating toward", () => {
    const rows = tournamentRatings(t({ sport: "ch" }), players, [match("m1", "A", "B", 7, 7)]);
    expect(rows.every((r) => r.delta === 0)).toBe(true);
  });

  it("reads the starting rating from players.ratings and never writes it", () => {
    const seeded = [
      player("p1", "A", { ratings: { "pb:md": 1200 } }),
      player("p2", "A", { ratings: { "pb:md": 1200 } }),
      player("p3", "B", { ratings: { "pb:md": 800 } }),
      player("p4", "B", { ratings: { "pb:md": 800 } }),
    ];
    const snapshot = JSON.stringify(seeded);
    const rows = tournamentRatings(t(), seeded, [match("m1", "A", "B", 11, 4)]);
    expect(rows.find((r) => r.playerId === "p1")!.start).toBe(1200);
    expect(rows.find((r) => r.playerId === "p3")!.start).toBe(800);
    expect(JSON.stringify(seeded)).toBe(snapshot); // untouched
  });

  it("an unrated player starts at the default seed", () => {
    const rows = tournamentRatings(t(), players, []);
    expect(rows.every((r) => r.start === DEFAULT_SEED && r.current === DEFAULT_SEED)).toBe(true);
  });

  /* Beating a favourite is worth more than beating an underdog.
   *
   * Note the seeded key must be the one the composition implies — two players
   * per team is "pb:md". Seeding "pb:md" on ONE-player teams looks up "pb:ms",
   * finds nothing, and both sides silently fall back to the default seed, which
   * makes the two cases identical and the test vacuous. That is not a quirk of
   * the test: it is how the derived key works, and it is why the key is shown
   * on the ratings page. */
  const pair = (rA: number, rB: number): Player[] => [
    player("p1", "A", { ratings: { "pb:md": rA } }),
    player("p2", "A", { ratings: { "pb:md": rA } }),
    player("p3", "B", { ratings: { "pb:md": rB } }),
    player("p4", "B", { ratings: { "pb:md": rB } }),
  ];

  it("an upset moves rating further than the expected result", () => {
    const expected = tournamentRatings(t(), pair(1200, 800), [match("m1", "A", "B", 11, 4)]);
    const upset = tournamentRatings(t(), pair(800, 1200), [match("m1", "A", "B", 11, 4)]);
    expect(upset.find((r) => r.playerId === "p1")!.delta)
      .toBeGreaterThan(expected.find((r) => r.playerId === "p1")!.delta);
  });

  /* Margin scales the movement but must not change who gains: an 11-9 win is
     worth less than an 11-0 win, and both are positive. */
  it("a bigger margin moves rating further", () => {
    const narrow = tournamentRatings(t(), pair(1000, 1000), [match("m1", "A", "B", 11, 9)]);
    const wide = tournamentRatings(t(), pair(1000, 1000), [match("m1", "A", "B", 11, 0)]);
    const d = (rows: ReturnType<typeof tournamentRatings>) =>
      rows.find((r) => r.playerId === "p1")!.delta;
    expect(d(wide)).toBeGreaterThan(d(narrow));
    expect(d(narrow)).toBeGreaterThan(0);
  });

  /* A final is weighted above a group match — spec §4.5's stage multiplier. */
  it("a final moves rating further than a group match", () => {
    const group = tournamentRatings(t(), pair(1000, 1000), [match("m1", "A", "B", 11, 4)]);
    const final = tournamentRatings(t(), pair(1000, 1000), [
      match("m1", "A", "B", 11, 4, { round: "Final" }),
    ]);
    expect(final.find((r) => r.playerId === "p1")!.delta)
      .toBeGreaterThan(group.find((r) => r.playerId === "p1")!.delta);
  });

  it("orders the table by current rating", () => {
    const rows = tournamentRatings(t(), players, [match("m1", "A", "B", 11, 4)]);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i - 1].current).toBeGreaterThanOrEqual(rows[i].current);
    }
  });

  /* Rating is path-dependent: beating someone before they climb is worth less
     than beating them after, so the walk has to be chronological. */
  it("walks matches in chronological order, not row order", () => {
    const forward = [
      match("m1", "A", "B", 11, 4, { updatedAt: new Date(2026, 0, 1, 12, 0, 0) }),
      match("m2", "A", "B", 11, 4, { updatedAt: new Date(2026, 0, 1, 13, 0, 0) }),
    ];
    const shuffled = [forward[1], forward[0]];
    expect(tournamentRatings(t(), players, shuffled)).toEqual(tournamentRatings(t(), players, forward));
  });
});

describe("phaseOf", () => {
  it("reads the phase out of the round label", () => {
    expect(phaseOf("Final")).toBe("final");
    expect(phaseOf("Grand Final")).toBe("final");
    expect(phaseOf("Semi-finals")).toBe("semi");
    expect(phaseOf("Quarter-finals")).toBe("quarter");
    expect(phaseOf("Round 1")).toBe("group");
    expect(phaseOf("Group A")).toBe("group");
  });

  /* "Semi-finals" contains "final". Without the guard it would rate a semi as a
     final and inflate it by 1.5x instead of 1.3x. */
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
    const squad = ["a", "b", "c", "d", "e", "f"].map((n) => player(n, "A"));
    expect(ratingFormatFor(squad)).toBe("gn");
  });

  it("does not crash on players with no team", () => {
    expect(ratingFormatFor([player("a", null as never)])).toBe("gn");
    expect(ratingFormatFor([])).toBe("gn");
  });
});
