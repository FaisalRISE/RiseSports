import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* Removing a category, against a real database, through the real actions.
 *
 * What it used to do: delete the category row and let ON DELETE CASCADE take
 * its matches — PLAYED ones included — and, from each match, its rating
 * history, while the players' ratings, match counts and partner records stayed
 * moved. The same hole a redraw had (draws.test.ts), on a different button. */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
/* redirect() works by throwing; here it throws something the test can read. */
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  notFound: () => { throw new Error("NOT FOUND"); },
}));
/* The registration page is rendered once below, to read what it puts on the
   button; a link needs no router to be an element. */
vi.mock("next/link", () => ({ default: () => null }));

/* The race test needs a check that does not see a result the DELETE then
   finds — what a result committed between the two looks like. Everything else
   gets the real guard. */
const seen = vi.hoisted(() => ({ blind: false }));
vi.mock("@/lib/draw/guard", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/draw/guard")>();
  return {
    ...real,
    lockedIds: (...args: Parameters<typeof real.lockedIds>) =>
      seen.blind ? Promise.resolve(new Set<string>()) : real.lockedIds(...args),
  };
});

/* Two seams for the writers that file something under a category: the
   removal is made to land in the gap between a writer's checks and its
   transaction — after an organiser's add has checked the category is the
   event's, and just before a public entry is written. Off unless a test arms
   them; each fires once. */
const filing = vi.hoisted(() => ({
  afterList: null as null | (() => Promise<void>),
  beforeWrite: null as null | (() => Promise<void>),
}));
const fire = async (k: "afterList" | "beforeWrite") => {
  const hook = filing[k];
  filing[k] = null;
  if (hook) await hook();
};
vi.mock("@/lib/divisions", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/divisions")>();
  return {
    ...real,
    divisionsOf: async (...args: Parameters<typeof real.divisionsOf>) => {
      const all = await real.divisionsOf(...args);
      await fire("afterList");
      return all;
    },
  };
});
vi.mock("@/lib/registration/store", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/lib/registration/store")>();
  return {
    ...real,
    writeEntry: async (...args: Parameters<typeof real.writeEntry>) => {
      await fire("beforeWrite");
      return real.writeEntry(...args);
    },
  };
});

