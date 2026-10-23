"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { matches, tournaments, scorerGrants, OUTCOMES, type Outcome } from "@/lib/db/schema";
import { writeResult, recordTypedResult, type RecordReply } from "@/lib/results/write";
import { principalFor, grantCookieName, GRANT_COOKIE_OPTIONS } from "@/lib/auth/guard";
import { canScore, canManage, assert } from "@/lib/auth/policy";
import { verifyPin, generateGrantToken } from "@/lib/auth/pin";
import { rulesFor, viewMatch, noLiveCourt, teamsNotIn } from "@/lib/matchState";
import { oslPruneAcks } from "@/lib/formats/osl";
import { rewindIndex } from "@/lib/scoring/rewind";
import { MAX_SCORE } from "@/lib/scoring/final";
import { finishedAt, type Side } from "@/lib/scoring/replay";
import type { PushResult } from "@/lib/offline/queue";
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
/* The revision a device last read. Checked like every other input: a Server
   Action is a public endpoint, and a fraction reached Postgres as rev = 1.5 and
   threw (a 500, retried by the phone for ever), while a string passed the guard
   and wrote rev "5" + 1 = "51". */
const revSchema = z.number().int().min(0);

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

type Ctx = NonNullable<Awaited<ReturnType<typeof findMatch>>>;

async function findMatch(matchId: string) {
  const [row] = await db
    .select({ match: matches, tournament: tournaments })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(eq(matches.id, matchId))
    .limit(1);
  return row ?? null;
}

/** The match and its event, authorised for scoring — or null when the match
    is not there: deleted on the manage screen (a pair removed, step 8b), so a
    console still open on it is answered GONE rather than with an error. */
