/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Odyssey Sports League — team format, per OSL Official Rules v4.8.
 *
 * This is a LAYER over the shared scoring engine, not a second engine. The
 * rally log, serve tracking and court positions all come from replayRallies;
 * what OSL adds is the three-pair rotation and the five-sport championship.
 *
 * §3.2  Six players on court as three declared pairs (A, B, C). The order
 *       cannot change once play begins. Rally scoring — every rally is a point.
 *       Pair A plays 0→7, Pair B →14, Pair C →25. The trigger is the LEADING
 *       score, and the score is NEVER reset at a rotation.
 * §3.3  At 24–24 a single golden point decides the match.
 * §3.4  Pairs have 30 seconds to take position at a rotation; failure may cost
 *       a penalty point at the referee's discretion.
 * §5.6  Ends change when the leader first reaches 14 — the same moment Pair C
 *       comes on, so the switch happens once and cleanly.
 * §3.1  At least one woman must be in the playing six, and two women can never
 *       pair together: each woman plays in a mixed pair.
 */

import type { RuleOverrides } from "@/lib/scoring/rules";
import type { SportId } from "@/lib/sports/registry";

export const OSL_TARGET = 25;
export const OSL_GATE_1 = 7;
export const OSL_GATE_2 = 14;
export const OSL_GOLDEN = 24;
/** §5.6 — ends change with the Pair B → Pair C rotation. */
export const OSL_SWITCH_AT = OSL_GATE_2;
/** §3.4 — seconds allowed to take position at a rotation. */
export const OSL_SWITCH_SECONDS = 30;

/** Scoring overrides that turn any racket sport into the OSL match format.
 *  Rally scoring (§3.2), first to 25, golden point at 24–24 (§3.3). */
export const oslRuleOverrides = (): RuleOverrides => ({
  target: OSL_TARGET,
  winBy: 1,
  golden: OSL_GOLDEN,
  cap: OSL_TARGET,
  sideOut: false,
  switchAt: OSL_SWITCH_AT,
});

export type PairIndex = 0 | 1 | 2;
export const PAIR_LABELS = ["Pair A", "Pair B", "Pair C"] as const;
export const PAIR_RANGES = [
  `0–${OSL_GATE_1}`,
  `${OSL_GATE_1}–${OSL_GATE_2}`,
  `${OSL_GATE_2}–${OSL_TARGET}`,
] as const;

/** Which pair is on court, from the LEADING score (§3.2). */
export const oslPairIndex = (lead: number): PairIndex =>
  lead < OSL_GATE_1 ? 0 : lead < OSL_GATE_2 ? 1 : 2;

/** The rotation gate the leading score has reached, or 0 before the first. */
export const oslGateReached = (lead: number): 0 | 7 | 14 =>
  lead >= OSL_GATE_2 ? OSL_GATE_2 : lead >= OSL_GATE_1 ? OSL_GATE_1 : 0;

/** A rotation the referee has not yet confirmed. Scoring stays locked until
 *  they do — that is what keeps the app in step with the players on court. */
export function oslPendingRotation(lead: number, acked: number[] = [], over = false): 0 | 7 | 14 {
  if (over) return 0;
  const gate = oslGateReached(lead);
  if (!gate) return 0;
  return acked.includes(gate) ? 0 : gate;
}

/** Undoing points back below a gate re-arms that confirmation. */
export const oslPruneAcks = (lead: number, acked: number[] = []): number[] =>
  acked.filter((g) => lead >= g);

/** The playing-six slot indices for a pair: A = 0,1 · B = 2,3 · C = 4,5. */
export const oslPairSlots = (pair: PairIndex): [number, number] => [pair * 2, pair * 2 + 1];

/* ---------- line-up legality (§3.1, §3.2) ---------- */

export type Gender = "M" | "F";
export type LineupPlayer = { id: string; name: string; gender: Gender };

/** Returns the reasons a playing six is illegal; empty means legal. */
export function oslLineupIssues(six: (LineupPlayer | null)[]): string[] {
  const out: string[] = [];
  const filled = six.filter(Boolean) as LineupPlayer[];
  if (filled.length < 6) return ["Pick all six players"];
  if (new Set(filled.map((p) => p.id)).size !== 6) out.push("A player is listed twice");
  if (!filled.some((p) => p.gender === "F")) {
    out.push("At least one woman must be in the playing six");
  }
  for (const pair of [0, 1, 2] as PairIndex[]) {
    const [i, j] = oslPairSlots(pair);
    if (six[i]?.gender === "F" && six[j]?.gender === "F") {
      out.push(`${PAIR_LABELS[pair]} is two women — each woman needs a male partner`);
    }
  }
  return out;
}

/* ---------- championship (§2.3) ---------- */

/** Every rank scores. Racket sports carry the higher table; the board games sit
 *  deliberately close so they stay worth winning (§2.3). */
