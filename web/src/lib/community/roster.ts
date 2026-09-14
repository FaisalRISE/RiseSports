import "server-only";

/* The guest list for one session — who is in, who is waiting, who asked.
 *
 * Ported from the legacy state machine at app.source.js:10000-10042, where it
 * is four arrays (`interested`, `requested`, `confirmed`, `waitlist`) plus two
 * maps (`paid`, `linkSent`) on a session object, mutated in place.
 *
 * Here it is one row per person per session carrying a state, which the unique
 * index `community_attendance_session_person_idx` makes exclusive. That is the
 * substantive change: with four arrays, a person can end up in two of them at
 * once and every read has to pick a winner by priority (`ie` at :10015 checks
 * confirmed, then waitlist, then requested, then interested). One row cannot be
 * in two states, so there is no priority rule to get wrong and no repair path
 * to write.
 *
 * Every function here reads the current state inside a transaction and decides
 * from that, never from what the caller believed. Two people tapping "confirm"
 * on the last free spot is the ordinary case at a court, not an edge case.
 */

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  communityAttendance, communitySessions,
  type AttendanceState, type CommunityGame,
} from "@/lib/db/schema";
import { capacityOf } from "./index";
import { ensureSession } from "./store";

export type RosterResult = { ok: true; state: AttendanceState | "none" } | { ok: false; error: string };

const ok = (state: AttendanceState | "none"): RosterResult => ({ ok: true, state });
const no = (error: string): RosterResult => ({ ok: false, error });

/* ── Counting ─────────────────────────────────────────────────────────────*/

type Counts = { confirmed: number; withdrawn: number; maxWaitlistPosition: number };

/** Live counts for a session, read inside whatever transaction is running. */
async function countsFor(tx: typeof db, sessionId: string): Promise<Counts> {
  const rows = await tx
    .select({ state: communityAttendance.state, position: communityAttendance.position })
    .from(communityAttendance)
    .where(eq(communityAttendance.sessionId, sessionId));

  return {
    confirmed: rows.filter((r) => r.state === "confirmed").length,
    withdrawn: rows.filter((r) => r.state === "withdrawn").length,
    maxWaitlistPosition: rows
      .filter((r) => r.state === "waitlist")
      .reduce((m, r) => Math.max(m, r.position), 0),
  };
}

/**
 * Spots freed by somebody backing out, and still empty.
 *
 * Derived, never tallied. The legacy app keeps `openSlots` as a counter it
 * increments on withdrawal and decrements on promotion (:10019, :10023); a
 * counter like that drifts the first time any path forgets to touch it, and
 * nothing can then put it right. This is a function of the rows, so it is
 * correct by construction and self-heals.
 *
 * Both terms matter. "There is room" alone would let a waitlisted player undo
 * the host deliberately holding them back when the session is under-filled;
 * "somebody withdrew" alone would offer a spot that has already been refilled.
 */
export const openSlotsIn = (c: Counts, capacity: number): number =>
  Math.max(0, Math.min(c.withdrawn, capacity - c.confirmed));

/* ── The shared write ─────────────────────────────────────────────────────*/

/** Upsert this person's row for the session. One row, one state, always. */
async function setState(
  tx: typeof db,
  sessionId: string,
  personId: string,
  state: AttendanceState,
  extra: Partial<typeof communityAttendance.$inferInsert> = {},
): Promise<void> {
  await tx
    .insert(communityAttendance)
    .values({ id: randomUUID(), sessionId, personId, state, ...extra })
    .onConflictDoUpdate({
      target: [communityAttendance.sessionId, communityAttendance.personId],
      set: { state, updatedAt: new Date(), ...extra },
    });
}

async function currentState(
  tx: typeof db,
  sessionId: string,
  personId: string,
): Promise<AttendanceState | "none"> {
  const [row] = await tx
    .select({ state: communityAttendance.state })
    .from(communityAttendance)
    .where(
      and(eq(communityAttendance.sessionId, sessionId), eq(communityAttendance.personId, personId)),
    )
    .limit(1);
  return row?.state ?? "none";
}

