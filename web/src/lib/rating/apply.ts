import "server-only";

/* Applying a finished match to people's ratings — the step that makes a RISE
 * Rating a reference rather than a per-event curiosity.
 *
 * ── Why this is stored, when the per-tournament view was derived ──────────
 * Within one tournament, deriving from the matches was better: undo came free
 * and nothing could disagree. Across events that breaks down. Deriving a
 * person's rating would mean replaying every match they have ever played, in a
 * global order that is not well defined across concurrent tournaments — and
 * spec §9 wants a history row per match regardless, because "when a player
 * disputes a rating, and they will, the organiser needs to show the working."
 *
 * So: `rating_history` is the source of truth. A person's rating is their seed
 * plus the sum of their recorded deltas, and every delta records the inputs
 * that produced it.
 *
 * ── Idempotency ──────────────────────────────────────────────────────────
 * A unique index on (match, person, format) makes double-application
 * impossible at the database level, and this module checks up front so a
 * re-save is a no-op rather than a partial write. Undo deletes the rows.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, gte, inArray, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  communityMatches, divisions, matches, people, ratingHistory, ratingLedger, tournaments,
  type CommunityMatch, type Match, type Person, type Tournament,
} from "@/lib/db/schema";
import {
  calcRtgChange, calcExp, marginMultiplier, phaseMultiplier, verificationWeight,
  provisionalMultiplier, DEFAULT_SEED, startingRating, type Margin, type Phase, type Verification,
} from "@/lib/rating";
import { phaseOf, categoryFormat, categoryRoster, refileSeeds } from "@/lib/rating/tournament";
import { ratingKey } from "@/lib/sports/registry";
import { endingOf } from "@/lib/matchState";
import { matchResult } from "@/lib/results";
import { finalScoreProblem, type Ending } from "@/lib/scoring/final";
import { playedFromHistory, reliabilityForPerson } from "@/lib/rating/reliability";
import { detectSandbagging, type RatedMatch } from "@/lib/rating/sandbagging";

const DAY = 86_400_000;

/* Spec §8. */
const REPEAT_WINDOW_DAYS = 30;
const REPEAT_THRESHOLD = 3; // third and subsequent meeting
const REPEAT_DAMPING = 0.6;
const DAILY_CAP = 60;

/* Spec §6.1. */
const CARRY_GAP = 300;
const CARRY_FAVOURED = 0.65;
const CARRY_SCALE = 0.7;

export type ApplyResult =
  | { status: "applied"; people: number; imbalance: number }
  | { status: "already" }
  | { status: "skipped"; reason: string };

/**
 * Spec §8: reject a score that does not satisfy the format's own rules.
 *
 * "An invalid score must not silently produce a rating change." A typo'd 11–13
 * that no pickleball game could produce would otherwise move real ratings.
 *
 * The judgement is `finalScoreProblem`'s (lib/scoring/final), the same one a
 * typed result is held to, so the table and the ratings can never disagree
 * about whether a score could happen. It used to be its own check, which
 * accepted finals no game produces — 15–4 in a game to 11, 23–20 in badminton —
 * and, with no rules, any result where the winner scored more (3–0 in a
 * best-of-3 tennis match). A rating also needs a WINNER, which a level carrom
 * result over a fixed number of boards is not.
 */
export function validScore(ending: Ending, w: number, l: number): boolean {
  return w > l && finalScoreProblem(ending, w, l) === null;
}

/** A result recorded as games or sets won says who won and by how many games
    or sets — not by how many POINTS, which is what the margin multiplier
    reads. 2–1 in games is as close as 21–19 21–19 or as wide as 21–2 21–3;
    reading it as a points margin would score both the same, so those results
    carry a neutral margin instead. */
export const marginFor = (ending: Ending): Margin =>
  ending.kind === "games" || ending.kind === "sets" ? "neutral" : "score";

/* ── The trust machinery, as pure decisions ──────────────────────────────
 *
 * Extracted from the database work below so each rule can be tested on its own.
 * These are the parts that decide whether a RISE Rating can be trusted enough
 * to seed a draw from, so they are worth pinning individually rather than only
 * through whatever a fixture happens to exercise. */

/** Spec §8: the third and later meeting inside 30 days counts for less. */
export const repeatDamping = (priorMeetings: number): number =>
  priorMeetings >= REPEAT_THRESHOLD - 1 ? REPEAT_DAMPING : 1;

/**
 * Spec §6.1 — the doubles carry guard.
 *
 * A weak player partnered with a strong one gains rating they did not earn,
 * then enters tournaments at a level they cannot play. That is exactly the
 * sandbagging a seeding reference has to resist, so the lower-rated partner of
 * a lopsided favoured winning pair gains less.
 *
 * Only the weaker partner is scaled; the stronger one is untouched. Losses are
 * NEVER scaled — you keep full downside.
 */
export function carryScale(
  partnerRatings: number[],
  index: number,
  expectedWinner: number,
  won: boolean,
): number {
  if (!won) return 1;
  if (partnerRatings.length !== 2) return 1;
  if (Math.abs(partnerRatings[0] - partnerRatings[1]) <= CARRY_GAP) return 1;
  if (expectedWinner <= CARRY_FAVOURED) return 1;
  const weaker = partnerRatings[0] <= partnerRatings[1] ? 0 : 1;
  return index === weaker ? CARRY_SCALE : 1;
}

