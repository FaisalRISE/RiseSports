"use server";

/* Roster actions for one community session.
 *
 * ── The authorisation rule, which is the whole point of this file ─────────
 * There are exactly two kinds of action here and they are checked differently:
 *
 *   A player acts on THEMSELVES. The person id is never taken from the form —
 *   it is read from the cookie on the server. A form field would let anyone
 *   withdraw anyone else by editing one value in the page.
 *
 *   A host acts on OTHERS. The person id does come from the form, and the
 *   caller must pass hostGuard first.
 *
 * That is why these are separate exports rather than one action with a role
 * flag: a flag is a thing a caller can get wrong, and every caller of the
 * player actions would have to be trusted to set it.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { gameBySlug } from "@/lib/community/store";
import { hostGuard } from "@/lib/community/guard";
import { myPersonId } from "@/lib/community/me";
import * as roster from "@/lib/community/roster";
import type { RosterResult } from "@/lib/community/roster";

const slugSchema = z.string().trim().min(1).max(80);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Bad date.");
const idSchema = z.string().trim().min(1).max(64);

const fail = (error: string): RosterResult => ({ ok: false, error });

/* ── Player actions: the actor is the cookie, never the form ──────────────*/

type PlayerAction = "interested" | "request" | "withdraw" | "takeFreedSpot";

const PLAYER_ACTIONS = {
  interested: roster.toggleInterested,
  request: roster.requestSpot,
  withdraw: roster.withdraw,
  takeFreedSpot: roster.takeFreedSpot,
} as const;

export async function actOnMyPlace(
  slug: string,
  date: string,
  action: PlayerAction,
): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const d = dateSchema.safeParse(date);
  if (!s.success || !d.success) return fail("Bad request.");
  if (!(action in PLAYER_ACTIONS)) return fail("Unknown action.");

  /* Server-side, always. This is the line that stops one player withdrawing
     another by changing a hidden field. */
  const personId = await myPersonId();
  if (!personId) return fail("Say who you are first.");

  const game = await gameBySlug(s.data);
  if (!game) return fail("No such game.");

  /* Restricted games: membership is checked here, not in the component that
     decided whether to draw the button. */
  const { canJoinSessions } = await import("@/lib/community/store");
  if (!(await canJoinSessions(game, personId))) return fail("This game is invite only.");

  /* Eligibility too — the limits the host set are a rule, not a hint. A player
     who fails one must not get in by calling the action directly. */
  const { eligibilityFailures } = await import("@/lib/community");
  const { db } = await import("@/lib/db");
  const { people } = await import("@/lib/db/schema");
  const { eq } = await import("drizzle-orm");
  const [person] = await db.select().from(people).where(eq(people.id, personId)).limit(1);
  if (!person) return fail("Say who you are first.");

  const blockers = eligibilityFailures(person, game.restrictions);
  /* Withdrawing is always allowed. Someone whose rating moved out of range
     after they were confirmed must still be able to drop out. */
  if (blockers.length > 0 && action !== "withdraw") return fail(blockers.join(" · "));

  const result = await PLAYER_ACTIONS[action](game, d.data, personId);
  revalidatePath(`/play/${s.data}`);
  revalidatePath("/play");
  return result;
}

/* ── Host actions: the actor is checked, the target comes from the form ───*/

type HostAction =
  | "confirm" | "waitlist" | "promote" | "remove" | "nudge" | "togglePaid" | "markLinkSent";

const HOST_ACTIONS = {
  confirm: roster.confirmPlayer,
  waitlist: roster.waitlistPlayer,
  promote: roster.promoteFromWaitlist,
  remove: roster.removePlayer,
  nudge: roster.nudgeToRequest,
  togglePaid: roster.togglePaid,
  markLinkSent: roster.markLinkSent,
} as const;