/** Open the session and run `body` against it, all in one transaction. */
async function onSession(
  game: CommunityGame,
  date: string,
  body: (tx: typeof db, sessionId: string, capacity: number) => Promise<RosterResult>,
): Promise<RosterResult> {
  /* Opened OUTSIDE the transaction: it is an upsert of its own, and nesting it
     would make every roster action roll back a session row another request may
     already be using. */
  const session = await ensureSession(game.id, date);
  const capacity = capacityOf(game);
  return db.transaction(async (tx) => body(tx as typeof db, session.id, capacity));
}

/* ── What a player does to their own place ────────────────────────────────*/

/**
 * "I might come" / "actually, no" — a toggle.
 *
 * Only from nothing, and only back to nothing. Someone already requested or
 * confirmed tapping this would otherwise DEMOTE themselves to interested, which
 * is the legacy behaviour's one sharp edge (`X` at :10017 guards it the same
 * way, and this keeps that guard).
 */
export async function toggleInterested(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId) => {
    const state = await currentState(tx, sessionId, personId);
    if (state === "interested") {
      await tx.delete(communityAttendance).where(
        and(eq(communityAttendance.sessionId, sessionId), eq(communityAttendance.personId, personId)),
      );
      return ok("none");
    }
    if (state !== "none" && state !== "withdrawn") {
      return no("You are already on the list for this date.");
    }
    await setState(tx, sessionId, personId, "interested", { withdrewAt: null });
    return ok("interested");
  });
}

/** "Put me down" — becomes a request the host acts on. */
export async function requestSpot(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId) => {
    const state = await currentState(tx, sessionId, personId);
    if (state === "confirmed" || state === "waitlist" || state === "requested") {
      return no("You have already asked for this date.");
    }
    await setState(tx, sessionId, personId, "requested", { withdrewAt: null });
    return ok("requested");
  });
}

/**
 * "I can't make it."
 *
 * A confirmed player leaving is recorded as `withdrawn`, because it frees a
 * spot the waitlist should be told about. Anyone else is simply removed — there
 * is nothing to free and no reason to keep a row saying they once thought about
 * it.
 */
export async function withdraw(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId) => {
    const state = await currentState(tx, sessionId, personId);
    if (state === "none") return no("You are not on the list for this date.");

    if (state === "confirmed") {
      await setState(tx, sessionId, personId, "withdrawn", {
        withdrewAt: new Date(),
        paid: false,
        position: 0,
      });
      return ok("withdrawn");
    }

    await tx.delete(communityAttendance).where(
      and(eq(communityAttendance.sessionId, sessionId), eq(communityAttendance.personId, personId)),
    );
    return ok("none");
  });
}

/** A waitlisted player taking a spot that a backout freed. */
export async function takeFreedSpot(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId, capacity) => {
    const state = await currentState(tx, sessionId, personId);
    if (state !== "waitlist") return no("Only someone on the waitlist can move up.");

    const counts = await countsFor(tx, sessionId);
    if (openSlotsIn(counts, capacity) <= 0) return no("No spot has come free.");

    await setState(tx, sessionId, personId, "confirmed", { position: 0 });
    return ok("confirmed");
  });
}

/* ── What the host does to the list ───────────────────────────────────────*/

/**
 * Give this person a spot — or the next place on the waitlist if it is full.
 *
 * Silently landing on the waitlist rather than failing is the legacy behaviour
 * (`A` at :10022) and is the right one: the host's intent is "yes, this person
 * is in", and a full session makes that "in, behind the others", not an error
 * to re-read and retry.
 */
export async function confirmPlayer(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId, capacity) => {
    if ((await currentState(tx, sessionId, personId)) === "confirmed") return ok("confirmed");

    const counts = await countsFor(tx, sessionId);
    if (counts.confirmed < capacity) {
      await setState(tx, sessionId, personId, "confirmed", { position: 0, withdrewAt: null });
      return ok("confirmed");
    }
    await setState(tx, sessionId, personId, "waitlist", {
      position: counts.maxWaitlistPosition + 1,
      withdrewAt: null,
    });
    return ok("waitlist");
  });
}