/**
 * Spec §8 — at most ±60 net per person per day.
 *
 * Bounds the DAY, not the match: six games could otherwise move someone 360
 * points while each one looked compliant on its own.
 */
export function capDelta(alreadyToday: number, delta: number): number {
  const total = alreadyToday + delta;
  if (Math.abs(total) <= DAILY_CAP) return delta;

  const allowed = (total > 0 ? DAILY_CAP : -DAILY_CAP) - alreadyToday;
  /* Never flip the sign. Someone already past the cap — which a re-applied or
     retro-edited match can produce — would otherwise have a WIN pull their
     rating down to meet the cap. The cap stops further movement; it does not
     claw back what is already applied. */
  return delta > 0 ? Math.max(0, allowed) : Math.min(0, allowed);
}

type Side = { personIds: string[]; ratings: number[]; mean: number };

const mean = (ns: number[]) => (ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : DEFAULT_SEED);

/** What a person's rating is right now for this format ("pb:md"). A format they
    have never played starts from their level in the SAME sport; a sport they
    have never played starts fresh. It used to fall back to `riseBest`, which
    started a strong pickleball player's first badminton match at their
    pickleball number (Faisal, 2026-09-21: a new sport starts fresh). */
const ratingOf = (p: Person, key: string) => {
  const [sport, format] = key.split(":");
  return startingRating(p, sport, format);
};

/**
 * Apply one finished match.
 *
 * Everything is computed before anything is written, so a match either lands
 * whole or not at all.
 */
export async function applyMatchRatings(
  matchId: string,
  opts: { verification?: Verification; now?: Date } = {},
): Promise<ApplyResult> {
  const now = opts.now ?? new Date();
  const verification: Verification = opts.verification ?? "organiser";

  const [row] = await db
    .select({ match: matches, tournament: tournaments, genderRule: divisions.genderRule })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .innerJoin(divisions, eq(matches.divisionId, divisions.id))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) return { status: "skipped", reason: "no such match" };

  const { match: m, tournament: t, genderRule } = row;

  /* Already applied. Checked before any work so a re-save cannot double-move a
     rating even if the unique index were somehow dropped. */
  const existing = await db
    .select({ id: ratingHistory.id })
    .from(ratingHistory)
    .where(eq(ratingHistory.matchId, matchId))
    .limit(1);
  if (existing.length > 0) return { status: "already" };

  /* A walkover, a retirement or a game stopped early counts in the table and
     moves nobody: there is no played result for a rating to read. */
  if (m.outcome) return { status: "skipped", reason: `recorded without a rating (${m.outcome})` };

  const settled = settleMatch(t, m);
  if (!settled) return { status: "skipped", reason: "not finished" };

  /* Judged by the rules THIS match is played under — the ones it finished
     under, once it has (lib/matchState `matchRules`) — and, for tennis and
     padel, by the games in each set when they were typed. */
  const ending = endingOf(t, m);
  const aWon = settled.winnerTeamId === m.teamAId;
  const [a, b] = aWon ? [settled.scoreW, settled.scoreL] : [settled.scoreL, settled.scoreW];
  if (!validScore(ending, settled.scoreW, settled.scoreL) || finalScoreProblem(ending, a, b, m.sets ?? undefined)) {
    return { status: "skipped", reason: `invalid score ${settled.scoreW}-${settled.scoreL}` };
  }

  /* THIS CATEGORY's players, and its rule: a Men's Doubles match moves
     men's-doubles ratings even when the event also runs Women's Doubles. It
     was the whole event's roster, so any event with men and women in it moved
     everybody's mixed. See `categoryFormat`. */
  const roster = await categoryRoster(m.divisionId);
  const key = ratingKey(t.sport, categoryFormat(roster, t, genderRule));
  /* The roster is complete by now, so this is the format for certain. A seed
     filed under an earlier guess — the first player of an event that did not
     yet know it was doubles, or a roster reshaped since by an approval or a
     removal — moves here before anyone's rating is read. See `refileSeeds`;
     a settled event has nothing stale and this costs nothing. */
  await refileSeeds(t, roster, key);

  const personIdsOf = (teamId: string) =>
    [...new Set(roster.filter((p) => p.teamId === teamId && p.personId).map((p) => p.personId!))];

  const winnerIds = personIdsOf(settled.winnerTeamId);
  const loserIds = personIdsOf(settled.loserTeamId);
  /* One person on both sides cannot beat themselves. It used to reach the
     unique index on (match, person, format), throw, and be swallowed by the
     score save's catch — no rating moved and nothing said why. */
  if (winnerIds.some((id) => loserIds.includes(id))) {
    return { status: "skipped", reason: "the same person is on both sides" };
  }
  /* Nobody linked to a person: the event still works, the rating just cannot
     follow anyone out of it. Not an error. */
  if (winnerIds.length === 0 || loserIds.length === 0) {
    return { status: "skipped", reason: "no linked people on one side" };
  }

  return applyResult({
    ref: { kind: "tournament", matchId },
    key, winnerIds, loserIds,
    scoreW: settled.scoreW, scoreL: settled.scoreL,
    phase: settled.phase, verification, now,
    margin: marginFor(ending),
    /* Everything above was read without a lock, so the match may have moved on
       by the time the rating is written. Asked again of the row as LOCKED: the
       RESULT must be the one this rating was computed from. Not the `rev` —
       that also moves when the serve is set on a typed-score match or a side
       switch is confirmed, neither of which re-applies anything, so checking
       it would leave a finished match with no rating movement at all. */
    unchanged: (locked) =>
      locked.kind === "tournament" && !locked.row.outcome && sameSettlement(settleMatch(t, locked.row), settled),
  });
}

