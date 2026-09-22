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

import { getTier, DEFAULT_SEED, startingRating, type Phase, type Tier } from "@/lib/rating";
import { reliabilityForPerson } from "@/lib/rating/reliability";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  matches as matchesTable, people, players as playersTable, ratingHistory,
  type Person, type Player, type Tournament,
} from "@/lib/db/schema";

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
 * ── `minTeamSize`: a team still being filled ─────────────────────────────
 * Players are added one at a time, so while a roster is filling the teams are
 * SMALLER than they will be. The first player of an empty doubles event is a
 * team of one, and read literally that is singles — which is where their seed
 * used to be filed while every match of the event moved the doubles rating.
 * The event's own minimum is what the organiser said a team is, so each team
 * counts as at least that big. The maximum says nothing: "up to two" permits a
 * second player, it does not promise one.
 *
 * Every tournament caller passes it, including the rating engine, so the
 * format a seed is filed under and the format the matches move are one
 * decision. A complete roster is never affected — every team is at or above
 * the minimum already.
 *
 * With the default of 1 it changes nothing, and a new event starts at 1: the
 * wizard never asks. That case is settled later, by `refileSeeds`, once the
 * roster itself says what the event is.
 *
 * If a category field is added later, prefer it over this.
 */
export function ratingFormatFor(players: Player[], minTeamSize: number): string {
  const byTeam = new Map<string, Player[]>();
  for (const p of players) {
    if (!p.teamId) continue;
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }
  if (byTeam.size === 0) return "gn";

  const floor = Math.max(1, minTeamSize);
  const sizes = [...byTeam.values()].map((v) => Math.max(v.length, floor)).sort((a, b) => a - b);
  const size = sizes[Math.floor(sizes.length / 2)]; // median: one odd team should not decide it
  if (size > 2) return "gn";

  const men = players.some((p) => p.gender === "M");
  const women = players.some((p) => p.gender === "F");
  if (size === 1) return men && women ? "gn" : women ? "ws" : "ms";
  return men && women ? "mx" : women ? "wd" : "md";
}

/**
 * The key a newcomer's starting rating should move FROM so that it sits under
 * `key`, or null when nothing should move.
 *
 * Only someone who has never played this sport qualifies. Their one rating in
 * it is a placement — from a DUPR, an organiser's band, or the default — filed
 * under whatever the roster looked like at the moment they were added, and the
 * format they are actually rated in is where it belongs. Anyone with a match
 * behind them keeps every number they have, and a rating already held under
 * `key` is never overwritten.
 */
export function seedToRefile(
  person: Pick<Person, "riseRatings" | "matchCount">,
  sport: string,
  key: string,
): string | null {
  const ratings = person.riseRatings ?? {};
  if (ratings[key] !== undefined) return null;
  const prefix = `${sport}:`;
  if (Object.entries(person.matchCount ?? {}).some(([k, n]) => k.startsWith(prefix) && n > 0)) return null;
  const held = Object.keys(ratings).filter((k) => k.startsWith(prefix));
  return held.length === 1 ? held[0] : null;
}

/**
 * Put the starting ratings THIS event placed under the key it is rated in.
 *
 * A seed filed under the wrong format is harmless for the first match —
 * `startingRating` falls back to the player's level in the sport, and a DUPR or
 * band seed counts — and that is exactly why it went unnoticed. The damage is
 * what it leaves behind. An unplayed deliberate seed counts in `sportRating`
 * for ever, so a player placed at 1000 who drops to 950 playing mixed is still
 * shown, listed and judged by category limits at 1000; the list filtered by
 * women's singles shows them at 1000 though they have never played it; and a
 * later singles event starts them from that stale 1000 rather than where they
 * now stand, because `startingRating` prefers the format's own key.
 *
 * `ratingFormatFor` cannot always know the format while the roster fills: an
 * event created by the wizard allows teams of one or two, so its first player
 * is a team of one until a partner arrives. So this runs whenever the answer
 * may have become clear, and moves what was filed on the earlier guess:
 *
 *   - after the organiser adds a player, so the seed is right as soon as the
 *     roster says what the event is;
 *   - just before a match is rated, which covers every other way a roster can
 *     change (approval, removal) at the one moment the key has consequences.
 *
 * A row is stale when its `players.ratings` — what this event recorded the
 * player bringing in — is not under `key`; a settled event has none, and costs
 * nothing. The person's seed moves only per `seedToRefile`, and only if THIS
 * event placed it. A seed placed by another event that has not been played yet
 * is that event's, and moving it would make whichever of the two is played
 * second start from the original seed instead of the level the first one
 * produced.
 *
 * "This event placed it" takes TWO tests, because each alone is fooled:
 *   - this row was filed under the very key the seed sits in — but a player
 *     picked as the FIRST entrant of a second event is filed there on that
 *     event's own first guess, which can be the same guess ("ws" twice);
 *   - and no OTHER event's row is filed under that key. That is the one fact
 *     that says another event is holding the seed, so it is asked of the
 *     database, inside the same UPDATE as the move. Where two unplayed events
 *     both hold it, it stays put: the cost is the old behaviour for that
 *     player, never someone else's seed moved from under them.
 *
 * The move is done in SQL on a row that still looks the way it was read, so a
 * match rated at the same moment cannot have its result replaced by the seed.
 *
 * One at a time, never a Promise.all: see db-fanout.test.ts.
 */
