import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";

/* One way to save a result (step 7), through the real actions against a real
 * database, with the ratings each write moves.
 *
 * What was wrong before, each pinned below:
 *   - a phone's rallies nulled a TYPED result on every write, and its rating
 *     stayed — the match then showed the rallies' score and the ratings the
 *     typed one;
 *   - ratings moved only on the finish-line transition, so correcting 11–7 to
 *     11–9 never re-rated;
 *   - "was it over" was read off the rally log alone, so a match left with a
 *     rating and no result answered "already" when it finally finished;
 *   - the rules were the EVENT's, re-read every time, so moving an event from
 *     11 to 15 reopened every finished 11-point match and it left the table;
 *   - a deleted match answered a phone with an error it retried for ever. */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => {} }));

/* A seam in the one gap that matters for a race: every scoring action reads the
   match, THEN asks who is calling (`principalFor`), THEN writes. A test that
   sets `race.next` runs it in that gap — exactly where, in production, the
   organiser's save lands between a phone's read and its write. */
const race = vi.hoisted(() => ({ next: null as null | (() => Promise<unknown>), beforeRefile: null as null | (() => Promise<unknown>) }));
/* A second seam, inside the rating engine: `refileSeeds` runs after the apply
   has READ the match and before it LOCKS it — the gap its check under the lock
   exists for. */
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
vi.mock("@/lib/auth/guard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/guard")>();
  return {
    ...orig,
    principalFor: async (...a: Parameters<typeof orig.principalFor>) => {
      const run = race.next;
      race.next = null;
      if (run) await run();
      return orig.principalFor(...a);
    },
  };
});