/** Which match a rating movement is attributable to. Exactly one, always. */
export type MatchRef =
  | { kind: "tournament"; matchId: string }
  | { kind: "community"; communityMatchId: string };

/** The match row, read under its lock. */
export type LockedMatch =
  | { kind: "tournament"; row: Match }
  | { kind: "community"; row: CommunityMatch };

export type ApplyInput = {
  ref: MatchRef;
  /** Sport-namespaced, e.g. "pb:md". The caller decides the format. */
  key: string;
  winnerIds: string[];
  loserIds: string[];
  scoreW: number;
  scoreL: number;
  phase: Phase;
  verification: Verification;
  now: Date;
  /** "neutral" when the scores are games or sets won rather than points — see
      `marginFor`. Defaults to reading the margin off the scores. */
  margin?: Margin;
  /** Does the match, as it stands under its lock, still say what the caller
      computed this result from? False means another write changed it first,
      and that write is the one that settles the rating. Omitted: not asked. */
  unchanged?: (locked: LockedMatch) => boolean;
};

/* ── Locks: ONE order, everywhere ─────────────────────────────────────────
 *
 * Every writer of a rating takes its locks in the same order: the MATCH row
 * first, then the PEOPLE, all of them in one statement sorted by id. Two
 * writers that lock in the same order can queue behind each other but never
 * wait on each other in a circle, which is the only way a deadlock forms — and
 * a deadlock here is not an error anybody sees: the score save swallows a
 * failed rating (`syncRatings`), and ratings move only when a match crosses the
 * finish line, so nothing would ever retry it. The result would stand with no
 * rating movement behind it.
 *
 * Apply, revert and the community path all go through these two helpers, and
 * so does any OTHER transaction that writes more than one person: approving an
 * entry fills in dates of birth, and did it in entry order, so it could hold one
 * player while a rating held the other and each wait on the other. A writer
 * that touches ONE row per statement outside a transaction (`refileSeeds`, a
 * score write) holds nothing while it waits and cannot close a circle; one that
 * deletes match rows (regenerating a community evening) locks those match rows
 * first and never a person.
 *
 * ── FOR NO KEY UPDATE, not FOR UPDATE ────────────────────────────────────
 * FOR UPDATE is the one row lock that conflicts with the FOR KEY SHARE lock a
 * foreign-key check takes on the row an INSERT points at. So with FOR UPDATE a
 * player saving a skill rating, joining a game or being entered in an event
 * waited behind a rating apply — and could close a circle with it: the skill
 * row checks its subject before its rater, in whatever order they are, while
 * the apply locks by id. NO KEY UPDATE is what a plain UPDATE of these rows
 * takes anyway, which is all the old code ever did, so it conflicts with every
 * other rating writer and with nothing that merely refers to the row.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

/** Lock the match a rating belongs to. Null when the row has gone. */
export async function lockMatch(tx: Tx, ref: MatchRef): Promise<LockedMatch | null> {
  if (ref.kind === "tournament") {
    const [row] = await tx.select().from(matches).where(eq(matches.id, ref.matchId)).for("no key update");
    return row ? { kind: "tournament", row } : null;
  }
  const [row] = await tx
    .select()
    .from(communityMatches)
    .where(eq(communityMatches.id, ref.communityMatchId))
    .for("no key update");
  return row ? { kind: "community", row } : null;
}

/**
 * Lock these people, in ONE statement, in id order.
 *
 * `ORDER BY … FOR NO KEY UPDATE` takes the row locks in the order the rows come
 * out of the sort, which is what makes the order fixed; locking them one query
 * at a time would take them in whatever order the caller happened to list them
 * — winners first in apply, whatever RETURNING produced in revert. It must be
 * the FIRST read of these people in the transaction: a read before it sees the
 * value from before whoever holds the lock, and writing that back is the lost
 * update this exists to prevent.
 */
export async function lockPeople(tx: Tx, ids: string[]): Promise<Person[]> {
  const unique = [...new Set(ids)];
  if (unique.length === 0) return [];
  return tx
    .select()
    .from(people)
    .where(inArray(people.id, unique))
    .orderBy(asc(people.id))
    .for("no key update");
}

const historyOf = (ref: MatchRef) =>
  ref.kind === "tournament"
    ? eq(ratingHistory.matchId, ref.matchId)
    : eq(ratingHistory.communityMatchId, ref.communityMatchId);

