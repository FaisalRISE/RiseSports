import "server-only";

/* Who belongs to an invite-only game.
 *
 * Ported from app.source.js:10078-10100, where it is three arrays on the game
 * — `members`, `joinRequests`, `invites` — mutated in place.
 *
 * Here it is one row per person per game carrying a state, made exclusive by
 * `community_members_game_person_idx`. Same reasoning as the session roster:
 * with three arrays a person can be in two of them at once and every read has
 * to resolve that by priority, which is a rule nothing enforces. One row cannot
 * be in two states.
 *
 * An OPEN game has no rows here at all. Membership is only a question for
 * restricted ones, and storing "everyone" for an open game would be a list that
 * has to be kept in step with nothing.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  communityMembers, people,
  type CommunityGame, type MembershipState, type Person,
} from "@/lib/db/schema";

/** What this person is to this game. "organiser" outranks everything. */
export type Standing = "organiser" | "member" | "invited" | "requested" | "none";

export type MembershipResult = { ok: true; standing: Standing } | { ok: false; error: string };

const ok = (standing: Standing): MembershipResult => ({ ok: true, standing });
const no = (error: string): MembershipResult => ({ ok: false, error });

/* ── Reading ──────────────────────────────────────────────────────────────*/

export async function standingOf(
  game: CommunityGame, personId: string | null,
): Promise<Standing> {
  if (!personId) return "none";
  /* The host is a member of their own game without a row, so removing the last
     member can never lock the organiser out of it. */
  if (game.hostPersonId === personId) return "organiser";

  const [row] = await db
    .select({ state: communityMembers.state })
    .from(communityMembers)
    .where(and(eq(communityMembers.gameId, game.id), eq(communityMembers.personId, personId)))
    .limit(1);
  return row?.state ?? "none";
}

export type MemberRow = { personId: string; person: Person; state: MembershipState };

/** Everyone with a row for this game, oldest first. */
export async function membersOf(game: CommunityGame): Promise<{
  members: MemberRow[]; requested: MemberRow[]; invited: MemberRow[];
}> {
  const rows = await db
    .select({ m: communityMembers, p: people })
    .from(communityMembers)
    .innerJoin(people, eq(communityMembers.personId, people.id))
    .where(eq(communityMembers.gameId, game.id))
    .orderBy(asc(communityMembers.createdAt));

  const all: MemberRow[] = rows.map(({ m, p }) => ({
    personId: m.personId, person: p, state: m.state,
  }));
  const of = (s: MembershipState) => all.filter((r) => r.state === s);

  return { members: of("member"), requested: of("requested"), invited: of("invited") };
}

/* ── Writing ──────────────────────────────────────────────────────────────*/

async function setState(
  gameId: string, personId: string, state: MembershipState,
): Promise<void> {
  await db
    .insert(communityMembers)
    .values({ id: randomUUID(), gameId, personId, state })
    .onConflictDoUpdate({
      target: [communityMembers.gameId, communityMembers.personId],
      set: { state },
    });
}

async function clear(gameId: string, personId: string): Promise<void> {
  await db
    .delete(communityMembers)
    .where(and(eq(communityMembers.gameId, gameId), eq(communityMembers.personId, personId)));
}

/* ── What a player does ───────────────────────────────────────────────────*/

/** "Can I join?" — the host sees it and decides. */
export async function requestToJoin(
  game: CommunityGame, personId: string,
): Promise<MembershipResult> {
  const standing = await standingOf(game, personId);
  if (standing === "organiser" || standing === "member") return no("You are already in this game.");
  if (standing === "requested") return no("You have already asked to join.");

  /* An invitation is better than a request: accepting it is one tap and needs
     nobody's approval, so turning it into a request would be a step backwards. */
  if (standing === "invited") return no("You have an invitation — accept it instead.");

  await setState(game.id, personId, "requested");
  return ok("requested");
}

/** Take up an invitation. */
export async function acceptInvitation(
  game: CommunityGame, personId: string,
): Promise<MembershipResult> {
  const standing = await standingOf(game, personId);
  if (standing === "organiser" || standing === "member") return ok(standing);
  if (standing !== "invited") return no("You have not been invited to this game.");

  await setState(game.id, personId, "member");
  return ok("member");
}

/** Withdraw a request, decline an invitation, or leave the game. */
export async function leaveGame(
  game: CommunityGame, personId: string,
): Promise<MembershipResult> {
  if (game.hostPersonId === personId) {
    return no("You run this game, so you cannot leave it.");
  }
  await clear(game.id, personId);
  return ok("none");
}

/* ── What the host does ───────────────────────────────────────────────────*/

export async function approveRequest(
  game: CommunityGame, personId: string,
): Promise<MembershipResult> {
  const standing = await standingOf(game, personId);
  if (standing === "member" || standing === "organiser") return ok(standing);
  if (standing !== "requested") return no("They have not asked to join.");

  await setState(game.id, personId, "member");
  return ok("member");
}

export async function denyRequest(
  game: CommunityGame, personId: string,
): Promise<MembershipResult> {
  const standing = await standingOf(game, personId);
  if (standing !== "requested") return no("They have not asked to join.");
  await clear(game.id, personId);
  return ok("none");
}

/** Invite somebody who has not asked. */
export async function invitePlayer(
  game: CommunityGame, personId: string,
): Promise<MembershipResult> {
  const standing = await standingOf(game, personId);
  if (standing === "member" || standing === "organiser") return no("They are already in.");
  if (standing === "invited") return no("They have already been invited.");

  /* Someone who asked to join and is then "invited" should simply be let in —
     the host has said yes either way, and leaving them on the request list
     after that reads as the tap having done nothing. */
  if (standing === "requested") {
    await setState(game.id, personId, "member");
    return ok("member");
  }

  await setState(game.id, personId, "invited");
  return ok("invited");
}

export async function cancelInvitation(
  game: CommunityGame, personId: string,
): Promise<MembershipResult> {
  const standing = await standingOf(game, personId);
  if (standing !== "invited") return no("There is no invitation to cancel.");
  await clear(game.id, personId);
  return ok("none");
}

/**
 * Take somebody out of the game.
 *
 * Their existing attendance rows are deliberately NOT deleted. Removing a
 * member is about future dates; a session they already played is a record of
 * what happened, and the ratings it moved point at it.
 */
export async function removeMember(
  game: CommunityGame, personId: string,
): Promise<MembershipResult> {
  if (game.hostPersonId === personId) return no("You cannot remove the organiser.");
  const standing = await standingOf(game, personId);
  if (standing === "none") return no("They are not in this game.");
  await clear(game.id, personId);
  return ok("none");
}
