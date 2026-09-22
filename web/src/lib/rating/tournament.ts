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
 * So this reads what was applied. `phaseOf` and `categoryFormat` stay pure:
 * they are decisions, not lookups, and apply.ts uses them too. */

import { getTier, DEFAULT_SEED, pairsFormat, startingRating, type Phase, type RatedGender, type Tier } from "@/lib/rating";
import { reliabilityForPerson } from "@/lib/rating/reliability";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  divisions, matches as matchesTable, people, players as playersTable, ratingHistory, teams,
  type GenderRule, type Person, type Player, type Tournament,
} from "@/lib/db/schema";

/**
 * Which rating a CATEGORY's results move — "md", "wd", "mx" and so on; the
 * caller prefixes the sport to make the key ("pb:md").
 *
 * ── Per category, never per event ────────────────────────────────────────
 * This used to be decided once for the whole tournament, from everybody on
 * it. An event running Men's Doubles and Women's Doubles has men and women on
 * its roster, so every match in it — both categories — moved everyone's MIXED
 * rating, and the seed refile then moved their starting levels into mixed as
 * well. Every caller now hands in ONE category's players and that category's
 * gender rule (`divisions.gender_rule`), so filing a seed, refiling it and
 * rating the match are one decision about one category.
 *
 * `tournament.format` is NOT this. That field holds the match format
 * ("standard" / "osl" / "pickleboss"). The type comes from, in order:
 *
 *   1. an OSL event is "gn": its six-player squads are none of the usual types;
 *   2. teams bigger than a pair are "gn", whatever the rule — a Mixed category
 *      with a reserve is still not a pairs event;
 *   3. the category's gender rule: Men's gives ms/md, Women's ws/wd, Mixed mx.
 *      The RULE wins over who happens to be in it, so a woman the organiser
 *      let into Men's Doubles is rated as men's doubles there;
 *   4. no rule: who actually entered. Singles: all men ms, all women ws,
 *      both "gn" (open singles). Pairs: what the pairs ARE (`pairsFormat` in
 *      lib/rating) — all men's pairs md, all women's wd, all mixed mx, and a
 *      MIXTURE is **"od", Open doubles** (Faisal, 2026-09-22: an open category
 *      of men's pairs and mixed pairs gets its own Open rating rather than
 *      moving anyone's mixed). Singles and doubles are never one key (§2).
 *
 *   one player per team -> singles      two per team -> doubles
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
 * The Mixed rule counts as at least pairs: one-player teams are refused while a
 * Mixed category exists (`setRegistration`), so a lone first entrant of Mixed
 * is still mixed.
 */
export function categoryFormat(
  players: Pick<Player, "teamId" | "gender">[],
  event: { minTeamSize: number; format?: string | null },
  genderRule: GenderRule | null | undefined,
): string {
  if (event.format === "osl") return "gn";
  const size = teamSizeOf(players, event.minTeamSize);
  if (size > 2) return "gn";
  if (genderRule === "MX") return "mx";
  if (genderRule === "M") return size === 1 ? "ms" : "md";
  if (genderRule === "F") return size === 1 ? "ws" : "wd";

  /* No rule and nobody in it: nothing to go on. */
  if (!players.some((p) => p.teamId)) return "gn";
  if (size === 1) {
    const men = players.some((p) => p.gender === "M");
    const women = players.some((p) => p.gender === "F");
    return men && women ? "gn" : women ? "ws" : "ms";
  }
  /* Pairs with no rule: read off what the PAIRS are (`pairsFormat`). */
  const byTeam = new Map<string, RatedGender[]>();
  for (const p of players) {
    if (!p.teamId) continue;
    byTeam.set(p.teamId, [...(byTeam.get(p.teamId) ?? []), p.gender]);
  }
  return pairsFormat([...byTeam.values()]);
}

/**
 * How big a team is in this category: the median team, each counted as at
 * least the event's minimum (see above). With nobody in it yet, the minimum.
 */
export function teamSizeOf(players: Pick<Player, "teamId">[], minTeamSize: number): number {
  const byTeam = new Map<string, number>();
  for (const p of players) {
    if (!p.teamId) continue;
    byTeam.set(p.teamId, (byTeam.get(p.teamId) ?? 0) + 1);
  }
  const floor = Math.max(1, minTeamSize);
  if (byTeam.size === 0) return floor;
  const sizes = [...byTeam.values()].map((n) => Math.max(n, floor)).sort((a, b) => a - b);
  return sizes[Math.floor(sizes.length / 2)]; // median: one odd team should not decide it
}

