import { describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

/* The rating engine asks the same question a typed result will be asked
 * (lib/scoring/final), through the real path: a match in the database,
 * `applyMatchRatings`, and what it wrote.
 *
 *  - A final no game produces moves nobody's rating — 15–4 in a game to 11
 *    used to be rated as a thumping win.
 *  - A result recorded as sets won is rated with a NEUTRAL margin: 2–1 in sets
 *    says nothing about how close the sets were, and reading it as a points
 *    margin gave a straight-sets win the same weight as 21–2 in badminton.
 *  - A points result is rated exactly as before. */

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

const { applyMatchRatings } = await import("./apply");
const { calcRtgChange, marginMultiplier } = await import("@/lib/rating");
const { buildScoring } = await import("@/lib/scoring/rules");

const owner = randomUUID();
await testDb.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });

async function person(sport: string): Promise<string> {
  const id = randomUUID();
  await testDb.insert(schema.people).values({
    id, name: `P ${id.slice(0, 4)}`, gender: "M",
    riseRatings: { [`${sport}:md`]: 1000 }, riseBest: 1000, matchCount: {},
  });
  return id;
}

/** One men's doubles match in `sport`, typed a–b, under the event's scoring. */
async function match(sport: "pb" | "tn" | "ch" | "cr", a: number, b: number, scoring?: Record<string, unknown>) {
  const [tournamentId, divisionId, teamA, teamB, matchId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  const sideA = [await person(sport), await person(sport)];
  const sideB = [await person(sport), await person(sport)];
  await testDb.insert(schema.tournaments).values({
    id: tournamentId, slug: `ev-${tournamentId.slice(0, 8)}`, name: "Event", sport,
    format: "standard", ownerId: owner, status: "live", ...(scoring ? { scoring } : {}),
  });
  await testDb.insert(schema.divisions).values({ id: divisionId, tournamentId, name: "Main" });
  await testDb.insert(schema.teams).values([
    { id: teamA, tournamentId, divisionId, name: "A", seed: 1 },
    { id: teamB, tournamentId, divisionId, name: "B", seed: 2 },
  ]);
  const player = (personId: string, teamId: string) => ({
    id: randomUUID(), tournamentId, teamId, personId, name: personId.slice(0, 4), gender: "M" as const, ratings: {},
  });
  await testDb.insert(schema.players).values([
    ...sideA.map((p) => player(p, teamA)),
    ...sideB.map((p) => player(p, teamB)),
  ]);
  await testDb.insert(schema.matches).values({
    id: matchId, tournamentId, divisionId, round: "Round 1", teamAId: teamA, teamBId: teamB,
    log: [], lineupA: [], lineupB: [], ackedGates: [], typedScoreA: a, typedScoreB: b, rev: 1,
  });
  return { matchId, winner: sideA[0] };
}

const historyOf = (matchId: string) =>
  testDb.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, matchId));

describe("the rating engine judges a final the way a typed result is judged", () => {
  it("moves nobody for a final no game produces", async () => {
    const { matchId } = await match("pb", 15, 4);
    expect(await applyMatchRatings(matchId)).toEqual({ status: "skipped", reason: "invalid score 15-4" });
    expect(await historyOf(matchId)).toHaveLength(0);
  });

  it("rates a points result off its margin, exactly as before", async () => {
    const { matchId } = await match("pb", 11, 3);
    expect((await applyMatchRatings(matchId)).status).toBe("applied");
    const [row] = await historyOf(matchId);
    expect(row.marginMultiplier).toBe(Math.round(marginMultiplier(11, 3) * 1000));
  });

  it("rates sets won with a neutral margin, recorded as 1.0", async () => {
    const { matchId, winner } = await match("tn", 2, 1);
    expect((await applyMatchRatings(matchId)).status).toBe("applied");
    const rows = await historyOf(matchId);
    expect(rows.every((r) => r.marginMultiplier === 1000)).toBe(true);
    /* And the rating that MOVED was computed with it — the history column
       alone would pass with the formula still reading 2–1 as a margin.
       Four newcomers at 1000: no carry, no damping, well inside the cap. */
    const neutral = calcRtgChange(1000, 1000, 2, 1, { margin: "neutral", winnerGames: 0, loserGames: 0 });
    const asPoints = calcRtgChange(1000, 1000, 2, 1, { winnerGames: 0, loserGames: 0 });
    expect(neutral.wG).not.toBe(asPoints.wG);
    expect(rows.find((r) => r.personId === winner)!.deltaApplied).toBe(neutral.wG);
  });

  it("refuses a sets result no best-of-3 match produces", async () => {
    const { matchId } = await match("tn", 3, 0);
    expect(await applyMatchRatings(matchId)).toEqual({ status: "skipped", reason: "invalid score 3-0" });
  });
});

describe("the neutral margin in the formula", () => {
  /* Evenly matched, organiser-entered, settled players: the change is
     32 × 0.5 × margin. Neutral is exactly 16; 2–1 read as points was 17. */
  it("is a multiplier of exactly 1", () => {
    const neutral = calcRtgChange(1000, 1000, 2, 1, { margin: "neutral" });
    const asPoints = calcRtgChange(1000, 1000, 2, 1);
    expect(neutral.delta).toBe(16);
    expect(asPoints.delta).toBe(Math.round(16 * marginMultiplier(2, 1)));
    expect(neutral.delta).not.toBe(asPoints.delta);
  });
});

describe("the other endings, through the real engine", () => {
  /* Chess keeps exactly what it had until step 10: a 1–0 read as a points
     margin (1.25). Nothing may quietly make it neutral. */
  it("rates chess with the margin it always had", async () => {
    const { matchId } = await match("ch", 1, 0);
    expect((await applyMatchRatings(matchId)).status).toBe("applied");
    const rows = await historyOf(matchId);
    expect(rows.every((r) => r.marginMultiplier === Math.round(marginMultiplier(1, 0) * 1000))).toBe(true);
  });

  it("rates a carrom last board past 25, and refuses both sides past it", async () => {
    expect((await applyMatchRatings((await match("cr", 29, 18)).matchId)).status).toBe("applied");
    expect(await applyMatchRatings((await match("cr", 26, 25)).matchId)).toEqual({ status: "skipped", reason: "invalid score 26-25" });
  });

  /* A carrom event set to win by two is played point by point on the console,
     which ends it at 27–25. The table counts that; the rating must too. */
  it("rates a carrom event set to win by two where the console ends it", async () => {
    const winByTwo = { target: 25, ...buildScoring(25, true, "none", null) };
    expect((await applyMatchRatings((await match("cr", 27, 25, winByTwo)).matchId)).status).toBe("applied");
    expect(await applyMatchRatings((await match("cr", 29, 18, winByTwo)).matchId)).toEqual({
      status: "skipped", reason: "invalid score 29-18",
    });
  });
});
