import "server-only";

/* Who a player wins with.
 *
 * `people.partnerStats` has been written on every rated match since the rating
 * engine was ported — matches, wins, and the average rating of the partner and
 * the opposition — and nothing has ever shown it. Spec §6.2 keeps it so a
 * disputed carry guard can point at a specific person rather than at an
 * aggregate, and the same record answers the question a player actually asks:
 * "who do I play well with?"
 *
 * ── Why the win rate is withheld at low counts ───────────────────────────
 * Two matches with someone is 0%, 50% or 100%, and every one of those reads as
 * a verdict. The counts are always shown; the percentage appears only once
 * there are enough matches for it to mean anything. That threshold is a
 * judgement, not a statistic — it is set where a run of luck stops looking like
 * a pattern, and it is stated on screen rather than hidden.
 */

import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { people } from "@/lib/db/schema";
import type { PartnerStat } from "./apply";

/** Below this, the counts are shown and the percentage is not. */
export const RATE_THRESHOLD = 4;

export type PartnerRow = {
  personId: string;
  name: string;
  matches: number;
  wins: number;
  /** Null until there are enough matches for a rate to mean anything. */
  winRate: number | null;
  avgPartnerRating: number;
  avgOpponentRating: number;
};

const isStat = (v: unknown): v is PartnerStat =>
  !!v && typeof v === "object" && typeof (v as PartnerStat).matches === "number";

/** Read a person's partner record, resolved to names. */
export async function partnersOf(stats: Record<string, unknown> | null): Promise<PartnerRow[]> {
  const entries = Object.entries(stats ?? {}).filter(
    (e): e is [string, PartnerStat] => isStat(e[1]) && e[1].matches > 0,
  );
  if (entries.length === 0) return [];

  const names = await db
    .select({ id: people.id, name: people.name })
    .from(people)
    .where(inArray(people.id, entries.map(([id]) => id)));
  const nameOf = new Map(names.map((n) => [n.id, n.name]));

  return entries
    .map(([personId, s]) => ({
      personId,
      /* A partner whose profile has since been merged or removed still counts
         as matches played — the record is about the games, not the row. */
      name: nameOf.get(personId) ?? "A former partner",
      matches: s.matches,
      wins: s.wins,
      winRate: s.matches >= RATE_THRESHOLD ? Math.round((s.wins / s.matches) * 100) : null,
      avgPartnerRating: s.avgPartnerRating,
      avgOpponentRating: s.avgOpponentRating,
    }))
    .sort((a, b) => b.matches - a.matches || b.wins - a.wins || a.name.localeCompare(b.name));
}
