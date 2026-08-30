import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

import * as schema from "./schema";
import { seed, buildLog } from "./seed";
import { viewMatch } from "@/lib/matchState";

/* Runs the REAL generated migration and the REAL seed against Postgres — PGlite
 * is Postgres compiled to WASM, so constraints, defaults and foreign keys all
 * behave as they will on Neon. This is what stops `drizzle-kit push` being the
 * first time anyone finds out the schema does not apply. */

let db: ReturnType<typeof drizzle<typeof schema>>;
let seeded: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });

  const dir = path.resolve(process.cwd(), "drizzle");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  expect(files.length, "no generated migration found — run `pnpm db:generate`").toBeGreaterThan(0);

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    // drizzle-kit separates statements with a breakpoint marker
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  seeded = await seed(db as never);
}, 60_000);

describe("the generated migration applies to a real Postgres", () => {
  it("creates every table", async () => {
    const rows = await db.execute(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = (rows.rows as { table_name: string }[]).map((r) => r.table_name);
    expect(names).toEqual([
      "event_roles", "groups", "matches", "players", "scorer_grants", "teams", "tournaments", "users",
    ]);
  });

  it("applies migrations incrementally, not just the first one", async () => {
    /* 0001 added groups and the seed-ref slots. If only 0000 had run, these
       columns would be missing and the query below would throw. */
    const rows = await db.execute(
      `select column_name from information_schema.columns
       where table_name = 'matches' and column_name in ('group_id','slot_a','slot_b')
       order by column_name`,
    );
    expect((rows.rows as { column_name: string }[]).map((r) => r.column_name))
      .toEqual(["group_id", "slot_a", "slot_b"]);
  });

  it("keeps group keys unique within a tournament but not across them", async () => {
    const t2 = await db.insert(schema.tournaments).values({
      id: "other", slug: "other-cup", name: "Other Cup", ownerId: seeded.ownerId,
    }).returning({ id: schema.tournaments.id });

    await db.insert(schema.groups).values({ id: "g1", tournamentId: seeded.oslId, key: "A" });
    // same key, different tournament: allowed
    await db.insert(schema.groups).values({ id: "g2", tournamentId: t2[0].id, key: "A" });
    // same key, same tournament: refused
    await expect(
      db.insert(schema.groups).values({ id: "g3", tournamentId: seeded.oslId, key: "A" }),
    ).rejects.toThrow();

    /* Clean up so later tests see only the seeded tournaments — these run
       against one shared database, so a test that leaves rows behind breaks
       its neighbours. */
    await db.delete(schema.tournaments).where(eq(schema.tournaments.id, t2[0].id));
    await db.delete(schema.groups).where(eq(schema.groups.id, "g1"));
  });

  it("enforces the unique slug", async () => {
    await expect(
      db.insert(schema.tournaments).values({
        id: "dupe", slug: "club-night", name: "Clash", ownerId: seeded.ownerId,
      }),
    ).rejects.toThrow();
  });

  it("cascades a tournament delete to its matches", async () => {
    const before = await db.select().from(schema.matches).where(eq(schema.matches.tournamentId, seeded.clubId));
    expect(before.length).toBeGreaterThan(0);
    await db.delete(schema.tournaments).where(eq(schema.tournaments.id, seeded.clubId));
    const after = await db.select().from(schema.matches).where(eq(schema.matches.tournamentId, seeded.clubId));
    expect(after).toEqual([]);
  });
});

describe("the seed produces states worth testing", () => {
  it("creates both tournaments", async () => {
    const rows = await db.select().from(schema.tournaments);
    expect(rows.map((r) => r.slug).sort()).toEqual(["osl-2026"]); // club-night deleted by the cascade test
  });

  it("OSL matches round-trip through the scoring engine", async () => {
    const t = (await db.select().from(schema.tournaments).where(eq(schema.tournaments.slug, "osl-2026")))[0];
    const ms = await db.select().from(schema.matches).where(eq(schema.matches.tournamentId, t.id));
    const views = ms.map((m) => viewMatch(t, m));

    // one match sits one point short of the Pair B rotation
    const nearGate = views.find((v) => Math.max(v.a, v.b) === 6);
    expect(nearGate?.osl?.pairLabel).toBe("Pair A");
    expect(nearGate?.osl?.pendingGate).toBe(0);

    // one is past 14: ends changed, Pair C on court
    const late = views.find((v) => Math.max(v.a, v.b) === 16);
    expect(late?.osl?.pairLabel).toBe("Pair C");
    expect(late?.osl?.endsChanged).toBe(true);

    // one is on the golden point
    const golden = views.find((v) => v.a === 24 && v.b === 24);
    expect(golden?.golden).toBe(true);
    expect(golden?.over).toBe(false);

    // the final has no teams yet and must not crash the view
    const empty = views.find((v) => v.rallies === 0);
    expect(empty?.over).toBe(false);
  });

  it("every OSL six is a legal line-up under Rules 3.1", async () => {
    const { oslLineupIssues } = await import("@/lib/formats/osl");
    const t = (await db.select().from(schema.tournaments).where(eq(schema.tournaments.slug, "osl-2026")))[0];
    const ps = await db.select().from(schema.players).where(eq(schema.players.tournamentId, t.id));
    const byId = new Map(ps.map((p) => [p.id, p]));
    const ms = await db.select().from(schema.matches).where(eq(schema.matches.tournamentId, t.id));

    for (const m of ms) {
      for (const lineup of [m.lineupA, m.lineupB]) {
        if (lineup.length === 0) continue;
        const six = lineup.map((pid) => {
          const p = byId.get(pid)!;
          return { id: p.id, name: p.name, gender: p.gender };
        });
        expect(oslLineupIssues(six), `${m.round}`).toEqual([]);
      }
    }
  });
});

describe("buildLog", () => {
  it("produces exactly the requested score", () => {
    for (const [a, b] of [[11, 7], [25, 0], [24, 24], [0, 3], [0, 0]]) {
      const log = buildLog(a, b);
      expect(log.filter((x) => x === "a").length).toBe(a);
      expect(log.filter((x) => x === "b").length).toBe(b);
    }
  });
});
