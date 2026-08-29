import "server-only";

import { cookies } from "next/headers";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { eventRoles, scorerGrants, tournaments } from "@/lib/db/schema";
import { anonymous, grantIsUsable, type Principal } from "./policy";

/** One cookie per tournament, so redeeming a PIN for one event never grants
 *  anything at another. httpOnly: the token is never readable from client JS. */
export const grantCookieName = (tournamentId: string) => `rs_scorer_${tournamentId}`;

export const GRANT_COOKIE_OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  secure: process.env.NODE_ENV === "production",
  path: "/",
  maxAge: 60 * 60 * 24, // a scoring shift, not a permanent key
} as const;

/** Placeholder until Auth.js is wired in. Returns the signed-in user id, if any. */
async function currentUserId(): Promise<string | null> {
  return null;
}

/**
 * Build the principal for a tournament from the request: the signed-in user's
 * role for THIS event plus any scorer PIN grant presented in the cookie.
 *
 * Everything here is read server-side. Nothing the client sends is trusted
 * beyond the opaque grant token, which is checked against the database.
 */
export async function principalFor(tournamentId: string): Promise<Principal> {
  const p: Principal = anonymous();

  const jar = await cookies();
  const token = jar.get(grantCookieName(tournamentId))?.value;
  if (token) {
    const [grant] = await db
      .select()
      .from(scorerGrants)
      .where(and(eq(scorerGrants.tournamentId, tournamentId), eq(scorerGrants.token, token)))
      .limit(1);
    p.hasScorerGrant = grantIsUsable(grant ?? null);
  }

  const userId = await currentUserId();
  if (!userId) return p;
  p.userId = userId;

  const [t] = await db
    .select({ ownerId: tournaments.ownerId })
    .from(tournaments)
    .where(eq(tournaments.id, tournamentId))
    .limit(1);
  p.isOwner = t?.ownerId === userId;

  const [row] = await db
    .select({ role: eventRoles.role })
    .from(eventRoles)
    .where(and(eq(eventRoles.tournamentId, tournamentId), eq(eventRoles.userId, userId)))
    .limit(1);
  p.role = row?.role ?? null;

  return p;
}
