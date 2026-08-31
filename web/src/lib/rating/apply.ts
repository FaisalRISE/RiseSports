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
import { and, eq, gte, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  matches, people, players, ratingHistory, ratingLedger, tournaments,
  type Match, type Person, type Tournament,
} from "@/lib/db/schema";
import {
  calcRtgChange, calcExp, marginMultiplier, phaseMultiplier, verificationWeight,
  provisionalMultiplier, DEFAULT_SEED, type Phase, type Verification,
} from "@/lib/rating";
import { phaseOf, ratingFormatFor } from "@/lib/rating/tournament";
import { ratingKey } from "@/lib/sports/registry";
import { viewMatch, rulesFor } from "@/lib/matchState";
import type { Rules } from "@/lib/scoring/rules";

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
 */
export function validScore(rules: Rules | null, w: number, l: number): boolean {
  if (!rules) return w > l; // formats this engine does not score (tennis, padel)
  if (w <= l) return false;
  if (rules.cap != null && w > rules.cap) return false;
  if (w < rules.target) return false;
  /* Won by the required margin, unless the cap forced a one-point finish. */
  if (w - l >= rules.winBy) return true;
  return rules.cap != null && w === rules.cap;
}

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

/** What a person's rating is right now for this format. */
const ratingOf = (p: Person, key: string) => p.riseRatings?.[key] ?? p.riseBest ?? DEFAULT_SEED;

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
    .select({ match: matches, tournament: tournaments })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(eq(matches.id, matchId))
    .limit(1);
  if (!row) return { status: "skipped", reason: "no such match" };

  const { match: m, tournament: t } = row;

  /* Already applied. Checked before any work so a re-save cannot double-move a
     rating even if the unique index were somehow dropped. */
  const existing = await db
    .select({ id: ratingHistory.id })
    .from(ratingHistory)
    .where(eq(ratingHistory.matchId, matchId))
    .limit(1);
  if (existing.length > 0) return { status: "already" };

  const settled = settleMatch(t, m);
  if (!settled) return { status: "skipped", reason: "not finished" };

  const rules = rulesFor(t);
  if (!validScore(rules, settled.scoreW, settled.scoreL)) {
    return { status: "skipped", reason: `invalid score ${settled.scoreW}-${settled.scoreL}` };
  }

  const roster = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const key = ratingKey(t.sport, ratingFormatFor(roster));

  const personIdsOf = (teamId: string) =>
    roster.filter((p) => p.teamId === teamId && p.personId).map((p) => p.personId!);

  const winnerIds = personIdsOf(settled.winnerTeamId);
  const loserIds = personIdsOf(settled.loserTeamId);
  /* Nobody linked to a person: the event still works, the rating just cannot
     follow anyone out of it. Not an error. */
  if (winnerIds.length === 0 || loserIds.length === 0) {
    return { status: "skipped", reason: "no linked people on one side" };
  }

  const rosterPeople = await db
    .select()
    .from(people)
    .where(inArray(people.id, [...winnerIds, ...loserIds]));
  const byId = new Map(rosterPeople.map((p) => [p.id, p]));

  const side = (ids: string[]): Side => {
    const ratings = ids.map((id) => (byId.has(id) ? ratingOf(byId.get(id)!, key) : DEFAULT_SEED));
    return { personIds: ids, ratings, mean: mean(ratings) };
  };
  const W = side(winnerIds);
  const L = side(loserIds);

  const gamesOf = (ids: string[]) =>
    Math.max(0, ...ids.map((id) => byId.get(id)?.matchCount?.[key] ?? 0));

  const change = calcRtgChange(W.mean, L.mean, settled.scoreW, settled.scoreL, {
    phase: settled.phase,
    verification,
    winnerGames: gamesOf(winnerIds),
    loserGames: gamesOf(loserIds),
  });

  /* §8 repeat opponents: farming the same two friends must not compound. */
  const repeats = await recentMeetings([...winnerIds, ...loserIds], winnerIds, loserIds, now);
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
      note: { won: true, damped, carried, opponentIds: L.personIds, partnerIds: W.personIds.filter((_, j) => j !== i) },
    });
  }
  for (let i = 0; i < L.personIds.length; i++) {
    rows.push({
      personId: L.personIds[i],
      before: L.ratings[i],
      delta: -Math.round(baseLoss),
      note: { won: false, damped, carried: false, opponentIds: W.personIds, partnerIds: L.personIds.filter((_, j) => j !== i) },
    });
  }

  /* §8 daily cap, ±60 net per person per day. Applied last, so it bounds the
     total movement rather than one match's share of it. */
  const capped = await applyDailyCap(rows, now);

  const imbalance = capped.reduce((s, r) => s + r.delta, 0);

  await db.transaction(async (tx) => {
    for (const r of capped) {
      const after = r.before + r.delta;
      await tx.insert(ratingHistory).values({
        id: randomUUID(),
        personId: r.personId,
        format: key,
        matchId,
        ratingBefore: r.before,
        ratingAfter: after,
        deltaApplied: r.delta,
        expected: Math.round(expected * 1000),
        marginMultiplier: Math.round(marginMultiplier(settled.scoreW, settled.scoreL) * 1000),
        stageMultiplier: Math.round(phaseMultiplier(settled.phase) * 1000),
        verificationWeight: Math.round(verificationWeight(verification) * 1000),
        provisionalMultiplier: Math.round(
          provisionalMultiplier(r.delta > 0 ? gamesOf(winnerIds) : gamesOf(loserIds)) * 1000,
        ),
        notes: r.note,
      });

      const person = byId.get(r.personId)!;
      const ratings = { ...(person.riseRatings ?? {}), [key]: after };
      const counts = { ...(person.matchCount ?? {}), [key]: (person.matchCount?.[key] ?? 0) + 1 };
      await tx
        .update(people)
        .set({
          riseRatings: ratings,
          riseBest: Math.max(...Object.values(ratings)),
          matchCount: counts,
          lastPlayedAt: now,
        })
        .where(eq(people.id, r.personId));
    }

    /* Conservation is broken on purpose in two places — the provisional
       multiplier (§5) and the carry guard (§6.1) — so the difference is
       written down rather than silently minted or destroyed. */
    if (imbalance !== 0) {
      await tx.insert(ratingLedger).values({
        id: randomUUID(),
        matchId,
        imbalance,
        reason: carriedAny ? "carry guard + provisional" : "provisional",
      });
    }
  });

  return { status: "applied", people: capped.length, imbalance };
}

