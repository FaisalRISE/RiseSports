import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* The test that would have caught the bug this file exists because of.
 *
 * `apply.ts` recorded partner IDS but not partner RATINGS, so every reader
 * supplied `partnerRatings: []`, `carriedShare` was permanently 0, and the
 * Reliability Index's independence component could never fire. The unit tests
 * passed the whole time — because they fed `partnerRatings` straight into
 * `reliabilityOf`, going around the pipeline rather than through it.
 *
 * So this drives the REAL path: a real migration, a real match, a real
 * `applyMatchRatings`, and reliability read back out of what was actually
 * stored. Asserting on hand-built inputs is what let the feature sit inert. */

const dir = path.join(os.tmpdir(), `rise-pipeline-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

/* Imported dynamically: `lib/db` reads DATABASE_URL when the module first
   loads, so it has to be set before that happens. */
let apply: typeof import("./apply");
let reliability: typeof import("./reliability");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");

const ids = {
  owner: randomUUID(), tournament: randomUUID(),
  teamA: randomUUID(), teamB: randomUUID(), match: randomUUID(),
  strong: randomUUID(), weak: randomUUID(), oppA: randomUUID(), oppB: randomUUID(),
};

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  apply = await import("./apply");
  reliability = await import("./reliability");

  /* Same approach as schema.test.ts: run the generated migrations so this is
     the schema that will actually ship. */
  const migrations = path.resolve(process.cwd(), "drizzle");
  const files = fs.readdirSync(migrations).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const sql = fs.readFileSync(path.join(migrations, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }

  const { users, tournaments, teams, players, matches, people } = schema;
  await db.insert(users).values({ id: ids.owner, email: "t@e.st", name: "Organiser" });
  await db.insert(tournaments).values({
    id: ids.tournament, slug: "pipeline", name: "Pipeline", sport: "pb",
    format: "standard", ownerId: ids.owner, published: true,
  });
  await db.insert(teams).values([
    { id: ids.teamA, tournamentId: ids.tournament, name: "A", seed: 1 },
    { id: ids.teamB, tournamentId: ids.tournament, name: "B", seed: 2 },
  ]);

  /* A 400-point gap inside the winning pair — the §6.1 carry case, and the
     §7 independence case, are the same situation seen from two angles. */
  const person = (id: string, name: string, rating: number) => ({
    id, name, gender: "M" as const,
    riseRatings: { "pb:md": rating }, riseBest: rating, matchCount: {},
  });
  await db.insert(people).values([
    person(ids.strong, "Strong", 1200),
    person(ids.weak, "Weak", 800),
    person(ids.oppA, "OppA", 850),
    person(ids.oppB, "OppB", 850),
  ]);

  const player = (personId: string, teamId: string, name: string) => ({
    id: randomUUID(), tournamentId: ids.tournament, teamId, personId, name,
    gender: "M" as const, ratings: {},
  });
  await db.insert(players).values([
    player(ids.strong, ids.teamA, "Strong"),
    player(ids.weak, ids.teamA, "Weak"),
    player(ids.oppA, ids.teamB, "OppA"),
    player(ids.oppB, ids.teamB, "OppB"),
  ]);

  await db.insert(matches).values({
    id: ids.match, tournamentId: ids.tournament, round: "Round 1",
    teamAId: ids.teamA, teamBId: ids.teamB,
    log: [], lineupA: [], lineupB: [], ackedGates: [],
    typedScoreA: 11, typedScoreB: 3, rev: 1,
  });
}, 120_000);

afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

describe("a finished match, all the way through", () => {
  it("applies", async () => {
    const res = await apply.applyMatchRatings(ids.match);
    expect(res.status).toBe("applied");
  });

  it("is idempotent — applying twice moves nothing", async () => {
    const before = await db.select().from(schema.people).where(eq(schema.people.id, ids.strong));
    const again = await apply.applyMatchRatings(ids.match);
    expect(again.status).toBe("already");
    const after = await db.select().from(schema.people).where(eq(schema.people.id, ids.strong));
    expect(after[0].riseBest).toBe(before[0].riseBest);
  });

  /* THE ONE THAT MATTERS. Without partner ratings in the stored notes, the
     independence component below is silently perfect for everyone. */
  it("records partner and opponent RATINGS, not just ids", async () => {
    const rows = await db
      .select()
      .from(schema.ratingHistory)
      .where(eq(schema.ratingHistory.personId, ids.weak));
    expect(rows).toHaveLength(1);
    const notes = rows[0].notes as { partnerRatings?: number[]; opponentRatings?: number[] };
    expect(notes.partnerRatings).toEqual([1200]);
    expect(notes.opponentRatings).toEqual([850, 850]);
  });

  it("independence actually fires for a carried win", async () => {
    const rows = await db.select().from(schema.ratingHistory);
    const weak = reliability.reliabilityForPerson(rows as never, ids.weak, new Date());
    const strong = reliability.reliabilityForPerson(rows as never, ids.strong, new Date());

    /* The weaker partner won beside someone 400 above: every win of theirs is
       carried, so independence is zero. The stronger partner's is untouched. */
    expect(weak.parts.independence).toBe(0);
    expect(strong.parts.independence).toBe(25);

    /* The headline REASON still says "only 1 match", and rightly so — with one
       game played, volume is a bigger gap than independence, and the reason
       names whichever component is weakest. The carried-partner wording is
       pinned in reliability.test.ts where volume is not the binding
       constraint. */
    expect(weak.score).toBeLessThan(strong.score);
  });

  it("applies the §6.1 carry guard to the weaker partner only", async () => {
    const rows = await db.select().from(schema.ratingHistory);
    const weak = rows.find((r) => r.personId === ids.weak)!;
    const strong = rows.find((r) => r.personId === ids.strong)!;
    expect(weak.deltaApplied).toBeLessThan(strong.deltaApplied);
    expect((weak.notes as { carried?: boolean }).carried).toBe(true);
    expect((strong.notes as { carried?: boolean }).carried).toBe(false);
  });

  it("writes the §6.2 partner statistics", async () => {
    const [weak] = await db.select().from(schema.people).where(eq(schema.people.id, ids.weak));
    const stats = weak.partnerStats as Record<string, { matches: number; wins: number; avgPartnerRating: number }>;
    expect(stats[ids.strong]).toBeDefined();
    expect(stats[ids.strong].matches).toBe(1);
    expect(stats[ids.strong].wins).toBe(1);
    expect(stats[ids.strong].avgPartnerRating).toBe(1200);
  });

  it("records the imbalance in the ledger rather than minting it silently", async () => {
    const ledger = await db.select().from(schema.ratingLedger);
    expect(ledger.length).toBeGreaterThan(0);
    expect(ledger[0].reason).toMatch(/carry guard/);
  });

  it("keeps the working, so a disputed rating can be explained", async () => {
    const [row] = await db
      .select()
      .from(schema.ratingHistory)
      .where(eq(schema.ratingHistory.personId, ids.strong));
    expect(row.expected).toBeGreaterThan(0);
    expect(row.marginMultiplier).toBeGreaterThan(0);
    expect(row.stageMultiplier).toBe(1000);
    expect(row.verificationWeight).toBe(1000);
    expect(row.ratingAfter - row.ratingBefore).toBe(row.deltaApplied);
  });

  it("reverting removes the history and puts the ratings back", async () => {
    const [before] = await db.select().from(schema.people).where(eq(schema.people.id, ids.weak));
    const { reverted } = await apply.revertMatchRatings(ids.match);
    expect(reverted).toBe(4);

    const rows = await db.select().from(schema.ratingHistory);
    expect(rows).toHaveLength(0);

    /* Straight back to the rating she started the match on. */
    const [after] = await db.select().from(schema.people).where(eq(schema.people.id, ids.weak));
    expect(before.riseBest).not.toBe(800);
    expect(after.riseBest).toBe(800);
  });
});

/* Imported after the env var is set, so it cannot be a static import above. */
import { eq } from "drizzle-orm";
