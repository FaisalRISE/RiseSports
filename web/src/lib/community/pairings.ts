import "server-only";

/* Deciding who plays whom, and on which court.
 *
 * Ported from `buildCourts` (app.source.js:8872) and `genCourtGames` (:8846).
 * Pure — takes a list of entrants and returns blocks of courts. The database
 * write lives in schedule.ts, so this can be tested exhaustively without one.
 *
 * ── The four modes are genuinely different ideas ──────────────────────────
 * Random      deal round-robin across courts. No structure, and that is the
 *             point: it is what a host picks when the group is a group.
 * Balanced    snake draft down the rating order, so every court's total is
 *             about the same and the games are close. Strong plays with weak.
 * Mexicano    consecutive blocks down the rating order, so the strongest four
 *             share a court. Strong plays STRONG. The opposite of balanced,
 *             and the reason both exist.
 * Americano   ignore rating entirely and rotate the whole list between blocks,
 *             so over an evening everyone partners everyone.
 *
 * Getting balanced and mexicano the wrong way round is the easy mistake here —
 * both sort by rating and only the dealing differs — so both are pinned by
 * tests that assert what the mode is FOR, not just what it returns.
 */

import type { ScheduleMode } from "@/lib/db/schema";

export type Entrant = { personId: string; rating: number };

export type Game = { lineupA: string[]; lineupB: string[] };
export type Court = { court: number; personIds: string[]; games: Game[] };
export type Block = { label: string; courts: Court[]; benched: string[] };

/* ── Time ─────────────────────────────────────────────────────────────────*/

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
};

const toHHMM = (mins: number): string => {
  const wrapped = ((mins % 1440) + 1440) % 1440;
  return `${String(Math.floor(wrapped / 60)).padStart(2, "0")}:${String(wrapped % 60).padStart(2, "0")}`;
};

/** Halfway between two times, for a session that reshuffles at half time. */
export function midTime(start: string, end: string): string {
  const s = toMinutes(start);
  let e = toMinutes(end);
  /* A session ending after midnight — 22:00 to 00:30 — would otherwise put the
     midpoint at 11:15 in the morning. */
  if (e < s) e += 1440;
  return toHHMM(Math.round((s + e) / 2));
}

/* ── Games on one court ───────────────────────────────────────────────────*/

/**
 * Every game the players on one court will play.
 *
 * Four is the case that matters: three games, and each of the three possible
 * partnerships happens exactly once (AB-CD, AC-BD, AD-BC). Everyone partners
 * everyone and plays everyone, which is what people mean by a round on a court.
 */
export function courtGames(personIds: string[]): Game[] {
  const n = personIds.length;
  const game = (a: string[], b: string[]): Game => ({ lineupA: a, lineupB: b });
  const [p0, p1, p2, p3] = personIds;

  if (n < 2) return [];
  if (n === 2) return [game([p0], [p1])];
  if (n === 3) return [game([p0], [p1]), game([p0], [p2]), game([p1], [p2])];
  if (n === 4) {
    return [
      game([p0, p1], [p2, p3]),
      game([p0, p2], [p1, p3]),
      game([p0, p3], [p1, p2]),
    ];
  }

  /* Five or more on a court: a rotating window of four, one game per player, so
     everybody sits out the same number of times. */
  return personIds.map((_, i) => {
    const w = [0, 1, 2, 3].map((k) => personIds[(i + k) % n]);
    return game([w[0], w[1]], [w[2], w[3]]);
  });
}

/* ── Dealing players onto courts ──────────────────────────────────────────*/

/** A shuffle the caller can make repeatable by passing its own `rand`. */
function shuffled<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const byRatingDesc = (a: Entrant, b: Entrant) => b.rating - a.rating || a.personId.localeCompare(b.personId);

function ordered(entrants: Entrant[], mode: ScheduleMode, block: number, rand: () => number): Entrant[] {
  if (mode === "balanced" || mode === "mexicano") return [...entrants].sort(byRatingDesc);

  if (mode === "americano") {
    /* A stable order, rotated by two each block — so the pairs that shared a
       court last time are split up next time. Two, not one, because a rotation
       of one leaves half the partnerships intact when courts hold four. */
    const stable = [...entrants].sort((a, b) => a.personId.localeCompare(b.personId));
    if (stable.length === 0) return stable;
    const by = (block * 2) % stable.length;
    return [...stable.slice(by), ...stable.slice(0, by)];
  }

  return shuffled(entrants, rand);
}

/**
 * One block of play: who is on which court, and who sits out.
 *
 * The court count is bounded by the players available as well as by the courts
 * booked — eight people on four booked courts is two courts of four, not four
 * courts of two.
 */
