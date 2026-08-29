/* Sports registry — ported from app.source.js:48-99.
 *
 * Everything sport-specific lives here. `scoring` and `serveModel` feed the
 * scoring engine. Tennis and padel are scored by games and sets rather than a
 * point target, so they carry setBased:true and scoring:null; the point engine
 * returns null for them rather than pretending to cover them.
 *
 * Rating keys are namespaced by sport ("pb:md", never bare "md") so a badminton
 * doubles rating can never be confused with a pickleball one. */

export type SportId = "pb" | "bd" | "tt" | "pd" | "tn" | "cr" | "ch";
export type ServeModel = "sideout" | "rally" | "alt2" | "turns" | "games";
export type CourtKind = "court" | "table" | "board";

export type ScoringBase = {
  target: number;
  winBy: number;
  cap: number | null;
  golden: number | null;
};

export type Sport = {
  id: SportId;
  name: string;
  emoji: string;
  court: CourtKind;
  board?: boolean;
  playersPerCourt: number;
  targets: number[];
  formats: string[];
  scoring: ScoringBase | null;
  setBased?: boolean;
  serveModel: ServeModel;
  draws?: boolean;
  skills: string[];
  tags: string[];
};

export const DEFAULT_SPORT: SportId = "pb";

export const SPORTS: Record<SportId, Sport> = {
  pb: {
    id: "pb", name: "Pickleball", emoji: "\u{1F3D3}", court: "court",
    playersPerCourt: 4, targets: [11, 15, 21], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 11, winBy: 2, cap: null, golden: null }, serveModel: "sideout",
    skills: ["Serve", "Return", "Dink", "Drive", "Volley", "Drop Shot", "Lob", "Positioning", "Smash", "Reset", "Poach", "Backhand", "Speed Ups"],
    tags: ["Spin Server", "Power Player", "Dink Master", "Net Rusher", "Serial Lobber", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Hands", "Soft Game", "Hard Hitter", "Great Partner", "Court General", "Comeback King"],
  },
  bd: {
    id: "bd", name: "Badminton", emoji: "\u{1F3F8}", court: "court",
    playersPerCourt: 4, targets: [15, 21, 30], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 21, winBy: 2, cap: 30, golden: 29 }, serveModel: "rally",
    skills: ["Serve", "Return", "Clear", "Drop", "Smash", "Net Kill", "Drive", "Lift", "Defence", "Footwork", "Deception", "Backhand", "Positioning"],
    tags: ["Big Smash", "Net Killer", "Deceptive", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Tireless", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback King"],
  },
  tt: {
    id: "tt", name: "Table Tennis", emoji: "\u{1F3D3}", court: "table",
    playersPerCourt: 4, targets: [11, 21], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 11, winBy: 2, cap: null, golden: null }, serveModel: "alt2",
    skills: ["Serve", "Return", "Topspin", "Backspin", "Block", "Smash", "Loop", "Push", "Flick", "Footwork", "Placement", "Backhand", "Spin Reading"],
    tags: ["Spin Server", "Looper", "Blocker", "Chopper", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Table General", "Comeback King"],
  },
  pd: {
    id: "pd", name: "Padel", emoji: "\u{1F3BE}", court: "court",
    playersPerCourt: 4, targets: [], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: null, setBased: true, serveModel: "games",
    skills: ["Serve", "Return", "Volley", "Bandeja", "Vibora", "Smash", "Wall Play", "Lob", "Drop", "Positioning", "Defence", "Backhand", "Court Coverage"],
    tags: ["Big Smash", "Wall Master", "Bandeja Specialist", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback King"],
  },
  tn: {
    id: "tn", name: "Tennis", emoji: "\u{1F3BE}", court: "court",
    playersPerCourt: 4, targets: [], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: null, setBased: true, serveModel: "games",
    skills: ["Serve", "Return", "Forehand", "Backhand", "Volley", "Smash", "Slice", "Topspin", "Drop Shot", "Lob", "Footwork", "Positioning", "Mental"],
    tags: ["Big Server", "Baseliner", "Serve & Volley", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback King"],
  },
  cr: {
    id: "cr", name: "Carrom", emoji: "\u{1F7E4}", court: "board", board: true,
    playersPerCourt: 4, targets: [21, 25, 29], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 25, winBy: 1, cap: null, golden: null }, serveModel: "turns",
    skills: ["Strike", "Thumb Shot", "Cut", "Rebound", "Board Control", "Queen Cover", "Defence", "Placement", "Angles", "Break", "Consistency", "Pocketing", "Focus"],
    tags: ["Sharp Shooter", "Queen Hunter", "Thumb Specialist", "Defender", "Steady Hand", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Break", "Soft Touch", "Power Striker", "Great Partner", "Board General", "Comeback King"],
  },
  ch: {
    id: "ch", name: "Chess", emoji: "\u{265F}", court: "board", board: true,
    playersPerCourt: 2, targets: [1], formats: ["gn", "ms", "ws"],
    scoring: { target: 1, winBy: 1, cap: null, golden: null }, serveModel: "turns", draws: true,
    skills: ["Openings", "Tactics", "Endgame", "Calculation", "Positional", "Time Management", "Defence", "Attack", "Pawn Structure", "Piece Activity", "Prophylaxis", "Conversion", "Composure"],
    tags: ["Opening Prep", "Tactician", "Endgame Grinder", "Blitz Specialist", "Solid", "Wall", "Consistent", "Clutch Player", "Positional", "Fast Calculator", "Quiet Mover", "Attacker", "Great Sport", "Board General", "Comeback King"],
  },
};

export const SPORT_IDS = Object.keys(SPORTS) as SportId[];

/** A record written before the multi-sport rebrand has no sport field; treat it
 *  as pickleball. Accepts a sport id or any record carrying a `.sport`. */
export function sportOf(x?: SportId | { sport?: SportId | null } | null): Sport {
  const id = (typeof x === "string" ? x : x?.sport) ?? DEFAULT_SPORT;
  return SPORTS[id as SportId] ?? SPORTS[DEFAULT_SPORT];
}

export const skillsFor = (x?: Parameters<typeof sportOf>[0]) => sportOf(x).skills;
export const tagsFor = (x?: Parameters<typeof sportOf>[0]) => sportOf(x).tags;
export const formatsFor = (x?: Parameters<typeof sportOf>[0]) => sportOf(x).formats;

/** Rating keys are sport-namespaced so ratings never bleed between sports. */
export const ratingKey = (sport: SportId | null | undefined, format: string) =>
  `${sport ?? DEFAULT_SPORT}:${format}`;
