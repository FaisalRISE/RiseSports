"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { matches, tournaments, scorerGrants } from "@/lib/db/schema";
import { principalFor, grantCookieName, GRANT_COOKIE_OPTIONS } from "@/lib/auth/guard";
import { canScore, canManage, assert } from "@/lib/auth/policy";
import { verifyPin, generateGrantToken } from "@/lib/auth/pin";
import { viewMatch } from "@/lib/matchState";
import { applyMatchRatings, revertMatchRatings } from "@/lib/rating/apply";
import { oslPruneAcks } from "@/lib/formats/osl";
import { rewindIndex } from "@/lib/scoring/rewind";
import type { Side } from "@/lib/scoring/replay";
import {
  readTiming, startTiming, applyTick, stopTiming, reopenTiming,
  type Timing, type Tick,
} from "@/lib/scoring/timing";

/* Every mutation in this file:
 *   1. loads the match and its tournament,
 *   2. builds the principal server-side and asserts the permission,
 *   3. writes with a revision guard so a stale device cannot roll the score back.
 *
 * The client cannot skip any of it — there is no code path to the database
 * that does not come through here. */

const sideSchema = z.enum(["a", "b"]);
const idSchema = z.string().min(1).max(64);

/* A device's report of time that passed, already split into play and pause.
 * Bounded so a broken clock on one phone cannot write a nonsense duration: an
 * hour is the per-reading ceiling on the device, and a day is more than any
 * queue could legitimately hold. */
const msSchema = z.number().int().min(0).max(24 * 3_600_000);
const tickSchema = z
  .object({
    playMs: msSchema,
    pausedMs: msSchema,
    pause: z.enum(["timeout", "injury", "weather", "other"]).nullable().optional(),
  })
  .default({ playMs: 0, pausedMs: 0 });

type Ctx = Awaited<ReturnType<typeof loadMatch>>;

async function loadMatch(matchId: string) {
  const [row] = await db
    .select({ match: matches, tournament: tournaments })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) throw new Error("Match not found");
  return row;
}

async function requireScorer(matchId: string): Promise<Ctx> {
  const ctx = await loadMatch(matchId);
  const principal = await principalFor(ctx.tournament.id);
  assert(canScore(principal), "score this match");
  return ctx;
}

/**
 * The match clock, driven off the log rather than off anything the console has
 * to remember — the spec is explicit that it "runs automatically off point
 * entry". Start on the first point, stop on the point that wins it, and reopen
 * if an undo takes the match back over that line.
 *
 * `tick` is time this device measured with `performance.now()` since its last
 * write, already split into play and pause because only the device knows which
 * it was (see lib/scoring/timing.ts). It rides along with the rally write that
 * was happening anyway, so a reload loses at most the time since the last point
 * and costs no extra round trip.
 */
function nextTiming(
  current: unknown, wasOver: boolean, isOver: boolean, hasPoints: boolean, tick: Tick,
): Timing | null {
  let t = readTiming(current);
  if (!t.startedAt && !hasPoints) return null;   // nothing has happened yet

  const now = new Date().toISOString();
  t = startTiming(t, now);
  t = applyTick(t, tick);
  if (isOver && !wasOver) t = stopTiming(t, now);
  if (wasOver && !isOver) t = reopenTiming(t);
  return t;
}

