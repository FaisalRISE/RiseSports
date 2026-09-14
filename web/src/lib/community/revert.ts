import "server-only";

/* Undoing a community result.
 *
 * Mirrors `revertMatchRatings` (lib/rating/apply.ts) for the community side.
 * The rating is defined as seed plus the sum of its recorded deltas, so undoing
 * means deleting this result's rows and subtracting what they applied — which
 * keeps every rating explainable by its own history rather than by a number
 * somebody adjusted.
 *
 * The same honest limitation applies as on the tournament side: later results
 * were computed against the rating this one produced and are NOT recomputed.
 * That would cascade through every opponent and their opponents. The numbers
 * stay self-consistent and the drift is bounded by one game's delta.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { people, ratingHistory, ratingLedger } from "@/lib/db/schema";

export async function revertCommunityResult(
  communityMatchId: string,
): Promise<{ reverted: number }> {
  const rows = await db
    .select()
    .from(ratingHistory)
    .where(eq(ratingHistory.communityMatchId, communityMatchId));
  if (rows.length === 0) return { reverted: 0 };

  await db.transaction(async (tx) => {
    await tx.delete(ratingHistory).where(eq(ratingHistory.communityMatchId, communityMatchId));
    await tx.delete(ratingLedger).where(eq(ratingLedger.communityMatchId, communityMatchId));

    for (const r of rows) {
      const [person] = await tx.select().from(people).where(eq(people.id, r.personId)).limit(1);
      if (!person) continue;

      const current = person.riseRatings?.[r.format] ?? r.ratingAfter;
      const ratings = { ...(person.riseRatings ?? {}), [r.format]: current - r.deltaApplied };
      const counts = {
        ...(person.matchCount ?? {}),
        [r.format]: Math.max(0, (person.matchCount?.[r.format] ?? 1) - 1),
      };

      await tx
        .update(people)
        .set({
          riseRatings: ratings,
          riseBest: Math.max(...Object.values(ratings)),
          matchCount: counts,
        })
        .where(eq(people.id, r.personId));
    }
  });

  return { reverted: rows.length };
}
