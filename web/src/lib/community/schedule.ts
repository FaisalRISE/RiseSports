import "server-only";

/* Turning a confirmed list into games, and a score into a rating change.
 *
 * Ported from `me` (app.source.js:10042, the generator) and `Se` (:10060, the
 * score save). The pairing maths is in pairings.ts; this is the database side.
 */

import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  communityAttendance, communityByes, communityMatches, communitySessions,
  people, ratingHistory,
  type CommunityGame, type CommunityMatch, type Person,
} from "@/lib/db/schema";
import { applyResult } from "@/lib/rating/apply";
import { ratingKey } from "@/lib/sports/registry";
import { DEFAULT_SEED } from "@/lib/rating";
import { buildSchedule, type Entrant } from "./pairings";
import { ensureSession, findSession } from "./store";

export type ScheduleResult = { ok: true; games: number } | { ok: false; error: string };

/* ── Which rating bucket a community game counts towards ──────────────────*/

/**
 * "pb:md" and so on, from who is actually on the court.
 *
 * The same inference the tournament path makes (lib/rating/tournament
 * ratingFormatFor) and for the same reason: there is no category field, so the
 * lineup is the only real evidence. Deliberately computed PER GAME rather than
 * per session — a mixed evening genuinely produces some men's doubles and some
 * mixed, and bucketing the whole night as one category would put results in a
 * rating the player does not play.
 */
export function communityRatingKey(
  sport: CommunityGame["sport"],
  lineupA: string[],
  lineupB: string[],
  genderOf: Map<string, "M" | "F">,
): string {
  const size = Math.max(lineupA.length, lineupB.length);
  if (size > 2) return ratingKey(sport, "gn");

  const all = [...lineupA, ...lineupB];
  const men = all.some((id) => genderOf.get(id) === "M");
  const women = all.some((id) => genderOf.get(id) === "F");

  if (size === 1) return ratingKey(sport, men && women ? "gn" : women ? "ws" : "ms");
  return ratingKey(sport, men && women ? "mx" : women ? "wd" : "md");
}

/* ── Generating the evening ───────────────────────────────────────────────*/

/**
 * Build the pairings for one date from whoever is confirmed.
 *
 * Regenerating REPLACES the previous pairings, and refuses once any score has
 * been entered. Reshuffling a session halfway through would orphan the results
 * already recorded and, worse, leave the ratings those results moved with
 * nothing to point at.
 */
export async function generateSchedule(
  game: CommunityGame,
  date: string,
  rand: () => number = Math.random,
): Promise<ScheduleResult> {
  const session = await ensureSession(game.id, date);

  const played = await db
    .select({ id: communityMatches.id })
    .from(communityMatches)
    .where(eq(communityMatches.sessionId, session.id));

  if (played.length > 0) {
    const scored = await db
      .select({ id: ratingHistory.id })
      .from(ratingHistory)
      .where(inArray(ratingHistory.communityMatchId, played.map((p) => p.id)))
      .limit(1);
    if (scored.length > 0) {
      return { ok: false, error: "Scores have already been entered — clear them first." };
    }
  }

  const confirmed = await db
    .select({ personId: communityAttendance.personId, riseBest: people.riseBest })
    .from(communityAttendance)
    .innerJoin(people, eq(communityAttendance.personId, people.id))
    .where(
      and(eq(communityAttendance.sessionId, session.id), eq(communityAttendance.state, "confirmed")),
    );

  if (confirmed.length < 2) return { ok: false, error: "Confirm at least two players first." };

  const entrants: Entrant[] = confirmed.map((c) => ({
    personId: c.personId,
    rating: c.riseBest ?? DEFAULT_SEED,
  }));

  const blocks = buildSchedule(entrants, game, rand);

  await db.transaction(async (tx) => {
    /* Replace wholesale. No score exists at this point — checked above — so
       there is nothing to preserve and nothing to reconcile. */
    await tx.delete(communityMatches).where(eq(communityMatches.sessionId, session.id));
    await tx.delete(communityByes).where(eq(communityByes.sessionId, session.id));

    for (const [blockIndex, block] of blocks.entries()) {
      for (const court of block.courts) {
        for (const g of court.games) {
          await tx.insert(communityMatches).values({
            id: randomUUID(),
            sessionId: session.id,
            block: blockIndex,
            /* The unique index is (session, block, court), so several games on
               one court need distinct court numbers. They are offset by the
               court's position in its own game list — the display groups them
               back by `court` div 100. */
            court: court.court * 100 + court.games.indexOf(g),
            lineupA: g.lineupA,
            lineupB: g.lineupB,
          });
        }
      }
      if (block.benched.length > 0) {
        await tx.insert(communityByes).values({
          sessionId: session.id,
          block: blockIndex,
          personIds: block.benched,
        });
      }
    }

    await tx
      .update(communitySessions)
      .set({ scheduledAt: new Date() })
      .where(eq(communitySessions.id, session.id));
  });

  const games = blocks.reduce((n, b) => n + b.courts.reduce((m, c) => m + c.games.length, 0), 0);
  return { ok: true, games };
}

