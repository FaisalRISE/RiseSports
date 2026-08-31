import "server-only";

/* The per-tournament rating view.
 *
 * ── This used to derive; now it READS ────────────────────────────────────
 * Ratings were originally recomputed from a tournament's matches on every
 * render, which was right while a rating lived and died inside one event: undo
 * came free and nothing could disagree.
 *
 * Once ratings follow the player, that breaks. `rating_history` is the source
 * of truth (see lib/rating/apply.ts) and it records damping this view could not
 * reproduce — the §8 repeat-opponent factor and daily cap depend on what
 * happened in OTHER tournaments, and the §6.1 carry guard on who a player was
 * partnered with. Recomputing here would quietly disagree with the number the
 * player is actually carrying, which is the one thing a reference must never
 * do.
 *
 * So this reads what was applied. `phaseOf` and `ratingFormatFor` stay pure:
 * they are decisions, not lookups, and apply.ts uses them too. */

import { getTier, DEFAULT_SEED, type Phase, type Tier } from "@/lib/rating";
import { reliabilityFromHistory, type PlayedMatch } from "@/lib/rating/reliability";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches as matchesTable, people, ratingHistory, type Player, type Tournament } from "@/lib/db/schema";

/**
 * Which rating bucket this tournament's results belong in — "pb:md" and so on.
 *
 * `tournament.format` is NOT this. That field holds the match format
 * ("standard" / "osl"); the rating key wants a category (men's doubles, mixed,
 * singles), and the schema has no column for it. So it is inferred from who is
 * actually on the teams, which is real data rather than a guess:
 *
 *   one player per team    -> singles      two per team -> doubles
 *   all men -> m…   all women -> w…   mixed -> mx (or "gn" for singles)
 *
 * Anything larger than a pair — OSL runs six-player teams — is "gn", the
 * general bucket, because it is not any of the conventional categories.
 *
 * If a category field is added later, prefer it over this.
 */
export function ratingFormatFor(players: Player[]): string {
  const byTeam = new Map<string, Player[]>();
  for (const p of players) {
    if (!p.teamId) continue;
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }
  if (byTeam.size === 0) return "gn";

  const sizes = [...byTeam.values()].map((v) => v.length).sort((a, b) => a - b);
  const size = sizes[Math.floor(sizes.length / 2)]; // median: one odd team should not decide it
  if (size > 2) return "gn";

  const men = players.some((p) => p.gender === "M");
  const women = players.some((p) => p.gender === "F");
  if (size === 1) return men && women ? "gn" : women ? "ws" : "ms";
  return men && women ? "mx" : women ? "wd" : "md";
}

export type PlayerRating = {
  playerId: string;
  /** Null when nobody linked this entry to a person — see the roster note. */
  personId: string | null;
  name: string;
  teamId: string | null;
  start: number;
  delta: number;
  current: number;
  played: number;
  reliability: number | null;
  dupr: number | null;
  duprEnteredAt: Date | null;
  /** False when this rating cannot follow the player out of this event. */
  carried: boolean;
  tier: Tier;
};

/** Rounds carry names, not phases. Read the phase out of the label. */
export function phaseOf(round: string): Phase {
  const r = round.toLowerCase();
  if (/\bfinal\b/.test(r) && !/semi|quarter/.test(r)) return "final";
  if (/semi/.test(r)) return "semi";
  if (/quarter/.test(r)) return "quarter";
  return "group";
}

/**
 * Every player in this tournament, with what their rating actually did here.
 *
 * `delta` is the sum of the history rows written for THIS tournament's matches,
 * so it is exactly what moved and not a re-derivation of what should have. A
 * player who arrives carrying a rating shows that as `start`.
 */
export async function tournamentRatings(
  tournament: Tournament,
  players: Player[],
): Promise<PlayerRating[]> {
  const personIds = players.map((p) => p.personId).filter((x): x is string => !!x);

  const [roster, history, allHistory] = await Promise.all([
    personIds.length
      ? db.select().from(people).where(inArray(people.id, personIds))
      : Promise.resolve([]),
    /* Joined to `matches` so only THIS tournament's results count towards the
       movement shown here. The person's own record carries everything they have
       ever played; this page is about what happened at this event. */
    personIds.length
      ? db
          .select({
            personId: ratingHistory.personId,
            before: ratingHistory.ratingBefore,
            delta: ratingHistory.deltaApplied,
          })
          .from(ratingHistory)
          .innerJoin(matchesTable, eq(ratingHistory.matchId, matchesTable.id))
          .where(
            and(
              inArray(ratingHistory.personId, personIds),
              eq(matchesTable.tournamentId, tournament.id),
            ),
          )
      : Promise.resolve([]),
    /* Reliability spans a player's WHOLE career, not this event: the point of
       the index is how much evidence sits behind the number they carry. It is
       computed rather than read from `people.reliability`, because recency
       decays it — a stored value goes stale with nobody playing a match. */
    personIds.length
      ? db
          .select({
            personId: ratingHistory.personId,
            createdAt: ratingHistory.createdAt,
            before: ratingHistory.ratingBefore,
            notes: ratingHistory.notes,
          })
          .from(ratingHistory)
          .where(inArray(ratingHistory.personId, personIds))
      : Promise.resolve([]),
  ]);

  const now = new Date();
  const reliabilityBy = new Map<string, number>();
  for (const id of new Set(personIds)) {
    const played: PlayedMatch[] = allHistory
      .filter((h) => h.personId === id)
      .map((h) => {
        const notes = (h.notes ?? {}) as { won?: boolean; opponentIds?: string[] };
        return {
          matchId: "", playedAt: h.createdAt, opponentIds: notes.opponentIds ?? [],
          partnerIds: [], won: !!notes.won, myRating: h.before, partnerRatings: [],
        };
      });
    if (played.length > 0) reliabilityBy.set(id, reliabilityFromHistory(played, now).score);
  }

  const byPerson = new Map(roster.map((p) => [p.id, p]));
  const moved = new Map<string, { delta: number; played: number; first: number | null }>();
  for (const h of history) {
    const cur = moved.get(h.personId) ?? { delta: 0, played: 0, first: null };
    cur.delta += h.delta;
    cur.played += 1;
    cur.first = cur.first ?? h.before;
    moved.set(h.personId, cur);
  }

  return players
    .map((p) => {
      const person = p.personId ? byPerson.get(p.personId) : undefined;
      const m = p.personId ? moved.get(p.personId) : undefined;
      const current = person?.riseBest ?? DEFAULT_SEED;
      const delta = m?.delta ?? 0;
      return {
        playerId: p.id,
        personId: p.personId ?? null,
        name: p.name,
        teamId: p.teamId,
        start: current - delta,
        delta,
        current,
        played: m?.played ?? 0,
        reliability: p.personId ? reliabilityBy.get(p.personId) ?? null : null,
        dupr: person?.dupr == null ? null : person.dupr / 100,
        duprEnteredAt: person?.duprEnteredAt ?? null,
        carried: !!p.personId,
        tier: getTier(current),
      };
    })
    .sort((a, b) => b.current - a.current || b.delta - a.delta || a.name.localeCompare(b.name));
}
