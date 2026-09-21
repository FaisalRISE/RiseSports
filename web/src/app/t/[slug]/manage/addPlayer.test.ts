import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* Which format an organiser-added player's starting rating is filed under,
 * against a real database and through the real `addPlayer`.
 *
 * The bug: the first player added to an empty event is a team of one, so
 * `ratingFormatFor` read the event as SINGLES and their seed went under "pb:ws"
 * while every match of the event moved "pb:mx". The first match hid it — the
 * seed carries across formats of one sport — and what was left behind was a
 * seed nobody had played on, counting in their pickleball rating for ever.
 *
 * Driven through the action rather than the helpers, for the reason recorded in
 * lib/rating/pipeline.test.ts: the format decision and the seed write live in
 * different files, and only the path through both proves anything. */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));

const dir = path.join(os.tmpdir(), `rise-addplayer-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let actions: typeof import("./actions");
let apply: typeof import("@/lib/rating/apply");
let rating: typeof import("@/lib/rating");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;

const owner = randomUUID();
let phoneSeq = 0;
const nextPhone = () => `98765${String(++phoneSeq).padStart(5, "0")}`;

/** An event with one category and the given teams. */
async function event(slug: string, sizes: { min: number; max: number }, teamNames: string[]) {
  const id = randomUUID();
  await db.insert(schema.tournaments).values({
    id, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "draft",
    minTeamSize: sizes.min, maxTeamSize: sizes.max,
  });
  const divisionId = randomUUID();
  await db.insert(schema.divisions).values({ id: divisionId, tournamentId: id, name: "Main" });
  const teamIds = teamNames.map(() => randomUUID());
  await db.insert(schema.teams).values(
    teamNames.map((name, i) => ({ id: teamIds[i], tournamentId: id, divisionId, name, seed: i + 1 })),
  );
  return { id, divisionId, teamIds };
}

/** The organiser's add-player form, as the browser posts it. */
async function add(tournamentId: string, teamId: string, p: { name: string; gender: "M" | "F"; band?: number; personId?: string }) {
  const form = new FormData();
  form.set("name", p.name);
  form.set("gender", p.gender);
  if (p.personId) form.set("personId", p.personId);
  else form.set("phone", nextPhone());
  if (p.band) form.set("band", String(p.band));
  const res = await actions.addPlayer(tournamentId, teamId, form);
  expect(res.ok).toBe(true);
  const [row] = await db.select().from(schema.players)
    .where(eq(schema.players.name, p.name));
  return row;
}

const personOf = async (personId: string | null) =>
  (await db.select().from(schema.people).where(eq(schema.people.id, personId!)))[0];
const rowOf = async (playerId: string) =>
  (await db.select().from(schema.players).where(eq(schema.players.id, playerId)))[0];

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  actions = await import("./actions");
  apply = await import("@/lib/rating/apply");
  rating = await import("@/lib/rating");
  ({ eq } = await import("drizzle-orm"));

  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migrations, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }
  await db.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });
}, 120_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("an event whose team size says doubles", () => {
  it("files the FIRST player's seed under a doubles key, not singles", async () => {
    const t = await event("doubles-cup", { min: 2, max: 2 }, ["Falcons", "Owls"]);
    const anya = await add(t.id, t.teamIds[0], { name: "Anya D", gender: "F", band: 1000 });

    const person = await personOf(anya.personId);
    expect(person.riseRatings).toEqual({ "pb:wd": 1000 });
    expect(anya.ratings).toEqual({ "pb:wd": 1000 });
  });

  /* Team size said doubles; only the partner can say MIXED. */
  it("moves it again when her partner makes the event mixed", async () => {
    const [t] = await db.select().from(schema.tournaments).where(eq(schema.tournaments.slug, "doubles-cup"));
    const teamId = (await db.select().from(schema.teams).where(eq(schema.teams.tournamentId, t.id)))
      .find((x) => x.name === "Falcons")!.id;
    const bo = await add(t.id, teamId, { name: "Bo D", gender: "M", band: 700 });

    const [anya] = await db.select().from(schema.players).where(eq(schema.players.name, "Anya D"));
    expect((await personOf(anya.personId)).riseRatings).toEqual({ "pb:mx": 1000 });
    expect(anya.ratings).toEqual({ "pb:mx": 1000 });
    expect((await personOf(bo.personId)).riseRatings).toEqual({ "pb:mx": 700 });
  });
});

/* How every event starts: the wizard never asks, so teams are "one or two" and
   the first player really is indistinguishable from a singles entrant. */
describe("an event that allows teams of one or two", () => {
  it("files the first player on the roster's best guess, then follows the roster", async () => {
    const t = await event("either-cup", { min: 1, max: 2 }, ["Kites", "Wrens"]);
    const cy = await add(t.id, t.teamIds[0], { name: "Cy E", gender: "F", band: 1000 });
    expect((await personOf(cy.personId)).riseRatings).toEqual({ "pb:ws": 1000 });

    await add(t.id, t.teamIds[0], { name: "Dev E", gender: "M", band: 700 });

    const person = await personOf(cy.personId);
    expect(person.riseRatings).toEqual({ "pb:mx": 1000 });
    expect((await rowOf(cy.id)).ratings).toEqual({ "pb:mx": 1000 });
    /* What the stray key did on screen: listed her as a women's-singles player
       at 1000 though she has never played singles. */
    expect(rating.formatRating(person, "pb:ws")).toBeNull();
  });

  /* A player with results keeps every number. Their row is re-recorded under
     the event's format; nothing on the person moves. */
  it("never touches the ratings of someone who has played", async () => {
    const veteranId = randomUUID();
    await db.insert(schema.people).values({
      id: veteranId, name: "Vet E", gender: "M",
      riseRatings: { "pb:md": 1180, "pb:ms": 1000 }, riseBest: 1180, matchCount: { "pb:md": 4 },
    });
    const t = await event("veteran-cup", { min: 1, max: 2 }, ["Larks", "Swifts"]);
    const vet = await add(t.id, t.teamIds[0], { name: "Vet E", gender: "M", personId: veteranId });
    expect(vet.ratings).toEqual({ "pb:ms": 1000 });

    await add(t.id, t.teamIds[0], { name: "Wren E", gender: "F", band: 900 });

    const person = await personOf(veteranId);
    expect(person.riseRatings).toEqual({ "pb:md": 1180, "pb:ms": 1000 });
    /* Mixed is new to him, so he brings his best in the sport. */
    expect((await rowOf(vet.id)).ratings).toEqual({ "pb:mx": 1180 });
  });

  /* Placed by ANOTHER event that has not been played yet. It is that event's
     seed: moved here, whichever event is played second would start from the
     original placement rather than the level the first one produced. */
  it("leaves a seed another event placed where that event put it", async () => {
    const newcomerId = randomUUID();
    await db.insert(schema.people).values({
      id: newcomerId, name: "New E", gender: "M",
      riseRatings: { "pb:md": 1000 }, riseBest: 1000, matchCount: {}, seedSource: "organiser",
    });
    const t = await event("elsewhere-cup", { min: 1, max: 2 }, ["Rooks", "Terns"]);
    const newcomer = await add(t.id, t.teamIds[0], { name: "New E", gender: "M", personId: newcomerId });
    await add(t.id, t.teamIds[0], { name: "Tern E", gender: "F", band: 900 });

    expect((await personOf(newcomerId)).riseRatings).toEqual({ "pb:md": 1000 });
    expect((await rowOf(newcomer.id)).ratings).toEqual({ "pb:mx": 1000 });
  });
});

/* Anything else that reshapes a roster — an approval, a removal — is caught at
   the one moment the key has consequences: before the match is rated. */
describe("just before a match is rated", () => {
  it("moves a seed left on an old guess to the format being played", async () => {
    const t = await event("late-cup", { min: 1, max: 2 }, ["A", "B"]);
    const seeded = async (name: string, gender: "M" | "F", teamId: string, band: number) => {
      const personId = randomUUID();
      /* Exactly what the old code left: filed as singles while the event is
         mixed pairs. */
      await db.insert(schema.people).values({
        id: personId, name, gender, riseRatings: { "pb:ws": band }, riseBest: band,
        matchCount: {}, seedSource: "organiser",
      });
      await db.insert(schema.players).values({
        id: randomUUID(), tournamentId: t.id, teamId, personId, name, gender, ratings: { "pb:ws": band },
      });
      return personId;
    };
    await seeded("Win1 L", "F", t.teamIds[0], 800);
    await seeded("Win2 L", "M", t.teamIds[0], 800);
    const loser = await seeded("Lose1 L", "F", t.teamIds[1], 1000);
    await seeded("Lose2 L", "M", t.teamIds[1], 1000);

    const matchId = randomUUID();
    await db.insert(schema.matches).values({
      id: matchId, tournamentId: t.id, divisionId: t.divisionId, round: "Round 1",
      teamAId: t.teamIds[0], teamBId: t.teamIds[1],
      log: [], lineupA: [], lineupB: [], ackedGates: [],
      typedScoreA: 11, typedScoreB: 3, rev: 1,
    });

    expect((await apply.applyMatchRatings(matchId)).status).toBe("applied");

    const person = await personOf(loser);
    expect(Object.keys(person.riseRatings)).toEqual(["pb:mx"]);
    const [history] = await db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.personId, loser));
    expect(history.format).toBe("pb:mx");
    expect(history.ratingBefore).toBe(1000);
    /* THE HARM, stated directly: she lost, so her pickleball rating is below
       where she was placed. With the stray 1000 still under "pb:ws" it read
       1000, and a category capped at 950 would have kept her out. */
    expect(rating.sportRating(person, "pb")).toBeLessThan(1000);
    expect(rating.sportRating(person, "pb")).toBe(person.riseRatings["pb:mx"]);
  });
});
