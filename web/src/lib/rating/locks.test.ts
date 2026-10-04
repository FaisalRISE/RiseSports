import { describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";
import type { PartnerStat } from "./apply";

/* The lock order, read off the statements the database actually receives.
 *
 * Every rating writer must lock the MATCH row first and then the PEOPLE, all of
 * them in one statement sorted by id. Two writers that disagree about the order
 * can each hold what the other wants, and the database kills one of them — a
 * rating failure the score save swallows and nothing ever retries. PGlite runs
 * one transaction at a time, so no test here can deadlock; what it CAN do is
 * record the order, which is the thing that makes a deadlock impossible, for
 * every writer: apply and revert, tournament and community.
 *
 * Also here: the pieces step 5 added, tested directly — the revert that only
 * the deleting transaction can subtract, the check under the lock, and the
 * partner record replayed from history. */

const client = new PGlite();
const testDb = drizzle(client, { schema });

vi.mock("@/lib/db", () => ({ db: testDb }));
vi.mock("server-only", () => ({}));
/* The score actions, for the writer every score change goes through. */
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));

const dir = path.resolve(process.cwd(), "drizzle");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

const apply = await import("./apply");
const { saveScore, clearScore, generateSchedule } = await import("@/lib/community/schedule");
const { confirmPlayer } = await import("@/lib/community/roster");

/* ── Record what each transaction sends, and what is sent outside one ────── */

type TxClient = { query: (sql: string, ...rest: unknown[]) => Promise<unknown> };
const transactions: string[][] = [];
/** Each recorded transaction's bound parameters, statement by statement. */
const paramsOf = new Map<string[], unknown[][]>();
const outside: string[] = [];
const tidy = (sql: string) => sql.replace(/\s+/g, " ").trim().toLowerCase();

let depth = 0;
const originalTransaction = client.transaction.bind(client);
(client as unknown as { transaction: unknown }).transaction = (
  cb: (tx: TxClient) => Promise<unknown>,
) =>
  originalTransaction(async (tx) => {
    const sent: string[] = [];
    const bound: unknown[][] = [];
    transactions.push(sent);
    paramsOf.set(sent, bound);
    const t = tx as unknown as TxClient;
    const query = t.query.bind(t);
    t.query = (sql: string, ...rest: unknown[]) => {
      sent.push(tidy(sql));
      bound.push(Array.isArray(rest[0]) ? (rest[0] as unknown[]) : []);
      return query(sql, ...rest);
    };
    depth++;
    try {
      return await cb(t);
    } finally {
      depth--;
    }
  });
const originalQuery = client.query.bind(client);
(client as unknown as { query: unknown }).query = (sql: string, ...rest: unknown[]) => {
  if (depth === 0) outside.push(tidy(sql));
  return (originalQuery as (s: string, ...r: unknown[]) => Promise<unknown>)(sql, ...rest);
};

/** The transactions `run` opened, statement by statement, and what it sent
    outside any transaction. */
async function recorded(run: () => Promise<unknown>): Promise<{ txs: string[][]; bare: string[] }> {
  const from = transactions.length;
  const fromBare = outside.length;
  await run();
  return { txs: transactions.slice(from), bare: outside.slice(fromBare) };
}

/** The rule, over one transaction:
 *  - the very FIRST statement locks the match, before anything reads the
 *    history or a person — a read before the lock is the double subtraction
 *    and the lost update this exists to prevent, and PGlite (one transaction
 *    at a time) can only ever show it here, in the order;
 *  - the first statement to touch a person at all is the ONE sorted lock on
 *    all of them, and it covers everybody the transaction then writes;
 *  - nothing reads a player's HISTORY before that lock — the cap, the damping,
 *    the seed chain and the derived signals are all read under it (the match's
 *    own rows, found by match id, may be read before);
 *  - both locks are NO KEY UPDATE, never FOR UPDATE, which would block every
 *    insert anywhere that merely points at the row;
 *  - people are written only after that. */