const ledgerOf = (ref: MatchRef) =>
  ref.kind === "tournament"
    ? eq(ratingLedger.matchId, ref.matchId)
    : eq(ratingLedger.communityMatchId, ref.communityMatchId);

type HistoryRow = {
  id: string;
  personId: string;
  format: string;
  createdAt: Date;
  ratingBefore: number;
  notes: Record<string, unknown>;
};

/** Everything on record for these people, in one query. Read under their locks,
    so it is exactly what the write is about to be judged against. */
const historyFor = (tx: Tx, ids: string[]): Promise<HistoryRow[]> =>
  tx
    .select({
      id: ratingHistory.id,
      personId: ratingHistory.personId,
      format: ratingHistory.format,
      createdAt: ratingHistory.createdAt,
      ratingBefore: ratingHistory.ratingBefore,
      notes: ratingHistory.notes,
    })
    .from(ratingHistory)
    .where(inArray(ratingHistory.personId, ids));

/**
 * Whether each person's rating in this format rests on a SEED.
 *
 * A revert that takes a player's last match in a format back must leave the
 * format as it found it: a seed stays, a rating the matches created goes. The
 * subtraction alone left the key behind at the old value with a match count of
 * nought — and for a player seeded by DUPR or an organiser every key counts
 * (`sportRating`), so a first mixed game typed and then cleared left a mixed
 * rating that no match stood behind, counting toward their level for ever.
 *
 * So every history row records `seeded` for its whole chain: whether the
 * format's number existed before the chain's first match. A chain that already
 * has rows passes its answer on, which is what keeps it right however the
 * matches are later taken back — oldest first, newest first, or an old one
 * corrected and re-applied under newer ones. No chain yet: the number is a seed
 * if it is there. A row older than this flag counts as seeded, the answer that
 * never deletes anything.
 */
async function seededChains(tx: Tx, roster: Person[], key: string): Promise<Map<string, boolean>> {
  const ids = roster.map((p) => p.id);
  const chains = await tx
    .select({
      personId: ratingHistory.personId,
      seededRows: sql<number>`(count(*) filter (where coalesce(${ratingHistory.notes} ->> 'seeded', 'true') <> 'false'))::int`,
    })
    .from(ratingHistory)
    .where(and(inArray(ratingHistory.personId, ids), eq(ratingHistory.format, key)))
    .groupBy(ratingHistory.personId);
  const byPerson = new Map(chains.map((c) => [c.personId, Number(c.seededRows) > 0]));
  return new Map(
    roster.map((p) => [p.id, byPerson.get(p.id) ?? (p.riseRatings ?? {})[key] != null]),
  );
}

/**
 * The advisory signals derived from a person's whole history: the §8.1
 * under-rated flag and the reliability snapshot.
 *
 * Computed INSIDE the rating's own write, from the history read under the same
 * locks. They were refreshed afterwards, from an unlocked read, so an apply and
 * a revert for one player crossing each other could leave the snapshot from
 * whichever read was older — a player with matches on record shown with none.
 *
 * Both are ADVISORY. Neither touches the rating — §8.1 is explicit that a flag
 * is for a human to judge, and reliability is a statement about confidence, not
 * about level — and that is why a slip in this arithmetic must not cost the
 * rating: it answers null, and the write goes ahead without them.
 *
 * A player with nothing left on record goes back to how they were before they
 * played: no flag, and no snapshot (null, as a new person is created).
 */
function derivedFor(
  person: Person,
  history: HistoryRow[],
  riseBest: number | null,
  now: Date,
): { flags: Record<string, unknown>; reliability: number | null } | null {
  try {
    const flags = { ...((person.flags ?? {}) as Record<string, unknown>) };
    const clear = () => {
      delete flags.underRated;
      delete flags.underRatedBy;
      delete flags.flaggedAt;
    };

    const played = playedFromHistory(history, person.id);
    if (played.length === 0) {
      clear();
      return { flags, reliability: null };
    }

    const rated: RatedMatch[] = played
      .filter((m) => (m.opponentRatings?.length ?? 0) > 0)
      .map((m) => ({
        avgOpponentRating: m.opponentRatings!.reduce((s, n) => s + n, 0) / m.opponentRatings!.length,
        won: m.won,
        playedAt: m.playedAt,
      }));

    const flag = detectSandbagging(rated, riseBest ?? DEFAULT_SEED);
    if (flag.underRated) {
      flags.underRated = true;
      flags.underRatedBy = flag.gap;
      flags.flaggedAt = now.toISOString();
    } else {
      clear();
    }

    /* A SNAPSHOT, for sorting and filtering in SQL. Every display path
       recomputes instead of reading this, because recency decays
       reliability — a stored value goes stale with nobody playing a match,
       and two numbers that can disagree is the trap to avoid. */
    return { flags, reliability: reliabilityForPerson(history, person.id, now).score };
  } catch (e) {
    console.error("derived rating signals failed for", person.id, e);
    return null;
  }
}

