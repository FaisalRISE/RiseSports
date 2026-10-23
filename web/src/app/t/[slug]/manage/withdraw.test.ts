import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* A pair pulls out (step 8b), through the real actions against a real
 * database: a walkover, removing the pair altogether, and group membership —
 * which is what lets a pair left alone in a group still win it.
 *
 * What was wrong before, each pinned below:
 *   - there was no way to record a walkover: the match could only be deleted,
 *     which left the two pairs a match short in the table;
 *   - a pair that pulled out could only be dealt with by deleting their
 *     matches one at a time, and a played match could not be deleted at all;
 *   - a group's table was whoever appeared in its fixtures, so a pair left
 *     alone in a group of two had no table to win, and the group never
 *     finished;
 *   - "Fill resolved slots" read with no lock, and could write a pair removed a
 *     moment earlier into a knockout match;
 *   - a referee tapping on a match deleted under them was told the server had
 *     not answered, and to try again. */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
  headers: async () => new Headers({ host: "localhost" }),
}));
vi.mock("next/link", () => ({ default: (p: { children?: unknown }) => p.children }));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
  notFound: () => {},
}));
/* Who is calling — `pin` stands in for a referee holding only a scorer PIN.
   `between` runs ONCE inside the next authorisation: an action reads the event,
   then asks who is calling, then opens its transaction, so this lands exactly
   in the gap between an action's first read and its locks. */
const who = vi.hoisted(() => ({ pin: false, between: null as null | (() => Promise<unknown>) }));
vi.mock("@/lib/auth/guard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/guard")>();
  return {
    ...orig,
    principalFor: async (...a: Parameters<typeof orig.principalFor>) => {
      const run = who.between;
      who.between = null;
      if (run) await run();
      return who.pin ? { userId: null, role: null, hasScorerGrant: true, isOwner: false } : orig.principalFor(...a);
    },
  };
});
/* A result landing between the removal's check and its DELETE. */
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

