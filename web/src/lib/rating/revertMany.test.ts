import { describe, it, expect, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { asc, eq, inArray } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

/* Taking MANY tournament results back at once — "Start this category again"
 * (step 8) — must leave every player EXACTLY as taking them back one at a time
 * would: ratings, match counts, a format the matches created, the partner
 * record, "last played", the under-rated flag and the reliability snapshot.
 *
 * The ORACLE below is the one-match revert as it stood before the batch
 * existed, copied in verbatim — not the new code run twice, which would share
 * its mistakes. The batch and today's one-match revert now share one function
 * for the per-person arithmetic; the oracle does not.
 *
 * Every comparison runs inside a transaction that is rolled back, so each
 * starts from the same played-out state. */

const client = new PGlite();
const testDb = drizzle(client, { schema });

vi.mock("@/lib/db", () => ({ db: testDb }));
vi.mock("server-only", () => ({}));
/* One person's derived signals can be made to fail, as a slip in that
   arithmetic would: the rating must still be written, and their flags and
   reliability left exactly as they were. */
const poison = vi.hoisted(() => ({ personId: null as string | null }));
vi.mock("@/lib/rating/reliability", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/rating/reliability")>();
  return {
    ...orig,
    reliabilityForPerson: (...a: Parameters<typeof orig.reliabilityForPerson>) => {
      if (poison.personId && a[1] === poison.personId) throw new Error("derived signals failed");
      return orig.reliabilityForPerson(...a);
    },
  };
});

const dir = path.resolve(process.cwd(), "drizzle");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

const apply = await import("./apply");
const { people, ratingHistory, ratingLedger } = schema;
type Tx = Parameters<Parameters<typeof testDb.transaction>[0]>[0];
type Person = typeof people.$inferSelect;

/* ── The oracle: revertResultIn as it was before the batch (f4eb188) ─────── */

const oracleHistoryFor = (tx: Tx, ids: string[]) =>
  tx
    .select({
      id: ratingHistory.id,
      personId: ratingHistory.personId,
      format: ratingHistory.format,
      createdAt: ratingHistory.createdAt,
      ratingBefore: ratingHistory.ratingBefore,
      notes: ratingHistory.notes,
    })
    .from(ratingHistory)
    .where(inArray(ratingHistory.personId, ids));

const oracleBestOf = (ratings: Record<string, number>): number | null => {
  const values = Object.values(ratings);
  return values.length ? Math.max(...values) : null;
};

async function oracleRevert(tx: Tx, matchId: string, now: Date) {
  await apply.lockMatch(tx as never, { kind: "tournament", matchId });

  const gone = await tx.delete(ratingHistory).where(eq(ratingHistory.matchId, matchId)).returning();
  await tx.delete(ratingLedger).where(eq(ratingLedger.matchId, matchId));
  if (gone.length === 0) return { reverted: 0, personIds: [] as string[] };

  const folk = await apply.lockPeople(tx as never, gone.map((r) => r.personId));
  const ids = folk.map((p) => p.id);
  const remaining = await oracleHistoryFor(tx, ids);

  for (const person of folk) {
    const ratings = { ...(person.riseRatings ?? {}) };
    const counts = { ...(person.matchCount ?? {}) };
    const mine = remaining.filter((r) => r.personId === person.id);

    for (const r of gone.filter((g) => g.personId === person.id)) {
      const current = ratings[r.format] ?? r.ratingAfter;
      ratings[r.format] = current - r.deltaApplied;
      counts[r.format] = Math.max(0, (counts[r.format] ?? 1) - 1);

      const createdByMatches = (r.notes as { seeded?: unknown } | null)?.seeded === false;
      if (createdByMatches && !mine.some((m) => m.format === r.format)) {
        delete ratings[r.format];
        delete counts[r.format];
      }
    }

    const riseBest = oracleBestOf(ratings);
    const last = mine.reduce<Date | null>((at, r) => (at && at >= r.createdAt ? at : r.createdAt), null);

    await tx
      .update(people)
      .set({
        riseRatings: ratings,
        riseBest,
        matchCount: counts,
        partnerStats: apply.partnerStatsFromHistory(mine),
        lastPlayedAt: last,
        ...(apply.derivedFor(person, remaining, riseBest, now) ?? {}),
      })
      .where(eq(people.id, person.id));
  }

  return { reverted: gone.length, personIds: ids };
}

/* ── Fixtures: eight players, eight matches, overlapping ─────────────────── */

const owner = randomUUID();
await testDb.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });

async function person(name: string, gender: "M" | "F", rating: number): Promise<string> {
  const id = randomUUID();
  const key = gender === "M" ? "pb:md" : "pb:wd";
  await testDb.insert(people).values({
    id, name, gender, riseRatings: { [key]: rating }, riseBest: rating, matchCount: {},
  });
  return id;
}