/** The highest of a person's ratings, or none when they hold none. */
const bestOf = (ratings: Record<string, number>): number | null => {
  const values = Object.values(ratings);
  return values.length ? Math.max(...values) : null;
};

/**
 * Apply one finished result to everyone's rating.
 *
 * ── Why this is separate from applyMatchRatings ───────────────────────────
 * Community play moves more ratings than tournaments do — the legacy app
 * applies a change on every community score (app.source.js:9254) — so both have
 * to end up here. Everything above this line is about finding out WHO won and
 * by how much, which is completely different for a tournament match (teams,
 * a draw, a rally log) and a community game (four names on a court). Everything
 * below is the rating engine, which is identical and must stay identical: the
 * carry guard, the daily cap, repeat damping and the imbalance ledger are the
 * product, and a second copy of them would drift within a release.
 *
 * ── Read under the lock, not before it ──────────────────────────────────
 * The people were read BEFORE the transaction and written back as absolute
 * values, so anything that moved one of them in between was overwritten: two
 * results for the same player landing together kept only the second, with its
 * match count one short, and a revert committed in the gap was undone. Now the
 * match and then the people are locked first, and every input — ratings, match
 * counts, today's movement for the cap, recent meetings for the damping, the
 * history the derived signals come from — is read after that, inside the one
 * transaction that writes. Whatever the rating is computed from is what it is
 * when it is written.
 *
 * Everything is still computed before anything is written, so a result either
 * lands whole or not at all.
 */