export async function refileSeeds(
  tournament: Pick<Tournament, "id" | "sport">,
  roster: Player[],
  key: string,
): Promise<number> {
  const stale = roster.filter((p) => p.personId && (p.ratings ?? {})[key] === undefined);
  if (stale.length === 0) return 0;

  const ids = [...new Set(stale.map((p) => p.personId!))];
  const loaded = await db.select().from(people).where(inArray(people.id, ids));
  const byId = new Map(loaded.map((p) => [p.id, p]));
  const format = key.slice(key.indexOf(":") + 1);

  for (const row of stale) {
    let person = byId.get(row.personId!);
    if (!person) continue;

    const from = seedToRefile(person, tournament.sport, key);
    const filed = Object.keys(row.ratings ?? {});
    if (from && filed.length === 1 && filed[0] === from) {
      const [moved] = await db
        .update(people)
        .set({
          riseRatings: sql`(${people.riseRatings} - ${from}::text) || jsonb_build_object(${key}::text, ${people.riseRatings} -> ${from}::text)`,
        })
        .where(and(
          eq(people.id, person.id),
          sql`${people.riseRatings} -> ${key}::text is null`,
          sql`${people.riseRatings} -> ${from}::text is not null`,
          sql`coalesce((${people.matchCount} ->> ${from}::text)::int, 0) = 0`,
          /* "people"."id" is written out in full. A bare "id" inside this
             subquery would bind to the PLAYERS row's own id and the check would
             pass for everyone. Drizzle does qualify `${people.id}` in an UPDATE
             today (checked 2026-09-22 by swapping it in: the tests still pass),
             but it strips table names in a single-table SELECT, so nothing here
             leans on which one it does. */
          sql`not exists (
            select 1 from ${playersTable} as other
            where other.person_id = "people"."id"
              and other.tournament_id <> ${tournament.id}
              and other.ratings -> ${from}::text is not null
          )`,
        ))
        .returning();
      /* Nothing matched: somebody else changed this person since the read, so
         read what is actually there rather than assume the move happened. */
      person = moved ?? (await db.select().from(people).where(eq(people.id, person.id)).limit(1))[0] ?? person;
      byId.set(person.id, person);
    }

    await db
      .update(playersTable)
      .set({ ratings: { [key]: startingRating(person, tournament.sport, format) } })
      .where(eq(playersTable.id, row.id));
  }
  return stale.length;
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
            ratingBefore: ratingHistory.ratingBefore,
            notes: ratingHistory.notes,
          })
          .from(ratingHistory)
          .where(inArray(ratingHistory.personId, personIds))
      : Promise.resolve([]),
  ]);

  /* One shared reader — see lib/rating/reliability.ts. Three hand-rolled copies
     of this mapping is what kept the independence signal dead. */
  const now = new Date();
  const reliabilityBy = new Map<string, number>();
  for (const id of new Set(personIds)) {
    const r = reliabilityForPerson(allHistory, id, now);
    if (r.parts.volume > 0) reliabilityBy.set(id, r.score);
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

  const format = ratingFormatFor(players, tournament.minTeamSize);
  return players
    .map((p) => {
      const person = p.personId ? byPerson.get(p.personId) : undefined;
      const m = p.personId ? moved.get(p.personId) : undefined;
      /* The rating in THIS event's sport and format — the number the event
         actually carries in and moves. It was `riseBest`, the best across every
         sport and format, under a header naming this sport and format. */
      const current = person ? startingRating(person, tournament.sport, format) : DEFAULT_SEED;
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
