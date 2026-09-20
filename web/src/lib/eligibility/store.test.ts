import { describe, it, expect, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

/* The red marks on the manage screen, against a real Postgres.
 *
 * What has to hold: changing a category's rules after teams entered FLAGS the
 * ones that no longer fit and removes nobody (Faisal, 2026-09-17); a waiver
 * covers exactly what was waived; players are judged one row at a time, never
 * matched by name; and the number of queries does not grow with the number of
 * teams, because that growth is what wedged the site on 2026-09-15. */

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

const { divisionMisfits } = await import("./store");

const T = "t-rules";
let n = 0;
const uid = (p: string) => `${p}-${++n}`;

async function reset() {
  await testDb.delete(schema.tournaments);
  await testDb.delete(schema.people);
  await testDb.delete(schema.users);
  await testDb.insert(schema.users).values({ id: "owner", email: "o@x.y", name: "Owner" });
  await testDb.insert(schema.tournaments).values({
    id: T, slug: "rules", name: "Rules", ownerId: "owner", sport: "pb", minTeamSize: 2, maxTeamSize: 2,
  });
}

async function category(over: Partial<typeof schema.divisions.$inferInsert> = {}) {
  const id = uid("d");
  await testDb.insert(schema.divisions).values({ id, tournamentId: T, name: over.name ?? id, ...over });
  return id;
}

/* `id` is pinned where a test needs to name the row in a waiver — a waiver is
   keyed on the player row, not on the name (see `waiverLine`). */
type P = { name: string; gender: "M" | "F"; dob?: string | null; personId?: string | null; id?: string };
async function team(divisionId: string, squad: P[], over: Partial<typeof schema.teams.$inferInsert> = {}) {
  const id = uid("team");
  await testDb.insert(schema.teams).values({ id, tournamentId: T, divisionId, name: over.name ?? id, ...over });
  for (const p of squad) {
    await testDb.insert(schema.players).values({
      id: p.id ?? uid("p"), tournamentId: T, teamId: id, name: p.name, gender: p.gender,
      dob: p.dob ?? null, personId: p.personId ?? null,
    });
  }
  return id;
}

beforeEach(reset);

describe("flags, never removals", () => {
  it("says nothing about a category with no rules", async () => {
    const open = await category();
    await team(open, [{ name: "A", gender: "M" }, { name: "B", gender: "M" }]);
    expect(await divisionMisfits(T)).toEqual([]);
  });

  it("flags a team that stops fitting when the rules tighten, and deletes nothing", async () => {
    const wd = await category({ name: "Women's Doubles" });
    const fine = await team(wd, [{ name: "Priya", gender: "F" }, { name: "Ravi", gender: "M" }]);
    expect(await divisionMisfits(T)).toEqual([]);

    await testDb.update(schema.divisions).set({ genderRule: "F" }).where(eq(schema.divisions.id, wd));

    const [m] = await divisionMisfits(T);
    expect(m).toMatchObject({ teamId: fine, reasons: ["Ravi (Women only)"], waived: [] });
    expect(await testDb.select().from(schema.players).where(eq(schema.players.teamId, fine))).toHaveLength(2);
    expect(await testDb.select().from(schema.teams)).toHaveLength(1);
  });

  it("judges each team against its OWN category only", async () => {
    /* One person, two teams: Main has no rules, Women's Doubles does. */
    const personId = uid("person");
    await testDb.insert(schema.people).values({ id: personId, name: "Ravi", gender: "M" });
    const main = await category({ name: "Main" });
    const wd = await category({ name: "WD", genderRule: "F" });
    await team(main, [{ name: "Ravi", gender: "M", personId }, { name: "Dev", gender: "M" }]);
    const wdTeam = await team(wd, [{ name: "Ravi", gender: "M", personId }, { name: "Asha", gender: "F" }]);

    const flagged = await divisionMisfits(T);
    expect(flagged.map((m) => m.teamId)).toEqual([wdTeam]);
    expect(flagged[0].reasons).toEqual(["Ravi (Women only)"]);
  });

  it("judges two players with the same name one row at a time", async () => {
    const vets = await category({ ageMin: 35, ageOn: "2026-10-12" });
    const t = await team(vets, [
      { name: "Rahul", gender: "M", dob: "1980-01-01" },
      { name: "Rahul", gender: "M", dob: "2000-01-01" },
    ]);
    const [m] = await divisionMisfits(T);
    expect(m.teamId).toBe(t);
    /* Exactly one Rahul is too young — matching by name would get this wrong. */
    expect(m.reasons).toEqual(["Rahul (Age 35+ only (on 12 Oct 2026))"]);
  });

  it("does not call a half-built Mixed team wrong", async () => {
    const mx = await category({ genderRule: "MX" });
    await team(mx, [{ name: "Solo", gender: "M" }]);
    expect(await divisionMisfits(T)).toEqual([]);
  });

  it("shows an unrated player under a cap as a note, not a red mark", async () => {
    const cap = await category({ ratingMax: 1049 });
    await team(cap, [{ name: "Kabir", gender: "M" }, { name: "Rohan", gender: "M" }]);
    const [m] = await divisionMisfits(T);
    expect(m.reasons).toEqual([]);
    expect(m.notes).toEqual(["Kabir: Unrated: check this player's level", "Rohan: Unrated: check this player's level"]);
  });
});

describe("letting a player in anyway", () => {
  it("hides only the reasons the organiser waived", async () => {
    const vets = await category({ genderRule: "M", ageMin: 35, ageOn: "2026-10-12" });
    const t = await team(
      vets,
      [{ id: "p-imran", name: "Imran", gender: "M", dob: "1995-01-01" }, { name: "Sanjay", gender: "M", dob: "1980-01-01" }],
      { rulesWaived: "age:min:35\tp-imran" },
    );
    let [m] = await divisionMisfits(T);
    expect(m).toMatchObject({ teamId: t, reasons: [], waived: ["Imran (Age 35+ only (on 12 Oct 2026))"] });

    /* The rule then tightens. That is a NEW reason, and it still shows red. */
    await testDb.update(schema.divisions).set({ ageMin: 50 }).where(eq(schema.divisions.id, vets));
    [m] = await divisionMisfits(T);
    expect(m.reasons).toEqual([
      "Imran (Age 50+ only (on 12 Oct 2026))",
      "Sanjay (Age 50+ only (on 12 Oct 2026))",
    ]);
  });

  it("waives the player it was given for, not everyone sharing their name", async () => {
    const vets = await category({ genderRule: "M", ageMin: 35, ageOn: "2026-10-12" });
    await team(
      vets,
      [
        { id: "p-young", name: "Rahul", gender: "M", dob: "2000-01-01" },
        { id: "p-other", name: "Rahul", gender: "M", dob: "2001-01-01" },
      ],
      { rulesWaived: "age:min:35\tp-young" },
    );
    const [m] = await divisionMisfits(T);
    expect(m.waived).toEqual(["Rahul (Age 35+ only (on 12 Oct 2026))"]);
    expect(m.reasons).toEqual(["Rahul (Age 35+ only (on 12 Oct 2026))"]);
  });

  it("stays waived once the unrated player HAS a rating", async () => {
    /* The reason the organiser was shown said "(unrated)"; the moment a rating
       exists the same broken rule reads differently. Keyed on the sentence, the
       waiver stopped matching and the card went red with nobody having changed
       anything — including as soon as the player had played one match. */
    const top = await category({ name: "Advanced", ratingMin: 1200 });
    await testDb.insert(schema.people).values({
      id: "person-ravi", name: "Ravi", gender: "M", phone: "9800000001",
      riseRatings: {}, matchCount: {}, seedSource: "default",
    });
    await team(
      top,
      [
        { id: "p-ravi", name: "Ravi", gender: "M", personId: "person-ravi" },
        { id: "p-arjun", name: "Arjun", gender: "M", personId: null },
      ],
      { rulesWaived: "rating:min:1200\tp-ravi\nrating:min:1200\tp-arjun" },
    );
    let [m] = await divisionMisfits(T);
    expect(m.reasons).toEqual([]);
    expect(m.waived).toEqual(["Ravi (Rating 1200+ only (unrated))", "Arjun (Rating 1200+ only (unrated))"]);

    /* Ravi now has a number of his own, and it is below the bar. Same rule,
       same player, same decision — so still "let in by organiser". */
    await testDb.update(schema.people)
      .set({ riseRatings: { "pb:md": 850 }, matchCount: { "pb:md": 3 } })
      .where(eq(schema.people.id, "person-ravi"));
    [m] = await divisionMisfits(T);
    expect(m.reasons).toEqual([]);
    expect(m.waived).toEqual(["Ravi (Rating 1200+ only)", "Arjun (Rating 1200+ only (unrated))"]);
  });
});

describe("the query count does not grow with the teams", () => {
  async function metered() {
    let total = 0;
    const original = client.query.bind(client);
    const spy = vi.spyOn(client, "query").mockImplementation(((...args: Parameters<typeof client.query>) => {
      total++;
      return original(...args);
    }) as typeof client.query);
    try {
      await divisionMisfits(T);
    } finally {
      spy.mockRestore();
    }
    return total;
  }

  it("asks the same number of times for 2 teams as for 10", async () => {
    const wd = await category({ genderRule: "F" });
    for (let i = 0; i < 2; i++) await team(wd, [{ name: `M${i}`, gender: "M" }, { name: `F${i}`, gender: "F" }]);
    const few = await metered();

    for (let i = 2; i < 10; i++) await team(wd, [{ name: `M${i}`, gender: "M" }, { name: `F${i}`, gender: "F" }]);
    const many = await metered();

    expect(many, `2 teams: ${few} queries, 10 teams: ${many}`).toBe(few);
  });
});