async function requireScorer(matchId: string): Promise<Ctx | null> {
  const ctx = await findMatch(matchId);
  if (!ctx) return null;
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

/**
 * Write a rally log. A match holding a TYPED result refuses it unless the
 * caller explicitly asked to replace that result — rallies used to null a typed
 * score on every write, so a phone that had scored two rallies offline wiped
 * out the organiser's 11–7 when it reconnected, and nobody was asked.
 */
async function commitLog(
  ctx: Ctx,
  log: Side[],
  ackedGates: number[],
  expectedRev: number,
  tick: Tick,
  opts: { replaceTyped?: boolean } = {},
): Promise<
  | { ok: true; rev: number }
  | { ok: false; reason: "stale" }
  | { ok: false; reason: "typed"; a: number; b: number; outcome: Outcome | null }
> {
  const view = viewMatch(ctx.tournament, ctx.match);
  if (view.typedScore && !opts.replaceTyped) {
    return { ok: false, reason: "typed", ...view.typedScore, outcome: view.outcome };
  }

  const cleared = { ...ctx.match, log, ackedGates, typedScoreA: null, typedScoreB: null, outcome: null, sets: null };
  const wasOver = view.over;
  const isOver = viewMatch(ctx.tournament, cleared).over;
  const timing = nextTiming(ctx.match.timing, wasOver, isOver, log.length > 0, tick);

  return writeResult(
    ctx,
    {
      log, ackedGates, typedScoreA: null, typedScoreB: null, outcome: null, sets: null,
      ...(timing ? { timing } : {}),
    },
    expectedRev,
  );
}

/** Why the court takes no rally, or null when it does. Asked by every
 *  single-rally action; `pushLog` answers the same cases in its own words. */
function courtRefusal(ctx: Ctx): string | null {
  const typed = viewMatch(ctx.tournament, ctx.match).typedScore;
  /* A walkover is nobody's score — the organiser gave it (step 8b). */
  if (typed && ctx.match.outcome === "walkover") return "This match was given as a walkover on the manage screen, so the court is locked.";
  if (typed) return `This match's result was typed in as ${typed.a}–${typed.b}, so the court is locked.`;
  const notIn = teamsNotIn(ctx.match);
  if (notIn) return `${notIn.title}. ${notIn.body}`;
  return noLiveCourt(ctx.tournament, ctx.match)?.body ?? null;
}

/** `stale`: the match moved on since this console's view of it — the console
 *  reloads, and the referee taps again on what is there now. A tap answered
 *  only with words left a console that cannot score offline (carrom, chess,
 *  OSL) on its old rev, failing every tap until somebody reloaded by hand; a
 *  scoring change moves every match's rev, so one save did that to every live
 *  court of such an event at once. */
export type ActionResult = { ok: true } | { ok: false; error: string; stale?: true };

const EMPTY: Tick = { playMs: 0, pausedMs: 0 };
/* Says what happened to the TAP — it was not recorded — and does not guess
   why: another device, or a change of scoring, which moves every match's rev.
   The console reloads on `stale`, so the sentence must still be true after. */
const STALE = {
  ok: false,
  error: "Not recorded — the match had just changed (on another device, or the scoring was changed). It shows the latest now: try again.",
  stale: true,
} as const;
/* The match is not there any more — deleted on the manage screen, which a
   pair being removed does to a match being played (step 8b). The console
   reloads (stale) and meets the score page saying so. It used to throw, and
   the referee was told the server had not answered, and to try again. */
const GONE = {
  ok: false,
  error: "Not recorded — this match was deleted on the manage screen.",
  stale: true,
} as const;
/* A tap from a console that last saw the match BEFORE the organiser cleared or
   reset it (step 8): never applied to the match as it is now. The console
   reloads (stale) and shows 0–0. */
const RESET = {
  ok: false,
  error: "Not recorded — the organiser reset this match. It starts again at 0–0.",
  stale: true,
} as const;

/**
 * The checks every single-rally action makes first, in this order: a console
 * from before a reset gets the reset sentence; a console on any older rev gets
 * STALE and reloads — BEFORE the court and content checks, which read the
 * match as it is NOW and would answer a stale console in words only ("Nothing
 * to undo", "That rotation is not due"), leaving a console that cannot score
 * offline on its old view until somebody reloaded it by hand.
 */
function revRefusal(ctx: Ctx, rev: number): ActionResult | null {
  if (rev < ctx.match.resetRev) return RESET;
  if (rev !== ctx.match.rev) return STALE;
  return null;
}

/** Record one rally to the side that won it. */
export async function scorePoint(
  matchId: string, side: Side, expectedRev: number, tick: Tick = EMPTY,
): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const w = sideSchema.parse(side);
  const clock = tickSchema.parse(tick);
  const rev = revSchema.parse(expectedRev);
  const ctx = await requireScorer(id);
  if (!ctx) return GONE;

  const old = revRefusal(ctx, rev);
  if (old) return old;
  const refused = courtRefusal(ctx);
  if (refused) return { ok: false, error: refused };
  const view = viewMatch(ctx.tournament, ctx.match);
  if (view.over) return { ok: false, error: "The match is already won." };
  if (view.locked) return { ok: false, error: "Confirm the rotation before scoring." };

  const log = [...(ctx.match.log as Side[]), w];
  const res = await commitLog(ctx, log, ctx.match.ackedGates ?? [], rev, clock);
  return res.ok ? { ok: true } : STALE;
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
  const rev = revSchema.parse(expectedRev);
  const ctx = await requireScorer(id);
  if (!ctx) return GONE;

  const old = revRefusal(ctx, rev);
  if (old) return old;
  const refused = courtRefusal(ctx);
  if (refused) return { ok: false, error: refused };
  const log = [...(ctx.match.log as Side[])];
  if (log.length === 0) return { ok: false, error: "Nothing to undo." };
  log.pop();

  const res = await commitLog(ctx, log, acksFor(ctx, log), rev, clock);
  return res.ok ? { ok: true } : STALE;
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
  const rev = revSchema.parse(expectedRev);
  const ctx = await requireScorer(id);
  if (!ctx) return GONE;

  const old = revRefusal(ctx, rev);
  if (old) return old;
  const refused = courtRefusal(ctx);
  if (refused) return { ok: false, error: refused };
  const log = ctx.match.log as Side[];
  const cut = rewindIndex(log.length, (n) =>
    viewMatch(ctx.tournament, { ...ctx.match, log: log.slice(0, n), typedScoreA: null, typedScoreB: null })[w]);
  if (cut === null) return { ok: false, error: "That side has no points to take off." };

  const next = log.slice(0, cut);
  const res = await commitLog(ctx, next, acksFor(ctx, next), rev, clock);
  return res.ok ? { ok: true } : STALE;
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
  if (!ctx) return GONE;

  if ((ctx.match.log as Side[]).length > 0) {
    return { ok: false, error: "The match has started — undo back to 0–0 to change this." };
  }
  /* A typed result has no serve to set, and moving its rev would make a phone
     holding rallies for it answer a refusal it can never get past. */
  const refused = courtRefusal(ctx);
  if (refused) return { ok: false, error: refused };

  /* Guarded like every other write, on the rev AND on the log still being
     empty. A push landing between the read above and this write used to have
     the serve changed underneath its rallies — rewriting who served every one
     of them, at the same rev the push had written, so its phone never knew. */
  const written = await db
    .update(matches)
    .set({
      ...(v.server !== undefined ? { server: v.server } : {}),
      ...(v.posA !== undefined ? { posA: v.posA } : {}),
      ...(v.posB !== undefined ? { posB: v.posB } : {}),
      rev: ctx.match.rev + 1,
      updatedAt: new Date(),
    })
    .where(and(eq(matches.id, id), eq(matches.rev, ctx.match.rev), sql`jsonb_array_length(${matches.log}) = 0`))
    .returning({ id: matches.id });
  if (written.length === 0) return STALE;

  revalidatePath(`/t/${ctx.tournament.slug}/score/${id}`);
  return { ok: true };
}

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
 *
 * Two answers the phone must not retry (`PushResult` in lib/offline/queue):
 *   - "typed": the match holds a typed result. The phone keeps its rallies and
 *     asks the referee; only an explicit `replaceTyped` push, at the rev this
 *     returns, replaces it. Asked BEFORE the rev guard, so a stale push cannot
 *     slip past it by being retried at the new rev.
 *   - "refused": the match was deleted, or has no live court. It used to come
 *     back as "error", which the phone retried every fifteen seconds for ever.
 *   - "reset": the organiser cleared or reset the match after the rev this push
 *     was built on (step 8). Its rallies are from before the reset.
 *
 * THE RESET RULE: a push at a rev below the match's reset_rev never gets a
 * reply carrying a rev from after it. So the checks run in this order —
 * deleted → allowed → refused (no court, teams not known: carries no rev) →
 * RESET → typed → the rev guard — and the lost-race re-read again puts reset
 * before typed and stale. A phone therefore learns a post-reset rev only from
 * a RENDER (which carries reset_rev) or from a reply to a post-reset push; the
 * typed answer used to come first, and a push that lost to a clear AND a
 * retype was told the new rev, after which "Use this phone's score" landed
 * pre-reset rallies over the new result.
 */