/* ── Reading it back ──────────────────────────────────────────────────────*/

export type ScheduledGame = {
  id: string;
  court: number;
  lineupA: string[];
  lineupB: string[];
  scoreA: number | null;
  scoreB: number | null;
};

export type ScheduleBlock = {
  block: number;
  label: string;
  courts: { court: number; games: ScheduledGame[] }[];
  benched: string[];
};

export type SessionSchedule = {
  blocks: ScheduleBlock[];
  /** Person id → name, for everyone who appears anywhere in it. */
  names: Map<string, string>;
};

const EMPTY: SessionSchedule = { blocks: [], names: new Map() };

export async function scheduleFor(game: CommunityGame, date: string): Promise<SessionSchedule> {
  const session = await findSession(game.id, date);
  if (!session?.scheduledAt) return EMPTY;

  const rows = await db
    .select()
    .from(communityMatches)
    .where(eq(communityMatches.sessionId, session.id))
    .orderBy(asc(communityMatches.block), asc(communityMatches.court));

  if (rows.length === 0) return EMPTY;

  const byes = await db
    .select()
    .from(communityByes)
    .where(eq(communityByes.sessionId, session.id));
  const benchedIn = new Map(byes.map((b) => [b.block, b.personIds]));

  const ids = [
    ...new Set([...rows.flatMap((r) => [...r.lineupA, ...r.lineupB]), ...byes.flatMap((b) => b.personIds)]),
  ];
  const folk = ids.length
    ? await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, ids))
    : [];
  const names = new Map(folk.map((p) => [p.id, p.name]));

  /* Two blocks at most, so labels are rebuilt rather than stored — they are a
     function of the game's times, and storing them would let them go stale the
     moment an organiser edits the start time. */
  const blockCount = Math.max(...rows.map((r) => r.block)) + 1;
  const { midTime } = await import("./pairings");
  const mid = midTime(game.startTime, game.endTime);

  const blocks: ScheduleBlock[] = [];
  for (let b = 0; b < blockCount; b++) {
    const mine = rows.filter((r) => r.block === b);
    const byCourt = new Map<number, ScheduledGame[]>();

    for (const r of mine) {
      /* Undo the offset applied when writing: court 3, game 2 was stored as
         302. */
      const court = Math.floor(r.court / 100);
      const list = byCourt.get(court) ?? [];
      list.push({
        id: r.id, court,
        lineupA: r.lineupA, lineupB: r.lineupB,
        scoreA: r.scoreA, scoreB: r.scoreB,
      });
      byCourt.set(court, list);
    }

    blocks.push({
      block: b,
      label:
        blockCount === 1
          ? `${game.startTime}–${game.endTime}`
          : b === 0
            ? `${game.startTime}–${mid}`
            : `${mid}–${game.endTime}`,
      courts: [...byCourt.entries()].sort((x, y) => x[0] - y[0]).map(([court, games]) => ({ court, games })),
      benched: benchedIn.get(b) ?? [],
    });
  }

  return { blocks, names };
}

