import { describe, it, expect, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, inArray } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

/* Community play is where most rating movement in the product happens — the
 * legacy app applies a change on EVERY community score (app.source.js:10077).
 * So these tests are about the rating, not about the pairings: that a score
 * moves it, that it moves the right way, that it moves once, and that undoing
 * puts it back.
 *
 * Against a real Postgres, because the guarantees being tested are the unique
 * index and the CHECK as much as the arithmetic. */
const client = new PGlite();
const testDb = drizzle(client, { schema });

vi.mock("@/lib/db", () => ({ db: testDb }));
vi.mock("server-only", () => ({}));

const dir = path.resolve(process.cwd(), "drizzle");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

const { generateSchedule, scheduleFor, saveScore, clearScore, communityRatingKey } =
  await import("./schedule");
const { confirmPlayer } = await import("./roster");

const DATE = "2026-09-17";
let game: schema.CommunityGame;

/** Deterministic, so "random" mode does not make these flaky. */
const fixedRand = () => 0.5;

async function setUp(over: Partial<schema.CommunityGame> = {}, playerCount = 4) {
  await testDb.delete(schema.communityGames);
  await testDb.delete(schema.people);

  const [g] = await testDb
    .insert(schema.communityGames)
    .values({
      id: "g1", slug: "g1", name: "Thursday Night",
      courts: 1, perCourt: 4, scheduleMode: "balanced", rotation: "fixed",
      ...over,
    })
    .returning();

  await testDb.insert(schema.people).values(
    Array.from({ length: playerCount }, (_, i) => ({
      id: `p${i + 1}`,
      name: `Player ${i + 1}`,
      gender: (i % 2 === 0 ? "M" : "F") as "M" | "F",
      riseBest: 1000,
      riseRatings: { "pb:mx": 1000 },
    })),
  );
  return g;
}

const ratingOf = async (id: string) => {
  const [p] = await testDb.select().from(schema.people).where(eq(schema.people.id, id));
  return p.riseRatings["pb:mx"] ?? p.riseBest;
};

async function confirmAll(n: number) {
  for (let i = 1; i <= n; i++) await confirmPlayer(game, DATE, `p${i}`);
}

beforeEach(async () => {
  game = await setUp();
});

describe("communityRatingKey", () => {
  const g = new Map<string, "M" | "F">([["a", "M"], ["b", "F"], ["c", "M"], ["d", "M"]]);

  it("reads the category off the court, not off the game", () => {
    expect(communityRatingKey("pb", ["a", "c"], ["d", "a"], g)).toBe("pb:md");
    expect(communityRatingKey("pb", ["a", "b"], ["c", "d"], g)).toBe("pb:mx");
    expect(communityRatingKey("pb", ["a"], ["c"], g)).toBe("pb:ms");
  });

  it("buckets anything bigger than a pair as general", () => {
    expect(communityRatingKey("pb", ["a", "b", "c"], ["d", "a", "b"], g)).toBe("pb:gn");
  });

  it("follows the game's sport", () => {
    expect(communityRatingKey("bd", ["a", "c"], ["d", "a"], g)).toBe("bd:md");
  });
});

