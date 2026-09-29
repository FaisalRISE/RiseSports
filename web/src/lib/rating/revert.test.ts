import { describe, it, expect, afterEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

/* Taking a rating back, and putting one on, when writes land together.
 *
 * Every test here goes through the calls the app makes — applyMatchRatings,
 * revertMatchRatings, saveScore, clearScore — and nothing newer, so the file
 * can be run against the code as it was before step 5 of fixing the live
 * formats. It was, and these fail there:
 *
 *  - two reverts of one match both subtracted it (rows read before the
 *    transaction, subtracted inside it);
 *  - two results for one player landing together kept only the second (people
 *    read before the transaction, written back as absolute values);
 *  - a revert left the partner record, the last-played date and the
 *    reliability snapshot where the match had put them;
 *  - a result changed after it was read was still applied with the old score;
 *  - a revert left behind the rating a match had CREATED (a first game in a
 *    format), at its old value with a match count of nought;
 *  - a second community save could land its score after the first one's rating;
 *  - regenerating an evening while a score landed deleted the rating history
 *    with the games and left the ratings moved.
 *
 * 22 of the 26 fail there, each for its own reason. The other four pass there
 * by design: they guard what the old code already did right and the new code
 * must keep — applying when only the serve moved (a check on the revision
 * number would fail it), taking back an older match without touching a newer
 * one, keeping a seed whose only match predates the seed flag, and a
 * reliability snapshot of the whole record.
 *
 * `afterEach` checks the invariants the whole design rests on, over everybody
 * the test made: a seed plus the sum of its recorded deltas is the rating; the
 * match count is the number of rows behind it; a format with no rows behind it
 * and no seed does not exist; `riseBest` is the best of what is held; and no
 * imbalance is on the ledger for a match with no rating behind it. */

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

const { applyMatchRatings, revertMatchRatings } = await import("./apply");
const { saveScore, clearScore, generateSchedule } = await import("@/lib/community/schedule");
const { confirmPlayer } = await import("@/lib/community/roster");
const { marginMultiplier } = await import("@/lib/rating");
const { reliabilityForPerson } = await import("./reliability");

/* ── A hook on the database's transactions ─────────────────────────────────
 * Runs ONE write just before the next transaction opens: the moment between an
 * apply reading the match and writing the rating, which is where a correction
 * from another phone lands in real life. */
let beforeNextTx: (() => Promise<unknown>) | null = null;
const originalTransaction = client.transaction.bind(client);
(client as unknown as { transaction: unknown }).transaction = async (
  cb: Parameters<typeof client.transaction>[0],
) => {
  if (beforeNextTx) {
    const run = beforeNextTx;
    beforeNextTx = null;
    await run();
  }
  return originalTransaction(cb);
};

/* ── Fixtures ──────────────────────────────────────────────────────────── */

const KEY = "pb:md";
/** The people THIS test made, and what they started on. Scoped to the test so
    one that breaks the invariant cannot fail every test after it. */
const seeds = new Map<string, { key: string; rating: number }>();
const owner = randomUUID();
await testDb.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });

/** A player seeded at `rating` in ONE format — a man in men's doubles unless told otherwise. */
async function person(rating = 1000, key = KEY, gender: "M" | "F" = "M"): Promise<string> {
  const id = randomUUID();
  seeds.set(id, { key, rating });
  await testDb.insert(schema.people).values({
    id, name: `P ${id.slice(0, 4)}`, gender,
    riseRatings: { [key]: rating }, riseBest: rating, matchCount: {},
  });
  return id;
}

/** One event, one category, one match between two men's pairs, typed a–b. */
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

/** Another pair in the same category as a match, for a correction to put on court. */
async function teamInMatchCategory(matchId: string, personIds: string[]): Promise<string> {
  const [m] = await testDb.select().from(schema.matches).where(eq(schema.matches.id, matchId));
  const teamId = randomUUID();
  await testDb.insert(schema.teams).values({
    id: teamId, tournamentId: m.tournamentId, divisionId: m.divisionId, name: "C", seed: 3,
  });
  await testDb.insert(schema.players).values(personIds.map((personId) => ({
    id: randomUUID(), tournamentId: m.tournamentId, teamId, personId, name: personId.slice(0, 4),
    gender: "M" as const, ratings: {},
  })));
  return teamId;
}