function assertLockOrder(tx: string[], matchTable: "matches" | "community_matches") {
  expect(tx[0], "the first statement locks the match").toContain(`from "${matchTable}"`);
  expect(tx[0]).toMatch(/ for no key update$/);

  const touching = tx.map((s, i) => ({ s, i })).filter(({ s }) => s.includes('"people"'));
  expect(touching.length, "people are touched").toBeGreaterThan(0);
  expect(touching[0].s, "the first statement touching people is the sorted lock").toMatch(
    /^select .* from "people" .*order by "people"\."id"( asc)? for no key update$/,
  );
  expect(touching.filter(({ s }) => / for (no key )?update$/.test(s)), "people are locked in ONE statement")
    .toHaveLength(1);
  expect(touching.some(({ s }) => s.startsWith('update "people"')), "people are written").toBe(true);

  const lockAt = touching[0].i;
  const early = tx.slice(0, lockAt).filter(
    (s) => s.startsWith("select") && s.includes('from "rating_history"') && /"person_id" in \(/.test(s),
  );
  expect(early, "a player's history read before their lock").toEqual([]);

  const bound = paramsOf.get(tx)!;
  const locked = new Set(bound[lockAt].map(String));
  tx.forEach((s, i) => {
    if (!s.startsWith('update "people"')) return;
    const written = String(bound[i].at(-1));
    expect(locked.has(written), "every person written was locked first").toBe(true);
  });

  expect(tx.filter((s) => / for update$/.test(s)), "nothing takes FOR UPDATE").toEqual([]);
}

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const KEY = "pb:md";
const owner = randomUUID();
await testDb.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });

async function person(rating = 1000): Promise<string> {
  const id = randomUUID();
  await testDb.insert(schema.people).values({
    id, name: `P ${id.slice(0, 4)}`, gender: "M",
    riseRatings: { [KEY]: rating }, riseBest: rating, matchCount: {},
  });
  return id;
}

async function four() {
  return [await person(), await person(), await person(), await person()];
}

async function match(sideA: string[], sideB: string[], a = 11, b = 3): Promise<string> {
  const tournamentId = randomUUID();
  const divisionId = randomUUID();
  const [teamA, teamB, matchId] = [randomUUID(), randomUUID(), randomUUID()];
  await testDb.insert(schema.tournaments).values({
    id: tournamentId, slug: `ev-${tournamentId.slice(0, 8)}`, name: "Event", sport: "pb",
    format: "standard", ownerId: owner, status: "live",
  });
  await testDb.insert(schema.divisions).values({ id: divisionId, tournamentId, name: "Main" });
  await testDb.insert(schema.teams).values([
    { id: teamA, tournamentId, divisionId, name: "A", seed: 1 },
    { id: teamB, tournamentId, divisionId, name: "B", seed: 2 },
  ]);
  const player = (personId: string, teamId: string) => ({
    id: randomUUID(), tournamentId, teamId, personId, name: personId.slice(0, 4),
    gender: "M" as const, ratings: {},
  });
  await testDb.insert(schema.players).values([
    ...sideA.map((p) => player(p, teamA)),
    ...sideB.map((p) => player(p, teamB)),
  ]);
  await testDb.insert(schema.matches).values({
    id: matchId, tournamentId, divisionId, round: "Round 1",
    teamAId: teamA, teamBId: teamB,
    log: [], lineupA: [], lineupB: [], ackedGates: [],
    typedScoreA: a, typedScoreB: b, rev: 1,
  });
  return matchId;
}

async function communityGame(lineupA: string[], lineupB: string[]) {
  const gameId = randomUUID();
  const sessionId = randomUUID();
  const matchId = randomUUID();
  const [game] = await testDb.insert(schema.communityGames).values({
    id: gameId, slug: `g-${gameId.slice(0, 8)}`, name: "Thursday",
    courts: 1, perCourt: 4, scheduleMode: "balanced", rotation: "fixed",
  }).returning();
  await testDb.insert(schema.communitySessions).values({ id: sessionId, gameId, date: "2026-09-17" });
  await testDb.insert(schema.communityMatches).values({ id: matchId, sessionId, lineupA, lineupB });
  return { game, matchId };
}

