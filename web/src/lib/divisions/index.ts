import "server-only";

/* Categories within an event — Men's Doubles, Mixed, U-17, Beginners.
 *
 * The rule this module exists to keep: EVERY tournament has at least one
 * division. An organiser who never asks for categories gets one called "Main"
 * and never sees it; the manage screen hides the tabs when there is only one.
 *
 * The alternative — divisions optional, with a fallback path when absent —
 * means two code paths through every draw function, and the no-division path
 * is the one that rots unseen. So: one path, and this file is what guarantees
 * there is always something for it to point at. */

import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { divisions, type Division } from "@/lib/db/schema";

/** Every category of an event, in the organiser's own order. */
export async function divisionsOf(tournamentId: string): Promise<Division[]> {
  return db
    .select()
    .from(divisions)
    .where(eq(divisions.tournamentId, tournamentId))
    .orderBy(asc(divisions.position), asc(divisions.createdAt));
}

/**
 * Create the default category for a new event.
 *
 * Called once at creation. Named "Main" rather than the event's own name so
 * that an organiser who later adds real categories sees an obvious placeholder
 * to rename, not a duplicate of the tournament title.
 */
export async function createDefaultDivision(tournamentId: string): Promise<string> {
  const id = randomUUID();
  await db.insert(divisions).values({ id, tournamentId, name: "Main", position: 0 });
  return id;
}

/**
 * The category a row belongs to when nothing more specific is known.
 *
 * Self-healing: an event with no divisions at all — one restored from a backup
 * taken before this existed, say — gets its "Main" here rather than failing a
 * not-null constraint deep inside a draw.
 */
export async function defaultDivisionId(tournamentId: string): Promise<string> {
  const [first] = await divisionsOf(tournamentId);
  return first ? first.id : createDefaultDivision(tournamentId);
}

/**
 * Resolve a requested category, falling back to the default.
 *
 * `wanted` is checked against THIS tournament's divisions rather than trusted:
 * it arrives from a form field or a stored registration, and a stale or forged
 * id would otherwise attach a team to another event's category.
 */
export async function resolveDivisionId(
  tournamentId: string,
  wanted?: string | null,
): Promise<string> {
  const all = await divisionsOf(tournamentId);
  if (wanted && all.some((d) => d.id === wanted)) return wanted;
  return all[0]?.id ?? createDefaultDivision(tournamentId);
}