/**
 * Undo a match's effect.
 *
 * The rating is defined as seed + sum of recorded deltas, so removing the rows
 * and recomputing keeps every rating explainable by its own history.
 *
 * The honest limitation: later matches were computed against the rating this
 * one produced, and they are NOT recomputed — that would cascade through every
 * opponent and their opponents. The numbers stay self-consistent and the drift
 * is bounded by one match's delta; anything stricter would mean freezing
 * finished matches entirely.
 */
export async function revertMatchRatings(matchId: string): Promise<{ reverted: number }> {
  const rows = await db.select().from(ratingHistory).where(eq(ratingHistory.matchId, matchId));
  if (rows.length === 0) return { reverted: 0 };

  await db.transaction(async (tx) => {
    await tx.delete(ratingHistory).where(eq(ratingHistory.matchId, matchId));
    await tx.delete(ratingLedger).where(eq(ratingLedger.matchId, matchId));

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
        .set({ riseRatings: ratings, riseBest: Math.max(...Object.values(ratings)), matchCount: counts })
        .where(eq(people.id, r.personId));
    }
  });

  return { reverted: rows.length };
}

/* ── helpers ─────────────────────────────────────────────────────────────── */

type Settled = { winnerTeamId: string; loserTeamId: string; scoreW: number; scoreL: number; phase: Phase };

function settleMatch(t: Tournament, m: Match): Settled | null {
  if (!m.teamAId || !m.teamBId) return null;
  const v = viewMatch(t, m);
  const [a, b] = v.typed ? [m.typedScoreA ?? 0, m.typedScoreB ?? 0] : [v.a, v.b];
  if (!(v.typed || v.over)) return null;
  if (a === b) return null;
  const aWon = a > b;
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
  allIds: string[],
  winnerIds: string[],
  loserIds: string[],
  now: Date,
): Promise<number> {
  const since = new Date(now.getTime() - REPEAT_WINDOW_DAYS * DAY);
  const rows = await db
    .select({ personId: ratingHistory.personId, matchId: ratingHistory.matchId, notes: ratingHistory.notes })
    .from(ratingHistory)
    .where(and(inArray(ratingHistory.personId, allIds), gte(ratingHistory.createdAt, since)));

  const opposing = new Set(loserIds);
  const seen = new Set<string>();
  for (const r of rows) {
    if (!winnerIds.includes(r.personId)) continue;
    const opps = (r.notes as { opponentIds?: string[] })?.opponentIds ?? [];
    if (opps.some((o) => opposing.has(o))) seen.add(r.matchId);
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
  rows: T[],
  now: Date,
): Promise<T[]> {
  const startOfDay = new Date(now.getTime() - (now.getTime() % DAY));
  const today = await db
    .select({ personId: ratingHistory.personId, delta: ratingHistory.deltaApplied })
    .from(ratingHistory)
    .where(and(inArray(ratingHistory.personId, rows.map((r) => r.personId)), gte(ratingHistory.createdAt, startOfDay)));

  const used = new Map<string, number>();
  for (const t of today) used.set(t.personId, (used.get(t.personId) ?? 0) + t.delta);

  return rows.map((r) => ({ ...r, delta: capDelta(used.get(r.personId) ?? 0, r.delta) }));
}