const load = async (id: string) =>
  (await testDb.select().from(schema.people).where(eq(schema.people.id, id)))[0];

/* ── The lock order ─────────────────────────────────────────────────────── */

describe("every rating writer locks the match, then the people in id order", () => {
  /* Nothing about a player may be written outside the rating's own
     transaction: the derived signals used to be refreshed afterwards, from an
     unlocked read, and could overwrite a newer apply's with a stale answer. */
  const noPeopleWrittenOutside = (bare: string[]) =>
    expect(bare.filter((s) => s.startsWith('update "people"')), "people written outside the transaction")
      .toEqual([]);

  it("applying a tournament result", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    const { txs, bare } = await recorded(() => apply.applyMatchRatings(m));
    const writer = txs.find((tx) => tx.some((s) => s.startsWith('insert into "rating_history"')));
    expect(writer).toBeDefined();
    assertLockOrder(writer!, "matches");
    noPeopleWrittenOutside(bare);
    /* Stamped with the moment of the write, taken after the locks — the order
       the merges ran in, which is the order a revert replays them in. */
    for (const s of writer!.filter((x) => x.startsWith('insert into "rating_history"'))) {
      expect(s).toContain("clock_timestamp()");
    }
  });

  it("taking a tournament result back", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    await apply.applyMatchRatings(m);
    const { txs, bare } = await recorded(() => apply.revertMatchRatings(m));
    expect(txs).toHaveLength(1);
    assertLockOrder(txs[0], "matches");
    noPeopleWrittenOutside(bare);
  });

  /* Step 7: every score change goes through ONE writer, and a change of
     RESULT takes the old rating back in the same transaction as the write.
     The match row is the first thing that transaction touches — the UPDATE
     itself takes its lock — so the rating engine's order holds: match, then
     people. The old writer reverted in a transaction of its own AFTER the
     write, which a revert queued behind an undo could run after the match had
     been finished again, deleting the new rating. */
  it("correcting a result: the write and the revert are one transaction, match first", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    await apply.applyMatchRatings(m);
    const { recordResult } = await import("@/app/t/[slug]/actions");
    const { txs, bare } = await recorded(() => recordResult(m, { a: 11, b: 5, expectedRev: 1 }));

    const write = txs.find((tx) => tx.some((s) => s.startsWith('delete from "rating_history"')));
    expect(write, "the revert runs inside a transaction").toBeDefined();
    expect(write![0], "that transaction's first statement is the write, which locks the match").toMatch(/^update "matches" /);
    const touching = write!.filter((s) => s.includes('"people"'));
    expect(touching[0]).toMatch(/^select .* from "people" .*order by "people"\."id"( asc)? for no key update$/);
    expect(write!.filter((s) => / for update$/.test(s)), "nothing takes FOR UPDATE").toEqual([]);

    /* The new rating: its own transaction, after the commit, in the usual order. */
    const reapply = txs.find((tx) => tx.some((s) => s.startsWith('insert into "rating_history"')));
    expect(reapply).toBeDefined();
    assertLockOrder(reapply!, "matches");
    noPeopleWrittenOutside(bare);
    expect(bare.filter((s) => s.startsWith('delete from "rating_history"')), "no revert outside a transaction").toEqual([]);
  });

  /* Every writer of many of an event's matches takes the event row FIRST: the
     order of play, the draws, clearing the times and removing a category all
     write matches in their own order (a plan's, a scan's, a cascade's), and
     without one lock per event taken first two of them could each hold rows
     the other wants. */
  it("drawing up the times, clearing them, drawing and removing a category take the event row first", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    const [row] = await testDb.select().from(schema.matches).where(eq(schema.matches.id, m));
    const { applySchedule } = await import("@/lib/schedule/store");
    const sched = await recorded(() => applySchedule(row.tournamentId, {
      startsAt: new Date("2026-10-04T09:00:00Z"), courts: 2, matchMinutes: 20,
    }));
    const writes = sched.txs.find((tx) => tx.some((s) => s.startsWith('update "tournaments"')));
    expect(writes?.[0]).toMatch(/^select .* from "tournaments" .* for no key update$/);

    const { generateGroups } = await import("@/app/t/[slug]/manage/actions");
    const fd = new FormData();
    fd.set("divisionId", row.divisionId);
    fd.set("groups", "1");
    const draw = await recorded(() => generateGroups(row.tournamentId, fd).catch(() => {}));
    const drawn = draw.txs.find((tx) => tx.some((s) => s.includes('"divisions"')));
    expect(drawn?.[0]).toMatch(/^select .* from "tournaments" .* for no key update$/);

    const { clearSchedule } = await import("@/lib/schedule/store");
    const cleared = await recorded(() => clearSchedule(row.tournamentId));
    const clearing = cleared.txs.find((tx) => tx.some((s) => s.startsWith('update "matches"')));
    expect(clearing?.[0]).toMatch(/^select .* from "tournaments" .* for no key update$/);
    expect(cleared.bare.filter((s) => s.startsWith('update "matches"')), "nothing outside it").toEqual([]);

    const { removeDivision } = await import("@/app/t/[slug]/manage/registration/actions");
    const removed = await recorded(() => removeDivision(row.tournamentId, row.divisionId).catch(() => {}));
    const removing = removed.txs.find((tx) => tx.some((s) => s.startsWith('delete from "divisions"')));
    expect(removing?.[0]).toMatch(/^select .* from "tournaments" .* for no key update$/);
  });

  /* A scoring change locks the EVENT row, then every match of it in id order,
     NO KEY UPDATE throughout, in ONE transaction that never touches a person:
     the writers above take the event row first too, and a rating takes a match
     before people — so none of them can close a circle. */
  it("changing an event's scoring: the event, then its matches in id order, and no people", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    const [row] = await testDb.select().from(schema.matches).where(eq(schema.matches.id, m));
    const { setScoring } = await import("@/app/t/[slug]/manage/actions");
    const fd = new FormData();
    for (const [k, v] of Object.entries({ target: "15", winBy2: "on", goldenAt: "none", scoreType: "" })) fd.set(k, v);
    const { txs } = await recorded(() => setScoring(row.tournamentId, fd));

    const change = txs.find((tx) => tx.some((s) => s.startsWith('update "tournaments"')));
    expect(change, "the change is one transaction").toBeDefined();
    expect(change![0]).toMatch(/^select .* from "tournaments" .* for no key update$/);
    expect(change![1]).toMatch(/^select .* from "matches" .*order by "matches"\."id"( asc)? for no key update$/);
    expect(change!.filter((s) => s.includes('"people"')), "no person is touched").toEqual([]);
    expect(change!.filter((s) => / for update$/.test(s)), "nothing takes FOR UPDATE").toEqual([]);
  });

  it("applying a community result", async () => {
    const [a, b, c, d] = await four();
    const { game, matchId } = await communityGame([a, b], [c, d]);
    const { txs, bare } = await recorded(() => saveScore(game, matchId, 11, 7));
    const writer = txs.find((tx) => tx.some((s) => s.startsWith('insert into "rating_history"')));
    expect(writer).toBeDefined();
    assertLockOrder(writer!, "community_matches");
    noPeopleWrittenOutside(bare);

    /* The score is written in a transaction of its own that locked the game
       FIRST and asked "already counted?" under that lock. */
    const scoreWrite = txs.find((tx) => tx.some((s) => s.startsWith('update "community_matches"')));
    expect(scoreWrite).toBeDefined();
    expect(scoreWrite![0]).toMatch(/from "community_matches" .* for no key update$/);
    expect(scoreWrite!.findIndex((s) => s.includes('from "rating_history"')))
      .toBeLessThan(scoreWrite!.findIndex((s) => s.startsWith('update "community_matches"')));
  });

  it("clearing a community result", async () => {
    const [a, b, c, d] = await four();
    const { game, matchId } = await communityGame([a, b], [c, d]);
    await saveScore(game, matchId, 11, 7);
    const { txs, bare } = await recorded(() => clearScore(matchId));
    expect(txs).toHaveLength(1);
    assertLockOrder(txs[0], "community_matches");
    noPeopleWrittenOutside(bare);
    /* And the score is cleared in the SAME transaction as the rating. */
    expect(txs[0].some((s) => s.startsWith('update "community_matches"'))).toBe(true);
  });
  /* Regenerating deletes the evening's games, and a cascade takes any rating
     history with them — so it must LOCK them before it asks whether any has a
     score or a rating, or a save can land in between. The test in
     revert.test.ts lands a score before the transaction opens, which any
     re-check inside it sees, locked or not; only the order proves the lock. */
  it("regenerating an evening locks its games before it asks, and deletes after", async () => {
    const folk = await four();
    const { game } = await communityGame([], []);
    for (const id of folk) await confirmPlayer(game, "2026-09-17", id);
    expect(await generateSchedule(game, "2026-09-17", () => 0.5)).toMatchObject({ ok: true });

    const { txs } = await recorded(() => generateSchedule(game, "2026-09-17", () => 0.5));
    const writer = txs.find((tx) => tx.some((s) => s.startsWith('delete from "community_matches"')));
    expect(writer).toBeDefined();
    expect(writer![0]).toMatch(/^select .* from "community_matches" .*order by "community_matches"\."id"( asc)? for update$/);
    const asked = writer!.findIndex((s) => s.includes('from "rating_history"'));
    const deleted = writer!.findIndex((s) => s.startsWith('delete from "community_matches"'));
    expect(asked, "asks about ratings under the lock").toBeGreaterThan(0);
    expect(deleted).toBeGreaterThan(asked);
  });

});