describe("generating a schedule", () => {
  it("refuses with fewer than two confirmed", async () => {
    await confirmAll(1);
    expect((await generateSchedule(game, DATE, fixedRand)).ok).toBe(false);
  });

  it("makes three games for one court of four", async () => {
    await confirmAll(4);
    const res = await generateSchedule(game, DATE, fixedRand);
    expect(res).toEqual({ ok: true, games: 3 });

    const s = await scheduleFor(game, DATE);
    expect(s.blocks).toHaveLength(1);
    expect(s.blocks[0].courts).toHaveLength(1);
    expect(s.blocks[0].courts[0].games).toHaveLength(3);
  });

  it("names everyone who appears in it", async () => {
    await confirmAll(4);
    await generateSchedule(game, DATE, fixedRand);
    const s = await scheduleFor(game, DATE);
    expect(s.names.get("p1")).toBe("Player 1");
    expect(s.names.size).toBe(4);
  });

  it("gives a reshuffling game two labelled halves", async () => {
    game = await setUp({ rotation: "rotate", startTime: "20:00", endTime: "22:00" });
    await confirmAll(4);
    await generateSchedule(game, DATE, fixedRand);

    const s = await scheduleFor(game, DATE);
    expect(s.blocks).toHaveLength(2);
    expect(s.blocks.map((b) => b.label)).toEqual(["20:00–21:00", "21:00–22:00"]);
  });

  it("records who sat out", async () => {
    /* Five in singles across four courts: two courts of two, one person out.
       The capacity gate means confirmed can never exceed courts × perCourt, so
       an odd number in singles is the case where somebody genuinely sits. */
    game = await setUp({ courts: 4, perCourt: 2 }, 5);
    await confirmAll(5);
    await generateSchedule(game, DATE, fixedRand);

    const s = await scheduleFor(game, DATE);
    expect(s.blocks[0].benched).toHaveLength(1);
    expect(s.blocks[0].courts).toHaveLength(2);
  });

  it("uses both booked courts for six players rather than benching two", async () => {
    /* The legacy rule seats four and benches two beside an empty court. */
    game = await setUp({ courts: 2, perCourt: 4 }, 6);
    await confirmAll(6);
    await generateSchedule(game, DATE, fixedRand);

    const s = await scheduleFor(game, DATE);
    expect(s.blocks[0].courts).toHaveLength(2);
    expect(s.blocks[0].benched).toEqual([]);
  });

  it("keeps several games on one court apart", async () => {
    /* The unique index is (session, block, court), so three games on court 1
       need distinct stored court numbers — and must read back as court 1. */
    await confirmAll(4);
    await generateSchedule(game, DATE, fixedRand);
    const s = await scheduleFor(game, DATE);
    expect(s.blocks[0].courts.map((c) => c.court)).toEqual([1]);
    expect(s.blocks[0].courts[0].games.every((g) => g.court === 1)).toBe(true);
  });

  it("is empty before anything is generated", async () => {
    expect(await scheduleFor(game, DATE)).toEqual({ blocks: [], names: new Map() });
  });

  it("can be regenerated while no score has been entered", async () => {
    await confirmAll(4);
    await generateSchedule(game, DATE, fixedRand);
    expect((await generateSchedule(game, DATE, fixedRand)).ok).toBe(true);

    /* …and does not accumulate duplicates. */
    const rows = await testDb.select().from(schema.communityMatches);
    expect(rows).toHaveLength(3);
  });

  it("refuses to reshuffle once a score has counted", async () => {
    await confirmAll(4);
    await generateSchedule(game, DATE, fixedRand);
    const s = await scheduleFor(game, DATE);
    await saveScore(game, s.blocks[0].courts[0].games[0].id, 11, 7);

    const res = await generateSchedule(game, DATE, fixedRand);
    expect(res.ok).toBe(false);
    /* The reason matters: reshuffling would orphan a rating change. */
    expect(res.ok === false && res.error).toContain("already");
  });
});

