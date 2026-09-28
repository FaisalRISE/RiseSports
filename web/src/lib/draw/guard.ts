import "server-only";

/* What a redraw may throw away — and the one way it throws anything away.
 *
 * The three draws (groups, straight knockout, knockout from groups) used to
 * check first and delete afterwards, outside any transaction:
 *
 *   - "Draw groups & fixtures" deleted every match in the category's groups,
 *     PLAYED ONES INCLUDED, and their rating history cascaded away with them
 *     while the people's ratings stayed moved;
 *   - "Draw knockout" kept a played knockout row and inserted a whole new set
 *     beside it, so a second "Semi-Final 1" and a second "Final" appeared;
 *   - and a result that landed between the check and the delete was deleted
 *     anyway.
 *
 * Now a draw is refused outright while anything it would replace has a result
 * or a moved rating (`lockedIds`), and what it does delete goes through
 * `deleteUnplayed`: a conditional DELETE that re-checks every row inside the
 * statement and throws — rolling the whole draw back — if a row gained a
 * result after it was planned.
 */

import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { divisions, matches, ratingHistory, type Division, type Match } from "@/lib/db/schema";
import { hasPlay } from "@/lib/results";

/** A drizzle handle: the database itself, or a transaction on it. */
type Tx = Pick<typeof db, "select" | "selectDistinct" | "delete">;

/**
 * The rows among these that must never be deleted by a draw: anything with a
 * rally, a typed score, or a rating that moved because of it. One query.
 */
export async function lockedIds(rows: Pick<Match, "id" | "log" | "typedScoreA" | "typedScoreB">[], tx: Tx = db): Promise<Set<string>> {
  const locked = new Set(rows.filter(hasPlay).map((m) => m.id));
  const rest = rows.filter((m) => !locked.has(m.id)).map((m) => m.id);
  if (rest.length > 0) {
    const rated = await tx
      .selectDistinct({ id: ratingHistory.matchId })
      .from(ratingHistory)
      .where(inArray(ratingHistory.matchId, rest));
    for (const r of rated) if (r.id) locked.add(r.id);
  }
  return locked;
}

/** Thrown inside a draw's transaction to roll it back. Never shown as-is. */
export class DrawChanged extends Error {
  constructor() {
    super("A match gained a result while the draw was being made.");
  }
}

/**
 * Delete exactly these rows, and only while each still has no result and no
 * rating history — checked by the DELETE itself, not by an earlier read. If
 * fewer rows go than were planned, one of them was played in the meantime:
 * throw, so the draw's transaction rolls back and the result survives.
 */
export async function deleteUnplayed(tx: Tx, ids: string[]): Promise<void> {
  if (ids.length === 0) return;
  const gone = await tx
    .delete(matches)
    .where(and(
      inArray(matches.id, ids),
      sql`${matches.log} = '[]'::jsonb`,
      isNull(matches.typedScoreA),
      isNull(matches.typedScoreB),
      sql`not exists (select 1 from ${ratingHistory} where ${ratingHistory.matchId} = ${matches.id})`,
    ))
    .returning({ id: matches.id });
  if (gone.length !== ids.length) throw new DrawChanged();
}

/**
 * A fingerprint of exactly which rows a draw would replace.
 *
 * The manage page puts it on the draw's submit button and the server compares
 * it with the rows it finds. A plain "confirmed" flag was not enough: a phone
 * left open since before the first draw shows the one-tap FIRST-draw button,
 * and tapping it later replaced fixtures another device had drawn, scheduled
 * and lined up — the prompt that would have said so never appeared on that
 * phone. Now the server refuses whenever the page did not see what it is about
 * to replace. FNV-1a over the sorted ids: stable, order-free, short.
 */
export function drawSignature(ids: string[]): string {
  let h = 0x811c9dc5;
  for (const ch of [...ids].sort().join(",")) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${ids.length}-${h.toString(16)}`;
}

/**
 * The category a draw is for — REFUSING one that is not this event's.
 *
 * The old path (`resolveDivisionId`) quietly swapped an unknown or foreign id
 * for the event's first category, so a stale form redrew a category nobody
 * asked for. A form that sends no category at all still means the only one,
 * and only when there IS only one.
 */
export async function requireDivision(tournamentId: string, wanted: string | null, tx: Tx = db): Promise<Division | null> {
  const all = await tx.select().from(divisions).where(eq(divisions.tournamentId, tournamentId));
  if (wanted) return all.find((d) => d.id === wanted) ?? null;
  return all.length === 1 ? all[0] : null;
}