const load = async (id: string) =>
  (await testDb.select().from(schema.people).where(eq(schema.people.id, id)))[0];
const historyOf = async (id: string) =>
  testDb.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.personId, id));

/* ── The invariant, over everybody the test made, after every test ─────── */

afterEach(async () => {
  beforeNextTx = null;
  const made = new Map(seeds);
  seeds.clear();
  const folk = (await testDb.select().from(schema.people)).filter((p) => made.has(p.id));
  const rows = await testDb.select().from(schema.ratingHistory);
  for (const p of folk) {
    const seed = made.get(p.id)!;
    const mine = rows.filter((r) => r.personId === p.id);
    const keys = new Set([
      ...Object.keys(p.matchCount ?? {}), ...Object.keys(p.riseRatings ?? {}), ...mine.map((r) => r.format), seed.key,
    ]);
    for (const k of keys) {
      const behind = mine.filter((r) => r.format === k);
      const sum = behind.reduce((s, r) => s + r.deltaApplied, 0);
      if (k === seed.key) {
        expect(p.riseRatings[k], `${p.name} rating for ${k}`).toBe(seed.rating + sum);
        expect(p.matchCount?.[k] ?? 0, `${p.name} match count for ${k}`).toBe(behind.length);
      } else if (behind.length === 0) {
        /* A format only matches created, with every one of them taken back. */
        expect(k in (p.riseRatings ?? {}), `${p.name} still holds ${k}`).toBe(false);
        expect(k in (p.matchCount ?? {}), `${p.name} still counts ${k}`).toBe(false);
      } else {
        expect(p.matchCount?.[k], `${p.name} match count for ${k}`).toBe(behind.length);
      }
    }
    const held = Object.values(p.riseRatings ?? {});
    expect(p.riseBest, `${p.name} best rating`).toBe(held.length ? Math.max(...held) : null);
  }

  /* An imbalance on the ledger is only ever there beside the rating it came with. */
  for (const l of await testDb.select().from(schema.ratingLedger)) {
    const behind = rows.some((r) =>
      l.matchId ? r.matchId === l.matchId : r.communityMatchId === l.communityMatchId,
    );
    expect(behind, `ledger row ${l.id} has a rating behind it`).toBe(true);
  }
});

/* ── Tournament ──────────────────────────────────────────────────────────── */

