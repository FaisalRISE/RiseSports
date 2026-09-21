/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

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
  /** DUPR is a PICKLEBALL rating. Only a sport marked here asks for one, shows
      one or accepts a DUPR limit (Faisal, 2026-09-21). */
  dupr?: boolean;
  skills: string[];
  tags: string[];
};

export const DEFAULT_SPORT: SportId = "pb";

export const SPORTS: Record<SportId, Sport> = {
  pb: {
    id: "pb", name: "Pickleball", emoji: "\u{1F3D3}", court: "court", dupr: true,
    playersPerCourt: 4, targets: [11, 15, 21], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 11, winBy: 2, cap: null, golden: null }, serveModel: "sideout",
    skills: ["Serve", "Return", "Dink", "Drive", "Volley", "Drop Shot", "Lob", "Positioning", "Smash", "Reset", "Poach", "Backhand", "Speed Ups"],
    tags: ["Spin Server", "Power Player", "Dink Master", "Net Rusher", "Lob Specialist", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Hands", "Soft Game", "Hard Hitter", "Great Partner", "Court General", "Comeback Artist"],
  },
  bd: {
    id: "bd", name: "Badminton", emoji: "\u{1F3F8}", court: "court",
    playersPerCourt: 4, targets: [15, 21, 30], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 21, winBy: 2, cap: 30, golden: 29 }, serveModel: "rally",
    skills: ["Serve", "Return", "Clear", "Drop", "Smash", "Net Kill", "Drive", "Lift", "Defence", "Footwork", "Deception", "Backhand", "Positioning"],
    tags: ["Big Smash", "Net Killer", "Deceptive", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Tireless", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback Artist"],
  },
  tt: {
    id: "tt", name: "Table Tennis", emoji: "\u{1F3D3}", court: "table",
    playersPerCourt: 4, targets: [11, 21], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 11, winBy: 2, cap: null, golden: null }, serveModel: "alt2",
    skills: ["Serve", "Return", "Topspin", "Backspin", "Block", "Smash", "Loop", "Push", "Flick", "Footwork", "Placement", "Backhand", "Spin Reading"],
    tags: ["Spin Server", "Looper", "Blocker", "Chopper", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Table General", "Comeback Artist"],
  },
  pd: {
    id: "pd", name: "Padel", emoji: "\u{1F3BE}", court: "court",
    playersPerCourt: 4, targets: [], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: null, setBased: true, serveModel: "games",
    skills: ["Serve", "Return", "Volley", "Bandeja", "Vibora", "Smash", "Wall Play", "Lob", "Drop", "Positioning", "Defence", "Backhand", "Court Coverage"],
    tags: ["Big Smash", "Wall Master", "Bandeja Specialist", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback Artist"],
  },
  tn: {
    id: "tn", name: "Tennis", emoji: "\u{1F3BE}", court: "court",
    playersPerCourt: 4, targets: [], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: null, setBased: true, serveModel: "games",
    skills: ["Serve", "Return", "Forehand", "Backhand", "Volley", "Smash", "Slice", "Topspin", "Drop Shot", "Lob", "Footwork", "Positioning", "Mental"],
    tags: ["Big Server", "Baseliner", "Serve & Volley", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback Artist"],
  },
  cr: {
    id: "cr", name: "Carrom", emoji: "\u{1F7E4}", court: "board", board: true,
    playersPerCourt: 4, targets: [21, 25, 29], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 25, winBy: 1, cap: null, golden: null }, serveModel: "turns",
    skills: ["Strike", "Thumb Shot", "Cut", "Rebound", "Board Control", "Queen Cover", "Defence", "Placement", "Angles", "Break", "Consistency", "Pocketing", "Focus"],
    tags: ["Sharp Shooter", "Queen Hunter", "Thumb Specialist", "Defender", "Steady Hand", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Break", "Soft Touch", "Power Striker", "Great Partner", "Board General", "Comeback Artist"],
  },
  ch: {
    id: "ch", name: "Chess", emoji: "\u{265F}", court: "board", board: true,
    playersPerCourt: 2, targets: [1], formats: ["gn", "ms", "ws"],
    scoring: { target: 1, winBy: 1, cap: null, golden: null }, serveModel: "turns", draws: true,
    skills: ["Openings", "Tactics", "Endgame", "Calculation", "Positional", "Time Management", "Defence", "Attack", "Pawn Structure", "Piece Activity", "Prophylaxis", "Conversion", "Composure"],
    tags: ["Opening Prep", "Tactician", "Endgame Grinder", "Blitz Specialist", "Solid", "Wall", "Consistent", "Clutch Player", "Positional", "Fast Calculator", "Quiet Mover", "Attacker", "Great Sport", "Board General", "Comeback Artist"],
  },
};

export const SPORT_IDS = Object.keys(SPORTS) as SportId[];

/** A record written before the multi-sport rebrand has no sport field; treat it
 *  as pickleball. Accepts a sport id or any record carrying a `.sport`. */
export function sportOf(x?: SportId | { sport?: SportId | null } | null): Sport {
  const id = (typeof x === "string" ? x : x?.sport) ?? DEFAULT_SPORT;
  return SPORTS[id as SportId] ?? SPORTS[DEFAULT_SPORT];
}

/**
 * Whether this sport has any business with a DUPR. DUPR is a pickleball
 * rating: in a badminton event the box invited a number that would then SEED
 * the player's badminton rating from their pickleball level, and a DUPR limit
 * on a badminton category would judge badminton players on pickleball. So
 * outside pickleball there is no DUPR box, no DUPR limit, no DUPR column —
 * and the server drops one that arrives anyway, because a form is only one of
 * a Server Action's callers.
 */
export const usesDupr = (x?: Parameters<typeof sportOf>[0]): boolean => !!sportOf(x).dupr;

export const skillsFor = (x?: Parameters<typeof sportOf>[0]) => sportOf(x).skills;
export const tagsFor = (x?: Parameters<typeof sportOf>[0]) => sportOf(x).tags;

/* Two tags were renamed on 2026-09-15, before endorsements became visible
 * anywhere but one profile card — which was the last moment it was cheap.
 *
 *   "Serial Lobber"  -> "Lob Specialist"   "serial" is how you describe an
 *                                          offender; repeated lobbing is a
 *                                          standing rec-play grievance, and
 *                                          this was about to be pinned next to
 *                                          real names on a public list.
 *   "Comeback King"  -> "Comeback Artist"  the only gendered noun in all seven
 *                                          vocabularies, on an app with a
 *                                          Women filter.
 *
 * Rows store the tag TEXT, so `drizzle/0015` rewrites the ones already saved.
 * This map is kept so a row written by an older deploy still reads correctly.
 */
export const RENAMED_TAGS: Record<string, string> = {
  "Serial Lobber": "Lob Specialist",
  "Comeback King": "Comeback Artist",
};

export const canonicalTag = (tag: string): string => RENAMED_TAGS[tag] ?? tag;
export const formatsFor = (x?: Parameters<typeof sportOf>[0]) => sportOf(x).formats;

/** Rating keys are sport-namespaced so ratings never bleed between sports. */
export const ratingKey = (sport: SportId | null | undefined, format: string) =>
  `${sport ?? DEFAULT_SPORT}:${format}`;

/* The format codes in words. Lived as a private helper inside the tournament
   ratings page until the roster grew a format filter and needed the same six
   strings — which is the moment two copies start drifting. */
export const FORMAT_LABELS: Record<string, string> = {
  ms: "Men's singles",
  ws: "Women's singles",
  md: "Men's doubles",
  wd: "Women's doubles",
  mx: "Mixed doubles",
  gn: "Open",
};

export const formatLabel = (format: string): string => FORMAT_LABELS[format] ?? "Open";