/* ── Saving a score, and moving the ratings ───────────────────────────────*/

export type SaveScoreResult =
  | { ok: true; ratingApplied: boolean; reason?: string }
  | { ok: false; error: string };

/**
 * Record one game's score and move everyone's rating.
 *
 * This is the reason community play mattered enough to port before venues or
 * the ledger: the legacy app calls the rating engine here on EVERY community
 * score (app.source.js:10077), so this path — not the tournament one — is where
 * most rating movement in the product actually happens.
 *
 * It goes through `applyResult`, the same engine the tournament path uses, so
 * the carry guard, the daily cap, repeat damping and the imbalance ledger all
 * apply. The legacy version has none of those: it averages the two sides and
 * calls `calcRtgChange` directly, which is where the conservation leak lives.
 */
export async function saveScore(
  game: CommunityGame,
  matchId: string,
  scoreA: number,
  scoreB: number,
): Promise<SaveScoreResult> {
  if (!Number.isInteger(scoreA) || !Number.isInteger(scoreB)) return { ok: false, error: "Scores must be whole numbers." };
  if (scoreA < 0 || scoreB < 0) return { ok: false, error: "Scores cannot be negative." };
  if (scoreA === scoreB) return { ok: false, error: "A game cannot be a draw — somebody has to win." };

  const [match] = await db
    .select()
    .from(communityMatches)
    .where(eq(communityMatches.id, matchId))
    .limit(1);
  if (!match) return { ok: false, error: "No such game." };

  /* The rating has already moved for this game. Re-saving would either move it
     twice or leave the recorded score disagreeing with the recorded change, so
     the score is fixed once it counts. */
  const applied = await db
    .select({ id: ratingHistory.id })
    .from(ratingHistory)
    .where(eq(ratingHistory.communityMatchId, matchId))
    .limit(1);
  if (applied.length > 0) {
    return { ok: false, error: "This score is already counted. Ask an organiser to undo it first." };
  }

  await db
    .update(communityMatches)
    .set({ scoreA, scoreB })
    .where(eq(communityMatches.id, matchId));

  const aWon = scoreA > scoreB;
  const winnerIds = aWon ? match.lineupA : match.lineupB;
  const loserIds = aWon ? match.lineupB : match.lineupA;

  const ids = [...winnerIds, ...loserIds];
  const folk: Person[] = ids.length
    ? await db.select().from(people).where(inArray(people.id, ids))
    : [];
  const genderOf = new Map(folk.map((p) => [p.id, p.gender]));

  const result = await applyResult({
    ref: { kind: "community", communityMatchId: matchId },
    key: communityRatingKey(game.sport, match.lineupA, match.lineupB, genderOf),
    winnerIds,
    loserIds,
    scoreW: Math.max(scoreA, scoreB),
    scoreL: Math.min(scoreA, scoreB),
    /* Community play is never a final. Every game carries the base stage
       multiplier, which is what "group" means in the rating spec. */
    phase: "group",
    /* Nobody refereed it — somebody typed in the score afterwards. The
       verification weight says so, and damps the movement accordingly. */
    verification: "self",
    now: new Date(),
  });

  return {
    ok: true,
    ratingApplied: result.status === "applied",
    reason: result.status === "skipped" ? result.reason : undefined,
  };
}

/** Clear a score and take back the rating it moved. */
export async function clearScore(matchId: string): Promise<SaveScoreResult> {
  const { revertCommunityResult } = await import("./revert");
  await revertCommunityResult(matchId);
  await db
    .update(communityMatches)
    .set({ scoreA: null, scoreB: null })
    .where(eq(communityMatches.id, matchId));
  return { ok: true, ratingApplied: false };
}

export type { CommunityMatch };