describe("saving a score moves the rating", () => {
  let gameId: string;

  beforeEach(async () => {
    await confirmAll(4);
    await generateSchedule(game, DATE, fixedRand);
    const s = await scheduleFor(game, DATE);
    gameId = s.blocks[0].courts[0].games[0].id;
  });

  const sides = async () => {
    const [m] = await testDb.select().from(schema.communityMatches)
      .where(eq(schema.communityMatches.id, gameId));
    return { a: m.lineupA, b: m.lineupB };
  };

  it("moves the winners up and the losers down", async () => {
    const { a, b } = await sides();
    const before = await Promise.all([...a, ...b].map(ratingOf));

    const res = await saveScore(game, gameId, 11, 7);
    expect(res).toMatchObject({ ok: true, ratingApplied: true });

    for (const id of a) expect(await ratingOf(id)).toBeGreaterThan(before[0]);
    for (const id of b) expect(await ratingOf(id)).toBeLessThan(before[0]);
  });

  it("writes the working, so a disputed rating can be explained", async () => {
    await saveScore(game, gameId, 11, 7);
    const rows = await testDb.select().from(schema.ratingHistory)
      .where(eq(schema.ratingHistory.communityMatchId, gameId));

    expect(rows).toHaveLength(4);
    for (const r of rows) {
      /* The whole point of migration 0006's CHECK: a community result is
         attributable, exactly like a tournament one. */
      expect(r.matchId).toBeNull();
      expect(r.communityMatchId).toBe(gameId);
      expect(r.expected).toBeGreaterThan(0);
      expect(r.ratingAfter - r.ratingBefore).toBe(r.deltaApplied);
    }
  });

  it("counts it in the right bucket for who was on court", async () => {
    /* p1 and p3 are men, p2 and p4 women — the pairing decides md / wd / mx. */
    await saveScore(game, gameId, 11, 7);
    const [row] = await testDb.select().from(schema.ratingHistory)
      .where(eq(schema.ratingHistory.communityMatchId, gameId)).limit(1);
    expect(["pb:md", "pb:wd", "pb:mx"]).toContain(row.format);
  });

  it("counts only once, however many times it is saved", async () => {
    await saveScore(game, gameId, 11, 7);
    const after = await ratingOf((await sides()).a[0]);

    const second = await saveScore(game, gameId, 11, 7);
    expect(second.ok).toBe(false);
    expect(await ratingOf((await sides()).a[0])).toBe(after);

    const rows = await testDb.select().from(schema.ratingHistory)
      .where(eq(schema.ratingHistory.communityMatchId, gameId));
    expect(rows).toHaveLength(4);
  });

  it("refuses a draw", async () => {
    const res = await saveScore(game, gameId, 11, 11);
    expect(res.ok).toBe(false);
    expect(await testDb.select().from(schema.ratingHistory)).toHaveLength(0);
  });

  it("refuses a negative score", async () => {
    expect((await saveScore(game, gameId, -1, 7)).ok).toBe(false);
  });

  it("records the score on the game either way round", async () => {
    await saveScore(game, gameId, 7, 11);
    const [m] = await testDb.select().from(schema.communityMatches)
      .where(eq(schema.communityMatches.id, gameId));
    expect([m.scoreA, m.scoreB]).toEqual([7, 11]);

    /* Side B won, so side B's players went up. */
    for (const id of m.lineupB) expect(await ratingOf(id)).toBeGreaterThan(1000);
    for (const id of m.lineupA) expect(await ratingOf(id)).toBeLessThan(1000);
  });

  it("goes through the same engine as a tournament, not a second copy", async () => {
    /* The tell: the tournament engine records a daily cap, repeat damping and a
       carry guard in `notes`, and writes an imbalance to the ledger when
       conservation is deliberately broken. A hand-rolled community applier
       would have none of that. */
    await saveScore(game, gameId, 11, 7);
    const [row] = await testDb.select().from(schema.ratingHistory)
      .where(eq(schema.ratingHistory.communityMatchId, gameId)).limit(1);

    const notes = row.notes as Record<string, unknown>;
    expect(notes).toHaveProperty("damped");
    expect(notes).toHaveProperty("carried");
    expect(notes).toHaveProperty("opponentRatings");
    expect(row.verificationWeight).toBeGreaterThan(0);
    expect(row.provisionalMultiplier).toBeGreaterThan(0);
  });

  it("puts the rating back when the score is cleared", async () => {
    const { a } = await sides();
    const before = await ratingOf(a[0]);

    await saveScore(game, gameId, 11, 7);
    expect(await ratingOf(a[0])).not.toBe(before);

    await clearScore(gameId);
    expect(await ratingOf(a[0])).toBe(before);

    const rows = await testDb.select().from(schema.ratingHistory)
      .where(eq(schema.ratingHistory.communityMatchId, gameId));
    expect(rows).toHaveLength(0);

    const [m] = await testDb.select().from(schema.communityMatches)
      .where(eq(schema.communityMatches.id, gameId));
    expect(m.scoreA).toBeNull();
  });

  it("lets a cleared score be entered again", async () => {
    await saveScore(game, gameId, 11, 7);
    await clearScore(gameId);
    expect((await saveScore(game, gameId, 11, 9)).ok).toBe(true);
  });
});

describe("deleting a session takes its results with it", () => {
  it("leaves no orphaned rating rows", async () => {
    await confirmAll(4);
    await generateSchedule(game, DATE, fixedRand);
    const s = await scheduleFor(game, DATE);
    await saveScore(game, s.blocks[0].courts[0].games[0].id, 11, 7);
    expect(await testDb.select().from(schema.ratingHistory)).toHaveLength(4);

    await testDb.delete(schema.communityGames).where(eq(schema.communityGames.id, game.id));

    /* A rating row that outlived its game would violate the CHECK's whole
       purpose: a rating that moved, with nothing to point at. */
    expect(await testDb.select().from(schema.ratingHistory)).toHaveLength(0);
    expect(await testDb.select().from(schema.communityMatches)).toHaveLength(0);
  });
});

describe("a whole evening", () => {
  it("plays three games on a court and leaves everyone rated", async () => {
    await confirmAll(4);
    await generateSchedule(game, DATE, fixedRand);
    const s = await scheduleFor(game, DATE);

    const scores: [number, number][] = [[11, 7], [9, 11], [11, 5]];
    for (const [i, g] of s.blocks[0].courts[0].games.entries()) {
      const res = await saveScore(game, g.id, ...scores[i]);
      expect(res.ok, `game ${i + 1}`).toBe(true);
    }

    const rows = await testDb.select().from(schema.ratingHistory);
    expect(rows).toHaveLength(12); // 3 games × 4 people

    /* Everyone played all three, so everyone has three entries and a match
       count that agrees with them. */
    const folk = await testDb.select().from(schema.people)
      .where(inArray(schema.people.id, ["p1", "p2", "p3", "p4"]));
    for (const p of folk) {
      const counted = Object.values(p.matchCount as Record<string, number>)
        .reduce((a, b) => a + b, 0);
      expect(counted, p.id).toBe(3);
    }
  });
});
