import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* The profile's honours must name the same champion as the event page.
 *
 * `honoursFor` answers in one query and `podiumFor` in memory, so the rule for
 * "which Final decides" is written twice — and the two copies disagreed: with
 * two hand-added "Final" matches in a category, the podium took the earliest
 * and honours took both, so a second player carried a gold the event page did
 * not give them. This runs the real query against a real database. */

vi.mock("server-only", () => ({}));

const dir = path.join(os.tmpdir(), `rise-honours-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let honoursFor: typeof import("./honours").honoursFor;

const owner = randomUUID();

/** A category with one person on each of four teams; returns the person ids. */
async function category(slug: string) {
  const tournamentId = randomUUID();
  await db.insert(schema.tournaments).values({ id: tournamentId, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "live" });
  const divisionId = randomUUID();
  await db.insert(schema.divisions).values({ id: divisionId, tournamentId, name: "Main" });
  const teams: string[] = [];
  const people: string[] = [];
  for (let i = 0; i < 4; i++) {
    const teamId = randomUUID();
    const personId = randomUUID();
    teams.push(teamId);
    people.push(personId);
    await db.insert(schema.teams).values({ id: teamId, tournamentId, divisionId, name: `${slug}-${i}`, seed: i + 1 });
    await db.insert(schema.people).values({ id: personId, name: `${slug}-p${i}` });
    await db.insert(schema.players).values({ id: randomUUID(), tournamentId, teamId, personId, name: `${slug}-p${i}` });
  }
  const final = async (a: number, b: number, opts: { bracket?: string; createdAt: Date }) =>
    db.insert(schema.matches).values({
      id: randomUUID(), tournamentId, divisionId, round: "Final", bracket: opts.bracket ?? null,
      teamAId: teams[a], teamBId: teams[b], typedScoreA: 11, typedScoreB: 4, createdAt: opts.createdAt,
      log: [], lineupA: [], lineupB: [], ackedGates: [],
    });
  return { people, final };
}

const golds = async (personId: string) => (await honoursFor(personId)).filter((h) => h.placing === "gold").length;

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  ({ honoursFor } = await import("./honours"));
  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrations, f), "utf8").split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }
  await db.insert(schema.users).values({ id: owner, email: "h@e.st", name: "Organiser" });
}, 120_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("which Final gives a gold on a profile", () => {
  it("the earliest of two hand-added Finals only — as the event page decides", async () => {
    const c = await category("two-hand-finals");
    await c.final(0, 1, { createdAt: new Date("2026-09-20T10:00:00Z") });
    await c.final(2, 3, { createdAt: new Date("2026-09-20T12:00:00Z") });
    expect(await golds(c.people[0])).toBe(1);
    /* The later Final's winner is not the champion the podium names. */
    expect(await golds(c.people[2])).toBe(0);
  });

  it("the drawn Final, never a hand-added one beside it", async () => {
    const c = await category("drawn-and-hand");
    await c.final(2, 3, { createdAt: new Date("2026-09-20T09:00:00Z") }); // hand-added, earlier
    await c.final(0, 1, { bracket: "main", createdAt: new Date("2026-09-20T11:00:00Z") });
    expect(await golds(c.people[0])).toBe(1);
    expect(await golds(c.people[2])).toBe(0);
  });
});