/* ── The mechanisms ─────────────────────────────────────────────────────── */

describe("only the transaction that deletes a row subtracts it", () => {
  it("a second revert of the same match deletes nothing and changes nothing", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    await apply.applyMatchRatings(m);

    const first = await testDb.transaction((tx) => apply.revertMatchRatingsIn(tx as never, m));
    expect(first.reverted).toBe(4);
    const afterFirst = await load(a);

    const second = await testDb.transaction((tx) => apply.revertMatchRatingsIn(tx as never, m));
    expect(second).toEqual({ reverted: 0, personIds: [] });
    expect(await load(a)).toEqual(afterFirst);
    expect(afterFirst.riseRatings[KEY]).toBe(1000);
  });
});

describe("the check under the lock", () => {
  it("writes nothing at all when the match no longer says what was computed", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    const before = await load(a);

    const res = await apply.applyResult({
      ref: { kind: "tournament", matchId: m },
      key: KEY, winnerIds: [a, b], loserIds: [c, d], scoreW: 11, scoreL: 3,
      phase: "group", verification: "organiser", now: new Date(),
      unchanged: () => false,
    });

    expect(res).toEqual({ status: "skipped", reason: "changed" });
    expect(await load(a)).toEqual(before);
    expect(await testDb.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, m))).toHaveLength(0);
    expect(await testDb.select().from(schema.ratingLedger).where(eq(schema.ratingLedger.matchId, m))).toHaveLength(0);
  });

  it("answers 'already' from inside the lock, not with a unique-index error", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    await apply.applyMatchRatings(m);
    /* Straight to the engine, past applyMatchRatings' own early check — what a
       second apply that read before the first committed would do. */
    const again = await apply.applyResult({
      ref: { kind: "tournament", matchId: m },
      key: KEY, winnerIds: [a, b], loserIds: [c, d], scoreW: 11, scoreL: 3,
      phase: "group", verification: "organiser", now: new Date(),
    });
    expect(again).toEqual({ status: "already" });
  });

  it("skips, and says why, when a player's record has gone", async () => {
    const [a, b, c, d] = await four();
    const m = await match([a, b], [c, d]);
    const res = await apply.applyResult({
      ref: { kind: "tournament", matchId: m },
      key: KEY, winnerIds: [a, b], loserIds: [c, randomUUID()], scoreW: 11, scoreL: 3,
      phase: "group", verification: "organiser", now: new Date(),
    });
    expect(res).toEqual({ status: "skipped", reason: "a player's record is missing" });
  });
});