const dir = path.join(os.tmpdir(), `rise-withdraw-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let manage: typeof import("./actions");
let score: typeof import("../actions");
let guard: typeof import("@/lib/draw/guard");
let state: typeof import("@/lib/tournamentState");
let placings: typeof import("@/lib/placings");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;
let inArray: typeof import("drizzle-orm").inArray;

const owner = randomUUID();

type Event = { id: string; slug: string; divisionId: string; teamIds: string[]; personIds: string[] };

/** An event with one category of men's pairs, each player linked to a person
    seeded by the organiser at 1000, so every result moves real ratings. */
async function event(o: { teams?: number; shape?: "groups_ko" | "single_elim" | "league" } = {}): Promise<Event> {
  const id = randomUUID();
  const slug = `wd-${id.slice(0, 8)}`;
  await db.insert(schema.tournaments).values({
    id, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "live", minTeamSize: 2, maxTeamSize: 2,
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
const teamRow = async (id: string) => (await db.select().from(schema.teams).where(eq(schema.teams.id, id)))[0];
const matchesOf = (divisionId: string) => db.select().from(schema.matches).where(eq(schema.matches.divisionId, divisionId));
const history = (matchId: string) => db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, matchId));
const round = async (divisionId: string, label: string) => (await matchesOf(divisionId)).find((m) => m.round === label)!;
async function groupOf(divisionId: string, key: string) {
  return (await db.select().from(schema.groups).where(eq(schema.groups.divisionId, divisionId))).find((g) => g.key === key)!;
}
async function groupFixtures(divisionId: string, key: string) {
  const g = await groupOf(divisionId, key);
  return (await matchesOf(divisionId)).filter((m) => m.groupId === g.id);
}
const between = <T extends { teamAId: string | null; teamBId: string | null }>(rows: T[], x: string): T[] =>
  rows.filter((m) => m.teamAId === x || m.teamBId === x);
async function tables(slug: string) {
  return state.groupTables((await state.loadTournament(slug))!);
}

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

async function drawGroups(t: Event, groups: number) {
  const rows = await matchesOf(t.divisionId);
  const replaced = rows.filter((m) => m.groupId !== null || m.bracket !== null).map((m) => m.id);
  return problemOf(manage.generateGroups(t.id, form({ divisionId: t.divisionId, groups, confirm: guard.drawSignature(replaced) })));
}
async function drawKnockout(t: Event, qualify: number) {
  const rows = await matchesOf(t.divisionId);
  const replaced = rows.filter((m) => m.bracket !== null).map((m) => m.id);
  return problemOf(manage.generateKnockout(t.id, form({ divisionId: t.divisionId, qualify, confirm: guard.drawSignature(replaced) })));
}
async function play(matchId: string, a = 11, b = 5) {
  const m = await stored(matchId);
  expect(await score.recordResult(matchId, { a, b, expectedRev: m.rev })).toMatchObject({ ok: true });
}
async function rallies(matchId: string, log: ("a" | "b")[]) {
  const m = await stored(matchId);
  expect(await score.pushLog(matchId, log, m.rev)).toMatchObject({ ok: true });
}
const fill = (t: Event) => manage.fillKnockoutSlots(t.id);

/** "Walkover…", then "Walkover to <side>", carrying the rev the page showed. */
async function walkover(t: Event, matchId: string, side: "a" | "b" | null, token?: number | null) {
  const rev = token === undefined ? (await stored(matchId)).rev : token;
  return landed(manage.giveWalkover(t.id, matchId, form({ confirm: rev, side })));
}

/* ── The manage page, rendered as a tree ─────────────────────────────────── */

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

type Control = { label: string; hook: string; token: unknown; question: string; heading?: string; choices?: { value: string; label: string }[] };
async function page(slug: string, search: Record<string, string> = {}) {
  const { default: Page } = await import("./page");
  const tree = await Page({ params: Promise.resolve({ slug }), searchParams: Promise.resolve(search) });
  const notices: string[] = [];
  const rows = new Map<string, { locked: string[]; controls: Control[] }>();
  const cards = new Map<string, { locked: string[]; controls: Control[]; withdrawn: boolean; text: string }>();
  const control = (el: El): Control => ({
    label: String(el.props.label), hook: String(el.props.hook), token: el.props.token, question: String(el.props.question),
    heading: el.props.heading as string | undefined, choices: el.props.choices as Control["choices"],
  });
  each(tree, (el) => {
    if (named(el) === "ProblemNotice") notices.push(String(el.props.text));
    const match = el.props["data-match"];
    const team = el.props["data-team"];
    if (typeof match === "string" || typeof team === "string") {
      const box = { locked: [] as string[], controls: [] as Control[] };
      each(el.props.children, (inner) => {
        if (inner.props["data-row-locked"] !== undefined) box.locked.push(textOf(inner.props.children));
        if (named(inner) === "ConfirmButton") box.controls.push(control(inner));
      });
      if (typeof match === "string") rows.set(match, box);
      else cards.set(team as string, { ...box, withdrawn: el.props["data-withdrawn"] !== undefined, text: textOf(el.props.children) });
    }
  });
  return { notices, rows, cards };
}

/** "Remove the pair…", second tap, carrying the token the PAGE put on it. */
async function removePair(t: Event, name: string, token?: string) {
  const [tm] = await db.select().from(schema.teams).where(eq(schema.teams.tournamentId, t.id)).then((r) => r.filter((x) => x.name === name));
  const sent = token ?? (await page(t.slug)).cards.get(name)?.controls.find((c) => c.hook === "withdraw")?.token;
  return landed(manage.removePair(t.id, tm.id, form({ confirm: sent as string | undefined })));
}

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  manage = await import("./actions");
  score = await import("../actions");
  guard = await import("@/lib/draw/guard");
  state = await import("@/lib/tournamentState");
  placings = await import("@/lib/placings");
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

/* ── Group membership ────────────────────────────────────────────────────── */

describe("who is in a group", () => {
  it("is recorded by the draw, beside the fixtures, and replaced by a redraw", async () => {
    const t = await event({ teams: 4 });
    expect(await drawGroups(t, 2)).toBeNull();
    const rows = await matchesOf(t.divisionId);
    for (const m of rows) {
      expect((await teamRow(m.teamAId!)).groupId).toBe(m.groupId);
      expect((await teamRow(m.teamBId!)).groupId).toBe(m.groupId);
    }
    expect(await drawGroups(t, 1)).toBeNull();
    const [g] = await db.select().from(schema.groups).where(eq(schema.groups.divisionId, t.divisionId));
    for (const id of t.teamIds) expect((await teamRow(id)).groupId).toBe(g.id);
  });

  it("is cleared by a straight knockout, and a team added after the draw is in no group", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await manage.addTeam(t.id, form({ name: "Late", divisionId: t.divisionId }));
    const [late] = await db.select().from(schema.teams).where(eq(schema.teams.tournamentId, t.id)).then((r) => r.filter((x) => x.name === "Late"));
    expect(late.groupId).toBeNull();
    await db.update(schema.divisions).set({ shape: "single_elim" }).where(eq(schema.divisions.id, t.divisionId));
    const replaced = (await matchesOf(t.divisionId)).filter((m) => m.groupId !== null || m.bracket !== null).map((m) => m.id);
    expect(await problemOf(manage.generateSingleElim(t.id, form({ divisionId: t.divisionId, confirm: guard.drawSignature(replaced) })))).toBeNull();
    for (const id of t.teamIds) expect((await teamRow(id)).groupId).toBeNull();
  });

  it("keeps a pair in the table whose fixtures are gone — a group of two, one removed, the other wins it", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    const [, , third] = t.teamIds;
    const gB = await groupOf(t.divisionId, "B");
    const leaving = (await teamRow(third)).groupId === gB.id ? "T3" : "T4";
    expect((await removePair(t, leaving))?.get("done")).toBe("withdrawn");
    const b = (await tables(t.slug)).find((x) => x.group.key === "B")!;
    expect(b.rows).toHaveLength(1);
    expect(b.complete).toBe(true);
    expect(b.withdrawn).toEqual([leaving]);
    expect(state.groupNote(b)).toBe(`${leaving} withdrew, so the pair left, ${b.rows[0].name}, wins Group B.`);
    /* B1 is decided now; once A finishes, the Final fills from both. */
    const [a] = await groupFixtures(t.divisionId, "A");
    await play(a.id);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    expect([final.teamAId, final.teamBId]).toContain(b.rows[0].teamId);
  });
});

/* ── Walkover ────────────────────────────────────────────────────────────── */

describe("a walkover", () => {
  it("counts as the full winning score in the table, moves nobody's rating, and freezes the rules", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    const before = await peopleState(t.personIds);
    const url = await walkover(t, m.id, "b");
    expect(url?.get("done")).toBe("walkover");
    const after = await stored(m.id);
    expect([after.typedScoreA, after.typedScoreB, after.outcome]).toEqual([0, 11, "walkover"]);
    expect(after.rev).toBe(m.rev + 1);
    expect(after.rules).not.toBeNull();
    expect(await history(m.id)).toHaveLength(0);
    expect(await peopleState(t.personIds)).toEqual(before);
    const [table] = await tables(t.slug);
    expect(table.complete).toBe(true);
    expect(table.rows[0]).toMatchObject({ teamId: m.teamBId, won: 1, pointsFor: 11 });
  });

  it("is done, not refused, when the same walkover is asked for again — a retry after a lost reply", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await walkover(t, m.id, "a", m.rev);
    const once = await stored(m.id);
    expect((await walkover(t, m.id, "a", m.rev))?.get("done")).toBe("walkover");
    expect((await stored(m.id)).rev).toBe(once.rev);
    /* The OTHER side, from the same page, is not the same walkover. */
    expect((await walkover(t, m.id, "b", m.rev))?.get("problem")).toBe("walkover-played");
  });

  it("needs a side and the page's rev, and is refused from a page that saw an older match", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    expect((await walkover(t, m.id, null))?.get("problem")).toBe("walkover-confirm");
    expect((await walkover(t, m.id, "a", null))?.get("problem")).toBe("walkover-confirm");
    expect((await landed(manage.giveWalkover(t.id, m.id, form({ confirm: m.rev, side: "x" }))))?.get("problem")).toBe("walkover-confirm");
    await db.update(schema.matches).set({ rev: m.rev + 3 }).where(eq(schema.matches.id, m.id));
    expect((await walkover(t, m.id, "a", m.rev))?.get("problem")).toBe("walkover-stale");
    expect((await stored(m.id)).outcome).toBeNull();
  });

  it("is refused on a match with a result, and on one being played", async () => {
    const t = await event({ teams: 3 });
    await drawGroups(t, 1);
    const [m1, m2] = await matchesOf(t.divisionId);
    await play(m1.id);
    expect((await walkover(t, m1.id, "b"))?.get("problem")).toBe("walkover-played");
    await rallies(m2.id, ["a", "a"]);
    expect((await walkover(t, m2.id, "b"))?.get("problem")).toBe("walkover-started");
    expect((await stored(m2.id)).log).toEqual(["a", "a"]);
  });

  it("needs both teams known, and says a deleted match is gone", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    const final = await round(t.divisionId, "Final");
    expect((await walkover(t, final.id, "a"))?.get("problem")).toBe("walkover-teams");
    const [a] = await groupFixtures(t.divisionId, "A");
    await db.delete(schema.matches).where(eq(schema.matches.id, a.id));
    expect((await walkover(t, a.id, "a", a.rev))?.get("problem")).toBe("match-gone");
  });

  it("in a knockout, sends the winner on when the slots are filled", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    for (const m of (await matchesOf(t.divisionId)).filter((x) => x.groupId)) await play(m.id);
    await fill(t);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    expect((await walkover(t, sf1.id, "a"))?.get("done")).toBe("walkover");
    await fill(t);
    const final = await round(t.divisionId, "Final");
    expect(final.teamAId).toBe(sf1.teamAId);
    expect(await history(sf1.id)).toHaveLength(0);
  });

  it("is the organiser's alone", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    who.pin = true;
    try {
      await expect(walkover(t, m.id, "a")).rejects.toThrow();
    } finally {
      who.pin = false;
    }
    expect((await stored(m.id)).outcome).toBeNull();
  });
});

/* ── Remove the pair ─────────────────────────────────────────────────────── */

describe("removing a pair", () => {
  /** One group of four, a pair's three matches: two played, one not. */
  async function groupOfFour(qualify = 0) {
    const t = await event({ teams: 4 });
    await drawGroups(t, 1);
    if (qualify) await drawKnockout(t, qualify);
    const leaving = t.teamIds[3];
    const theirs = between(await matchesOf(t.divisionId), leaving).filter((m) => m.groupId);
    return { t, leaving, theirs };
  }

  it("takes all their matches, played ones too, puts every rating back exactly, and marks them Withdrawn", async () => {
    const { t, leaving, theirs } = await groupOfFour();
    const before = await peopleState(t.personIds);
    await play(theirs[0].id, 11, 7);
    await play(theirs[1].id, 4, 11);
    expect(await history(theirs[0].id)).toHaveLength(4);
    const others = (await matchesOf(t.divisionId)).filter((m) => !theirs.some((x) => x.id === m.id));

    expect((await removePair(t, "T4"))?.get("done")).toBe("withdrawn");
    for (const m of theirs) expect(await stored(m.id)).toBeUndefined();
    for (const m of others) expect(await stored(m.id)).toBeDefined();
    expect(await peopleState(t.personIds)).toEqual(before);
    expect((await teamRow(leaving)).withdrawnAt).not.toBeNull();
    /* Still on the list, in no table. */
    const [table] = await tables(t.slug);
    expect(table.rows.map((r) => r.teamId)).not.toContain(leaving);
    expect(table.withdrawn).toEqual(["T4"]);
  });

  it("withdraws their approved online entry with a note, and keeps it pointing at the team", async () => {
    const { t, leaving } = await groupOfFour();
    const entry = randomUUID();
    await db.insert(schema.registrations).values({
      id: entry, tournamentId: t.id, divisionId: t.divisionId, teamName: "T4", contactName: "C", contactPhone: "9000000001",
      status: "approved", teamId: leaving,
    });
    expect((await removePair(t, "T4"))?.get("done")).toBe("withdrawn");
    const [e] = await db.select().from(schema.registrations).where(eq(schema.registrations.id, entry));
    expect(e).toMatchObject({ status: "withdrawn", teamId: leaving, divisionId: t.divisionId });
    expect(e.note).toContain("Removed from the event by the organiser");
    expect(e.decidedAt).not.toBeNull();
  });

  it("is done, not repeated, when it had already happened", async () => {
    const { t } = await groupOfFour();
    const token = (await page(t.slug)).cards.get("T4")!.controls.find((c) => c.hook === "withdraw")!.token as string;
    expect((await removePair(t, "T4", token))?.get("done")).toBe("withdrawn");
    expect((await removePair(t, "T4", token))?.get("done")).toBe("already");
  });

  it("is refused from a page opened before their online entry was approved", async () => {
    const { t, leaving } = await groupOfFour();
    const token = (await page(t.slug)).cards.get("T4")!.controls.find((c) => c.hook === "withdraw")!.token as string;
    /* The question the organiser read said nothing about an online entry. */
    await db.insert(schema.registrations).values({
      id: randomUUID(), tournamentId: t.id, divisionId: t.divisionId, teamName: "T4", contactName: "C", contactPhone: "9000000009",
      status: "approved", teamId: leaving,
    });
    expect((await removePair(t, "T4", token))?.get("problem")).toBe("pair-stale");
    expect((await teamRow(leaving)).withdrawnAt).toBeNull();
  });

  it("needs the second tap, and is refused from a page that saw their matches differently", async () => {
    const { t, theirs } = await groupOfFour();
    expect((await removePair(t, "T4", ""))?.get("problem")).toBe("pair-confirm");
    const token = (await page(t.slug)).cards.get("T4")!.controls.find((c) => c.hook === "withdraw")!.token as string;
    await play(theirs[0].id);
    expect((await removePair(t, "T4", token))?.get("problem")).toBe("pair-stale");
    expect(await stored(theirs[0].id)).toBeDefined();
    /* A live match signs as live: its rallies do not make the page stale. */
    await rallies(theirs[1].id, ["a"]);
    const live = (await page(t.slug)).cards.get("T4")!.controls.find((c) => c.hook === "withdraw")!.token as string;
    await rallies(theirs[1].id, ["a", "b"]);
    expect((await removePair(t, "T4", live))?.get("done")).toBe("withdrawn");
  });

  it("refuses a team of another event, and answers it as gone", async () => {
    const { t } = await groupOfFour();
    const other = await event({ teams: 2 });
    const url = await landed(manage.removePair(t.id, other.teamIds[0], form({ confirm: "x" })));
    expect(url?.get("problem")).toBe("team-gone");
    expect((await teamRow(other.teamIds[0])).withdrawnAt).toBeNull();
  });

  it("is refused once they are in a knockout match — give the walkover there", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    for (const m of (await matchesOf(t.divisionId)).filter((x) => x.groupId)) await play(m.id);
    await fill(t);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    const name = (await teamRow(sf1.teamAId!)).name;
    expect((await removePair(t, name, "anything"))?.get("problem")).toBe("pair-in-knockout");
    expect((await teamRow(sf1.teamAId!)).withdrawnAt).toBeNull();
  });

  it("is refused for a pair in a match added by hand, which a W: label can name", async () => {
    const t = await event({ teams: 3 });
    await manage.addMatch(t.id, form({ round: "Final", teamA: t.teamIds[0], teamB: t.teamIds[1] }));
    expect((await removePair(t, "T1", "anything"))?.get("problem")).toBe("pair-in-knockout");
    /* A pair in no match at all simply goes. */
    expect((await removePair(t, "T3"))?.get("done")).toBe("withdrawn");
  });

  it("is refused while a knockout match waiting on their group has started", async () => {
    const t = await event({ teams: 6 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    for (const m of (await matchesOf(t.divisionId)).filter((x) => x.groupId)) await play(m.id);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    await rallies(final.id, ["a"]);
    const gA = await groupOf(t.divisionId, "A");
    const third = (await tables(t.slug)).find((x) => x.group.id === gA.id)!.rows[2];
    expect((await removePair(t, third.name, "anything"))?.get("problem")).toBe("pair-blocked");
  });

  it("is refused when the group would have fewer pairs than the knockout takes from it (Faisal: walkovers instead)", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    expect((await removePair(t, "T1", "anything"))?.get("problem")).toBe("pair-group-short");
    const card = (await page(t.slug)).cards.get("T1")!;
    expect(card.controls.find((c) => c.hook === "withdraw")).toBeUndefined();
    expect(card.locked.join(" ")).toContain("the knockout takes 2 pairs from Group A, and only 1 would be left");
  });

  it("is refused when the pairs left would have no match between them", async () => {
    const t = await event({ teams: 3 });
    await drawGroups(t, 1);
    const yz = (await matchesOf(t.divisionId)).find((m) => !between([m], t.teamIds[0]).length)!;
    expect(await problemOf(manage.removeMatch(t.id, yz.id, form({ confirm: yz.rev })))).toBeNull();
    expect((await removePair(t, "T1", "anything"))?.get("problem")).toBe("pair-strands-group");
  });

  it("empties a knockout side filled from their group while it has not started", async () => {
    const t = await event({ teams: 6 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    for (const m of (await matchesOf(t.divisionId)).filter((x) => x.groupId)) await play(m.id);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    const gA = await groupOf(t.divisionId, "A");
    const third = (await tables(t.slug)).find((x) => x.group.id === gA.id)!.rows[2];
    expect((await removePair(t, third.name))?.get("done")).toBe("withdrawn");
    const after = await stored(final.id);
    const sideOfA = final.slotA === "A1" ? "a" : "b";
    expect(sideOfA === "a" ? after.teamAId : after.teamBId).toBeNull();
    expect(after.resetRev).toBe(after.rev);
  });

  it("rolls everything back and says so when a result lands mid-removal", async () => {
    const { t, leaving, theirs } = await groupOfFour();
    const token = (await page(t.slug)).cards.get("T4")!.controls.find((c) => c.hook === "withdraw")!.token as string;
    guardRace.changeBeforeDelete = true;
    expect((await removePair(t, "T4", token))?.get("problem")).toBe("pair-changed");
    expect((await teamRow(leaving)).withdrawnAt).toBeNull();
    for (const m of theirs) expect(await stored(m.id)).toBeDefined();
  });

  it("deletes a match being played; the referee's phone and console are told it was deleted", async () => {
    const { t, theirs } = await groupOfFour();
    await rallies(theirs[0].id, ["a", "b"]);
    const m = await stored(theirs[0].id);
    expect((await removePair(t, "T4"))?.get("done")).toBe("withdrawn");
    expect(await score.pushLog(m.id, ["a", "b", "a"], m.rev)).toMatchObject({ ok: false, reason: "refused" });
    expect(await score.scorePoint(m.id, "a", m.rev)).toEqual({ ok: false, error: "Not recorded — this match was deleted on the manage screen.", stale: true });
    expect(await score.undoPoint(m.id, m.rev)).toMatchObject({ ok: false, stale: true });
  });
});

/* ── Left out of everything ──────────────────────────────────────────────── */

describe("a removed pair", () => {
  async function removed() {
    const t = await event({ teams: 5 });
    await drawGroups(t, 1);
    expect((await removePair(t, "T5"))?.get("done")).toBe("withdrawn");
    return { t, gone: t.teamIds[4] };
  }

  it("is drawn into nothing", async () => {
    const { t, gone } = await removed();
    expect(await drawGroups(t, 2)).toBeNull();
    expect((await teamRow(gone)).groupId).toBeNull();
    expect(between(await matchesOf(t.divisionId), gone)).toHaveLength(0);
  });

  it("cannot be given a match or a player, whatever the form sends", async () => {
    const { t, gone } = await removed();
    const before = (await matchesOf(t.divisionId)).length;
    await manage.addMatch(t.id, form({ round: "Extra", teamA: gone, teamB: t.teamIds[0] }));
    expect(await matchesOf(t.divisionId)).toHaveLength(before);
    const r = await manage.addPlayer(t.id, gone, form({ name: "Newcomer", gender: "M" }));
    expect(r).toMatchObject({ ok: false, message: "This team was removed from the event, so nobody can be added to it." });
    expect((await db.select().from(schema.players).where(eq(schema.players.teamId, gone)))).toHaveLength(2);
  });

  it("takes no seed, so the seeds still in run 1..N", async () => {
    const { t, gone } = await removed();
    /* The strongest pair on paper — counted, it would take seed 1 and push
       every pair still in down one. */
    await db.update(schema.people).set({ riseRatings: { "pb:md": 1500 }, riseBest: 1500 })
      .where(inArray(schema.people.id, t.personIds.slice(8, 10)));
    await manage.seedByRating(t.id);
    const seeds = (await db.select().from(schema.teams).where(eq(schema.teams.tournamentId, t.id)))
      .filter((x) => x.id !== gone).map((x) => x.seed).sort();
    expect(seeds).toEqual([1, 2, 3, 4]);
  });

  it("keeps their players in the category's roster, so its rating key cannot change mid-event", async () => {
    const { t, gone } = await removed();
    const { categoryRoster } = await import("@/lib/rating/tournament");
    const roster = await categoryRoster(t.divisionId);
    expect(roster.filter((p) => p.teamId === gone)).toHaveLength(2);
  });

  it("is not in the lists a match is added from, nor counted in the category", async () => {
    const { t } = await removed();
    const p = await page(t.slug);
    const card = p.cards.get("T5")!;
    expect(card.withdrawn).toBe(true);
    expect(card.text).toContain("Withdrawn");
    expect(card.controls).toHaveLength(0);

    const { default: Page } = await import("./page");
    const tree = await Page({ params: Promise.resolve({ slug: t.slug }), searchParams: Promise.resolve({}) });
    const options: string[] = [];
    let header = "";
    each(tree, (el) => {
      if (el.type === "select" && el.props.name === "teamA") each(el.props.children, (o) => { if (o.type === "option") options.push(textOf(o.props.children)); });
      if (el.props["data-category"] === "Main") header = textOf(el.props.children);
    });
    expect(options).toEqual(["Team A…", "T1", "T2", "T3", "T4"]);
    expect(header).toContain("4 teams · 1 withdrawn");
  });

  it("is not flagged as breaking the category's rules — it is not playing", async () => {
    const t = await event({ teams: 3 });
    /* A woman in a men's category: flagged red while the pair is in. */
    await db.insert(schema.players).values({
      id: randomUUID(), tournamentId: t.id, teamId: t.teamIds[2], name: "Asha", gender: "F", ratings: {},
    });
    const { divisionMisfits } = await import("@/lib/eligibility/store");
    expect((await divisionMisfits(t.id)).map((m) => m.teamId)).toContain(t.teamIds[2]);
    expect((await removePair(t, "T3"))?.get("done")).toBe("withdrawn");
    expect((await divisionMisfits(t.id)).map((m) => m.teamId)).not.toContain(t.teamIds[2]);
  });

  it("has its online entry shown withdrawn, with the reason, on the registration page", async () => {
    const t = await event({ teams: 3 });
    await db.insert(schema.registrations).values({
      id: randomUUID(), tournamentId: t.id, divisionId: t.divisionId, teamName: "T3", contactName: "C", contactPhone: "9000000003",
      status: "approved", teamId: t.teamIds[2],
    });
    expect((await removePair(t, "T3"))?.get("done")).toBe("withdrawn");
    const { default: RegistrationPage } = await import("./registration/page");
    const tree = await RegistrationPage({ params: Promise.resolve({ slug: t.slug }), searchParams: Promise.resolve({}) });
    const notes: string[] = [];
    each(tree, (el) => { if (el.props["data-entry-note"] !== undefined) notes.push(textOf(el.props.children)); });
    expect(notes).toEqual(["Removed from the event by the organiser after they pulled out."]);
  });
});

describe("drawing a knockout", () => {
  it("is refused when a group has fewer pairs left than the number asked to qualify", async () => {
    const t = await event({ teams: 5 });
    await drawGroups(t, 2);
    /* Group B has two pairs; take one out with nothing drawn from it yet. */
    const gB = await groupOf(t.divisionId, "B");
    const inB = (await db.select().from(schema.teams).where(eq(schema.teams.groupId, gB.id)));
    expect(inB).toHaveLength(2);
    expect((await removePair(t, inB[0].name))?.get("done")).toBe("withdrawn");
    expect(await drawKnockout(t, 2)).toBe("knockout-too-many");
    expect(await drawKnockout(t, 1)).toBeNull();
  });
});

/* ── Who won ─────────────────────────────────────────────────────────────── */

describe("a league whose other pairs all withdrew", () => {
  it("is won by the pair left, and the podium says how", async () => {
    const t = await event({ teams: 2, shape: "league" });
    await drawGroups(t, 1);
    expect((await removePair(t, "T2"))?.get("done")).toBe("withdrawn");
    const loaded = (await state.loadTournament(t.slug))!;
    expect(loaded.matches).toHaveLength(0);
    const [p] = placings.podiums(loaded, state.groupTables(loaded));
    expect(p).toMatchObject({ gold: t.teamIds[0], silver: null, bronze: null, via: "alone" });
  });
});

/* ── What the manage page says ───────────────────────────────────────────── */

describe("what the manage page says", () => {
  it("offers a walkover on an unplayed match with both teams, beside the delete or the reason there is none", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    const row = (await page(t.slug)).rows.get(m.id)!;
    const w = row.controls.find((c) => c.hook === "walkover")!;
    expect(w.label).toBe("Walkover…");
    expect(w.token).toBe(m.rev);
    expect(w.question).toContain("It counts as 11–0 in the Group A table, and nobody’s rating changes.");
    expect(w.choices).toEqual([{ value: "a", label: "Walkover to T1" }, { value: "b", label: "Walkover to T2" }]);
    /* The group's only match: no delete, the reason instead — and the walkover still there. */
    expect(row.controls.map((c) => c.hook)).toEqual(["walkover"]);
    expect(row.locked.join(" ")).toContain("Group A’s only match");
  });

  it("offers no walkover where a side is not yet known, and says where the winner goes", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    for (const m of (await matchesOf(t.divisionId)).filter((x) => x.groupId)) await play(m.id);
    const final = await round(t.divisionId, "Final");
    let p = await page(t.slug);
    expect(p.rows.get(final.id)!.controls.some((c) => c.hook === "walkover")).toBe(false);
    await fill(t);
    const sf1 = await round(t.divisionId, "Semi-Final 1");
    p = await page(t.slug);
    expect(p.rows.get(sf1.id)!.controls.find((c) => c.hook === "walkover")!.question)
      .toContain("The winner goes through to Final — press “Fill resolved slots” afterwards.");
    await walkover(t, sf1.id, "b");
    p = await page(t.slug, { done: "walkover", match: sf1.id });
    expect(p.notices.join(" ")).toContain(`Walkover to ${(await teamRow(sf1.teamBId!)).name}, 11–0. Nobody’s rating changed. Press “Fill resolved slots”`);
  });

  it("says why a walkover was not given", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    for (const [code, words] of [
      ["walkover-played", "it already has a result. Clear it first."],
      ["walkover-started", "it has been started. Reset it to 0–0 first."],
      ["walkover-stale", "changed since this page was opened, so no walkover was given"],
      ["walkover-teams", "both teams must be known first"],
      ["walkover-confirm", "choose who gets it"],
    ]) {
      expect((await page(t.slug, { problem: code, match: m.id })).notices.join(" ")).toContain(words);
    }
    expect((await page(t.slug, { problem: "match-gone" })).notices.join(" ")).toContain("That match is not part of this event any more");
  });

  it("says exactly what removing a pair takes, in counts of different people", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 1);
    const theirs = between(await matchesOf(t.divisionId), t.teamIds[3]);
    await play(theirs[0].id);
    await play(theirs[1].id);
    await db.insert(schema.registrations).values({
      id: randomUUID(), tournamentId: t.id, divisionId: t.divisionId, teamName: "T4", contactName: "C", contactPhone: "9000000002",
      status: "approved", teamId: t.teamIds[3],
    });
    const c = (await page(t.slug)).cards.get("T4")!.controls.find((x) => x.hook === "withdraw")!;
    expect(c.label).toBe("Remove the pair…");
    expect(c.heading).toBe("Remove T4?");
    /* Two played matches: T4's two players plus two opponents each — six
       different people, not eight. */
    expect(c.question).toContain("This removes their 3 matches in Group A — 2 with results — and takes back the rating changes those matches gave 6 players.");
    expect(c.question).toContain("The other pairs in Group A play one match fewer.");
    expect(c.question).toContain("Their online entry is marked withdrawn too.");
    expect(c.question).toContain("This can’t be undone.");
  });

  it("says why a pair cannot be removed, and never promises a walkover that is not on screen", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    for (const m of (await matchesOf(t.divisionId)).filter((x) => x.groupId)) await play(m.id);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    const name = (await teamRow(final.teamAId!)).name;
    let card = (await page(t.slug)).cards.get(name)!;
    expect(card.locked.join(" ")).toContain("Can’t remove — this pair is in Final. If they pull out, give the walkover there.");
    await rallies(final.id, ["a"]);
    card = (await page(t.slug)).cards.get(name)!;
    expect(card.locked.join(" ")).toContain("is playing Final. If they pull out, reset it to 0–0, then give the walkover.");
  });

  it("marks a removed pair Withdrawn and says it was removed", async () => {
    const t = await event({ teams: 3 });
    await drawGroups(t, 1);
    await removePair(t, "T3");
    const p = await page(t.slug, { done: "withdrawn", team: t.teamIds[2] });
    expect(p.notices.join(" ")).toContain("Done — T3 was removed");
    for (const [code, words] of [
      ["pair-in-knockout", "they are in a match outside the groups."],
      ["pair-group-short", "fewer pairs than the knockout takes from it"],
      ["pair-stale", "changed since this page was opened, so nothing was removed"],
      ["pair-changed", "while they were being removed, so nothing was changed"],
    ]) {
      expect((await page(t.slug, { problem: code, team: t.teamIds[0] })).notices.join(" ")).toContain(words);
    }
  });

  it("refuses to delete a pair's last match and says what to do instead", async () => {
    const t = await event({ teams: 3 });
    await drawGroups(t, 1);
    const fx = await matchesOf(t.divisionId);
    expect(await problemOf(manage.removeMatch(t.id, fx[0].id, form({ confirm: fx[0].rev })))).toBeNull();
    const rest = await matchesOf(t.divisionId);
    const row = (await page(t.slug)).rows.get(rest[0].id)!;
    expect(row.locked.join(" ")).toContain("last match in Group A, and the table would show them at nought played. If they pulled out, give the walkover, or remove the pair.");
    expect(row.controls.map((c) => c.hook)).toEqual(["walkover"]);
  });
});

/* ── An organiser's add meeting a removal ────────────────────────────────── */

/* The removal holds the TEAM FOR UPDATE, so an add takes the team (KEY SHARE)
   right after the category, and reads it withdrawn once the removal commits.
   PGlite runs one transaction at a time, so the removal is made to land exactly
   there: the team is marked withdrawn, inside the writer's transaction, just
   before its KEY SHARE read of it. A writer that skipped that read would add to
   a pair removed a moment before — the page had no button, but the action is a
   public endpoint and the form was already open. */
async function withdrawnAtTheLock<T>(teamId: string, run: () => Promise<T>) {
  type Q = { query: (sql: string, ...rest: unknown[]) => Promise<unknown> };
  const client = (db as unknown as { $client: { transaction: (cb: (tx: Q) => Promise<unknown>) => Promise<unknown> } }).$client;
  const original = client.transaction.bind(client);
  const sent: string[][] = [];
  let done = false;
  client.transaction = (cb) =>
    original(async (tx) => {
      const mine: string[] = [];
      sent.push(mine);
      const query = tx.query.bind(tx);
      tx.query = async (sql: string, ...rest: unknown[]) => {
        const s = sql.replace(/\s+/g, " ").trim().toLowerCase();
        if (!done && /from "teams" .* for key share$/.test(s)) {
          done = true;
          await query("update teams set withdrawn_at = now() where id = $1", [teamId]);
        }
        mine.push(s);
        return query(sql, ...rest);
      };
      return cb(tx);
    });
  try {
    return { result: await run(), done, sent };
  } finally {
    client.transaction = original;
  }
}

describe("an organiser's add meeting a removal", () => {
  const categoryFirst = /^select .* from "divisions" .* for key share$/;
  const teamSecond = /^select .* from "teams" .* for key share$/;

  it("a player: takes the category, then the team, and says the pair was removed", async () => {
    const t = await event({ teams: 2 });
    const r = await withdrawnAtTheLock(t.teamIds[0], () => manage.addPlayer(t.id, t.teamIds[0], form({ name: "Too Late", gender: "M" })));
    expect(r.done, "it took the team").toBe(true);
    expect(r.result).toEqual({ ok: false, message: "This team was removed from the event, so nobody can be added to it." });
    const tx = r.sent.find((x) => x.some((s) => categoryFirst.test(s)))!;
    expect(tx[0]).toMatch(categoryFirst);
    expect(tx[1]).toMatch(teamSecond);
    expect(await db.select().from(schema.players).where(eq(schema.players.name, "Too Late"))).toEqual([]);
  });

  it("a match: takes the category, then both teams in one sorted statement, and adds nothing", async () => {
    const t = await event({ teams: 2 });
    const r = await withdrawnAtTheLock(t.teamIds[1], () =>
      manage.addMatch(t.id, form({ round: "Too Late", teamA: t.teamIds[0], teamB: t.teamIds[1] })));
    expect(r.done, "it took the teams").toBe(true);
    const tx = r.sent.find((x) => x.some((s) => categoryFirst.test(s)))!;
    expect(tx[0]).toMatch(categoryFirst);
    expect(tx[1]).toMatch(/^select .* from "teams" .*order by "teams"\."id"( asc)? for key share$/);
    expect(await db.select().from(schema.matches).where(eq(schema.matches.round, "Too Late"))).toEqual([]);
  });
});

/* ── Round one of the review: each finding, pinned ───────────────────────── */

describe("what the review of 8b found", () => {
  it("a scorer's PIN cannot give a walkover through the typed-result route — only the organiser can", async () => {
    const t = await event({ teams: 3 });
    await drawGroups(t, 1);
    const [m1, m2] = await matchesOf(t.divisionId);
    who.pin = true;
    try {
      expect(await score.recordResult(m1.id, { a: 0, b: 11, outcome: "walkover", expectedRev: m1.rev }))
        .toMatchObject({ ok: false, code: "organiser-only" });
      /* A PLAYED result typed in is still theirs to record (step 7). */
      expect(await score.recordResult(m2.id, { a: 11, b: 6, expectedRev: m2.rev })).toMatchObject({ ok: true });
    } finally {
      who.pin = false;
    }
    expect((await stored(m1.id)).outcome).toBeNull();
    expect(await score.recordResult(m1.id, { a: 0, b: 11, outcome: "walkover", expectedRev: m1.rev })).toMatchObject({ ok: true });
  });

  it("a removed pair's players cannot be deleted — the category's rating key would change", async () => {
    const t = await event({ teams: 3 });
    await drawGroups(t, 1);
    expect((await removePair(t, "T3"))?.get("done")).toBe("withdrawn");
    const [p] = await db.select().from(schema.players).where(eq(schema.players.teamId, t.teamIds[2]));
    await manage.removePlayer(t.id, p.id);
    expect(await db.select().from(schema.players).where(eq(schema.players.teamId, t.teamIds[2]))).toHaveLength(2);
    /* A pair still in loses a player as before. */
    const [q] = await db.select().from(schema.players).where(eq(schema.players.teamId, t.teamIds[0]));
    await manage.removePlayer(t.id, q.id);
    expect(await db.select().from(schema.players).where(eq(schema.players.teamId, t.teamIds[0]))).toHaveLength(1);
  });

  it("a player is not deleted from a pair removed at the very moment it is asked", async () => {
    const t = await event({ teams: 2 });
    const [p] = await db.select().from(schema.players).where(eq(schema.players.teamId, t.teamIds[0]));
    const r = await withdrawnAtTheLock(t.teamIds[0], () => manage.removePlayer(t.id, p.id));
    expect(r.done, "it took the team").toBe(true);
    /* The category FIRST, then the team: the order removing a category takes
       them in. Team first closed a circle with it (round two of the review). */
    const tx = r.sent.find((x) => x.some((s) => /from "teams" .* for key share$/.test(s)))!;
    expect(tx[0]).toMatch(/^select .* from "divisions" .* for key share$/);
    expect(tx[1]).toMatch(/^select .* from "teams" .* for key share$/);
    expect(await db.select().from(schema.players).where(eq(schema.players.id, p.id))).toHaveLength(1);
  });

  it("a group cannot be emptied where a knockout will be drawn from it, even before it is drawn", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    const gB = await groupOf(t.divisionId, "B");
    const inB = await db.select().from(schema.teams).where(eq(schema.teams.groupId, gB.id));
    expect((await removePair(t, inB[0].name))?.get("done")).toBe("withdrawn");
    expect((await removePair(t, inB[1].name, "anything"))?.get("problem")).toBe("pair-group-short");
    const card = (await page(t.slug)).cards.get(inB[1].name)!;
    expect(card.controls.find((c) => c.hook === "withdraw")).toBeUndefined();
    expect(card.locked.join(" ")).toContain(`they are the only pair left in Group B, and the knockout will take its winner`);
    /* …and the knockout can still be drawn. */
    expect(await drawKnockout(t, 1)).toBeNull();
  });

  it("a league may lose every pair of its table, and says so", async () => {
    const t = await event({ teams: 2, shape: "league" });
    await drawGroups(t, 1);
    expect((await removePair(t, "T1"))?.get("done")).toBe("withdrawn");
    expect((await removePair(t, "T2"))?.get("done")).toBe("withdrawn");
    const [table] = await tables(t.slug);
    expect(state.groupNote(table)).toBe("Every pair in this group withdrew.");
    const { StandingsTable } = await import("@/components/StandingsTable");
    const words = textOf(StandingsTable({ table, allowDraws: false }));
    expect(words).toContain("withdrawn");
    expect(words).not.toContain("in progress");
  });

  it("a group drawn before membership was recorded keeps the pair left, who win it", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    const gB = await groupOf(t.divisionId, "B");
    const inB = await db.select().from(schema.teams).where(eq(schema.teams.groupId, gB.id));
    /* As a group drawn by the code before 0023 is: fixtures, no membership. */
    await db.update(schema.teams).set({ groupId: null }).where(eq(schema.teams.tournamentId, t.id));
    expect((await removePair(t, inB[0].name))?.get("done")).toBe("withdrawn");
    const b = (await tables(t.slug)).find((x) => x.group.key === "B")!;
    expect(b.rows.map((r) => r.teamId)).toEqual([inB[1].id]);
    expect(b.complete).toBe(true);
    expect(b.withdrawn).toEqual([inB[0].name]);
    const [a] = await groupFixtures(t.divisionId, "A");
    await play(a.id);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    expect([final.teamAId, final.teamBId]).toContain(inB[1].id);
  });

  it("a walkover is not a match two pairs shared a court for, nor one that was played", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await walkover(t, m.id, "a");
    const { mayRate } = await import("@/lib/skills/eligibility");
    expect(await mayRate(t.personIds[0], t.personIds[2])).toMatchObject({ allowed: false, reason: "not-played" });
    const { playedSql } = await import("@/lib/results");
    const [{ n }] = await db.select({ n: (await import("drizzle-orm")).count() }).from(schema.matches)
      .where((await import("drizzle-orm")).and(eq(schema.matches.id, m.id), playedSql));
    expect(n).toBe(0);
    /* A result that was played still counts. */
    await clearAndPlay(t, m.id);
    expect(await mayRate(t.personIds[0], t.personIds[2])).toMatchObject({ allowed: true });
  });

  it("clearing or deleting a match deleted since the page was opened says it is gone", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 1);
    const theirs = between(await matchesOf(t.divisionId), t.teamIds[3]);
    await play(theirs[0].id);
    expect((await removePair(t, "T4"))?.get("done")).toBe("withdrawn");
    expect((await landed(manage.clearResult(t.id, theirs[0].id, form({ confirm: theirs[0].rev + 1 }))))?.get("problem")).toBe("match-gone");
    expect((await landed(manage.removeMatch(t.id, theirs[1].id, form({ confirm: theirs[1].rev }))))?.get("problem")).toBe("match-gone");
  });

  it("Fill resolved slots judges a game by the scoring as it is under its lock", async () => {
    const t = await event({ teams: 4 });
    const scoringForm = (target: string) => {
      const f = new FormData();
      for (const [k, v] of Object.entries({ target, winBy2: "on", goldenAt: "none", scoreType: "rally" })) f.set(k, v);
      return f;
    };
    expect(await manage.setScoring(t.id, scoringForm("11"))).toMatchObject({ ok: true });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    const [b] = await groupFixtures(t.divisionId, "B");
    await play(b.id);
    const [a] = await groupFixtures(t.divisionId, "A");
    /* In the gap between the fill's first read of the event and its lock: the
       organiser moves the event to 15, and A's game reaches 11–4 — over at 11,
       live at 15. */
    who.between = async () => {
      expect(await manage.setScoring(t.id, scoringForm("15"))).toMatchObject({ ok: true });
      const now = await stored(a.id);
      expect(await score.pushLog(a.id, [...Array(11).fill("a"), ...Array(4).fill("b")], now.rev)).toMatchObject({ ok: true });
    };
    await fill(t);
    const final = await round(t.divisionId, "Final");
    const sideOfA = final.slotA === "A1" ? final.teamAId : final.teamBId;
    expect(sideOfA, "Group A is not finished at 15").toBeNull();
  });

  it("the ratings page leaves a removed pair out of its tables", async () => {
    const t = await event({ teams: 3 });
    await drawGroups(t, 1);
    expect((await removePair(t, "T3"))?.get("done")).toBe("withdrawn");
    const { default: RatingsPage } = await import("../ratings/page");
    const tree = await RatingsPage({ params: Promise.resolve({ slug: t.slug }) });
    const shown: string[] = [];
    each(tree, (el) => { if (typeof el.props["data-player"] === "string") shown.push(String(el.props["data-player"])); });
    expect(shown.length).toBe(4);
    expect(shown.some((s) => s.includes(`${t.slug}-2`))).toBe(false);
  });

  it("a tap on a walkover says it was given as one, not typed in", async () => {
    const t = await event({ teams: 2 });
    await drawGroups(t, 1);
    const [m] = await matchesOf(t.divisionId);
    await walkover(t, m.id, "b");
    const now = await stored(m.id);
    expect(await score.scorePoint(m.id, "a", now.rev))
      .toEqual({ ok: false, error: "This match was given as a walkover on the manage screen, so the court is locked." });
  });

  it("calls an entrant a player in singles, and a pair otherwise", async () => {
    const t = await event({ teams: 3 });
    await db.update(schema.tournaments).set({ minTeamSize: 1, maxTeamSize: 1 }).where(eq(schema.tournaments.id, t.id));
    await drawGroups(t, 1);
    const c = (await page(t.slug)).cards.get("T3")!.controls.find((x) => x.hook === "withdraw")!;
    expect(c.label).toBe("Remove the player…");
    expect(c.question).toContain("The other players in Group A play one match fewer.");
    expect(c.question).toContain("The player stays on the team list marked Withdrawn");
    expect(c.question).not.toMatch(/\bpairs?\b/);
  });

  it("names only the pairs who lose a match, when one of theirs was deleted before", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 1);
    const t4 = t.teamIds[3];
    const vsT1 = between(await matchesOf(t.divisionId), t4).find((m) => m.teamAId === t.teamIds[0] || m.teamBId === t.teamIds[0])!;
    expect(await problemOf(manage.removeMatch(t.id, vsT1.id, form({ confirm: vsT1.rev })))).toBeNull();
    const c = (await page(t.slug)).cards.get("T4")!.controls.find((x) => x.hook === "withdraw")!;
    expect(c.question).toContain("This removes their 2 matches in Group A.");
    expect(c.question).toContain("One match fewer for T2 and T3.");
    expect(c.question).not.toContain("The other pairs");
  });

  it("says to press Fill resolved slots when a removal empties a knockout side", async () => {
    const t = await event({ teams: 6 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    for (const m of (await matchesOf(t.divisionId)).filter((x) => x.groupId)) await play(m.id);
    await fill(t);
    const gA = await groupOf(t.divisionId, "A");
    const third = (await tables(t.slug)).find((x) => x.group.id === gA.id)!.rows[2];
    const c = (await page(t.slug)).cards.get(third.name)!.controls.find((x) => x.hook === "withdraw")!;
    expect(c.question).toContain("Final will lose the pair Group A’s table put there — press “Fill resolved slots” afterwards to fill it again.");
    const url = await removePair(t, third.name);
    expect(url?.get("refill")).toBe("1");
    const p = await page(t.slug, { done: "withdrawn", team: third.teamId, refill: "1" });
    expect(p.notices.join(" ")).toContain("Press “Fill resolved slots” to fill the knockout place their group’s table decides.");
  });

  it("offers 'or remove the pair' beside a pair's last fixture only where their card does", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 1);
    await drawKnockout(t, 4);
    const t4 = t.teamIds[3];
    const theirs = between(await matchesOf(t.divisionId), t4);
    expect(await problemOf(manage.removeMatch(t.id, theirs[0].id, form({ confirm: theirs[0].rev })))).toBeNull();
    expect(await problemOf(manage.removeMatch(t.id, theirs[1].id, form({ confirm: theirs[1].rev })))).toBeNull();
    const row = (await page(t.slug)).rows.get(theirs[2].id)!;
    expect(row.locked.join(" ")).toContain("If they pulled out, give the walkover.");
    expect(row.locked.join(" ")).not.toContain("remove the pair");
  });

  it("says the knockout cannot be drawn while a group has nobody left, rather than offering it", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    const gB = await groupOf(t.divisionId, "B");
    await db.update(schema.teams).set({ withdrawnAt: new Date() }).where(eq(schema.teams.groupId, gB.id));
    const { default: Page } = await import("./page");
    const tree = await Page({ params: Promise.resolve({ slug: t.slug }), searchParams: Promise.resolve({}) });
    const said: string[] = [];
    each(tree, (el) => { if (el.props["data-draw-locked"] !== undefined) said.push(textOf(el.props.children)); });
    expect(said.join(" ")).toContain("Can’t draw the knockout — Group B has no pairs left.");
  });
});

/** Clear a walkover and play the match properly. */
async function clearAndPlay(t: Event, matchId: string) {
  const m = await stored(matchId);
  expect((await landed(manage.clearResult(t.id, matchId, form({ confirm: m.rev }))))?.get("done")).toBe("cleared");
  await play(matchId);
}

/* ── Round two of the review ─────────────────────────────────────────────── */

describe("what the second review of 8b found", () => {
  it("tells the last pair of a group, once the knockout is drawn, how a walkover reaches them — not \"only 0 would be left\"", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    const gB = await groupOf(t.divisionId, "B");
    const inB = await db.select().from(schema.teams).where(eq(schema.teams.groupId, gB.id));
    expect((await removePair(t, inB[0].name))?.get("done")).toBe("withdrawn");
    const said = (await page(t.slug)).cards.get(inB[1].name)!.locked.join(" ");
    expect(said).toContain("they are the only pair left in Group B, and the knockout takes its winner");
    expect(said).toContain("“Fill resolved slots” puts them there");
    expect(said).not.toContain("only 0");
    expect(said).not.toContain("Their results stand");
  });

  it("says what fills the other side of a knockout match before a walkover can be given there", async () => {
    const t = await event({ teams: 4 });
    await drawGroups(t, 2);
    await drawKnockout(t, 1);
    const [a] = await groupFixtures(t.divisionId, "A");
    await play(a.id);
    await fill(t);
    const final = await round(t.divisionId, "Final");
    const inFinal = (await teamRow((final.teamAId ?? final.teamBId)!)).name;
    const said = (await page(t.slug)).cards.get(inFinal)!.locked.join(" ");
    expect(said).toContain("once both sides are filled in — “Fill resolved slots” fills the other side when it is decided.");
  });

  it("names every match to undo, in the order their rows allow it, when a removal is blocked", async () => {
    const t = await event({ teams: 6 });
    await drawGroups(t, 2);
    await drawKnockout(t, 2);
    for (const m of (await matchesOf(t.divisionId)).filter((x) => x.groupId)) await play(m.id);
    await fill(t);
    await play((await round(t.divisionId, "Semi-Final 1")).id);
    await play((await round(t.divisionId, "Semi-Final 2")).id);
    await fill(t);
    await play((await round(t.divisionId, "Final")).id);
    const gA = await groupOf(t.divisionId, "A");
    const third = (await tables(t.slug)).find((x) => x.group.id === gA.id)!.rows[2];
    const said = (await page(t.slug)).cards.get(third.name)!.locked.join(" ");
    expect(said).toMatch(/Clear Final, then clear Semi-Final [12] first./);
  });

  it("says players, not pairs, when a singles knockout cannot be drawn", async () => {
    const t = await event({ teams: 4 });
    await db.update(schema.tournaments).set({ minTeamSize: 1, maxTeamSize: 1 }).where(eq(schema.tournaments.id, t.id));
    const p = await page(t.slug, { problem: "knockout-too-many", category: t.divisionId });
    expect(p.notices.join(" ")).toContain("a group there has fewer players left than the number asked");
  });

  it("says the rest withdrew on the podium of a league won by the one left", async () => {
    const t = await event({ teams: 2, shape: "league" });
    await drawGroups(t, 1);
    expect((await removePair(t, "T2"))?.get("done")).toBe("withdrawn");
    const { default: EventPage } = await import("../page");
    const words = textOf(await EventPage({ params: Promise.resolve({ slug: t.slug }) }));
    expect(words).toContain("The only pair left after the rest withdrew.");
  });
});