/** Move someone to the back of the waitlist. */
export async function waitlistPlayer(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId) => {
    if ((await currentState(tx, sessionId, personId)) === "waitlist") return ok("waitlist");
    const counts = await countsFor(tx, sessionId);
    await setState(tx, sessionId, personId, "waitlist", {
      position: counts.maxWaitlistPosition + 1,
      paid: false,
    });
    return ok("waitlist");
  });
}

/**
 * Promote from the waitlist.
 *
 * Unlike a player taking a freed spot, the host may do this whenever there is
 * room — it is their session, and "somebody backed out" is a rule that exists
 * to stop players jumping the queue, not to stop the host filling it.
 */
export async function promoteFromWaitlist(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId, capacity) => {
    const counts = await countsFor(tx, sessionId);
    if (counts.confirmed >= capacity) return no("The session is full.");
    await setState(tx, sessionId, personId, "confirmed", { position: 0 });
    return ok("confirmed");
  });
}

/** Take a confirmed player out, freeing their spot for the waitlist. */
export async function removePlayer(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId) => {
    const state = await currentState(tx, sessionId, personId);
    if (state === "none") return no("They are not on the list.");

    if (state === "confirmed") {
      await setState(tx, sessionId, personId, "withdrawn", {
        withdrewAt: new Date(), paid: false, position: 0,
      });
      return ok("withdrawn");
    }
    await tx.delete(communityAttendance).where(
      and(eq(communityAttendance.sessionId, sessionId), eq(communityAttendance.personId, personId)),
    );
    return ok("none");
  });
}

/** Nudge someone who is only interested into the requests queue. */
export async function nudgeToRequest(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId) => {
    if ((await currentState(tx, sessionId, personId)) !== "interested") {
      return no("They are not on the interested list.");
    }
    await setState(tx, sessionId, personId, "requested");
    return ok("requested");
  });
}

/* ── Money ────────────────────────────────────────────────────────────────*/

/** Mark paid, or unmark it. Only means anything for someone with a spot. */
export async function togglePaid(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId) => {
    const [row] = await tx
      .select({ paid: communityAttendance.paid, state: communityAttendance.state })
      .from(communityAttendance)
      .where(
        and(eq(communityAttendance.sessionId, sessionId), eq(communityAttendance.personId, personId)),
      )
      .limit(1);
    if (!row) return no("They are not on the list.");

    await tx
      .update(communityAttendance)
      .set({ paid: !row.paid, updatedAt: new Date() })
      .where(
        and(eq(communityAttendance.sessionId, sessionId), eq(communityAttendance.personId, personId)),
      );
    return ok(row.state);
  });
}

/** Record that a payment link went out, so the host is not asked twice. */
export async function markLinkSent(
  game: CommunityGame, date: string, personId: string,
): Promise<RosterResult> {
  return onSession(game, date, async (tx, sessionId) => {
    const state = await currentState(tx, sessionId, personId);
    if (state === "none") return no("They are not on the list.");
    await tx
      .update(communityAttendance)
      .set({ paymentLinkSentAt: new Date(), updatedAt: new Date() })
      .where(
        and(eq(communityAttendance.sessionId, sessionId), eq(communityAttendance.personId, personId)),
      );
    return ok(state);
  });
}

/* ── Cancelling a whole date ──────────────────────────────────────────────*/

export async function cancelSession(game: CommunityGame, date: string): Promise<RosterResult> {
  const session = await ensureSession(game.id, date);
  await db
    .update(communitySessions)
    .set({ cancelledAt: new Date() })
    .where(eq(communitySessions.id, session.id));
  return ok("none");
}

export async function uncancelSession(game: CommunityGame, date: string): Promise<RosterResult> {
  const session = await ensureSession(game.id, date);
  await db
    .update(communitySessions)
    .set({ cancelledAt: null })
    .where(eq(communitySessions.id, session.id));
  return ok("none");
}

/** Exposed for the counts a page needs without re-reading the whole roster. */
export async function sessionCounts(sessionId: string): Promise<Counts> {
  return countsFor(db, sessionId);
}