describe("partnerStatsFromHistory — the partner record replayed", () => {
  const note = (won: boolean, partners: string[], ratings: number[], opponents: number[]) => ({
    won, partnerIds: partners, partnerRatings: ratings, opponentRatings: opponents,
  });
  /* Uneven numbers on purpose, so every average rounds and the rounding is
     part of what has to come out the same. */
  const played = [
    note(true, ["x"], [1203], [901, 1000]),
    note(false, ["x"], [1181], [1301, 1250]),
    note(true, ["x", "y"], [1210, 987], [1011, 990, 1003]),
    note(true, ["y"], [955], [1111]),
  ];
  const rowsOf = (notes: unknown[]) =>
    /* Ids sort AGAINST the write order, as random UUIDs may: a replay by id
       alone must come out wrong here, not right by coincidence. */
    notes.map((n, i) => ({ id: `r${9 - i}`, createdAt: new Date(Date.UTC(2026, 8, 1 + i)), notes: n }));

  it("is exactly what the applies built, one merge at a time", () => {
    let built = {} as Record<string, PartnerStat>;
    for (let i = 0; i < played.length; i++) {
      built = apply.mergePartnerStats(built, played[i]);
      /* After every prefix, not only the end — a revert of the LATEST match
         replays exactly such a prefix, and must land on this. */
      expect(apply.partnerStatsFromHistory(rowsOf(played.slice(0, i + 1)))).toEqual(built);
    }
  });

  /* Rounded running averages depend on ORDER: a partner at 1000, 1001, 1003
     averages 1002 merged forwards and 1001 backwards. Data where order makes
     no difference would pass a replay that ignored it. */
  const ordered = [
    note(true, ["x"], [1000], [900]),
    note(true, ["x"], [1001], [900]),
    note(true, ["x"], [1003], [900]),
  ];
  const forwards = () => ordered.reduce((s, n) => apply.mergePartnerStats(s, n), {} as Record<string, PartnerStat>);

  it("replays in the order the rows were written, not the order handed in", () => {
    const backwards = [...ordered].reverse().reduce((s, n) => apply.mergePartnerStats(s, n), {} as Record<string, PartnerStat>);
    expect(backwards, "the data must be order-sensitive to prove anything").not.toEqual(forwards());
    expect(apply.partnerStatsFromHistory([...rowsOf(ordered)].reverse())).toEqual(forwards());
  });

  it("orders rows written in the same millisecond by id", () => {
    const at = new Date(Date.UTC(2026, 8, 1));
    const rows = ordered.map((n, i) => ({ id: `r${i}`, createdAt: at, notes: n }));
    expect(apply.partnerStatsFromHistory([...rows].reverse())).toEqual(forwards());
  });

  it("is empty with nothing left on record", () => {
    expect(apply.partnerStatsFromHistory([])).toEqual({});
  });

  /* The shape the engine's first rows really have (before be4bff2 added the
     partner statistics): partners named, no ratings recorded, never merged. */
  it("passes over rows older than partner statistics rather than counting them at nought", () => {
    const legacy = { won: true, damped: false, carried: false, opponentIds: ["o1", "o2"], partnerIds: ["x"] };
    const rows = rowsOf([legacy, { won: true }, null, played[0]]);
    expect(apply.partnerStatsFromHistory(rows)).toEqual(apply.mergePartnerStats({}, played[0]));
  });
});