const dir = path.join(os.tmpdir(), `rise-remove-category-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let registration: typeof import("./actions");
let manage: typeof import("../actions");
let apply: typeof import("@/lib/rating/apply");
let guard: typeof import("@/lib/draw/guard");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;
let inArray: typeof import("drizzle-orm").inArray;
let and: typeof import("drizzle-orm").and;

const owner = randomUUID();

/** An event with one groups-then-knockout category of four teams, each with
    two players linked to people, so a result moves real ratings. */
async function event(slug: string) {
  const id = randomUUID();
  await db.insert(schema.tournaments).values({
    id, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "draft",
    minTeamSize: 2, maxTeamSize: 2,
  });
  const divisionId = randomUUID();
  await db.insert(schema.divisions).values({ id: divisionId, tournamentId: id, name: "Men's Doubles", shape: "groups_ko", genderRule: "M" });
  const teamIds: string[] = [];
  const personIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const teamId = randomUUID();
    teamIds.push(teamId);
    await db.insert(schema.teams).values({ id: teamId, tournamentId: id, divisionId, name: `${slug}-T${i + 1}`, seed: i + 1 });
    for (let k = 0; k < 2; k++) {
      const personId = randomUUID();
      personIds.push(personId);
      await db.insert(schema.people).values({ id: personId, name: `${slug}-${i}${k}`, gender: "M", riseRatings: { "pb:md": 1000 }, riseBest: 1000, matchCount: {}, seedSource: "organiser" });
      await db.insert(schema.players).values({ id: randomUUID(), tournamentId: id, teamId, personId, name: `${slug}-${i}${k}`, gender: "M", ratings: { "pb:md": 1000 } });
    }
  }
  return { id, slug, divisionId, teamIds, personIds };
}

/** A second, empty category on the same event. */
async function emptyCategory(tournamentId: string, name = "Mixed") {
  const id = randomUUID();
  await db.insert(schema.divisions).values({ id, tournamentId, name, position: 1 });
  return id;
}

/** Draw the category's groups as the manage page does: one group, six fixtures. */
async function draw(t: { id: string; divisionId: string }) {
  const f = new FormData();
  f.set("divisionId", t.divisionId);
  f.set("groups", "1");
  await manage.generateGroups(t.id, f);
  return matchesOf(t.divisionId);
}

/* What the registration page puts on "Yes, remove": the fingerprint of the
   teams and matches it SAW in the category (RemoveCategoryButton). */
async function pageToken(divisionId: string) {
  const squads = await db.select().from(schema.teams).where(eq(schema.teams.divisionId, divisionId));
  const waiting = await db.select().from(schema.registrations)
    .where(and(eq(schema.registrations.divisionId, divisionId), eq(schema.registrations.status, "pending")));
  return guard.categorySignature(squads.map((x) => x.id), (await matchesOf(divisionId)).map((m) => m.id), waiting.map((r) => r.id));
}

/* A removal posted as the page posts it. `unconfirmed` is one without the
   fingerprint — the first tap's Enter, or a crafted post; `token` is a page
   that saw something else (a stale phone). */
async function remove(tournamentId: string, divisionId: string, { unconfirmed = false, token }: { unconfirmed?: boolean; token?: string } = {}) {
  const f = new FormData();
  if (!unconfirmed) f.set("confirm", token ?? (await pageToken(divisionId)));
  return outcome(registration.removeDivision(tournamentId, divisionId, f));
}

/** The refusal a removal ended with, or null when it went through without one. */
const outcome = (p: Promise<unknown>) =>
  p.then(() => null, (e: Error) => {
    if (!e.message.startsWith("REDIRECT ")) throw e;
    const url = new URL(e.message.slice(9), "http://x");
    expect(url.pathname).toMatch(/\/manage\/registration$/);
    return url.searchParams.get("problem");
  });

const matchesOf = (divisionId: string) =>
  db.select().from(schema.matches).where(eq(schema.matches.divisionId, divisionId));
const categoryExists = async (divisionId: string) =>
  (await db.select().from(schema.divisions).where(eq(schema.divisions.id, divisionId))).length === 1;
const historyOf = (matchId: string) =>
  db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, matchId));

/** Record a typed result and let it move ratings, as a real save would. */
async function play(matchId: string) {
  await db.update(schema.matches).set({ typedScoreA: 11, typedScoreB: 5, rev: 1 }).where(eq(schema.matches.id, matchId));
  return apply.applyMatchRatings(matchId);
}

/** Each person's rating and match count, and their history rows, by key. */
async function ledgerOf(personIds: string[]) {
  const people = await db.select().from(schema.people).where(inArray(schema.people.id, personIds));
  const history = await db.select().from(schema.ratingHistory).where(inArray(schema.ratingHistory.personId, personIds));
  return people.map((p) => ({
    id: p.id,
    rating: p.riseRatings["pb:md"],
    count: p.matchCount["pb:md"] ?? 0,
    rows: history.filter((h) => h.personId === p.id && h.format === "pb:md").length,
  })).sort((a, b) => a.id.localeCompare(b.id));
}

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  registration = await import("./actions");
  manage = await import("../actions");
  apply = await import("@/lib/rating/apply");
  guard = await import("@/lib/draw/guard");
  ({ eq, inArray, and } = await import("drizzle-orm"));

  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migrations, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const s = stmt.trim();
      if (s) await db.execute(s as never);
    }
  }
  await db.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });
}, 120_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("a category with results", () => {
  it("is refused, and its results, rating history and the ratings they moved all survive", async () => {
    const t = await event("played-category");
    const drawn = await draw(t);
    expect(drawn).toHaveLength(6);
    expect((await play(drawn[0].id)).status).toBe("applied");
    const before = await ledgerOf(t.personIds);
    expect(before.some((p) => p.rating !== 1000), "the result moved somebody").toBe(true);

    expect(await remove(t.id, t.divisionId)).toBe("category-played");

    expect(await categoryExists(t.divisionId)).toBe(true);
    const after = await matchesOf(t.divisionId);
    expect(after.map((m) => m.id).sort()).toEqual(drawn.map((m) => m.id).sort());
    expect(after.find((m) => m.id === drawn[0].id)?.typedScoreA).toBe(11);
    expect(await historyOf(drawn[0].id)).toHaveLength(4);
    expect((await db.select().from(schema.teams).where(eq(schema.teams.divisionId, t.divisionId))).length).toBe(4);
    /* The invariant the cascade broke: every rating that moved has its record. */
    const ledger = await ledgerOf(t.personIds);
    expect(ledger).toEqual(before);
    for (const p of ledger) expect(p.count, "match count = history rows").toBe(p.rows);
  });

  /* "Has play" is not the only lock: a rating that moved stays on record even
     if the score was taken off the row some other way, exactly as for a redraw. */
  it("is refused while a match has rating history, even with no score on it", async () => {
    const t = await event("rated-only");
    const [m] = await draw(t);
    expect((await play(m.id)).status).toBe("applied");
    await db.update(schema.matches).set({ typedScoreA: null, typedScoreB: null }).where(eq(schema.matches.id, m.id));

    expect(await remove(t.id, t.divisionId)).toBe("category-played");
    expect(await historyOf(m.id)).toHaveLength(4);
  });

  /* A match being played has no result yet, and is still not the organiser's to
     throw away from the registration page. */
  it("is refused while a match is being played", async () => {
    const t = await event("live-category");
    const [m] = await draw(t);
    await db.update(schema.matches).set({ log: ["a", "b", "a"] as never }).where(eq(schema.matches.id, m.id));

    expect(await remove(t.id, t.divisionId)).toBe("category-played");
    expect((await matchesOf(t.divisionId)).find((x) => x.id === m.id)?.log).toEqual(["a", "b", "a"]);
  });

  /* A match added by hand has no group and no bracket, so no draw ever looks at
     it — but the cascade takes it all the same. */
  it("counts a hand-added match too", async () => {
    const t = await event("hand-added");
    const f = new FormData();
    f.set("round", "Friendly");
    f.set("teamA", t.teamIds[0]);
    f.set("teamB", t.teamIds[1]);
    await manage.addMatch(t.id, f);
    const [m] = await matchesOf(t.divisionId);
    expect(m.groupId).toBeNull();
    expect((await play(m.id)).status).toBe("applied");

    expect(await remove(t.id, t.divisionId)).toBe("category-played");
    expect(await historyOf(m.id)).toHaveLength(4);
  });

  it("leaves the event's other categories alone either way", async () => {
    const t = await event("two-categories");
    const [m] = await draw(t);
    await play(m.id);
    const mixed = await emptyCategory(t.id);

    expect(await remove(t.id, t.divisionId)).toBe("category-played");
    expect(await categoryExists(mixed)).toBe(true);
    expect(await remove(t.id, mixed)).toBeNull();
    expect(await categoryExists(mixed)).toBe(false);
    expect(await categoryExists(t.divisionId)).toBe(true);
  });
});

describe("a category with nothing played", () => {
  /* One tap: nothing to lose, nothing to ask. Even a post with no fingerprint
     at all removes it. */
  it("is removed when it is empty, with no second tap", async () => {
    const t = await event("empty-category");
    const mixed = await emptyCategory(t.id);
    expect(await remove(t.id, mixed, { unconfirmed: true })).toBeNull();
    expect(await categoryExists(mixed)).toBe(false);
  });

  /* The second tap is enforced on the server: Enter on the first, or a crafted
     post, sends no fingerprint and removes nothing. */
  it("asks twice once it has teams, and the first tap removes nothing", async () => {
    const t = await event("teams-only");
    expect(await remove(t.id, t.divisionId, { unconfirmed: true })).toBe("confirm-needed");
    expect(await categoryExists(t.divisionId)).toBe(true);
    expect(await db.select().from(schema.teams).where(inArray(schema.teams.id, t.teamIds))).toHaveLength(4);

    expect(await remove(t.id, t.divisionId)).toBeNull();
    expect(await categoryExists(t.divisionId)).toBe(false);
  });

  /* A page opened while the category was empty shows the one-tap button. If
     entries are approved into it meanwhile, that tap must not delete them. */
  it("refuses a page that saw it empty once teams have been added", async () => {
    const t = await event("stale-page");
    const mixed = await emptyCategory(t.id);
    const sawEmpty = await pageToken(mixed);
    const teamId = randomUUID();
    await db.insert(schema.teams).values({ id: teamId, tournamentId: t.id, divisionId: mixed, name: "Late entry", seed: 1 });

    expect(await remove(t.id, mixed, { token: sawEmpty })).toBe("category-stale");
    expect(await categoryExists(mixed)).toBe(true);
    expect(await db.select().from(schema.teams).where(eq(schema.teams.id, teamId))).toHaveLength(1);
  });

  /* Likewise a page that confirmed one set of fixtures cannot remove another:
     the same number of matches, but not the ones it saw. */
  it("refuses a confirmation of something other than what is there now", async () => {
    const t = await event("changed-since");
    const drawn = await draw(t);
    const sawTeams = await pageToken(t.divisionId);
    await db.delete(schema.matches).where(eq(schema.matches.id, drawn[0].id));
    const f = new FormData();
    f.set("round", "Friendly");
    f.set("teamA", t.teamIds[0]);
    f.set("teamB", t.teamIds[1]);
    await manage.addMatch(t.id, f);

    expect(await remove(t.id, t.divisionId, { token: sawTeams })).toBe("category-stale");
    expect(await matchesOf(t.divisionId)).toHaveLength(6);
  });

  it("is removed with its teams, groups and unplayed fixtures", async () => {
    const t = await event("unplayed-category");
    const drawn = await draw(t);
    expect(await remove(t.id, t.divisionId)).toBeNull();

    expect(await categoryExists(t.divisionId)).toBe(false);
    expect(await db.select().from(schema.matches).where(inArray(schema.matches.id, drawn.map((m) => m.id)))).toHaveLength(0);
    expect(await db.select().from(schema.teams).where(inArray(schema.teams.id, t.teamIds))).toHaveLength(0);
    expect(await db.select().from(schema.groups).where(eq(schema.groups.divisionId, t.divisionId))).toHaveLength(0);
  });
});

describe("the category being removed", () => {
  it("must be this event's: another event's category is left alone", async () => {
    const a = await event("remover");
    const b = await event("bystander");
    await draw(b);

    expect(await remove(a.id, b.divisionId)).toBeNull();
    expect(await categoryExists(b.divisionId)).toBe(true);
    expect(await matchesOf(b.divisionId)).toHaveLength(6);
  });
});

/* The race the guard exists for: a result lands after the check has read the
   matches and before the delete. The DELETE re-checks every row itself, and
   the removal rolls back rather than take a played match with it. */
describe("a result that arrives mid-removal", () => {
  it("rolls the removal back, and the result and its ratings survive", async () => {
    const t = await event("race");
    const drawn = await draw(t);
    await play(drawn[0].id);
    const before = await ledgerOf(t.personIds);

    seen.blind = true;
    try {
      expect(await remove(t.id, t.divisionId)).toBe("category-changed");
    } finally {
      seen.blind = false;
    }

    expect(await categoryExists(t.divisionId)).toBe(true);
    expect((await matchesOf(t.divisionId)).map((m) => m.id).sort()).toEqual(drawn.map((m) => m.id).sort());
    expect(await historyOf(drawn[0].id)).toHaveLength(4);
    expect(await ledgerOf(t.personIds)).toEqual(before);
  });
});

/* The cascade used to leave the category's approved entries "approved" with no
   team: impossible to decline, and still the pair's live entry, so they could
   not enter another category. And it left the players rows behind with no
   team, where they pinned a misfiled seed for ever. */
describe("what goes with a category", () => {
  it("withdraws its approved entries, saying why, deletes its players, and frees the phone", async () => {
    const t = await event("entries-withdrawn");
    const registrationId = randomUUID();
    await db.insert(schema.registrations).values({
      id: registrationId, tournamentId: t.id, divisionId: t.divisionId, teamId: t.teamIds[0],
      teamName: "entries-withdrawn-T1", contactName: "Contact", contactPhone: "+919000004001", status: "approved",
    });
    expect(await remove(t.id, t.divisionId)).toBeNull();

    const [entry] = await db.select().from(schema.registrations).where(eq(schema.registrations.id, registrationId));
    expect(entry.status).toBe("withdrawn");
    expect(entry.note).toBe("Its category, Men's Doubles, was removed.");
    /* By the event: the cascade nulls a left-behind player's team, so asking
       by the old team ids could never find one. */
    expect(await db.select().from(schema.players).where(eq(schema.players.tournamentId, t.id))).toEqual([]);

    /* The same phone may enter again: a withdrawn entry is not a live one. */
    const { writeEntry } = await import("@/lib/registration/store");
    expect(await writeEntry({
      id: randomUUID(), tournamentId: t.id, divisionId: null, teamName: "Again",
      contactName: "Contact", contactPhone: "+919000004001", status: "pending",
    }, [])).toBe("written");
  });
});

/* A category removed while something is being filed under it. Each writer
   takes the category (KEY SHARE) before it writes, so a removal under way
   finishes first and the writer finds the category gone — and says so —
   rather than failing on the foreign key. PGlite runs one thing at a time, so
   the removal is made to land in the gap with the seams above. */
describe("a category removed while something is being filed under it", () => {
  /* Removed after the add checked it was the event's, and before it was
     written. Re-resolving the category then fell back to the event's FIRST
     one, and the team was filed where the organiser had not put it. */
  it("an organiser's new team is not added — not to another category either — and nothing fails", async () => {
    const t = await event("team-too-late");
    const spare = await emptyCategory(t.id, "Short-lived");
    filing.afterList = async () => {
      await db.delete(schema.divisions).where(eq(schema.divisions.id, spare));
    };
    const f = new FormData();
    f.set("name", "Team Too Late");
    f.set("divisionId", spare);
    await manage.addTeam(t.id, f);
    expect(filing.afterList, "the seam fired").toBeNull();
    expect(await db.select().from(schema.teams).where(eq(schema.teams.name, "Team Too Late"))).toEqual([]);
    expect(await db.select().from(schema.teams).where(eq(schema.teams.divisionId, t.divisionId))).toHaveLength(4);
  });

  it("a public entry is refused in words, and nothing is written", async () => {
    const t = await event("entry-too-late");
    await db.update(schema.tournaments).set({ status: "open" }).where(eq(schema.tournaments.id, t.id));
    const spare = await emptyCategory(t.id, "Short-lived");
    filing.beforeWrite = async () => {
      await db.delete(schema.divisions).where(eq(schema.divisions.id, spare));
    };
    const f = new FormData();
    f.set("teamName", "Entry Too Late");
    f.set("divisionId", spare);
    for (const [n, p] of [["Asha", "+919000004101"], ["Bina", "+919000004102"]]) {
      f.append("playerName", n);
      f.append("playerPhone", p);
      f.append("playerGender", "F");
    }
    const { submitEntry } = await import("@/app/e/[slug]/actions");
    expect(await submitEntry(t.slug, f)).toEqual({
      ok: false,
      problems: [{ field: "form", message: "That category has just been removed by the organiser. Choose another and send it again." }],
    });
    expect(filing.beforeWrite, "the seam fired").toBeNull();
    expect(await db.select().from(schema.registrations).where(eq(schema.registrations.tournamentId, t.id))).toEqual([]);
  });
});

/* Entries WAITING in a category are part of what removing it takes: withdrawn
   with a note, like approved ones, and in the fingerprint, so a category with
   only those asks twice and a page that saw none is refused. They used to go
   on one tap, pending with no category and no record of which they chose, and
   their phone still counted as entered, so they could not choose another. */
describe("entries waiting in a category", () => {
  async function waitingIn(slug: string, phone: string) {
    const t = await event(slug);
    const spare = await emptyCategory(t.id, "Waiting Room");
    const entry = randomUUID();
    await db.insert(schema.registrations).values({
      id: entry, tournamentId: t.id, divisionId: spare, teamName: `${slug}-entry`,
      contactName: "Contact", contactPhone: phone, status: "pending",
    });
    return { t, spare, entry };
  }

  it("make a removal ask twice, and a page that saw none is refused", async () => {
    const { t, spare } = await waitingIn("waiting-asks", "+919000004201");
    expect(await remove(t.id, spare, { unconfirmed: true })).toBe("confirm-needed");
    expect(await remove(t.id, spare, { token: guard.categorySignature([], []) })).toBe("category-stale");
    expect(await categoryExists(spare)).toBe(true);
  });

  it("are withdrawn, saying why, and their phone may enter again", async () => {
    const { t, spare, entry } = await waitingIn("waiting-withdrawn", "+919000004202");
    expect(await remove(t.id, spare)).toBeNull();
    const [row] = await db.select().from(schema.registrations).where(eq(schema.registrations.id, entry));
    expect(row).toMatchObject({ status: "withdrawn", divisionId: null, note: "Its category, Waiting Room, was removed." });
    const { writeEntry } = await import("@/lib/registration/store");
    expect(await writeEntry({
      id: randomUUID(), tournamentId: t.id, divisionId: t.divisionId, teamName: "Again",
      contactName: "Contact", contactPhone: "+919000004202", status: "pending",
    }, [])).toBe("written");
  });
});

/* Each organiser's add takes the category FOR KEY SHARE as the FIRST statement
   of its transaction — the lock a removal's FOR UPDATE waits on, and nothing
   else does — and finds it gone if a removal committed while it waited. PGlite
   runs one transaction at a time, so the removal is made to land exactly there:
   the category is deleted, inside the writer's transaction, just before its
   KEY SHARE read. A writer that read the category any other way, or not first,
   never reaches that moment — and its insert then meets the category. */
async function removedAtTheLock<T>(divisionId: string, run: () => Promise<T>) {
  type Q = { query: (sql: string, ...rest: unknown[]) => Promise<unknown> };
  const client = (db as unknown as { $client: { transaction: (cb: (tx: Q) => Promise<unknown>) => Promise<unknown> } }).$client;
  const original = client.transaction.bind(client);
  const txs: string[][] = [];
  let removed = false;
  client.transaction = (cb) =>
    original(async (tx) => {
      const mine: string[] = [];
      txs.push(mine);
      const query = tx.query.bind(tx);
      tx.query = async (sql: string, ...rest: unknown[]) => {
        const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (!removed && /from "divisions" .* for key share$/.test(s)) {
          removed = true;
          await query("delete from divisions where id = $1", [divisionId]);
        }
        mine.push(s);
        return query(sql, ...rest);
      };
      return cb(tx);
    });
  try {
    const result = await run();
    return { result, removed, first: txs.map((t) => t[0]) };
  } finally {
    client.transaction = original;
  }
}

describe("an organiser's add meeting a removal", () => {
  async function spareWithTeams(slug: string) {
    const t = await event(slug);
    const spare = await emptyCategory(t.id, "Short-lived");
    const [x, y] = [randomUUID(), randomUUID()];
    await db.insert(schema.teams).values([
      { id: x, tournamentId: t.id, divisionId: spare, name: `${slug}-X`, seed: 1 },
      { id: y, tournamentId: t.id, divisionId: spare, name: `${slug}-Y`, seed: 2 },
    ]);
    return { t, spare, x, y };
  }
  const keyShareFirst = /^select .* from "divisions" .* for key share$/;

  it("a team: takes the category first, and adds nothing once it is gone", async () => {
    const { t, spare } = await spareWithTeams("lock-team");
    const f = new FormData();
    f.set("name", "Locked Out");
    f.set("divisionId", spare);
    const r = await removedAtTheLock(spare, () => manage.addTeam(t.id, f));
    expect(r.removed, "it took the category").toBe(true);
    expect(r.first).toEqual([expect.stringMatching(keyShareFirst)]);
    expect(await db.select().from(schema.teams).where(eq(schema.teams.name, "Locked Out"))).toEqual([]);
  });

  it("a player: takes the category first, and says the player was not added", async () => {
    const { t, spare, x } = await spareWithTeams("lock-player");
    const f = new FormData();
    f.set("name", "Late Player");
    f.set("gender", "M");
    const r = await removedAtTheLock(spare, () => manage.addPlayer(t.id, x, f));
    expect(r.removed, "it took the category").toBe(true);
    expect(r.result).toEqual({ ok: false, message: "This team's category has just been removed, so the player was not added." });
    expect(r.first).toEqual([expect.stringMatching(keyShareFirst)]);
    expect(await db.select().from(schema.players).where(eq(schema.players.name, "Late Player"))).toEqual([]);
  });

  it("a match: takes the category first — before the two teams — and adds nothing once it is gone", async () => {
    const { t, spare, x, y } = await spareWithTeams("lock-match");
    const f = new FormData();
    f.set("round", "Late Round");
    f.set("teamA", x);
    f.set("teamB", y);
    const r = await removedAtTheLock(spare, () => manage.addMatch(t.id, f));
    expect(r.removed, "it took the category").toBe(true);
    expect(r.first).toEqual([expect.stringMatching(keyShareFirst)]);
    expect(await db.select().from(schema.matches).where(eq(schema.matches.round, "Late Round"))).toEqual([]);
  });
});

/* The page's OWN fingerprint and words, not the test's: every other test here
   builds its token with pageToken, so a page that dropped the fixtures, or the
   waiting entries, from its token would refuse every up-to-date removal as
   "category-stale" with every test green. Rendered as the server renders it,
   then the button's token posted as the button posts it. */
describe("the registration page's remove button", () => {
  type El = { type?: unknown; props?: Record<string, unknown> };
  function find(node: unknown, type: unknown): El | null {
    if (!node || typeof node !== "object") return null;
    if (Array.isArray(node)) {
      for (const n of node) { const hit = find(n, type); if (hit) return hit; }
      return null;
    }
    const el = node as El;
    if (el.type === type) return el;
    return find(el.props?.children, type);
  }

  it("says what goes, and its token removes a drawn category with entries in it", async () => {
    const t = await event("page-token");
    await draw(t);
    await db.insert(schema.registrations).values([
      { id: randomUUID(), tournamentId: t.id, divisionId: t.divisionId, teamId: t.teamIds[0], teamName: "page-token-T1",
        contactName: "Approved", contactPhone: "+919000004301", status: "approved" },
      { id: randomUUID(), tournamentId: t.id, divisionId: t.divisionId, teamName: "Waiting Pair",
        contactName: "Waiting", contactPhone: "+919000004302", status: "pending" },
    ]);
    const { default: RegistrationPage } = await import("./page");
    const { RemoveCategoryButton } = await import("./RemoveCategoryButton");
    const tree = await RegistrationPage({ params: Promise.resolve({ slug: t.slug }), searchParams: Promise.resolve({}) });
    const button = find(tree, RemoveCategoryButton);
    expect(button, "the page offers a remove button").not.toBeNull();
    expect(button!.props!.what).toBe(
      "Removes 4 teams and 6 unplayed matches, and withdraws 1 approved entry and 1 entry waiting for approval.",
    );
    expect(await remove(t.id, t.divisionId, { token: button!.props!.token as string })).toBeNull();
    expect(await categoryExists(t.divisionId)).toBe(false);
  });
});