export const OSL_POINTS = {
  racket: [1000, 900, 800, 700, 600, 500, 400, 300],
  board: [800, 700, 600, 500, 400, 300, 200, 100],
} as const;

export const OSL_RACKET_SPORTS: SportId[] = ["pb", "bd", "tt"];
export const OSL_BOARD_SPORTS: SportId[] = ["cr", "ch"];
export const OSL_SPORTS: SportId[] = [...OSL_RACKET_SPORTS, ...OSL_BOARD_SPORTS];

export const oslPointsTable = (sport: SportId): readonly number[] =>
  OSL_RACKET_SPORTS.includes(sport) ? OSL_POINTS.racket : OSL_POINTS.board;

/** Championship points a team earns for finishing `rank` (1-based) in a sport. */
export function oslPointsFor(sport: SportId, rank: number): number {
  const table = oslPointsTable(sport);
  return rank >= 1 && rank <= table.length ? table[rank - 1] : 0;
}

/** Maximum possible haul: top all five sports (3×1000 + 800 + 800). */
export const OSL_MAX_POINTS = OSL_SPORTS.reduce((s, sp) => s + oslPointsFor(sp, 1), 0);

export type SportRanking = { sport: SportId; order: string[]; provisional: boolean };

export type ChampionshipCell = { rank: number | null; points: number; provisional: boolean };
export type ChampionshipRow = {
  teamId: string;
  cells: Record<string, ChampionshipCell>;
  total: number;
  firsts: number;
  seconds: number;
};

/**
 * Championship board across all five sports.
 *
 * §2.5 tie-break: highest total, then most 1st places, then most 2nds, and on
 * down the ranks. Head-to-head and drawing of lots are committee matters and
 * are not decided here — `seedOrder` breaks any remaining tie deterministically
 * so the board never renders in a random order.
 */
export function oslChampionship(
  teamIds: string[],
  rankings: SportRanking[],
  seedOrder: string[] = teamIds,
): { rows: ChampionshipRow[]; provisional: boolean } {
  const byId = new Map(rankings.map((r) => [r.sport, r]));

  const rows: ChampionshipRow[] = teamIds.map((teamId) => {
    const cells: Record<string, ChampionshipCell> = {};
    let total = 0;
    for (const sport of OSL_SPORTS) {
      const r = byId.get(sport);
      const idx = r ? r.order.indexOf(teamId) : -1;
      const rank = idx < 0 ? null : idx + 1;
      const points = rank ? oslPointsFor(sport, rank) : 0;
      cells[sport] = { rank, points, provisional: r?.provisional ?? true };
      total += points;
    }
    const rankCount = (n: number) => OSL_SPORTS.filter((s) => cells[s].rank === n).length;
    return { teamId, cells, total, firsts: rankCount(1), seconds: rankCount(2) };
  });

  const seedIdx = (id: string) => {
    const i = seedOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };

  rows.sort((x, y) => {
    if (y.total !== x.total) return y.total - x.total;
    if (y.firsts !== x.firsts) return y.firsts - x.firsts;
    if (y.seconds !== x.seconds) return y.seconds - x.seconds;
    // §2.5 continues "then most 3rd places, then 4th, and so on down the ranks"
    for (let rank = 3; rank <= 8; rank++) {
      const cx = OSL_SPORTS.filter((s) => x.cells[s].rank === rank).length;
      const cy = OSL_SPORTS.filter((s) => y.cells[s].rank === rank).length;
      if (cy !== cx) return cy - cx;
    }
    return seedIdx(x.teamId) - seedIdx(y.teamId);
  });

  return { rows, provisional: rows.some((r) => OSL_SPORTS.some((s) => r.cells[s].provisional)) };
}

/* ---------- 5th–8th placement (§2.7) ---------- */

export type GroupRecord = { teamId: string; wins: number; pointsFor: number; pointsAgainst: number };

/**
 * §2.7 — the four teams that miss the semi-finals sit in two different groups
 * and have not played each other, so they are ranked by comparing group-stage
 * records: 5th & 6th are the two 3rd-placed teams, 7th & 8th the two 4th-placed.
 * Within each pair: more wins, then better point difference, then more points
 * scored, then drawing of lots (here, seed order — deterministic, not random).
 */
export function oslPlaceByRecord(records: GroupRecord[], seedOrder: string[] = []): string[] {
  const seedIdx = (id: string) => {
    const i = seedOrder.indexOf(id);
    return i < 0 ? Number.MAX_SAFE_INTEGER : i;
  };
  return [...records]
    .sort((x, y) => {
      if (y.wins !== x.wins) return y.wins - x.wins;
      const dx = x.pointsFor - x.pointsAgainst;
      const dy = y.pointsFor - y.pointsAgainst;
      if (dy !== dx) return dy - dx;
      if (y.pointsFor !== x.pointsFor) return y.pointsFor - x.pointsFor;
      return seedIdx(x.teamId) - seedIdx(y.teamId);
    })
    .map((r) => r.teamId);
}