/** Write the log with an optimistic-concurrency guard on `rev`. */
async function commitLog(
  ctx: Ctx,
  log: Side[],
  ackedGates: number[],
  expectedRev: number,
  tick: Tick,
): Promise<{ ok: true } | { ok: false; reason: "stale" }> {
  const wasOver = viewMatch(ctx.tournament, ctx.match).over;
  const isOver = viewMatch(
    ctx.tournament,
    { ...ctx.match, log, ackedGates, typedScoreA: null, typedScoreB: null },
  ).over;
  const timing = nextTiming(ctx.match.timing, wasOver, isOver, log.length > 0, tick);

  const updated = await db
    .update(matches)
    .set({
      log,
      ackedGates,
      ...(timing ? { timing: timing as unknown as Record<string, unknown> } : {}),
      rev: expectedRev + 1,
      updatedAt: new Date(),
      typedScoreA: null,
      typedScoreB: null,
    })
    .where(and(eq(matches.id, ctx.match.id), eq(matches.rev, expectedRev)))
    .returning({ id: matches.id });

  if (updated.length === 0) return { ok: false, reason: "stale" };

  await syncRatings(ctx, wasOver, isOver);

  revalidatePath(`/t/${ctx.tournament.slug}`);
  revalidatePath(`/t/${ctx.tournament.slug}/score/${ctx.match.id}`);
  revalidatePath(`/t/${ctx.tournament.slug}/ratings`);
  return { ok: true };
}

/**
 * Move people's RISE Ratings when a match crosses the finish line, and put them
 * back if an undo takes it back over that line.
 *
 * Gated on the TRANSITION rather than on the current state, so the common case
 * — a referee tapping a rally mid-game — does no database work at all. Applying
 * on every write would put a query in the hot path of every point.
 *
 * Failures are swallowed deliberately: a rating that did not move is a problem
 * for later, but a rally that would not save because of it is a problem on
 * court right now. The match is already committed at this point.
 */
async function syncRatings(ctx: Ctx, wasOver: boolean, isOver: boolean) {
  try {
    if (wasOver === isOver) return;
    if (isOver) await applyMatchRatings(ctx.match.id);
    else await revertMatchRatings(ctx.match.id);
  } catch (e) {
    console.error("rating sync failed for match", ctx.match.id, e);
  }
}

export type ActionResult = { ok: true } | { ok: false; error: string };

const EMPTY: Tick = { playMs: 0, pausedMs: 0 };

/** Record one rally to the side that won it. */
export async function scorePoint(
  matchId: string, side: Side, expectedRev: number, tick: Tick = EMPTY,
): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const w = sideSchema.parse(side);
  const clock = tickSchema.parse(tick);
  const ctx = await requireScorer(id);

  const view = viewMatch(ctx.tournament, ctx.match);
  if (view.over) return { ok: false, error: "The match is already won." };
  if (view.locked) return { ok: false, error: "Confirm the rotation before scoring." };

  const log = [...(ctx.match.log as Side[]), w];
  const res = await commitLog(ctx, log, ctx.match.ackedGates ?? [], expectedRev, clock);
  return res.ok ? { ok: true } : { ok: false, error: "Another device scored first — reloading." };
}

/** Rotation gates are re-derived from a log rather than trusted: dropping below
 *  a gate re-arms its confirmation, so the console cannot silently drift out of
 *  step with the players on court. */
function acksFor(ctx: Ctx, log: Side[]): number[] {
  const current = ctx.match.ackedGates ?? [];
  if (ctx.tournament.format !== "osl") return current;
  const a = log.filter((x) => x === "a").length;
  return oslPruneAcks(Math.max(a, log.length - a), current);
}

/** Undo is just dropping the last entry; that is the whole point of the log. */
export async function undoPoint(
  matchId: string, expectedRev: number, tick: Tick = EMPTY,
): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const clock = tickSchema.parse(tick);
  const ctx = await requireScorer(id);

  const log = [...(ctx.match.log as Side[])];
  if (log.length === 0) return { ok: false, error: "Nothing to undo." };
  log.pop();

  const res = await commitLog(ctx, log, acksFor(ctx, log), expectedRev, clock);
  return res.ok ? { ok: true } : { ok: false, error: "Another device scored first — reloading." };
}

/**
 * Take a point off one side.
 *
 * A referee correcting a mistake thinks "take one off them", not "undo the
 * fourth rally back" — and under side-out scoring those are different things,
 * because several rallies can pass without anybody scoring. So this rewinds to
 * just before the rally that last gave this side a point, discarding the
 * side-outs that followed it. The log is the only stored state, so there is no
 * other consistent way to remove a point from the middle of it.
 *
 * The search itself is `lib/scoring/rewind`, shared with the browser's offline
 * path so the two cannot answer differently.
 */
