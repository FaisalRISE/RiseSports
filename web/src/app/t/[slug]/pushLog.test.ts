import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* A phone's offline log, landing: through the real `pushLog` action, against a
 * real database, with the rating it moves.
 *
 * A referee with no signal could tap once more after the winning rally — the
 * court stayed tappable, because its lock came from the server's view and the
 * server had not seen the finish. So 11–4 in a game to 11 landed as 12–4. That
 * is a final no game produces: the rating engine refuses it, and an undo back to
 * 11–4 did not bring the rating back (the match was over both before and
 * after, so nothing re-applied it). The server now cuts a log at the rally that
 * ended the game, so the extra tap never lands. */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const dir = path.join(os.tmpdir(), `rise-pushlog-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let actions: typeof import("./actions");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;

const owner = randomUUID();

/** A pickleball match between two men's pairs, to 11, side-out, A serving. */
async function match(): Promise<string> {
  const [tournamentId, divisionId, teamA, teamB, matchId] = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.insert(schema.tournaments).values({
    id: tournamentId, slug: `pl-${tournamentId.slice(0, 8)}`, name: "Push", sport: "pb",
    format: "standard", ownerId: owner, status: "live",
  });
  await db.insert(schema.divisions).values({ id: divisionId, tournamentId, name: "Main" });
  await db.insert(schema.teams).values([
    { id: teamA, tournamentId, divisionId, name: "A", seed: 1 },
    { id: teamB, tournamentId, divisionId, name: "B", seed: 2 },
  ]);
  for (const teamId of [teamA, teamA, teamB, teamB]) {
    const personId = randomUUID();
    await db.insert(schema.people).values({
      id: personId, name: personId.slice(0, 4), gender: "M", riseRatings: { "pb:md": 1000 }, riseBest: 1000, matchCount: {},
    });
    await db.insert(schema.players).values({
      id: randomUUID(), tournamentId, teamId, personId, name: personId.slice(0, 4), gender: "M", ratings: {},
    });
  }
  await db.insert(schema.matches).values({
    id: matchId, tournamentId, divisionId, round: "Round 1", teamAId: teamA, teamBId: teamB,
    log: [], lineupA: [], lineupB: [], ackedGates: [], server: "a", rev: 0,
  });
  return matchId;
}

/* 11–4 under side-out: A holds serve for 7; B's first rally wins the serve (the
   opening turn has one server); B holds for 4; A takes two rallies to win it
   back (B's second server); A holds for 4. */
const ELEVEN_FOUR = [
  ...Array(7).fill("a"), "b", ...Array(4).fill("b"), "a", "a", ...Array(4).fill("a"),
] as ("a" | "b")[];

const stored = async (id: string) =>
  (await db.select().from(schema.matches).where(eq(schema.matches.id, id)))[0];
const ratingRows = async (id: string) =>
  db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, id));

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  actions = await import("./actions");
  ({ eq } = await import("drizzle-orm"));

  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrations, f), "utf8").split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }
  await db.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });
}, 120_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a log that lands from a phone", () => {
  it("is exactly 11–4 when it is exactly 11–4, and rated", async () => {
    const m = await match();
    expect(await actions.pushLog(m, ELEVEN_FOUR, 0)).toEqual({ ok: true, rev: 1 });
    expect((await stored(m)).log).toEqual(ELEVEN_FOUR);
    expect(await ratingRows(m)).toHaveLength(4);
  });

  it("is cut at the winning rally when it carries a tap past it — and is still rated", async () => {
    const m = await match();
    expect(await actions.pushLog(m, [...ELEVEN_FOUR, "a"], 0)).toEqual({ ok: true, rev: 1 });
    expect((await stored(m)).log).toEqual(ELEVEN_FOUR);
    expect(await ratingRows(m)).toHaveLength(4);
  });

  it("stays rated when an undo follows", async () => {
    const m = await match();
    await actions.pushLog(m, [...ELEVEN_FOUR, "a", "a"], 0);
    /* The last rally undone takes the match off the finish: the rating goes. */
    expect(await actions.undoPoint(m, 1)).toEqual({ ok: true });
    expect(await ratingRows(m)).toHaveLength(0);
    /* And the winning rally again puts it back. */
    expect(await actions.pushLog(m, ELEVEN_FOUR, 2)).toEqual({ ok: true, rev: 3 });
    expect(await ratingRows(m)).toHaveLength(4);
  });

  it("is stored whole while the game is unfinished", async () => {
    const m = await match();
    const halfway = ELEVEN_FOUR.slice(0, 10);
    expect(await actions.pushLog(m, halfway, 0)).toEqual({ ok: true, rev: 1 });
    expect((await stored(m)).log).toEqual(halfway);
    expect(await ratingRows(m)).toHaveLength(0);
  });
});