export async function pushLog(
  matchId: string, log: Side[], expectedRev: number, tick: Tick = EMPTY,
  opts: { replaceTyped?: boolean } = {},
): Promise<PushResult> {
  const id = idSchema.parse(matchId);
  const incoming = z.array(sideSchema).max(500).parse(log);
  const clock = tickSchema.parse(tick);
  const rev = revSchema.parse(expectedRev);
  const replaceTyped = z.object({ replaceTyped: z.boolean().optional() }).parse(opts).replaceTyped ?? false;

  const found = await findMatch(id);
  if (!found) {
    return {
      ok: false, reason: "refused",
      title: "This match was deleted",
      error: "It was removed on the manage screen.",
    };
  }
  const ctx: Ctx = found;
  try {
    assert(canScore(await principalFor(ctx.tournament.id)), "score this match");
  } catch (e) {
    return { ok: false, reason: "error", error: e instanceof Error ? e.message : "Not allowed" };
  }

  const none = noLiveCourt(ctx.tournament, ctx.match);
  if (none) return { ok: false, reason: "refused", title: none.title, error: none.body };
  const notIn = teamsNotIn(ctx.match);
  if (notIn) return { ok: false, reason: "refused", title: notIn.title, error: notIn.body };
  if (rev < ctx.match.resetRev) return { ok: false, reason: "reset" };

  /* Replacing a typed result is allowed only for the result the referee SAW.
     If it was typed again since (or the row moved on any other way), answer
     with the result as it stands now, so the phone shows that one and asks
     again — a plain "stale" here left the card on the old score, and every
     replace went out at the old rev and failed for ever. */
  const typedNow = viewMatch(ctx.tournament, ctx.match);
  if (replaceTyped && typedNow.typedScore && rev !== ctx.match.rev) {
    return { ok: false, reason: "typed", ...typedNow.typedScore, outcome: typedNow.outcome, rev: ctx.match.rev };
  }
  /* An EMPTY log never replaces a typed result. That would CLEAR it — undo to
     0–0 with no signal, then "Use this phone's score" — and clearing a result
     is the organiser's alone (Faisal, 2026-10-10). */
  if (replaceTyped && typedNow.typedScore && incoming.length === 0) {
    return { ok: false, reason: "typed", ...typedNow.typedScore, outcome: typedNow.outcome, rev: ctx.match.rev };
  }

  /* A game is over at the rally that ends it, and a log carrying taps beyond
     that is cut there. A phone scoring offline could add one after the winning
     rally, so 11–4 landed as 12–4 — a final no game produces, which is refused
     a rating, and an undo back to 11–4 did not bring the rating back (the match
     was over both before and after, so nothing re-applied it). The taps after
     the finish were never part of the game. `scorePoint` already refuses a
     rally once the match is won; this is the same rule for a whole log. */
  const end = finishedAt(
    { log: incoming, server: ctx.match.server, posA: ctx.match.posA as 0 | 1, posB: ctx.match.posB as 0 | 1 },
    rulesFor(ctx.tournament, ctx.match),
  );
  const kept = end != null && end < incoming.length ? incoming.slice(0, end) : incoming;

  /* Gates are re-derived from the incoming log rather than trusted from the
     device: an offline console cannot evaluate OSL rotation (it is not shipped
     to the browser), so it may have queued rallies straight past a gate it
     never knew was due. */
  const res = await commitLog(ctx, kept, acksFor(ctx, kept), rev, clock, { replaceTyped });
  /* Say what was STORED when it is not what was sent, or the phone goes on
     believing in the taps after the finish and builds its next undo on them. */
  if (res.ok) return kept.length < incoming.length ? { ok: true, rev: res.rev, log: kept } : { ok: true, rev: res.rev };
  if (res.reason === "typed") {
    return { ok: false, reason: "typed", a: res.a, b: res.b, outcome: res.outcome, rev: ctx.match.rev };
  }
  /* Lost the race: answer with the match AS IT IS NOW. The log and rev read
     above are what this push was judged against, and the write that beat it
     moved both — a phone told the old rev retried at it, was stale again, and
     settled only on its last attempt, or not at all. */
  const now = await findMatch(id);
  if (!now) {
    return { ok: false, reason: "refused", title: "This match was deleted", error: "It was removed on the manage screen." };
  }
  if (rev < now.match.resetRev) return { ok: false, reason: "reset" };
  const typedLater = viewMatch(now.tournament, now.match);
  if (typedLater.typedScore) {
    return { ok: false, reason: "typed", ...typedLater.typedScore, outcome: typedLater.outcome, rev: now.match.rev };
  }
  return { ok: false, reason: "stale", serverLog: (now.match.log as Side[]) ?? [], rev: now.match.rev };
}

