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
import { readTiming, type Timing } from "@/lib/scoring/timing";
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
  /** How long the match has taken so far. Plain accumulated milliseconds, safe
   *  to hand the browser — see lib/scoring/timing.ts for why it is never a
   *  clock reading. */
  timing: Timing | null;
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
  m: Pick<Match, "id" | "log" | "server" | "posA" | "posB" | "ackedGates" | "rev" | "typedScoreA" | "typedScoreB"> &
     Partial<Pick<Match, "timing">>,
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
    timing: m.timing ? readTiming(m.timing) : null,
    osl,
  };
}

export type CourtNotes = {
  /** How the serve behaves, in the words a referee would use. */
  serve: string;
  /** How the game is won. */
  scoring: string;
};

/**
 * The court, explained in plain English.
 *
 * Computed HERE and handed down as two finished sentences, for the same reason
 * `goldenInfo` is: the resolved rules and the format presets do not ship. The
 * browser gets `LiteRules` for the three sports it can score offline, and for
 * OSL it gets nothing at all — so the console cannot write this itself without
 * either duplicating the rules or going blank on the format that needs the
 * explanation most.
 *
 * It is worth the round trip because misreading the service box is the mistake
 * a new referee actually makes: under side-out only the serving side can score,
 * so a rally won by the receivers moves the serve and leaves the score alone —
 * which looks like the app ignoring a tap.
 */
export function describeCourt(t: Pick<Tournament, "sport" | "format" | "scoring">): CourtNotes | null {
  const r = rulesFor(t);
  if (!r) return null;

  const serve = r.sideOut
    ? "Side-out scoring — only the serving side can score. Tap the half belonging to the side that won the rally. If the receiving side wins it, no point is scored and the serve moves on. The ball marks the server, who serves from the right whenever their own score is even, so partners swap sides each time they score."
    : "Rally scoring — every rally is a point, whoever served. Tap the half belonging to the side that won it. If the receiving side wins, the serve crosses with the point. The ball marks the server, who serves from the right whenever their own score is even.";

  const scoring =
    `Game to ${r.target}` +
    (r.winBy > 1 ? `, won by ${r.winBy} clear points` : ", sudden death") +
    (r.cap != null && r.golden != null
      ? `. The two-point rule stops at ${r.golden}: if both sides reach ${r.golden} the very next rally takes it, so no score can go past ${r.cap}.`
      : ".") +
    (r.switchAt ? ` Ends change at ${r.switchAt}.` : "");

  return { serve, scoring };
}
