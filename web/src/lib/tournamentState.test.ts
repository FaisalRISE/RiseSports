import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* Seed references must resolve inside their OWN category.
 *
 * `refResolver` keys two lookups on strings that are unique in a single-category
 * event and stop being unique the moment there is a second: every category has
 * a Group A, and every category has a Semi-Final 1. Before this test, both Maps
 * were built from the whole tournament, so the later row silently won and "A1"
 * in Men's Doubles resolved to the MIXED group winner. No error, no warning —
 * the wrong pair would simply be called onto court for a final.
 *
 * This drives the real path: rows go into a real Postgres, come back out
 * through the real `loadTournament`, and the real resolver is asked. Nothing is
 * hand-fed, because a hand-fed fixture is how a dead feature stays green. */

const dir = path.join(os.tmpdir(), `rise-divisions-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

/* `lib/db` reads DATABASE_URL when it first loads, so it must be set first. */
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let state: typeof import("./tournamentState");

const ids = {
  owner: randomUUID(),
  tournament: randomUUID(),
  md: randomUUID(),
  mx: randomUUID(),
  mdWinner: randomUUID(),
  mdLoser: randomUUID(),
  mxWinner: randomUUID(),
  mxLoser: randomUUID(),
};

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  state = await import("./tournamentState");

  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migrations, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }

  const { users, tournaments, divisions, groups, teams, matches } = schema;

  await db.insert(users).values({ id: ids.owner, email: "d@e.st", name: "Organiser" });
  await db.insert(tournaments).values({
    id: ids.tournament, slug: "two-cats", name: "Two Categories",
    sport: "pb", format: "standard", ownerId: ids.owner, status: "live",
  });

  /* One event, two categories — the situation the whole change exists for. */
  await db.insert(divisions).values([
    { id: ids.md, tournamentId: ids.tournament, name: "Men's Doubles", position: 0 },
    { id: ids.mx, tournamentId: ids.tournament, name: "Mixed Doubles", position: 1 },
  ]);

  await db.insert(teams).values([
    { id: ids.mdWinner, tournamentId: ids.tournament, divisionId: ids.md, name: "MD Winner", seed: 1 },
    { id: ids.mdLoser, tournamentId: ids.tournament, divisionId: ids.md, name: "MD Loser", seed: 2 },
    { id: ids.mxWinner, tournamentId: ids.tournament, divisionId: ids.mx, name: "MX Winner", seed: 1 },
    { id: ids.mxLoser, tournamentId: ids.tournament, divisionId: ids.mx, name: "MX Loser", seed: 2 },
  ]);

  /* BOTH categories get a Group A. That is legal now, and is the collision. */
  const mdGroup = randomUUID();
  const mxGroup = randomUUID();
  await db.insert(groups).values([
    { id: mdGroup, tournamentId: ids.tournament, divisionId: ids.md, key: "A", name: "Group A" },
    { id: mxGroup, tournamentId: ids.tournament, divisionId: ids.mx, key: "A", name: "Group A" },
  ]);

  /* A finished match, scored by typed result so the group reads as complete. */
  const settled = (
    divisionId: string,
    round: string,
    winner: string,
    loser: string,
    groupId: string | null,
  ) => ({
    id: randomUUID(),
    tournamentId: ids.tournament,
    divisionId,
    groupId,
    /* A knockout row is part of the drawn bracket; only those answer to W:/L:. */
    bracket: groupId ? null : "main",
    round,
    teamAId: winner,
    teamBId: loser,
    log: [],
    lineupA: [],
    lineupB: [],
    ackedGates: [],
    typedScoreA: 11,
    typedScoreB: 3,
  });

  await db.insert(matches).values([
    settled(ids.md, "Group A · R1", ids.mdWinner, ids.mdLoser, mdGroup),
    settled(ids.mx, "Group A · R1", ids.mxWinner, ids.mxLoser, mxGroup),
    /* And BOTH categories get a Semi-Final 1 — the second collision. */
    settled(ids.md, "Semi-Final 1", ids.mdWinner, ids.mdLoser, null),
    settled(ids.mx, "Semi-Final 1", ids.mxWinner, ids.mxLoser, null),
    /* A match an organiser ADDED BY HAND and typed "Semi-Final 1", inserted after
       the drawn one, with the result the other way round. It must not take
       over W:Semi-Final 1 — the old Map kept whichever row came last. */
    { ...settled(ids.md, "Semi-Final 1", ids.mdLoser, ids.mdWinner, null), bracket: null },
  ]);
/* 120 seconds, like every other database test. Under the full parallel run
   setting up every migration took longer than 60 here once, and the whole file
   failed to load with its tests skipped — the one unexplained failure seen in
   step 7. */
}, 120_000);

/* Every run made a fresh database in the temp folder and never removed it:
   150-odd copies had piled up. */
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("seed references stay inside their own category", () => {
  const load = async () => {
    const loaded = await state.loadTournament("two-cats");
    if (!loaded) throw new Error("tournament did not load");
    return { loaded, tables: state.groupTables(loaded) };
  };

  it("sets the stage: two categories, each with a Group A", async () => {
    const { tables } = await load();
    expect(tables).toHaveLength(2);
    expect(tables.every((t) => t.group.key === "A")).toBe(true);
    expect(new Set(tables.map((t) => t.group.divisionId)).size).toBe(2);
    expect(tables.every((t) => t.complete)).toBe(true);
  });

  /* The headline. With one shared resolver, one of these two must fail. */
  it("resolves A1 to each category's OWN group winner", async () => {
    const { loaded, tables } = await load();
    const resolverFor = state.resolverFactory(loaded, tables);

    expect(resolverFor(ids.md).groupPlacing("A", 1)).toBe(ids.mdWinner);
    expect(resolverFor(ids.mx).groupPlacing("A", 1)).toBe(ids.mxWinner);
    expect(ids.mdWinner).not.toBe(ids.mxWinner);
  });

  it("resolves A2 the same way, not just the winner", async () => {
    const { loaded, tables } = await load();
    const resolverFor = state.resolverFactory(loaded, tables);

    expect(resolverFor(ids.md).groupPlacing("A", 2)).toBe(ids.mdLoser);
    expect(resolverFor(ids.mx).groupPlacing("A", 2)).toBe(ids.mxLoser);
  });

  /* The second Map: both categories have a match called "Semi-Final 1". */
  it("resolves W: and L: to each category's own tie", async () => {
    const { loaded, tables } = await load();
    const resolverFor = state.resolverFactory(loaded, tables);

    expect(resolverFor(ids.md).tieWinner("Semi-Final 1")).toBe(ids.mdWinner);
    expect(resolverFor(ids.mx).tieWinner("Semi-Final 1")).toBe(ids.mxWinner);

    expect(resolverFor(ids.md).tieLoser("Semi-Final 1")).toBe(ids.mdLoser);
    expect(resolverFor(ids.mx).tieLoser("Semi-Final 1")).toBe(ids.mxLoser);
  });

  it("answers W: from the DRAWN bracket, never from a hand-added match of the same name", async () => {
    const { loaded, tables } = await load();
    const resolverFor = state.resolverFactory(loaded, tables);
    /* The hand-added row says the loser won; the drawn one says the winner did. */
    expect(resolverFor(ids.md).tieWinner("Semi-Final 1")).toBe(ids.mdWinner);
  });

  /* The other half of the rule. Deleting a drawn semi-final and adding it back by
     hand is today the only way to change who plays it — and with no fallback
     the Final waited on the deleted row for ever, and the scheduler let the
     Final be timed alongside the semi that feeds it. */
  it("answers W: from a hand-added match when the category has no drawn one", async () => {
    const { divisions, teams, matches } = schema;
    const div = randomUUID(), x = randomUUID(), y = randomUUID(), semi = randomUUID(), final = randomUUID();
    await db.insert(divisions).values({ id: div, tournamentId: ids.tournament, name: "Rebuilt", position: 2 });
    await db.insert(teams).values([
      { id: x, tournamentId: ids.tournament, divisionId: div, name: "X", seed: 1 },
      { id: y, tournamentId: ids.tournament, divisionId: div, name: "Y", seed: 2 },
    ]);
    await db.insert(matches).values([
      /* The drawn Final still points at the semi by its label… */
      { id: final, tournamentId: ids.tournament, divisionId: div, bracket: "main", round: "Final",
        slotA: "W:Semi-Final 1", slotB: "W:Semi-Final 2", log: [], lineupA: [], lineupB: [], ackedGates: [] },
      /* …which now exists only as a match added by hand, and has been played. */
      { id: semi, tournamentId: ids.tournament, divisionId: div, bracket: null, round: "Semi-Final 1",
        teamAId: x, teamBId: y, typedScoreA: 11, typedScoreB: 6, log: [], lineupA: [], lineupB: [], ackedGates: [] },
    ]);

    const { loaded, tables } = await load();
    expect(state.resolverFactory(loaded, tables)(div).tieWinner("Semi-Final 1")).toBe(x);

    const { loadScheduleMatches } = await import("@/lib/schedule/store");
    const { items } = await loadScheduleMatches(ids.tournament);
    expect(items.find((i) => i.id === final)?.dependsOn).toContain(semi);
  });

  it("knows nothing of a group that belongs to another category only", async () => {
    const { loaded, tables } = await load();
    /* "B" exists in neither, so both must answer null rather than reaching
       sideways for something that looks close enough. */
    expect(state.resolverFactory(loaded, tables)(ids.md).groupPlacing("B", 1)).toBeNull();
  });

  it("hands back the same resolver for a repeated category", async () => {
    const { loaded, tables } = await load();
    const resolverFor = state.resolverFactory(loaded, tables);
    expect(resolverFor(ids.md)).toBe(resolverFor(ids.md));
    expect(resolverFor(ids.md)).not.toBe(resolverFor(ids.mx));
  });
});