describe("taking a tournament result back", () => {
  it("takes it back ONCE when two reverts of the same match land together", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const m = await match([a, b], [c, d]);
    expect((await applyMatchRatings(m)).status).toBe("applied");
    expect((await load(a)).riseRatings[KEY]).not.toBe(1000);

    const [first, second] = await Promise.all([revertMatchRatings(m), revertMatchRatings(m)]);

    /* Four rows came off, and only one of the two reverts took them. */
    expect(first.reverted + second.reverted).toBe(4);
    for (const id of [a, b, c, d]) {
      const p = await load(id);
      expect(p.riseRatings[KEY]).toBe(1000);
      expect(p.matchCount[KEY]).toBe(0);
    }
  });

  it("counts BOTH results when two matches for one player are rated at the same moment", async () => {
    const shared = await person();
    const [b, c, d, f, g, h] = [
      await person(), await person(), await person(), await person(), await person(), await person(),
    ];
    const m1 = await match([shared, b], [c, d]);
    const m2 = await match([shared, f], [g, h]);

    const res = await Promise.all([applyMatchRatings(m1), applyMatchRatings(m2)]);
    expect(res.map((r) => r.status)).toEqual(["applied", "applied"]);

    const p = await load(shared);
    const rows = (await historyOf(shared)).sort((x, y) => x.ratingBefore - y.ratingBefore);
    expect(rows).toHaveLength(2);
    expect(p.matchCount[KEY]).toBe(2);
    expect(p.riseRatings[KEY]).toBe(1000 + rows[0].deltaApplied + rows[1].deltaApplied);

    /* And the second was computed FROM the first: its "before" is the first's
       "after". Read before the lock, both started at 1000. */
    const [early, late] = rows[0].ratingBefore === 1000 ? rows : [rows[1], rows[0]];
    expect(early.ratingBefore).toBe(1000);
    expect(late.ratingBefore).toBe(early.ratingAfter);
  });

  it("puts the partner record back when a match is taken back", async () => {
    const [me, partner] = [await person(), await person()];
    const [c, d, g, h] = [await person(), await person(), await person(), await person()];
    const m1 = await match([me, partner], [c, d]);
    const m2 = await match([me, partner], [g, h], 11, 9);

    await applyMatchRatings(m1);
    const afterOne = (await load(me)).partnerStats as Record<string, Record<string, number>>;
    await applyMatchRatings(m2);
    expect(((await load(me)).partnerStats as Record<string, Record<string, number>>)[partner].matches).toBe(2);

    await revertMatchRatings(m2);
    /* Exactly, averages included: the record is replayed from what is left. */
    expect((await load(me)).partnerStats).toEqual(afterOne);

    /* And with no match left together, they never partnered at all. */
    await revertMatchRatings(m1);
    expect(((await load(me)).partnerStats as Record<string, unknown>)[partner]).toBeUndefined();
  });

  it("puts 'last played' back to the match before, then to never", async () => {
    const me = await person();
    const [b, c, d, f, g, h] = [
      await person(), await person(), await person(), await person(), await person(), await person(),
    ];
    const m1 = await match([me, b], [c, d]);
    const m2 = await match([me, f], [g, h]);

    await applyMatchRatings(m1);
    const [firstRow] = await historyOf(me);
    await applyMatchRatings(m2);

    await revertMatchRatings(m2);
    expect((await load(me)).lastPlayedAt?.getTime()).toBe(firstRow.createdAt.getTime());

    await revertMatchRatings(m1);
    expect((await load(me)).lastPlayedAt).toBeNull();
  });

  it("leaves no reliability behind for a player whose only match is taken back", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const m = await match([a, b], [c, d]);

    await applyMatchRatings(m);
    expect((await load(a)).reliability).not.toBeNull();

    await revertMatchRatings(m);
    expect((await load(a)).reliability).toBeNull();
  });

  it("does not apply a result that changed after it was read", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const m = await match([a, b], [c, d], 11, 3);

    /* A correction to 11–9 commits between the apply reading 11–3 and the
       apply writing it. */
    beforeNextTx = () =>
      testDb.update(schema.matches).set({ typedScoreB: 9, rev: 2 }).where(eq(schema.matches.id, m));

    const stale = await applyMatchRatings(m);
    expect(stale).toEqual({ status: "skipped", reason: "changed" });
    expect(await historyOf(a)).toHaveLength(0);

    /* The write that corrected it is the one that rates it — on 11–9. */
    expect((await applyMatchRatings(m)).status).toBe("applied");
    const [row] = await historyOf(a);
    expect(Math.round(marginMultiplier(11, 9) * 1000)).not.toBe(Math.round(marginMultiplier(11, 3) * 1000));
    expect(row.marginMultiplier).toBe(Math.round(marginMultiplier(11, 9) * 1000));
  });

  /* The same check, for each thing the rating is computed from: a correction
     that keeps the scores and swaps the sides changes only the WINNER; one
     that puts the right team on side B changes only the LOSER; renaming the
     round changes only the STAGE, and with it the weight the rating carries. */
  it("does not apply a result whose winner changed after it was read", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const m = await match([a, b], [c, d], 11, 3);
    beforeNextTx = () =>
      testDb.update(schema.matches).set({ typedScoreA: 3, typedScoreB: 11, rev: 2 }).where(eq(schema.matches.id, m));

    expect(await applyMatchRatings(m)).toEqual({ status: "skipped", reason: "changed" });
    expect((await applyMatchRatings(m)).status).toBe("applied");
    expect((await historyOf(c))[0].deltaApplied).toBeGreaterThan(0);
    expect((await historyOf(a))[0].deltaApplied).toBeLessThan(0);
  });

  it("does not apply a result whose loser changed after it was read", async () => {
    const [a, b, c, d, e, f] = [
      await person(), await person(), await person(), await person(), await person(), await person(),
    ];
    const m = await match([a, b], [c, d]);
    const other = await teamInMatchCategory(m, [e, f]);
    beforeNextTx = () =>
      testDb.update(schema.matches).set({ teamBId: other, rev: 2 }).where(eq(schema.matches.id, m));

    expect(await applyMatchRatings(m)).toEqual({ status: "skipped", reason: "changed" });
    expect(await historyOf(c)).toHaveLength(0);
    expect((await applyMatchRatings(m)).status).toBe("applied");
    expect(await historyOf(e)).toHaveLength(1);
  });

  it("does not apply a result whose stage changed after it was read", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const m = await match([a, b], [c, d]);
    beforeNextTx = () =>
      testDb.update(schema.matches).set({ round: "Final", rev: 2 }).where(eq(schema.matches.id, m));

    expect(await applyMatchRatings(m)).toEqual({ status: "skipped", reason: "changed" });
    expect((await applyMatchRatings(m)).status).toBe("applied");
  });

  it("does not apply a result whose winner's score alone changed after it was read", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    /* 15–9 typed by habit in an event to 11, corrected to 11–9: same winner,
       same loser, same losing score — only the margin moved. */
    const m = await match([a, b], [c, d], 15, 9);
    beforeNextTx = () =>
      testDb.update(schema.matches).set({ typedScoreA: 11, rev: 2 }).where(eq(schema.matches.id, m));

    expect(await applyMatchRatings(m)).toEqual({ status: "skipped", reason: "changed" });
    expect((await applyMatchRatings(m)).status).toBe("applied");
    expect(Math.round(marginMultiplier(15, 9) * 1000)).not.toBe(Math.round(marginMultiplier(11, 9) * 1000));
    expect((await historyOf(a))[0].marginMultiplier).toBe(Math.round(marginMultiplier(11, 9) * 1000));
  });

  /* What a correction to an EARLIER match does (setTypedScore reverts it and
     re-applies it): the newer match's movement must stay where it is. A revert
     that put the rating back to the old match's "before" would throw it away. */
  it("takes back an older match without touching the newer one's movement", async () => {
    const me = await person();
    const [b, c, d, f, g, h] = [
      await person(), await person(), await person(), await person(), await person(), await person(),
    ];
    const m1 = await match([me, b], [c, d]);
    const m2 = await match([me, f], [g, h], 11, 9);
    await applyMatchRatings(m1);
    await applyMatchRatings(m2);
    const later = (await historyOf(me)).find((r) => r.matchId === m2)!.deltaApplied;

    await revertMatchRatings(m1);
    expect((await load(me)).riseRatings[KEY]).toBe(1000 + later);
  });

  /* The partner record's averages are rounded as they go, so the ORDER they
     are merged in shows: a partner at 1000, 1001, 1003 averages 1002 in that
     order and 1001 the other way. A revert replays what is left; it must
     replay it in the order it was played, which the row ids do not give —
     they are random. So the ids here are rewritten to sort newest first. */
  it("replays the partner record in the order the matches were played, whatever the ids", async () => {
    const me = await person();
    const partner = randomUUID(); // not in the invariant: its rating is set by hand
    await testDb.insert(schema.people).values({
      id: partner, name: "Partner", gender: "M", riseRatings: { [KEY]: 1000 }, riseBest: 1000, matchCount: {},
    });

    const played: string[] = [];
    let afterThree: unknown = null;
    for (const [i, level] of [1000, 1001, 1003, 1010].entries()) {
      await testDb.update(schema.people).set({ riseRatings: { [KEY]: level } }).where(eq(schema.people.id, partner));
      const m = await match([me, partner], [await person(), await person()], 11, 3 + i);
      await applyMatchRatings(m);
      played.push(m);
      if (i === 2) afterThree = (await load(me)).partnerStats;
    }

    const mine = (await historyOf(me)).sort((x, y) => x.createdAt.getTime() - y.createdAt.getTime());
    for (const [i, r] of mine.entries()) {
      await testDb.update(schema.ratingHistory).set({ id: `zz${9 - i}` }).where(eq(schema.ratingHistory.id, r.id));
    }

    await revertMatchRatings(played[3]);
    expect((await load(me)).partnerStats).toEqual(afterThree);
  });

  it("still applies when something beside the result changed", async () => {

    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const m = await match([a, b], [c, d]);

    /* What setMatchSetup does to a typed-score match: the serve and the
       revision move, the result does not. Nobody re-applies after it, so a
       check on the revision here would leave this match with no rating. */
    beforeNextTx = () =>
      testDb.update(schema.matches).set({ server: "b", rev: 7 }).where(eq(schema.matches.id, m));

    expect((await applyMatchRatings(m)).status).toBe("applied");
  });
});

