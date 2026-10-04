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
import { endingFor, type Ending } from "@/lib/scoring/final";
import { sportOf } from "@/lib/sports/registry";
import type { Match, MatchRules, Outcome, Tournament } from "@/lib/db/schema";

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
  /** The typed result, when there is one — the replayed `a`/`b` above are the
   *  rally log's, which a typed match does not have. */
  typedScore: { a: number; b: number } | null;
  /** Why a typed result moves no rating, when it does not. */
  outcome: Outcome | null;
  /** How long the match has taken so far. Plain accumulated milliseconds, safe
   *  to hand the browser — see lib/scoring/timing.ts for why it is never a
   *  clock reading. */
  timing: Timing | null;
  osl: OslView | null;
};

type ScoringOf = Pick<Tournament, "sport" | "format" | "scoring">;
/** Anything that may carry a match's frozen scoring. */
type RulesCarrier = Partial<Pick<Match, "rules">> | null | undefined;

const presetOf = (t: Pick<Tournament, "format">) =>
  t.format === "osl" ? oslRuleOverrides()
  : t.format === "pickleboss" ? picklebossRuleOverrides()
  : null;

/** A carrom event played over a set number of boards stores how many in its
 *  scoring (`{ boards: 8 }`); every other event has none. */
export function boardsOf(scoring: unknown): number | null {
  const n = Number((scoring as { boards?: unknown } | null)?.boards);
  return Number.isInteger(n) && n >= 1 && n <= 99 ? n : null;
}

/**
 * The event's scoring as it stands TODAY, in the shape a match freezes it in:
 * the format's preset if it has one, else the organiser's own settings, else
 * the sport's.
 */
export function eventRules(t: ScoringOf): MatchRules {
  const preset = presetOf(t);
  return {
    rules: resolveRules(t.sport, (preset ?? t.scoring ?? undefined) as never),
    boards: t.sport === "cr" && !preset ? boardsOf(t.scoring) : null,
  };
}

/**
 * The scoring a match is judged by: the one it FINISHED under, if it has, else
 * the event's today.
 *
 * Faisal, 2026-09-29: changing the scoring applies to every match not yet
 * finished — including one being played — and finished results stand. So a
 * match is frozen the moment it first has a result (`writeResult` stamps
 * `matches.rules`), and a change of the event's rules after that cannot reopen
 * it: an 11–7 played to 11 would otherwise stop being over when the event
 * moved to 15, and drop out of the table and the podium. The freeze stays while
 * the match has any play, so an undo that reopens a finished game corrects it
 * under the rules it was played to.
 */
export function matchRules(t: ScoringOf, m?: RulesCarrier): MatchRules {
  return (m?.rules as MatchRules | null | undefined) ?? eventRules(t);
}

/** The point rules for this match (see `matchRules`), or for the event today
 *  when no match is given. Null for a sport the point engine does not score. */
export function rulesFor(t: ScoringOf, m?: RulesCarrier): Rules | null {
  return matchRules(t, m).rules;
}

/** What kind of final this match has — one game, sets, boards… — judged by
 *  the scoring it is played under. The ONE way to ask, so the table, the
 *  rating and the typed-result check cannot read one match two ways. */
export function endingOf(t: ScoringOf, m?: RulesCarrier): Ending {
  const s = matchRules(t, m);
  return endingFor(t.sport, s.rules, { carromBoards: s.boards != null });
}

/**
 * Why this match has no live court, or null when it has one.
 *
 * The referee console counts points. Tennis and padel are scored in games and
 * sets, and carrom over a set number of boards ends when the boards run out,
 * which a point count cannot see — so those are typed in, and the console says
 * so instead of offering a court that cannot finish them.
 */
export function noLiveCourt(t: ScoringOf, m?: RulesCarrier): { title: string; body: string } | null {
  const s = matchRules(t, m);
  const e = endingOf(t, m);
  const sport = sportOf(t.sport).name;
  if (e.kind === "sets" || !s.rules) {
    return {
      title: `No live court for ${sport.toLowerCase()}`,
      body: `${sport} is scored in sets, so this match is recorded by typing its result: the games in each set, like 6–4 3–6 10–8. Typing a result in is not on the manage screen yet.`,
    };
  }
  if (e.kind === "boards" && e.target === null) {
    return {
      title: `No live court for a match over ${s.boards} boards`,
      body: `This match ends after ${s.boards} boards, and the court counts points, not boards — so its final score is typed in. Typing a result in is not on the manage screen yet.`,
    };
  }
  return null;
}

/**
 * A knockout match whose slots are not filled yet has nobody to score — or to
 * rate: scored anyway, it finished with no rating, and filling the slots later
 * could not give it one. So the court waits for both teams, the same rule
 * `recordResult` keeps for a typed result.
 *
 * The words say what actually unlocks it. The slots are filled by the
 * organiser's "Fill resolved slots", not by the feeders finishing: a referee
 * told to wait for matches already over had nothing to wait for. ONE sentence,
 * for the score page and for every action that refuses a rally.
 */
export function teamsNotIn(m: Pick<Match, "teamAId" | "teamBId">): { title: string; body: string } | null {
  if (m.teamAId && m.teamBId) return null;
  return {
    title: "The teams aren't in this match yet",
    body: "It can be scored once both teams are in it. When the matches feeding it have finished, the organiser fills them in with “Fill resolved slots” on the manage screen.",
  };
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
     Partial<Pick<Match, "timing" | "rules" | "outcome">>,
): MatchView {
  const rules = rulesFor(t, m);
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
    typedScore: m.typedScoreA != null && m.typedScoreB != null ? { a: m.typedScoreA, b: m.typedScoreB } : null,
    outcome: m.outcome ?? null,
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
export function describeCourt(t: Pick<Tournament, "sport" | "format" | "scoring">, m?: RulesCarrier): CourtNotes | null {
  const r = rulesFor(t, m);
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
