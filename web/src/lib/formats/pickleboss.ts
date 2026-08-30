/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Pickleboss — the format behind the "Friyayy" events.
 *
 * Groups A–F, five or six pairs each, one court per group, round robin inside
 * the group, then a knockout seeded from the group placings.
 *
 * The scoring is already expressible with the shared engine: to 15, win by 2,
 * with the two-point rule stopping at 17 so the 18th point is a golden point
 * and no score can pass 18. That is exactly what buildScoring(15, true, 17)
 * produces, so this module supplies the preset rather than a second engine.
 *
 * Reference: the standalone app at faisalrise.github.io/Pickelball
 * (index.html:475-478 for the scoring, :553-565 for the table).
 */

import { buildScoring, type RuleOverrides } from "@/lib/scoring/rules";
import { PICKLEBOSS_TIEBREAK } from "@/lib/standings";
import { GROUP_KEYS, roundRobin, spreadRounds, splitIntoGroups, type Pairing } from "./roundRobin";

export const PICKLEBOSS_TARGET = 15;
export const PICKLEBOSS_GOLDEN = 17;
export const PICKLEBOSS_CAP = 18;

/** To 15, win by 2, two-point rule stopping at 17, cap 18.
 *
 *  buildScoring deliberately does NOT return `target` — in the legacy app the
 *  target travels separately as the tournament's `pointsToWin`, and resolveRules
 *  merges the two. A preset has to supply it explicitly or the sport default
 *  (11 for pickleball) silently wins. */
export const picklebossRuleOverrides = (): RuleOverrides => ({
  target: PICKLEBOSS_TARGET,
  ...buildScoring(PICKLEBOSS_TARGET, true, PICKLEBOSS_GOLDEN, null, "rally"),
});

export const PICKLEBOSS_TIEBREAK_CHAIN = PICKLEBOSS_TIEBREAK;

export type GroupPlan<T> = {
  key: string;
  /** Court label, e.g. "Court Three" — one court per group is the whole point. */
  court: string | null;
  entrants: T[];
  /** Fixtures as index pairs into `entrants`, grouped by round. */
  rounds: Pairing[][];
};

/**
 * Draw `entrants` into groups and generate each group's fixtures.
 *
 * Groups are snaked so the strong pairs do not all land in group A, and each
 * group's rounds are spread so a pair rarely plays twice in a row.
 */
export function planGroups<T>(
  entrants: T[],
  groupCount: number,
  courts: string[] = [],
): GroupPlan<T>[] {
  const drawn = splitIntoGroups(entrants, groupCount);
  return drawn.map((members, i) => ({
    key: GROUP_KEYS[i] ?? String(i + 1),
    court: courts[i] ?? null,
    entrants: members,
    rounds: spreadRounds(roundRobin(members.length)),
  }));
}

/**
 * The standard knockout draw from group placings: winners and runners-up,
 * cross-paired so two teams from the same group meet as late as possible.
 * Returns seed references (see lib/brackets), not team ids — the slots fill
 * themselves as the groups finish.
 */
export function knockoutRefsFromGroups(groupCount: number, qualifyPerGroup = 2): [string, string][] {
  const keys = GROUP_KEYS.slice(0, groupCount);
  if (qualifyPerGroup < 1) return [];

  const winners = keys.map((k) => `${k}1`);
  const runnersUp = keys.map((k) => `${k}2`);

  /* A1 v B2, B1 v A2 — the OSL semi-final shape, generalised: a group winner
     meets a different group's runner-up. */
  if (qualifyPerGroup === 2) {
    return winners.map((w, i) => [w, runnersUp[(i + 1) % runnersUp.length]] as [string, string]);
  }
  const flat = keys.flatMap((k) => Array.from({ length: qualifyPerGroup }, (_, r) => `${k}${r + 1}`));
  const out: [string, string][] = [];
  for (let i = 0; i < Math.floor(flat.length / 2); i++) out.push([flat[i], flat[flat.length - 1 - i]]);
  return out;
}