/* ── A format the matches created ───────────────────────────────────────── */

describe("a format that only matches created", () => {
  /* Seeded in men's SINGLES, playing men's DOUBLES: the doubles rating is one
     the matches create. Taking them all back must take it away again — it was
     left at the old value with a count of nought, and for a player seeded by
     DUPR or an organiser every key counts toward their level.

     Seeded BELOW the default 750 the created rating starts from, so a best
     rating worked out before the created one is removed comes out wrong. */
  it("goes when its only match is taken back, leaving the seed as it was", async () => {
    const newcomer = await person(600, "pb:ms");
    const [b, c, d] = [await person(), await person(), await person()];
    const m = await match([newcomer, b], [c, d]);

    await applyMatchRatings(m);
    expect((await load(newcomer)).riseRatings[KEY]).toBeDefined();

    await revertMatchRatings(m);
    const p = await load(newcomer);
    expect(p.riseRatings).toEqual({ "pb:ms": 600 });
    expect(p.matchCount).toEqual({});
    expect(p.riseBest).toBe(600);
  });

  it("goes whichever order its matches are taken back in, and after a correction", async () => {
    const newcomer = await person(600, "pb:ms");
    const [b, c, d, f, g, h] = [
      await person(), await person(), await person(), await person(), await person(), await person(),
    ];
    const m1 = await match([newcomer, b], [c, d]);
    const m2 = await match([newcomer, f], [g, h]);
    await applyMatchRatings(m1);
    await applyMatchRatings(m2);

    /* The OLDER match first, while the newer one still stands on the format… */
    await revertMatchRatings(m1);
    expect((await load(newcomer)).riseRatings[KEY]).toBeDefined();
    /* …then corrected and re-applied under it, as setTypedScore does… */
    await applyMatchRatings(m1);
    /* …and then everything taken back. */
    await revertMatchRatings(m2);
    await revertMatchRatings(m1);
    expect((await load(newcomer)).riseRatings).toEqual({ "pb:ms": 600 });
  });

  /* The common case, and the one a newcomer cannot show: an established men's
     doubles player's first MIXED game, typed and cleared. Their doubles rows
     are still there, so "is anything left?" and "is this chain seeded?" must
     both be asked of the mixed rating alone. */
  it("goes for a player who already has matches in another format", async () => {
    const regular = await person();
    const [b, c, d] = [await person(), await person(), await person()];
    await applyMatchRatings(await match([regular, b], [c, d]));

    const [w1, w2] = [await person(1000, "pb:wd", "F"), await person(1000, "pb:wd", "F")];
    const man = await person();
    const { game, matchId } = await communityGame([regular, w1], [man, w2]);
    expect(await saveScore(game, matchId, 11, 7)).toMatchObject({ ok: true, ratingApplied: true });
    expect((await load(regular)).riseRatings["pb:mx"]).toBeDefined();

    await clearScore(matchId);
    const p = await load(regular);
    expect("pb:mx" in p.riseRatings, "mixed rating left behind with no match").toBe(false);
    expect("pb:mx" in p.matchCount).toBe(false);
    expect(p.matchCount[KEY]).toBe(1);
  });
});