export async function actOnPlayer(
  slug: string,
  date: string,
  personId: string,
  action: HostAction,
): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const d = dateSchema.safeParse(date);
  const p = idSchema.safeParse(personId);
  if (!s.success || !d.success || !p.success) return fail("Bad request.");
  if (!(action in HOST_ACTIONS)) return fail("Unknown action.");

  let game;
  try {
    game = await hostGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  const result = await HOST_ACTIONS[action](game, d.data, p.data);
  revalidatePath(`/play/${s.data}`);
  revalidatePath("/play");
  return result;
}

/** The host adding someone straight to the list by name. */
export async function addToSession(
  slug: string, date: string, personId: string,
): Promise<RosterResult> {
  return actOnPlayer(slug, date, personId, "confirm");
}

/* ── Games and scores ─────────────────────────────────────────────────────*/

export async function generateScheduleAction(slug: string, date: string): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const d = dateSchema.safeParse(date);
  if (!s.success || !d.success) return fail("Bad request.");

  let game;
  try {
    game = await hostGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  const { generateSchedule } = await import("@/lib/community/schedule");
  const res = await generateSchedule(game, d.data);
  revalidatePath(`/play/${s.data}`);
  return res.ok ? { ok: true, state: "none" } : fail(res.error);
}

const scoreSchema = z.number().int().min(0).max(999);

export async function saveScoreAction(
  slug: string, matchId: string, scoreA: number, scoreB: number,
): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const m = idSchema.safeParse(matchId);
  const a = scoreSchema.safeParse(scoreA);
  const b = scoreSchema.safeParse(scoreB);
  if (!s.success || !m.success) return fail("Bad request.");
  if (!a.success || !b.success) return fail("Scores must be whole numbers between 0 and 999.");

  let game;
  try {
    game = await hostGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  /* The match must belong to THIS game. Without it, a host of one game could
     save a score onto another game's match by passing its id. */
  const { db } = await import("@/lib/db");
  const { communityMatches, communitySessions } = await import("@/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const [owned] = await db
    .select({ id: communityMatches.id })
    .from(communityMatches)
    .innerJoin(communitySessions, eq(communityMatches.sessionId, communitySessions.id))
    .where(and(eq(communityMatches.id, m.data), eq(communitySessions.gameId, game.id)))
    .limit(1);
  if (!owned) return fail("That game is not part of this session.");

  const { saveScore } = await import("@/lib/community/schedule");
  const res = await saveScore(game, m.data, a.data, b.data);
  revalidatePath(`/play/${s.data}`);
  revalidatePath("/people");
  return res.ok ? { ok: true, state: "none" } : fail(res.error);
}

export async function clearScoreAction(slug: string, matchId: string): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const m = idSchema.safeParse(matchId);
  if (!s.success || !m.success) return fail("Bad request.");

  let game;
  try {
    game = await hostGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  const { db } = await import("@/lib/db");
  const { communityMatches, communitySessions } = await import("@/lib/db/schema");
  const { eq, and } = await import("drizzle-orm");
  const [owned] = await db
    .select({ id: communityMatches.id })
    .from(communityMatches)
    .innerJoin(communitySessions, eq(communityMatches.sessionId, communitySessions.id))
    .where(and(eq(communityMatches.id, m.data), eq(communitySessions.gameId, game.id)))
    .limit(1);
  if (!owned) return fail("That game is not part of this session.");

  const { clearScore } = await import("@/lib/community/schedule");
  const res = await clearScore(m.data);
  revalidatePath(`/play/${s.data}`);
  revalidatePath("/people");
  return res.ok ? { ok: true, state: "none" } : fail(res.error);
}

/* ── Slots, King of the Court, the ladder ─────────────────────────────────*/

const okResult: RosterResult = { ok: true, state: "none" };

/** A player taking or giving up a half-hour slot — always for themselves. */
export async function slotAction(
  slug: string, date: string, slot: string, take: boolean,
): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const d = dateSchema.safeParse(date);
  const sl = z.string().trim().min(1).max(20).safeParse(slot);
  if (!s.success || !d.success || !sl.success) return fail("Bad request.");

  const personId = await myPersonId();
  if (!personId) return fail("Say who you are first.");

  const game = await gameBySlug(s.data);
  if (!game) return fail("No such game.");

  const { canJoinSessions } = await import("@/lib/community/store");
  if (!(await canJoinSessions(game, personId))) return fail("This game is invite only.");

  const { takeSlot, giveUpSlot } = await import("@/lib/community/rotationsStore");
  const res = take
    ? await takeSlot(game, d.data, personId, sl.data)
    : await giveUpSlot(game, d.data, personId, sl.data);

  revalidatePath(`/play/${s.data}`);
  return res.ok ? okResult : fail(res.error);
}

