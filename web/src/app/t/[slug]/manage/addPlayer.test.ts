import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* Which format an organiser-added player's starting rating is filed under,
 * against a real database and through the real `addPlayer`.
 *
 * The bug: the first player added to an empty event is a team of one, so
 * the old `ratingFormatFor` read the event as SINGLES and their seed went under
 * "pb:ws" while every match of the event moved "pb:mx". The first match hid it — the
 * seed carries across formats of one sport — and what was left behind was a
 * seed nobody had played on, counting in their pickleball rating for ever.
 *
 * Driven through the action rather than the helpers, for the reason recorded in
 * lib/rating/pipeline.test.ts: the format decision and the seed write live in
 * different files, and only the path through both proves anything. */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
/* The draws in the same file redirect with a refusal code; loading the real
   module outside a request fails. Nothing here draws. */
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); } }));

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

  /* Team size said doubles; only the partner can say what KIND. With no
     category rule, a pair of one man and one woman is mixed doubles. */
  it("moves it again when her partner makes the pair mixed", async () => {
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

  /* The same, where the two events' guesses COINCIDE — found by review, not by
     a test: the check above is fooled when this event's first guess is the key
     the other event filed under. Gia is placed at 1000 in a women's singles
     event nobody has played, then picked as the first entrant of an "one or
     two" event, which also reads women's singles until her partner arrives.
     Moving the seed then would leave the singles event's player with no
     singles seed and an unplayed mixed one counting in her level for ever. */
  it("leaves another event's seed alone even when this event first guessed the same format", async () => {
    const singles = await event("singles-first", { min: 1, max: 1 }, ["Solo"]);
    const gia = await add(singles.id, singles.teamIds[0], { name: "Gia S", gender: "F", band: 1000 });
    expect((await personOf(gia.personId)).riseRatings).toEqual({ "pb:ws": 1000 });

    const t = await event("coincide-cup", { min: 1, max: 2 }, ["Jays", "Kestrels"]);
    /* A different display name only so the helper can find this row by name. */
    const giaHere = await add(t.id, t.teamIds[0], { name: "Gia S (again)", gender: "F", personId: gia.personId! });
    expect(giaHere.ratings).toEqual({ "pb:ws": 1000 });

    await add(t.id, t.teamIds[0], { name: "Hari S", gender: "M", band: 700 });

    /* Her seed stays where the singles event put it, and that event's row
       still finds it under the key it will be rated in. */
    expect((await personOf(gia.personId)).riseRatings).toEqual({ "pb:ws": 1000 });
    expect((await rowOf(gia.id)).ratings).toEqual({ "pb:ws": 1000 });
    /* This event is recorded as mixed, and brings her level in the sport. */
    expect((await rowOf(giaHere.id)).ratings).toEqual({ "pb:mx": 1000 });
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

/* ── Each category moves its OWN rating ───────────────────────────────────
 * The type used to be decided once for the whole event, from everybody in it.
 * Men's Doubles beside Women's Doubles is men and women on one roster, so the
 * first woman added refiled every man's seed to mixed and every match of both
 * categories moved everyone's mixed rating. */

/** An event with several categories, each with its own rule and teams. */
async function multiEvent(
  slug: string,
  sizes: { min: number; max: number },
  cats: { name: string; rule: "M" | "F" | "MX" | null; teams: string[] }[],
) {
  const id = randomUUID();
  await db.insert(schema.tournaments).values({
    id, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "draft",
    minTeamSize: sizes.min, maxTeamSize: sizes.max,
  });
  const out: Record<string, { divisionId: string; teamIds: string[] }> = {};
  for (const [i, c] of cats.entries()) {
    const divisionId = randomUUID();
    await db.insert(schema.divisions).values({ id: divisionId, tournamentId: id, name: c.name, position: i, genderRule: c.rule });
    const teamIds = c.teams.map(() => randomUUID());
    await db.insert(schema.teams).values(
      c.teams.map((name, k) => ({ id: teamIds[k], tournamentId: id, divisionId, name, seed: k + 1 })),
    );
    out[c.name] = { divisionId, teamIds };
  }
  return { id, cats: out };
}

describe("an event with more than one category", () => {
  it("files each category's players under that category's rating", async () => {
    const t = await multiEvent("two-cats", { min: 2, max: 2 }, [
      { name: "Men's Doubles", rule: "M", teams: ["MD1", "MD2"] },
      { name: "Women's Doubles", rule: "F", teams: ["WD1", "WD2"] },
    ]);
    const md = t.cats["Men's Doubles"].teamIds;
    const wd = t.cats["Women's Doubles"].teamIds;
    const arun = await add(t.id, md[0], { name: "Arun C", gender: "M", band: 1000 });
    await add(t.id, md[0], { name: "Bala C", gender: "M", band: 1000 });
    await add(t.id, md[1], { name: "Chet C", gender: "M", band: 800 });
    await add(t.id, md[1], { name: "Dinu C", gender: "M", band: 800 });
    /* The first woman in the event: the old code read the whole event as mixed
       from here and refiled every man above. */
    const esha = await add(t.id, wd[0], { name: "Esha C", gender: "F", band: 900 });
    await add(t.id, wd[0], { name: "Fara C", gender: "F", band: 900 });
    await add(t.id, wd[1], { name: "Gita C", gender: "F", band: 700 });
    await add(t.id, wd[1], { name: "Hema C", gender: "F", band: 700 });

    expect((await personOf(arun.personId)).riseRatings).toEqual({ "pb:md": 1000 });
    expect((await rowOf(arun.id)).ratings).toEqual({ "pb:md": 1000 });
    expect((await personOf(esha.personId)).riseRatings).toEqual({ "pb:wd": 900 });
  });

  it("moves men's doubles for a Men's Doubles match and women's for a Women's", async () => {
    const [t] = await db.select().from(schema.tournaments).where(eq(schema.tournaments.slug, "two-cats"));
    const divs = await db.select().from(schema.divisions).where(eq(schema.divisions.tournamentId, t.id));
    const teams = await db.select().from(schema.teams).where(eq(schema.teams.tournamentId, t.id));
    const teamsOf = (name: string) => {
      const d = divs.find((x) => x.name === name)!;
      return teams.filter((x) => x.divisionId === d.id).sort((a, b) => a.seed - b.seed);
    };
    const play = async (name: string) => {
      const [a, b] = teamsOf(name);
      const id = randomUUID();
      await db.insert(schema.matches).values({
        id, tournamentId: t.id, divisionId: a.divisionId, round: "Round 1",
        teamAId: a.id, teamBId: b.id, log: [], lineupA: [], lineupB: [], ackedGates: [],
        typedScoreA: 11, typedScoreB: 3, rev: 1,
      });
      expect((await apply.applyMatchRatings(id)).status).toBe("applied");
      return id;
    };
    const mdMatch = await play("Men's Doubles");
    const wdMatch = await play("Women's Doubles");

    const formats = async (matchId: string) =>
      [...new Set((await db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, matchId))).map((h) => h.format))];
    expect(await formats(mdMatch)).toEqual(["pb:md"]);
    expect(await formats(wdMatch)).toEqual(["pb:wd"]);

    /* And nobody has a mixed rating out of an event with no mixed category. */
    const inThisEvent = (await db.select().from(schema.people)).filter((p) => / C$/.test(p.name));
    expect(inThisEvent.length).toBe(8);
    expect(inThisEvent.some((p) => "pb:mx" in p.riseRatings)).toBe(false);
  });

  /* An open category judges who is IN IT, not who is in the event. Men-only
     Open beside Women's Doubles is men's doubles; read off the whole event it
     was men and women, so it moved mixed (and, since the Open decision, would
     move Open doubles). */
  it("rates an all-men open category as men's doubles beside a women's category", async () => {
    const t = await multiEvent("open-and-wd", { min: 2, max: 2 }, [
      { name: "Open", rule: null, teams: ["OA", "OB"] },
      { name: "Women's Doubles", rule: "F", teams: ["WA", "WB"] },
    ]);
    const o = t.cats["Open"].teamIds;
    const w = t.cats["Women's Doubles"].teamIds;
    for (const [team, names] of [[o[0], ["Ov1", "Ov2"]], [o[1], ["Ov3", "Ov4"]]] as const) {
      for (const n of names) await add(t.id, team, { name: `${n} W`, gender: "M", band: 900 });
    }
    for (const [team, names] of [[w[0], ["Wv1", "Wv2"]], [w[1], ["Wv3", "Wv4"]]] as const) {
      for (const n of names) await add(t.id, team, { name: `${n} W`, gender: "F", band: 900 });
    }
    const id = randomUUID();
    await db.insert(schema.matches).values({
      id, tournamentId: t.id, divisionId: t.cats["Open"].divisionId, round: "Round 1",
      teamAId: o[0], teamBId: o[1], log: [], lineupA: [], lineupB: [], ackedGates: [],
      typedScoreA: 11, typedScoreB: 5, rev: 1,
    });
    expect((await apply.applyMatchRatings(id)).status).toBe("applied");
    const history = await db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, id));
    expect([...new Set(history.map((h) => h.format))]).toEqual(["pb:md"]);
  });

  it("files a Mixed category's first player as mixed straight away", async () => {
    const t = await multiEvent("mixed-only", { min: 1, max: 2 }, [
      { name: "Mixed", rule: "MX", teams: ["X1", "X2"] },
    ]);
    const ira = await add(t.id, t.cats["Mixed"].teamIds[0], { name: "Ira X", gender: "F", band: 950 });
    expect((await personOf(ira.personId)).riseRatings).toEqual({ "pb:mx": 950 });
  });

  /* The refile guard's other half: another CATEGORY of the same event holds
     the seed. Rahul is placed in Men's Doubles, then picked into an open
     category of the same event, which reads "men's doubles" too until a woman
     joins it — teams of two, so BOTH his rows are filed "pb:md" and the first
     half of the guard (this row is filed where the seed sits) is satisfied.
     Only the second half stands between his seed and Open doubles. */
  it("leaves a seed another category of this event is holding", async () => {
    const t = await multiEvent("md-and-open", { min: 2, max: 2 }, [
      { name: "Men's Doubles", rule: "M", teams: ["M1", "M2"] },
      { name: "Open", rule: null, teams: ["O1", "O2"] },
    ]);
    const rahul = await add(t.id, t.cats["Men's Doubles"].teamIds[0], { name: "Rahul O", gender: "M", band: 1000 });
    await add(t.id, t.cats["Men's Doubles"].teamIds[0], { name: "Sunil O", gender: "M", band: 900 });
    expect((await personOf(rahul.personId)).riseRatings).toEqual({ "pb:md": 1000 });

    /* Open is a MIXTURE of pairs, which is what makes it Open doubles: a men's
       pair in O2, and Rahul's pair about to become mixed. */
    await add(t.id, t.cats["Open"].teamIds[1], { name: "Uday O", gender: "M", band: 850 });
    await add(t.id, t.cats["Open"].teamIds[1], { name: "Vijay O", gender: "M", band: 850 });
    const rahulOpen = await add(t.id, t.cats["Open"].teamIds[0], { name: "Rahul O (open)", gender: "M", personId: rahul.personId! });
    expect(rahulOpen.ratings).toEqual({ "pb:md": 1000 });
    await add(t.id, t.cats["Open"].teamIds[0], { name: "Tara O", gender: "F", band: 800 });

    expect((await personOf(rahul.personId)).riseRatings).toEqual({ "pb:md": 1000 });
    expect((await rowOf(rahul.id)).ratings).toEqual({ "pb:md": 1000 });
    expect((await rowOf(rahulOpen.id)).ratings).toEqual({ "pb:od": 1000 });
  });

  it("seeds each category on its own rating", async () => {
    const t = await multiEvent("seed-cats", { min: 2, max: 2 }, [
      { name: "Men's Doubles", rule: "M", teams: ["Low", "High"] },
      { name: "Women's Doubles", rule: "F", teams: ["WLow", "WHigh"] },
    ]);
    const md = t.cats["Men's Doubles"].teamIds;
    await add(t.id, md[0], { name: "Low1 S", gender: "M", band: 700 });
    await add(t.id, md[0], { name: "Low2 S", gender: "M", band: 700 });
    await add(t.id, md[1], { name: "High1 S", gender: "M", band: 1100 });
    await add(t.id, md[1], { name: "High2 S", gender: "M", band: 1100 });
    const wd = t.cats["Women's Doubles"].teamIds;
    await add(t.id, wd[0], { name: "WLow1 S", gender: "F", band: 650 });
    await add(t.id, wd[0], { name: "WLow2 S", gender: "F", band: 650 });
    await add(t.id, wd[1], { name: "WHigh1 S", gender: "F", band: 1000 });
    await add(t.id, wd[1], { name: "WHigh2 S", gender: "F", band: 1000 });

    await actions.seedByRating(t.id);
    const teams = await db.select().from(schema.teams).where(eq(schema.teams.tournamentId, t.id));
    const seedOf = (name: string) => teams.find((x) => x.name === name)!.seed;
    expect(seedOf("High")).toBeLessThan(seedOf("Low"));
    expect(seedOf("WHigh")).toBeLessThan(seedOf("WLow"));
    /* Every team was rated on a key its players hold: read on the wrong key a
       women's team would have no evidence and sort to the bottom. */
    expect(seedOf("WHigh")).toBeLessThan(seedOf("Low"));
  });
});