/* ── Rows written before the seed flag existed ─────────────────────────── */

describe("history written before a row said whether its chain was seeded", () => {
  /* Anything rated on the live site before this change carries no flag. The
     rule is that such a row counts as SEEDED — the answer that never deletes
     anything — so a real seed is never lost to an old row. */
  const stripFlag = (matchId: string) =>
    testDb.execute(sql`update rating_history set notes = notes - 'seeded' where match_id = ${matchId}`);

  it("keeps a seed when its only match is an old row", async () => {
    const seeded = await person();
    const [b, c, d] = [await person(), await person(), await person()];
    const m0 = await match([seeded, b], [c, d]);
    await applyMatchRatings(m0);
    await stripFlag(m0);

    await revertMatchRatings(m0);
    expect((await load(seeded)).riseRatings[KEY]).toBe(1000);
  });

  it("marks a new row on an old chain as seeded, so the seed survives both going", async () => {
    const seeded = await person();
    const [b, c, d, f, g, h] = [
      await person(), await person(), await person(), await person(), await person(), await person(),
    ];
    const m0 = await match([seeded, b], [c, d]);
    await applyMatchRatings(m0);
    await stripFlag(m0);

    const m1 = await match([seeded, f], [g, h]);
    await applyMatchRatings(m1);
    const [row] = (await historyOf(seeded)).filter((r) => r.matchId === m1);
    expect((row.notes as { seeded?: boolean }).seeded).toBe(true);

    await revertMatchRatings(m0);
    await revertMatchRatings(m1);
    expect((await load(seeded)).riseRatings[KEY]).toBe(1000);
  });
});

