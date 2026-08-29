/* Scoring rules — ported from app.source.js:185-238.
 *
 * Serve models:
 *   sideout  Pickleball. Only the serving side scores. The opening service turn
 *            has one server, so the first fault sides out immediately.
 *   rally    Badminton. Every rally is a point.
 *   alt2     Table tennis. Serve changes every 2 points, and every point once
 *            both sides reach target-1.
 *   turns    Carrom / chess. Points only, no court geometry.
 *   games    Tennis / padel — scored by games and sets. resolveRules returns
 *            null for these; the point engine does not cover them. */

import { sportOf, type SportId, type ServeModel } from "@/lib/sports/registry";

export type ScoreType = "service" | "rally" | "";

export type RuleOverrides = Partial<{
  target: number | string | null;
  winBy: number | string | null;
  cap: number | null;
  golden: number | null;
  sideOut: boolean | undefined;
  switchAt: number | null;
}>;

export type Rules = {
  sport: SportId;
  target: number;
  winBy: number;
  cap: number | null;
  golden: number | null;
  /** Only the serving side scores. Overridable per tournament — plenty of clubs
   *  run rally scoring on a pickleball day to keep the schedule. */
  sideOut: boolean;
  /** Score at which the teams change ends. Carried from the tournament. */
  switchAt: number | null;
  serve: ServeModel;
  perCourt: number;
};

/** Returns null for set-based sports (tennis, padel) — they have no point engine. */
export function resolveRules(sportId?: SportId | null, over?: RuleOverrides | null): Rules | null {
  const sp = sportOf(sportId);
  const base = sp.scoring;
  if (!base) return null;

  const pick = <T,>(k: keyof RuleOverrides, d: T): T => {
    const v = over?.[k];
    return v !== undefined && v !== null && v !== "" ? (v as T) : d;
  };

  return {
    sport: sp.id,
    target: Number(pick("target", base.target)),
    winBy: Number(pick("winBy", base.winBy)),
    cap: pick<number | null>("cap", base.cap),
    golden: pick<number | null>("golden", base.golden),
    sideOut: pick<boolean>("sideOut", sp.serveModel === "sideout"),
    switchAt: pick<number | null>("switchAt", null),
    serve: sp.serveModel,
    perCourt: sp.playersPerCourt,
  };
}

/* Turn organiser controls into a scoring override.
   goldenAt is the score at which both sides being level means the next rally
   decides it; the cap sits one above. "none" means the two-point rule runs on
   with no ceiling — traditional, but it can strand a schedule. */
export function buildScoring(
  target: number | string,
  winBy2: boolean,
  goldenAt: number | "auto" | "none" | "" | null,
  switchAt: number | string | null,
  scoreType?: ScoreType,
): RuleOverrides {
  const t = Number(target) || 11;
  const base = {
    switchAt: Number(switchAt) || null,
    sideOut: scoreType === "service" ? true : scoreType === "rally" ? false : undefined,
  };
  /* Golden point: first to the target takes it, so the target point IS the
     golden point — there is no two-point rule to cap. */
  if (!winBy2) return { ...base, winBy: 1, golden: t - 1, cap: t };
  if (goldenAt === "none") return { ...base, winBy: 2, golden: null, cap: null };
  const g = goldenAt === "auto" || !goldenAt ? t + 2 : Number(goldenAt);
  return { ...base, winBy: 2, golden: g, cap: g + 1 };
}

/** One line of plain English describing how the game ends. */
export function goldenInfo(
  target: number | string,
  winBy2: boolean,
  goldenAt: number | "auto" | "none" | "" | null,
  scoreType?: ScoreType,
): string {
  const sc = buildScoring(target, winBy2, goldenAt, "", scoreType);
  const t = Number(target) || 11;
  const how =
    sc.sideOut === true ? "Service points — only the serving side scores. "
    : sc.sideOut === false ? "Rally scoring — every rally is a point. "
    : "";
  if (!winBy2) return `${how}First to ${t} takes it. At ${t - 1}–${t - 1} the next rally is the golden point.`;
  if (!sc.cap) return `${how}To ${t}, won by 2 clear points, with no ceiling — a tight game can run well past ${t}.`;
  return `${how}To ${t}, won by 2. The two-point rule stops at ${sc.golden}: if both sides reach ${sc.golden} the next rally is the golden point, so no score passes ${sc.cap}.`;
}