export async function applyResult(input: ApplyInput): Promise<ApplyResult> {
  const { ref, key, winnerIds, loserIds, scoreW, scoreL, phase, verification, now, unchanged } = input;
  const margin = input.margin ?? "score";

  if (winnerIds.length === 0 || loserIds.length === 0) {
    return { status: "skipped", reason: "no linked people on one side" };
  }

  return db.transaction(async (tx): Promise<ApplyResult> => {
    const locked = await lockMatch(tx, ref);
    if (!locked) return { status: "skipped", reason: "no such match" };
    if (unchanged && !unchanged(locked)) return { status: "skipped", reason: "changed" };

    /* Asked again under the lock: a second apply of the same match waits on
       the row above, then finds the first one's history here and stops. The
       unique index would refuse it anyway, but as an error inside a swallowed
       catch rather than as the answer. */
    const [prior] = await tx.select({ id: ratingHistory.id }).from(ratingHistory).where(historyOf(ref)).limit(1);
    if (prior) return { status: "already" };

    const roster = await lockPeople(tx, [...winnerIds, ...loserIds]);
    const byId = new Map(roster.map((p) => [p.id, p]));
    /* A person deleted since the line-up was read. The history row would fail
       its foreign key inside the transaction; say so instead. */
    if ([...winnerIds, ...loserIds].some((id) => !byId.has(id))) {
      return { status: "skipped", reason: "a player's record is missing" };
    }

    const side = (ids: string[]): Side => {
      const ratings = ids.map((id) => ratingOf(byId.get(id)!, key));
      return { personIds: ids, ratings, mean: mean(ratings) };
    };
    const W = side(winnerIds);
    const L = side(loserIds);

    const gamesOf = (ids: string[]) =>
      Math.max(0, ...ids.map((id) => byId.get(id)?.matchCount?.[key] ?? 0));

    const change = calcRtgChange(W.mean, L.mean, scoreW, scoreL, {
      margin,
      phase,
      verification,
      winnerGames: gamesOf(winnerIds),
      loserGames: gamesOf(loserIds),
    });

    const seeded = await seededChains(tx, roster, key);

    /* §8 repeat opponents: farming the same two friends must not compound. */
    const repeats = await recentMeetings(tx, [...winnerIds, ...loserIds], winnerIds, loserIds, now);
    const damping = repeatDamping(repeats);
    const damped = damping !== 1;

    const expected = calcExp(W.mean, L.mean);
    const baseWin = change.wG * damping;
    const baseLoss = change.lL * damping;

    /* §6.1 carry guard. The weak partner of a strong one gains less, and the
       difference goes to the LEDGER — never to the opponents, who did nothing to
       earn it. Losses are never scaled: you keep full downside. */
    let carriedAny = false;

    const rows: {
      personId: string; before: number; delta: number; note: Record<string, unknown>;
    }[] = [];

    for (let i = 0; i < W.personIds.length; i++) {
      const scale = carryScale(W.ratings, i, expected, true);
      const carried = scale !== 1;
      if (carried) carriedAny = true;
      const raw = baseWin * scale;
      rows.push({
        personId: W.personIds[i],
        before: W.ratings[i],
        delta: Math.round(raw),
        /* The RATINGS, not just the ids. §6.2, §7 independence and §8.1 are all
           defined against the values AT THE TIME, which cannot be recovered once
           everyone's rating has moved on. Recording only ids is what left the
           independence signal permanently inert. */
        note: {
          won: true, damped, carried,
          opponentIds: L.personIds, opponentRatings: L.ratings,
          partnerIds: W.personIds.filter((_, j) => j !== i),
          partnerRatings: W.ratings.filter((_, j) => j !== i),
          seeded: seeded.get(W.personIds[i]),
        },
      });
    }
    for (let i = 0; i < L.personIds.length; i++) {
      rows.push({
        personId: L.personIds[i],
        before: L.ratings[i],
        delta: -Math.round(baseLoss),
        note: {
          won: false, damped, carried: false,
          opponentIds: W.personIds, opponentRatings: W.ratings,
          partnerIds: L.personIds.filter((_, j) => j !== i),
          partnerRatings: L.ratings.filter((_, j) => j !== i),
          seeded: seeded.get(L.personIds[i]),
        },
      });
    }

    /* §8 daily cap, ±60 net per person per day. Applied last, so it bounds the
       total movement rather than one match's share of it. */
    const capped = await applyDailyCap(tx, rows, now);

    const imbalance = capped.reduce((s, r) => s + r.delta, 0);

    for (const r of capped) {
      await tx.insert(ratingHistory).values({
        id: randomUUID(),
        personId: r.personId,
        format: key,
        /* Exactly one of these is set — the CHECK in migration 0006 enforces
           it, so a row can never claim both or neither. */
        matchId: ref.kind === "tournament" ? ref.matchId : null,
        communityMatchId: ref.kind === "community" ? ref.communityMatchId : null,
        ratingBefore: r.before,
        ratingAfter: r.before + r.delta,
        deltaApplied: r.delta,
        expected: Math.round(expected * 1000),
        marginMultiplier: margin === "neutral" ? 1000 : Math.round(marginMultiplier(scoreW, scoreL) * 1000),
        stageMultiplier: Math.round(phaseMultiplier(phase) * 1000),
        verificationWeight: Math.round(verificationWeight(verification) * 1000),
        provisionalMultiplier: Math.round(
          provisionalMultiplier(r.delta > 0 ? gamesOf(winnerIds) : gamesOf(loserIds)) * 1000,
        ),
        notes: r.note,
        /* The moment of the WRITE, not of the transaction's start — `now()`,
           the column's default, is when the transaction began. Two applies for
           one player that begin in one order and take the lock in the other
           would be stamped in the wrong order, and the partner record, which a
           revert replays in this order, would come back a point out. The clock
           read here, after the locks, is the order the merges really ran in. */
        createdAt: sql`clock_timestamp()`,
      });
    }

    /* Conservation is broken on purpose in two places — the provisional
       multiplier (§5) and the carry guard (§6.1) — so the difference is
       written down rather than silently minted or destroyed. */
    if (imbalance !== 0) {
      await tx.insert(ratingLedger).values({
        id: randomUUID(),
        matchId: ref.kind === "tournament" ? ref.matchId : null,
        communityMatchId: ref.kind === "community" ? ref.communityMatchId : null,
        imbalance,
        reason: carriedAny ? "carry guard + provisional" : "provisional",
      });
    }

    /* Their whole record, this match included, for the derived signals. */
    const history = await historyFor(tx, roster.map((p) => p.id));

    for (const r of capped) {
      const person = byId.get(r.personId)!;
      const ratings = { ...(person.riseRatings ?? {}), [key]: r.before + r.delta };
      const counts = { ...(person.matchCount ?? {}), [key]: (person.matchCount?.[key] ?? 0) + 1 };
      const riseBest = bestOf(ratings);

      const note = r.note as {
        won: boolean; partnerIds: string[]; partnerRatings: number[]; opponentRatings: number[];
      };

      await tx
        .update(people)
        .set({
          riseRatings: ratings,
          riseBest,
          matchCount: counts,
          lastPlayedAt: now,
          /* §6.2 — who this player wins with. The evidence behind the
             independence component, and what lets a profile say WHO carried
             someone rather than only that they were carried. */
          partnerStats: mergePartnerStats(person.partnerStats, note),
          ...(derivedFor(person, history, riseBest, now) ?? {}),
        })
        .where(eq(people.id, r.personId));
    }

    return { status: "applied", people: capped.length, imbalance };
  });
}

/**
 * Undo a result's effect, inside the caller's transaction.
 *
 * The rating is defined as seed + sum of recorded deltas, so removing the rows
 * and subtracting them keeps every rating explainable by its own history.
 *
 * ── Only the transaction that DELETES a row subtracts it ─────────────────
 * The rows used to be read before the transaction and subtracted inside it, so
 * two reverts of one match — a double tap, or a phone's retry arriving beside
 * the original — both read the same rows and both subtracted them: the players
 * lost the match's movement twice. `DELETE … RETURNING` hands each row to
 * exactly one transaction, and the match row is locked before it, so the
 * second revert waits, deletes nothing and changes nothing.
 *
 * Everything the apply moved is put back, not just the number:
 *  - the match count, and — where this was the last match in a format whose
 *    number the matches created — the format itself (see `seededChains`);
 *  - the partner record (§6.2), replayed from what is left (see
 *    `partnerStatsFromHistory`);
 *  - when they last played: the latest match still on record, or never;
 *  - the under-rated flag and the reliability snapshot (`derivedFor`).
 *
 * It takes a transaction so that clearing a result and taking its rating back
 * can be ONE write: a crash between the two otherwise leaves a result with no
 * rating, or a rating with no result.
 *
 * The honest limitation: later matches were computed against the rating this
 * one produced, and they are NOT recomputed — that would cascade through every
 * opponent and their opponents. The numbers stay self-consistent and the drift
 * is bounded by one match's delta; anything stricter would mean freezing
 * finished matches entirely. For the same reason a player can end a day up to
 * one reverted delta outside the ±60 cap.
 */
