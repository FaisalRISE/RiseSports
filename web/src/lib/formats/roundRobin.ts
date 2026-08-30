/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Round-robin fixture generation.
 *
 * Ported from app.source.js:601-640 (genRR, schedNoBB). Used by every group
 * format — Pickleboss groups, OSL groups, and a plain league. */

export type Pairing = [number, number];

/**
 * Every team plays every other once, by the circle method: fix team 0 and
 * rotate the rest. An odd count gets a ghost team, and the pairing against the
 * ghost is dropped — that team simply sits out that round.
 */
export function roundRobin(n: number): Pairing[][] {
  if (n < 2) return [];
  const size = n % 2 === 0 ? n : n + 1;
  const rounds: Pairing[][] = [];
  const seats = Array.from({ length: size }, (_, i) => i);

  for (let r = 0; r < size - 1; r++) {
    const round: Pairing[] = [];
    for (let i = 0; i < size / 2; i++) {
      const a = seats[i];
      const b = seats[size - 1 - i];
      if (a < n && b < n) round.push([a, b]); // drop pairings against the ghost
    }
    rounds.push(round);
    seats.splice(1, 0, seats.pop()!);         // rotate all but the first seat
  }
  return rounds;
}

/**
 * Reorder rounds so as few teams as possible play in consecutive rounds.
 *
 * Greedy: repeatedly take the round sharing fewest players with the one just
 * scheduled. It is what stops a pair being sent straight back on court, which
 * on a real match day is the difference between a schedule people can play and
 * one they complain about.
 */
export function spreadRounds(rounds: Pairing[][]): Pairing[][] {
  const remaining = [...rounds];
  const out: Pairing[][] = [];
  let previous = new Set<number>();

  while (remaining.length) {
    let bestIdx = 0;
    let bestOverlap = Infinity;
    for (let i = 0; i < remaining.length; i++) {
      const players = new Set(remaining[i].flat());
      let overlap = 0;
      for (const p of players) if (previous.has(p)) overlap++;
      if (overlap < bestOverlap) {
        bestOverlap = overlap;
        bestIdx = i;
      }
      if (overlap === 0) break; // cannot do better
    }
    const chosen = remaining.splice(bestIdx, 1)[0];
    out.push(chosen);
    previous = new Set(chosen.flat());
  }
  return out;
}

/** Split entrants into `count` groups, snaking so the seeds spread evenly. */
export function splitIntoGroups<T>(entrants: T[], count: number): T[][] {
  if (count < 1) return [entrants];
  const groups: T[][] = Array.from({ length: count }, () => []);
  entrants.forEach((e, i) => {
    const row = Math.floor(i / count);
    /* Snake: left to right, then right to left, so group A does not collect
       every top seed. */
    const col = row % 2 === 0 ? i % count : count - 1 - (i % count);
    groups[col].push(e);
  });
  return groups;
}

export const GROUP_KEYS = "ABCDEFGH".split("");