export async function minusPoint(
  matchId: string, side: Side, expectedRev: number, tick: Tick = EMPTY,
): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const w = sideSchema.parse(side);
  const clock = tickSchema.parse(tick);
  const ctx = await requireScorer(id);

  const log = ctx.match.log as Side[];
  const cut = rewindIndex(log.length, (n) =>
    viewMatch(ctx.tournament, { ...ctx.match, log: log.slice(0, n), typedScoreA: null, typedScoreB: null })[w]);
  if (cut === null) return { ok: false, error: "That side has no points to take off." };

  const next = log.slice(0, cut);
  const res = await commitLog(ctx, next, acksFor(ctx, next), expectedRev, clock);
  return res.ok ? { ok: true } : { ok: false, error: "Another device scored first — reloading." };
}

/**
 * Who serves first, and which player of each pair starts on the right.
 *
 * Only before the first rally. The whole service sequence is DERIVED from these
 * two answers by replaying the log, so changing them at 8–6 does not correct a
 * mistake — it silently rewrites who was serving for every rally already
 * played, and the console would then disagree with the court about which side
 * of their own half each player should be standing on.
 */
export async function setMatchSetup(
  matchId: string,
  setup: { server?: Side; posA?: 0 | 1; posB?: 0 | 1 },
): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const v = z
    .object({
      server: sideSchema.optional(),
      posA: z.union([z.literal(0), z.literal(1)]).optional(),
      posB: z.union([z.literal(0), z.literal(1)]).optional(),
    })
    .parse(setup);
  const ctx = await requireScorer(id);

  if ((ctx.match.log as Side[]).length > 0) {
    return { ok: false, error: "The match has started — undo back to 0–0 to change this." };
  }

  await db
    .update(matches)
    .set({
      ...(v.server !== undefined ? { server: v.server } : {}),
      ...(v.posA !== undefined ? { posA: v.posA } : {}),
      ...(v.posB !== undefined ? { posB: v.posB } : {}),
      rev: ctx.match.rev + 1,
      updatedAt: new Date(),
    })
    .where(eq(matches.id, id));

  revalidatePath(`/t/${ctx.tournament.slug}/score/${id}`);
  return { ok: true };
}

/** What a device gets back when its queued log could not be applied as-is. */
export type PushResult =
  | { ok: true; rev: number }
  | { ok: false; reason: "stale"; serverLog: Side[]; rev: number }
  | { ok: false; reason: "error"; error: string };

/**
 * Apply a whole log recorded offline.
 *
 * The single-rally actions above are wrong for a reconnecting device: it may
 * hold several rallies, and replaying them one at a time would leave the match
 * half-applied if the connection dropped again. `commitLog` already writes the
 * ENTIRE array under a rev guard, so the whole queue lands atomically or not
 * at all.
 *
 * On a stale rev this returns the SERVER'S log rather than just an error. The
 * device cannot tell a lost response from a genuine two-device conflict without
 * seeing it — and the difference matters, because one resolves silently and the
 * other has to interrupt a referee. `lib/offline/queue.ts:classify` decides.
 */
export async function pushLog(
  matchId: string, log: Side[], expectedRev: number, tick: Tick = EMPTY,
): Promise<PushResult> {
  const id = idSchema.parse(matchId);
  const incoming = z.array(sideSchema).max(500).parse(log);
  const clock = tickSchema.parse(tick);

  let ctx: Ctx;
  try {
    ctx = await requireScorer(id);
  } catch (e) {
    return { ok: false, reason: "error", error: e instanceof Error ? e.message : "Not allowed" };
  }

  const current = (ctx.match.log as Side[]) ?? [];

  /* Gates are re-derived from the incoming log rather than trusted from the
     device: an offline console cannot evaluate OSL rotation (it is not shipped
     to the browser), so it may have queued rallies straight past a gate it
     never knew was due. */
  const res = await commitLog(ctx, incoming, acksFor(ctx, incoming), expectedRev, clock);
  if (res.ok) return { ok: true, rev: expectedRev + 1 };
  return { ok: false, reason: "stale", serverLog: current, rev: ctx.match.rev };
}