export async function revertResultIn(
  tx: Tx,
  ref: MatchRef,
  now: Date = new Date(),
): Promise<{ reverted: number; personIds: string[] }> {
  /* The match first — THE lock order. A match already deleted locks nothing,
     which is fine: there is nothing left for anybody else to write to it. */
  await lockMatch(tx, ref);

  const gone = await tx.delete(ratingHistory).where(historyOf(ref)).returning();
  await tx.delete(ratingLedger).where(ledgerOf(ref));
  if (gone.length === 0) return { reverted: 0, personIds: [] };

  const folk = await lockPeople(tx, gone.map((r) => r.personId));
  const ids = folk.map((p) => p.id);

  /* What each of them still has on record, now that this match is off it — one
     query for all of them. It answers what a subtraction cannot. */
  const remaining = await historyFor(tx, ids);

  for (const person of folk) {
    const ratings = { ...(person.riseRatings ?? {}) };
    const counts = { ...(person.matchCount ?? {}) };
    const mine = remaining.filter((r) => r.personId === person.id);

    for (const r of gone.filter((g) => g.personId === person.id)) {
      const current = ratings[r.format] ?? r.ratingAfter;
      ratings[r.format] = current - r.deltaApplied;
      counts[r.format] = Math.max(0, (counts[r.format] ?? 1) - 1);

      /* The last match in a format the matches created: the format goes, as it
         was before the first one. A seed stays, at its value. */
      const createdByMatches = (r.notes as { seeded?: unknown } | null)?.seeded === false;
      if (createdByMatches && !mine.some((m) => m.format === r.format)) {
        delete ratings[r.format];
        delete counts[r.format];
      }
    }

    const riseBest = bestOf(ratings);
    const last = mine.reduce<Date | null>((at, r) => (at && at >= r.createdAt ? at : r.createdAt), null);

    await tx
      .update(people)
      .set({
        riseRatings: ratings,
        riseBest,
        matchCount: counts,
        /* REPLAYED, not un-merged. The record keeps rounded averages, so taking
           one match back out by arithmetic is a point out, and a second undo
           builds on the first one's error — three undos in a row drifted by two.
           Every history row keeps exactly what its apply merged, so replaying
           what is left is exact, and repairs any drift rather than adding to it. */
        partnerStats: partnerStatsFromHistory(mine),
        lastPlayedAt: last,
        ...(derivedFor(person, remaining, riseBest, now) ?? {}),
      })
      .where(eq(people.id, person.id));
  }

  return { reverted: gone.length, personIds: ids };
}

/** Undo a tournament match's effect inside the caller's transaction. */
export const revertMatchRatingsIn = (tx: Tx, matchId: string) =>
  revertResultIn(tx, { kind: "tournament", matchId });

/** Undo a tournament match's effect in a transaction of its own. */
export async function revertMatchRatings(matchId: string): Promise<{ reverted: number }> {
  const done = await db.transaction((tx) => revertMatchRatingsIn(tx, matchId));
  return { reverted: done.reverted };
}

/** Same result, same winner, same score, same stage. */
function sameSettlement(a: Settled | null, b: Settled): boolean {
  return (
    !!a &&
    a.winnerTeamId === b.winnerTeamId &&
    a.loserTeamId === b.loserTeamId &&
    a.scoreW === b.scoreW &&
    a.scoreL === b.scoreL &&
    a.phase === b.phase
  );
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

type Settled = { winnerTeamId: string; loserTeamId: string; scoreW: number; scoreL: number; phase: Phase };

function settleMatch(t: Tournament, m: Match): Settled | null {
  if (!m.teamAId || !m.teamBId) return null;
  const r = matchResult(t, m);
  if (!r?.winner) return null;
  const { a, b } = r;
  const aWon = r.winner === "a";
  return {
    winnerTeamId: aWon ? m.teamAId : m.teamBId,
    loserTeamId: aWon ? m.teamBId : m.teamAId,
    scoreW: aWon ? a : b,
    scoreL: aWon ? b : a,
    phase: phaseOf(m.round),
  };
}

/**
 * How many times these two sides have already met inside the §8 window.
 *
 * Read from history `notes.opponentIds` rather than by re-joining matches:
 * the opponents are recorded at the time the rating moved, which is exactly the
 * set the rule is about.
 */
async function recentMeetings(
  tx: Tx,
  allIds: string[],
  winnerIds: string[],
  loserIds: string[],
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * DAY);
  const rows = await tx
    .select({
      personId: ratingHistory.personId,
      matchId: ratingHistory.matchId,
      communityMatchId: ratingHistory.communityMatchId,
      notes: ratingHistory.notes,
    })
    .from(ratingHistory)
    .where(and(inArray(ratingHistory.personId, allIds), gte(ratingHistory.createdAt, since)));

  const opposing = new Set(loserIds);
  const seen = new Set<string>();
  for (const r of rows) {
    if (!winnerIds.includes(r.personId)) continue;
    const opps = (r.notes as { opponentIds?: string[] })?.opponentIds ?? [];
    if (!opps.some((o) => opposing.has(o))) continue;

    /* Community results count here too, and count for MORE than tournament ones
       in practice: the same four friends meet at the same court every Thursday,
       which is precisely the farming §8 exists to damp. Prefixed so a tournament
       id and a community id can never collide in this set. */
    const ref = r.matchId ? `t:${r.matchId}` : r.communityMatchId ? `c:${r.communityMatchId}` : null;
    if (ref) seen.add(ref);
  }
  return seen.size;
}

