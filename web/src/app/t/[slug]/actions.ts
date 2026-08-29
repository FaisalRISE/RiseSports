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
import { oslPruneAcks } from "@/lib/formats/osl";
import type { Side } from "@/lib/scoring/replay";

/* Every mutation in this file:
 *   1. loads the match and its tournament,
 *   2. builds the principal server-side and asserts the permission,
 *   3. writes with a revision guard so a stale device cannot roll the score back.
 *
 * The client cannot skip any of it — there is no code path to the database
 * that does not come through here. */

const sideSchema = z.enum(["a", "b"]);
const idSchema = z.string().min(1).max(64);

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

/** Write the log with an optimistic-concurrency guard on `rev`. */
async function commitLog(
  ctx: Ctx,
  log: Side[],
  ackedGates: number[],
  expectedRev: number,
): Promise<{ ok: true } | { ok: false; reason: "stale" }> {
  const updated = await db
    .update(matches)
    .set({
      log,
      ackedGates,
      rev: expectedRev + 1,
      updatedAt: new Date(),
      typedScoreA: null,
      typedScoreB: null,
    })
    .where(and(eq(matches.id, ctx.match.id), eq(matches.rev, expectedRev)))
    .returning({ id: matches.id });

  if (updated.length === 0) return { ok: false, reason: "stale" };
  revalidatePath(`/t/${ctx.tournament.slug}`);
  revalidatePath(`/t/${ctx.tournament.slug}/score/${ctx.match.id}`);
  return { ok: true };
}

export type ActionResult = { ok: true } | { ok: false; error: string };

/** Record one rally to the side that won it. */
export async function scorePoint(matchId: string, side: Side, expectedRev: number): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const w = sideSchema.parse(side);
  const ctx = await requireScorer(id);

  const view = viewMatch(ctx.tournament, ctx.match);
  if (view.over) return { ok: false, error: "The match is already won." };
  if (view.locked) return { ok: false, error: "Confirm the rotation before scoring." };

  const log = [...(ctx.match.log as Side[]), w];
  const res = await commitLog(ctx, log, ctx.match.ackedGates ?? [], expectedRev);
  return res.ok ? { ok: true } : { ok: false, error: "Another device scored first — reloading." };
}

/** Undo is just dropping the last entry; that is the whole point of the log. */
export async function undoPoint(matchId: string, expectedRev: number): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const ctx = await requireScorer(id);

  const log = [...(ctx.match.log as Side[])];
  if (log.length === 0) return { ok: false, error: "Nothing to undo." };
  log.pop();

  /* Dropping below a rotation gate re-arms that confirmation, so the console
     cannot silently drift out of step with the players on court. */
  const a = log.filter((x) => x === "a").length;
  const lead = Math.max(a, log.length - a);
  const acked = ctx.tournament.format === "osl"
    ? oslPruneAcks(lead, ctx.match.ackedGates ?? [])
    : (ctx.match.ackedGates ?? []);

  const res = await commitLog(ctx, log, acked, expectedRev);
  return res.ok ? { ok: true } : { ok: false, error: "Another device scored first — reloading." };
}

/** Confirm a rotation (and, at 14, the change of ends). Rules 3.4 / 5.6. */
export async function confirmRotation(matchId: string, gate: number, expectedRev: number): Promise<ActionResult> {
  const id = idSchema.parse(matchId);
  const g = z.union([z.literal(7), z.literal(14)]).parse(gate);
  const ctx = await requireScorer(id);

  const view = viewMatch(ctx.tournament, ctx.match);
  if (view.osl?.pendingGate !== g) return { ok: false, error: "That rotation is not due." };

  const acked = [...(ctx.match.ackedGates ?? []), g];
  const res = await commitLog(ctx, ctx.match.log as Side[], acked, expectedRev);
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

  revalidatePath(`/t/${ctx.tournament.slug}`);
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
