/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* League and group tables.
 *
 * There is one standings engine, not one per format, because the formats differ
 * only in the ORDER they break ties — and they genuinely do differ:
 *
 *   Pickleboss   wins → point difference → head-to-head → points for → name
 *   OSL §2.8     head-to-head → difference → points scored → lots
 *   legacy RISE  wins → difference → points for
 *
 * Hardcoding any one of those would silently produce the wrong table for the
 * other two. So a format supplies an ordered chain of named comparators and the
 * engine applies them in turn.
 *
 * Every chain ends deterministically (seed order, never a random draw), so the
 * same results always produce the same table — on the organiser's laptop, on a
 * spectator's phone, and in a test.
 */

export type TeamRef = { id: string; name: string; seed?: number };

export type StandingsMatch = {
  teamAId: string | null;
  teamBId: string | null;
  scoreA: number;
  scoreB: number;
  /** Unplayed matches contribute nothing. */
  played: boolean;
};

export type Row = {
  teamId: string;
  name: string;
  seed: number;
  played: number;
  won: number;
  lost: number;
  drawn: number;
  pointsFor: number;
  pointsAgainst: number;
  diff: number;
  /** Competition points: 2 for a win, 1 for a draw, by default. */
  points: number;
  rank: number;
};

export type ComparatorName =
  | "points"
  | "wins"
  | "pointDiff"
  | "pointsFor"
  | "headToHead"
  | "name"
  | "seed";

export type StandingsOptions = {
  /** Ordered tie-break chain. Always finish with a deterministic comparator. */
  tieBreak: ComparatorName[];
  /** Competition points awarded for a win / draw. */
  winPoints?: number;
  drawPoints?: number;
  /** Whether the sport can draw at all (chess and carrom can; racket sports cannot). */
  allowDraws?: boolean;
};

/** Head-to-head is the only comparator that needs the fixture list, and it is
 *  computed over ONLY the tied teams — a mini-table, as both rule books say. */
type Ctx = { matches: StandingsMatch[]; tied: Set<string> };

const h2hScore = (row: Row, ctx: Ctx): { wins: number; diff: number } => {
  let wins = 0, diff = 0;
  for (const m of ctx.matches) {
    if (!m.played || !m.teamAId || !m.teamBId) continue;
    if (!ctx.tied.has(m.teamAId) || !ctx.tied.has(m.teamBId)) continue;
    if (m.teamAId === row.teamId) {
      diff += m.scoreA - m.scoreB;
      if (m.scoreA > m.scoreB) wins++;
    } else if (m.teamBId === row.teamId) {
      diff += m.scoreB - m.scoreA;
      if (m.scoreB > m.scoreA) wins++;
    }
  }
  return { wins, diff };
};

const COMPARATORS: Record<ComparatorName, (a: Row, b: Row, ctx: Ctx) => number> = {
  points: (a, b) => b.points - a.points,
  wins: (a, b) => b.won - a.won,
  pointDiff: (a, b) => b.diff - a.diff,
  pointsFor: (a, b) => b.pointsFor - a.pointsFor,
  headToHead: (a, b, ctx) => {
    const x = h2hScore(a, ctx), y = h2hScore(b, ctx);
    return y.wins - x.wins || y.diff - x.diff;
  },
  name: (a, b) => a.name.localeCompare(b.name),
  seed: (a, b) => a.seed - b.seed,
};

function blank(team: TeamRef, index: number): Row {
  return {
    teamId: team.id,
    name: team.name,
    seed: team.seed ?? index,
    played: 0, won: 0, lost: 0, drawn: 0,
    pointsFor: 0, pointsAgainst: 0, diff: 0, points: 0, rank: 0,
  };
}

/**
 * Build a table for one group (or a whole league — same thing with one group).
 *
 * Ties are resolved by applying the chain to the tied SUBSET, so head-to-head
 * means "between exactly these teams" rather than across the whole group. That
 * is what both rule books specify and it is the part that is easy to get wrong.
 */
