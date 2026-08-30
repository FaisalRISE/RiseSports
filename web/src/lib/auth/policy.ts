/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Authorization decisions, as pure functions.
 *
 * Kept free of cookies, database and framework so they can be unit-tested
 * exhaustively — an access-control bug that only shows up in production is the
 * expensive kind. lib/auth/guard.ts does the I/O and delegates every decision
 * here.
 *
 * The rule this replaces: the single-file app kept the role in localStorage,
 * so a user could simply set themselves to ADMIN. Roles now live server-side,
 * per tournament, and are checked on every mutation. */

import type { Role } from "@/lib/db/schema";

/** Higher number wins. SCORER is deliberately NOT below PLAYER: a courtside
 *  volunteer who redeemed a PIN can score, but can do nothing else. */
const RANK: Record<Role, number> = { PLAYER: 1, SCORER: 2, ORGANIZER: 3, ADMIN: 4 };

export type Principal = {
  userId: string | null;
  /** Role granted to this user for THIS tournament, if any. */
  role: Role | null;
  /** True when a valid, unrevoked, unexpired scorer PIN grant is presented. */
  hasScorerGrant: boolean;
  /** True when this user owns the tournament. */
  isOwner: boolean;
};

export const anonymous = (): Principal => ({
  userId: null, role: null, hasScorerGrant: false, isOwner: false,
});

const atLeast = (p: Principal, role: Role): boolean =>
  p.isOwner || (p.role != null && RANK[p.role] >= RANK[role]);

/** Anyone may read a published tournament; drafts are for the organiser. */
export const canView = (p: Principal, published: boolean): boolean =>
  published || atLeast(p, "ORGANIZER");

/** Record points, undo, confirm rotations. A PIN grant is enough on its own. */
export const canScore = (p: Principal): boolean => p.hasScorerGrant || atLeast(p, "SCORER");

/** Create and edit matches, teams, line-ups; rotate the PIN. */
export const canManage = (p: Principal): boolean => atLeast(p, "ORGANIZER");

/** Delete the tournament, transfer ownership. */
export const canAdminister = (p: Principal): boolean => atLeast(p, "ADMIN");

export class AuthorizationError extends Error {
  constructor(public readonly action: string) {
    super(`Not allowed: ${action}`);
    this.name = "AuthorizationError";
  }
}

export function assert(allowed: boolean, action: string): void {
  if (!allowed) throw new AuthorizationError(action);
}

/** A grant is only usable while it is unrevoked and unexpired. */
export const grantIsUsable = (
  grant: { revokedAt: Date | null; expiresAt: Date | null } | null | undefined,
  now: Date = new Date(),
): boolean => !!grant && grant.revokedAt == null && (grant.expiresAt == null || grant.expiresAt > now);