export function buildBlock(
  entrants: Entrant[],
  opts: { courts: number; perCourt: number; mode: ScheduleMode; block?: number; label?: string; rand?: () => number },
): Block {
  const { courts, perCourt, mode } = opts;
  const block = opts.block ?? 0;
  const rand = opts.rand ?? Math.random;

  const pool = ordered(entrants, mode, block, rand);
  const n = pool.length;

  /* ── How many courts to actually use ────────────────────────────────────
   *
   * The legacy rule is `floor(players / perCourt)` (app.source.js:8883), which
   * only counts courts it can fill COMPLETELY. Six people on two booked courts
   * of four therefore use one court and bench two — for the whole evening,
   * while the second court the host paid for stands empty. Seven bench three.
   * That is not a rounding detail; it is two people who came out to play and
   * did not.
   *
   * So: use as many courts as the players can cover, subject to
   *   - never more than are booked,
   *   - never so many that a court gets fewer than two people, since one
   *     person on a court has nobody to play.
   * Six then becomes 3 and 3, seven becomes 4 and 3, and eight on four booked
   * courts is still 4 and 4 rather than four thin courts of two.
   */
  const usable = Math.max(1, Math.min(courts, Math.ceil(n / perCourt), Math.floor(n / 2)));

  const seatable = Math.min(n, usable * perCourt);
  const seated = pool.slice(0, seatable);
  const benched = pool.slice(seatable);

  /* Lane sizes up front, as even as possible — dealing has to respect them, so
     it cannot be left to fall out of a modulo. */
  const base = Math.floor(seatable / usable);
  const spare = seatable % usable;
  const sizes = Array.from({ length: usable }, (_, i) => base + (i < spare ? 1 : 0));

  const lanes: Entrant[][] = Array.from({ length: usable }, () => []);
  const full = (i: number) => lanes[i].length >= sizes[i];

  if (mode === "mexicano") {
    /* Consecutive blocks: the top players share court 1. The strongest play
       each other, which is the whole idea — not a bug in the snake. */
    let lane = 0;
    for (const e of seated) {
      while (full(lane)) lane++;
      lanes[lane].push(e);
    }
  } else if (mode === "balanced") {
    /* Snake draft: 0,1,…,u-1 then u-1,…,0. Court 1 gets the best player and the
       worst, court 2 the second-best and second-worst, so the court TOTALS come
       out close and the games are competitive. Lanes that are already at their
       size are skipped, which is what keeps uneven lanes working. */
    let lane = 0;
    let direction = 1;
    for (const e of seated) {
      let guard = 0;
      while (full(lane) && guard++ <= usable * 2) {
        if (direction === 1 && lane === usable - 1) direction = -1;
        else if (direction === -1 && lane === 0) direction = 1;
        else lane += direction;
      }
      lanes[lane].push(e);
      if (direction === 1 && lane === usable - 1) direction = -1;
      else if (direction === -1 && lane === 0) direction = 1;
      else lane += direction;
    }
  } else {
    /* Deal round-robin, so a remainder spreads rather than piling up. */
    let lane = 0;
    for (const e of seated) {
      let guard = 0;
      while (full(lane) && guard++ <= usable * 2) lane = (lane + 1) % usable;
      lanes[lane].push(e);
      lane = (lane + 1) % usable;
    }
  }

  return {
    label: opts.label ?? "",
    courts: lanes.map((lane, i) => ({
      court: i + 1,
      personIds: lane.map((e) => e.personId),
      games: courtGames(lane.map((e) => e.personId)),
    })),
    benched: benched.map((e) => e.personId),
  };
}

/**
 * The whole evening: one block, or two when the game reshuffles at half time.
 *
 * Returns an empty list under two players — there is no session to schedule,
 * and a block of one person on a court is worse than nothing on the screen.
 */
export function buildSchedule(
  entrants: Entrant[],
  game: {
    courts: number; perCourt: number; scheduleMode: ScheduleMode;
    rotation: string; startTime: string; endTime: string;
  },
  rand: () => number = Math.random,
): Block[] {
  if (entrants.length < 2) return [];

  const halves = game.rotation === "rotate" ? 2 : 1;
  const mid = midTime(game.startTime, game.endTime);

  return Array.from({ length: halves }, (_, i) => {
    const label =
      halves === 1
        ? `${game.startTime}–${game.endTime}`
        : i === 0
          ? `${game.startTime}–${mid}`
          : `${mid}–${game.endTime}`;

    return buildBlock(entrants, {
      courts: game.courts,
      perCourt: game.perCourt,
      mode: game.scheduleMode,
      block: i,
      label,
      rand,
    });
  });
}
