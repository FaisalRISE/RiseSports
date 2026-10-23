import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* Clearing a result, resetting a match, deleting one and starting a category
 * again (step 8), through the real actions against a real database, with the
 * ratings each one moves.
 *
 * What was wrong before, each pinned below:
 *   - a PLAYED match could be deleted with one tap, and the record of its
 *     rating changes went with it while the players' ratings stayed moved;
 *   - nothing could clear a result or reset a match being played, so a wrong
 *     result stood or was undone rally by rally;
 *   - nothing could start a category again;
 *   - a semi-final the Final waited on could be deleted, leaving the Final
 *     waiting for ever. */

vi.mock("next/cache", () => ({ revalidatePath: (p: string) => { revalidated.push(p); } }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ host: "localhost" }),
}));
/* The manage page is rendered as a tree, never mounted: a link is its children. */
vi.mock("next/link", () => ({ default: (p: { children?: unknown }) => p.children }));
/* redirect() works by throwing; here it throws something the test can read. */
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  notFound: () => {},
}));

const revalidated = vi.hoisted(() => [] as string[]);
/* Who is calling. `pin` stands in for a referee holding only a scorer PIN —
   once sign-in exists, what every visitor who is not the organiser will be. */
const who = vi.hoisted(() => ({ pin: false }));
vi.mock("@/lib/auth/guard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/guard")>();
  return {
    ...orig,
    principalFor: async (...a: Parameters<typeof orig.principalFor>) =>
      who.pin ? { userId: null, role: null, hasScorerGrant: true, isOwner: false } : orig.principalFor(...a),
  };
});
/* A seam inside the rating engine: `refileSeeds` runs after the apply has READ
   the match and before it LOCKS it — where, in real life, the organiser's clear
   lands between a result being saved and its rating being applied. */
const race = vi.hoisted(() => ({ beforeRefile: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/rating/tournament", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/rating/tournament")>();
  return {
    ...orig,
    refileSeeds: async (...a: Parameters<typeof orig.refileSeeds>) => {
      const run = race.beforeRefile;
      race.beforeRefile = null;
      if (run) await run();
      return orig.refileSeeds(...a);
    },
  };
});
/* A result landing between removeMatch's check and its DELETE: the DELETE
   re-checks and throws, and the organiser is told rather than shown a 500. */
const guardRace = vi.hoisted(() => ({ changeBeforeDelete: false }));
vi.mock("@/lib/draw/guard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/draw/guard")>();
  return {
    ...orig,
    deleteUnplayed: async (...a: Parameters<typeof orig.deleteUnplayed>) => {
      if (guardRace.changeBeforeDelete) {
        guardRace.changeBeforeDelete = false;
        throw new orig.DrawChanged();
      }
      return orig.deleteUnplayed(...a);
    },
  };
});

