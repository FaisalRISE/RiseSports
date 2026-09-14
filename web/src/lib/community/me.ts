import "server-only";

/* Who "you" are, for community play.
 *
 * The tournament side never needed this: it is organiser-facing, and the
 * organiser acts ON other people's entries. Community play is the opposite —
 * almost every action is something a PLAYER does to their own place in a
 * session ("I'm interested", "reserve me a slot", "I can't make it"), so the
 * page has to know which person is looking at it.
 *
 * There is no sign-in yet, so this is a cookie holding a person id, set from a
 * picker — the same shape as the legacy app's `rs_u`, and the same shape as the
 * Court Ledger's "you are the member flagged `me`, switchable from the Members
 * tab". It is a CONVENIENCE, not an identity: anyone can change it, exactly as
 * anyone could edit localStorage before.
 *
 * That is fine for a prototype and NOT fine once strangers arrive, so every
 * action that this identifies still has to be authorised on its own terms —
 * a player may only change their OWN attendance row, and host-only actions go
 * through the host check, never through this. The day sign-in lands, this file
 * is the only place that changes.
 */

import { cookies } from "next/headers";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { people, type Person } from "@/lib/db/schema";

const COOKIE = "rs_me";

const OPTIONS = {
  httpOnly: true,
  sameSite: "lax",
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
  secure: process.env.NODE_ENV === "production",
} as const;

/** The person id in the cookie, or null. Not validated against the database. */
export async function myPersonId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(COOKIE)?.value ?? null;
}

/**
 * The person the cookie names, or null.
 *
 * Returns null for a cookie pointing at a deleted person rather than throwing —
 * a stale cookie should make the page ask who you are, not break it.
 */
export async function me(): Promise<Person | null> {
  const id = await myPersonId();
  if (!id) return null;
  const [person] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  return person ?? null;
}

export async function setMe(personId: string): Promise<void> {
  const jar = await cookies();
  jar.set(COOKIE, personId, OPTIONS);
}

export async function clearMe(): Promise<void> {
  const jar = await cookies();
  jar.delete(COOKIE);
}
