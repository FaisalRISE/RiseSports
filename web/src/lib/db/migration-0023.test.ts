import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/* 0023 on a database that already holds drawn groups — the upgrade, not the
 * fresh install.
 *
 * 0023 records which group a TEAM is in (`teams.group_id`), beside the fixture's
 * own `matches.group_id`. Groups drawn before it have no membership recorded,
 * so it reads membership off their fixtures: a team in the fixtures of exactly
 * one group, of its own category, is a member of it. Anything less certain is
 * left without one rather than guessed — the table then still shows the team
 * from its fixtures (lib/tournamentState `groupMembers`), exactly as before.
 * This builds groups at 0022 and applies 0023 to them, twice. */

const DIR = path.resolve(process.cwd(), "drizzle");
const migrations = () => fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

async function applyFile(client: PGlite, file: string) {
  const sql = fs.readFileSync(path.join(DIR, file), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await client.exec(trimmed);
  }
}

const THE_0023 = () => migrations().find((f) => f.startsWith("0023"))!;
const groupOf = async (c: PGlite) =>
  Object.fromEntries((await c.query<{ id: string; group_id: string | null }>(`select id, group_id from teams order by id`)).rows
    .map((r) => [r.id, r.group_id]));

let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  for (const f of migrations()) {
    if (f.startsWith("0023")) break;
    await applyFile(client, f);
  }

  await client.exec(`
    insert into users (id, email, name) values ('u1', 'a@b.c', 'Organiser');
    insert into tournaments (id, slug, name, owner_id) values ('t1', 'cup', 'Cup', 'u1');
    insert into divisions (id, tournament_id, name) values ('d1', 't1', 'Main'), ('d2', 't1', 'Mixed');
    insert into groups (id, tournament_id, division_id, key, name, position) values
      ('gA', 't1', 'd1', 'A', 'Group A', 0),
      ('gB', 't1', 'd1', 'B', 'Group B', 1),
      ('gM', 't1', 'd2', 'A', 'Group A', 0);
    insert into teams (id, tournament_id, division_id, name, seed) values
      ('a1', 't1', 'd1', 'A1', 1), ('a2', 't1', 'd1', 'A2', 2),
      ('b1', 't1', 'd1', 'B1', 3), ('b2', 't1', 'd1', 'B2', 4),
      ('both', 't1', 'd1', 'In two', 5),
      ('none', 't1', 'd1', 'Undrawn', 6),
      ('m1', 't1', 'd2', 'M1', 1), ('m2', 't1', 'd2', 'M2', 2),
      ('stray', 't1', 'd2', 'Other category', 3);

    insert into matches (id, tournament_id, division_id, group_id, round, team_a_id, team_b_id) values
      ('fa', 't1', 'd1', 'gA', 'Group A · R1', 'a1', 'a2'),
      ('fb', 't1', 'd1', 'gB', 'Group B · R1', 'b1', 'b2'),
      -- In the fixtures of two groups: no app path does this, older data might.
      ('f2a', 't1', 'd1', 'gA', 'Group A · R2', 'both', 'a1'),
      ('f2b', 't1', 'd1', 'gB', 'Group B · R2', 'both', 'b1'),
      ('fm', 't1', 'd2', 'gM', 'Group A · R1', 'm1', 'm2'),
      -- A team of Mixed in a Main group's fixture (0005 filed teams and groups apart).
      ('fx', 't1', 'd1', 'gA', 'Group A · R3', 'stray', 'a2');
    -- A knockout row names teams with no group: not a membership.
    insert into matches (id, tournament_id, division_id, round, team_a_id, team_b_id) values
      ('ko', 't1', 'd1', 'Final', 'a1', 'none');
  `);

  await applyFile(client, THE_0023());
}, 120_000);