const dir = path.join(os.tmpdir(), `rise-results-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let actions: typeof import("./actions");
let manage: typeof import("./manage/actions");
let change: typeof import("@/lib/scoring/change");
/* A set number of boards, saved the way the Scoring card will once results
   can be typed in (RESULT_ENTRY_ON_SCREEN). Until then setScoring refuses it,
   so the scoring change underneath is driven directly. */
const toBoards = (tournamentId: string, boards: number) => change.changeScoring({ id: tournamentId }, { boards });
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;
let matchResult: typeof import("@/lib/results").matchResult;
let viewMatch: typeof import("@/lib/matchState").viewMatch;
let buildScoring: typeof import("@/lib/scoring/rules").buildScoring;
let marginMultiplier: typeof import("@/lib/rating").marginMultiplier;

const owner = randomUUID();
type Side = "a" | "b";

type Setup = {
  sport?: string;
  format?: string;
  scoring?: Record<string, unknown> | null;
  group?: boolean;
  log?: Side[];
  ackedGates?: number[];
  /** A knockout match whose slots have not been filled: no teams yet. */
  tbd?: boolean;
};

/** An event with one match between two pairs, each player linked to a person
 *  at 1000 in the event's doubles format. */
async function setup(o: Setup = {}) {
  const sport = o.sport ?? "pb";
  const [tournamentId, divisionId, teamA, teamB, matchId] =
    [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.insert(schema.tournaments).values({
    id: tournamentId, slug: `rs-${tournamentId.slice(0, 8)}`, name: "Results", sport: sport as never,
    format: (o.format ?? "standard") as never, ownerId: owner, status: "live", scoring: o.scoring ?? null,
  });
  await db.insert(schema.divisions).values({ id: divisionId, tournamentId, name: "Main" });
  await db.insert(schema.teams).values([
    { id: teamA, tournamentId, divisionId, name: "Aces", seed: 1 },
    { id: teamB, tournamentId, divisionId, name: "Bees", seed: 2 },
  ]);
  const personIds: string[] = [];
  for (const teamId of [teamA, teamA, teamB, teamB]) {
    const personId = randomUUID();
    personIds.push(personId);
    await db.insert(schema.people).values({
      id: personId, name: personId.slice(0, 4), gender: "M",
      riseRatings: { [`${sport}:md`]: 1000 }, riseBest: 1000, matchCount: {},
    });
    await db.insert(schema.players).values({
      id: randomUUID(), tournamentId, teamId, personId, name: personId.slice(0, 4), gender: "M", ratings: {},
    });
  }
  let groupId: string | null = null;
  if (o.group) {
    groupId = randomUUID();
    await db.insert(schema.groups).values({ id: groupId, tournamentId, divisionId, key: "A" });
  }
  await db.insert(schema.matches).values({
    id: matchId, tournamentId, divisionId, groupId, round: o.group ? "Group A · R1" : "Final",
    teamAId: o.tbd ? null : teamA, teamBId: o.tbd ? null : teamB, log: o.log ?? [], lineupA: [], lineupB: [],
    ackedGates: o.ackedGates ?? [], server: "a", rev: 0,
  });
  return { tournamentId, matchId, winner: personIds[0] };
}

/* 11–4 under side-out: A holds serve for 7; B's first rally wins the serve (the
   opening turn has one server); B holds for 4; A takes two rallies to win it
   back (B's second server); A holds for 4. */
const ELEVEN_FOUR = [
  ...Array(7).fill("a"), "b", ...Array(4).fill("b"), "a", "a", ...Array(4).fill("a"),
] as Side[];
/** Rally scoring: every rally a point, so the log reads as the score. */
const rallyLog = (a: number, b: number) => [...Array(b).fill("b"), ...Array(a).fill("a")] as Side[];

const stored = async (id: string) =>
  (await db.select().from(schema.matches).where(eq(schema.matches.id, id)))[0];
const event = async (id: string) =>
  (await db.select().from(schema.tournaments).where(eq(schema.tournaments.id, id)))[0];
const history = (id: string) =>
  db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, id));
const ratingOf = async (personId: string, key: string) =>
  ((await db.select().from(schema.people).where(eq(schema.people.id, personId)))[0].riseRatings ?? {})[key];
const resultOf = async (tournamentId: string, matchId: string) =>
  matchResult(await event(tournamentId), await stored(matchId));
const EMPTY = { playMs: 0, pausedMs: 0 };
const readTimingOf = (m: { timing: unknown }) => (m.timing ?? {}) as { running?: boolean; endedAt?: string | null };

/** The scoring form, as the manage screen posts it. */
const scoringForm = (fields: Record<string, string>) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
};

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  actions = await import("./actions");
  manage = await import("./manage/actions");
  change = await import("@/lib/scoring/change");
  ({ eq } = await import("drizzle-orm"));
  ({ matchResult } = await import("@/lib/results"));
  ({ viewMatch } = await import("@/lib/matchState"));
  ({ buildScoring } = await import("@/lib/scoring/rules"));
  ({ marginMultiplier } = await import("@/lib/rating"));

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

describe("typing a result", () => {
  it("saves 11–7 and rates it", async () => {
    const { matchId } = await setup();
    expect(await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 })).toEqual({ ok: true, rev: 1 });
    const m = await stored(matchId);
    expect([m.typedScoreA, m.typedScoreB, m.outcome]).toEqual([11, 7, null]);
    expect(await history(matchId)).toHaveLength(4);
  });

  it("answers the same result again with ok, even from the old rev — a retry is not an error", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 });
    const rows = (await history(matchId)).map((r) => r.id).sort();
    expect(await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 })).toEqual({ ok: true, rev: 1 });
    expect((await history(matchId)).map((r) => r.id).sort()).toEqual(rows);
  });

  it("refuses a different result from a stale rev, and leaves the row as it was", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 });
    const r = await actions.recordResult(matchId, { a: 11, b: 9, expectedRev: 0 });
    expect(r).toMatchObject({ ok: false, code: "stale" });
    const m = await stored(matchId);
    expect([m.typedScoreA, m.typedScoreB, m.rev]).toEqual([11, 7, 1]);
  });

  it("refuses a final no game produces, says what was meant, and writes nothing", async () => {
    const { matchId } = await setup();
    const r = await actions.recordResult(matchId, { a: 15, b: 4, expectedRev: 0 });
    expect(r).toEqual({
      ok: false, code: "invalid",
      error: "A game to 11 ends at 11–4 — 15–4 can't happen. Did you mean 11–4?",
      suggestion: { a: 11, b: 4 },
    });
    const m = await stored(matchId);
    expect([m.typedScoreA, m.rev]).toEqual([null, 0]);
  });

  it("records a game stopped early without a rating — it counts, as the winner's", async () => {
    const { tournamentId, matchId } = await setup();
    expect(await actions.recordResult(matchId, { a: 9, b: 7, expectedRev: 0, outcome: "unrated" })).toEqual({ ok: true, rev: 1 });
    expect(await resultOf(tournamentId, matchId)).toMatchObject({ winner: "a", outcome: "unrated", display: "9–7" });
    expect(await history(matchId)).toHaveLength(0);
  });

  it("still needs a winner when a result is recorded without a rating", async () => {
    const { matchId } = await setup();
    expect(await actions.recordResult(matchId, { a: 7, b: 7, expectedRev: 0, outcome: "retired" }))
      .toMatchObject({ ok: false, code: "no-winner" });
    expect(await actions.recordResult(matchId, { a: 0, b: 0, expectedRev: 0, outcome: "walkover" }))
      .toEqual({ ok: false, code: "no-winner", error: "Say which side the walkover goes to." });
  });

  /* Stopped EARLY, never past the end: 111–4 "retired" in a game to 11 is a
     slip, and it would count in every points-difference tie-break. */
  it("refuses a result recorded without a rating that goes past the end, with the score meant", async () => {
    const { matchId } = await setup();
    expect(await actions.recordResult(matchId, { a: 111, b: 4, expectedRev: 0, outcome: "retired" })).toEqual({
      ok: false, code: "invalid",
      error: "A game to 11 ends at 11–4 — 111–4 can't happen. Did you mean 11–4?",
      suggestion: { a: 11, b: 4 },
    });
  });

  it("tennis without a rating: the set it stopped in may be part-played, nothing else may be wrong", async () => {
    const stopped = await setup({ sport: "tn" });
    expect(await actions.recordResult(stopped.matchId, { a: 1, b: 0, sets: [[6, 4], [3, 2]], outcome: "retired", expectedRev: 0 }))
      .toEqual({ ok: true, rev: 1 });
    const after = await setup({ sport: "tn" });
    expect(await actions.recordResult(after.matchId, { a: 2, b: 0, sets: [[0, 6], [0, 6], [0, 6]], outcome: "retired", expectedRev: 0 }))
      .toMatchObject({ ok: false, code: "invalid", error: "The match was over after set 2 — set 3 can't have been played." });
  });

  it("a walkover retried from the old rev after a lost reply is ok, not stale", async () => {
    const { matchId } = await setup();
    for (let i = 0; i < 2; i++) {
      expect(await actions.recordResult(matchId, { a: 0, b: 1, expectedRev: 0, outcome: "walkover" })).toEqual({ ok: true, rev: 1 });
    }
  });

  it("a correction of only the games in a set is saved, not taken for a retry", async () => {
    const { matchId } = await setup({ sport: "tn" });
    await actions.recordResult(matchId, { a: 2, b: 1, sets: [[6, 4], [3, 6], [10, 8]], expectedRev: 0 });
    expect(await actions.recordResult(matchId, { a: 2, b: 1, sets: [[6, 4], [3, 6], [6, 2]], expectedRev: 1 })).toEqual({ ok: true, rev: 2 });
    expect((await stored(matchId)).sets).toEqual([[6, 4], [3, 6], [6, 2]]);
  });

  /* A finished match with no rating — an apply that failed, say — is mended
     by saving the same result again; it used to take the cheap path for ever. */
  it("saving the same result again rates a finished match that has no rating", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 });
    await db.delete(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, matchId));
    expect(await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 1 })).toEqual({ ok: true, rev: 1 });
    expect(await history(matchId)).toHaveLength(4);
  });

  /* Same score, different kind of result: a rated 11–7 that the organiser
     then marks as a retirement must lose its rating. "Did the result change?"
     has to ask about the outcome too, or the write takes the cheap path and
     the rating stays. */
  it("takes the rating back when a rated result is marked as not counting for one", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 });
    expect(await history(matchId)).toHaveLength(4);
    expect(await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 1, outcome: "retired" })).toEqual({ ok: true, rev: 2 });
    expect(await history(matchId)).toHaveLength(0);
  });

  /* A second guard, in the engine itself: whatever calls it, a result
     recorded without a rating is never rated. */
  it("is never rated by the engine, whoever asks, when it was recorded without a rating", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 9, b: 7, expectedRev: 0, outcome: "unrated" });
    const { applyMatchRatings } = await import("@/lib/rating/apply");
    expect(await applyMatchRatings(matchId)).toEqual({ status: "skipped", reason: "recorded without a rating (unrated)" });
    expect(await history(matchId)).toHaveLength(0);
  });

  /* Marked "retired" at the same score while a rating for it is between its
     read and its lock: the check under the lock must see the outcome, or the
     retirement is rated. */
  it("is not rated when it becomes a no-rating result while the rating is being worked out", async () => {
    const { matchId } = await setup();
    race.beforeRefile = () => actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 1, outcome: "retired" });
    await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 });
    expect((await stored(matchId)).outcome).toBe("retired");
    expect(await history(matchId)).toHaveLength(0);
  });

  /* The engine reads the games in each set too: 2–0 in sets beside games that
     say 2–1 is not a result anything should be rated on. */
  it("is not rated by the engine when a tennis result's sets disagree with it", async () => {
    const { matchId } = await setup({ sport: "tn" });
    await db.update(schema.matches).set({ typedScoreA: 2, typedScoreB: 0, sets: [[6, 4], [3, 6], [6, 2]] }).where(eq(schema.matches.id, matchId));
    const { applyMatchRatings } = await import("@/lib/rating/apply");
    expect(await applyMatchRatings(matchId)).toEqual({ status: "skipped", reason: "invalid score 2-0" });
  });

  it("records a walkover at the winning score, and moves no rating", async () => {
    const { tournamentId, matchId } = await setup();
    expect(await actions.recordResult(matchId, { a: 0, b: 1, expectedRev: 0, outcome: "walkover" })).toEqual({ ok: true, rev: 1 });
    expect(await resultOf(tournamentId, matchId)).toMatchObject({ a: 0, b: 11, winner: "b", display: "0–11 w/o" });
    expect(await history(matchId)).toHaveLength(0);
  });

  /* The old writer rated only on the finish-line transition. A correction is
     finished before and after, so it re-rated nothing: the winners kept 11–7's
     movement for a match that ended 11–9. */
  it("re-rates a correction: 11–7 corrected to 11–9 leaves exactly 11–9's movement", async () => {
    const { matchId, winner } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 });
    expect(await actions.recordResult(matchId, { a: 11, b: 9, expectedRev: 1 })).toEqual({ ok: true, rev: 2 });

    const rows = await history(matchId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.marginMultiplier === Math.round(marginMultiplier(11, 9) * 1000))).toBe(true);

    /* The same four-newcomer match typed 11–9 in the first place: the same rating. */
    const control = await setup();
    await actions.recordResult(control.matchId, { a: 11, b: 9, expectedRev: 0 });
    expect(await ratingOf(winner, "pb:md")).toBe(await ratingOf(control.winner, "pb:md"));
  });

  it("takes a level score in a group where the sport has draws, and refuses one in a knockout", async () => {
    const boards = { boards: 8 };
    const group = await setup({ sport: "cr", scoring: boards, group: true });
    expect(await actions.recordResult(group.matchId, { a: 20, b: 20, expectedRev: 0 })).toEqual({ ok: true, rev: 1 });
    expect(await resultOf(group.tournamentId, group.matchId)).toMatchObject({ draw: true, winner: null });

    const ko = await setup({ sport: "cr", scoring: boards });
    expect(await actions.recordResult(ko.matchId, { a: 20, b: 20, expectedRev: 0 }))
      .toMatchObject({ ok: false, code: "knockout-level" });
  });

  it("tennis: 2–1 with the games in each set, rated with a neutral margin", async () => {
    const { matchId } = await setup({ sport: "tn" });
    const sets: [number, number][] = [[6, 4], [3, 6], [10, 8]];
    expect(await actions.recordResult(matchId, { a: 2, b: 1, sets, expectedRev: 0 })).toEqual({ ok: true, rev: 1 });
    expect((await stored(matchId)).sets).toEqual(sets);
    const rows = await history(matchId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.marginMultiplier === 1000)).toBe(true);
  });

  it("tennis: names the set that is not a finished set", async () => {
    const { matchId } = await setup({ sport: "tn" });
    expect(await actions.recordResult(matchId, { a: 2, b: 0, sets: [[7, 5], [6, 5]], expectedRev: 0 })).toMatchObject({
      ok: false, code: "invalid",
      error: "Set 2, 6–5, isn't a finished set: a set ends 6–0 to 6–4, 7–5, or 7–6 on a tie-break.",
    });
  });

  it("asks before typing over rallies refereed live, and replaces them only when told to", async () => {
    const { matchId } = await setup();
    await actions.pushLog(matchId, ELEVEN_FOUR.slice(0, 5), 0);
    expect(await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 1 })).toMatchObject({
      ok: false, code: "live", live: { a: 5, b: 0, rallies: 5 },
    });
    expect((await stored(matchId)).log).toHaveLength(5);

    expect(await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 1, replaceLive: true })).toEqual({ ok: true, rev: 2 });
    const m = await stored(matchId);
    expect([m.log, m.ackedGates, m.timing, m.typedScoreA, m.typedScoreB]).toEqual([[], [], null, 11, 7]);
    expect(await history(matchId)).toHaveLength(4);
  });

  it("OSL: a typed result re-arms the rotations, so a match refereed again asks for them again", async () => {
    const { matchId } = await setup({ format: "osl", log: rallyLog(8, 0), ackedGates: [7] });
    expect(await actions.recordResult(matchId, { a: 25, b: 10, expectedRev: 0, replaceLive: true })).toEqual({ ok: true, rev: 1 });
    expect((await stored(matchId)).ackedGates).toEqual([]);
  });
});

describe("rallies meet a typed result", () => {
  /* The leak. A phone that had scored a rally offline reconnected: its push
     was stale, the server's log was empty (a typed match has none), so the
     queue called it "ahead" and retried at the new rev — and that write nulled
     the typed 11–3 and left 11–3's rating in place. */
  it("never overwrite it: the phone is told, at any rev, and the result and its rating stand", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 3, expectedRev: 0 });
    for (const rev of [0, 1]) {
      expect(await actions.pushLog(matchId, ["a"], rev)).toEqual({ ok: false, reason: "typed", a: 11, b: 3, outcome: null, rev: 1 });
    }
    const m = await stored(matchId);
    expect([m.typedScoreA, m.typedScoreB, m.log]).toEqual([11, 3, []]);
    expect(await history(matchId)).toHaveLength(4);
  });

  it("replace it when the referee chooses to, and take the typed result's rating back", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 3, expectedRev: 0 });
    expect(await actions.pushLog(matchId, ["a", "a"], 1, EMPTY, { replaceTyped: true })).toEqual({ ok: true, rev: 2 });
    const m = await stored(matchId);
    expect([m.typedScoreA, m.typedScoreB, m.log]).toEqual([null, null, ["a", "a"]]);
    expect(await history(matchId)).toHaveLength(0);
  });

  /* Setting the serve on a typed match moved its rev, so a phone holding
     rallies for it was answered with a refusal it could never get past. */
  it("the pre-match setup is refused on a typed match, and its rev does not move", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 3, expectedRev: 0 });
    expect(await actions.setMatchSetup(matchId, { server: "b" })).toMatchObject({ ok: false });
    expect((await stored(matchId)).rev).toBe(1);
  });

  /* The setup checked "not started" on its read and wrote with no guard, so
     rallies landing in between had the serve changed under them — rewriting
     who served every one — at the very rev the push had written. */
  it("the pre-match setup does not change the serve under rallies that landed meanwhile", async () => {
    const { matchId } = await setup();
    race.next = () => actions.pushLog(matchId, ["a", "a", "a"], 0);
    expect(await actions.setMatchSetup(matchId, { server: "b" })).toEqual({
      ok: false, error: "Not recorded — the match had just changed (on another device, or the scoring was changed). It shows the latest now: try again.", stale: true,
    });
    const m = await stored(matchId);
    expect([m.server, m.log, m.rev]).toEqual(["a", ["a", "a", "a"], 1]);
    expect(await actions.setMatchSetup(matchId, { server: "b" })).toMatchObject({ ok: false });
    expect(await actions.undoPoint(matchId, 1)).toEqual({ ok: true });
    await actions.undoPoint(matchId, 2);
    await actions.undoPoint(matchId, 3);
    expect(await actions.setMatchSetup(matchId, { server: "b" })).toEqual({ ok: true });
    expect((await stored(matchId)).server).toBe("b");
  });

  /* The cheap path for an unchanged result used to do nothing at all, so a
     finished match with no rating stayed that way through every later write. */
  it("a write of the same finished result rates a match that has no rating", async () => {
    const { matchId } = await setup();
    await actions.pushLog(matchId, ELEVEN_FOUR, 0);
    await db.delete(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, matchId));
    expect(await actions.pushLog(matchId, ELEVEN_FOUR, 1)).toMatchObject({ ok: true });
    expect(await history(matchId)).toHaveLength(4);
  });

  it("a single rally on a typed match is refused, naming the typed score", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 3, expectedRev: 0 });
    expect(await actions.scorePoint(matchId, "a", 1)).toEqual({
      ok: false, error: "This match's result was typed in as 11–3, so the court is locked.",
    });
  });

  /* A match the old leak left with a rating and no result. When it finished,
     the old writer's apply found history already there and answered
     "already", so 11–3's movement stood for an 11–4 match. */
  it("a match left with a rating and no result keeps only the new result's rating once it finishes", async () => {
    const { matchId } = await setup();
    await actions.recordResult(matchId, { a: 11, b: 3, expectedRev: 0 });
    await db.update(schema.matches).set({ typedScoreA: null, typedScoreB: null }).where(eq(schema.matches.id, matchId));
    expect(await history(matchId)).toHaveLength(4);

    expect(await actions.pushLog(matchId, ELEVEN_FOUR, 1)).toEqual({ ok: true, rev: 2 });
    const rows = await history(matchId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.marginMultiplier === Math.round(marginMultiplier(11, 4) * 1000))).toBe(true);
  });
});

describe("a phone told no for good", () => {
  /* Scored before its slots were filled, a knockout match finished with nobody
     to rate, and filling the slots later could not rate it. */
  it("is refused while the match's teams are not known, and so is a single rally", async () => {
    const { matchId } = await setup({ tbd: true });
    expect(await actions.pushLog(matchId, ["a"], 0)).toMatchObject({ ok: false, reason: "refused", title: "The teams aren't in this match yet" });
    expect(await actions.scorePoint(matchId, "a", 0)).toMatchObject({ ok: false });
    expect((await stored(matchId)).log).toEqual([]);
  });

  it("is refused a revision that is not a whole number, before it reaches the database", async () => {
    const { matchId } = await setup();
    /* By the validation, not by the database: a fraction reaches Postgres as a
       raw 22P02, which would pass a bare rejects.toThrow() too. */
    await expect(actions.pushLog(matchId, ["a"], 0.5)).rejects.toBeInstanceOf(ZodError);
    await expect(actions.pushLog(matchId, ["a"], "5" as never)).rejects.toBeInstanceOf(ZodError);
    await expect(actions.scorePoint(matchId, "a", -1)).rejects.toBeInstanceOf(ZodError);
    expect((await stored(matchId)).rev).toBe(0);
  });

  it("is refused, not answered with an error to retry, when its match was deleted", async () => {
    const { matchId } = await setup();
    await db.delete(schema.matches).where(eq(schema.matches.id, matchId));
    expect(await actions.pushLog(matchId, ["a"], 0)).toEqual({
      ok: false, reason: "refused", title: "This match was deleted", error: "It was removed on the manage screen.",
    });
  });

  it("is refused for a match with no live court, and a single rally is too", async () => {
    const tennis = await setup({ sport: "tn" });
    expect(await actions.pushLog(tennis.matchId, ["a"], 0)).toMatchObject({ ok: false, reason: "refused", title: "No live court for tennis" });
    expect(await actions.scorePoint(tennis.matchId, "a", 0)).toMatchObject({ ok: false });

    const carrom = await setup({ sport: "cr", scoring: { boards: 8 } });
    expect(await actions.scorePoint(carrom.matchId, "a", 0)).toEqual({
      ok: false,
      error: "This match ends after 8 boards, and the court counts points, not boards — so its final score is typed in. Typing a result in is not on the manage screen yet.",
    });
  });
});

describe("the rules stay with a finished match", () => {
  const to = (target: number, scoreType: "rally" | "" = "") =>
    ({ target, ...buildScoring(target, true, "none", null, scoreType) });

  /* The old reading: rules were the event's, re-read on every view. An 11–4
     played to 11 was not over at 15, so it left the table and the podium. */
  it("an event moved from 11 to 15 keeps its finished 11–4; a game being played plays on to 15", async () => {
    const done = await setup({ scoring: to(11) });
    await actions.pushLog(done.matchId, ELEVEN_FOUR, 0);
    expect((await stored(done.matchId)).rules?.rules?.target).toBe(11);

    /* A second match in the SAME event, half played. */
    const live = await db.select().from(schema.matches).where(eq(schema.matches.id, done.matchId));
    const liveId = randomUUID();
    await db.insert(schema.matches).values({
      ...live[0], id: liveId, round: "Semi-Final 2", log: ELEVEN_FOUR.slice(0, 9), rev: 0, rules: null, timing: null,
    });

    const saved = await manage.setScoring(
      done.tournamentId, scoringForm({ target: "15", winBy2: "on", goldenAt: "none", scoreType: "" }),
    );
    expect(saved).toEqual({
      ok: true,
      lines: [
        "Saved. This event now plays to 15.",
        "1 finished match keeps its result.",
        "Aces v Bees is being played now, 7–1. It plays on to 15.",
      ],
    });
    expect(await resultOf(done.tournamentId, done.matchId)).toMatchObject({ a: 11, b: 4, winner: "a" });
    expect(await history(done.matchId)).toHaveLength(4);
    const t = await event(done.tournamentId);
    expect(viewMatch(t, await stored(liveId)).over).toBe(false);
  });

  /* The freeze stays while the match has any play: an undo that reopens a
     finished game corrects it under the rules it was played to, not the
     event's new ones — the referee is fixing the game that happened. And the
     phone's log is cut at the end of THAT game. */
  it("an undo that reopens a finished game keeps it under the rules it was played to", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(11) });
    await actions.pushLog(matchId, ELEVEN_FOUR, 0);
    await manage.setScoring(tournamentId, scoringForm({ target: "15", winBy2: "on", goldenAt: "none", scoreType: "" }));

    const rev = (await stored(matchId)).rev;
    expect(await actions.undoPoint(matchId, rev)).toEqual({ ok: true });
    expect(await history(matchId)).toHaveLength(0);
    expect((await stored(matchId)).rules?.rules?.target).toBe(11);

    /* The winning rally again — with a tap past it — finishes it at 11 once more. */
    expect(await actions.pushLog(matchId, [...ELEVEN_FOUR, "a"], rev + 1)).toMatchObject({ ok: true });
    expect((await stored(matchId)).log).toEqual(ELEVEN_FOUR);
    expect(await resultOf(tournamentId, matchId)).toMatchObject({ a: 11, b: 4 });
    expect(await history(matchId)).toHaveLength(4);
  });

  it("judges a typed correction by the rules the match was played to", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(11) });
    await actions.recordResult(matchId, { a: 11, b: 4, expectedRev: 0 });
    await manage.setScoring(tournamentId, scoringForm({ target: "15", winBy2: "on", goldenAt: "none", scoreType: "" }));
    const rev = (await stored(matchId)).rev;
    /* 11–6 is a final at 11 and not at 15. */
    expect(await actions.recordResult(matchId, { a: 11, b: 6, expectedRev: rev })).toEqual({ ok: true, rev: rev + 1 });
    expect(await history(matchId)).toHaveLength(4);
  });

  it("freezes a match finished before the freeze existed under the rules it was played to", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(11) });
    await actions.recordResult(matchId, { a: 11, b: 7, expectedRev: 0 });
    await db.update(schema.matches).set({ rules: null }).where(eq(schema.matches.id, matchId));

    await manage.setScoring(tournamentId, scoringForm({ target: "15", winBy2: "on", goldenAt: "none", scoreType: "" }));
    const m = await stored(matchId);
    expect(m.rules?.rules?.target).toBe(11);
    expect(m.rev).toBe(2);   // moved, so a phone that read it before the change re-reads
  });

  it("finishes a game the new rules end where it stands, and rates it", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(15, "rally"), log: rallyLog(11, 4) });
    const saved = await manage.setScoring(tournamentId, scoringForm({ target: "11", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    expect(saved).toMatchObject({ ok: true, lines: expect.arrayContaining(["Aces v Bees was at 11–4, which ends it under these rules — it is now finished."]) });
    expect((await stored(matchId)).rules?.rules?.target).toBe(11);
    expect(await history(matchId)).toHaveLength(4);
  });

  it("saves nothing when the new rules would already have ended a game being played", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(15, "rally"), log: rallyLog(14, 4) });
    const saved = await manage.setScoring(tournamentId, scoringForm({ target: "11", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    expect(saved).toEqual({
      ok: false,
      error: "Not saved: Aces v Bees is at 14–4, and under these rules that game would already have ended. Correct that match first, or choose rules it hasn't passed.",
    });
    expect((await event(tournamentId)).scoring).toMatchObject({ target: 15 });
    expect((await stored(matchId)).rules).toBeNull();
  });

  /* Faisal's decision, pinned through the real writer: a match being played
     when the event moves from 11 to 15 plays on to 15. Played PAST 11 here, so
     a freeze on the first rally, or a change that froze matches being played
     under the old rules, would end it at 11. */
  it("a game being played when the event moves from 11 to 15 plays on past 11", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(11, "rally") });
    expect(await actions.pushLog(matchId, rallyLog(5, 0), 0)).toMatchObject({ ok: true });
    await manage.setScoring(tournamentId, scoringForm({ target: "15", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    const rev = (await stored(matchId)).rev;
    expect(await actions.pushLog(matchId, rallyLog(11, 0), rev)).toMatchObject({ ok: true });
    const m = await stored(matchId);
    expect(m.rules).toBeNull();
    expect(viewMatch(await event(tournamentId), m).over).toBe(false);
    expect(await history(matchId)).toHaveLength(0);
  });

  it("an undo back to 0–0 drops the freeze, so the match follows the event again", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(11, "rally") });
    await actions.pushLog(matchId, rallyLog(11, 0), 0);
    expect((await stored(matchId)).rules?.rules?.target).toBe(11);
    await manage.setScoring(tournamentId, scoringForm({ target: "15", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    expect(await actions.pushLog(matchId, [], (await stored(matchId)).rev)).toMatchObject({ ok: true });
    expect((await stored(matchId)).rules).toBeNull();
  });

  it("a reopened game is named when the scoring changes, with the rules it still finishes to", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(11) });
    await actions.pushLog(matchId, ELEVEN_FOUR, 0);
    await actions.undoPoint(matchId, 1);
    const saved = await manage.setScoring(tournamentId, scoringForm({ target: "9", winBy2: "on", goldenAt: "none", scoreType: "" }));
    expect(saved).toEqual({
      ok: true,
      lines: [
        "Saved. This event now plays to 9.",
        "Aces v Bees was reopened to correct it, and still finishes to 11 — the rules it was played to.",
      ],
    });
  });

  /* A match an old bug left rated for a result it no longer has: when a
     scoring change finishes it, that stale rating must not stand for the new
     result (the engine would answer "already"). */
  it("a game the new rules end is rated for ITS result, whatever was on record before", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(15, "rally") });
    await actions.recordResult(matchId, { a: 15, b: 3, expectedRev: 0 });
    await db.update(schema.matches)
      .set({ typedScoreA: null, typedScoreB: null, log: rallyLog(11, 9), rules: null })
      .where(eq(schema.matches.id, matchId));
    await manage.setScoring(tournamentId, scoringForm({ target: "11", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    const rows = await history(matchId);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.marginMultiplier === Math.round(marginMultiplier(11, 9) * 1000))).toBe(true);
  });

  it("a game the new rules end has its clock stopped and its rev moved, and is rated", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(15, "rally") });
    expect(await actions.pushLog(matchId, rallyLog(11, 4), 0, { playMs: 60_000, pausedMs: 0 })).toMatchObject({ ok: true });
    expect(readTimingOf(await stored(matchId))).toMatchObject({ running: true });
    await manage.setScoring(tournamentId, scoringForm({ target: "11", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    const m = await stored(matchId);
    expect(m.rev).toBe(2);
    expect(readTimingOf(m)).toMatchObject({ running: false });
    expect(readTimingOf(m).endedAt).toBeTruthy();
    expect(await history(matchId)).toHaveLength(4);
  });

  /* Moving from service to rally scoring re-counted the rallies already played:
     a live 5–3 became a finished 11–9 and was rated at a score that never
     happened. The rules apply to how a game ENDS, never to what was played. */
  it("refuses a change that would re-count the rallies of a game being played", async () => {
    const service = [...Array(9).fill(["a", "b"]).flat(), "a", "a"] as Side[];
    const { tournamentId, matchId } = await setup({ scoring: to(11, "") });
    await actions.pushLog(matchId, service, 0);
    expect(viewMatch(await event(tournamentId), await stored(matchId))).toMatchObject({ a: 5, b: 3 });
    const saved = await manage.setScoring(tournamentId, scoringForm({ target: "11", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    expect(saved).toEqual({
      ok: false,
      error: "Not saved: Aces v Bees is at 5–3, and these rules would count the rallies already played as 11–9. Change how points are scored when no match is being played, or finish that one first.",
    });
    expect(await history(matchId)).toHaveLength(0);
  });

  it("says when a game being played loses its live court to a set number of boards", async () => {
    const { tournamentId } = await setup({ sport: "cr", log: rallyLog(10, 5) });
    const saved = await toBoards(tournamentId, 8);
    expect(saved).toEqual({
      ok: true,
      lines: [
        "Saved. This event now plays 8 boards.",
        "Aces v Bees is being played now, 10–5. This match ends after 8 boards, and the court counts points, not boards — so its final score is typed in. Typing a result in is not on the manage screen yet.",
      ],
    });
  });

  it("a match frozen over a set number of boards keeps them when the event goes back to first-to-25", async () => {
    const { tournamentId, matchId } = await setup({ sport: "cr", scoring: { boards: 8 }, group: true });
    await actions.recordResult(matchId, { a: 20, b: 18, expectedRev: 0 });
    await manage.setScoring(tournamentId, scoringForm({ carromEnd: "score", target: "25", goldenAt: "none", scoreType: "" }));
    const rev = (await stored(matchId)).rev;
    /* 20–17 is not a finished game to 25; over 8 boards it is. */
    expect(await actions.recordResult(matchId, { a: 20, b: 17, expectedRev: rev })).toEqual({ ok: true, rev: rev + 1 });
  });

  it("Back to the sport's defaults keeps a finished result too", async () => {
    const { tournamentId, matchId } = await setup({ scoring: to(15) });
    await actions.recordResult(matchId, { a: 15, b: 9, expectedRev: 0 });
    await db.update(schema.matches).set({ rules: null }).where(eq(schema.matches.id, matchId));   // from before the freeze
    expect(await manage.clearScoring(tournamentId)).toEqual({
      ok: true, lines: ["Saved. This event now plays to 11.", "1 finished match keeps its result."],
    });
    expect((await stored(matchId)).rules?.rules?.target).toBe(15);
    expect(await resultOf(tournamentId, matchId)).toMatchObject({ a: 15, b: 9, winner: "a" });
  });

  /* The race. A rally read before the save and written after it was judged by
     the rules just replaced: a game the organiser had just been told plays on
     to 15 finished at 11; or one that counted as won under 11 had no rating and
     no freeze. Every match's rev moves with the change now, so the write goes
     stale and is worked out again on a fresh read. */
  it("a rally read before a scoring change is not judged by the old rules", async () => {
    const longer = await setup({ scoring: to(11, "rally"), log: rallyLog(10, 4) });
    race.next = () => manage.setScoring(longer.tournamentId, scoringForm({ target: "15", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    expect(await actions.scorePoint(longer.matchId, "a", 0)).toEqual({ ok: false, error: "Not recorded — the match had just changed (on another device, or the scoring was changed). It shows the latest now: try again.", stale: true });
    expect((await stored(longer.matchId)).log).toHaveLength(14);
    expect(await history(longer.matchId)).toHaveLength(0);

    const shorter = await setup({ scoring: to(15, "rally"), log: rallyLog(10, 4) });
    race.next = () => manage.setScoring(shorter.tournamentId, scoringForm({ target: "11", winBy2: "on", goldenAt: "none", scoreType: "rally" }));
    const reply = await actions.pushLog(shorter.matchId, rallyLog(11, 4), 0);
    /* The reply names the match AS IT IS NOW — the rev the save moved it to.
       It named the rev the push had been judged against, so a phone retrying
       at it was stale again. */
    expect(reply).toEqual({ ok: false, reason: "stale", serverLog: rallyLog(10, 4), rev: (await stored(shorter.matchId)).rev });
    /* The phone's queue retries at the rev the reply names: under 11 now. */
    expect(await actions.pushLog(shorter.matchId, rallyLog(11, 4), (reply as { rev: number }).rev)).toMatchObject({ ok: true });
    expect((await stored(shorter.matchId)).rules?.rules?.target).toBe(11);
    expect(await history(shorter.matchId)).toHaveLength(4);
  });

  /* Every single-rally action says "stale" in so many words, and the console
     reloads on it. A console that cannot score offline (carrom, chess, OSL)
     used to say "reloading" and not reload, so after one scoring save every
     tap on every live court of the event failed until somebody reloaded. */
  it("a rally, an undo or a point off after a scoring change says the match moved on", async () => {
    const { tournamentId, matchId } = await setup({ sport: "cr", log: rallyLog(3, 2) });
    expect((await manage.setScoring(tournamentId, scoringForm({ carromEnd: "score", target: "29" }))).ok).toBe(true);
    const stale = { ok: false, error: "Not recorded — the match had just changed (on another device, or the scoring was changed). It shows the latest now: try again.", stale: true };
    expect(await actions.scorePoint(matchId, "a", 0)).toEqual(stale);
    expect(await actions.undoPoint(matchId, 0)).toEqual(stale);
    expect(await actions.minusPoint(matchId, "a", 0)).toEqual(stale);
    expect(await actions.scorePoint(matchId, "a", (await stored(matchId)).rev)).toEqual({ ok: true });
  });

  /* Carrom moved to a set number of boards still replays its rallies against
     carrom's default target, and a game at 26–10 read as finished — frozen
     and rated — although no point count ends a match over a number of boards. */
  it("carrom moved to a set number of boards does not finish a game being played", async () => {
    const { tournamentId, matchId } = await setup({ sport: "cr", scoring: { target: 29 }, log: rallyLog(26, 10) });
    expect(await toBoards(tournamentId, 8)).toEqual({
      ok: true,
      lines: [
        "Saved. This event now plays 8 boards.",
        "Aces v Bees is being played now, 26–10. This match ends after 8 boards, and the court counts points, not boards — so its final score is typed in. Typing a result in is not on the manage screen yet.",
      ],
    });
    expect((await stored(matchId)).rules).toBeNull();
    expect(await history(matchId)).toHaveLength(0);
    expect(await resultOf(tournamentId, matchId)).toBeNull();
  });

  /* Until results can be typed in, a match over a set number of boards has no
     way to finish — so the choice is refused, and the event keeps playing to
     a score. */
  it("carrom: a set number of boards is refused while results cannot be typed in", async () => {
    const { tournamentId } = await setup({ sport: "cr", log: rallyLog(10, 5) });
    expect(await manage.setScoring(tournamentId, scoringForm({ carromEnd: "boards", boards: "8" }))).toEqual({
      ok: false,
      error: "A set number of boards needs each match's final score typed in, and results can't be typed in yet. Use first to a score for now.",
    });
    expect((await event(tournamentId)).scoring).toBeNull();
  });

  it("carrom: saves a set number of boards, and the match that was first to 25 keeps its result", async () => {
    const { tournamentId, matchId } = await setup({ sport: "cr" });
    await actions.recordResult(matchId, { a: 29, b: 18, expectedRev: 0 });
    const saved = await toBoards(tournamentId, 8);
    expect(saved).toEqual({ ok: true, lines: ["Saved. This event now plays 8 boards.", "1 finished match keeps its result."] });
    expect((await event(tournamentId)).scoring).toEqual({ boards: 8 });
    expect((await stored(matchId)).rules).toMatchObject({ boards: null, rules: { target: 25 } });
  });
});