/* ── Community ───────────────────────────────────────────────────────────── */

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

describe("taking a community result back", () => {
  it("takes it back ONCE when a score is cleared twice at the same moment", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const { game, matchId } = await communityGame([a, b], [c, d]);

    expect(await saveScore(game, matchId, 11, 7)).toMatchObject({ ok: true, ratingApplied: true });
    await Promise.all([clearScore(matchId), clearScore(matchId)]);

    for (const id of [a, b, c, d]) expect((await load(id)).riseRatings[KEY]).toBe(1000);
  });

  it("rates the score the game is left showing when two saves land together", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const { game, matchId } = await communityGame([a, b], [c, d]);

    const settled = await Promise.allSettled([
      saveScore(game, matchId, 11, 7),
      saveScore(game, matchId, 7, 11),
    ]);
    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);

    const [m] = await testDb.select().from(schema.communityMatches).where(eq(schema.communityMatches.id, matchId));
    const winners = m.scoreA! > m.scoreB! ? [a, b] : [c, d];
    const losers = m.scoreA! > m.scoreB! ? [c, d] : [a, b];
    for (const id of winners) expect((await load(id)).riseRatings[KEY]).toBeGreaterThan(1000);
    for (const id of losers) expect((await load(id)).riseRatings[KEY]).toBeLessThan(1000);
  });

  /* The ordering the one above cannot reach. A second phone's save passes
     "already counted?" before the first save's rating is in, and its score
     lands AFTER it: the game used to show the second phone's winner with the
     ratings moved for the first's. Asked and written under the game's lock,
     the second save finds the first rating and is refused, score untouched. */
  it("refuses a save that arrives once the game has counted, and leaves the score alone", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const { game, matchId } = await communityGame([a, b], [c, d]);

    beforeNextTx = () => saveScore(game, matchId, 11, 7);
    const late = await saveScore(game, matchId, 7, 11);

    expect(late).toEqual({ ok: false, error: "This score is already counted. Ask an organiser to undo it first." });
    const [m] = await testDb.select().from(schema.communityMatches).where(eq(schema.communityMatches.id, matchId));
    expect([m.scoreA, m.scoreB]).toEqual([11, 7]);
    for (const id of [a, b]) expect((await load(id)).riseRatings[KEY]).toBeGreaterThan(1000);
    for (const id of [c, d]) expect((await load(id)).riseRatings[KEY]).toBeLessThan(1000);
  });

  /* Regenerating replaces the evening's games, and ON DELETE CASCADE takes any
     rating history with them — so it must not run over a scored game. Its
     check used to hold nothing: a score saved between the check and the
     delete lost its history while the players kept the movement, and nothing
     could take it back. */
  it("refuses to regenerate an evening a score landed on while it was being built", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const { game } = await communityGame([], []);
    for (const id of [a, b, c, d]) await confirmPlayer(game, "2026-09-17", id);
    expect(await generateSchedule(game, "2026-09-17", () => 0.5)).toMatchObject({ ok: true });

    const [session] = await testDb.select().from(schema.communitySessions)
      .where(eq(schema.communitySessions.gameId, game.id));
    const [first] = await testDb.select().from(schema.communityMatches)
      .where(eq(schema.communityMatches.sessionId, session.id));

    beforeNextTx = () => saveScore(game, first.id, 11, 7);
    const again = await generateSchedule(game, "2026-09-17", () => 0.5);

    expect(again).toEqual({ ok: false, error: "Scores have already been entered — clear them first." });
    expect(await testDb.select().from(schema.ratingHistory)
      .where(eq(schema.ratingHistory.communityMatchId, first.id))).toHaveLength(4);
  });

  /* A save writes the score and rates it in two transactions. A regenerate in
     between found no RATING yet, so it deleted the game — score and all — and
     the save's rating then found no game. Scored is the score. */
  it("refuses to regenerate over a score that is saved but not yet rated", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const { game } = await communityGame([], []);
    for (const id of [a, b, c, d]) await confirmPlayer(game, "2026-09-17", id);
    expect(await generateSchedule(game, "2026-09-17", () => 0.5)).toMatchObject({ ok: true });

    const [session] = await testDb.select().from(schema.communitySessions)
      .where(eq(schema.communitySessions.gameId, game.id));
    const [first] = await testDb.select().from(schema.communityMatches)
      .where(eq(schema.communityMatches.sessionId, session.id));

    beforeNextTx = () =>
      testDb.update(schema.communityMatches).set({ scoreA: 11, scoreB: 7 }).where(eq(schema.communityMatches.id, first.id));
    const again = await generateSchedule(game, "2026-09-17", () => 0.5);

    expect(again).toEqual({ ok: false, error: "Scores have already been entered — clear them first." });
    const [kept] = await testDb.select().from(schema.communityMatches).where(eq(schema.communityMatches.id, first.id));
    expect([kept?.scoreA, kept?.scoreB]).toEqual([11, 7]);
  });

  /* Two saves agreeing on the WINNER and differing on the margin: a check that
     asked only who won would let the first save's margin stand under the
     second save's score. */
  it("rates the margin the game is left showing when two saves agree on the winner", async () => {
    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const { game, matchId } = await communityGame([a, b], [c, d]);

    const settled = await Promise.allSettled([
      saveScore(game, matchId, 11, 7),
      saveScore(game, matchId, 11, 9),
    ]);
    expect(settled.map((s) => s.status)).toEqual(["fulfilled", "fulfilled"]);

    const [m] = await testDb.select().from(schema.communityMatches).where(eq(schema.communityMatches.id, matchId));
    expect(Math.round(marginMultiplier(11, 7) * 1000)).not.toBe(Math.round(marginMultiplier(11, 9) * 1000));
    expect((await historyOf(a))[0].marginMultiplier).toBe(Math.round(marginMultiplier(m.scoreA!, m.scoreB!) * 1000));
  });

  /* The stored reliability snapshot is of the WHOLE record — every format and
     both halves of the app — computed under the locks inside the rating's own
     write. The organiser's player picker reads it. */
  it("stores the reliability of the player's whole record, every format counted", async () => {
    const regular = await person();
    const [b, c, d] = [await person(), await person(), await person()];
    await applyMatchRatings(await match([regular, b], [c, d]));

    const [w1, w2] = [await person(1000, "pb:wd", "F"), await person(1000, "pb:wd", "F")];
    const man = await person();
    const { game, matchId } = await communityGame([regular, w1], [man, w2]);
    await saveScore(game, matchId, 11, 7);

    const rows = await historyOf(regular);
    expect(new Set(rows.map((r) => r.format))).toEqual(new Set([KEY, "pb:mx"]));
    expect((await load(regular)).reliability).toBe(reliabilityForPerson(rows as never, regular, new Date()).score);
  });

  it("puts the partner record and 'last played' back when a score is cleared", async () => {

    const [a, b, c, d] = [await person(), await person(), await person(), await person()];
    const { game, matchId } = await communityGame([a, b], [c, d]);

    await saveScore(game, matchId, 11, 7);
    expect(((await load(a)).partnerStats as Record<string, unknown>)[b]).toBeDefined();

    await clearScore(matchId);
    const p = await load(a);
    expect((p.partnerStats as Record<string, unknown>)[b]).toBeUndefined();
    expect(p.lastPlayedAt).toBeNull();
    expect(p.reliability).toBeNull();
  });
});
