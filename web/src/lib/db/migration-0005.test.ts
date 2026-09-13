import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/* The upgrade, not the fresh install.
 *
 * schema.test.ts applies every migration to an EMPTY database, which is a real
 * check and misses this entirely: drizzle-kit generated
 *
 *     ALTER TABLE "teams" ADD COLUMN "division_id" text NOT NULL;
 *
 * for three tables that already hold rows. On an empty database that succeeds.
 * On Faisal's, which has a tournament and a team in it, it fails outright —
 * there is no default and nothing to put in the column. The failure would have
 * arrived in production, on the one database that matters.
 *
 * So this test does what the real upgrade does: build the world as it stood at
 * 0004, put rows in it, and only then apply 0005. */

const DIR = path.resolve(process.cwd(), "drizzle");

const migrations = () =>
  fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

async function apply(client: PGlite, file: string) {
  const sql = fs.readFileSync(path.join(DIR, file), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await client.exec(trimmed);
  }
}

/** The world as it stood before divisions reached the draw. */
async function upTo0004(client: PGlite) {
  for (const f of migrations()) {
    if (f.startsWith("0005")) break;
    await apply(client, f);
  }
}

const rows = async <T>(c: PGlite, q: string): Promise<T[]> =>
  (await c.query<T>(q)).rows;

let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  await upTo0004(client);

  /* A tournament that never heard of categories, with a full draw in it. */
  await client.exec(`
    insert into users (id, email, name) values ('u1', 'a@b.c', 'Organiser');
    insert into tournaments (id, slug, name, owner_id)
      values ('t1', 'club-night', 'Club Night', 'u1');
    insert into teams (id, tournament_id, name, seed) values
      ('tmA', 't1', 'Team A', 1),
      ('tmB', 't1', 'Team B', 2);
    insert into groups (id, tournament_id, key, name, position)
      values ('g1', 't1', 'A', 'Group A', 0);
    insert into matches (id, tournament_id, group_id, round, team_a_id, team_b_id)
      values ('m1', 't1', 'g1', 'Group A · R1', 'tmA', 'tmB');
    insert into matches (id, tournament_id, round, slot_a, slot_b)
      values ('m2', 't1', 'Final', 'A1', 'A2');
  `);

  /* A second tournament whose entrant picked a category on the public page —
     it already has a division, so it must NOT be given a "Main" as well. */
  await client.exec(`
    insert into tournaments (id, slug, name, owner_id)
      values ('t2', 'open', 'The Open', 'u1');
    insert into divisions (id, tournament_id, name, position)
      values ('dMX', 't2', 'Mixed Doubles', 0);
    insert into teams (id, tournament_id, name, seed)
      values ('tmC', 't2', 'Team C', 1);
    insert into registrations
      (id, tournament_id, team_name, contact_name, status, division_id, team_id)
      values ('r1', 't2', 'Team C', 'Chandni', 'approved', 'dMX', 'tmC');
  `);

  await apply(client, "0005_young_machine_man.sql");
}, 60_000);

