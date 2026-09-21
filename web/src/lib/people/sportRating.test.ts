import { describe, it, expect, beforeAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { asc, desc, eq, isNotNull, sql } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

/* ONE definition of "a person's rating in a sport", in two languages.
 *
 * `sportRating` / `formatRating` (TypeScript) decide what a rating IS: shown on
 * a profile, judged against a category's limit, used to seed a draw. The SQL
 * twins sort and filter the lists. If the two ever disagree, a list puts
 * somebody in an order that the numbers printed beside them contradict — or
 * leaves out somebody whose own profile shows a rating.
 *
 * Each fixture is checked in all three places the SQL is used — the SELECT,
 * the WHERE and the ORDER BY — because drizzle strips table names from column
 * references in a single-table select, which is exactly the trap that once made
 * the players list read 0 for everyone (app/people/page.tsx). */

const client = new PGlite();
const testDb = drizzle(client, { schema });
vi.mock("@/lib/db", () => ({ db: testDb }));
vi.mock("server-only", () => ({}));

const { sportRatingSql, formatRatingSql } = await import("./index");
const { sportRating, formatRating } = await import("@/lib/rating");

type Fixture = { id: string; riseRatings: Record<string, number>; matchCount: Record<string, number>; seedSource: "default" | "dupr" | "organiser" };

const FIXTURES: Fixture[] = [
  /* Played pickleball doubles. */
  { id: "played", riseRatings: { "pb:md": 1100 }, matchCount: { "pb:md": 6 }, seedSource: "default" },
  /* A newcomer on the default seed, never played: unrated everywhere. */
  { id: "newcomer", riseRatings: { "pb:md": 750 }, matchCount: {}, seedSource: "default" },
  /* Placed by an organiser, never played: that IS a level. */
  { id: "placed", riseRatings: { "pb:mx": 1000 }, matchCount: {}, seedSource: "organiser" },
  /* Seeded from a DUPR. */
  { id: "dupr", riseRatings: { "pb:ms": 1125 }, matchCount: {}, seedSource: "dupr" },
  /* Strong at badminton, never played pickleball. */
  { id: "shuttler", riseRatings: { "bd:md": 1500 }, matchCount: { "bd:md": 20 }, seedSource: "default" },
  /* Both sports; pickleball only by default seed, so it does not count. */
  { id: "both", riseRatings: { "pb:md": 750, "bd:ms": 900 }, matchCount: { "bd:ms": 3 }, seedSource: "default" },
  /* Several pickleball formats; the best COUNTING one wins, not the highest. */
  { id: "several", riseRatings: { "pb:md": 980, "pb:ms": 1300, "pb:mx": 870 }, matchCount: { "pb:md": 4, "pb:mx": 2 }, seedSource: "default" },
  /* Nothing at all. */
  { id: "empty", riseRatings: {}, matchCount: {}, seedSource: "default" },
  /* A key the registry does not list still counts by prefix, in both. */
  { id: "oddkey", riseRatings: { "pb:zz": 640 }, matchCount: { "pb:zz": 1 }, seedSource: "default" },
  /* A prefix that is NOT pickleball despite starting with "pb". */
  { id: "lookalike", riseRatings: { "pbx:md": 1400 }, matchCount: { "pbx:md": 9 }, seedSource: "default" },
];

beforeAll(async () => {
  const dir = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt.trim());
    }
  }
  for (const f of FIXTURES) {
    await testDb.insert(schema.people).values({ name: f.id, ...f });
  }
}, 120_000);

const tsSport = (id: string, sport: string) => sportRating(FIXTURES.find((f) => f.id === id)!, sport);
const tsFormat = (id: string, key: string) => formatRating(FIXTURES.find((f) => f.id === id)!, key);
const num = (v: unknown) => (v == null ? null : Number(v));

describe.each(["pb", "bd"])("a rating in %s means the same thing in SQL and in TypeScript", (sport) => {
  it("in the SELECT", async () => {
    const rows = await testDb.select({ id: schema.people.id, r: sportRatingSql(sport) }).from(schema.people);
    for (const row of rows) expect(num(row.r), row.id).toBe(tsSport(row.id, sport));
  });

  it("in the WHERE", async () => {
    const rows = await testDb.select({ id: schema.people.id }).from(schema.people)
      .where(sql`${sportRatingSql(sport)} is not null`);
    const expected = FIXTURES.filter((f) => tsSport(f.id, sport) != null).map((f) => f.id).sort();
    expect(rows.map((r) => r.id).sort()).toEqual(expected);
  });

  it("in the ORDER BY", async () => {
    const rows = await testDb.select({ id: schema.people.id }).from(schema.people)
      .where(sql`${sportRatingSql(sport)} is not null`)
      .orderBy(desc(sportRatingSql(sport)), asc(schema.people.id));
    const expected = FIXTURES
      .filter((f) => tsSport(f.id, sport) != null)
      .sort((a, b) => tsSport(b.id, sport)! - tsSport(a.id, sport)! || a.id.localeCompare(b.id))
      .map((f) => f.id);
    expect(rows.map((r) => r.id)).toEqual(expected);
  });
});

describe("a rating in one format means the same thing in SQL and in TypeScript", () => {
  it.each(["pb:md", "pb:mx", "pb:ms", "bd:md"])("%s, in every position", async (key) => {
    const selected = await testDb.select({ id: schema.people.id, r: formatRatingSql(key) }).from(schema.people);
    for (const row of selected) expect(num(row.r), `${row.id} ${key}`).toBe(tsFormat(row.id, key));

    const kept = await testDb.select({ id: schema.people.id }).from(schema.people)
      .where(isNotNull(formatRatingSql(key)))
      .orderBy(desc(formatRatingSql(key)), asc(schema.people.id));
    const expected = FIXTURES
      .filter((f) => tsFormat(f.id, key) != null)
      .sort((a, b) => tsFormat(b.id, key)! - tsFormat(a.id, key)! || a.id.localeCompare(b.id))
      .map((f) => f.id);
    expect(kept.map((r) => r.id)).toEqual(expected);
  });
});

describe("what the fixtures are there to prove", () => {
  it("counts the right people", () => {
    expect(tsSport("newcomer", "pb")).toBeNull();
    expect(tsSport("placed", "pb")).toBe(1000);
    expect(tsSport("shuttler", "pb")).toBeNull();
    expect(tsSport("shuttler", "bd")).toBe(1500);
    expect(tsSport("both", "pb")).toBeNull();
    /* 1300 is an unplayed default seed; 980 is the best that counts. */
    expect(tsSport("several", "pb")).toBe(980);
    expect(tsSport("lookalike", "pb")).toBeNull();
  });

  it("binds the sport rather than splicing it into the SQL", async () => {
    /* Something shaped like an attack comes back as no rating, not an error. */
    const rows = await testDb.select({ r: sportRatingSql("pb') or ('1'='1") }).from(schema.people)
      .where(eq(schema.people.id, "played"));
    expect(rows[0].r).toBeNull();
  });
});
