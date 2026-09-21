import "server-only";

/* Writing an entry, and the one rule the database decides for it.
 *
 * ── One live entry per phone per event ───────────────────────────────────
 * The entry action asks first whether this phone already has a live entry, and
 * that stays: it answers the ordinary double-tap cheaply. But asking and
 * inserting are two statements, and two submits in the same moment both got
 * "no" to the question and both went in. The partial unique index
 * `registrations_one_live_per_phone` is the arbiter now.
 *
 * It is consulted through `onConflictDoNothing`, NOT by catching the error.
 * The two drivers this app runs on name the violated constraint differently —
 * PGlite puts it on `constraint`, postgres-js on `constraint_name` — so a catch
 * that matched on the name passed every local test and would have shown the
 * entrant a raw database error in production. Doing nothing on conflict needs
 * no name at all: the only other unique key on the table is a random UUID.
 * `findOrCreatePerson` settles its race the same way. */

import { db } from "@/lib/db";
import { registrationPlayers, registrations } from "@/lib/db/schema";

export type NewEntry = typeof registrations.$inferInsert & { id: string };
export type NewEntrant = Omit<typeof registrationPlayers.$inferInsert, "registrationId">;

/**
 * Write an entry and its players together, or nothing at all.
 *
 * False when the phone already has a live entry in this event. Nothing is
 * written then — no entry, and no players pointing at one.
 */
export async function writeEntry(entry: NewEntry, players: NewEntrant[]): Promise<boolean> {
  return db.transaction(async (tx) => {
    const [made] = await tx
      .insert(registrations)
      .values(entry)
      .onConflictDoNothing()
      .returning({ id: registrations.id });
    if (!made) return false;

    if (players.length > 0) {
      await tx.insert(registrationPlayers).values(players.map((p) => ({ ...p, registrationId: made.id })));
    }
    return true;
  });
}