describe("0005 upgrades a database that already has rows", () => {
  it("applies at all — the generated version could not", async () => {
    const cols = await rows<{ column_name: string; is_nullable: string }>(
      client,
      `select column_name, is_nullable from information_schema.columns
        where table_name = 'teams' and column_name = 'division_id'`,
    );
    expect(cols).toHaveLength(1);
    expect(cols[0].is_nullable).toBe("NO");
  });

  it("gives a tournament with no categories one called Main", async () => {
    const ds = await rows<{ name: string }>(
      client,
      `select name from divisions where tournament_id = 't1'`,
    );
    expect(ds.map((d) => d.name)).toEqual(["Main"]);
  });

  it("does not add Main to a tournament that already had a category", async () => {
    const ds = await rows<{ name: string }>(
      client,
      `select name from divisions where tournament_id = 't2' order by name`,
    );
    expect(ds.map((d) => d.name)).toEqual(["Mixed Doubles"]);
  });

  it("leaves no draw row without a category", async () => {
    for (const table of ["teams", "groups", "matches"]) {
      const orphans = await rows<{ n: number }>(
        client,
        `select count(*)::int as n from "${table}" where division_id is null`,
      );
      expect(orphans[0].n, `${table} has rows with no division`).toBe(0);
    }
  });

  it("puts the existing draw in that tournament's own division", async () => {
    const [main] = await rows<{ id: string }>(
      client,
      `select id from divisions where tournament_id = 't1'`,
    );
    const got = await rows<{ id: string; division_id: string }>(
      client,
      `select id, division_id from matches where tournament_id = 't1' order by id`,
    );
    expect(got.map((r) => r.division_id)).toEqual([main.id, main.id]);
  });

  /* The knockout match has no group, so its division cannot be inferred from
     one. That is exactly why the column lives on the match. */
  it("gives the knockout match a division too, not just the group match", async () => {
    const [ko] = await rows<{ division_id: string | null; group_id: string | null }>(
      client,
      `select division_id, group_id from matches where id = 'm2'`,
    );
    expect(ko.group_id).toBeNull();
    expect(ko.division_id).not.toBeNull();
  });

  it("keeps the category the entrant actually chose", async () => {
    const [team] = await rows<{ division_id: string }>(
      client,
      `select division_id from teams where id = 'tmC'`,
    );
    expect(team.division_id).toBe("dMX");
  });

  /* The point of the whole exercise: Men's Doubles and Mixed each get a Group A. */
  it("lets two categories in one event each have their own Group A", async () => {
    /* '' is SQL's escape for an apostrophe, and is just two characters to JS. */
    await client.exec(`
      insert into divisions (id, tournament_id, name, position)
        values ('dMD', 't1', 'Men''s Doubles', 1);
    `);

    const [main] = await rows<{ id: string }>(
      client,
      `select id from divisions where tournament_id = 't1' and name = 'Main'`,
    );

    await client.exec(
      `insert into groups (id, tournament_id, division_id, key, name, position)
         values ('g2', 't1', 'dMD', 'A', 'Group A', 0)`,
    );

    const keys = await rows<{ key: string; division_id: string }>(
      client,
      `select key, division_id from groups where tournament_id = 't1' order by division_id`,
    );
    expect(keys).toHaveLength(2);
    expect(keys.every((k) => k.key === "A")).toBe(true);
    expect(new Set(keys.map((k) => k.division_id)).size).toBe(2);
    expect(main.id).toBeTruthy();
  });

  /* Without this, every test above passes against a migration that cannot run.
     It is the reason 0005 is hand-edited, and it fails the moment anyone
     regenerates it and commits the naive form. */
  it("proves the generated form WOULD have failed — the reason 0005 is hand-edited", async () => {
    const fresh = new PGlite();
    await upTo0004(fresh);
    await fresh.exec(`
      insert into users (id, email, name) values ('u9', 'x@y.z', 'O');
      insert into tournaments (id, slug, name, owner_id) values ('t9', 's', 'S', 'u9');
      insert into teams (id, tournament_id, name, seed) values ('tm9', 't9', 'T', 1);
    `);

    await expect(
      fresh.exec(`ALTER TABLE "teams" ADD COLUMN "division_id" text NOT NULL;`),
    ).rejects.toThrow();

    /* And that it is the emptiness that saved the other test file, not luck. */
    const empty = new PGlite();
    await upTo0004(empty);
    await expect(
      empty.exec(`ALTER TABLE "teams" ADD COLUMN "division_id" text NOT NULL;`),
    ).resolves.toBeDefined();
  }, 60_000);

  it("still refuses two Group As inside ONE category", async () => {
    await expect(
      client.exec(
        `insert into groups (id, tournament_id, division_id, key, position)
           values ('g3', 't1', 'dMD', 'A', 1)`,
      ),
    ).rejects.toThrow();
  });
});