/**
 * Spec §8: at most ±60 net per person per day.
 *
 * Applied against what the person has ALREADY moved today, so the cap bounds
 * the day rather than each match — otherwise six matches could move someone
 * 360 points while each one looked compliant.
 */
async function applyDailyCap<T extends { personId: string; delta: number }>(
  tx: Tx,
  rows: T[],
  now: Date,
): Promise<T[]> {
  const startOfDay = new Date(now.getTime() - (now.getTime() % DAY));
  const today = await tx
    .select({ personId: ratingHistory.personId, delta: ratingHistory.deltaApplied })
    .from(ratingHistory)
    .where(and(inArray(ratingHistory.personId, rows.map((r) => r.personId)), gte(ratingHistory.createdAt, startOfDay)));

  const used = new Map<string, number>();
  for (const t of today) used.set(t.personId, (used.get(t.personId) ?? 0) + t.delta);

  return rows.map((r) => ({ ...r, delta: capDelta(used.get(r.personId) ?? 0, r.delta) }));
}

/* ── Derived signals ─────────────────────────────────────────────────────── */

export type PartnerStat = {
  matches: number;
  wins: number;
  avgPartnerRating: number;
  avgOpponentRating: number;
};

/**
 * Spec §6.2. Running averages, so the whole history never has to be re-read.
 *
 * Kept per PARTNER rather than as one aggregate: "wins with a much stronger
 * partner" is a statement about a specific person, and it is what the
 * independence component and a disputed carry-guard both need to point at.
 */
export function mergePartnerStats(
  existing: Record<string, unknown> | null,
  note: { won: boolean; partnerIds: string[]; partnerRatings: number[]; opponentRatings: number[] },
): Record<string, PartnerStat> {
  const out: Record<string, PartnerStat> = { ...((existing ?? {}) as Record<string, PartnerStat>) };
  const avgOpp = note.opponentRatings.length
    ? note.opponentRatings.reduce((s, n) => s + n, 0) / note.opponentRatings.length
    : 0;

  note.partnerIds.forEach((id, i) => {
    const prev = out[id] ?? { matches: 0, wins: 0, avgPartnerRating: 0, avgOpponentRating: 0 };
    const n = prev.matches + 1;
    out[id] = {
      matches: n,
      wins: prev.wins + (note.won ? 1 : 0),
      avgPartnerRating: Math.round((prev.avgPartnerRating * prev.matches + (note.partnerRatings[i] ?? 0)) / n),
      avgOpponentRating: Math.round((prev.avgOpponentRating * prev.matches + avgOpp) / n),
    };
  });
  return out;
}

/**
 * A partner record rebuilt from history: every row's note merged in the order
 * the rows were written.
 *
 * Each row's `notes` is exactly what its apply handed `mergePartnerStats` — the
 * partners and their ratings AT THE TIME — so replaying them reproduces the
 * record the applies built, match for match, including the rounding. That is
 * what makes a revert exact: replay what is left. Taking one match back out by
 * arithmetic cannot be, because the record keeps rounded averages (spec §6.2),
 * not the sums behind them.
 *
 * Ordered by when each row was written — the moment of the write, taken after
 * the locks (see the insert in `applyResult`), which is the order the merges
 * ran in — then by id so the order is total.
 *
 * Only rows an apply MERGED are replayed: those whose note carries the partner
 * ratings. The first rows the engine ever wrote (before `mergePartnerStats`
 * existed, be4bff2) name partners but record no ratings, and nothing merged
 * them; replaying them would count each such partner at a rating of nought.
 */
export function partnerStatsFromHistory(
  rows: { id: string; createdAt: Date; notes: unknown }[],
): Record<string, PartnerStat> {
  const inOrder = [...rows].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0),
  );
  let out: Record<string, PartnerStat> = {};
  for (const r of inOrder) {
    const n = (r.notes ?? {}) as {
      won?: boolean; partnerIds?: string[]; partnerRatings?: unknown; opponentRatings?: unknown;
    };
    if (!n.partnerIds?.length || !Array.isArray(n.partnerRatings)) continue;
    out = mergePartnerStats(out, {
      won: !!n.won,
      partnerIds: n.partnerIds,
      partnerRatings: n.partnerRatings as number[],
      opponentRatings: Array.isArray(n.opponentRatings) ? (n.opponentRatings as number[]) : [],
    });
  }
  return out;
}