/** One event per match, no gender rule, so the PAIRS decide the format: two
    men's pairs are men's doubles, two mixed pairs are mixed. */
async function match(sideA: string[], sideB: string[], a: number, b: number, outcome: "walkover" | null = null) {
  const [tournamentId, divisionId, teamA, teamB, matchId] =
    [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await testDb.insert(schema.tournaments).values({
    id: tournamentId, slug: `rm-${tournamentId.slice(0, 8)}`, name: "Event", sport: "pb",
    format: "standard", ownerId: owner, status: "live",
  });
  await testDb.insert(schema.divisions).values({ id: divisionId, tournamentId, name: "Main" });
  await testDb.insert(schema.teams).values([
    { id: teamA, tournamentId, divisionId, name: "A", seed: 1 },
    { id: teamB, tournamentId, divisionId, name: "B", seed: 2 },
  ]);
  const genders = new Map((await testDb.select().from(people).where(inArray(people.id, [...sideA, ...sideB])))
    .map((p) => [p.id, p.gender]));
  const player = (personId: string, teamId: string) => ({
    id: randomUUID(), tournamentId, teamId, personId, name: personId.slice(0, 4),
    gender: genders.get(personId) as "M" | "F", ratings: {},
  });
  await testDb.insert(schema.players).values([...sideA.map((p) => player(p, teamA)), ...sideB.map((p) => player(p, teamB))]);
  await testDb.insert(schema.matches).values({
    id: matchId, tournamentId, divisionId, round: "Round 1", teamAId: teamA, teamBId: teamB,
    log: [], lineupA: [], lineupB: [], ackedGates: [], typedScoreA: a, typedScoreB: b, outcome, rev: 1,
  });
  return matchId;
}

const [A, B, C, D, E, F] = [
  await person("A", "M", 1000), await person("B", "M", 1050), await person("C", "M", 950),
  await person("D", "M", 1100), await person("E", "M", 1000), await person("F", "M", 900),
];
const [W1, W2] = [await person("W1", "F", 1000), await person("W2", "F", 980)];
const everyone = [A, B, C, D, E, F, W1, W2];

/* Applied in this order. m1, m4 and m7 are the same four people three times
   (repeat damping); m3, m6 and m8 are mixed, a format each of them gets only
   from matches; m9 is a walkover, which moved nothing. */
const m: string[] = [];
for (const [sa, sb, a, b] of [
  [[A, B], [C, D], 11, 5],
  [[A, C], [B, E], 11, 9],
  [[A, W1], [F, W2], 11, 3],
  [[A, B], [C, D], 9, 11],
  [[E, F], [A, D], 11, 7],
  [[C, W1], [B, W2], 11, 6],
  [[A, B], [C, D], 11, 8],
  [[D, W2], [E, W1], 11, 2],
] as [string[], string[], number, number][]) {
  const id = await match(sa, sb, a, b);
  expect((await apply.applyMatchRatings(id)).status).toBe("applied");
  m.push(id);
}
m.push(await match([A, D], [E, F], 11, 0, "walkover"));

/* Flags that are not all empty, so both halves of the batch's flags rule are
   seen: A carries one the derived signals do not own (kept when they fail),
   and B an under-rated flag the record left after a revert does not support
   (cleared, as the one-match revert clears it). With every fixture's flags {}
   "keep", "overwrite" and "always keep" all looked the same. */
await testDb.update(people).set({ flags: { organiserNote: "kept" } }).where(eq(people.id, A));
await testDb.update(people).set({ flags: { underRated: true, underRatedBy: 140, flaggedAt: "2026-10-01T00:00:00.000Z" } })
  .where(eq(people.id, B));

/* ── Comparing ───────────────────────────────────────────────────────────── */

const NOW = new Date("2026-10-11T12:00:00Z");

/** Everything a revert may change, for everybody, plus what is left on record. */
async function snapshot(tx: Tx) {
  const folk = await tx.select().from(people).where(inArray(people.id, everyone)).orderBy(asc(people.id));
  const history = await tx.select({ id: ratingHistory.id }).from(ratingHistory).orderBy(asc(ratingHistory.id));
  const ledger = await tx.select({ id: ratingLedger.id }).from(ratingLedger).orderBy(asc(ratingLedger.id));
  return {
    people: folk.map((p: Person) => ({
      id: p.id,
      riseRatings: p.riseRatings,
      riseBest: p.riseBest,
      matchCount: p.matchCount,
      partnerStats: p.partnerStats,
      lastPlayedAt: p.lastPlayedAt ? p.lastPlayedAt.toISOString() : null,
      flags: p.flags,
      reliability: p.reliability,
    })),
    history: history.map((h) => h.id),
    ledger: ledger.map((l) => l.id),
  };
}
type Snapshot = Awaited<ReturnType<typeof snapshot>>;

class Rollback extends Error {
  constructor(readonly state: Snapshot, readonly answer: unknown) { super("rollback"); }
}

/** Run `fn` in a transaction, read the result, and roll it all back. */
async function trial(fn: (tx: Tx) => Promise<unknown>): Promise<{ state: Snapshot; answer: unknown }> {
  try {
    await testDb.transaction(async (tx) => {
      const answer = await fn(tx);
      throw new Rollback(await snapshot(tx), answer);
    });
  } catch (e) {
    if (e instanceof Rollback) return { state: e.state, answer: e.answer };
    throw e;
  }
  throw new Error("unreachable");
}

const oneByOne = (ids: string[]) => trial(async (tx) => {
  for (const id of ids) await oracleRevert(tx, id, NOW);
});
const together = (ids: string[]) => trial((tx) => apply.revertTournamentResultsIn(tx as never, ids, NOW));

const SUBSETS: [string, string[]][] = [
  ["every match", m],
  ["one match", [m[0]]],
  ["the latest match alone", [m[6]]],
  ["the same four people three times", [m[0], m[3], m[6]]],
  ["two mixed matches sharing a player", [m[2], m[5]]],
  ["every mixed match — the format the matches created goes", [m[2], m[5], m[7]]],
  ["matches that share nobody but A", [m[1], m[4], m[7]]],
  ["a walkover, which moved nothing, beside a rated match", [m[8], m[3]]],
  ["the same match twice", [m[1], m[1]]],
];

describe("taking many results back at once is taking them back one at a time", () => {
  it.each(SUBSETS)("%s", async (_name, ids) => {
    const forward = await oneByOne(ids);
    const backward = await oneByOne([...ids].reverse());
    const batch = await together(ids);
    /* The oracle agrees with itself whichever order it goes in, so there is
       one right answer for the batch to match. */
    expect(backward.state).toEqual(forward.state);
    expect(batch.state).toEqual(forward.state);
  });

  it("clears an under-rated flag the remaining record does not support, and keeps what is not its own", async () => {
    const { state } = await together([m[0], m[1], m[3], m[5], m[6]]);
    const b = state.people.find((p) => p.id === B)!;
    expect((b.flags as Record<string, unknown>).underRated).toBeUndefined();
    const a = state.people.find((p) => p.id === A)!;
    expect(a.flags).toMatchObject({ organiserNote: "kept" });
  });

  it("says how many rows it took back and whose", async () => {
    const { answer } = await together([m[0], m[2]]);
    expect(answer).toMatchObject({ reverted: 8 });
    expect([...(answer as { personIds: string[] }).personIds].sort()).toEqual([A, B, C, D, F, W1, W2].sort());
    expect((await together([])).answer).toEqual({ reverted: 0, personIds: [] });
    expect((await together([m[8]])).answer).toEqual({ reverted: 0, personIds: [] });
  });

  it("leaves everybody at their seed when every match goes, with nothing on record", async () => {
    const { state } = await together(m);
    expect(state.history).toEqual([]);
    expect(state.ledger).toEqual([]);
    const seeds: Record<string, Record<string, number>> = {
      [A]: { "pb:md": 1000 }, [B]: { "pb:md": 1050 }, [C]: { "pb:md": 950 }, [D]: { "pb:md": 1100 },
      [E]: { "pb:md": 1000 }, [F]: { "pb:md": 900 }, [W1]: { "pb:wd": 1000 }, [W2]: { "pb:wd": 980 },
    };
    for (const p of state.people) {
      expect(p.riseRatings, p.id).toEqual(seeds[p.id]);
      expect(p.riseBest).toBe(Object.values(seeds[p.id])[0]);
      expect(Object.values(p.matchCount ?? {}).every((n) => n === 0)).toBe(true);
      expect(p.partnerStats).toEqual({});
      expect(p.lastPlayedAt).toBeNull();
      expect(p.reliability).toBeNull();
    }
  });

  /* A slip in the derived arithmetic for ONE person of the batch: their
     rating is still taken back, and their flags and reliability are left as
     they were — "keep" is not the same as writing null, which is what a
     person with nothing left on record gets. */
  it("keeps one person's flags and reliability when their derived signals fail, and writes everyone else's", async () => {
    const before = await trial(async () => null);
    poison.personId = A;
    try {
      const forward = await oneByOne([m[0], m[2]]);
      const batch = await together([m[0], m[2]]);
      expect(batch.state).toEqual(forward.state);
      const was = before.state.people.find((p) => p.id === A)!;
      const now = batch.state.people.find((p) => p.id === A)!;
      expect(now.reliability).toBe(was.reliability);
      expect(now.flags).toEqual(was.flags);
      expect(now.flags).toEqual({ organiserNote: "kept" });
      expect(now.riseRatings).not.toEqual(was.riseRatings);
    } finally {
      poison.personId = null;
    }
  });
});
