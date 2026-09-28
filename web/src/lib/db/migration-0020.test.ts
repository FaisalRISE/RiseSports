import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";

/* 0020 on a database that already holds a knockout — the upgrade, not the fresh
 * install (see migration-0005.test.ts for why both are needed).
 *
 * 0020 adds `matches.bracket` and a unique (category, round) index over drawn
 * bracket rows. Before it, the knockout redraw left DUPLICATE labels behind:
 * a played "Final" plus an unplayed second one, a second "Semi-Final 1". The
 * index would refuse to build over those, so 0020 first tags one row per label
 * as the main bracket — the played one — and deletes the unplayed extras. This
 * builds that mess at 0019 and applies 0020 to it. */

const DIR = path.resolve(process.cwd(), "drizzle");
const migrations = () => fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

async function applyFile(client: PGlite, file: string) {
  const sql = fs.readFileSync(path.join(DIR, file), "utf8");
  for (const stmt of sql.split("--> statement-breakpoint")) {
    const trimmed = stmt.trim();
    if (trimmed) await client.exec(trimmed);
  }
}

const rows = async <T>(c: PGlite, q: string): Promise<T[]> => (await c.query<T>(q)).rows;
const THE_0020 = () => migrations().find((f) => f.startsWith("0020"))!;

let client: PGlite;

beforeAll(async () => {
  client = new PGlite();
  for (const f of migrations()) {
    if (f.startsWith("0020")) break;
    await applyFile(client, f);
  }

  await client.exec(`
    insert into users (id, email, name) values ('u1', 'a@b.c', 'Organiser');
    insert into tournaments (id, slug, name, owner_id) values ('t1', 'cup', 'Cup', 'u1');
    insert into divisions (id, tournament_id, name) values ('d1', 't1', 'Main');
    insert into groups (id, tournament_id, division_id, key, name, position)
      values ('g1', 't1', 'd1', 'A', 'Group A', 0);
    insert into teams (id, tournament_id, division_id, name, seed) values
      ('tA', 't1', 'd1', 'A', 1), ('tB', 't1', 'd1', 'B', 2);

    -- Two group fixtures that legitimately share a label.
    insert into matches (id, tournament_id, division_id, group_id, round, team_a_id, team_b_id) values
      ('ga1', 't1', 'd1', 'g1', 'Group A · R1', 'tA', 'tB'),
      ('ga2', 't1', 'd1', 'g1', 'Group A · R1', 'tB', 'tA');

    -- The old redraw bug: a PLAYED final and an unplayed duplicate made later.
    insert into matches (id, tournament_id, division_id, round, slot_a, slot_b, typed_score_a, typed_score_b, created_at) values
      ('f-played', 't1', 'd1', 'Final', 'W:Semi-Final 1', 'W:Semi-Final 2', 11, 7, now() - interval '1 hour');
    insert into matches (id, tournament_id, division_id, round, slot_a, slot_b) values
      ('f-extra', 't1', 'd1', 'Final', 'W:Semi-Final 1', 'W:Semi-Final 2');

    -- Two unplayed copies of one semi-final.
    insert into matches (id, tournament_id, division_id, round, slot_a, slot_b, created_at) values
      ('sf-old', 't1', 'd1', 'Semi-Final 1', 'A1', 'B2', now() - interval '1 hour'),
      ('sf-new', 't1', 'd1', 'Semi-Final 1', 'A1', 'B2', now());

    -- Two matches an organiser added by hand, sharing a free-text label.
    insert into matches (id, tournament_id, division_id, round, team_a_id, team_b_id) values
      ('hand1', 't1', 'd1', 'Round 1', 'tA', 'tB'),
      ('hand2', 't1', 'd1', 'Round 1', 'tB', 'tA');

    -- A second category: the drawn Final (seed slots), and a NEWER match the
    -- organiser added by hand and also called "Final". Neither is played.
    insert into divisions (id, tournament_id, name) values ('d2', 't1', 'Mixed');
    insert into teams (id, tournament_id, division_id, name, seed) values
      ('tC', 't1', 'd2', 'C', 1), ('tD', 't1', 'd2', 'D', 2);
    insert into matches (id, tournament_id, division_id, round, slot_a, slot_b, created_at) values
      ('d2-drawn', 't1', 'd2', 'Final', 'W:Semi-Final 1', 'W:Semi-Final 2', now() - interval '1 hour');
    insert into matches (id, tournament_id, division_id, round, team_a_id, team_b_id) values
      ('d2-hand', 't1', 'd2', 'Final', 'tC', 'tD');
  `);

  await applyFile(client, THE_0020());
  /* Twenty migrations on a fresh PGlite: well inside a quiet run, past the
     default ten seconds when the whole suite shares the machine. */
}, 120_000);