/** One category's players: everyone on a team in that category. One query. */
export async function categoryRoster(divisionId: string): Promise<Player[]> {
  const rows = await db
    .select({ player: playersTable })
    .from(playersTable)
    .innerJoin(teams, eq(playersTable.teamId, teams.id))
    .where(eq(teams.divisionId, divisionId));
  return rows.map((r) => r.player);
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
 * `categoryFormat` cannot always know the format while the roster fills: an
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
 *   - and no OTHER players row is filed under that key — another event's,
 *     or another CATEGORY of this one (a player in Men's Doubles and Mixed is
 *     two rows here, and each category now files its own key). That is the
 *     one fact that says somebody else is holding the seed, so it is asked of
 *     the database, inside the same UPDATE as the move. Where two holders
 *     both have it, it stays put: the cost is the old behaviour for that
 *     player, never someone else's seed moved from under them.
 *
 * The move is done in SQL on a row that still looks the way it was read, so a
 * match rated at the same moment cannot have its result replaced by the seed.
 *
 * One at a time, never a Promise.all: see db-fanout.test.ts.
 */
export async function refileSeeds(
  tournament: Pick<Tournament, "sport">,
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
              and other.id <> ${row.id}
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
  /** The category this row is about, and the rating type it moves. A player
      in two categories has two rows, each showing only what moved there. */
  divisionId: string | null;
  format: string;
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

  /* Which category each team is in, and each category's gender rule: the
     rating type is decided per category, never once for the whole event. One
     query, before the fan-out below and never inside it. */
  const teamRows = await db
    .select({ teamId: teams.id, divisionId: teams.divisionId, genderRule: divisions.genderRule })
    .from(teams)
    .innerJoin(divisions, eq(teams.divisionId, divisions.id))
    .where(eq(teams.tournamentId, tournament.id));
  const divisionOfTeam = new Map(teamRows.map((r) => [r.teamId, r.divisionId]));
  const ruleOf = new Map(teamRows.map((r) => [r.divisionId, r.genderRule]));
  const divisionOf = (p: Player) => (p.teamId ? divisionOfTeam.get(p.teamId) ?? null : null);
  const formatOf = new Map<string | null, string>();
  for (const d of new Set(players.map(divisionOf))) {
    formatOf.set(d, categoryFormat(players.filter((p) => divisionOf(p) === d), tournament, d ? ruleOf.get(d) : null));
  }

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
            divisionId: matchesTable.divisionId,
            format: ratingHistory.format,
            createdAt: ratingHistory.createdAt,
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
  /* Keyed by person AND category, and counting only history under the
     category's OWN rating key: somebody in Men's Doubles and Mixed sees each
     category's movement against the rating it moved. A row under some other
     key (an event rated before categories had their own, a category whose
     rule was changed) is not this category's movement, and adding it in would
     subtract one rating's change from another's number. */
  const movedKey = (personId: string, divisionId: string | null) => `${personId}	${divisionId ?? ""}`;
  const moved = new Map<string, { delta: number; played: number; first: number | null; at: number }>();
  for (const h of history) {
    if (h.format !== `${tournament.sport}:${formatOf.get(h.divisionId) ?? ""}`) continue;
    const k = movedKey(h.personId, h.divisionId);
    const cur = moved.get(k) ?? { delta: 0, played: 0, first: null, at: Infinity };
    cur.delta += h.delta;
    cur.played += 1;
    /* Start is what they had BEFORE their first match here, read off that
       match. Worked backwards from today's number it came out wrong whenever
       two categories share a key (Men's Doubles and Men's Doubles 40+): the
       other category's movement sits in the same number. */
    const at = h.createdAt.getTime();
    if (at < cur.at) { cur.at = at; cur.first = h.before; }
    moved.set(k, cur);
  }

  return players
    .map((p) => {
      const divisionId = divisionOf(p);
      const format = formatOf.get(divisionId) ?? "gn";
      const person = p.personId ? byPerson.get(p.personId) : undefined;
      const m = p.personId ? moved.get(movedKey(p.personId, divisionId)) : undefined;
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
        divisionId,
        format,
        start: m?.first ?? current,
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