export function standings(
  teams: TeamRef[],
  matches: StandingsMatch[],
  { tieBreak, winPoints = 2, drawPoints = 1, allowDraws = false }: StandingsOptions,
): Row[] {
  const rows = new Map<string, Row>();
  teams.forEach((t, i) => rows.set(t.id, blank(t, i)));

  for (const m of matches) {
    if (!m.played || !m.teamAId || !m.teamBId) continue;
    const A = rows.get(m.teamAId), B = rows.get(m.teamBId);
    if (!A || !B) continue;

    A.played++; B.played++;
    A.pointsFor += m.scoreA; A.pointsAgainst += m.scoreB;
    B.pointsFor += m.scoreB; B.pointsAgainst += m.scoreA;

    if (m.scoreA > m.scoreB) { A.won++; B.lost++; A.points += winPoints; }
    else if (m.scoreB > m.scoreA) { B.won++; A.lost++; B.points += winPoints; }
    else if (allowDraws) { A.drawn++; B.drawn++; A.points += drawPoints; B.points += drawPoints; }
    /* A level score in a sport that cannot draw is a data error, not a draw:
       counted as played so it shows up, but awarded to nobody. */
  }

  for (const r of rows.values()) r.diff = r.pointsFor - r.pointsAgainst;

  const all = [...rows.values()];
  const sorted = resolve(all, matches, tieBreak);
  sorted.forEach((r, i) => (r.rank = i + 1));
  return sorted;
}

/**
 * Resolve the order by applying the chain HIERARCHICALLY.
 *
 * Each comparator is evaluated within the block of teams still level after the
 * previous one, which matters enormously for head-to-head: "the mini-table
 * between exactly the tied teams" is what both rule books say, and computing it
 * across the whole group instead gives a different — wrong — order. An earlier
 * version of this function sorted once against the full field and only
 * re-sorted blocks afterwards, which quietly did exactly that.
 */
function resolve(
  rows: Row[],
  matches: StandingsMatch[],
  chain: ComparatorName[],
  depth = 0,
): Row[] {
  if (rows.length <= 1) return rows;
  if (depth >= chain.length) {
    /* Never leave an arbitrary order: seed is the final, deterministic word, so
       the same results always render the same table. */
    return [...rows].sort((a, b) => a.seed - b.seed);
  }

  const compare = COMPARATORS[chain[depth]];
  /* Scoped to THIS block — that is what makes head-to-head a mini-table. */
  const ctx: Ctx = { matches, tied: new Set(rows.map((r) => r.teamId)) };
  const sorted = [...rows].sort((a, b) => compare(a, b, ctx));

  const out: Row[] = [];
  let i = 0;
  while (i < sorted.length) {
    let j = i + 1;
    while (j < sorted.length && compare(sorted[i], sorted[j], ctx) === 0) j++;
    out.push(...resolve(sorted.slice(i, j), matches, chain, depth + 1));
    i = j;
  }
  return out;
}

/* ---------- the chains each format actually uses ---------- */

/** Pickleboss: wins, then point difference, then head-to-head, then points for. */
export const PICKLEBOSS_TIEBREAK: ComparatorName[] = ["wins", "pointDiff", "headToHead", "pointsFor", "name"];

/** OSL §2.8: head-to-head first, then difference, then points scored, then lots. */
export const OSL_TIEBREAK: ComparatorName[] = ["points", "headToHead", "pointDiff", "pointsFor", "seed"];

/** The legacy RISE league table. */
export const DEFAULT_TIEBREAK: ComparatorName[] = ["wins", "pointDiff", "pointsFor", "seed"];

export const TIEBREAKS: Record<string, ComparatorName[]> = {
  standard: DEFAULT_TIEBREAK,
  osl: OSL_TIEBREAK,
  pickleboss: PICKLEBOSS_TIEBREAK,
};