const bracketOf = async (id: string) =>
  (await rows<{ bracket: string | null }>(client, `select bracket from matches where id = '${id}'`))[0]?.bracket;
const exists = async (id: string) =>
  (await rows(client, `select 1 from matches where id = '${id}'`)).length === 1;

describe("0020 on a database with a knockout in it", () => {
  it("keeps the PLAYED final as the bracket's final and removes the unplayed copy", async () => {
    expect(await bracketOf("f-played")).toBe("main");
    expect(await exists("f-extra")).toBe(false);
  });

  it("keeps one of two unplayed semi-final copies", async () => {
    const left = await rows<{ id: string; bracket: string | null }>(
      client, `select id, bracket from matches where round = 'Semi-Final 1'`);
    expect(left).toHaveLength(1);
    expect(left[0].bracket).toBe("main");
  });

  /* Newest-wins alone would have made the hand-typed "Final" the bracket's
     final and DELETED the drawn one, leaving the semi-finals feeding nothing. */
  it("prefers the drawn final over a newer hand-added one, and deletes neither", async () => {
    expect(await bracketOf("d2-drawn")).toBe("main");
    expect(await bracketOf("d2-hand")).toBeNull();
    expect(await exists("d2-hand")).toBe(true);
  });

  it("leaves group fixtures and hand-added matches outside every bracket", async () => {
    expect(await bracketOf("ga1")).toBeNull();
    expect(await bracketOf("ga2")).toBeNull();
    expect(await bracketOf("hand1")).toBeNull();
    expect(await bracketOf("hand2")).toBeNull();
  });

  it("changes nothing when the backfill runs again", async () => {
    const before = await rows(client, `select id, bracket from matches order by id`);
    const file = fs.readFileSync(path.join(DIR, THE_0020()), "utf8");
    /* The two backfill statements: the WITH … UPDATE and the DELETE. */
    const backfill = file.split("--> statement-breakpoint").map((s) => s.trim())
      .filter((s) => /^(-- [\s\S]*?\n)*WITH candidates|^(-- [\s\S]*?\n)*DELETE FROM matches/.test(s));
    expect(backfill).toHaveLength(2);
    for (const stmt of backfill) await client.exec(stmt);
    expect(await rows(client, `select id, bracket from matches order by id`)).toEqual(before);
  });

  it("then refuses a second row with a bracket label, and a group row in a bracket", async () => {
    const insert = (sql: string) => client.exec(sql).then(() => "ok", () => "refused");
    expect(await insert(`insert into matches (id, tournament_id, division_id, round, bracket)
      values ('dup', 't1', 'd1', 'Final', 'main')`)).toBe("refused");
    expect(await insert(`insert into matches (id, tournament_id, division_id, group_id, round, bracket)
      values ('grp', 't1', 'd1', 'g1', 'Group A · R9', 'main')`)).toBe("refused");
    /* The two refusals are about THIS rule, not something else: the same rows
       go in fine without a bracket. */
    expect(await insert(`insert into matches (id, tournament_id, division_id, round)
      values ('dup2', 't1', 'd1', 'Final')`)).toBe("ok");
    expect(await insert(`insert into matches (id, tournament_id, division_id, group_id, round)
      values ('grp2', 't1', 'd1', 'g1', 'Group A · R9')`)).toBe("ok");
  });
});
