/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Derived match state, computed on the SERVER.
 *
 * This module is the reason the rewrite exists: the scoring rules, the rotation
 * logic and the championship maths run here and are never shipped to the
 * browser. The client receives numbers and names, not the engine that produced
 * them. */

import { resolveRules, type Rules } from "@/lib/scoring/rules";
import { replayRallies, type ReplayState, type Side } from "@/lib/scoring/replay";
import { picklebossRuleOverrides } from "@/lib/formats/pickleboss";
import { TIEBREAKS, type ComparatorName } from "@/lib/standings";
import {
  oslRuleOverrides, oslPairIndex, oslPendingRotation, oslPairSlots,
  PAIR_LABELS, PAIR_RANGES, OSL_SWITCH_SECONDS, type PairIndex,
} from "@/lib/formats/osl";
import type { Match, Tournament } from "@/lib/db/schema";

export type OslView = {
  pair: PairIndex;
  pairLabel: string;
  pairRange: string;
  /** Rotation gate awaiting the referee's confirmation; 0 when clear. */
  pendingGate: 0 | 7 | 14;
  /** True when the pending gate is also the change of ends (Rules 5.6). */
  pendingIsEndsChange: boolean;
  switchSeconds: number;
  slots: [number, number];
  endsChanged: boolean;
};

export type MatchView = ReplayState & {
  matchId: string;
  /** Locked while a rotation is unconfirmed or the match is finished. */
  locked: boolean;
  rev: number;
  typed: boolean;
  osl: OslView | null;
};

/** Scoring overrides for a tournament's declared format, falling back to any
 *  per-tournament overrides the organiser set. */
export function rulesFor(t: Pick<Tournament, "sport" | "format" | "scoring">): Rules | null {
  const preset =
    t.format === "osl" ? oslRuleOverrides()
    : t.format === "pickleboss" ? picklebossRuleOverrides()
    : null;
  const overrides = preset ?? (t.scoring ?? undefined);
  return resolveRules(t.sport, overrides as never);
}

/** The tie-break chain a format's tables are sorted by. They genuinely differ:
 *  see lib/standings for why this cannot be one hardcoded order. */
export function tieBreakFor(t: Pick<Tournament, "format">): ComparatorName[] {
  return TIEBREAKS[t.format] ?? TIEBREAKS.standard;
}

/** Draws are only meaningful where the sport allows them (chess, carrom). */
export const allowsDraws = (sport: string): boolean => sport === "ch" || sport === "cr";

export function viewMatch(
  t: Pick<Tournament, "sport" | "format" | "scoring">,
  m: Pick<Match, "id" | "log" | "server" | "posA" | "posB" | "ackedGates" | "rev" | "typedScoreA" | "typedScoreB">,
): MatchView {
  const rules = rulesFor(t);
  const state = replayRallies(
    { log: m.log as Side[], server: m.server, posA: m.posA as 0 | 1, posB: m.posB as 0 | 1 },
    rules,
  );

  let osl: OslView | null = null;
  if (t.format === "osl") {
    const lead = Math.max(state.a, state.b);
    const pair = oslPairIndex(lead);
    const pendingGate = oslPendingRotation(lead, m.ackedGates ?? [], state.over);
    osl = {
      pair,
      pairLabel: PAIR_LABELS[pair],
      pairRange: PAIR_RANGES[pair],
      pendingGate,
      pendingIsEndsChange: pendingGate === 14,
      switchSeconds: OSL_SWITCH_SECONDS,
      slots: oslPairSlots(pair),
      endsChanged: lead >= 14,
    };
  }

  return {
    ...state,
    matchId: m.id,
    locked: state.over || (osl?.pendingGate ?? 0) > 0,
    rev: m.rev,
    typed: m.typedScoreA != null && m.typedScoreB != null,
    osl,
  };
}
