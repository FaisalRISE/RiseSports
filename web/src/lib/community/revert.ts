import "server-only";

/* Undoing a community result.
 *
 * The rating is defined as seed plus the sum of its recorded deltas, so undoing
 * means deleting this result's rows and subtracting what they applied — which
 * keeps every rating explainable by its own history rather than by a number
 * somebody adjusted.
 *
 * This file used to carry its own copy of the tournament revert, line for line,
 * and so its own copy of the faults: rows read outside the transaction (two
 * clears of one game both subtracted), and the partner record and last-played
 * date left moved. There is ONE revert now, `revertResultIn` in
 * lib/rating/apply.ts, and it takes the same locks in the same order as every
 * other rating writer. This file only says which match, and clears the score in
 * the SAME transaction, so a game is never left showing a score whose rating has
 * been taken back, or the other way round.
 *
 * The same honest limitation applies as on the tournament side: later results
 * were computed against the rating this one produced and are NOT recomputed.
 * That would cascade through every opponent and their opponents. The numbers
 * stay self-consistent and the drift is bounded by one game's delta.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { communityMatches } from "@/lib/db/schema";
import { revertResultIn } from "@/lib/rating/apply";

/** Take back the rating a community result moved, leaving its score alone. */
export async function revertCommunityResult(
  communityMatchId: string,
): Promise<{ reverted: number }> {
  const done = await db.transaction((tx) =>
    revertResultIn(tx, { kind: "community", communityMatchId }),
  );
  return { reverted: done.reverted };
}

/** Take back the rating AND clear the score, as one write. */
export async function clearCommunityResult(
  communityMatchId: string,
): Promise<{ reverted: number }> {
  const done = await db.transaction(async (tx) => {
    const r = await revertResultIn(tx, { kind: "community", communityMatchId });
    await tx
      .update(communityMatches)
      .set({ scoreA: null, scoreB: null })
      .where(eq(communityMatches.id, communityMatchId));
    return r;
  });
  return { reverted: done.reverted };
}
