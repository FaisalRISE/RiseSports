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
import { eq } from "drizzle-orm";
import { divisions, registrationPlayers, registrations } from "@/lib/db/schema";

export type NewEntry = typeof registrations.$inferInsert & { id: string };
export type NewEntrant = Omit<typeof registrationPlayers.$inferInsert, "registrationId">;

/**
 * Write an entry and its players together, or nothing at all.
 *
 * "taken" when the phone already has a live entry in this event, and
 * "category-gone" when the category it names was removed while the entrant
 * filled the form in. Nothing is written then — no entry, and no players
 * pointing at one. The category is taken (KEY SHARE) before the insert, so a
 * removal under way finishes first and this answers in words rather than with
 * the foreign-key error the insert would have hit.
 */
export async function writeEntry(entry: NewEntry, players: NewEntrant[]): Promise<"written" | "taken" | "category-gone"> {
  return db.transaction(async (tx) => {
    if (entry.divisionId) {
      const [cat] = await tx.select({ id: divisions.id }).from(divisions).where(eq(divisions.id, entry.divisionId)).for("key share");
      if (!cat) return "category-gone";
    }
    const [made] = await tx
      .insert(registrations)
      .values(entry)
      .onConflictDoNothing()
      .returning({ id: registrations.id });
    if (!made) return "taken";

    if (players.length > 0) {
      await tx.insert(registrationPlayers).values(players.map((p) => ({ ...p, registrationId: made.id })));
    }
    return "written";
  });
}