/** The host putting somebody into a slot, or taking them out of one. */
export async function slotActionFor(
  slug: string, date: string, slot: string, personId: string, take: boolean,
): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const d = dateSchema.safeParse(date);
  const sl = z.string().trim().min(1).max(20).safeParse(slot);
  const p = idSchema.safeParse(personId);
  if (!s.success || !d.success || !sl.success || !p.success) return fail("Bad request.");

  let game;
  try {
    game = await hostGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  const { takeSlot, giveUpSlot } = await import("@/lib/community/rotationsStore");
  const res = take
    ? await takeSlot(game, d.data, p.data, sl.data)
    : await giveUpSlot(game, d.data, p.data, sl.data);

  revalidatePath(`/play/${s.data}`);
  return res.ok ? okResult : fail(res.error);
}

type KotcOp = { op: "start" } | { op: "reset" } | { op: "next" } | { op: "pick"; court: number; side: "a" | "b" };

export async function kotcAction(slug: string, date: string, action: KotcOp): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const d = dateSchema.safeParse(date);
  if (!s.success || !d.success) return fail("Bad request.");

  let game;
  try {
    game = await hostGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  const r = await import("@/lib/community/rotationsStore");
  let res;
  switch (action.op) {
    case "start": res = await r.startKotc(game, d.data); break;
    case "reset": res = await r.resetKotc(game, d.data); break;
    case "next": res = await r.advanceKotc(game, d.data); break;
    case "pick": {
      const court = z.number().int().min(0).max(20).safeParse(action.court);
      if (!court.success || (action.side !== "a" && action.side !== "b")) return fail("Bad request.");
      res = await r.pickKotcWinner(game, d.data, court.data, action.side);
      break;
    }
    default: return fail("Unknown action.");
  }

  revalidatePath(`/play/${s.data}`);
  return res.ok ? okResult : fail(res.error);
}

type LadderOp =
  | { op: "add"; personId: string }
  | { op: "remove"; personId: string }
  | { op: "settle"; challenger: string; defender: string; challengerWon: boolean };

export async function ladderAction(slug: string, action: LadderOp): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  if (!s.success) return fail("Bad request.");

  let game;
  try {
    game = await hostGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  const r = await import("@/lib/community/rotationsStore");
  let res;
  if (action.op === "add" || action.op === "remove") {
    const p = idSchema.safeParse(action.personId);
    if (!p.success) return fail("Bad request.");
    res = action.op === "add"
      ? await r.addToLadder(game, p.data)
      : await r.removeFromLadder(game, p.data);
  } else if (action.op === "settle") {
    const c = idSchema.safeParse(action.challenger);
    const d2 = idSchema.safeParse(action.defender);
    if (!c.success || !d2.success) return fail("Bad request.");
    res = await r.settleChallenge(game, c.data, d2.data, !!action.challengerWon);
  } else return fail("Unknown action.");

  revalidatePath(`/play/${s.data}`);
  return res.ok ? okResult : fail(res.error);
}

/* ── Calling a date off ───────────────────────────────────────────────────*/

export async function setSessionCancelled(
  slug: string, date: string, cancelled: boolean,
): Promise<RosterResult> {
  const s = slugSchema.safeParse(slug);
  const d = dateSchema.safeParse(date);
  if (!s.success || !d.success) return fail("Bad request.");

  let game;
  try {
    game = await hostGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  const result = cancelled
    ? await roster.cancelSession(game, d.data)
    : await roster.uncancelSession(game, d.data);
  revalidatePath(`/play/${s.data}`);
  revalidatePath("/play");
  return result;
}