describe("0023 on groups drawn before it", () => {
  it("makes a team a member of the one group its fixtures are in", async () => {
    const g = await groupOf(client);
    expect([g.a1, g.a2, g.b1, g.b2, g.m1, g.m2]).toEqual(["gA", "gA", "gB", "gB", "gM", "gM"]);
  });

  it("leaves a team in no group's fixtures, in two groups', or in another category's, without one", async () => {
    const g = await groupOf(client);
    expect(g.none).toBeNull();
    expect(g.both).toBeNull();
    expect(g.stray).toBeNull();
  });

  it("starts every team not withdrawn", async () => {
    const r = await client.query(`select count(*)::int as n from teams where withdrawn_at is not null`);
    expect((r.rows[0] as { n: number }).n).toBe(0);
  });

  it("changes nothing when its backfill runs again — it can be re-run after the deploy", async () => {
    const before = await groupOf(client);
    const sql = fs.readFileSync(path.join(DIR, THE_0023()), "utf8");
    const backfill = sql.split("--> statement-breakpoint").map((s) => s.trim()).find((s) => s.includes("UPDATE \"teams\""))!;
    await client.exec(backfill);
    expect(await groupOf(client)).toEqual(before);
    /* …and a team drawn since, by code that never wrote membership, is filled. */
    await client.exec(`
      insert into groups (id, tournament_id, division_id, key, name, position) values ('gC', 't1', 'd1', 'C', 'Group C', 2);
      insert into teams (id, tournament_id, division_id, name, seed) values ('c1', 't1', 'd1', 'C1', 7), ('c2', 't1', 'd1', 'C2', 8);
      insert into matches (id, tournament_id, division_id, group_id, round, team_a_id, team_b_id) values
        ('fc', 't1', 'd1', 'gC', 'Group C · R1', 'c1', 'c2');
    `);
    await client.exec(backfill);
    const after = await groupOf(client);
    expect([after.c1, after.c2]).toEqual(["gC", "gC"]);
    expect({ ...after, c1: undefined, c2: undefined }).toEqual({ ...before, c1: undefined, c2: undefined });
  });

  it("empties a team's group when the group is deleted, and keeps the team", async () => {
    await client.exec(`delete from matches where group_id = 'gB'; delete from groups where id = 'gB';`);
    const g = await groupOf(client);
    expect([g.b1, g.b2]).toEqual([null, null]);
    expect(g.a1).toBe("gA");
  });
});

/* The after-deploy script (scripts/0023-after-deploy.sql): 0023 goes in before
   the push, so for a few minutes the OLD code serves on the new columns. */
describe("the after-deploy script, for what the old code did in the deploy window", () => {
  const SCRIPT = path.resolve(process.cwd(), "scripts/0023-after-deploy.sql");
  const run = async () => {
    for (const stmt of fs.readFileSync(SCRIPT, "utf8").split(/;\s*$/m).map((s) => s.trim()).filter((s) => /\S/.test(s.replace(/^--.*$/gm, "")))) {
      await client.exec(stmt);
    }
  };

  it("fills a group the old code drew, and takes membership off a pair it left with no fixture", async () => {
    await client.exec(`
      insert into groups (id, tournament_id, division_id, key, name, position) values ('gW', 't1', 'd1', 'W', 'Group W', 3);
      insert into teams (id, tournament_id, division_id, name, seed) values
        ('w1', 't1', 'd1', 'W1', 9), ('w2', 't1', 'd1', 'W2', 10), ('w3', 't1', 'd1', 'W3', 11);
      -- Drawn by the OLD code after 0023: fixtures, no membership.
      insert into matches (id, tournament_id, division_id, group_id, round, team_a_id, team_b_id) values
        ('w12', 't1', 'd1', 'gW', 'Group W · R1', 'w1', 'w2'),
        ('w13', 't1', 'd1', 'gW', 'Group W · R2', 'w1', 'w3'),
        ('w23', 't1', 'd1', 'gW', 'Group W · R3', 'w2', 'w3');
    `);
    await run();
    let g = await groupOf(client);
    expect([g.w1, g.w2, g.w3]).toEqual(["gW", "gW", "gW"]);
    /* Then the old "Delete match" takes both of W3's fixtures. */
    await client.exec(`delete from matches where id in ('w13', 'w23');`);
    await run();
    g = await groupOf(client);
    expect([g.w1, g.w2], "the two who still have a match keep their group").toEqual(["gW", "gW"]);
    expect(g.w3, "the pair the old code left with no match is out of the table, as it showed").toBeNull();
    /* Members of other groups who still play in them are untouched. */
    expect(g.a1).toBe("gA");
    const before = await groupOf(client);
    await run();
    expect(await groupOf(client), "running it again changes nothing").toEqual(before);
  });
});