/** Confirm a rotation (and, at 14, the change of ends). Rules 3.4 / 5.6. */
export async function confirmRotation(matchId: string, gate: number, expectedRev: number): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const g = z.union([z.literal(7), z.literal(14)]).parse(gate);
  const rev = revSchema.parse(expectedRev);
  const ctx = await requireScorer(id);
  if (!ctx) return GONE;

  const old = revRefusal(ctx, rev);
  if (old) return old;
  const refused = courtRefusal(ctx);
  if (refused) return { ok: false, error: refused };
  const view = viewMatch(ctx.tournament, ctx.match);
  if (view.osl?.pendingGate !== g) return { ok: false, error: "That rotation is not due." };

  const acked = [...(ctx.match.ackedGates ?? []), g];
  const res = await commitLog(ctx, ctx.match.log as Side[], acked, rev, EMPTY);
  return res.ok ? { ok: true } : STALE;
}

const scoreSchema = z.number().int().min(0).max(MAX_SCORE);

const recordSchema = z.object({
  a: scoreSchema,
  b: scoreSchema,
  expectedRev: revSchema,
  outcome: z.enum(OUTCOMES).nullable().optional(),
  /* Best of 3 is three sets at most; five leaves room for a best of 5. */
  sets: z.array(z.tuple([scoreSchema, scoreSchema])).max(5).nullable().optional(),
  /** Typing over a match that is being refereed live replaces its rallies. */
  replaceLive: z.boolean().optional(),
});

export type RecordInput = z.input<typeof recordSchema>;

export type { RecordReply };

/**
 * Record a result typed in rather than scored rally by rally — the final
 * score, a walkover, or a game that did not finish normally.
 *
 * Organisers and PIN referees alike (`canScore`): Faisal, 2026-09-29, "either,
 * freely", including over a match being refereed live. Replacing live rallies
 * is still a CHOICE, never a side effect: without `replaceLive` a match with
 * rallies answers "live" and names what would be lost.
 *
 * The final is judged by the rules this match is played under (lib/results/
 * record, `endingOf`). A result recorded with an `outcome` counts in the table
 * and moves no rating, so it may stand short of the end — a game stopped at
 * 9–7 — but never past it, and it still needs a winner.
 *
 * Idempotent: the same result again returns ok at the current rev, even from
 * an older rev, so a retry after a reply lost on a bad connection is not an
 * error. The rules themselves are `recordTypedResult` (lib/results/write),
 * which the organiser's Walkover button goes through too.
 */
export async function recordResult(matchId: string, input: RecordInput): Promise<RecordReply> {
  const id = idSchema.parse(matchId);
  const v = recordSchema.parse(input);
  const ctx = await requireScorer(id);
  if (!ctx) return { ok: false, code: "stale", error: "This match was deleted on the manage screen." };
  /* Giving a walkover is the organiser's (Faisal, step 8b) — the "Walkover…"
     button is on the manage screen, and this is a public endpoint a scorer's
     PIN reaches. Typing a played result stays anybody's who may score (step
     7, "either, freely"); a retirement or a game stopped early was played. */
  if (v.outcome === "walkover" && !canManage(await principalFor(ctx.tournament.id))) {
    return { ok: false, code: "organiser-only", error: "Only the organiser can give a walkover — on the manage screen." };
  }
  return recordTypedResult(ctx, {
    a: v.a, b: v.b, expectedRev: v.expectedRev, outcome: v.outcome ?? null, sets: v.sets ?? null,
    replaceLive: v.replaceLive ?? false,
  });
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