const dir = path.join(os.tmpdir(), `rise-clear-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let manage: typeof import("./actions");
let score: typeof import("../actions");
let clear: typeof import("@/lib/results/clear");
let guard: typeof import("@/lib/draw/guard");
let state: typeof import("@/lib/tournamentState");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;
let inArray: typeof import("drizzle-orm").inArray;

const owner = randomUUID();
let phoneSeq = 0;

type Event = { id: string; slug: string; divisionId: string; teamIds: string[]; personIds: string[] };

/** An event with one category of men's pairs, each player linked to a person
    seeded by the organiser at 1000, so every result moves real ratings. */
async function event(o: { teams?: number; shape?: "groups_ko" | "single_elim"; slug?: string } = {}): Promise<Event> {
  const id = randomUUID();
  const slug = o.slug ?? `cl-${id.slice(0, 8)}`;
  await db.insert(schema.tournaments).values({
    id, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "live",
    minTeamSize: 2, maxTeamSize: 2,
  });
  const divisionId = randomUUID();
  await db.insert(schema.divisions).values({
    id: divisionId, tournamentId: id, name: "Main", shape: o.shape ?? "groups_ko", genderRule: "M",
  });
  const teamIds: string[] = [];
  const personIds: string[] = [];
  for (let i = 0; i < (o.teams ?? 4); i++) {
    const teamId = randomUUID();
    teamIds.push(teamId);
    await db.insert(schema.teams).values({ id: teamId, tournamentId: id, divisionId, name: `T${i + 1}`, seed: i + 1 });
    for (let k = 0; k < 2; k++) {
      const personId = randomUUID();
      personIds.push(personId);
      await db.insert(schema.people).values({
        id: personId, name: `${slug}-${i}${k}`, gender: "M", riseRatings: { "pb:md": 1000 }, riseBest: 1000,
        matchCount: {}, seedSource: "organiser",
      });
      await db.insert(schema.players).values({
        id: randomUUID(), tournamentId: id, teamId, personId, name: `${slug}-${i}${k}`, gender: "M", ratings: { "pb:md": 1000 },
      });
    }
  }
  return { id, slug, divisionId, teamIds, personIds };
}

const form = (fields: Record<string, string | number | null | undefined>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) if (v !== null && v !== undefined) f.set(k, String(v));
  return f;
};

/** Where an action redirected to, or null when it finished without one. */
async function landed(p: Promise<unknown>): Promise<URLSearchParams | null> {
  try {
    await p;
    return null;
  } catch (e) {
    if (!(e instanceof Error) || !e.message.startsWith("REDIRECT ")) throw e;
    return new URL(e.message.slice(9), "http://x").searchParams;
  }
}
const problemOf = async (p: Promise<unknown>) => (await landed(p))?.get("problem") ?? null;

const stored = async (id: string) => (await db.select().from(schema.matches).where(eq(schema.matches.id, id)))[0];
const matchesOf = (divisionId: string) => db.select().from(schema.matches).where(eq(schema.matches.divisionId, divisionId));
const history = (matchId: string) => db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, matchId));
const round = async (divisionId: string, label: string) => (await matchesOf(divisionId)).find((m) => m.round === label)!;
async function groupFixtures(divisionId: string, key: string) {
  const [g] = await db.select().from(schema.groups).where(eq(schema.groups.divisionId, divisionId))
    .then((gs) => gs.filter((x) => x.key === key));
  return (await matchesOf(divisionId)).filter((m) => m.groupId === g.id);
}

/** Everything a rating writes onto a person. A match count of nought and no
    count at all are the same thing to every reader (`formatRating`,
    `seedToRefile`), and a revert leaves the former where a fresh person has
    the latter, so noughts are dropped before comparing. */
async function peopleState(ids: string[]) {
  const rows = await db.select().from(schema.people).where(inArray(schema.people.id, ids));
  return Object.fromEntries(rows.map((p) => [p.id, {
    riseRatings: p.riseRatings,
    riseBest: p.riseBest,
    matchCount: Object.fromEntries(Object.entries(p.matchCount ?? {}).filter(([, n]) => n !== 0)),
    partnerStats: p.partnerStats,
    lastPlayedAt: p.lastPlayedAt ? p.lastPlayedAt.toISOString() : null,
    flags: p.flags,
    reliability: p.reliability,
  }]));
}

/* ── The organiser's and the referee's taps ──────────────────────────────── */

async function drawGroups(t: Event, groups: number) {
  const rows = await matchesOf(t.divisionId);
  const replaced = rows.filter((m) => m.groupId !== null || m.bracket !== null).map((m) => m.id);
  expect(await problemOf(manage.generateGroups(t.id, form({ divisionId: t.divisionId, groups, confirm: guard.drawSignature(replaced) }))))
    .toBeNull();
}
async function drawKnockout(t: Event, qualify: number) {
  const rows = await matchesOf(t.divisionId);
  const replaced = rows.filter((m) => m.bracket !== null).map((m) => m.id);
  expect(await problemOf(manage.generateKnockout(t.id, form({ divisionId: t.divisionId, qualify, confirm: guard.drawSignature(replaced) }))))
    .toBeNull();
}
/** A result typed in, rated after its commit as every save is. */
async function play(matchId: string, a = 11, b = 5) {
  const m = await stored(matchId);
  expect(await score.recordResult(matchId, { a, b, expectedRev: m.rev })).toMatchObject({ ok: true });
}
/** Rallies from a referee's phone: the match is being played. */
async function rallies(matchId: string, log: ("a" | "b")[]) {
  const m = await stored(matchId);
  expect(await score.pushLog(matchId, log, m.rev)).toMatchObject({ ok: true });
}
const fill = (t: Event) => manage.fillKnockoutSlots(t.id);

/** "Clear result…" / "Reset to 0–0…", second tap, carrying the rev the page showed. */
async function clearIt(t: Event, matchId: string, token?: number | null) {
  const rev = token === undefined ? (await stored(matchId)).rev : token;
  return landed(manage.clearResult(t.id, matchId, form({ confirm: rev })));
}
/** "Delete match…", second tap. */
async function removeIt(t: Event, matchId: string, token?: number | null) {
  const rev = token === undefined ? (await stored(matchId)).rev : token;
  return problemOf(manage.removeMatch(t.id, matchId, form({ confirm: rev })));
}
/** The fingerprint the manage page puts on "Start this category again". */
async function restartToken(t: Event, divisionId = t.divisionId) {
  const [tour] = await db.select().from(schema.tournaments).where(eq(schema.tournaments.id, t.id));
  const rows = await matchesOf(divisionId);
  const locked = await guard.lockedIds(rows);
  return clear.restartSignature(tour, rows.filter((m) => locked.has(m.id)));
}
async function restart(t: Event, o: { divisionId?: string; token?: string | null; name?: string } = {}) {
  const divisionId = o.divisionId ?? t.divisionId;
  const token = o.token === undefined ? await restartToken(t, divisionId) : o.token;
  return landed(manage.startCategoryAgain(t.id, form({ divisionId, confirm: token, name: o.name ?? "Main" })));
}

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  manage = await import("./actions");
  score = await import("../actions");
  clear = await import("@/lib/results/clear");
  guard = await import("@/lib/draw/guard");
  state = await import("@/lib/tournamentState");
  ({ eq, inArray } = await import("drizzle-orm"));

  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrations, f), "utf8").split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }
  await db.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });
}, 120_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

/* ── Clear result / Reset to 0–0 ─────────────────────────────────────────── */

describe("clearing a result", () => {
  it("takes every rating change back, exactly, and the match can then be deleted", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    const before = await peopleState(t.personIds);
    await play(m.id, 11, 7);
    expect(await history(m.id)).toHaveLength(4);
    const played = await stored(m.id);
    expect(played.rules).not.toBeNull();

    const url = await clearIt(t, m.id);
    expect(url?.get("problem")).toBeNull();
    expect(url?.get("done")).toBe("cleared");
    expect(url?.get("match")).toBe(m.id);

    expect(await history(m.id)).toHaveLength(0);
    expect(await peopleState(t.personIds)).toEqual(before);
    const after = await stored(m.id);
    expect([after.log, after.typedScoreA, after.typedScoreB, after.outcome, after.sets, after.timing, after.rules])
      .toEqual([[], null, null, null, null, null, null]);
    expect(after.rev).toBe(played.rev + 1);
    expect(after.resetRev).toBe(after.rev);
    /* What a clear keeps: who plays, where and when. */
    expect([after.teamAId, after.teamBId, after.lineupA, after.groupId]).toEqual([played.teamAId, played.teamBId, played.lineupA, played.groupId]);

    expect(await removeIt(t, m.id)).toBeNull();
    expect(await stored(m.id)).toBeUndefined();
  });

  it("resets a match being played to 0–0", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await rallies(m.id, ["a", "b"]);
    const live = await stored(m.id);

    expect((await clearIt(t, m.id))?.get("done")).toBe("cleared");
    const after = await stored(m.id);
    expect(after.log).toEqual([]);
    expect([after.rev, after.resetRev]).toEqual([live.rev + 1, live.rev + 1]);
  });

  it("clears a walkover", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    expect(await score.recordResult(m.id, { a: 11, b: 0, outcome: "walkover", expectedRev: 0 })).toMatchObject({ ok: true });
    expect((await clearIt(t, m.id))?.get("done")).toBe("cleared");
    const after = await stored(m.id);
    expect([after.typedScoreA, after.typedScoreB, after.outcome]).toEqual([null, null, null]);
  });

  it("is refused from a page that saw the match before it changed, and changes nothing", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id, 11, 7); // rev 1
    await play(m.id, 11, 9); // corrected on another device: rev 2
    expect((await clearIt(t, m.id, 1))?.get("problem")).toBe("clear-stale");
    const after = await stored(m.id);
    expect([after.typedScoreA, after.typedScoreB, after.rev, after.resetRev]).toEqual([11, 9, 2, 0]);
    expect(await history(m.id)).toHaveLength(4);
  });

  /* A retry after a lost reply, or two organisers pressing it at once: the
     clear has happened, so it is done — and play after it is left alone. */
  it("answers done when the clear it asks for has already happened, and touches nothing after it", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    const token = (await stored(m.id)).rev;
    expect((await clearIt(t, m.id, token))?.get("done")).toBe("cleared");
    await rallies(m.id, ["a"]); // play starts again after the clear
    const restarted = await stored(m.id);

    expect((await clearIt(t, m.id, token))?.get("done")).toBe("already");
    const after = await stored(m.id);
    expect([after.log, after.rev, after.resetRev]).toEqual([["a"], restarted.rev, restarted.resetRev]);
  });

  /* A match with nothing on it is reset whatever the page saw: harmless at
     0–0, and it fences off every phone, which is what the organiser pressed
     for. */
  it("resets a match that has nothing on it even from an older page", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await rallies(m.id, ["a"]);
    const token = (await stored(m.id)).rev; // the page showed 1–0
    expect(await score.pushLog(m.id, [], token)).toMatchObject({ ok: true }); // undone back to nothing
    const empty = await stored(m.id);
    expect((await clearIt(t, m.id, token))?.get("done")).toBe("cleared");
    const after = await stored(m.id);
    expect([after.rev, after.resetRev]).toEqual([empty.rev + 1, empty.rev + 1]);
  });

  it("needs the page's confirmation", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    expect((await clearIt(t, m.id, null))?.get("problem")).toBe("match-confirm");
    expect((await stored(m.id)).typedScoreA).toBe(11);
  });

  it("is the organiser's alone: a referee with a PIN may type over a result but not clear it", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    who.pin = true;
    try {
      await expect(clearIt(t, m.id)).rejects.toThrow(/Not allowed/);
      expect((await stored(m.id)).typedScoreA).toBe(11);
      expect(await score.recordResult(m.id, { a: 11, b: 9, expectedRev: (await stored(m.id)).rev })).toMatchObject({ ok: true });
    } finally {
      who.pin = false;
    }
    expect((await stored(m.id)).typedScoreB).toBe(9);
  });

  /* The organiser clears a result in the moment between it being saved and
     its rating being applied. The rating must not land on a cleared match. */
  it("stops a rating that was about to be applied to the result it cleared", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    const before = await peopleState(t.personIds);
    race.beforeRefile = async () => {
      expect((await clearIt(t, m.id, 1))?.get("done")).toBe("cleared");
    };
    await score.recordResult(m.id, { a: 11, b: 4, expectedRev: 0 });
    expect(race.beforeRefile).toBeNull(); // the seam ran
    expect(await history(m.id)).toHaveLength(0);
    expect(await peopleState(t.personIds)).toEqual(before);
    expect((await stored(m.id)).typedScoreA).toBeNull();
  });
});

describe("a clear that would change who is in a match already under way", () => {
  /** Two groups of two, the top two of each through to semi-finals. */
  async function knockout() {
    const t = await event();
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    const [a] = await groupFixtures(t.divisionId, "A");
    const [b] = await groupFixtures(t.divisionId, "B");
    return { t, a, b };
  }

  it("is refused while a semi-final fed by the group has started, and the group's result stands", async () => {
    const { t, a, b } = await knockout();
    await play(a.id);
    await play(b.id);
    await fill(t);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    expect([sf1.teamAId, sf1.teamBId].every(Boolean)).toBe(true);
    await rallies(sf1.id, ["a"]);

    expect((await clearIt(t, a.id))?.get("problem")).toBe("clear-blocked");
    expect((await stored(a.id)).typedScoreA).toBe(11);
    expect(await history(a.id)).toHaveLength(4);
  });

  it("is refused while the Final has a result, or has started", async () => {
    const { t, a, b } = await knockout();
    await play(a.id);
    await play(b.id);
    await fill(t);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    const sf2 = await round(t.divisionId, "Semi-Final 2");
    await play(sf1.id);
    await play(sf2.id);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    await rallies(final.id, ["b"]);
    expect((await clearIt(t, sf1.id))?.get("problem")).toBe("clear-blocked");
    expect(await score.recordResult(final.id, { a: 11, b: 5, expectedRev: (await stored(final.id)).rev, replaceLive: true }))
      .toMatchObject({ ok: true });
    expect((await clearIt(t, sf1.id))?.get("problem")).toBe("clear-blocked");
    expect((await stored(sf1.id)).typedScoreA).toBe(11);
  });

  it("empties a side the result had filled, while that match has not started", async () => {
    const { t, a, b } = await knockout();
    await play(a.id);
    await play(b.id);
    await fill(t);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    const sf2 = await round(t.divisionId, "Semi-Final 2");
    const sideFromA = (sf: typeof sf1) => (sf.slotA?.startsWith("A") ? "a" : "b");

    revalidated.length = 0;
    expect((await clearIt(t, a.id))?.get("done")).toBe("cleared");
    for (const [before, after] of [[sf1, await stored(sf1.id)], [sf2, await stored(sf2.id)]] as const) {
      const emptied = sideFromA(before);
      const kept = emptied === "a" ? "b" : "a";
      expect(after[emptied === "a" ? "teamAId" : "teamBId"]).toBeNull();
      expect(after[emptied === "a" ? "lineupA" : "lineupB"]).toEqual([]);
      expect(after[kept === "a" ? "teamAId" : "teamBId"]).toBe(before[kept === "a" ? "teamAId" : "teamBId"]);
      /* A phone that queued rallies for the old pairing cannot land them on
         whoever is filled in next. */
      expect([after.rev, after.resetRev]).toEqual([before.rev + 1, before.rev + 1]);
      expect(revalidated).toContain(`/t/${t.slug}/score/${after.id}`);
    }
  });

  /* A one-group knockout: the Final is A1 v A2, both sides fed by one group. */
  it("empties both sides of a match fed twice by the same group", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    await drawKnockout(t, 2);
    const [g] = await groupFixtures(t.divisionId, "A");
    await play(g.id);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    expect([final.teamAId, final.teamBId].every(Boolean)).toBe(true);
    expect((await clearIt(t, g.id))?.get("done")).toBe("cleared");
    const after = await stored(final.id);
    expect([after.teamAId, after.teamBId]).toEqual([null, null]);
    expect(after.resetRev).toBe(after.rev);
  });

  /* Only the DRAWN Semi-Final 1 feeds the Final; a match typed in by hand
     under the same name feeds nothing (rowsByLabel). */
  it("is not refused for a hand-added match that shares a drawn match's name", async () => {
    const { t, a, b } = await knockout();
    await play(a.id);
    await play(b.id);
    await fill(t);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    await rallies(sf1.id, ["a"]);
    await manage.addMatch(t.id, form({ round: "Semi-Final 1", teamA: t.teamIds[0], teamB: t.teamIds[1] }));
    const copy = (await matchesOf(t.divisionId)).find((m) => m.round === "Semi-Final 1" && m.bracket === null)!;
    await play(copy.id);
    /* The final waits on the drawn one, which has started… */
    const final = await round(t.divisionId, "Final");
    await db.update(schema.matches).set({ teamAId: t.teamIds[0], teamBId: t.teamIds[2] }).where(eq(schema.matches.id, final.id));
    await rallies(final.id, ["a"]);
    expect((await clearIt(t, sf1.id))?.get("problem")).toBe("clear-blocked");
    /* …and the hand-added one has nothing waiting on it. */
    expect((await clearIt(t, copy.id))?.get("done")).toBe("cleared");
  });
});

/* ── Delete match ────────────────────────────────────────────────────────── */

describe("deleting a match", () => {
  it("is refused once it has a result, and the record of its rating survives", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    expect(await removeIt(t, m.id)).toBe("match-played");
    expect(await stored(m.id)).toBeDefined();
    expect(await history(m.id)).toHaveLength(4);
  });

  it("is refused while it is being played", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await rallies(m.id, ["a"]);
    expect(await removeIt(t, m.id)).toBe("match-started");
    expect((await stored(m.id)).log).toEqual(["a"]);
  });

  /* An old bug could leave rating history behind a match with no score. It is
     refused like a played match — never a database error. */
  it("is refused for a match with a rating and no score", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    await db.update(schema.matches).set({ typedScoreA: null, typedScoreB: null }).where(eq(schema.matches.id, m.id));
    expect(await removeIt(t, m.id)).toBe("match-played");
    expect(await stored(m.id)).toBeDefined();
  });

  it("is refused for a semi-final the Final waits on", async () => {
    const t = await event();
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    expect(await removeIt(t, sf1.id)).toBe("match-feeds");
    expect(await stored(sf1.id)).toBeDefined();
  });

  it("needs the page's confirmation, from a page that saw the match as it is", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    expect(await removeIt(t, m.id, null)).toBe("match-confirm");
    await rallies(m.id, ["a"]);
    expect(await score.pushLog(m.id, [], 1)).toMatchObject({ ok: true }); // back to nothing, rev 2
    expect(await removeIt(t, m.id, 0)).toBe("match-stale");
    expect(await stored(m.id)).toBeDefined();
    expect(await removeIt(t, m.id, 2)).toBeNull();
    expect(await stored(m.id)).toBeUndefined();
  });

  /* A group fixture can go while every pair keeps a match: the group still
     finishes on the ones that were played. */
  it("takes a group fixture with others played, and the group then finishes", async () => {
    const t = await event({ teams: 3 });
    await drawGroups(t, 1);
    await drawKnockout(t, 2);
    const fixtures = await groupFixtures(t.divisionId, "A");
    expect(fixtures).toHaveLength(3);
    await play(fixtures[0].id);
    await play(fixtures[1].id);
    expect(await removeIt(t, fixtures[2].id)).toBeNull();
    const loaded = await state.loadTournament(t.slug);
    const [table] = state.groupTables(loaded!);
    expect(table.complete).toBe(true);
  });

  it("is refused for a group's only fixture", async () => {
    const t = await event();
    await drawGroups(t, 2);
    const [only] = await groupFixtures(t.divisionId, "A");
    expect(await removeIt(t, only.id)).toBe("group-short");
    expect(await stored(only.id)).toBeDefined();
  });

  /* The table is the group's MEMBERS (step 8b), so taking a pair's last
     match would leave them in it at nought played — ranked above pairs who
     played and lost, and able to qualify without playing. Deleting fixtures
     one at a time used to be how a pair that pulled out was dropped; that is
     "Remove the pair" now, or walkovers. */
  it("is refused for a pair's last match in the group", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 1);
    await drawKnockout(t, 4);
    const last = t.teamIds[3];
    const theirs = (await groupFixtures(t.divisionId, "A")).filter((m) => m.teamAId === last || m.teamBId === last);
    expect(theirs).toHaveLength(3);
    expect(await removeIt(t, theirs[0].id)).toBeNull();
    expect(await removeIt(t, theirs[1].id)).toBeNull();
    expect(await removeIt(t, theirs[2].id)).toBe("pair-stranded");
    expect(await stored(theirs[2].id)).toBeDefined();
    const [table] = state.groupTables((await state.loadTournament(t.slug))!);
    expect(table.rows.map((r) => r.teamId)).toContain(last);
  });

  it("says the match changed when a result lands between its check and the delete", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    guardRace.changeBeforeDelete = true;
    expect(await removeIt(t, m.id)).toBe("match-changed");
    expect(await stored(m.id)).toBeDefined();
  });

  /* RESTRICT (migration 0022) is the last line: whatever path forgets to ask,
     the database will not delete a match with rating history. */
  it("cannot be done behind the action's back either: the database refuses it", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    await expect(db.delete(schema.matches).where(eq(schema.matches.id, m.id))).rejects.toThrow();
    expect(await history(m.id)).toHaveLength(4);
  });
});

/* ── Start this category again ───────────────────────────────────────────── */

describe("starting a category again", () => {
  /** Groups played and rated, semi-finals filled and rated, the Final filled
      and unplayed — and one group match being played when the organiser
      presses it. */
  async function playedOut() {
    const t = await event({ teams: 6 });
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    const before = await peopleState(t.personIds);
    const rowsBefore = await matchesOf(t.divisionId);
    const [a1, a2, a3] = await groupFixtures(t.divisionId, "A");
    const [b1, b2, b3] = await groupFixtures(t.divisionId, "B");
    for (const m of [a1, a2, a3, b1, b2]) await play(m.id);
    await play(b3.id, 4, 11);
    await fill(t);
    await play((await round(t.divisionId, "Semi-Final 1")).id);
    await play((await round(t.divisionId, "Semi-Final 2")).id, 9, 11);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    expect([final.teamAId, final.teamBId].every(Boolean)).toBe(true);
    return { t, before, rowsBefore };
  }

  it("clears every result, takes every rating change back, and keeps the draw", async () => {
    const { t, before, rowsBefore } = await playedOut();
    const revs = new Map((await matchesOf(t.divisionId)).map((m) => [m.id, m.rev]));
    revalidated.length = 0;

    const url = await restart(t);
    expect(url?.get("problem")).toBeNull();
    expect(url?.get("done")).toBe("restarted");

    const after = await matchesOf(t.divisionId);
    expect(after.map((m) => m.id).sort()).toEqual(rowsBefore.map((m) => m.id).sort());
    for (const m of after) {
      expect([m.log, m.typedScoreA, m.typedScoreB, m.outcome, m.sets, m.timing, m.rules], m.round)
        .toEqual([[], null, null, null, null, null, null]);
      expect(m.rev, m.round).toBe(revs.get(m.id)! + 1);
      expect(m.resetRev, m.round).toBe(m.rev);
      const was = rowsBefore.find((x) => x.id === m.id)!;
      /* A group fixture keeps its pair; a slotted side goes back to its slot. */
      expect([m.teamAId, m.teamBId], m.round).toEqual([m.slotA ? null : was.teamAId, m.slotB ? null : was.teamBId]);
      expect(revalidated).toContain(`/t/${t.slug}/score/${m.id}`);
    }
    const ids = after.map((m) => m.id);
    expect(await db.select().from(schema.ratingHistory).where(inArray(schema.ratingHistory.matchId, ids))).toHaveLength(0);
    expect(await peopleState(t.personIds)).toEqual(before);
  });

  /* A live match's rev moves with every rally on its court; signed by rev the
     button would be stale within seconds on a busy day and never get through.
     And the match being played is reset too (Faisal). */
  it("resets a match being played, and is not made stale by its rallies", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m1, m2] = await matchesOf(t.divisionId);
    await play(m1.id);
    await rallies(m2.id, ["a"]);
    const token = await restartToken(t);
    await rallies(m2.id, ["a", "b"]);
    const live = await stored(m2.id);
    expect((await restart(t, { token }))?.get("done")).toBe("restarted");
    const after = await stored(m2.id);
    expect(after.log).toEqual([]);
    expect([after.rev, after.resetRev]).toEqual([live.rev + 1, live.rev + 1]);
  });

  it("is refused from a page that saw a different set of results", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m1, m2] = await matchesOf(t.divisionId);
    await play(m1.id);
    const token = await restartToken(t);
    await play(m2.id); // another result since the page was opened
    expect((await restart(t, { token }))?.get("problem")).toBe("restart-stale");
    await play(m1.id, 11, 9); // a correction since
    expect((await restart(t, { token: await restartToken(t) }))?.get("done")).toBe("restarted");
  });

  it("needs the confirmation and the category's name typed in", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    expect((await restart(t, { token: null }))?.get("problem")).toBe("restart-confirm");
    expect((await restart(t, { name: "Mian" }))?.get("problem")).toBe("restart-name");
    expect((await restart(t, { name: "" }))?.get("problem")).toBe("restart-name");
    expect((await stored(m.id)).typedScoreA).toBe(11);
    /* Case and spaces around it do not matter. */
    expect((await restart(t, { name: "  main " }))?.get("done")).toBe("restarted");
  });

  it("refuses a category of another event, and one with nothing to clear", async () => {
    const t = await event();
    const other = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    expect((await restart(t, { divisionId: other.divisionId }))?.get("problem")).toBe("restart-gone");
    expect((await stored(m.id)).typedScoreA).toBe(11);
    await drawGroups(other, 1);
    expect((await restart(other))?.get("problem")).toBe("restart-empty");
  });

  /* Restart, then redraw, is the way to redraw a category that was played. */
  it("lets the category be drawn again afterwards", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    const replaced = (await matchesOf(t.divisionId)).map((x) => x.id);
    expect(await problemOf(manage.generateGroups(t.id, form({ divisionId: t.divisionId, groups: 2, confirm: guard.drawSignature(replaced) }))))
      .toBe("draw-locked");
    expect((await restart(t))?.get("done")).toBe("restarted");
    await drawGroups(t, 2);
    expect(await matchesOf(t.divisionId)).toHaveLength(2);
  });

  it("keeps a side a bye put through", async () => {
    const t = await event({ teams: 3, shape: "single_elim" });
    const replaced: string[] = [];
    expect(await problemOf(manage.generateSingleElim(t.id, form({ divisionId: t.divisionId, confirm: guard.drawSignature(replaced) }))))
      .toBeNull();
    const rows = await matchesOf(t.divisionId);
    const first = rows.find((m) => m.teamAId && m.teamBId)!;
    const bye = rows.find((m) => (m.teamAId === null) !== (m.teamBId === null))!;
    expect(bye).toBeDefined();
    await play(first.id);
    await fill(t);
    expect((await restart(t))?.get("done")).toBe("restarted");
    const after = await stored(bye.id);
    const kept = bye.teamAId ? "teamAId" : "teamBId";
    expect(after[kept]).toBe(bye[kept]);
    expect(after[kept === "teamAId" ? "teamBId" : "teamAId"]).toBeNull();
  });

  /* One person in Men's Doubles AND Mixed: restarting Mixed takes back their
     mixed rating and leaves their men's doubles exactly where it is. */
  it("takes back only its own category's ratings from a player entered in two", async () => {
    const id = randomUUID();
    const slug = `two-${id.slice(0, 8)}`;
    await db.insert(schema.tournaments).values({
      id, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "live", minTeamSize: 2, maxTeamSize: 2,
    });
    const md = randomUUID();
    const mx = randomUUID();
    await db.insert(schema.divisions).values([
      { id: md, tournamentId: id, name: "Men's Doubles", genderRule: "M" },
      { id: mx, tournamentId: id, name: "Mixed", genderRule: "MX" },
    ]);
    const mk = async (gender: "M" | "F") => {
      const pid = randomUUID();
      await db.insert(schema.people).values({
        id: pid, name: `${slug}-${pid.slice(0, 4)}`, gender, riseRatings: { [gender === "M" ? "pb:md" : "pb:wd"]: 1000 },
        riseBest: 1000, matchCount: {}, seedSource: "organiser",
      });
      return pid;
    };
    const both = await mk("M");
    const team = async (divisionId: string, name: string, members: [string, "M" | "F"][]) => {
      const teamId = randomUUID();
      await db.insert(schema.teams).values({ id: teamId, tournamentId: id, divisionId, name, seed: 1 });
      for (const [pid, g] of members) {
        await db.insert(schema.players).values({ id: randomUUID(), tournamentId: id, teamId, personId: pid, name: pid.slice(0, 4), gender: g, ratings: {} });
      }
      return teamId;
    };
    const mdA = await team(md, "MD-A", [[both, "M"], [await mk("M"), "M"]]);
    const mdB = await team(md, "MD-B", [[await mk("M"), "M"], [await mk("M"), "M"]]);
    const mxA = await team(mx, "MX-A", [[both, "M"], [await mk("F"), "F"]]);
    const mxB = await team(mx, "MX-B", [[await mk("M"), "M"], [await mk("F"), "F"]]);
    const t: Event = { id, slug, divisionId: mx, teamIds: [], personIds: [both] };
    await manage.addMatch(id, form({ round: "MD", teamA: mdA, teamB: mdB }));
    await manage.addMatch(id, form({ round: "MX", teamA: mxA, teamB: mxB }));
    const mdMatch = (await matchesOf(md))[0];
    const mxMatch = (await matchesOf(mx))[0];
    await play(mdMatch.id);
    const afterMd = await peopleState([both]);
    await play(mxMatch.id);
    expect(Object.keys((await peopleState([both]))[both].riseRatings).sort()).toEqual(["pb:md", "pb:mx"]);

    expect((await restart(t, { divisionId: mx, name: "Mixed" }))?.get("done")).toBe("restarted");
    /* "Last played" becomes the men's doubles match's own record — stamped
       by the database a moment after the apply's clock, so it is compared
       with that rather than with the apply's. */
    const now = (await peopleState([both]))[both];
    expect({ ...now, lastPlayedAt: null }).toEqual({ ...afterMd[both], lastPlayedAt: null });
    const { lastPlayedAt } = now;
    const [mdRow] = (await history(mdMatch.id)).filter((r) => r.personId === both);
    expect(lastPlayedAt).toBe(mdRow.createdAt.toISOString());
    expect(await history(mdMatch.id)).toHaveLength(4);
    expect((await stored(mdMatch.id)).typedScoreA).toBe(11);
  });

  /* A player whose starting level was filed under a guess and moved when their
     partner arrived (refileSeeds) ends where they were just before the first
     match was rated — the move is kept, the matches are not. */
  it("puts a player whose seed was refiled back where they stood before the first match", async () => {
    const id = randomUUID();
    const slug = `refile-${id.slice(0, 8)}`;
    await db.insert(schema.tournaments).values({
      id, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "live", minTeamSize: 1, maxTeamSize: 2,
    });
    const divisionId = randomUUID();
    await db.insert(schema.divisions).values({ id: divisionId, tournamentId: id, name: "Main" });
    const teamIds = [randomUUID(), randomUUID()];
    await db.insert(schema.teams).values(teamIds.map((tid, i) => ({ id: tid, tournamentId: id, divisionId, name: `R${i}`, seed: i + 1 })));
    const add = async (teamId: string, name: string, gender: "M" | "F", band: number) => {
      const res = await manage.addPlayer(id, teamId, form({ name, gender, band, phone: `91234${String(++phoneSeq).padStart(5, "0")}` }));
      expect(res.ok).toBe(true);
      return (await db.select().from(schema.players).where(eq(schema.players.name, name)))[0].personId!;
    };
    /* The first player is a team of one: filed as singles, then moved to
       mixed when her partner arrives. */
    const cy = await add(teamIds[0], `${slug}-Cy`, "F", 1000);
    expect(Object.keys((await peopleState([cy]))[cy].riseRatings)).toEqual(["pb:ws"]);
    const folk = [cy, await add(teamIds[0], `${slug}-Dev`, "M", 900), await add(teamIds[1], `${slug}-Eli`, "F", 950), await add(teamIds[1], `${slug}-Fin`, "M", 1000)];
    expect(Object.keys((await peopleState([cy]))[cy].riseRatings)).toEqual(["pb:mx"]);

    const before = await peopleState(folk);
    await manage.addMatch(id, form({ round: "R1", teamA: teamIds[0], teamB: teamIds[1] }));
    const [m] = await matchesOf(divisionId);
    await play(m.id);
    expect(await peopleState(folk)).not.toEqual(before);
    const t: Event = { id, slug, divisionId, teamIds, personIds: folk };
    expect((await restart(t))?.get("done")).toBe("restarted");
    expect(await peopleState(folk)).toEqual(before);
  });
});

/* ── Round one of step 8's review ───────────────────────────────────────── */

describe("what the organiser is told", () => {
  /* A clear that had already happened — another page, or a retry — leaves
     whatever was played since alone (A7). The page used to say the match was
     "back to not played" beside a row showing the new result. */
  it("says a clear had already happened, rather than claiming it cleared the result played since", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id, 11, 7);
    const token = (await stored(m.id)).rev;
    expect((await clearIt(t, m.id, token))?.get("done")).toBe("cleared");
    await play(m.id, 11, 2);
    const url = await clearIt(t, m.id, token);
    expect(url?.get("done")).toBe("already");
    expect(url?.get("problem")).toBeNull();
    const after = await stored(m.id);
    expect([after.typedScoreA, after.typedScoreB]).toEqual([11, 2]);
    expect(await history(m.id)).toHaveLength(4);
  });

  it("names a category removed since the page was opened as gone, not as a draw problem", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    const token = await restartToken(t);
    await db.delete(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, m.id));
    await db.delete(schema.matches).where(eq(schema.matches.divisionId, t.divisionId));
    await db.delete(schema.groups).where(eq(schema.groups.divisionId, t.divisionId));
    await db.delete(schema.players).where(eq(schema.players.tournamentId, t.id));
    await db.delete(schema.teams).where(eq(schema.teams.divisionId, t.divisionId));
    await db.delete(schema.divisions).where(eq(schema.divisions.id, t.divisionId));
    expect((await restart(t, { token }))?.get("problem")).toBe("restart-gone");
  });
});

describe("the category's name, typed to confirm", () => {
  /* "Men’s" is what the Men's starting point names a category — with a curly
     apostrophe no laptop or Android keyboard types. */
  it("is the same name whichever apostrophe the keyboard types", async () => {
    const t = await event();
    await db.update(schema.divisions).set({ name: "Men’s" }).where(eq(schema.divisions.id, t.divisionId));
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id);
    expect((await restart(t, { name: "men's" }))?.get("done")).toBe("restarted");
  });

  it("forgives case, spacing and the shape of a quote — and nothing else", async () => {
    const { sameCategoryName } = await import("./sameName");
    expect(sameCategoryName("Men's", "Men’s")).toBe(true);
    expect(sameCategoryName("men’s", "Men's")).toBe(true);
    expect(sameCategoryName("  mixed   doubles ", "Mixed Doubles")).toBe(true);
    expect(sameCategoryName("“Open”", "\"Open\"")).toBe(true);
    /* Two that NFKC takes apart before they could be folded: an acute accent
       typed as an apostrophe, and a double prime. */
    expect(sameCategoryName("Men's Doubles", "Men´s Doubles")).toBe(true);
    expect(sameCategoryName('6" Open', "6″ Open")).toBe(true);
    expect(sameCategoryName("Mens", "Men’s")).toBe(false);
    expect(sameCategoryName("Mixed", "Mixed Doubles")).toBe(false);
    expect(sameCategoryName("", "")).toBe(false);
    expect(sameCategoryName("   ", " ")).toBe(false);
  });
});

describe("the fingerprint a restart carries", () => {
  /* A finished match is signed by its rev, so a correction since the page was
     opened is a change; a live match by its id alone, so its rallies are not —
     but its FINISHING is. A fingerprint over ids alone passed everything. */
  it("is stale after a correction, and after a live match finishes", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m1, m2] = await matchesOf(t.divisionId);
    await play(m1.id, 11, 5);
    await rallies(m2.id, ["a"]);
    const token = await restartToken(t);
    await play(m1.id, 11, 9);
    expect((await restart(t, { token }))?.get("problem")).toBe("restart-stale");

    const second = await restartToken(t);
    expect(await score.recordResult(m2.id, { a: 11, b: 4, expectedRev: (await stored(m2.id)).rev, replaceLive: true }))
      .toMatchObject({ ok: true });
    expect((await restart(t, { token: second }))?.get("problem")).toBe("restart-stale");
    expect((await stored(m1.id)).typedScoreB).toBe(9);
  });
});

/* ── The words on the manage page (round two of step 8's review) ─────────────
 * Round one's findings were about what the page SAYS, and nothing read it: the
 * codes in the address were right while the sentences beside them were not.
 * The page is a server component, so it can be called with its params and its
 * element tree read — no browser needed. Client components are not run; their
 * props are what the page handed them. */

type El = { type: unknown; props: Record<string, unknown> };
const isEl = (n: unknown): n is El => !!n && typeof n === "object" && "props" in n && "type" in n;
function each(n: unknown, visit: (el: El) => void) {
  if (Array.isArray(n)) { for (const x of n) each(x, visit); return; }
  if (!isEl(n)) return;
  visit(n);
  each(n.props.children, visit);
}
function textOf(n: unknown): string {
  if (n == null || typeof n === "boolean") return "";
  if (typeof n === "string" || typeof n === "number") return String(n);
  if (Array.isArray(n)) return n.map(textOf).join("");
  return isEl(n) ? textOf(n.props.children) : "";
}
const named = (el: El) => (typeof el.type === "function" ? (el.type as { name?: string }).name : undefined);

async function manageText(slug: string, search: Record<string, string>) {
  const { default: Page } = await import("./page");
  const tree = await Page({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(search) });
  const notices: string[] = [];
  const locked = new Map<string, string>();
  const controls = new Map<string, string[]>();
  each(tree, (el) => {
    if (named(el) === "ProblemNotice") notices.push(String(el.props.text));
    const id = el.props["data-match"];
    if (typeof id === "string") {
      each(el.props.children, (inner) => {
        if (inner.props["data-row-locked"] !== undefined) locked.set(id, textOf(inner.props.children));
        if (named(inner) === "ConfirmButton") controls.set(id, [...(controls.get(id) ?? []), String(inner.props.label)]);
      });
    }
  });
  return { notices, locked, controls };
}

describe("what the manage page says", () => {
  /** Two groups of two, the top two of each through; Group A played and its
      side of Semi-Final 1 filled. */
  async function fed() {
    const t = await event();
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    const [a] = await groupFixtures(t.divisionId, "A");
    const [b] = await groupFixtures(t.divisionId, "B");
    await play(a.id);
    await play(b.id);
    await fill(t);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    return { t, a, sf1 };
  }

  it("names the control the waiting match's own row offers — Reset while it is played, Clear otherwise", async () => {
    const { t, a, sf1 } = await fed();
    await rallies(sf1.id, ["a"]);
    let page = await manageText(t.slug, {});
    expect(page.locked.get(a.id)).toContain("Semi-Final 1 has already started. Reset Semi-Final 1 first.");
    expect(page.controls.get(sf1.id)).toEqual(["Reset to 0–0…"]);

    expect(await score.recordResult(sf1.id, { a: 11, b: 4, expectedRev: (await stored(sf1.id)).rev, replaceLive: true }))
      .toMatchObject({ ok: true });
    page = await manageText(t.slug, {});
    expect(page.locked.get(a.id)).toContain("Semi-Final 1 has a result. Clear Semi-Final 1 first.");
    expect(page.controls.get(sf1.id)).toEqual(["Clear result…"]);

    /* An old bug's leftover: a rating on record and no score. Its own row
       offers Clear, so that is the word. */
    await db.update(schema.matches).set({ typedScoreA: null, typedScoreB: null }).where(eq(schema.matches.id, sf1.id));
    page = await manageText(t.slug, {});
    expect(page.locked.get(a.id)).toContain("Semi-Final 1 has a rating on record. Clear Semi-Final 1 first.");
    expect(page.controls.get(sf1.id)).toEqual(["Clear result…"]);
    const refusal = await manageText(t.slug, { problem: "clear-blocked", match: a.id });
    expect(refusal.notices.join(" ")).toContain("Semi-Final 1 has a rating on record. Clear Semi-Final 1 first.");
  });

  it("says nothing waits on a match any more when the one that did was cleared since", async () => {
    const { t, a, sf1 } = await fed();
    await play(sf1.id);
    expect((await clearIt(t, a.id))?.get("problem")).toBe("clear-blocked");
    expect((await clearIt(t, sf1.id))?.get("done")).toBe("cleared");
    const page = await manageText(t.slug, { problem: "clear-blocked", match: a.id });
    expect(page.notices.join(" ")).toContain("Nothing waits on it now: clear it again.");
  });

  it("says a clear had already happened, and whether the match was played again since", async () => {
    const t = await event();
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await play(m.id, 11, 7);
    const token = (await stored(m.id)).rev;
    await clearIt(t, m.id, token);
    expect((await clearIt(t, m.id, token))?.get("done")).toBe("already");
    let page = await manageText(t.slug, { done: "already", match: m.id });
    expect(page.notices.join(" ")).toContain("had already been cleared: it is back to not played");
    await play(m.id, 11, 2);
    page = await manageText(t.slug, { done: "already", match: m.id });
    expect(page.notices.join(" ")).toContain("had already been cleared, and has been played again since — nothing was changed now");
    page = await manageText(t.slug, { done: "cleared", match: m.id });
    expect(page.notices.join(" ")).toContain("is back to not played, and any rating changes it made were taken back");
  });

  it("says a category is gone, and that results changed — never that a score came in", async () => {
    const t = await event();
    await drawGroups(t, 1);
    let page = await manageText(t.slug, { problem: "restart-gone", category: "no-such-category" });
    expect(page.notices.join(" ")).toContain("That category is no longer part of this event — it was removed — so there was nothing to start again.");
    page = await manageText(t.slug, { problem: "restart-stale", category: t.divisionId });
    expect(page.notices.join(" ")).toContain("Main’s results changed since this page was opened");
    expect(page.notices.join(" ")).not.toContain("a score came in");
  });
});