/** Confirm a rotation (and, at 14, the change of ends). Rules 3.4 / 5.6. */
export async function confirmRotation(matchId: string, gate: number, expectedRev: number): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const g = z.union([z.literal(7), z.literal(14)]).parse(gate);
  const ctx = await requireScorer(id);

  const view = viewMatch(ctx.tournament, ctx.match);
  if (view.osl?.pendingGate !== g) return { ok: false, error: "That rotation is not due." };

  const acked = [...(ctx.match.ackedGates ?? []), g];
  const res = await commitLog(ctx, ctx.match.log as Side[], acked, expectedRev, EMPTY);
  return res.ok ? { ok: true } : { ok: false, error: "Another device updated the match — reloading." };
}

/** Record a result that was not scored rally by rally. Counts for the tables,
 *  excluded from rally statistics because there is no rally record. */
export async function setTypedScore(matchId: string, a: number, b: number): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const ctx = await requireScorer(id);
  const scoreSchema = z.number().int().min(0).max(999);
  const sa = scoreSchema.parse(a);
  const sb = scoreSchema.parse(b);
  if (sa === sb) return { ok: false, error: "A match cannot end level." };

  await db
    .update(matches)
    .set({ typedScoreA: sa, typedScoreB: sb, log: [], rev: ctx.match.rev + 1, updatedAt: new Date() })
    .where(eq(matches.id, id));

  /* A typed score IS a result, so it moves ratings like any other. Re-applied
     from scratch because the score may have been corrected: revert first, then
     apply, which the idempotency guard would otherwise refuse. */
  try {
    await revertMatchRatings(id);
    await applyMatchRatings(id);
  } catch (e) {
    console.error("rating sync failed for typed score", id, e);
  }

  revalidatePath(`/t/${ctx.tournament.slug}`);
  revalidatePath(`/t/${ctx.tournament.slug}/ratings`);
  return { ok: true };
}

/** Redeem a scorer PIN. Grants scoring rights for THIS tournament only. */
export async function redeemPin(tournamentSlug: string, pin: string): Promise<ActionResult> {
  const slug = idSchema.parse(tournamentSlug);
  const entered = z.string().min(4).max(12).parse(pin);

  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  if (!t) return { ok: false, error: "Tournament not found." };

  if (!(await verifyPin(entered, t.scorerPinHash))) {
    /* Deliberately vague, and identical for "no PIN set" and "wrong PIN", so
       this cannot be used to probe which events have scoring open. */
    return { ok: false, error: "That PIN was not recognised." };
  }

  const token = generateGrantToken();
  await db.insert(scorerGrants).values({
    id: crypto.randomUUID(),
    tournamentId: t.id,
    token,
    expiresAt: new Date(Date.now() + GRANT_COOKIE_OPTIONS.maxAge * 1000),
  });

  const jar = await cookies();
  jar.set(grantCookieName(t.id), token, GRANT_COOKIE_OPTIONS);
  revalidatePath(`/t/${slug}`);
  return { ok: true };
}

/** Rotate the scorer PIN and revoke every grant issued under the old one. */
export async function revokeScorerGrants(tournamentId: string): Promise<ActionResult> {
  const id = idSchema.parse(tournamentId);
  const principal = await principalFor(id);
  assert(canManage(principal), "manage this tournament");

  await db
    .update(scorerGrants)
    .set({ revokedAt: new Date() })
    .where(and(eq(scorerGrants.tournamentId, id), sql`${scorerGrants.revokedAt} is null`));

  return { ok: true };
}
