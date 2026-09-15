import "server-only";

/* What one person has won, across every event they have played.
 *
 * ── Why this is not `podiums()` in a loop ────────────────────────────────
 * That would mean loading each tournament whole — every match, every team,
 * every group — to read one line off the end of it. A player with twenty
 * events would cost twenty full loads on a page that shows a short list.
 *
 * The deciding matches are `Final` and `Third Place`, so they can be asked for
 * directly: one query for the teams this person was in, one for the deciding
 * matches those teams appear in. The podium rule itself is still `lib/placings`
 * — `settled` decides who won, and "no playoff means no bronze" falls out of
 * there being no Third Place row to find.
 *
 * A table-decided title (a league with no final) does NOT appear here. It would
 * need every one of that division's matches to check the table is complete,
 * which is the whole-tournament load this exists to avoid — and a league title
 * is shown on the event's own page. Worth revisiting if leagues become common.
 */

import { and, eq, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { divisions, matches, players, tournaments } from "@/lib/db/schema";
import { settled, type Placing } from "./index";

export type Honour = {
  placing: Placing;
  tournamentName: string;
  tournamentSlug: string;
  /** Null when the event ran a single unnamed category. */
  categoryName: string | null;
  at: Date | null;
};

const FINAL = "Final";
const THIRD = "Third Place";

export async function honoursFor(personId: string): Promise<Honour[]> {
  /* Which teams this person has been in. A person in two categories of one
     event is in two teams — and can place in both. */
  const mine = await db
    .select({ teamId: players.teamId })
    .from(players)
    .where(eq(players.personId, personId));

  const teamIds = [...new Set(mine.map((r) => r.teamId).filter((x): x is string => !!x))];
  if (teamIds.length === 0) return [];

  const rows = await db
    .select({ match: matches, tournament: tournaments, division: divisions })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .innerJoin(divisions, eq(matches.divisionId, divisions.id))
    .where(
      and(
        inArray(matches.round, [FINAL, THIRD]),
        or(inArray(matches.teamAId, teamIds), inArray(matches.teamBId, teamIds)),
      ),
    );

  const out: Honour[] = [];
  for (const r of rows) {
    const decided = settled(r.tournament, r.match);
    if (!decided) continue;

    const placing: Placing | null =
      r.match.round === THIRD
        ? (teamIds.includes(decided.winner) ? "bronze" : null)
        : teamIds.includes(decided.winner) ? "gold"
        : teamIds.includes(decided.loser) ? "silver"
        : null;
    if (!placing) continue;

    out.push({
      placing,
      tournamentName: r.tournament.name,
      tournamentSlug: r.tournament.slug,
      /* "Main" is the implied single category every event is created with, so
         naming it on a profile says nothing. */
      categoryName: r.division.name === "Main" ? null : r.division.name,
      at: r.tournament.startsAt,
    });
  }

  const RANK: Record<Placing, number> = { gold: 0, silver: 1, bronze: 2 };
  return out.sort(
    (a, b) =>
      (b.at?.getTime() ?? 0) - (a.at?.getTime() ?? 0) || RANK[a.placing] - RANK[b.placing],
  );
}
