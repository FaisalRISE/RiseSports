/* ---------- storage keys ----------
   Every localStorage key flows through lsKey(). The prefix changed from the old
   Pickle Rank "pr9_" to "rs_" at the RISE Sports rebrand, so migrate() copies
   the old keys across once and a returning browser keeps its data. It only
   ever writes when the new key is absent, and never deletes the old one, so
   running it twice is harmless. Safe to drop a release or two from now.

   NAMING: this helper must not be a single letter. It was called `K` briefly,
   which collided with the minified single-letter locals this file uses — the
   root component binds `K` as setCommunityGames (see RiseSports), so every
   load and every save silently went to a key named "undefined". Keep the name
   long enough that no local can shadow it. */
const PREFIX = "rs_", lsKey = n => PREFIX + n;
(function migrateLegacyKeys() {
  try {
    /* Builds between the rebrand and this fix wrote every store to a key
       literally named "undefined". Harmless but confusing; clear it out. */
    localStorage.getItem("undefined") !== null && localStorage.removeItem("undefined");
    if (localStorage.getItem(lsKey("migrated"))) return;
    [
      "pl",
      "u",
      "t",
      "c",
      "r",
      "cg",
      "venues"
    ].forEach(n => {
      const old = localStorage.getItem("pr9_" + n);
      old !== null && localStorage.getItem(lsKey(n)) === null && localStorage.setItem(lsKey(n), old);
    });
    localStorage.setItem(lsKey("migrated"), "1");
  } catch (e) {
  }
})();
/* ---------- sports ----------
   Everything sport-specific lives here. The app was pickleball-only until the
   RISE Sports rebrand, so `DEFAULT_SPORT` is pickleball and every record
   without a `sport` field is treated as pickleball — see sportOf().

   scoring/serveModel feed the referee console. Tennis and padel are scored by
   games and sets rather than a point target, so they carry setBased:true and
   scoring:null; the point-based console does not cover them yet.

   Rating keys are namespaced by sport — "pb:md", not "md" — so a badminton
   doubles rating can never be confused with a pickleball one. rtg() reads the
   old flat keys too, so data written before the rebrand still resolves. */
const DEFAULT_SPORT = "pb", SPORTS = {
  pb: {
    id: "pb", name: "Pickleball", emoji: "\u{1F3D3}", court: "court",
    playersPerCourt: 4, targets: [11, 15, 21], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 11, winBy: 2, cap: null, golden: null }, serveModel: "sideout",
    skills: ["Serve", "Return", "Dink", "Drive", "Volley", "Drop Shot", "Lob", "Positioning", "Smash", "Reset", "Poach", "Backhand", "Speed Ups"],
    tags: ["Spin Server", "Power Player", "Dink Master", "Net Rusher", "Serial Lobber", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Hands", "Soft Game", "Hard Hitter", "Great Partner", "Court General", "Comeback King"]
  },
  bd: {
    id: "bd", name: "Badminton", emoji: "\u{1F3F8}", court: "court",
    playersPerCourt: 4, targets: [15, 21, 30], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 21, winBy: 2, cap: 30, golden: 29 }, serveModel: "rally",
    skills: ["Serve", "Return", "Clear", "Drop", "Smash", "Net Kill", "Drive", "Lift", "Defence", "Footwork", "Deception", "Backhand", "Positioning"],
    tags: ["Big Smash", "Net Killer", "Deceptive", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Tireless", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback King"]
  },
  tt: {
    id: "tt", name: "Table Tennis", emoji: "\u{1F3D3}", court: "table",
    playersPerCourt: 4, targets: [11, 21], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 11, winBy: 2, cap: null, golden: null }, serveModel: "alt2",
    skills: ["Serve", "Return", "Topspin", "Backspin", "Block", "Smash", "Loop", "Push", "Flick", "Footwork", "Placement", "Backhand", "Spin Reading"],
    tags: ["Spin Server", "Looper", "Blocker", "Chopper", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Table General", "Comeback King"]
  },
  pd: {
    id: "pd", name: "Padel", emoji: "\u{1F3BE}", court: "court",
    playersPerCourt: 4, targets: [], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: null, setBased: true, serveModel: "games",
    skills: ["Serve", "Return", "Volley", "Bandeja", "Vibora", "Smash", "Wall Play", "Lob", "Drop", "Positioning", "Defence", "Backhand", "Court Coverage"],
    tags: ["Big Smash", "Wall Master", "Bandeja Specialist", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback King"]
  },
  tn: {
    id: "tn", name: "Tennis", emoji: "\u{1F3BE}", court: "court",
    playersPerCourt: 4, targets: [], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: null, setBased: true, serveModel: "games",
    skills: ["Serve", "Return", "Forehand", "Backhand", "Volley", "Smash", "Slice", "Topspin", "Drop Shot", "Lob", "Footwork", "Positioning", "Mental"],
    tags: ["Big Server", "Baseliner", "Serve & Volley", "Retriever", "Fast Hands", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Feet", "Soft Touch", "Hard Hitter", "Great Partner", "Court General", "Comeback King"]
  },
  cr: {
    id: "cr", name: "Carrom", emoji: "\u{1F7E4}", court: "board", board: true,
    playersPerCourt: 4, targets: [21, 25, 29], formats: ["ms", "ws", "md", "wd", "mx", "gn"],
    scoring: { target: 25, winBy: 1, cap: null, golden: null }, serveModel: "turns",
    skills: ["Strike", "Thumb Shot", "Cut", "Rebound", "Board Control", "Queen Cover", "Defence", "Placement", "Angles", "Break", "Consistency", "Pocketing", "Focus"],
    tags: ["Sharp Shooter", "Queen Hunter", "Thumb Specialist", "Defender", "Steady Hand", "Wall", "Consistent", "Clutch Player", "Smart Placer", "Quick Break", "Soft Touch", "Power Striker", "Great Partner", "Board General", "Comeback King"]
  },
  ch: {
    id: "ch", name: "Chess", emoji: "\u{265F}", court: "board", board: true,
    playersPerCourt: 2, targets: [1], formats: ["gn", "ms", "ws"],
    scoring: { target: 1, winBy: 1, cap: null, golden: null }, serveModel: "turns", draws: true,
    skills: ["Openings", "Tactics", "Endgame", "Calculation", "Positional", "Time Management", "Defence", "Attack", "Pawn Structure", "Piece Activity", "Prophylaxis", "Conversion", "Composure"],
    tags: ["Opening Prep", "Tactician", "Endgame Grinder", "Blitz Specialist", "Solid", "Wall", "Consistent", "Clutch Player", "Positional", "Fast Calculator", "Quiet Mover", "Attacker", "Great Sport", "Board General", "Comeback King"]
  }
};
/* The RISE Sports wordmark, injected by build.js from brand/logo-inline.json.
   Returns null when the asset is absent (an un-built template, or a copy taken
   without the brand folder), so every caller falls back rather than rendering
   a broken image. Pass true for the inverted mark on a dark surface. */
const brandLogo = dark => {
  const b = typeof window !== "undefined" && window.RISE_LOGO;
  return b ? (dark ? b.wordmarkLight : b.wordmark) : null;
};

/* A record written before the rebrand has no sport field; treat it as pickleball. */
const sportOf = x => SPORTS[(x && (x.sport || x)) || DEFAULT_SPORT] || SPORTS[DEFAULT_SPORT],
  skillsFor = x => sportOf(x).skills,
  tagsFor = x => sportOf(x).tags,
  formatsFor = x => sportOf(x).formats,
  /* rating key: sport-namespaced, e.g. ratingKey("bd","md") -> "bd:md" */
  ratingKey = (sp, fmt) => (sp || DEFAULT_SPORT) + ":" + fmt,
  /* Read a rating. Prefers the namespaced key, falls back to the old flat key
     so pre-rebrand players still resolve, then to bestRating. */
  /* Strict: the rating in THIS format only, 0 if absent. Callers that filter
     on "> 0" to mean "plays this format" must use this, not rtg(). */
  rtgIn = (pl, fmt, sp) => {
    if (!pl) return 0;
    const r = pl.ratings || {};
    return r[ratingKey(sp || pl.sport || DEFAULT_SPORT, fmt)] ?? r[fmt] ?? 0;
  },
  /* Label a rating key for display: "bd:md" -> "Badminton Men's Doubles". */
  fmtLabel = k => {
    const p = String(k).split(":");
    if (p.length < 2) return FORMAT_LABELS[k] || k;
    return (SPORTS[p[0]] ? SPORTS[p[0]].name + " " : "") + (FORMAT_LABELS[p[1]] || p[1]);
  },
  rtg = (pl, fmt, sp) => {
    if (!pl) return 0;
    const r = pl.ratings || {};
    return r[ratingKey(sp || pl.sport || DEFAULT_SPORT, fmt)] ?? r[fmt] ?? pl.bestRating ?? 0;
  };

/* Rating keys were flat ("md") before the rebrand and are sport-namespaced
   ("pb:md") after it. Rewrite them in place. Not gated behind the migration
   flag: someone may import an old backup at any time, and once a map is
   namespaced this is a no-op, so running it every load is cheap and safe. */
(function migrateRatingKeys() {
  try {
    const raw = localStorage.getItem(lsKey("pl"));
    if (!raw) return;
    const pls = JSON.parse(raw);
    if (!Array.isArray(pls)) return;
    let touched = false;
    pls.forEach(p => {
      const r = p && p.ratings;
      if (!r) return;
      Object.keys(r).forEach(k => {
        if (k.indexOf(":") !== -1) return;
        const nk = DEFAULT_SPORT + ":" + k;
        r[nk] === undefined && (r[nk] = r[k]);
        delete r[k];
        touched = true;
      });
    });
    touched && localStorage.setItem(lsKey("pl"), JSON.stringify(pls));
  } catch (e) {
  }
})();
/* ---------- live scoring engine ----------
   The rally log is the single source of truth. m.log holds one entry per rally
   — "a" or "b", whoever WON it — and the score, serving side, player positions
   and service box are all DERIVED by replaying it from scratch.

   That design is the reason to keep it: undo is exact (drop the last entry),
   the displayed state can never drift out of step with the court, and only the
   log has to travel when two devices sync a match.

   Ported from Format/pickleboss-35split 12.html:855-874 and generalised so the
   sport's rules drive it instead of hardcoded constants.

   Serve models:
     sideout  Pickleball. ONLY THE SERVING SIDE SCORES. Losing a rally passes
              the serve to the partner, then across the net. The opening
              service turn of a game has only one server, so the first fault is
              an immediate side-out.
     rally    Badminton. Every rally is a point and the winner serves next.
     alt2     Table tennis. Every rally is a point; serve changes every 2
              points, and every point once both sides reach target-1.
     turns    Carrom / chess. Points only, no court geometry.
   Tennis and padel are scored by games and sets, so resolveRules returns null
   for them and this console does not cover them. */
const resolveRules = (sportId, over) => {
  const sp = sportOf(sportId), base = sp.scoring;
  if (!base) return null;                       // set-based sport: no point engine
  const pick = (k, d) => over && over[k] !== undefined && over[k] !== null && over[k] !== "" ? over[k] : d;
  return {
    sport: sp.id,
    target: Number(pick("target", base.target)),
    winBy: Number(pick("winBy", base.winBy)),
    cap: pick("cap", base.cap),
    golden: pick("golden", base.golden),
    /* Traditional pickleball is side-out; plenty of clubs run rally scoring to
       keep a day on schedule, so it stays overridable per tournament. */
    sideOut: pick("sideOut", sp.serveModel === "sideout"),
    /* Carried through from the tournament: the console draws the ends-change
       note from it, and it was silently dropped here, so the setting had no
       effect anywhere. */
    switchAt: pick("switchAt", null),
    serve: sp.serveModel,
    perCourt: sp.playersPerCourt
  };
};

/* Turn the CreateTab controls into a scoring override for resolveRules.
   goldenAt is the score at which both sides being level means the next rally
   decides it; the cap sits one above. "none" means the two-point rule runs on
   with no ceiling, which is the traditional rule but can strand a schedule. */
const buildScoring = (target, winBy2, goldenAt, switchAt, scoreType) => {
  const t = Number(target) || 11;
  const base = {
    switchAt: Number(switchAt) || null,
    /* "" means follow the sport's own convention; resolveRules treats an empty
       override as absent. Pickleball is traditionally service points, but many
       clubs run rally scoring to keep a day on schedule, so it is a choice. */
    sideOut: scoreType === "service" ? !0 : scoreType === "rally" ? !1 : void 0
  };
  /* Golden point: first to the target takes it, so the target point IS the
     golden point — there is no two-point rule to cap. */
  if (!winBy2) return { ...base, winBy: 1, golden: t - 1, cap: t };
  if (goldenAt === "none") return { ...base, winBy: 2, golden: null, cap: null };
  const g = goldenAt === "auto" || !goldenAt ? t + 2 : Number(goldenAt);
  return { ...base, winBy: 2, golden: g, cap: g + 1 };
};

/* One line of plain English describing the ending, shown under the controls. */
const goldenInfo = (target, winBy2, goldenAt, scoreType) => {
  const sc = buildScoring(target, winBy2, goldenAt, "", scoreType);
  const t = Number(target) || 11;
  const how = sc.sideOut === !0 ? "Service points — only the serving side scores. "
    : sc.sideOut === !1 ? "Rally scoring — every rally is a point. " : "";
  if (!winBy2) return `${ how }First to ${ t } takes it. At ${ t - 1 }–${ t - 1 } the next rally is the golden point.`;
  if (!sc.cap) return `${ how }To ${ t }, won by 2 clear points, with no ceiling — a tight game can run well past ${ t }.`;
  return `${ how }To ${ t }, won by 2. The two-point rule stops at ${ sc.golden }: if both sides reach ${ sc.golden } the next rally is the golden point, so no score passes ${ sc.cap }.`;
};

/* Decide whether a pair of typed score boxes is ready to commit.
   `pend` is what has been typed but not yet saved; anything absent falls back
   to the score already on the match, so editing one box of a finished match
   does not wipe the other. Returns null when the pair is not yet committable —
   half-typed, non-numeric, or a draw, none of which should raise an alert
   while someone is still mid-entry. */
const parseScorePair = (pend, match) => {
  const has = v => v !== void 0 && v !== null && v !== "";
  const prevA = match && match.played ? String(match.scoreA) : "";
  const prevB = match && match.played ? String(match.scoreB) : "";
  const av = has(pend && pend.a) ? pend.a : prevA;
  const bv = has(pend && pend.b) ? pend.b : prevB;
  if (!has(av) || !has(bv)) return null;
  const a = parseInt(av, 10), b = parseInt(bv, 10);
  if (isNaN(a) || isNaN(b) || a < 0 || b < 0 || a === b) return null;
  /* Unchanged is a no-op. Without this, blurring an already-scored match — or
     clearing a box and tabbing away, which falls back to the stored score —
     would re-commit it, and committing applies the rating change again. */
  if (match && match.played && a === match.scoreA && b === match.scoreB) return null;
  return { a, b };
};

const rallyOver = (a, b, r) => !!r && (
  ((a >= r.target || b >= r.target) && Math.abs(a - b) >= r.winBy) ||
  (r.cap != null && (a >= r.cap || b >= r.cap)));

/* Both sides one rally from the end with the win-by rule spent. */
const rallyGolden = (a, b, r) =>
  !!r && r.golden != null && a >= r.golden && b >= r.golden && !rallyOver(a, b, r);

/* Which sides would end the match by winning the next rally. Under side-out
   only the side holding serve can actually convert, so replayRallies filters
   this by the serving side. */
const rallyGamePoint = (a, b, r) => {
  if (!r || rallyOver(a, b, r)) return [];
  const out = [];
  rallyOver(a + 1, b, r) && out.push("a");
  rallyOver(a, b + 1, r) && out.push("b");
  return out;
};

/* Replay the log and return the full derived state.
   pos[team] = [index of the player standing RIGHT, index standing LEFT]. */
const replayRallies = (m, r) => {
  const log = (m && m.log) || [];
  const first = m && m.server === "b" ? "b" : "a";
  const pos = {
    a: m && m.posA === 1 ? [1, 0] : [0, 1],
    b: m && m.posB === 1 ? [1, 0] : [0, 1]
  };
  const other = t => (t === "a" ? "b" : "a");
  let a = 0, b = 0, serving = first, who = pos[first][0];
  /* The opening service turn has only one server, so it behaves as though the
     second server is already up: the first fault hands the serve straight over. */
  let serverNum = 2;

  log.forEach(w => {
    if (!r) return;
    if (r.sideOut) {
      if (w === serving) {
        serving === "a" ? a++ : b++;
        pos[serving] = [pos[serving][1], pos[serving][0]];   // partners swap, same server
      } else if (serverNum === 1 && r.perCourt > 2) {
        serverNum = 2;                                       // partner takes the second serve
        who = pos[serving][0] === who ? pos[serving][1] : pos[serving][0];
      } else {
        serving = w;                                         // side-out
        serverNum = 1;
        who = pos[serving][(serving === "a" ? a : b) % 2 === 0 ? 0 : 1];
      }
      return;
    }
    // rally scoring: every rally is a point
    const was = serving;
    w === "a" ? a++ : b++;
    if (r.serve === "alt2") {
      const total = a + b, deuce = a >= r.target - 1 && b >= r.target - 1;
      const turns = deuce ? total : Math.floor(total / 2);
      serving = turns % 2 === 0 ? first : other(first);
      who = pos[serving][0];
      return;
    }
    if (w === was) {
      pos[serving] = [pos[serving][1], pos[serving][0]];     // held serve: partners swap
    } else {
      serving = w;
      who = pos[serving][(serving === "a" ? a : b) % 2 === 0 ? 0 : 1];
    }
  });

  const over = rallyOver(a, b, r), gp = rallyGamePoint(a, b, r);
  return {
    a, b, serving, pos, serverIdx: who, serverNum,
    servePos: pos[serving][0] === who ? "R" : "L",
    rallies: log.length,
    over,
    winner: over ? (a > b ? "a" : "b") : null,
    golden: rallyGolden(a, b, r),
    gamePoint: r && r.sideOut ? gp.filter(t => t === serving) : gp
  };
};

/* Per-side and per-player splits from one walk of the log. teamPlayers maps
   "a"/"b" to an array of player ids in court order. Clutch counts rallies
   played once either side is within 3 of the target. */
const rallyStats = (m, r, teamPlayers) => {
  const log = (m && m.log) || [];
  if (!r) return null;
  const clutchFrom = Math.max(0, r.target - 3);
  const blank = () => ({ won: 0, lost: 0, serveWon: 0, serveLost: 0, clutchWon: 0, clutchLost: 0 });
  const out = { a: blank(), b: blank(), players: {} };
  const touch = id => (out.players[id] = out.players[id] || blank());
  const running = [];
  log.forEach(w => {
    const before = replayRallies({ ...m, log: running.slice() }, r);
    const lose = w === "a" ? "b" : "a";
    const clutch = before.a >= clutchFrom || before.b >= clutchFrom;
    out[w].won++; out[lose].lost++;
    if (clutch) { out[w].clutchWon++; out[lose].clutchLost++; }
    before.serving === w ? out[w].serveWon++ : out[before.serving].serveLost++;
    ((teamPlayers && teamPlayers[w]) || []).forEach(id => touch(id).won++);
    ((teamPlayers && teamPlayers[lose]) || []).forEach(id => touch(id).lost++);
    const srv = teamPlayers && teamPlayers[before.serving];
    if (srv && srv[before.serverIdx] !== undefined) {
      const sid = srv[before.serverIdx];
      before.serving === w ? touch(sid).serveWon++ : touch(sid).serveLost++;
    }
    running.push(w);
  });
  const pct = (won, lost) => (won + lost ? Math.round((won / (won + lost)) * 100) : null);
  out.a.serveHoldPct = pct(out.a.serveWon, out.a.serveLost);
  out.b.serveHoldPct = pct(out.b.serveWon, out.b.serveLost);
  Object.values(out.players).forEach(p => { p.serveHoldPct = pct(p.serveWon, p.serveLost); });
  return out;
};

/* ---------- match timer ----------
   Per Files for claude code/match-timing-spec.md (v2.0). Deliberately tiny:
   one record per match, no segmentation and no derived statistics.

   Elapsed time uses a MONOTONIC clock, never the difference between two
   wall-clock stamps — the spec calls this out because a device that sleeps,
   changes timezone or re-syncs its clock mid-match would otherwise report
   nonsense. Wall-clock is still recorded for the report, but never subtracted.

   Note for the post-event report: PLAYING TIME IS NOT SLOT TIME. Without that
   caveat an organiser reads "planned 24, actual 19" and shortens their slots,
   and the day then runs later than before. */
const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

const emptyTiming = () => ({
  startedAt: null, endedAt: null, playingMs: 0, pausedMs: 0,
  pauseCount: 0, mono: null, pauseMono: null, pauseReason: null
});

const timerStart = t => {
  const x = { ...(t || emptyTiming()) };
  if (x.startedAt) return x;                    // auto-starts on the first rally only
  x.startedAt = new Date().toISOString();
  x.mono = nowMs();
  return x;
};
const timerPause = (t, reason) => {
  const x = { ...(t || emptyTiming()) };
  if (!x.startedAt || x.endedAt || x.pauseMono != null) return x;
  x.pauseMono = nowMs();
  x.pauseCount = (x.pauseCount || 0) + 1;
  x.pauseReason = reason || "other";
  return x;
};
const timerResume = t => {
  const x = { ...(t || emptyTiming()) };
  if (x.pauseMono == null) return x;
  x.pausedMs = (x.pausedMs || 0) + (nowMs() - x.pauseMono);
  x.pauseMono = null;
  x.pauseReason = null;
  return x;
};
const timerStop = t => {
  const x = timerResume(t || emptyTiming());
  if (!x.startedAt || x.endedAt) return x;
  x.endedAt = new Date().toISOString();
  x.playingMs = Math.max(0, (x.mono != null ? nowMs() - x.mono : 0) - (x.pausedMs || 0));
  return x;
};
/* Live playing time, excluding any pause currently in progress. */
const timerElapsed = t => {
  if (!t || !t.startedAt) return 0;
  if (t.endedAt) return t.playingMs || 0;
  const paused = (t.pausedMs || 0) + (t.pauseMono != null ? nowMs() - t.pauseMono : 0);
  return Math.max(0, (t.mono != null ? nowMs() - t.mono : 0) - paused);
};
const fmtClock = ms => {
  const total = Math.floor(Math.max(0, ms) / 1000);
  return Math.floor(total / 60) + ":" + String(total % 60).padStart(2, "0");
};

const hideLoading = () => {
    const m = document.getElementById("loading-screen");
    m && (m.style.display = "none");
  }, {useState, useEffect, useMemo, useRef, useCallback} = React, C = {
    bg: "#eef1f6",
    surface: "#ffffff",
    card: "#ffffff",
    cardAlt: "#f1f4f9",
    border: "#e2e8f0",
    lime: "#65a30d",
    limeDark: "#4d7c0f",
    teal: "#0d9488",
    blue: "#2563eb",
    red: "#e11d48",
    orange: "#ea580c",
    purple: "#7c3aed",
    pink: "#db2777",
    gold: "#ca8a04",
    silver: "#64748b",
    bronze: "#92400e",
    text: "#0f172a",
    textMuted: "#475569",
    textDim: "#94a3b8",
    black: "#ffffff"
  }, ROLES = {
    ADMIN: {
      level: 4,
      label: "Admin",
      color: C.gold
    },
    ORGANIZER: {
      level: 2,
      label: "Organizer",
      color: C.blue
    },
    PLAYER: {
      level: 1,
      label: "Player",
      color: C.lime
    }
  }, TIERS = [
    {
      name: "Beginner",
      min: 0,
      max: 599,
      color: "#78716c",
      emoji: "\u2B1C"
    },
    {
      name: "Beginner+",
      min: 600,
      max: 749,
      color: "#a8a29e",
      emoji: "\uD83D\uDFEB"
    },
    {
      name: "Intermediate",
      min: 750,
      max: 899,
      color: C.bronze,
      emoji: "\uD83E\uDD49"
    },
    {
      name: "Intermediate+",
      min: 900,
      max: 1049,
      color: C.silver,
      emoji: "\uD83E\uDD48"
    },
    {
      name: "Advanced",
      min: 1050,
      max: 1199,
      color: C.blue,
      emoji: "\uD83D\uDD37"
    },
    {
      name: "Advanced+",
      min: 1200,
      max: 1349,
      color: C.purple,
      emoji: "\uD83D\uDC8E"
    },
    {
      name: "Pro",
      min: 1350,
      max: 1499,
      color: C.gold,
      emoji: "\uD83E\uDD47"
    },
    {
      name: "Pro+",
      min: 1500,
      max: 9999,
      color: C.lime,
      emoji: "\uD83D\uDC51"
    }
  ], SKILLS = SPORTS[DEFAULT_SPORT].skills, TAG_PRESETS = SPORTS[DEFAULT_SPORT].tags, getTier = m => TIERS.find(c => m >= c.min && m <= c.max) || TIERS[0], fp = m => `\u20B9${ m.toLocaleString("en-IN") }`, uid = () => `${ Date.now() }-${ Math.random().toString(36).slice(2, 7) }`, genId = (m, c, e) => {
    const d = e ? new Date(e).getFullYear().toString().slice(-2) : "00";
    return `${ m.trim().charAt(0).toUpperCase() + m.trim().slice(1).toLowerCase() }.${ c.trim().charAt(0).toUpperCase() + c.trim().slice(1).toLowerCase() }.${ d }`;
  }, getAge = m => m ? Math.floor((Date.now() - new Date(m).getTime()) / 31557600000) : null, FORMAT_LABELS = {
    ms: "Men's Singles",
    ws: "Women's Singles",
    md: "Men's Doubles",
    wd: "Women's Doubles",
    mx: "Mixed Doubles",
    gn: "Gender Neutral Doubles"
  }, FORMAT_RULES = {
    ms: {
      gender: "M",
      type: "singles"
    },
    ws: {
      gender: "F",
      type: "singles"
    },
    md: {
      gender: "M",
      type: "doubles",
      pairing: "same"
    },
    wd: {
      gender: "F",
      type: "doubles",
      pairing: "same"
    },
    mx: {
      gender: "MX",
      type: "doubles",
      pairing: "mixed"
    },
    gn: {
      gender: "GN",
      type: "doubles",
      pairing: "any"
    }
  };
function checkEligibility(m, c, e) {
  const d = [], r = (FORMAT_RULES[c.format] || {}).gender;
  if (r === "M" && m.gender !== "M" ? d.push("Male only") : r === "F" && m.gender !== "F" && d.push("Female only"), c.age) {
    const l = e ? new Date(e) : new Date(), n = getAgeOnDate(m.dob, l);
    n === null ? d.push("DOB required") : (c.age.max !== void 0 && n > c.age.max && d.push(`Must be under ${ c.age.max + 1 }`), c.age.min !== void 0 && n < c.age.min && d.push(`Must be ${ c.age.min }+`));
  }
  if (c.tier) {
    const l = rtg(m, c.format, c.sport);
    getTier(l).name.startsWith(c.tier) || d.push(`Rating: ${ c.tier } tier only`);
  }
  return c.duprMin !== void 0 && (m.duprRating || 0) < c.duprMin && d.push(`DUPR ${ c.duprMin }+ required`), c.duprMax !== void 0 && (m.duprRating || 0) > c.duprMax && d.push(`DUPR \u2264 ${ c.duprMax } required`), c.playingSince && m.playingSince > c.playingSince && d.push(`Must be playing since ${ c.playingSince } or earlier`), c.duprUpdatedAfter && (!m.duprLastUpdated || m.duprLastUpdated < c.duprUpdatedAfter) && d.push(`Update your DUPR rating (needed after ${ c.duprUpdatedAfter })`), d;
}
function getAgeOnDate(m, c) {
  if (!m)
    return null;
  const e = new Date(m);
  let d = c.getFullYear() - e.getFullYear();
  const p = c.getMonth() - e.getMonth();
  return (p < 0 || p === 0 && c.getDate() < e.getDate()) && d--, d;
}
const K_BASE = 32, calcExp = (m, c) => 1 / (1 + Math.pow(10, (c - m) / 400));
function calcRtgChange(m, c, e, d, p = "group", gW = 12, gL = 12) {
  const r = calcExp(m, c), l = e + d, marg = l > 0 ? Math.max(0, (e - d) / l) : 0, mov = Math.sqrt(marg), n = 1 + 0.6 * mov, R = 1 - 0.35 * (1 - marg), S = p === "final" ? 1.5 : p === "semi" ? 1.3 : p === "quarter" ? 1.15 : 1, rel = g => g < 10 ? 1.6 : g < 30 ? 1.2 : 1;
  return {
    wG: Math.max(1, Math.round(Math.min(60, K_BASE * (1 - r) * n * S * rel(gW)))),
    lL: Math.max(1, Math.round(Math.min(60, K_BASE * r * R * S * rel(gL))))
  };
}
function genRR(m) {
  const c = m % 2 === 0 ? m : m + 1, e = [], d = Array.from({ length: c }, (p, r) => r);
  for (let p = 0; p < c - 1; p++) {
    const r = [];
    for (let l = 0; l < c / 2; l++) {
      const n = d[l], R = d[c - 1 - l];
      n < m && R < m && r.push([
        n,
        R
      ]);
    }
    e.push(r), d.splice(1, 0, d.pop());
  }
  return e;
}
function schedNoBB(m) {
  const c = [...m], e = [];
  let d = new Set();
  for (; c.length;) {
    let p = 0, r = 1 / 0;
    for (let n = 0; n < c.length; n++) {
      const R = new Set(c[n].flat());
      let S = 0;
      for (const v of R)
        d.has(v) && S++;
      if (S < r && (r = S, p = n), !S)
        break;
    }
    const l = c.splice(p, 1)[0];
    e.push(l), d = new Set(l.flat());
  }
  return e;
}
function teamPlayerIds(t) {
  if (!t)
    return [];
  if (t.p1)
    return [
      t.p1.id,
      t.p2 && t.p2.id
    ].filter(Boolean);
  return t.id ? [t.id] : [];
}
function addMinutes(hhmm, mins) {
  const parts = String(hhmm || "09:00").split(":");
  let total = (parseInt(parts[0]) || 0) * 60 + (parseInt(parts[1]) || 0) + mins;
  total = (total % 1440 + 1440) % 1440;
  const h = Math.floor(total / 60), m = total % 60;
  return `${ String(h).padStart(2, "0") }:${ String(m).padStart(2, "0") }`;
}
function genHalfHourSlots(start, end) {
  const toMin = s => {
    const p = String(s || "").split(":");
    return (parseInt(p[0]) || 0) * 60 + (parseInt(p[1]) || 0);
  };
  let a = toMin(start), b = toMin(end);
  if (b <= a)
    b = a + 60;
  const out = [];
  for (let t = a; t + 30 <= b && out.length < 48; t += 30) {
    const fmt = mm => `${ String(Math.floor(mm / 60)).padStart(2, "0") }:${ String(mm % 60).padStart(2, "0") }`;
    out.push(`${ fmt(t) }\u2013${ fmt(t + 30) }`);
  }
  return out;
}
function buildTimedSchedule(groups, courts, startTime, matchMins) {
  const courtCount = Math.max(1, parseInt(courts) || 1), mins = Math.max(5, parseInt(matchMins) || 20);
  const all = [];
  groups.forEach(g => (g.matches || []).forEach(mt => {
    if (mt.played)
      return;
    all.push({
      mt,
      players: new Set([
        ...teamPlayerIds(mt.teamA),
        ...teamPlayerIds(mt.teamB)
      ]),
      round: mt.round || 1
    });
  }));
  all.sort((a, b) => a.round - b.round);
  const lastSlot = {};
  const remaining = [...all];
  let slot = 0, guard = 0;
  while (remaining.length && guard < 10000) {
    guard++;
    const usedPlayers = new Set();
    let placed = 0;
    let progressed = true;
    while (placed < courtCount && progressed) {
      progressed = false;
      let pick = -1, pickScore = -1;
      for (let i = 0; i < remaining.length; i++) {
        const item = remaining[i];
        let clash = false;
        for (const p of item.players)
          if (usedPlayers.has(p)) {
            clash = true;
            break;
          }
        if (clash)
          continue;
        let bb = 0;
        for (const p of item.players)
          if (lastSlot[p] === slot - 1)
            bb++;
        const score = 1000 - bb * 10 - item.round;
        if (score > pickScore) {
          pickScore = score;
          pick = i;
        }
      }
      if (pick === -1)
        break;
      const item = remaining.splice(pick, 1)[0];
      item.mt.slot = slot;
      item.mt.timeStart = addMinutes(startTime, slot * mins);
      item.mt.court = placed + 1;
      item.players.forEach(p => {
        usedPlayers.add(p);
        lastSlot[p] = slot;
      });
      placed++;
      progressed = true;
    }
    if (placed === 0 && remaining.length) {
      const item = remaining.shift();
      item.mt.slot = slot;
      item.mt.timeStart = addMinutes(startTime, slot * mins);
      item.mt.court = 1;
      item.players.forEach(p => lastSlot[p] = slot);
    }
    slot++;
  }
  return groups;
}
function downloadFile(filename, content, mime) {
  const blob = new Blob([content], { type: mime || "text/plain" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
function teamName(t) {
  if (!t)
    return "TBD";
  return t.fullName || t.id || "TBD";
}
function scheduleRows(tourney) {
  const rows = [];
  (tourney.groups || []).forEach(g => (g.matches || []).forEach(mt => {
    rows.push({
      category: g.catName || g.catShort || "",
      group: "Group " + g.label,
      match: "M" + mt.matchNum,
      teamA: teamName(mt.teamA),
      teamB: teamName(mt.teamB),
      court: mt.court ? "Court " + mt.court : "",
      time: mt.timeStart || "",
      score: mt.played ? `${ mt.scoreA }-${ mt.scoreB }` : ""
    });
  }));
  Object.keys(tourney.knockoutBrackets || {}).forEach(catId => {
    const br = tourney.knockoutBrackets[catId];
    const cat = (tourney.categories || []).find(c => c.id === catId);
    (Array.isArray(br) ? br : br.rounds || []).forEach((rnd, ri) => (rnd || []).forEach(mt => {
      rows.push({
        category: cat ? cat.name : catId,
        group: br.roundNames ? br.roundNames[ri] || "KO R" + (ri + 1) : "KO R" + (ri + 1),
        match: "M" + (mt.matchNum || ""),
        teamA: teamName(mt.teamA),
        teamB: teamName(mt.teamB),
        court: mt.court ? "Court " + mt.court : "",
        time: mt.timeStart || "",
        score: mt.played ? `${ mt.scoreA }-${ mt.scoreB }` : ""
      });
    }));
  });
  return rows;
}
function exportScheduleCSV(tourney) {
  const rows = scheduleRows(tourney);
  const head = [
    "Category",
    "Stage",
    "Match",
    "Team A",
    "Team B",
    "Court",
    "Time",
    "Score"
  ];
  const esc = s => `"${ String(s == null ? "" : s).replace(/"/g, "\"\"") }"`;
  const lines = [head.map(esc).join(",")];
  rows.forEach(r => lines.push([
    r.category,
    r.group,
    r.match,
    r.teamA,
    r.teamB,
    r.court,
    r.time,
    r.score
  ].map(esc).join(",")));
  downloadFile(`${ (tourney.name || "tournament").replace(/[^a-z0-9]+/gi, "_") }_schedule.csv`, lines.join("\r\n"), "text/csv;charset=utf-8;");
}
function scheduleText(tourney) {
  const rows = scheduleRows(tourney);
  let out = `*${ tourney.name || "Tournament" }*`;
  if (tourney.tournamentDate)
    out += `\n${ tourney.tournamentDate }`;
  if (tourney.venue)
    out += ` @ ${ tourney.venue }`;
  out += "\n";
  let lastCat = "", lastGroup = "";
  rows.forEach(r => {
    if (r.category !== lastCat) {
      out += `\n*${ r.category }*\n`;
      lastCat = r.category;
      lastGroup = "";
    }
    if (r.group !== lastGroup) {
      out += `_${ r.group }_\n`;
      lastGroup = r.group;
    }
    const t = r.time ? `${ r.time } ` : "";
    const c = r.court ? `[${ r.court }] ` : "";
    const sc = r.score ? ` (${ r.score })` : "";
    out += `${ t }${ c }${ r.teamA } vs ${ r.teamB }${ sc }\n`;
  });
  return out;
}
function shareWhatsApp(tourney) {
  const txt = scheduleText(tourney);
  window.open(`https://wa.me/?text=${ encodeURIComponent(txt) }`, "_blank");
}
function exportSchedulePDF(tourney) {
  const rows = scheduleRows(tourney);
  const w = window.open("", "_blank");
  if (!w)
    return;
  const cell = s => `<td style="border:1px solid #ccc;padding:6px 8px;font-size:12px">${ String(s == null ? "" : s).replace(/</g, "&lt;") }</td>`;
  const body = rows.map(r => `<tr>${ cell(r.category) }${ cell(r.group) }${ cell(r.match) }${ cell(r.teamA) }${ cell(r.teamB) }${ cell(r.court) }${ cell(r.time) }${ cell(r.score) }</tr>`).join("");
  const doc = w.document;
  doc.open();
  doc.write(`<!doctype html><html><head><meta charset="utf-8"><title>${ tourney.name || "Tournament" } Schedule</title></head><body style="font-family:Arial,Helvetica,sans-serif;padding:20px;color:#111"><h2 style="margin:0 0 4px">${ tourney.name || "Tournament" }</h2><div style="color:#666;font-size:13px;margin-bottom:14px">${ tourney.tournamentDate || "" } ${ tourney.venue ? "@ " + tourney.venue : "" }</div><table style="border-collapse:collapse;width:100%"><thead><tr style="background:#f0f0f0"><th style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left">Category</th><th style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left">Stage</th><th style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left">Match</th><th style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left">Team A</th><th style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left">Team B</th><th style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left">Court</th><th style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left">Time</th><th style="border:1px solid #ccc;padding:6px 8px;font-size:12px;text-align:left">Score</th></tr></thead><tbody>${ body }</tbody></table></body></html>`);
  doc.close();
  setTimeout(() => {
    try {
      w.focus();
      w.print();
    } catch (e) {
    }
  }, 400);
}

const TOUR_FORMATS = [
  {
    id: "group_ko",
    name: "Group Stage + Knockout",
    desc: "Groups guarantee matches, knockouts add drama. Best of both worlds.",
    best: "Best for: club tournaments \xB7 any size"
  },
  {
    id: "league",
    name: "Round Robin League",
    desc: "Everyone plays everyone. Standings decide the champion \u2014 no eliminations.",
    best: "Best for: 4\u20138 teams \xB7 maximum play time"
  },
  {
    id: "single_elim",
    name: "Single Elimination",
    desc: "Straight bracket. Lose once and you're out. Fastest format.",
    best: "Best for: quick events \xB7 any size \xB7 competitive"
  },
  {
    id: "double_elim",
    name: "Double Elimination",
    desc: "Everyone gets a second chance through the losers bracket.",
    best: "Best for: 4, 8 or 16 teams \xB7 fair + competitive"
  },
  {
    id: "americano_t",
    name: "Americano",
    desc: "Partners rotate every round, every point counts individually.",
    best: "Best for: 4\u201312 players \xB7 social \xB7 doubles"
  },
  {
    id: "mexicano_t",
    name: "Mexicano",
    desc: "Pairings by live standings each round \u2014 courts get closer as you play.",
    best: "Best for: 8\u201316 players \xB7 balanced matches"
  }
];
function teamStrength(t) {
  if (!t)
    return 0;
  if (t.p1)
    return ((t.p1.bestRating || 750) + (t.p2 && t.p2.bestRating || 750)) / 2;
  return t.bestRating || 750;
}
function seedOrder(n) {
  let r = [0];
  while (r.length < n) {
    const m = r.length * 2;
    r = r.flatMap(x => [
      x,
      m - 1 - x
    ]);
  }
  return r;
}
function seedBracket(teams) {
  const N = teams.length;
  if (N < 2)
    return null;
  const sorted = [...teams].sort((a, b) => teamStrength(b) - teamStrength(a));
  const size = Math.pow(2, Math.ceil(Math.log2(N)));
  const ord = seedOrder(size), slots = new Array(size).fill(null);
  ord.forEach((seedIdx, slot) => {
    seedIdx < N && (slots[slot] = sorted[seedIdx]);
  });
  const rounds = [];
  let count = size / 2, mn = 1;
  for (let r = 0; count >= 1; r++, count /= 2) {
    const rd = [];
    for (let i = 0; i < count; i++)
      rd.push({
        id: uid(),
        matchNum: mn++,
        p1: null,
        p2: null,
        s1: null,
        s2: null,
        winner: null,
        played: !1,
        isBye: !1
      });
    rounds.push(rd);
  }
  for (let i = 0; i < size; i += 2) {
    const m = rounds[0][i / 2];
    m.p1 = slots[i], m.p2 = slots[i + 1];
    if (m.p1 && !m.p2 || !m.p1 && m.p2) {
      const adv = m.p1 || m.p2;
      m.isBye = !0, m.played = !0, m.winner = adv.id;
      if (rounds.length > 1) {
        const nx = rounds[1][Math.floor(i / 2 / 2)];
        i / 2 % 2 === 0 ? nx.p1 = adv : nx.p2 = adv;
      }
    }
  }
  return rounds;
}
function buildLoserBracket(size) {
  if (size < 4)
    return [];
  const k = Math.log2(size), rounds = [];
  let mn = 100;
  for (let r = 0; r < 2 * (k - 1); r++) {
    const cnt = Math.pow(2, k - 2 - Math.floor(r / 2));
    const rd = [];
    for (let i = 0; i < cnt; i++)
      rd.push({
        id: uid(),
        matchNum: mn++,
        p1: null,
        p2: null,
        s1: null,
        s2: null,
        winner: null,
        played: !1,
        isBye: !1
      });
    rounds.push(rd);
  }
  return rounds;
}
function advanceDE(wb, lb, gf, br, r, mIdx, sA, sB) {
  const W = wb.map(x => x.map(y => ({ ...y })));
  const L = (lb || []).map(x => x.map(y => ({ ...y })));
  const G = { ...gf || {} };
  let winnerTeam = null, loserTeam = null, champion = null, stage = "group";
  if (br === "G") {
    G.s1 = sA, G.s2 = sB, G.winner = sA > sB ? G.p1.id : G.p2.id, G.played = !0;
    winnerTeam = sA > sB ? G.p1 : G.p2, loserTeam = sA > sB ? G.p2 : G.p1, champion = winnerTeam, stage = "final";
  } else if (br === "L") {
    const m = L[r][mIdx];
    m.s1 = sA, m.s2 = sB, m.winner = sA > sB ? m.p1.id : m.p2.id, m.played = !0;
    winnerTeam = sA > sB ? m.p1 : m.p2, loserTeam = sA > sB ? m.p2 : m.p1;
    stage = r >= L.length - 2 ? "semi" : "quarter";
    if (r + 1 < L.length) {
      if (r % 2 === 0)
        L[r + 1][mIdx].p1 = winnerTeam;
      else {
        const nx = L[r + 1][Math.floor(mIdx / 2)];
        mIdx % 2 === 0 ? nx.p1 = winnerTeam : nx.p2 = winnerTeam;
      }
    } else
      G.p2 = winnerTeam;
  } else {
    const m = W[r][mIdx];
    m.s1 = sA, m.s2 = sB, m.winner = sA > sB ? m.p1.id : m.p2.id, m.played = !0;
    winnerTeam = sA > sB ? m.p1 : m.p2, loserTeam = sA > sB ? m.p2 : m.p1;
    stage = r === W.length - 1 ? "semi" : r === W.length - 2 ? "quarter" : "group";
    if (r + 1 < W.length) {
      const nx = W[r + 1][Math.floor(mIdx / 2)];
      mIdx % 2 === 0 ? nx.p1 = winnerTeam : nx.p2 = winnerTeam;
    } else
      G.p1 = winnerTeam;
    if (L.length) {
      if (r === 0) {
        const t = L[0][Math.floor(mIdx / 2)];
        mIdx % 2 === 0 ? t.p1 = loserTeam : t.p2 = loserTeam;
      } else
        L[2 * r - 1][mIdx].p2 = loserTeam;
    }
  }
  return {
    wb: W,
    lb: L,
    gf: G,
    winnerTeam: winnerTeam,
    loserTeam: loserTeam,
    champion: champion,
    stage: stage
  };
}
function chunkCourts(list, maxCourts) {
  const usable = Math.min(Math.floor(list.length / 4), maxCourts || 99);
  const courts = [];
  for (let i = 0; i < usable; i++) {
    const g = list.slice(i * 4, i * 4 + 4);
    courts.push({
      players: g.map(x => x.id),
      a: [
        g[0].id,
        g[3].id
      ],
      b: [
        g[1].id,
        g[2].id
      ],
      scoreA: null,
      scoreB: null,
      played: !1
    });
  }
  return {
    courts: courts,
    benched: list.slice(usable * 4).map(x => x.id)
  };
}
function genAmericanoRound(playerObjs, roundIdx, maxCourts, mode, points) {
  let list;
  if (mode === "mexicano_t" && roundIdx > 0)
    list = [...playerObjs].sort((a, b) => (points[b.id] || 0) - (points[a.id] || 0));
  else {
    list = [...playerObjs].sort((a, b) => String(a.id).localeCompare(String(b.id)));
    if (list.length > 1) {
      const fixed = list[0], rest = list.slice(1);
      const rot = roundIdx % rest.length;
      list = [fixed].concat(rest.slice(rot), rest.slice(0, rot));
    }
  }
  return chunkCourts(list, maxCourts);
}
function leagueStandings(groups) {
  const T = {};
  groups.forEach(g => {
    (g.teams || []).forEach(t => {
      T[t.id] = T[t.id] || {
        team: t,
        gW: 0,
        gD: 0,
        gPF: 0
      };
    }), (g.matches || []).filter(m => m.played).forEach(m => {
      T[m.teamA.id].gPF += m.scoreA, T[m.teamA.id].gD += m.scoreA - m.scoreB, T[m.teamB.id].gPF += m.scoreB, T[m.teamB.id].gD += m.scoreB - m.scoreA, m.winner === m.teamA.id ? T[m.teamA.id].gW++ : T[m.teamB.id].gW++;
    });
  });
  return Object.values(T).sort((a, b) => b.gW - a.gW || b.gD - a.gD || b.gPF - a.gPF);
}
const DEFAULT_CATS = [
  {
    id: "ms_open",
    name: "Men's Singles",
    short: "MS Open",
    format: "ms",
    gender: "M",
    age: null,
    tier: null,
    description: "Open category for male players of all ages and skill levels"
  },
  {
    id: "ws_open",
    name: "Women's Singles",
    short: "WS Open",
    format: "ws",
    gender: "F",
    age: null,
    tier: null,
    description: "Open category for female players of all ages and skill levels"
  },
  {
    id: "md_open",
    name: "Men's Doubles",
    short: "MD Open",
    format: "md",
    gender: "M",
    age: null,
    tier: null,
    description: "Open doubles category for male pairs"
  },
  {
    id: "wd_open",
    name: "Women's Doubles",
    short: "WD Open",
    format: "wd",
    gender: "F",
    age: null,
    tier: null,
    description: "Open doubles category for female pairs"
  },
  {
    id: "mx_open",
    name: "Mixed Doubles",
    short: "MX Open",
    format: "mx",
    gender: "MX",
    age: null,
    tier: null,
    description: "Mixed doubles open category"
  },
  {
    id: "gn_open",
    name: "Gender Neutral Doubles",
    short: "GN Open",
    format: "gn",
    age: null,
    tier: null,
    description: "Open category for any gender combination pairs"
  },
  {
    id: "ms_int",
    name: "Intermediate Men's Singles",
    short: "MS Int",
    format: "ms",
    gender: "M",
    age: null,
    tier: "Intermediate",
    description: "Singles for intermediate male players (rating 750-899)"
  },
  {
    id: "ms_pro",
    name: "Pro Men's Singles",
    short: "MS Pro",
    format: "ms",
    gender: "M",
    age: null,
    tier: "Pro",
    description: "Professional singles category (rating 1350+)"
  },
  {
    id: "mx_35",
    name: "35+ Mixed Doubles",
    short: "35+ MX",
    format: "mx",
    gender: "MX",
    age: { min: 35 },
    tier: null,
    description: "Senior mixed doubles for players 35+"
  }
];
function genPlayers() {
  const m = [
      "Rajesh",
      "Mihir",
      "Amrish",
      "Priya",
      "Sneha",
      "Vikram",
      "Ananya",
      "Karan",
      "Meera",
      "Rohan",
      "Hanit",
      "Yogi",
      "Hitesh",
      "Tarang",
      "Kavita",
      "Suresh",
      "Aarav",
      "Diya",
      "Arjun",
      "Ishita",
      "Vivaan",
      "Zara",
      "Aditya",
      "Anika",
      "Kabir",
      "Myra",
      "Reyansh",
      "Aadhya",
      "Dhruv",
      "Kiara",
      "Advait",
      "Navya",
      "Shaurya",
      "Pari",
      "Atharv",
      "Anvi",
      "Rudra",
      "Sara",
      "Vihaan",
      "Jhanvi",
      "Krishna",
      "Tanvi",
      "Ayaan",
      "Riya",
      "Arnav",
      "Siya",
      "Ishaan",
      "Inaya",
      "Virat",
      "Nitya",
      "Rishi",
      "Kunal",
      "Neha",
      "Manoj",
      "Pooja",
      "Deepak",
      "Shweta",
      "Gaurav",
      "Rashmi",
      "Sandeep",
      "Monica",
      "Vivek",
      "Nidhi",
      "Abhishek",
      "Kajal",
      "Prateek",
      "Divya",
      "Rahul",
      "Shreya",
      "Nikhil",
      "Prachi",
      "Siddharth",
      "Aishwarya",
      "Varun",
      "Sakshi",
      "Kartik",
      "Radhika",
      "Amit",
      "Suman",
      "Sachin",
      "Jaya",
      "Dinesh",
      "Lata",
      "Mohan",
      "Sunita",
      "Raj",
      "Gita",
      "Vijay",
      "Uma",
      "Sanjay",
      "Nalini",
      "Prakash",
      "Rekha",
      "Ashok",
      "Madhu"
    ], c = [
      "Sharma",
      "Patel",
      "Kumar",
      "Singh",
      "Joshi",
      "Menon",
      "Iyer",
      "Nair",
      "Reddy",
      "Gupta",
      "Shah",
      "Desai",
      "Rao",
      "Pillai",
      "Deshmukh",
      "Chopra",
      "Malhotra",
      "Kapoor",
      "Mehta",
      "Verma",
      "Bose",
      "Sen",
      "Das",
      "Chakraborty",
      "Banerjee",
      "Mukherjee",
      "Chatterjee",
      "Sinha",
      "Thakur",
      "Yadav"
    ], e = [
      "Mumbai",
      "Delhi",
      "Bangalore",
      "Chennai",
      "Hyderabad",
      "Pune",
      "Ahmedabad",
      "Kolkata",
      "Jaipur",
      "Lucknow"
    ], d = new Set(), p = [];
  for (; p.length < 100;) {
    const r = m[Math.floor(Math.random() * m.length)], l = c[Math.floor(Math.random() * c.length)], n = `${ r } ${ l }`;
    if (d.has(n))
      continue;
    d.add(n);
    const R = Math.random() > 0.4 ? "M" : "F", S = 1965 + Math.floor(Math.random() * 40), v = String(Math.floor(Math.random() * 12) + 1).padStart(2, "0"), M = String(Math.floor(Math.random() * 28) + 1).padStart(2, "0"), z = `${ S }-${ v }-${ M }`, g = 400 + Math.floor(Math.random() * 800), f = Math.floor(Math.random() * 60) - 30, u = Math.min(1600, Math.max(300, g + f + (R === "M" ? 50 : -30))), k = R === "F" ? Math.min(1600, Math.max(300, g + f + 20)) : 0, G = Math.min(1600, Math.max(300, g + f + 80)), O = R === "F" ? Math.min(1600, Math.max(300, g + f + 50)) : 0, K = Math.min(1600, Math.max(300, g + f + 20)), J = R === "M" ? {
        [ratingKey(DEFAULT_SPORT, "ms")]: u,
        [ratingKey(DEFAULT_SPORT, "md")]: G,
        [ratingKey(DEFAULT_SPORT, "mx")]: K
      } : {
        [ratingKey(DEFAULT_SPORT, "ws")]: k,
        [ratingKey(DEFAULT_SPORT, "wd")]: O,
        [ratingKey(DEFAULT_SPORT, "mx")]: K
      }, D = Math.max(...Object.values(J)), I = Math.floor(Math.random() * 50), ae = Math.floor(Math.random() * 30), w = SKILLS.reduce((L, se) => ({
        ...L,
        [se]: Math.round((2 + Math.random() * 3) * 10) / 10
      }), {}), P = {};
    for (let L = 0; L < Math.floor(Math.random() * 5); L++) {
      const se = TAG_PRESETS[Math.floor(Math.random() * TAG_PRESETS.length)];
      P[se] = (P[se] || 0) + Math.floor(Math.random() * 10) + 1;
    }
    const ne = genId(r, l, z), Y = `https://ui-avatars.com/api/?name=${ r }+${ l }&background=${ R === "M" ? "2dd4bf" : "f472b6" }&color=fff&size=200`, ee = [];
    for (let L = 0; L < Math.floor(Math.random() * 4); L++)
      ee.push({
        type: [
          "\uD83E\uDD47",
          "\uD83E\uDD48",
          "\uD83E\uDD49"
        ][Math.floor(Math.random() * 3)],
        tournament: "Sample 2025",
        category: FORMAT_LABELS[R === "M" ? "ms" : "ws"]
      });
    p.push({
      id: ne,
      firstName: r,
      lastName: l,
      fullName: n,
      gender: R,
      dob: z,
      phone: `+91 ${ Math.floor(Math.random() * 9000000000) + 1000000000 }`,
      hand: [
        "Right",
        "Right",
        "Right",
        "Left",
        "Right"
      ][Math.floor(Math.random() * 5)],
      city: e[Math.floor(Math.random() * 10)],
      playingSince: 2020 + Math.floor(Math.random() * 4),
      ratings: J,
      bestRating: D,
      wins: I,
      losses: ae,
      skills: w,
      skillRatingsCount: Math.floor(Math.random() * 20) + 1,
      tags: P,
      matchHistory: [],
      registered: !0,
      savedPartners: [],
      avatarUrl: Y,
      medals: ee,
      partnerStats: {},
      duprId: `DUPR${ Math.floor(Math.random() * 900000) + 100000 }`,
      duprRating: Math.round((2.5 + Math.random() * 3.5) * 10) / 10,
      duprReliability: Math.floor(Math.random() * 81) + 20,
      duprLastUpdated: new Date(Date.now() - Math.floor(Math.random() * 300) * 86400000).toISOString().split("T")[0]
    });
  }
  for (let r = 0; r < p.length; r += 2)
    r + 1 < p.length && (p[r].savedPartners.push(p[r + 1].id), p[r + 1].savedPartners.push(p[r].id));
  return p;
}
function seededAutoFill(m, c, e, d, p) {
  const r = [...m].sort((z, g) => rtg(g, p) - rtg(z, p)), l = c.map(z => ({
      ...z,
      teams: []
    })), n = l.length;
  if (n === 0 || r.length === 0)
    return l;
  let R = 0, S = 1, v = 0, M = 0;
  for (; R < r.length && M < r.length * 3;) {
    if (M++, l[v].teams.length < e)
      if (d && R + 1 < r.length) {
        const z = r[R], g = r[R + 1], f = rtg(z, p), u = rtg(g, p);
        l[v].teams.push({
          id: `${ z.id }+${ g.id }`,
          fullName: `${ z.fullName } | ${ g.fullName }`,
          p1: z,
          p2: g,
          bestRating: Math.round((f + u) / 2),
          firstName: z.firstName,
          gender: z.gender
        }), R += 2;
      } else
        l[v].teams.push(r[R]), R++;
    if (v += S, (v >= n || v < 0) && (S *= -1, v += S), l.every(z => z.teams.length >= e))
      break;
  }
  return l;
}
const Ic = ({
    t: m,
    s: c = 18
  }) => {
    const e = {
      width: c,
      height: c,
      fill: "none",
      stroke: "currentColor",
      strokeWidth: 1.8,
      strokeLinecap: "round",
      strokeLinejoin: "round"
    };
    return {
      user: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" }), React.createElement("circle", {
        cx: "12",
        cy: "7",
        r: "4"
      })),
      plus: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("line", {
        x1: "12",
        y1: "5",
        x2: "12",
        y2: "19"
      }), React.createElement("line", {
        x1: "5",
        y1: "12",
        x2: "19",
        y2: "12"
      })),
      check: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("polyline", { points: "20 6 9 17 4 12" })),
      x: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("line", {
        x1: "18",
        y1: "6",
        x2: "6",
        y2: "18"
      }), React.createElement("line", {
        x1: "6",
        y1: "6",
        x2: "18",
        y2: "18"
      })),
      back: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("polyline", { points: "15 18 9 12 15 6" })),
      chevron: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("polyline", { points: "9 18 15 12 9 6" })),
      search: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("circle", {
        cx: "11",
        cy: "11",
        r: "8"
      }), React.createElement("line", {
        x1: "21",
        y1: "21",
        x2: "16.65",
        y2: "16.65"
      })),
      star: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24",
        fill: "currentColor"
      }, React.createElement("polygon", { points: "12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" })),
      award: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("circle", {
        cx: "12",
        cy: "8",
        r: "7"
      }), React.createElement("polyline", { points: "8.21 13.89 7 23 12 20 17 23 15.79 13.88" })),
      target: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "10"
      }), React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "6"
      }), React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "2"
      })),
      stats: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M18 20V10" }), React.createElement("path", { d: "M12 20V4" }), React.createElement("path", { d: "M6 20v-6" })),
      tag: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M20.59 13.41l-7.17 7.17a2 2 0 01-2.83 0L2 12V2h10l8.59 8.59a2 2 0 010 2.82z" }), React.createElement("line", {
        x1: "7",
        y1: "7",
        x2: "7.01",
        y2: "7"
      })),
      zap: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("polygon", { points: "13 2 3 14 12 14 11 22 21 10 12 10 13 2" })),
      trophy: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M6 9H4.5a2.5 2.5 0 010-5H6" }), React.createElement("path", { d: "M18 9h1.5a2.5 2.5 0 000-5H18" }), React.createElement("path", { d: "M4 22h16" }), React.createElement("path", { d: "M10 14.66V17c0 .55-.47.98-.97 1.21C7.85 18.75 7 19.77 7 22" }), React.createElement("path", { d: "M14 14.66V17c0 .55.47.98.97 1.21C16.15 18.75 17 19.77 17 22" }), React.createElement("path", { d: "M18 2H6v7a6 6 0 0012 0V2z" })),
      calendar: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("rect", {
        x: "3",
        y: "4",
        width: "18",
        height: "18",
        rx: "2"
      }), React.createElement("line", {
        x1: "16",
        y1: "2",
        x2: "16",
        y2: "6"
      }), React.createElement("line", {
        x1: "8",
        y1: "2",
        x2: "8",
        y2: "6"
      }), React.createElement("line", {
        x1: "3",
        y1: "10",
        x2: "21",
        y2: "10"
      })),
      phone: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07 19.5 19.5 0 01-6-6 19.79 19.79 0 01-3.07-8.67A2 2 0 014.11 2h3a2 2 0 012 1.72c.127.96.362 1.903.7 2.81a2 2 0 01-.45 2.11L8.09 9.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.338 1.85.573 2.81.7A2 2 0 0122 16.92z" })),
      grid: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("rect", {
        x: "3",
        y: "3",
        width: "7",
        height: "7"
      }), React.createElement("rect", {
        x: "14",
        y: "3",
        width: "7",
        height: "7"
      }), React.createElement("rect", {
        x: "3",
        y: "14",
        width: "7",
        height: "7"
      }), React.createElement("rect", {
        x: "14",
        y: "14",
        width: "7",
        height: "7"
      })),
      play: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("polygon", {
        points: "5 3 19 12 5 21 5 3",
        fill: "currentColor"
      })),
      map: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z" }), React.createElement("circle", {
        cx: "12",
        cy: "10",
        r: "3"
      })),
      clock: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("circle", {
        cx: "12",
        cy: "12",
        r: "10"
      }), React.createElement("polyline", { points: "12 6 12 12 16 14" })),
      share: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" }), React.createElement("polyline", { points: "16 6 12 2 8 6" }), React.createElement("line", {
        x1: "12",
        y1: "2",
        x2: "12",
        y2: "15"
      })),
      shield: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" })),
      arrowRight: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("line", {
        x1: "5",
        y1: "12",
        x2: "19",
        y2: "12"
      }), React.createElement("polyline", { points: "12 5 19 12 12 19" })),
      users: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M16 21v-2a4 4 0 00-4-4H6a4 4 0 00-4 4v2" }), React.createElement("circle", {
        cx: "9",
        cy: "7",
        r: "4"
      }), React.createElement("path", { d: "M22 21v-2a4 4 0 00-3-3.87" }), React.createElement("path", { d: "M16 3.13a4 4 0 010 7.75" })),
      image: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("rect", {
        x: "3",
        y: "3",
        width: "18",
        height: "18",
        rx: "2"
      }), React.createElement("circle", {
        cx: "8.5",
        cy: "8.5",
        r: "1.5"
      }), React.createElement("polyline", { points: "21 15 16 10 5 21" })),
      link: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("path", { d: "M10 13a5 5 0 007.54.54l3-3a5 5 0 00-7.07-7.07l-1.72 1.71" }), React.createElement("path", { d: "M14 11a5 5 0 00-7.54-.54l-3 3a5 5 0 007.07 7.07l1.71-1.71" })),
      repeat: React.createElement("svg", {
        ...e,
        viewBox: "0 0 24 24"
      }, React.createElement("polyline", { points: "17 1 21 5 17 9" }), React.createElement("path", { d: "M3 11V9a4 4 0 014-4h14" }), React.createElement("polyline", { points: "7 23 3 19 7 15" }), React.createElement("path", { d: "M21 13v2a4 4 0 01-4 4H3" }))
    }[m] || null;
  }, Badge = ({
    children: m,
    color: c = C.lime,
    small: e
  }) => React.createElement("span", {
    style: {
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
      padding: e ? "2px 8px" : "3px 11px",
      borderRadius: 20,
      background: `${ c }18`,
      color: c,
      fontSize: e ? 10 : 11,
      fontWeight: 600,
      whiteSpace: "nowrap"
    }
  }, m), Stat = ({
    label: m,
    value: c,
    icon: e,
    color: d = C.lime,
    onClick: p
  }) => React.createElement("div", {
    onClick: p,
    style: {
      background: C.card,
      borderRadius: 14,
      padding: "14px 16px",
      border: `1px solid ${ C.border }`,
      position: "relative",
      overflow: "hidden",
      cursor: p ? "pointer" : "default"
    }
  }, React.createElement("div", {
    style: {
      position: "absolute",
      top: 8,
      right: 10,
      color: `${ d }20`
    }
  }, React.createElement(Ic, {
    t: e,
    s: 28
  })), React.createElement("div", {
    style: {
      fontSize: 9,
      color: C.textDim,
      textTransform: "uppercase",
      letterSpacing: 1.2,
      fontWeight: 700,
      marginBottom: 3
    }
  }, m), React.createElement("div", {
    style: {
      fontSize: 22,
      fontWeight: 800,
      color: d
    }
  }, c)), Avi = ({
    name: m,
    color: c,
    size: e = 32,
    gender: d,
    imageUrl: p
  }) => {
    const [r, l] = useState(!1);
    if (p && !r)
      return React.createElement("img", {
        src: p,
        alt: m,
        style: {
          width: e,
          height: e,
          borderRadius: "50%",
          objectFit: "cover",
          flexShrink: 0
        },
        onError: () => l(!0)
      });
    const n = c || (d === "F" ? C.pink : C.teal);
    return React.createElement("div", {
      style: {
        width: e,
        height: e,
        borderRadius: "50%",
        background: `linear-gradient(135deg,${ n },${ n }88)`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: e * 0.36,
        fontWeight: 700,
        color: C.black,
        flexShrink: 0
      }
    }, m?.charAt(0) || "?");
  }, Modal = ({
    children: m,
    onClose: c
  }) => React.createElement("div", {
    onClick: c,
    style: {
      position: "fixed",
      inset: 0,
      background: "rgba(0,0,0,0.78)",
      backdropFilter: "blur(8px)",
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      zIndex: 1000,
      padding: 16
    }
  }, React.createElement("div", {
    onClick: e => e.stopPropagation(),
    style: {
      background: C.surface,
      borderRadius: 20,
      border: `1px solid ${ C.border }`,
      boxShadow: "0 24px 80px rgba(0,0,0,0.6)",
      maxWidth: 520,
      width: "100%",
      maxHeight: "90vh",
      overflow: "auto"
    }
  }, m)), Btn = ({
    children: m,
    onClick: c,
    primary: e,
    disabled: d,
    full: p,
    small: r,
    color: l,
    style: n
  }) => React.createElement("button", {
    onClick: c,
    disabled: d,
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      padding: r ? "7px 14px" : "11px 22px",
      background: d ? C.card : e ? `linear-gradient(135deg,${ l || C.lime },${ l ? l + "bb" : C.limeDark })` : "transparent",
      border: e ? "none" : `1px solid ${ C.border }`,
      borderRadius: r ? 8 : 10,
      color: d ? C.textDim : e ? C.black : C.textMuted,
      fontWeight: 700,
      fontSize: r ? 11 : 13,
      cursor: d ? "not-allowed" : "pointer",
      width: p ? "100%" : "auto",
      fontFamily: "inherit",
      ...n
    }
  }, m), Input = ({
    value: m,
    onChange: c,
    placeholder: e,
    type: d = "text",
    icon: p,
    style: r,
    ...l
  }) => React.createElement("div", {
    style: {
      position: "relative",
      ...r
    }
  }, p && React.createElement("div", {
    style: {
      position: "absolute",
      left: 12,
      top: "50%",
      transform: "translateY(-50%)",
      color: C.textDim
    }
  }, React.createElement(Ic, {
    t: p,
    s: 15
  })), React.createElement("input", {
    value: m,
    onChange: n => c(n.target.value),
    placeholder: e,
    type: d,
    ...l,
    style: {
      width: "100%",
      padding: p ? "10px 14px 10px 38px" : "10px 14px",
      background: C.card,
      border: `1px solid ${ C.border }`,
      borderRadius: 10,
      color: C.text,
      fontSize: 13,
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit"
    }
  })), Select = ({
    value: m,
    onChange: c,
    options: e,
    style: d
  }) => React.createElement("select", {
    value: m,
    onChange: p => c(p.target.value),
    style: {
      width: "100%",
      padding: "10px 14px",
      background: C.card,
      border: `1px solid ${ C.border }`,
      borderRadius: 10,
      color: C.text,
      fontSize: 13,
      outline: "none",
      boxSizing: "border-box",
      fontFamily: "inherit",
      appearance: "none",
      ...d
    }
  }, e.map(p => React.createElement("option", {
    key: p.value,
    value: p.value
  }, p.label))), RadarChart = ({
    skills: m,
    size: c = 200
  }) => {
    const mm = (() => {
      const o = {};
      SKILLS.forEach(k => {
        let v = m[k];
        v === void 0 && k === "Drop Shot" && (v = m["3rd Shot Drop"]);
        o[k] = v || 0;
      });
      Object.keys(m).forEach(k => {
        o[k] === void 0 && k !== "3rd Shot Drop" && (o[k] = m[k] || 0);
      });
      return o;
    })(), e = c / 2, d = c / 2, p = c * 0.33, r = Object.keys(mm), l = r.length, n = Math.PI * 2 / l, R = (v, M) => {
        const z = n * v - Math.PI / 2, g = M / 5 * p;
        return [
          e + Math.cos(z) * g,
          d + Math.sin(z) * g
        ];
      }, S = r.map((v, M) => R(M, mm[r[M]]));
    return React.createElement("svg", {
      width: c,
      height: c,
      viewBox: `0 0 ${ c } ${ c }`
    }, [
      1,
      2,
      3,
      4,
      5
    ].map(v => React.createElement("polygon", {
      key: v,
      points: r.map((M, z) => R(z, v).join(",")).join(" "),
      fill: "none",
      stroke: C.border,
      strokeWidth: 0.5,
      opacity: 0.6
    })), r.map((v, M) => {
      const [z, g] = R(M, 5);
      return React.createElement("line", {
        key: M,
        x1: e,
        y1: d,
        x2: z,
        y2: g,
        stroke: C.border,
        strokeWidth: 0.5,
        opacity: 0.4
      });
    }), React.createElement("polygon", {
      points: S.map(v => v.join(",")).join(" "),
      fill: `${ C.lime }25`,
      stroke: C.lime,
      strokeWidth: 1.5
    }), S.map((v, M) => React.createElement("circle", {
      key: M,
      cx: v[0],
      cy: v[1],
      r: 3,
      fill: C.lime
    })), r.map((v, M) => {
      const z = n * M - Math.PI / 2, cs = Math.cos(z);
      return React.createElement("text", {
        key: M,
        x: e + cs * (p + 8),
        y: d + Math.sin(z) * (p + 13),
        textAnchor: cs > 0.25 ? "start" : cs < -0.25 ? "end" : "middle",
        dominantBaseline: "middle",
        fill: C.textMuted,
        fontSize: l > 9 ? 6.5 : 8,
        fontWeight: 600,
        fontFamily: "inherit"
      }, v);
    }));
  }, CategorySelector = ({
    categories: m,
    value: c,
    onChange: e,
    onAddCategory: d
  }) => {
    const [p, r] = useState(""), [l, n] = useState(!1), [R, S] = useState(!1), v = useRef(null);
    useEffect(() => {
      const g = f => {
        v.current && !v.current.contains(f.target) && n(!1);
      };
      return document.addEventListener("mousedown", g), () => document.removeEventListener("mousedown", g);
    }, []);
    const M = m.filter(g => g.name.toLowerCase().includes(p.toLowerCase()) || g.description.toLowerCase().includes(p.toLowerCase())), z = m.find(g => g.id === c);
    return React.createElement("div", {
      ref: v,
      style: { position: "relative" }
    }, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700,
        marginBottom: 5,
        display: "block"
      }
    }, "Category"), React.createElement("div", {
      onClick: () => n(!l),
      style: {
        padding: "10px 14px",
        background: C.card,
        border: `1px solid ${ l ? C.lime : C.border }`,
        borderRadius: 10,
        color: C.text,
        fontSize: 13,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between"
      }
    }, React.createElement("span", { style: { color: z ? C.text : C.textDim } }, z ? z.name : "Select category..."), React.createElement(Ic, {
      t: "chevron",
      s: 14
    })), z && React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        marginTop: 3,
        paddingLeft: 2
      }
    }, z.description), l && React.createElement("div", {
      style: {
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        marginTop: 4,
        background: C.surface,
        border: `1px solid ${ C.border }`,
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: 50,
        maxHeight: 320,
        overflow: "hidden"
      }
    }, React.createElement("div", {
      style: {
        padding: 8,
        borderBottom: `1px solid ${ C.border }`
      }
    }, React.createElement(Input, {
      value: p,
      onChange: r,
      placeholder: "Search categories...",
      icon: "search"
    })), React.createElement("div", {
      style: {
        maxHeight: 180,
        overflow: "auto"
      }
    }, M.map(g => React.createElement("div", {
      key: g.id,
      onClick: () => {
        e(g.id), n(!1);
      },
      style: {
        padding: "10px 14px",
        cursor: "pointer",
        background: c === g.id ? `${ C.lime }15` : "transparent",
        borderBottom: `1px solid ${ C.border }`,
        borderLeft: c === g.id ? `3px solid ${ C.lime }` : "3px solid transparent"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 600,
        color: C.text
      }
    }, g.name), React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        marginTop: 2
      }
    }, g.description), React.createElement("div", {
      style: {
        display: "flex",
        gap: 4,
        marginTop: 3
      }
    }, g.gender && g.gender !== "MX" && React.createElement(Badge, {
      small: !0,
      color: g.gender === "M" ? C.blue : C.pink
    }, g.gender === "M" ? "Male" : "Female"), g.tier && React.createElement(Badge, {
      small: !0,
      color: C.orange
    }, g.tier), g.age && React.createElement(Badge, {
      small: !0,
      color: C.teal
    }, g.age.min ? `${ g.age.min }+` : `U${ g.age.max + 1 }`)))), M.length === 0 && React.createElement("div", {
      style: {
        padding: 14,
        textAlign: "center",
        color: C.textDim,
        fontSize: 11
      }
    }, "No categories found")), React.createElement("div", {
      style: {
        borderTop: `1px solid ${ C.border }`,
        padding: 8
      }
    }, React.createElement(Btn, {
      full: !0,
      small: !0,
      onClick: () => {
        S(!0), n(!1);
      },
      color: C.teal
    }, React.createElement(Ic, {
      t: "plus",
      s: 12
    }), " Create New Category"))), R && React.createElement(CategoryCreatorModal, {
      onClose: () => S(!1),
      onCreate: g => {
        d(g), e(g.id);
      }
    }));
  }, CategoryCreatorModal = ({
    onClose: m,
    onCreate: c
  }) => {
    const [e, d] = useState({
        name: "",
        short: "",
        format: "gn",
        ageType: "none",
        ageMax: "",
        ageMin: "",
        ageSplit: "",
        cutoffDate: "",
        tier: "",
        duprMin: "",
        duprMax: "",
        playingSince: "",
        duprUpdatedAfter: "",
        description: ""
      }), p = () => {
        if (!e.name || !e.format)
          return;
        const r = `${ e.format }_${ e.tier || "open" }_${ Date.now() }`;
        let l = null;
        e.ageType === "under" ? l = { max: parseInt(e.ageMax) } : e.ageType === "over" ? l = { min: parseInt(e.ageMin) } : e.ageType === "range" ? l = {
          min: parseInt(e.ageMin) || void 0,
          max: parseInt(e.ageMax) || void 0
        } : e.ageType === "split" && (l = { min: parseInt(e.ageSplit) });
        const n = {
          id: r,
          name: e.name,
          short: e.short || e.name.substring(0, 12),
          format: e.format,
          age: l,
          cutoffDate: e.cutoffDate || null,
          tier: e.tier || null,
          duprMin: e.duprMin ? parseFloat(e.duprMin) : void 0,
          duprMax: e.duprMax ? parseFloat(e.duprMax) : void 0,
          playingSince: e.playingSince ? parseInt(e.playingSince) : null,
          duprUpdatedAfter: e.duprUpdatedAfter || null,
          description: e.description || `${ e.name } category`
        };
        c(n), m();
      };
    return React.createElement(Modal, { onClose: m }, React.createElement("div", { style: { padding: 22 } }, React.createElement("h3", {
      style: {
        fontSize: 16,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 4px"
      }
    }, "Create New Category"), React.createElement("p", {
      style: {
        fontSize: 10,
        color: C.textDim,
        margin: "0 0 16px"
      }
    }, "Define eligibility criteria"), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Category Name *"), React.createElement(Input, {
      value: e.name,
      onChange: r => d(l => ({
        ...l,
        name: r
      })),
      placeholder: "e.g. Corporate Gender Neutral Doubles",
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Short Name"), React.createElement(Input, {
      value: e.short,
      onChange: r => d(l => ({
        ...l,
        short: r
      })),
      placeholder: "e.g. Corp GN",
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Format *"), React.createElement(Select, {
      value: e.format,
      onChange: r => d(l => ({
        ...l,
        format: r
      })),
      options: [
        {
          value: "ms",
          label: "Men's Singles"
        },
        {
          value: "ws",
          label: "Women's Singles"
        },
        {
          value: "md",
          label: "Men's Doubles"
        },
        {
          value: "wd",
          label: "Women's Doubles"
        },
        {
          value: "mx",
          label: "Mixed Doubles (M+F)"
        },
        {
          value: "gn",
          label: "Gender Neutral Doubles (any)"
        }
      ],
      style: { marginTop: 5 }
    }), React.createElement("div", {
      style: {
        fontSize: 8,
        color: C.textDim,
        marginTop: 3
      }
    }, e.format === "ms" ? "Male players only" : e.format === "ws" ? "Female players only" : e.format === "md" ? "Male pairs only" : e.format === "wd" ? "Female pairs only" : e.format === "mx" ? "One male + one female" : e.format === "gn" ? "Any gender combination" : "Select format")), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Age Restriction"), React.createElement(Select, {
      value: e.ageType,
      onChange: r => d(l => ({
        ...l,
        ageType: r
      })),
      options: [
        {
          value: "none",
          label: "No age restriction"
        },
        {
          value: "under",
          label: "Under (max age)"
        },
        {
          value: "over",
          label: "Over (min age)"
        },
        {
          value: "range",
          label: "Range (min - max)"
        },
        {
          value: "split",
          label: "Split (e.g. 35+)"
        }
      ],
      style: { marginTop: 5 }
    }), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 6
      }
    }, e.ageType === "under" && React.createElement(Input, {
      type: "number",
      value: e.ageMax,
      onChange: r => d(l => ({
        ...l,
        ageMax: r
      })),
      placeholder: "Max age (e.g. 12)",
      style: { flex: 1 }
    }), e.ageType === "over" && React.createElement(Input, {
      type: "number",
      value: e.ageMin,
      onChange: r => d(l => ({
        ...l,
        ageMin: r
      })),
      placeholder: "Min age (e.g. 35)",
      style: { flex: 1 }
    }), e.ageType === "range" && React.createElement(React.Fragment, null, React.createElement(Input, {
      type: "number",
      value: e.ageMin,
      onChange: r => d(l => ({
        ...l,
        ageMin: r
      })),
      placeholder: "Min",
      style: { flex: 1 }
    }), React.createElement(Input, {
      type: "number",
      value: e.ageMax,
      onChange: r => d(l => ({
        ...l,
        ageMax: r
      })),
      placeholder: "Max",
      style: { flex: 1 }
    })), e.ageType === "split" && React.createElement(Input, {
      type: "number",
      value: e.ageSplit,
      onChange: r => d(l => ({
        ...l,
        ageSplit: r
      })),
      placeholder: "Age threshold (e.g. 35)",
      style: { flex: 1 }
    }))), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Age as of (cutoff date)"), React.createElement(Input, {
      type: "date",
      value: e.cutoffDate,
      onChange: r => d(l => ({
        ...l,
        cutoffDate: r
      })),
      placeholder: "Optional \u2013 defaults to today",
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Tier Restriction"), React.createElement(Select, {
      value: e.tier,
      onChange: r => d(l => ({
        ...l,
        tier: r
      })),
      options: [
        {
          value: "",
          label: "No restriction"
        },
        ...TIERS.map(r => ({
          value: r.name,
          label: r.name
        }))
      ],
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "DUPR Rating (min \u2013 max)"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 5
      }
    }, React.createElement(Input, {
      type: "number",
      value: e.duprMin,
      onChange: r => d(l => ({
        ...l,
        duprMin: r
      })),
      placeholder: "Min (e.g. 3.5)",
      style: { flex: 1 },
      step: "0.1"
    }), React.createElement(Input, {
      type: "number",
      value: e.duprMax,
      onChange: r => d(l => ({
        ...l,
        duprMax: r
      })),
      placeholder: "Max (e.g. 5.0)",
      style: { flex: 1 },
      step: "0.1"
    }))), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "DUPR rating updated after"), React.createElement(Input, {
      type: "date",
      value: e.duprUpdatedAfter || "",
      onChange: r => d(l => ({
        ...l,
        duprUpdatedAfter: r
      })),
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Description"), React.createElement(Input, {
      value: e.description,
      onChange: r => d(l => ({
        ...l,
        description: r
      })),
      placeholder: "Explain criteria...",
      style: { marginTop: 5 }
    }))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 16
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: m
    }, "Cancel"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: p,
      disabled: !e.name
    }, "Create Category"))));
  }, PlayerSearchSelect = ({
    players: m,
    value: c,
    onChange: e,
    placeholder: d = "Search player...",
    excludeIds: p = [],
    currentUserId: r = null
  }) => {
    const [l, n] = useState(""), [R, S] = useState(!1), v = useRef(null);
    useEffect(() => {
      const f = u => {
        v.current && !v.current.contains(u.target) && (S(!1), n(""));
      };
      return document.addEventListener("mousedown", f), () => document.removeEventListener("mousedown", f);
    }, []);
    let M = [...m].filter(f => !p.includes(f.id));
    if (l && (M = M.filter(f => f.fullName.toLowerCase().includes(l.toLowerCase()) || f.id.toLowerCase().includes(l.toLowerCase()) || f.city.toLowerCase().includes(l.toLowerCase()))), r) {
      const f = m.find(u => u.id === r);
      if (f) {
        const u = new Set(f.savedPartners || []);
        M.sort((k, G) => (u.has(G.id) ? 1 : 0) - (u.has(k.id) ? 1 : 0));
      }
    }
    const z = m.find(f => f.id === c), g = useCallback(f => {
        S(!1), n(""), requestAnimationFrame(() => e(f));
      }, [e]);
    return React.createElement("div", {
      ref: v,
      style: { position: "relative" }
    }, React.createElement("div", {
      onClick: () => S(!R),
      style: {
        padding: "8px 12px",
        background: C.card,
        border: `1px solid ${ R ? C.lime : C.border }`,
        borderRadius: 10,
        color: C.text,
        fontSize: 13,
        cursor: "pointer",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        minHeight: 36
      }
    }, React.createElement("span", { style: { color: z ? C.text : C.textDim } }, z ? `${ z.fullName } (${ z.bestRating })` : "Select player..."), React.createElement(Ic, {
      t: "chevron",
      s: 14
    })), R && React.createElement("div", {
      style: {
        position: "absolute",
        top: "100%",
        left: 0,
        right: 0,
        marginTop: 4,
        background: C.surface,
        border: `1px solid ${ C.border }`,
        borderRadius: 12,
        boxShadow: "0 8px 32px rgba(0,0,0,0.4)",
        zIndex: 60,
        maxHeight: 280,
        overflow: "hidden"
      }
    }, React.createElement("div", {
      style: {
        padding: 8,
        borderBottom: `1px solid ${ C.border }`
      }
    }, React.createElement(Input, {
      value: l,
      onChange: n,
      placeholder: d,
      icon: "search"
    })), React.createElement("div", {
      style: {
        maxHeight: 200,
        overflow: "auto"
      }
    }, r && M.filter(f => {
      const u = m.find(k => k.id === r);
      return u && (u.savedPartners || []).includes(f.id);
    }).length > 0 && React.createElement("div", {
      style: {
        fontSize: 8,
        color: C.gold,
        fontWeight: 700,
        padding: "4px 12px",
        textTransform: "uppercase"
      }
    }, "\u2B50 Saved Partners"), M.slice(0, 100).map(f => {
      const u = m.find(G => G.id === r), k = u && (u.savedPartners || []).includes(f.id);
      return React.createElement("div", {
        key: f.id,
        onMouseDown: G => {
          G.preventDefault(), G.stopPropagation(), g(f.id);
        },
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "8px 12px",
          cursor: "pointer",
          background: c === f.id ? `${ C.lime }15` : k ? `${ C.gold }08` : "transparent",
          borderBottom: `1px solid ${ C.border }`,
          userSelect: "none"
        }
      }, React.createElement(Avi, {
        name: f.firstName,
        color: getTier(f.bestRating).color,
        size: 26,
        gender: f.gender,
        imageUrl: f.avatarUrl
      }), React.createElement("div", { style: { flex: 1 } }, React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 600,
          color: C.text
        }
      }, f.fullName), React.createElement("div", {
        style: {
          fontSize: 8,
          color: C.textDim
        }
      }, f.id, " \xB7 ", f.city, " \xB7 ", getTier(f.bestRating).emoji, " ", f.bestRating)), k && React.createElement("span", {
        style: {
          color: C.gold,
          fontSize: 12
        }
      }, "\u2B50"));
    }), M.length === 0 && React.createElement("div", {
      style: {
        padding: 14,
        textAlign: "center",
        color: C.textDim,
        fontSize: 11
      }
    }, "No players found"))));
  }, RegisterTab = ({
    players: m,
    setPlayers: c,
    currentUser: e,
    setCurrentUser: d,
    setTab: p
  }) => {
    const [r, l] = useState(1), [n, R] = useState({
        firstName: "",
        lastName: "",
        gender: "M",
        dob: "",
        phone: "",
        hand: "Right",
        city: "Mumbai",
        avatarUrl: "",
        duprId: "",
        duprRating: "",
        duprLastUpdated: ""
      }), [S, v] = useState(!1), [M, z] = useState(""), [g, f] = useState(null), [u, k] = useState(null), G = [
        useRef(null),
        useRef(null),
        useRef(null),
        useRef(null)
      ], O = useRef(null), K = n.firstName && n.lastName && n.dob ? genId(n.firstName, n.lastName, n.dob) : "\u2014", J = w => {
        const P = w.target.files[0];
        if (P) {
          f(P);
          const ne = new FileReader();
          ne.onload = Y => {
            k(Y.target.result), R(ee => ({
              ...ee,
              avatarUrl: Y.target.result
            }));
          }, ne.readAsDataURL(P);
        }
      }, D = () => {
        if (!n.firstName.trim() || !n.lastName.trim() || !n.dob || !n.phone)
          return;
        const w = genId(n.firstName, n.lastName, n.dob), P = u || n.avatarUrl || `https://ui-avatars.com/api/?name=${ n.firstName }+${ n.lastName }&background=${ n.gender === "M" ? "2dd4bf" : "f472b6" }&color=fff&size=200`, ne = {
            id: w,
            firstName: n.firstName.trim(),
            lastName: n.lastName.trim(),
            fullName: `${ n.firstName.trim() } ${ n.lastName.trim() }`,
            gender: n.gender,
            dob: n.dob,
            phone: n.phone,
            hand: n.hand,
            city: n.city,
            playingSince: 2026,
            ratings: n.gender === "M" ? {
              [ratingKey(DEFAULT_SPORT, "ms")]: 750,
              [ratingKey(DEFAULT_SPORT, "md")]: 750,
              [ratingKey(DEFAULT_SPORT, "mx")]: 750
            } : {
              [ratingKey(DEFAULT_SPORT, "ws")]: 750,
              [ratingKey(DEFAULT_SPORT, "wd")]: 750,
              [ratingKey(DEFAULT_SPORT, "mx")]: 750
            },
            bestRating: 750,
            wins: 0,
            losses: 0,
            skills: SKILLS.reduce((Y, ee) => ({
              ...Y,
              [ee]: 0
            }), {}),
            skillRatingsCount: 0,
            tags: {},
            matchHistory: [],
            registered: !0,
            savedPartners: [],
            avatarUrl: P,
            medals: [],
            partnerStats: {},
            duprId: n.duprId || "",
            duprRating: n.duprRating ? parseFloat(n.duprRating) : null,
            duprLastUpdated: n.duprLastUpdated || null
          };
        c(Y => [
          ...Y,
          ne
        ]), d(ne), p("home");
      }, I = (w, P) => {
        const ne = M.split("");
        ne[w] = P, z(ne.join("")), P && w < 3 && G[w + 1].current && G[w + 1].current.focus();
      }, ae = (w, P) => {
        P.key === "Backspace" && !M[w] && w > 0 && G[w - 1].current && G[w - 1].current.focus();
      };
    return React.createElement("div", {
      style: {
        maxWidth: 440,
        margin: "0 auto"
      }
    }, React.createElement("div", {
      style: {
        textAlign: "center",
        marginBottom: 24
      }
    }, React.createElement("div", {
      style: {
        fontSize: 36,
        marginBottom: 6
      }
    }, "\u26A1"), React.createElement("h2", {
      style: {
        fontSize: 20,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 4px"
      }
    }, "Join RISE Sports"), React.createElement("p", {
      style: {
        fontSize: 12,
        color: C.textDim,
        margin: 0
      }
    }, "Free registration \xB7 Start at Intermediate tier")), React.createElement("div", {
      style: {
        display: "flex",
        gap: 4,
        marginBottom: 20
      }
    }, [
      "Phone",
      "Profile",
      "Confirm"
    ].map((w, P) => React.createElement("div", {
      key: P,
      style: {
        flex: 1,
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        height: 3,
        borderRadius: 2,
        background: r > P ? C.lime : C.border,
        marginBottom: 4
      }
    }), React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: r > P ? C.lime : C.textDim,
        textTransform: "uppercase"
      }
    }, w)))), r === 1 && React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700,
        letterSpacing: 1
      }
    }, "Phone Number"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 6,
        marginBottom: 14
      }
    }, React.createElement("div", {
      style: {
        padding: "10px 14px",
        background: C.card,
        border: `1px solid ${ C.border }`,
        borderRadius: 10,
        color: C.textMuted,
        fontSize: 13,
        fontWeight: 600
      }
    }, "+91"), React.createElement(Input, {
      value: n.phone,
      onChange: w => R(P => ({
        ...P,
        phone: w
      })),
      placeholder: "98XXXXXXXX",
      type: "tel",
      style: { flex: 1 }
    })), S ? React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700,
        letterSpacing: 1
      }
    }, "Enter OTP"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        margin: "6px 0 14px"
      }
    }, [
      0,
      1,
      2,
      3
    ].map(w => React.createElement("input", {
      key: w,
      ref: G[w],
      maxLength: 1,
      value: M[w] || "",
      onChange: P => I(w, P.target.value),
      onKeyDown: P => ae(w, P),
      style: {
        width: 48,
        height: 50,
        textAlign: "center",
        background: C.card,
        border: `2px solid ${ M[w] ? C.lime : C.border }`,
        borderRadius: 12,
        color: C.text,
        fontSize: 22,
        fontWeight: 800,
        outline: "none",
        fontFamily: "inherit"
      }
    }))), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: () => l(2),
      disabled: M.length < 4
    }, React.createElement(Ic, {
      t: "check",
      s: 14
    }), " Verify")) : React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: () => v(!0),
      disabled: n.phone.length < 10
    }, React.createElement(Ic, {
      t: "phone",
      s: 14
    }), " Send OTP")), r === 2 && React.createElement("div", null, React.createElement("div", {
      style: {
        textAlign: "center",
        marginBottom: 16
      }
    }, React.createElement("div", {
      onClick: () => O.current?.click(),
      style: {
        cursor: "pointer",
        display: "inline-block",
        position: "relative"
      }
    }, u || n.avatarUrl ? React.createElement("img", {
      src: u || n.avatarUrl,
      alt: "Profile",
      style: {
        width: 80,
        height: 80,
        borderRadius: "50%",
        objectFit: "cover",
        border: `2px solid ${ C.lime }`
      }
    }) : React.createElement(Avi, {
      name: n.firstName || "?",
      color: n.gender === "F" ? C.pink : C.teal,
      size: 80,
      gender: n.gender
    }), React.createElement("div", {
      style: {
        position: "absolute",
        bottom: 0,
        right: 0,
        width: 28,
        height: 28,
        borderRadius: "50%",
        background: C.lime,
        display: "flex",
        alignItems: "center",
        justifyContent: "center"
      }
    }, React.createElement(Ic, {
      t: "plus",
      s: 14
    }))), React.createElement("input", {
      ref: O,
      type: "file",
      accept: "image/*",
      onChange: J,
      style: { display: "none" }
    }), React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        marginTop: 4
      }
    }, "Tap to upload photo")), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginBottom: 12
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "First Name *"), React.createElement(Input, {
      value: n.firstName,
      onChange: w => R(P => ({
        ...P,
        firstName: w
      })),
      placeholder: "Faisal",
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Last Name *"), React.createElement(Input, {
      value: n.lastName,
      onChange: w => R(P => ({
        ...P,
        lastName: w
      })),
      placeholder: "Khan",
      style: { marginTop: 5 }
    }))), React.createElement("div", { style: { marginBottom: 12 } }, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Profile Image URL"), React.createElement(Input, {
      value: n.avatarUrl,
      onChange: w => R(P => ({
        ...P,
        avatarUrl: w
      })),
      placeholder: "https://example.com/photo.jpg",
      style: { marginTop: 5 }
    })), React.createElement("div", { style: { marginBottom: 12 } }, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "DUPR ID (optional)"), React.createElement(Input, {
      value: n.duprId || "",
      onChange: w => R(P => ({
        ...P,
        duprId: w
      })),
      placeholder: "e.g. DUPR12345",
      style: { marginTop: 5 }
    })), React.createElement("div", { style: { marginBottom: 12 } }, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "DUPR Rating (optional)"), React.createElement(Input, {
      type: "number",
      step: "0.01",
      value: n.duprRating || "",
      onChange: w => R(P => ({
        ...P,
        duprRating: w,
        duprLastUpdated: w ? new Date().toISOString() : ""
      })),
      placeholder: "e.g. 4.25",
      style: { marginTop: 5 }
    }), React.createElement("div", {
      style: {
        fontSize: 8,
        color: C.textDim,
        marginTop: 3
      }
    }, "You can update this later in your profile")), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginBottom: 12
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Date of Birth *"), React.createElement(Input, {
      type: "date",
      value: n.dob,
      onChange: w => R(P => ({
        ...P,
        dob: w
      })),
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Gender *"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 5
      }
    }, [
      {
        v: "M",
        l: "Male"
      },
      {
        v: "F",
        l: "Female"
      }
    ].map(w => React.createElement("button", {
      key: w.v,
      onClick: () => R(P => ({
        ...P,
        gender: w.v
      })),
      style: {
        flex: 1,
        padding: "10px",
        borderRadius: 10,
        border: `1px solid ${ n.gender === w.v ? C.lime : C.border }`,
        background: n.gender === w.v ? `${ C.lime }18` : C.card,
        color: n.gender === w.v ? C.lime : C.textDim,
        fontWeight: 600,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, w.l))))), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 12,
        marginBottom: 12
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Playing Hand"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 5
      }
    }, [
      "Right",
      "Left"
    ].map(w => React.createElement("button", {
      key: w,
      onClick: () => R(P => ({
        ...P,
        hand: w
      })),
      style: {
        flex: 1,
        padding: "10px",
        borderRadius: 10,
        border: `1px solid ${ n.hand === w ? C.lime : C.border }`,
        background: n.hand === w ? `${ C.lime }18` : C.card,
        color: n.hand === w ? C.lime : C.textDim,
        fontWeight: 600,
        fontSize: 12,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, w)))), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "City"), React.createElement(Input, {
      value: n.city,
      onChange: w => R(P => ({
        ...P,
        city: w
      })),
      placeholder: "Mumbai",
      style: { marginTop: 5 }
    }))), React.createElement("div", {
      style: {
        background: `${ C.lime }08`,
        borderRadius: 12,
        padding: 12,
        border: `1px solid ${ C.lime }22`,
        marginBottom: 14
      }
    }, React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 3
      }
    }, "Your RISE Sports ID"), React.createElement("div", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: C.lime,
        fontFamily: "monospace"
      }
    }, K)), React.createElement("div", {
      style: {
        display: "flex",
        gap: 10
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => l(1)
    }, "Back"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: () => l(3),
      disabled: !n.firstName || !n.lastName || !n.dob
    }, "Next"))), r === 3 && React.createElement("div", null, React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 16,
        padding: 18,
        border: `1px solid ${ C.border }`,
        marginBottom: 14,
        textAlign: "center"
      }
    }, u || n.avatarUrl ? React.createElement("img", {
      src: u || n.avatarUrl,
      alt: "Profile",
      style: {
        width: 60,
        height: 60,
        borderRadius: "50%",
        objectFit: "cover",
        border: `2px solid ${ C.lime }`
      }
    }) : React.createElement(Avi, {
      name: n.firstName,
      color: n.gender === "F" ? C.pink : C.teal,
      size: 60,
      gender: n.gender
    }), React.createElement("div", {
      style: {
        fontSize: 17,
        fontWeight: 800,
        color: C.text,
        marginTop: 8
      }
    }, n.firstName, " ", n.lastName), React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 600,
        color: C.lime,
        fontFamily: "monospace"
      }
    }, K), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 8,
        marginTop: 12,
        textAlign: "left"
      }
    }, [
      [
        "Phone",
        `+91 ${ n.phone }`
      ],
      [
        "Gender",
        n.gender === "M" ? "Male" : "Female"
      ],
      [
        "DOB",
        n.dob
      ],
      [
        "Hand",
        n.hand
      ],
      [
        "City",
        n.city
      ],
      [
        "Rating",
        "750"
      ]
    ].map(([w, P]) => React.createElement("div", { key: w }, React.createElement("div", {
      style: {
        fontSize: 8,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, w), React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text
      }
    }, P))))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 10
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => l(2)
    }, "Back"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: D
    }, React.createElement(Ic, {
      t: "check",
      s: 14
    }), " Complete Registration"))));
  }, CreateTab = ({
    players: m,
    setPlayers: c,
    tournaments: e,
    setTournaments: d,
    activeTourney: p,
    setActiveTourney: r,
    categories: l,
    setCategories: n,
    currentUser: R,
    setTab: S
  }) => {
    const [v, M] = useState(1), [z, g] = useState(""), [f, u] = useState(["md_open"]), [k, G] = useState("4"), [O, K] = useState("4"), [J, D] = useState("100"), [I, ae] = useState("15"), [w, P] = useState("2"), [ne, Y] = useState("4"), [ee, L] = useState("09:00"), [se, ge] = useState(new Date().toISOString().split("T")[0]), [ce, le] = useState(""), [i, o] = useState(""), [t, a] = useState([]), [W, q] = useState(""), [E, ie] = useState({}), [V, X] = useState(0), [tourFormat, setTourFormat] = useState("group_ko"), [sport, setSport] = useState(DEFAULT_SPORT), [winBy2, setWinBy2] = useState(!0), [goldenAt, setGoldenAt] = useState("auto"), [switchAt, setSwitchAt] = useState(""), [scoreType, setScoreType] = useState(""), [trackScores, setTrackScores] = useState(true), [useSchedule, setUseSchedule] = useState(false), [matchMins, setMatchMins] = useState("20"), j = Math.min(20, Math.max(1, parseInt(k) || 4)), $ = Math.max(2, parseInt(O) || 4), T = parseInt(J) || 100, A = parseInt(ne) || 4, x = l.find(h => h.id === f[V]) || l[0], U = x ? [
        "md",
        "wd",
        "mx",
        "gn"
      ].includes(x.format) : !1;
    useEffect(() => {
      if (v === 3) {
        const h = [];
        f.forEach(B => {
          const b = t.filter(N => N.catId === B);
          b.length > 0 ? h.push(...b) : Array.from({ length: j }, (N, _) => h.push({
            catId: B,
            label: String.fromCharCode(65 + _),
            teams: [],
            court: _ % A + 1
          }));
        }), JSON.stringify(h) !== JSON.stringify(t) && a(h);
      }
    }, [v]);
    const re = () => u([
        ...f,
        ""
      ]), ue = (h, B) => {
        const b = [...f];
        b[h] = B, u(b);
      }, Re = h => {
        if (f.length <= 1)
          return;
        const B = f.filter((b, N) => N !== h);
        u(B), V >= B.length && X(Math.max(0, B.length - 1));
      }, be = m.filter(h => x && checkEligibility(h, x, x.cutoffDate || se).length === 0), ve = t.filter(h => h.catId === f[V]), me = new Set();
    t.forEach(h => h.teams.forEach(B => {
      B.p1 ? (me.add(B.p1.id), me.add(B.p2.id)) : B.id && me.add(B.id);
    }));
    const Se = be.filter(h => !me.has(h.id) && (!W || h.fullName.toLowerCase().includes(W.toLowerCase()) || h.id.toLowerCase().includes(W.toLowerCase()))), he = (h, B) => {
        const b = rtg(h, x.format, x.sport), N = rtg(B, x.format, x.sport);
        return c(_ => _.map(H => H.id === h.id && !H.savedPartners.includes(B.id) ? {
          ...H,
          savedPartners: [
            ...H.savedPartners,
            B.id
          ]
        } : H.id === B.id && !H.savedPartners.includes(h.id) ? {
          ...H,
          savedPartners: [
            ...H.savedPartners,
            h.id
          ]
        } : H)), {
          id: `${ h.id }+${ B.id }`,
          fullName: `${ h.fullName } | ${ B.fullName }`,
          p1: h,
          p2: B,
          bestRating: Math.round((b + N) / 2),
          firstName: h.firstName,
          gender: h.gender
        };
      }, Me = (h, B) => {
        const b = m.find(N => N.id === B);
        b && a(N => N.map(_ => _.catId === f[V] && _.label === String.fromCharCode(65 + h) ? {
          ..._,
          teams: [
            ..._.teams,
            b
          ]
        } : _));
      }, De = (h, B) => ie(b => ({
        ...b,
        [h]: B
      })), s = (h, B) => {
        const b = m.find(H => H.id === E[h]), N = m.find(H => H.id === B);
        if (!b || !N)
          return;
        if (x.format === "mx" && b.gender === N.gender) {
          alert("Mixed Doubles requires one male and one female.");
          return;
        }
        const _ = he(b, N);
        a(H => H.map(de => de.catId === f[V] && de.label === String.fromCharCode(65 + h) ? {
          ...de,
          teams: [
            ...de.teams,
            _
          ]
        } : de)), ie(H => {
          const de = { ...H };
          return delete de[h], de;
        });
      }, y = h => ie(B => {
        const b = { ...B };
        return delete b[h], b;
      }), F = (h, B) => a(b => b.map(N => N.catId === f[V] && N.label === String.fromCharCode(65 + h) ? {
        ...N,
        teams: N.teams.filter(_ => _.id !== B)
      } : N)), Q = () => {
        let h = be.filter(b => !me.has(b.id));
        if (h.length === 0)
          return;
        if (U && x.format === "mx") {
          const b = h.filter(Z => Z.gender === "M"), N = h.filter(Z => Z.gender === "F"), _ = Math.min(b.length, N.length), H = b.sort((Z, oe) => rtg(oe, x.format, x.sport) - rtg(Z, x.format, x.sport)).slice(0, _), de = N.sort((Z, oe) => rtg(oe, x.format, x.sport) - rtg(Z, x.format, x.sport)).slice(0, _), Be = [];
          for (let Z = 0; Z < _; Z++) {
            const oe = H[Z], ye = de[Z];
            Be.push({
              id: `${ oe.id }+${ ye.id }`,
              fullName: `${ oe.fullName } | ${ ye.fullName }`,
              p1: oe,
              p2: ye,
              bestRating: Math.round((rtg(oe, x.format, x.sport) + rtg(ye, x.format, x.sport)) / 2),
              firstName: oe.firstName,
              gender: oe.gender
            });
          }
          const ke = Be.sort((Z, oe) => oe.bestRating - Z.bestRating), xe = ve.map(Z => ({
              ...Z,
              teams: []
            }));
          let fe = 0, we = 1, Ce = 0;
          for (; Ce < ke.length && xe.some(Z => Z.teams.length < $);)
            xe[fe].teams.length < $ && (xe[fe].teams.push(ke[Ce]), Ce++), fe += we, (fe >= xe.length || fe < 0) && (we *= -1, fe += we);
          a(Z => {
            const oe = [...Z];
            return xe.forEach(ye => {
              const ze = oe.findIndex(Te => Te.catId === ye.catId && Te.label === ye.label);
              ze >= 0 && (oe[ze] = ye);
            }), oe;
          });
          return;
        }
        const B = seededAutoFill(h, ve, $, U, x.format);
        a(b => {
          const N = [...b];
          return B.forEach(_ => {
            const H = N.findIndex(de => de.catId === _.catId && de.label === _.label);
            H >= 0 && (N[H] = _);
          }), N;
        });
      }, te = (h, B) => {
        a(b => b.map(N => N.catId === f[V] && N.label === String.fromCharCode(65 + h) ? {
          ...N,
          court: parseInt(B) || null
        } : N));
      }, pe = () => {
        const h = [];
        if (f.forEach(b => {
            const N = l.find(H => H.id === b);
            if (!N)
              return;
            t.filter(H => H.catId === b).forEach(H => {
              if (H.teams.length < 2)
                return;
              const de = genRR(H.teams.length), Be = schedNoBB(de), ke = [];
              let xe = 1;
              const fe = H.court || 1;
              Be.forEach((we, Ce) => {
                we.forEach(([Z, oe]) => {
                  ke.push({
                    id: uid(),
                    matchNum: xe++,
                    round: Ce + 1,
                    teamA: H.teams[Z],
                    teamB: H.teams[oe],
                    scoreA: null,
                    scoreB: null,
                    winner: null,
                    played: !1,
                    court: fe
                  });
                });
              }), h.push({
                catId: b,
                catName: N.name,
                catShort: N.short,
                label: H.label,
                teams: H.teams,
                matches: ke,
                format: N.format,
                court: fe
              });
            });
          }), h.length === 0)
          return;
        useSchedule && buildTimedSchedule(h, A, ee, parseInt(matchMins) || 20);
        let kb0 = {}, lb0 = {}, gf0 = {}, am0 = null, phase0 = "group", groups0 = h;
        const catList0 = f.map(b => l.find(N => N.id === b)).filter(Boolean);
        if (tourFormat === "single_elim" || tourFormat === "double_elim") {
          let ok0 = !0;
          catList0.forEach((cat, ci) => {
            if (!ok0)
              return;
            const gs = h.filter(g2 => g2.catId === cat.id || g2.catName === cat.name);
            const tms = gs.flatMap(g2 => g2.teams || []);
            if (tms.length < 2) {
              alert(`${ cat.name }: need at least 2 teams for a bracket.`), ok0 = !1;
              return;
            }
            if (tourFormat === "double_elim") {
              if (![
                  4,
                  8,
                  16
                ].includes(tms.length)) {
                alert(`Double elimination needs exactly 4, 8 or 16 teams per category (${ cat.name } has ${ tms.length }).`), ok0 = !1;
                return;
              }
              lb0[ci] = buildLoserBracket(tms.length), gf0[ci] = {
                p1: null,
                p2: null,
                s1: null,
                s2: null,
                winner: null,
                played: !1
              };
            }
            kb0[ci] = seedBracket(tms);
          });
          if (!ok0)
            return;
          phase0 = "knockout", groups0 = [];
        } else if (tourFormat === "americano_t" || tourFormat === "mexicano_t") {
          const pmap = {};
          h.forEach(g2 => (g2.teams || []).forEach(tm => {
            (tm.p1 ? [
              tm.p1,
              tm.p2
            ] : [tm]).forEach(pp => {
              pp && (pmap[pp.id] = pp);
            });
          }));
          const plist = Object.values(pmap);
          if (plist.length < 4) {
            alert("Americano / Mexicano needs at least 4 players.");
            return;
          }
          am0 = {
            players: plist.map(x => ({
              id: x.id,
              fullName: x.fullName
            })),
            points: {},
            games: {},
            rounds: []
          }, phase0 = "americano", groups0 = [];
        }
        const B = {
          id: uid(),
          name: z || "New Tournament",
          entryFee: T,
          pointsToWin: parseInt(I) || 15,
          topNAdvance: parseInt(w) || 2,
          groups: groups0,
          phase: phase0,
          sport: sport,
          scoring: buildScoring(I, winBy2, goldenAt, switchAt, scoreType),
          tourFormat: tourFormat,
          americano: am0,
          loserBrackets: lb0,
          grandFinals: gf0,
          knockoutBrackets: kb0,
          champions: {},
          status: "active",
          categories: f.map(b => l.find(N => N.id === b)).filter(Boolean),
          numCourts: A,
          startTime: ee,
          tournamentDate: se,
          venue: ce,
          googleLocation: i,
          trackScores: trackScores,
          useSchedule: useSchedule,
          matchMins: parseInt(matchMins) || 20
        };
        d(b => [
          ...b,
          B
        ]), r(B), S("tourney");
      };
    return React.createElement("div", null, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16
      }
    }, React.createElement("button", {
      onClick: () => S("home"),
      style: {
        background: C.card,
        border: "none",
        borderRadius: 8,
        padding: "8px 12px",
        color: C.textMuted,
        cursor: "pointer"
      }
    }, React.createElement(Ic, {
      t: "back",
      s: 16
    })), React.createElement("h2", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: C.text,
        margin: 0
      }
    }, "Create Tournament")), React.createElement("div", {
      /* Numbered stepper: completed steps tick, the current one is filled, the
         rest are outlined. Steps already passed are clickable so an organiser
         can go back and change an answer without losing the later ones. */
      style: {
        display: "flex",
        alignItems: "flex-start",
        marginBottom: 22,
        padding: "14px 6px 12px",
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${ C.border }`
      }
    }, [
      "Basics",
      "Format",
      "Teams",
      "Launch"
    ].map((h, B) => {
      const num = B + 1, done = v > num, current = v === num;
      return React.createElement(React.Fragment, { key: B },
        B > 0 && React.createElement("div", {
          style: {
            flex: 1,
            height: 3,
            borderRadius: 2,
            background: v > B ? C.lime : C.border,
            marginTop: 18.5,
            marginLeft: -4,
            marginRight: -4
          }
        }),
        React.createElement("div", {
          onClick: () => done && M(num),
          style: {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 5,
            cursor: done ? "pointer" : "default",
            minWidth: 62
          }
        }, React.createElement("div", {
          style: {
            width: 40,
            height: 40,
            borderRadius: "50%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: current ? 17 : 15,
            fontWeight: 800,
            fontFamily: "inherit",
            lineHeight: 1,
            background: done || current ? C.lime : "transparent",
            color: done || current ? "#fff" : C.textDim,
            border: `2px solid ${ done || current ? C.lime : C.border }`,
            boxShadow: current ? `0 0 0 4px ${ C.lime }24` : "none",
            transition: "background .15s ease, box-shadow .15s ease"
          }
        }, done ? "✓" : num), React.createElement("div", {
          style: {
            fontSize: 11,
            fontWeight: current || done ? 800 : 600,
            color: current ? C.lime : done ? C.text : C.textDim,
            textAlign: "center",
            letterSpacing: .01
          }
        }, h)));
    })), v === 1 && React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Tournament Name"), React.createElement(Input, {
      value: z,
      onChange: g,
      placeholder: "e.g. BNI Open 2026",
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Sport"), React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 6
      }
    }, Object.values(SPORTS).map(sp => React.createElement("button", {
      key: sp.id,
      onClick: () => {
        setSport(sp.id);
        /* Drop any selected category this sport cannot play, and move the
           points target onto one this sport actually uses — badminton is not
           played to 11, and carrom is not played to 21. */
        u(f.filter(id => {
          const c0 = l.find(x0 => x0.id === id);
          return c0 && formatsFor(sp.id).includes(c0.format);
        }));
        const tg = sportOf(sp.id).targets || [];
        tg.length && !tg.includes(Number(I)) && ae(String(tg[0]));
      },
      style: {
        padding: "8px 12px",
        minHeight: 40,
        borderRadius: 9,
        border: `1px solid ${ sport === sp.id ? C.lime : C.border }`,
        background: sport === sp.id ? C.lime : C.card,
        color: sport === sp.id ? "#fff" : C.text,
        fontSize: 12,
        fontWeight: 700,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, sp.emoji, " ", sp.name))), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim,
        marginTop: 6
      }
    }, SPORTS[sport].playersPerCourt, " per ", SPORTS[sport].court, SPORTS[sport].setBased ? " \xB7 scored by sets" : ` \xB7 to ${ SPORTS[sport].scoring.target }`)), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Categories (add multiple)"), React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 6,
        marginTop: 6,
        marginBottom: 4
      }
    }, l.filter(ct => formatsFor(sport).includes(ct.format)).map(ct => {
      const on = f.includes(ct.id);
      return React.createElement("button", {
        key: ct.id,
        onClick: () => u(prev => on ? prev.length > 1 ? prev.filter(x => x !== ct.id) : prev : [
          ...prev,
          ct.id
        ]),
        style: {
          padding: "7px 12px",
          borderRadius: 20,
          border: `1.5px solid ${ on ? C.lime : C.border }`,
          background: on ? `${ C.lime }20` : C.card,
          color: on ? C.lime : C.textMuted,
          fontWeight: 700,
          fontSize: 11,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "all .15s"
        }
      }, on ? "\u2713 " : "", ct.short || ct.name);
    })), f.map((h, B) => React.createElement("div", {
      key: B,
      style: {
        display: "flex",
        gap: 6,
        marginTop: 6,
        alignItems: "flex-start"
      }
    }, React.createElement("div", { style: { flex: 1 } }, React.createElement(CategorySelector, {
      categories: l,
      value: h,
      onChange: b => ue(B, b),
      onAddCategory: b => n(N => [
        ...N,
        b
      ])
    })), f.length > 1 && React.createElement("button", {
      onClick: () => Re(B),
      style: {
        background: "none",
        border: "none",
        color: C.red,
        cursor: "pointer",
        marginTop: 18
      }
    }, React.createElement(Ic, {
      t: "x",
      s: 18
    })))), React.createElement(Btn, {
      small: !0,
      onClick: re,
      style: { marginTop: 6 },
      color: C.teal
    }, React.createElement(Ic, {
      t: "plus",
      s: 12
    }), " Add Another Category")), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Venue"), React.createElement(Input, {
      value: ce,
      onChange: le,
      placeholder: "e.g. BNI Sports Complex",
      icon: "map",
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Google Maps Link"), React.createElement(Input, {
      value: i,
      onChange: o,
      placeholder: "Paste Google Maps link",
      style: { marginTop: 5 }
    })), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Date"), React.createElement(Input, {
      type: "date",
      value: se,
      onChange: ge,
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Start Time"), React.createElement(Input, {
      type: "time",
      value: ee,
      onChange: L,
      style: { marginTop: 5 }
    }))), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: () => M(2),
      disabled: f.length === 0 || f.some(h => !h)
    }, "Next: Format & Rules ", React.createElement(Ic, {
      t: "chevron",
      s: 14
    }))), v === 2 && React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Groups per Category"), React.createElement(Input, {
      type: "number",
      min: 1,
      max: 20,
      value: k,
      onChange: G,
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Teams/Group"), React.createElement(Input, {
      type: "number",
      min: 2,
      max: 32,
      value: O,
      onChange: K,
      style: { marginTop: 5 }
    }))), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Fee \u20B9"), React.createElement(Input, {
      type: "number",
      value: J,
      onChange: D,
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Points to Win"), React.createElement(Select, {
      value: I,
      onChange: ae,
      options: (sportOf(sport).targets || [11, 15, 21]).map(h => ({
        value: String(h),
        label: String(h)
      })),
      style: { marginTop: 5 }
    }), React.createElement("div", {
      style: {
        marginTop: 8,
        padding: 8,
        borderRadius: 9,
        background: C.cardAlt,
        border: `1px solid ${ C.border }`
      }
    }, sportOf(sport).setBased ? React.createElement("div", {
      /* Tennis and padel are scored by games and sets, not a point target, so
         none of these controls mean anything for them. */
      style: { fontSize: 11, color: C.textDim, lineHeight: 1.5 }
    }, React.createElement("b", { style: { color: C.text } }, sportOf(sport).name),
      " is scored by games and sets. Enter final set scores when the match is done — the live court console does not cover set-based scoring yet."
    ) : React.createElement(React.Fragment, null, sportOf(sport).serveModel === "turns" ? React.createElement("div", {
      /* Carrom and chess are turn-based: there is no serve, so rally vs service
         is not a question that exists. */
      style: { fontSize: 10, color: C.textDim, marginBottom: 8, lineHeight: 1.5 }
    }, React.createElement("b", { style: { color: C.text } }, sportOf(sport).name),
      " is played in turns, so there is no serve — every point counts for whoever wins it."
    ) : React.createElement(React.Fragment, null, React.createElement("div", {
      style: { fontSize: 9, fontWeight: 800, letterSpacing: .09, textTransform: "uppercase", color: C.textDim, marginBottom: 5 }
    }, "How points are scored"), React.createElement("div", {
      style: { display: "flex", gap: 6, marginBottom: 8 }
    }, [
      { v: "rally", label: "Rally points", hint: "every rally scores" },
      { v: "service", label: "Service points", hint: "only the server scores" }
    ].map(opt => React.createElement("button", {
      key: opt.v,
      onClick: () => setScoreType(opt.v),
      style: {
        flex: 1,
        minHeight: 44,
        borderRadius: 8,
        fontFamily: "inherit",
        cursor: "pointer",
        padding: "4px 6px",
        border: `1px solid ${ scoreType === opt.v ? C.lime : C.border }`,
        background: scoreType === opt.v ? C.lime : C.card,
        color: scoreType === opt.v ? "#fff" : C.text
      }
    }, React.createElement("div", { style: { fontSize: 11.5, fontWeight: 800 } }, opt.label),
      React.createElement("div", {
        style: { fontSize: 9, fontWeight: 600, opacity: .8 }
      }, opt.hint))))), (sportOf(sport).targets || []).length === 1 && (sportOf(sport).targets || [])[0] === 1 ? React.createElement("div", {
      /* A chess game is won, drawn or lost — there is no two-point rule to
         configure, and offering one invites a nonsense setting. */
      style: { fontSize: 10, color: C.textDim, lineHeight: 1.5 }
    }, "A game is won, drawn or lost" + (sportOf(sport).draws ? " — draws count for both players." : ".")
    ) : React.createElement(React.Fragment, null, React.createElement("div", {
      style: { fontSize: 9, fontWeight: 800, letterSpacing: .09, textTransform: "uppercase", color: C.textDim, marginBottom: 5 }
    }, "How the game ends"), React.createElement("div", {
      style: { display: "flex", gap: 6, marginBottom: 6 }
    }, [
      { on: !0, label: "Win by 2" },
      { on: !1, label: "Golden point" }
    ].map(opt => React.createElement("button", {
      key: String(opt.on),
      onClick: () => setWinBy2(opt.on),
      style: {
        flex: 1,
        minHeight: 38,
        borderRadius: 8,
        fontFamily: "inherit",
        fontSize: 11.5,
        fontWeight: 700,
        cursor: "pointer",
        border: `1px solid ${ winBy2 === opt.on ? C.lime : C.border }`,
        background: winBy2 === opt.on ? C.lime : C.card,
        color: winBy2 === opt.on ? "#fff" : C.text
      }
    }, opt.label))), winBy2 && React.createElement("div", {
      style: { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }
    }, React.createElement("span", {
      style: { fontSize: 10, color: C.textDim, fontWeight: 700 }
    }, "Two-point rule stops at"), React.createElement(Select, {
      value: goldenAt,
      onChange: setGoldenAt,
      options: [
        {
          value: "auto",
          label: `${ Number(I) + 2 } (default)`
        },
        ...[
          1,
          2,
          3,
          4,
          5,
          6,
          9
        ].map(d => ({
          value: String(Number(I) + d),
          label: String(Number(I) + d)
        })),
        {
          value: "none",
          label: "No cap \u2014 play on"
        }
      ],
      style: { flex: 1, minWidth: 110 }
    })), React.createElement("div", {
      style: { fontSize: 10, color: C.textDim, marginTop: 6, lineHeight: 1.45 }
    }, goldenInfo(I, winBy2, goldenAt, scoreType))))), React.createElement("div", { style: { marginTop: 10 } }, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Change ends at"), React.createElement(Select, {
      value: switchAt,
      onChange: setSwitchAt,
      options: [
        {
          value: "",
          label: "No ends change"
        },
        ...[
          Math.ceil(Number(I) / 2),
          6,
          8,
          11
        ].filter((x2, i2, ar) => x2 < Number(I) && ar.indexOf(x2) === i2).sort((x2, y2) => x2 - y2).map(x2 => ({
          value: String(x2),
          label: `When a side reaches ${ x2 }`
        }))
      ],
      style: { marginTop: 5 }
    }))), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Top N Advance"), React.createElement(Select, {
      value: w,
      onChange: P,
      options: [
        1,
        2,
        3
      ].map(h => ({
        value: String(h),
        label: `Top ${ h }`
      })),
      style: { marginTop: 5 }
    }))), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Total Courts Available"), React.createElement(Select, {
      value: ne,
      onChange: Y,
      options: [
        2,
        3,
        4,
        5,
        6,
        8
      ].map(h => ({
        value: String(h),
        label: `${ h } Courts`
      })),
      style: { marginTop: 5 }
    })), React.createElement("div", { style: { marginTop: 14 } }, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Tournament Format"), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginTop: 6
      }
    }, TOUR_FORMATS.map(ft => React.createElement("button", {
      key: ft.id,
      onClick: () => setTourFormat(ft.id),
      style: {
        textAlign: "left",
        padding: "10px 12px",
        borderRadius: 12,
        border: `1.5px solid ${ tourFormat === ft.id ? C.lime : C.border }`,
        background: tourFormat === ft.id ? `${ C.lime }14` : C.card,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all .15s"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: tourFormat === ft.id ? C.lime : C.text
      }
    }, tourFormat === ft.id ? "\u25C9 " : "\u25CB ", ft.name), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textMuted,
        marginTop: 2
      }
    }, ft.desc), React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.teal,
        marginTop: 2,
        fontWeight: 600
      }
    }, ft.best))))), React.createElement("div", {
      style: {
        marginTop: 14,
        padding: 12,
        background: C.card,
        borderRadius: 10,
        border: `1px solid ${ C.border }`,
        display: "flex",
        flexDirection: "column",
        gap: 10
      }
    }, [
      [
        "Track Match Scores",
        "Enter & rank by scores",
        trackScores,
        () => setTrackScores(!trackScores)
      ],
      [
        "Timed Schedule",
        "Auto-assign clash-free times",
        useSchedule,
        () => setUseSchedule(!useSchedule)
      ]
    ].map((row, ri) => React.createElement("div", {
      key: ri,
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: C.text
      }
    }, row[0]), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, row[1])), React.createElement("button", {
      onClick: row[3],
      style: {
        width: 46,
        height: 26,
        borderRadius: 13,
        border: "none",
        cursor: "pointer",
        background: row[2] ? C.lime : C.border,
        position: "relative",
        transition: "background .15s"
      }
    }, React.createElement("div", {
      style: {
        position: "absolute",
        top: 3,
        left: row[2] ? 23 : 3,
        width: 20,
        height: 20,
        borderRadius: "50%",
        background: "#fff",
        transition: "left .15s"
      }
    })))), useSchedule && React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        borderTop: `1px solid ${ C.border }`,
        paddingTop: 10
      }
    }, React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: C.text
      }
    }, "Minutes per match"), React.createElement(Input, {
      type: "number",
      min: 5,
      max: 120,
      value: matchMins,
      onChange: setMatchMins,
      style: { width: 90 }
    }))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => M(1)
    }, "Back"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: () => M(3),
      disabled: f.length === 0 || f.some(h => !h)
    }, "Next: Assign Teams ", React.createElement(Ic, {
      t: "chevron",
      s: 14
    })))), v === 3 && React.createElement("div", null, f.length > 1 && React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        marginBottom: 10,
        overflowX: "auto"
      }
    }, f.map((h, B) => {
      const b = l.find(N => N.id === h);
      return React.createElement("button", {
        key: B,
        onClick: () => X(B),
        style: {
          padding: "7px 12px",
          borderRadius: 8,
          border: `1px solid ${ V === B ? C.lime : C.border }`,
          background: V === B ? `${ C.lime }18` : C.card,
          color: V === B ? C.lime : C.textDim,
          fontWeight: 600,
          fontSize: 10,
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontFamily: "inherit"
        }
      }, b?.short || b?.name || "Cat");
    })), React.createElement("div", {
      style: {
        padding: "8px 12px",
        background: `${ C.lime }08`,
        borderRadius: 8,
        marginBottom: 10
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.lime
      }
    }, x?.name), React.createElement("div", {
      style: {
        fontSize: 8,
        color: C.textDim
      }
    }, x?.description, " \xB7 ", be.length, " eligible \xB7 ", U ? "Doubles" : "Singles")), React.createElement(Input, {
      value: W,
      onChange: q,
      placeholder: "Search players by name, ID, or city...",
      icon: "search",
      style: { marginBottom: 10 }
    }), React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.textMuted
      }
    }, ve.reduce((h, B) => h + B.teams.length, 0), "/", j * $, " teams (seeded snake draft)"), React.createElement(Btn, {
      small: !0,
      primary: !0,
      onClick: Q
    }, React.createElement(Ic, {
      t: "zap",
      s: 12
    }), " Seeded Auto-Fill")), React.createElement("div", {
      style: {
        padding: "6px 10px",
        background: C.cardAlt,
        borderRadius: 8,
        marginBottom: 8,
        fontSize: 9,
        color: C.textDim
      }
    }, "\uD83D\uDCA1 Each group plays on one court. Assign courts below. ", A, " courts available."), ve.map((h, B) => React.createElement("div", {
      key: `${ h.catId }_${ h.label }`,
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        border: `1px solid ${ C.border }`
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 4,
        flexWrap: "wrap",
        justifyContent: "space-between"
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6
      }
    }, React.createElement("div", {
      style: {
        width: 24,
        height: 24,
        borderRadius: 6,
        background: `${ C.lime }22`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        fontWeight: 800,
        color: C.lime
      }
    }, h.label), React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: C.text
      }
    }, "Group ", h.label), React.createElement(Badge, {
      color: h.teams.length >= $ ? C.lime : C.orange,
      small: !0
    }, h.teams.length, "/", $)), React.createElement("select", {
      value: h.court || "",
      onChange: b => te(B, b.target.value),
      style: {
        padding: "4px 8px",
        background: C.cardAlt,
        border: `1px solid ${ C.border }`,
        borderRadius: 6,
        color: C.text,
        fontSize: 10,
        fontFamily: "inherit"
      }
    }, React.createElement("option", { value: "" }, "Auto Court"), Array.from({ length: A }, (b, N) => React.createElement("option", {
      key: N + 1,
      value: N + 1
    }, "Court ", N + 1)))), h.teams.map(b => React.createElement("div", {
      key: b.id,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "6px 8px",
        background: C.cardAlt,
        borderRadius: 8,
        marginBottom: 3
      }
    }, U && b.p1 ? React.createElement(React.Fragment, null, React.createElement(Avi, {
      name: b.p1.firstName,
      color: getTier(b.p1.bestRating).color,
      size: 20,
      gender: b.p1.gender,
      imageUrl: b.p1.avatarUrl
    }), React.createElement(Avi, {
      name: b.p2.firstName,
      color: getTier(b.p2.bestRating).color,
      size: 20,
      gender: b.p2.gender,
      imageUrl: b.p2.avatarUrl,
      style: { marginLeft: -8 }
    }), React.createElement("div", {
      style: {
        flex: 1,
        fontSize: 10,
        fontWeight: 600,
        color: C.text
      }
    }, b.p1.fullName, " | ", b.p2.fullName)) : React.createElement(React.Fragment, null, React.createElement(Avi, {
      name: b.firstName,
      color: getTier(b.bestRating).color,
      size: 22,
      gender: b.gender,
      imageUrl: b.avatarUrl
    }), React.createElement("div", {
      style: {
        flex: 1,
        fontSize: 11,
        fontWeight: 600,
        color: C.text
      }
    }, b.fullName)), React.createElement(Badge, {
      color: C.gold,
      small: !0
    }, b.bestRating), React.createElement("button", {
      onClick: () => F(B, b.id),
      style: {
        width: 18,
        height: 18,
        borderRadius: 4,
        border: "none",
        background: `${ C.red }22`,
        color: C.red,
        cursor: "pointer"
      }
    }, React.createElement(Ic, {
      t: "x",
      s: 9
    })))), h.teams.length < $ && (U ? E[B] ? React.createElement("div", {
      style: {
        marginTop: 4,
        padding: "8px 10px",
        background: `${ C.teal }10`,
        borderRadius: 8,
        border: `1px solid ${ C.teal }33`
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 6
      }
    }, React.createElement("span", {
      style: {
        fontSize: 10,
        color: C.teal,
        fontWeight: 700
      }
    }, "P1: ", m.find(b => b.id === E[B])?.fullName), React.createElement("button", {
      onClick: () => y(B),
      style: {
        background: "none",
        border: "none",
        color: C.red,
        cursor: "pointer",
        fontSize: 10
      }
    }, "Cancel")), React.createElement(PlayerSearchSelect, {
      players: Se.filter(b => {
        if (b.id === E[B])
          return !1;
        if (x.format === "mx") {
          const N = m.find(_ => _.id === E[B]);
          return N && b.gender !== N.gender;
        }
        return !0;
      }),
      value: "",
      onChange: b => s(B, b),
      placeholder: "Search Partner...",
      excludeIds: [
        E[B],
        ...me
      ],
      currentUserId: E[B]
    })) : React.createElement("div", { style: { marginTop: 4 } }, React.createElement(PlayerSearchSelect, {
      players: Se,
      value: "",
      onChange: b => De(B, b),
      placeholder: "Search Player 1...",
      excludeIds: [...me],
      currentUserId: R?.id
    })) : React.createElement("div", { style: { marginTop: 4 } }, React.createElement(PlayerSearchSelect, {
      players: Se,
      value: "",
      onChange: b => {
        Me(B, b);
      },
      placeholder: "Search player...",
      excludeIds: [...me]
    }))))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 12
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => M(2)
    }, "Back"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: () => M(4)
    }, "Next ", React.createElement(Ic, {
      t: "chevron",
      s: 14
    })))), v === 4 && React.createElement("div", null, React.createElement("div", {
      style: {
        background: `${ C.lime }08`,
        borderRadius: 16,
        padding: 18,
        border: `1px solid ${ C.lime }22`,
        marginBottom: 14
      }
    }, React.createElement("h3", {
      style: {
        fontSize: 16,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 10px"
      }
    }, z || "New Tournament"), ce && React.createElement("div", {
      style: {
        padding: "8px 12px",
        background: C.cardAlt,
        borderRadius: 8,
        marginBottom: 10
      }
    }, "\uD83D\uDCCD ", ce, " \xB7 ", se, " \xB7 ", ee, i && React.createElement(React.Fragment, null, " \xB7 ", React.createElement("a", {
      href: i,
      target: "_blank",
      style: {
        color: C.blue,
        fontSize: 9
      }
    }, "Maps"))), f.map((h, B) => {
      const b = l.find(_ => _.id === h), N = t.filter(_ => _.catId === h);
      return React.createElement("div", {
        key: B,
        style: { marginBottom: 8 }
      }, React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 700,
          color: C.lime
        }
      }, b?.name, ": ", N.reduce((_, H) => _ + H.teams.length, 0), " teams in ", N.length, " groups"), N.map(_ => React.createElement("div", {
        key: _.label,
        style: {
          fontSize: 9,
          color: C.textDim,
          paddingLeft: 8
        }
      }, "Group ", _.label, ": ", _.teams.map(H => H.fullName).join(" \xB7 "), " \xB7 Court ", _.court || "Auto")));
    })), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => M(3)
    }, "Back"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: pe
    }, React.createElement(Ic, {
      t: "play",
      s: 14
    }), " Launch Tournament"))));
  }, TourneyTab = ({
    activeTourney: m,
    tournaments: c,
    setTournaments: e,
    players: d,
    setPlayers: p,
    setTab: r,
    setActiveTourney: l
  }) => {
    const [n, R] = useState(m), [S, v] = useState(0), [M, z] = useState(0), [g, f] = useState(null), [u, k] = useState(null), [refM, setRefM] = useState(null), [printOpen, setPrintOpen] = useState(!1), [entryMode, setEntryMode] = useState("score"), pend = useRef({}), [G, O] = useState(""), [K, J] = useState(""), [swapMode, setSwapMode] = useState(!1), [swapSel, setSwapSel] = useState(null), [amSel, setAmSel] = useState(null), D = useRef(null);
    if (useEffect(() => {
        (g || u) && setTimeout(() => {
          D.current && D.current.focus();
        }, 50);
      }, [
        g,
        u
      ]), useEffect(() => {
        m && R(m);
      }, [m]), !n)
      return React.createElement("div", {
        style: {
          textAlign: "center",
          padding: "50px 20px"
        }
      }, React.createElement("div", {
        style: {
          fontSize: 36,
          opacity: 0.3
        }
      }, "\uD83C\uDFC6"), React.createElement("p", {
        style: {
          color: C.textDim,
          fontSize: 12
        }
      }, "No tournament selected"), React.createElement(Btn, {
        primary: !0,
        onClick: () => r("tournament")
      }, "Browse Tournaments"));
    const I = n.groups.filter(i => i.catId === n.categories?.[S]?.id || i.catName === n.categories?.[S]?.name), ae = Math.min(M, Math.max(0, I.length - 1)), w = I[ae] || (n.tourFormat && n.tourFormat !== "group_ko" && n.tourFormat !== "league" ? {
      label: "",
      court: 0,
      teams: [],
      matches: [],
      format: n.categories?.[S]?.format
    } : void 0);
    if (!w)
      return React.createElement("div", {
        style: {
          textAlign: "center",
          padding: 40,
          color: C.textDim
        }
      }, "No groups for this category");
    const P = w.matches.filter(i => i.played).length, ne = useMemo(() => {
        const i = {};
        return w.teams.forEach(o => {
          i[o.id] = {
            ...o,
            gW: 0,
            gL: 0,
            gPF: 0,
            gPA: 0,
            gP: 0,
            gD: 0
          };
        }), w.matches.filter(o => o.played).forEach(o => {
          !i[o.teamA.id] || !i[o.teamB.id] || (i[o.teamA.id].gP++, i[o.teamB.id].gP++, i[o.teamA.id].gPF += o.scoreA, i[o.teamA.id].gPA += o.scoreB, i[o.teamB.id].gPF += o.scoreB, i[o.teamB.id].gPA += o.scoreA, o.winner === o.teamA.id ? (i[o.teamA.id].gW++, i[o.teamB.id].gL++) : (i[o.teamB.id].gW++, i[o.teamA.id].gL++));
        }), Object.values(i).map(o => ({
          ...o,
          gD: o.gPF - o.gPA
        })).sort((o, t) => {
          if (t.gW !== o.gW)
            return t.gW - o.gW;
          if (t.gD !== o.gD)
            return t.gD - o.gD;
          const a = w.matches.find(W => W.played && (W.teamA.id === o.id && W.teamB.id === t.id || W.teamA.id === t.id && W.teamB.id === o.id));
          if (a) {
            if (a.winner === o.id)
              return -1;
            if (a.winner === t.id)
              return 1;
          }
          return t.gPF - o.gPF;
        });
      }, [w]), Y = (i, o, t, a, W = "group") => {
        const q = n.categories?.[S]?.format || w.format || "ms", gcnt = tm => {
            const ids = tm.p1 ? [
                tm.p1.id,
                tm.p2.id
              ] : [tm.id], ps = ids.map(x => d.find(pp => pp.id === x)).filter(Boolean);
            return ps.length ? ps.reduce((s2, pp) => s2 + (pp.wins || 0) + (pp.losses || 0), 0) / ps.length : 12;
          }, {
            wG: E,
            lL: ie
          } = calcRtgChange(i.bestRating, o.bestRating, t, a, W, gcnt(i), gcnt(o)), V = i.p1 ? [
            i.p1.id,
            i.p2.id
          ] : [i.id], X = o.p1 ? [
            o.p1.id,
            o.p2.id
          ] : [o.id];
        p(j => j.map($ => {
          if (V.includes($.id)) {
            const T = { ...$.ratings }, rk = ratingKey(n.sport, q);
            T[rk] = (T[rk] ?? T[q] ?? 750) + E;
            const A = { ...$.partnerStats || {} };
            if (i.p1 && i.p2) {
              const x = $.id === i.p1.id ? i.p2.id : i.p1.id;
              A[x] || (A[x] = {
                wins: 0,
                losses: 0
              }), A[x].wins++;
            }
            return {
              ...$,
              bestRating: Math.max(...Object.values(T)),
              ratings: T,
              wins: $.wins + 1,
              partnerStats: A,
              matchHistory: [
                ...$.matchHistory,
                {
                  date: new Date().toISOString(),
                  opponent: o.fullName,
                  won: !0,
                  scoreFor: t,
                  scoreAgainst: a,
                  ratingChange: E,
                  tournament: n.name,
                  format: FORMAT_LABELS[q] || q,
                  stage: W
                }
              ]
            };
          }
          if (X.includes($.id)) {
            const T = { ...$.ratings }, rk = ratingKey(n.sport, q);
            T[rk] = Math.max(100, (T[rk] ?? T[q] ?? 750) - ie);
            const A = { ...$.partnerStats || {} };
            if (o.p1 && o.p2) {
              const x = $.id === o.p1.id ? o.p2.id : o.p1.id;
              A[x] || (A[x] = {
                wins: 0,
                losses: 0
              }), A[x].losses++;
            }
            return {
              ...$,
              bestRating: Math.max(...Object.values(T)),
              ratings: T,
              losses: $.losses + 1,
              partnerStats: A,
              matchHistory: [
                ...$.matchHistory,
                {
                  date: new Date().toISOString(),
                  opponent: i.fullName,
                  won: !1,
                  scoreFor: a,
                  scoreAgainst: t,
                  ratingChange: -ie,
                  tournament: n.name,
                  format: FORMAT_LABELS[q] || q,
                  stage: W
                }
              ]
            };
          }
          return $;
        }));
      }, commitScore = (mt, grp, o, t) => {
        if (!mt || isNaN(o) || isNaN(t) || o === t) return !1;
        const a = mt.id, W = mt.teamA, q = mt.teamB, E = o > t ? W.id : q.id, ie = o > t ? W : q, V = o > t ? q : W;
        Y(ie, V, Math.max(o, t), Math.min(o, t));
        const X = grp.label, j = grp.catId, $ = {
            ...n,
            groups: n.groups.map(T => T.catId !== j || T.label !== X ? T : {
              ...T,
              matches: T.matches.map(A => A.id === a ? {
                ...A,
                scoreA: o,
                scoreB: t,
                winner: E,
                played: !0
              } : A)
            })
          };
        return R($), l($), e(T => T.map(A => A.id === $.id ? $ : A)), $;
      }, ee = (i = !1) => {
        if (!g || G === "" || K === "")
          return;
        const o = parseInt(G), t = parseInt(K);
        if (isNaN(o) || isNaN(t) || o === t) {
          alert("Invalid score");
          return;
        }
        const a = g.id, W = g.teamA, q = g.teamB, E = o > t ? W.id : q.id, ie = o > t ? W : q, V = o > t ? q : W;
        Y(ie, V, Math.max(o, t), Math.min(o, t));
        const X = w.label, j = w.catId, $ = {
            ...n,
            groups: n.groups.map(T => T.catId !== j || T.label !== X ? T : {
              ...T,
              matches: T.matches.map(A => A.id === a ? {
                ...A,
                scoreA: o,
                scoreB: t,
                winner: E,
                played: !0
              } : A)
            })
          };
        if (R($), l($), e(T => T.map(A => A.id === $.id ? $ : A)), i) {
          const T = $.groups.find(A => A.catId === j && A.label === X);
          if (T) {
            const A = T.matches.find(x => !x.played);
            if (A) {
              f(A), O(""), J("");
              return;
            }
          }
        }
        f(null), O(""), J("");
      }, L = (next = !1) => {
        if (!u || G === "" || K === "")
          return;
        const i = parseInt(G), o = parseInt(K);
        if (isNaN(i) || isNaN(o) || i === o) {
          alert("Invalid score");
          return;
        }
        if (u.rIdx === -1) {
          const tp = { ...(n.thirdPlace || {})[S] };
          tp.s1 = i, tp.s2 = o, tp.winner = i > o ? tp.p1.id : tp.p2.id, tp.played = !0;
          const W3 = i > o ? tp.p1 : tp.p2, L3 = i > o ? tp.p2 : tp.p1;
          Y(W3, L3, Math.max(i, o), Math.min(i, o), "quarter");
          const bIds = teamPlayerIds(W3), catName3 = n.categories?.[S]?.name || "";
          p(A => A.map(pl => bIds.includes(pl.id) ? {
            ...pl,
            medals: [
              ...pl.medals || [],
              {
                type: "\uD83E\uDD49",
                tournament: n.name,
                category: catName3,
                year: new Date().getFullYear()
              }
            ]
          } : pl));
          const T3 = {
            ...n,
            thirdPlace: {
              ...n.thirdPlace,
              [S]: tp
            }
          };
          R(T3), l(T3), e(A => A.map(x => x.id === T3.id ? T3 : x)), k(null), O(""), J("");
          return;
        }
        if (n.tourFormat === "double_elim") {
          const br2 = u.br || "W";
          const res = advanceDE(n.knockoutBrackets[S], n.loserBrackets?.[S] || [], n.grandFinals?.[S] || {}, br2, u.rIdx, u.mIdx, i, o);
          Y(res.winnerTeam, res.loserTeam, Math.max(i, o), Math.min(i, o), res.stage);
          const $4 = { ...n.champions || {} };
          if (res.champion) {
            $4[S] = res.champion.fullName;
            const goldIds4 = teamPlayerIds(res.champion), silverIds4 = teamPlayerIds(res.loserTeam);
            const lbArr = res.lb || [], lastLb = lbArr.length ? lbArr[lbArr.length - 1][0] : null;
            const bronzeIds4 = lastLb && lastLb.played && lastLb.p1 && lastLb.p2 ? teamPlayerIds(lastLb.winner === lastLb.p1.id ? lastLb.p2 : lastLb.p1) : [];
            const catName4 = n.categories?.[S]?.name || "";
            p(A => A.map(pl => {
              let md = null;
              if (goldIds4.includes(pl.id))
                md = "\uD83E\uDD47";
              else if (silverIds4.includes(pl.id))
                md = "\uD83E\uDD48";
              else if (bronzeIds4.includes(pl.id))
                md = "\uD83E\uDD49";
              return md ? {
                ...pl,
                medals: [
                  ...pl.medals || [],
                  {
                    type: md,
                    tournament: n.name,
                    category: catName4,
                    year: new Date().getFullYear()
                  }
                ]
              } : pl;
            }));
          }
          const T4 = {
            ...n,
            knockoutBrackets: {
              ...n.knockoutBrackets,
              [S]: res.wb
            },
            loserBrackets: {
              ...n.loserBrackets,
              [S]: res.lb
            },
            grandFinals: {
              ...n.grandFinals,
              [S]: res.gf
            },
            champions: $4,
            status: Object.keys($4).length === n.categories.length ? "completed" : "active"
          };
          R(T4), l(T4), e(A => A.map(x => x.id === T4.id ? T4 : x)), k(null), O(""), J("");
          return;
        }
        const {
            rIdx: t,
            mIdx: a,
            match: W
          } = u, q = i > o ? W.p1.id : W.p2.id, E = i > o ? W.p1 : W.p2, ie = i > o ? W.p2 : W.p1, V = t === le.length - 1 ? "final" : t === le.length - 2 ? "semi" : "quarter";
        Y(E, ie, Math.max(i, o), Math.min(i, o), V);
        const X = n.knockoutBrackets[S].map(A => A.map(x => ({ ...x })));
        if (X[t][a].s1 = i, X[t][a].s2 = o, X[t][a].winner = q, X[t][a].played = !0, t + 1 < X.length) {
          const A = Math.floor(a / 2);
          a % 2 === 0 ? X[t + 1][A].p1 = E : X[t + 1][A].p2 = E;
        }
        let tp3 = { ...n.thirdPlace || {} };
        if (X.length >= 2 && t === X.length - 2) {
          const semis = X[X.length - 2];
          if (semis.length === 2 && semis.every(sm => sm.played && sm.p1 && sm.p2)) {
            const losers = semis.map(sm => sm.winner === sm.p1.id ? sm.p2 : sm.p1);
            tp3[S] = tp3[S] && tp3[S].played ? tp3[S] : {
              id: uid(),
              matchNum: 99,
              p1: losers[0],
              p2: losers[1],
              s1: null,
              s2: null,
              winner: null,
              played: !1
            };
          }
        }
        const j = X[X.length - 1], $ = { ...n.champions || {} };
        j[0]?.played && ($[S] = E.fullName);
        if (t === X.length - 1) {
          const goldIds = teamPlayerIds(E), silverIds = teamPlayerIds(ie), bronzeIds = [];
          const tpm = (n.thirdPlace || {})[S];
          tpm && tpm.played ? teamPlayerIds(tpm.winner === tpm.p1.id ? tpm.p1 : tpm.p2).forEach(bx => bronzeIds.push(bx)) : !tpm && (X.length >= 2 ? X[X.length - 2] : []).forEach(sm => {
            if (sm.played && sm.p1 && sm.p2) {
              const lo = sm.winner === sm.p1.id ? sm.p2 : sm.p1;
              teamPlayerIds(lo).forEach(bx => bronzeIds.push(bx));
            }
          });
          const catName = n.categories?.[S]?.name || "";
          p(A => A.map(pl => {
            let md = null;
            if (goldIds.includes(pl.id))
              md = "\uD83E\uDD47";
            else if (silverIds.includes(pl.id))
              md = "\uD83E\uDD48";
            else if (bronzeIds.includes(pl.id))
              md = "\uD83E\uDD49";
            return md ? {
              ...pl,
              medals: [
                ...pl.medals || [],
                {
                  type: md,
                  tournament: n.name,
                  category: catName,
                  year: new Date().getFullYear()
                }
              ]
            } : pl;
          }));
        }
        const T = {
          ...n,
          knockoutBrackets: {
            ...n.knockoutBrackets,
            [S]: X
          },
          champions: $,
          thirdPlace: tp3,
          status: Object.keys($).length === n.categories.length ? "completed" : "active"
        };
        R(T), l(T), e(A => A.map(x => x.id === T.id ? T : x));
        if (next) {
          let found = null;
          for (let ri = 0; ri < X.length && !found; ri++)
            for (let mi = 0; mi < X[ri].length; mi++) {
              const cand = X[ri][mi];
              if (cand.p1 && cand.p2 && !cand.played && !(ri === t && mi === a)) {
                found = {
                  rIdx: ri,
                  mIdx: mi,
                  match: cand
                };
                break;
              }
            }
          if (found) {
            k(found), O(""), J("");
            return;
          }
        }
        k(null), O(""), J("");
      }, amPersist = am2 => {
        const T5 = {
          ...n,
          americano: am2
        };
        R(T5), l(T5), e(A => A.map(x => x.id === T5.id ? T5 : x));
      }, amClone = () => ({
        ...n.americano,
        points: { ...n.americano.points },
        games: { ...n.americano.games },
        rounds: n.americano.rounds.map(r2 => ({
          ...r2,
          courts: r2.courts.map(c2 => ({ ...c2 }))
        }))
      }), amGenRound = () => {
        const am2 = amClone();
        const pobjs = am2.players;
        am2.rounds.push(genAmericanoRound(pobjs, am2.rounds.length, n.numCourts, n.tourFormat, am2.points)), amPersist(am2);
      }, amSave = (ri, ci) => {
        const a2 = parseInt(G), b2 = parseInt(K);
        if (isNaN(a2) || isNaN(b2))
          return;
        const am2 = amClone(), ct = am2.rounds[ri].courts[ci];
        ct.played ? (ct.a.forEach(pid => am2.points[pid] = (am2.points[pid] || 0) - ct.scoreA), ct.b.forEach(pid => am2.points[pid] = (am2.points[pid] || 0) - ct.scoreB)) : ct.a.concat(ct.b).forEach(pid => am2.games[pid] = (am2.games[pid] || 0) + 1);
        ct.scoreA = a2, ct.scoreB = b2, ct.played = !0;
        ct.a.forEach(pid => am2.points[pid] = (am2.points[pid] || 0) + a2), ct.b.forEach(pid => am2.points[pid] = (am2.points[pid] || 0) + b2);
        amPersist(am2), setAmSel(null), O(""), J("");
      }, amFinish = () => {
        const am2 = n.americano;
        const sorted = [...am2.players].sort((a2, b2) => (am2.points[b2.id] || 0) - (am2.points[a2.id] || 0));
        if (!sorted.length)
          return;
        p(A => A.map(pl => {
          let md = null;
          if (sorted[0] && pl.id === sorted[0].id)
            md = "\uD83E\uDD47";
          else if (sorted[1] && pl.id === sorted[1].id)
            md = "\uD83E\uDD48";
          else if (sorted[2] && pl.id === sorted[2].id)
            md = "\uD83E\uDD49";
          return md ? {
            ...pl,
            medals: [
              ...pl.medals || [],
              {
                type: md,
                tournament: n.name,
                category: n.tourFormat === "mexicano_t" ? "Mexicano" : "Americano",
                year: new Date().getFullYear()
              }
            ]
          } : pl;
        }));
        const T5 = {
          ...n,
          champions: { 0: sorted[0].fullName },
          status: "completed"
        };
        R(T5), l(T5), e(A => A.map(x => x.id === T5.id ? T5 : x));
      }, amName = pid => (n.americano?.players || []).find(x => x.id === pid)?.fullName || pid, se = I.every(i => i.matches.every(o => o.played)), ge = () => {
        const i = [];
        I.forEach((j, $) => {
          const T = {};
          j.teams.forEach(x => {
            T[x.id] = {
              ...x,
              gW: 0,
              gD: 0,
              gPF: 0
            };
          }), j.matches.filter(x => x.played).forEach(x => {
            T[x.teamA.id].gPF += x.scoreA, T[x.teamA.id].gD += x.scoreA - x.scoreB, T[x.teamB.id].gPF += x.scoreB, T[x.teamB.id].gD += x.scoreB - x.scoreA, x.winner === x.teamA.id ? T[x.teamA.id].gW++ : T[x.teamB.id].gW++;
          }), Object.values(T).sort((x, U) => {
            if (U.gW !== x.gW)
              return U.gW - x.gW;
            if (U.gD !== x.gD)
              return U.gD - x.gD;
            const re = j.matches.find(ue => ue.played && (ue.teamA.id === x.id && ue.teamB.id === U.id || ue.teamA.id === U.id && ue.teamB.id === x.id));
            if (re) {
              if (re.winner === x.id)
                return -1;
              if (re.winner === U.id)
                return 1;
            }
            return U.gPF - x.gPF;
          }).slice(0, n.topNAdvance).forEach((x, U) => {
            i.push({
              ...x,
              groupIdx: $,
              rank: U + 1
            });
          });
        });
        const o = i.length;
        if (o < 2)
          return;
        const t = Math.ceil(Math.log2(o)), a = Math.pow(2, t), W = I.length, q = n.topNAdvance, E = new Array(a).fill(null);
        if (W === 1)
          i.forEach((j, $) => {
            E[$] = j;
          });
        else if (W === 2) {
          const j = i.filter(A => A.groupIdx === 0).sort((A, x) => A.rank - x.rank), $ = i.filter(A => A.groupIdx === 1).sort((A, x) => A.rank - x.rank), T = [];
          for (let A = 0; A < q; A++)
            T.push(j[A]), T.push($[q - 1 - A]);
          T.forEach((A, x) => {
            x < a && (E[x] = A);
          });
        } else if (W === 4) {
          const j = [
            [],
            [],
            [],
            []
          ];
          i.forEach(T => {
            j[T.groupIdx].push(T);
          }), j.forEach(T => T.sort((A, x) => A.rank - x.rank)), [
            j[0][0],
            j[1][1],
            j[2][0],
            j[3][1],
            j[1][0],
            j[0][1],
            j[3][0],
            j[2][1]
          ].forEach((T, A) => {
            T && A < a && (E[A] = T);
          });
        } else {
          const j = [...i].sort((x, U) => x.rank - U.rank || x.groupIdx - U.groupIdx);
          let $ = 0, T = 1, A = 0;
          for (; $ < j.length && A < a;)
            E[A] = j[$], $++, A += T, (A >= a || A < 0) && (T *= -1, A += T);
        }
        const ie = [];
        for (let j = 0; j < a; j += 2) {
          const $ = E[j] || null, T = E[j + 1] || null;
          ie.push({
            id: uid(),
            round: 1,
            p1: $,
            p2: T,
            s1: null,
            s2: null,
            winner: T ? null : $ ? $.id : null,
            played: !T,
            isBye: !T
          });
        }
        const V = [ie];
        for (let j = 2; j <= t; j++) {
          const $ = [];
          for (let T = 0; T < V[j - 2].length; T += 2)
            $.push({
              id: uid(),
              round: j,
              p1: null,
              p2: null,
              s1: null,
              s2: null,
              winner: null,
              played: !1
            });
          V.push($);
        }
        V[0].forEach((j, $) => {
          if (j.isBye && j.winner && V.length > 1) {
            const T = Math.floor($ / 2);
            $ % 2 === 0 ? V[1][T].p1 = j.p1 : V[1][T].p2 = j.p1;
          }
        });
        const X = {
          ...n,
          knockoutBrackets: {
            ...n.knockoutBrackets,
            [S]: V
          }
        };
        R(X), l(X), e(j => j.map($ => $.id === n.id ? X : $));
      }, ce = (i, o) => {
        const t = i - o;
        return t === 0 ? "Final" : t === 1 ? "Semi-Final" : t === 2 ? "Quarter-Final" : `Round ${ o }`;
      }, le = n.knockoutBrackets?.[S];
    return React.createElement("div", null, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 14
      }
    }, React.createElement("button", {
      onClick: () => r("home"),
      style: {
        background: C.card,
        border: "none",
        borderRadius: 8,
        padding: "8px 12px",
        color: C.textMuted,
        cursor: "pointer"
      }
    }, React.createElement(Ic, {
      t: "back",
      s: 16
    })), React.createElement("div", { style: { flex: 1 } }, React.createElement("h2", {
      style: {
        fontSize: 16,
        fontWeight: 800,
        color: C.text,
        margin: 0
      }
    }, n.name), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, fp(n.entryFee), "/team \xB7 Game to ", n.pointsToWin, " \xB7 ", n.numCourts, " courts")), React.createElement(Badge, { color: n.status === "completed" ? C.gold : le ? C.orange : C.lime }, n.status === "completed" ? "Completed" : le ? "Knockouts" : "Groups"), React.createElement(Btn, {
      small: !0,
      color: C.blue,
      onClick: () => {
        const o = window.location.href.split("?")[0] + "?view=" + n.id;
        navigator.clipboard.writeText(o).then(() => alert("Link copied!"));
      },
      style: { marginLeft: 8 }
    }, React.createElement(Ic, {
      t: "share",
      s: 12
    }), " Share")), n.venue && React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textMuted,
        marginBottom: 8
      }
    }, "\uD83D\uDCCD ", n.venue, " \xB7 ", n.tournamentDate, " \xB7 ", n.startTime, n.googleLocation && React.createElement(React.Fragment, null, " \xB7 ", React.createElement("a", {
      href: n.googleLocation,
      target: "_blank",
      style: { color: C.blue }
    }, "Maps"))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 10,
        flexWrap: "wrap"
      }
    }, React.createElement(Btn, {
      small: !0,
      color: C.red,
      onClick: () => setPrintOpen(!0)
    }, React.createElement(Ic, {
      t: "download",
      s: 12
    }), " PDF"), React.createElement(Btn, {
      small: !0,
      color: C.teal,
      onClick: () => exportScheduleCSV(n)
    }, React.createElement(Ic, {
      t: "download",
      s: 12
    }), " Excel/CSV"), React.createElement(Btn, {
      small: !0,
      color: "#25D366",
      onClick: () => shareWhatsApp(n)
    }, React.createElement(Ic, {
      t: "share",
      s: 12
    }), " WhatsApp")), (() => {
      if (n.status === "completed")
        return null;
      const allM = [];
      n.groups.forEach(g5 => (g5.matches || []).forEach(m5 => allM.push(m5)));
      const unp = allM.filter(m5 => !m5.played).sort((a5, b5) => (a5.slot || 0) - (b5.slot || 0)), done5 = allM.filter(m5 => m5.played);
      if (!allM.length)
        return null;
      const byCourt = {};
      unp.forEach(m5 => {
        const c5 = m5.court || 1;
        byCourt[c5] = byCourt[c5] || [], byCourt[c5].push(m5);
      });
      return React.createElement("div", {
        style: {
          background: C.card,
          borderRadius: 14,
          padding: 14,
          border: `1px solid ${ C.border }`,
          marginBottom: 12
        }
      }, React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 8
        }
      }, React.createElement("span", {
        style: {
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: C.red,
          display: "inline-block",
          animation: "pulse 1.2s infinite"
        }
      }), React.createElement("span", {
        style: {
          fontSize: 11,
          fontWeight: 800,
          color: C.red,
          textTransform: "uppercase",
          letterSpacing: 1
        }
      }, "Live"), React.createElement("span", {
        style: {
          fontSize: 10,
          color: C.textDim
        }
      }, done5.length, "/", allM.length, " matches done")), Object.keys(byCourt).sort((a5, b5) => a5 - b5).map(c5 => React.createElement("div", {
        key: c5,
        style: {
          marginBottom: 6,
          fontSize: 11,
          color: C.text
        }
      }, React.createElement("b", { style: { color: C.teal } }, "Court ", c5, ": "), teamName(byCourt[c5][0].teamA), " vs ", teamName(byCourt[c5][0].teamB), byCourt[c5][0].timeStart && React.createElement("span", { style: { color: C.textDim } }, " \xB7 ", byCourt[c5][0].timeStart), byCourt[c5][1] && React.createElement("div", {
        style: {
          fontSize: 9,
          color: C.textDim,
          marginLeft: 8
        }
      }, "up next: ", teamName(byCourt[c5][1].teamA), " vs ", teamName(byCourt[c5][1].teamB)))), done5.length > 0 && React.createElement("div", {
        style: {
          fontSize: 9,
          color: C.textMuted,
          borderTop: `1px solid ${ C.border }`,
          paddingTop: 6,
          marginTop: 4
        }
      }, "Latest: ", done5.slice(-3).reverse().map(m5 => `${ teamName(m5.teamA) } ${ m5.scoreA }\u2013${ m5.scoreB } ${ teamName(m5.teamB) }`).join("  \xB7  ")));
    })(), (n.tourFormat === "americano_t" || n.tourFormat === "mexicano_t") && n.americano && React.createElement("div", null, React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 8
      }
    }, n.tourFormat === "mexicano_t" ? "Mexicano" : "Americano", " \u2014 Points Leaderboard"), [...n.americano.players].sort((x2, y2) => (n.americano.points[y2.id] || 0) - (n.americano.points[x2.id] || 0)).map((pl2, idx2) => React.createElement("div", {
      key: pl2.id,
      style: {
        display: "flex",
        justifyContent: "space-between",
        padding: "5px 0",
        borderBottom: `1px solid ${ C.border }`,
        fontSize: 11
      }
    }, React.createElement("span", { style: { color: C.text } }, React.createElement("b", {
      style: {
        color: idx2 === 0 ? C.gold : idx2 === 1 ? C.silver : idx2 === 2 ? C.bronze : C.textDim,
        marginRight: 8
      }
    }, "#", idx2 + 1), pl2.fullName), React.createElement("span", { style: { color: C.textMuted } }, React.createElement("b", { style: { color: C.lime } }, n.americano.points[pl2.id] || 0), " pts \xB7 ", n.americano.games[pl2.id] || 0, " games")))), n.americano.rounds.map((rd2, ri2) => React.createElement("div", {
      key: ri2,
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 10
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 800,
        color: C.orange,
        marginBottom: 8
      }
    }, "Round ", ri2 + 1), rd2.courts.map((ct2, ci2) => React.createElement("div", {
      key: ci2,
      onClick: () => {
        amSel && amSel.r === ri2 && amSel.c === ci2 || (setAmSel({
          r: ri2,
          c: ci2
        }), O(ct2.played ? String(ct2.scoreA) : ""), J(ct2.played ? String(ct2.scoreB) : ""));
      },
      style: {
        background: C.cardAlt,
        borderRadius: 10,
        padding: "8px 10px",
        marginBottom: 6,
        cursor: "pointer"
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 8,
        fontSize: 10,
        color: C.text
      }
    }, React.createElement("span", null, React.createElement("b", { style: { color: C.teal } }, "Ct", ci2 + 1), " ", amName(ct2.a[0]), " + ", amName(ct2.a[1])), ct2.played ? React.createElement("b", { style: { color: C.lime } }, ct2.scoreA, "\u2013", ct2.scoreB) : React.createElement("span", {
      style: {
        fontSize: 9,
        color: C.textDim
      }
    }, "vs"), React.createElement("span", { style: { textAlign: "right" } }, amName(ct2.b[0]), " + ", amName(ct2.b[1]))), amSel && amSel.r === ri2 && amSel.c === ci2 && React.createElement("div", {
      onClick: ev => ev.stopPropagation(),
      style: {
        display: "flex",
        gap: 6,
        marginTop: 8,
        alignItems: "center"
      }
    }, React.createElement(Input, {
      type: "number",
      value: G,
      onChange: O,
      placeholder: "A",
      style: { width: 70 }
    }), React.createElement(Input, {
      type: "number",
      value: K,
      onChange: J,
      placeholder: "B",
      style: { width: 70 }
    }), React.createElement(Btn, {
      small: !0,
      primary: !0,
      color: C.lime,
      onClick: () => amSave(ri2, ci2)
    }, "Save"), React.createElement(Btn, {
      small: !0,
      onClick: () => {
        setAmSel(null), O(""), J("");
      }
    }, "Cancel")))), rd2.benched && rd2.benched.length > 0 && React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim
      }
    }, "Sitting out: ", rd2.benched.map(amName).join(", ")))), n.status !== "completed" && React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginBottom: 12
      }
    }, React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.teal,
      onClick: amGenRound
    }, "\u26A1 Generate Round ", n.americano.rounds.length + 1), n.americano.rounds.length > 0 && React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.gold,
      onClick: () => window.confirm("Finish tournament and award medals to the top 3?") && amFinish()
    }, "\uD83C\uDFC6 Finish")), n.status === "completed" && n.champions?.[0] && React.createElement("div", {
      style: {
        background: `linear-gradient(135deg,${ C.gold }22,${ C.orange }11)`,
        border: `1px solid ${ C.gold }55`,
        borderRadius: 12,
        padding: 12,
        marginBottom: 12,
        fontSize: 12,
        color: C.text,
        fontWeight: 700
      }
    }, "\uD83C\uDFC6 Champion: ", n.champions[0])), n.categories && n.categories.length > 1 && React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        marginBottom: 10,
        overflowX: "auto"
      }
    }, n.categories.map((i, o) => React.createElement("button", {
      key: o,
      onClick: () => {
        v(o), z(0);
      },
      style: {
        padding: "7px 12px",
        borderRadius: 8,
        border: `1px solid ${ S === o ? C.lime : C.border }`,
        background: S === o ? `${ C.lime }18` : C.card,
        color: S === o ? C.lime : C.textDim,
        fontWeight: 600,
        fontSize: 10,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: "inherit"
      }
    }, i.short || i.name))), !le && React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        marginBottom: 12,
        overflowX: "auto"
      }
    }, I.map((i, o) => React.createElement("button", {
      key: o,
      onClick: () => z(o),
      style: {
        padding: "7px 14px",
        borderRadius: 10,
        border: `1px solid ${ ae === o ? C.lime : C.border }`,
        background: ae === o ? `${ C.lime }18` : C.card,
        color: ae === o ? C.lime : C.textDim,
        fontWeight: 700,
        fontSize: 11,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: "inherit"
      }
    }, "Grp ", i.label, " ", i.court ? `(Ct${ i.court })` : "")), se && (n.tourFormat || "group_ko") === "group_ko" && React.createElement(Btn, {
      primary: !0,
      small: !0,
      color: C.orange,
      onClick: ge
    }, React.createElement(Ic, {
      t: "zap",
      s: 11
    }), " Generate Knockouts"), se && n.tourFormat === "league" && !n.champions?.[S] && React.createElement(Btn, {
      primary: !0,
      small: !0,
      color: C.gold,
      onClick: () => {
        const st = leagueStandings(I);
        if (!st.length)
          return;
        const $2 = {
          ...n.champions || {},
          [S]: st[0].team.fullName
        };
        const catName2 = n.categories?.[S]?.name || "";
        p(A => A.map(pl => {
          let md = null;
          if (teamPlayerIds(st[0] && st[0].team).includes(pl.id))
            md = "\uD83E\uDD47";
          else if (st[1] && teamPlayerIds(st[1].team).includes(pl.id))
            md = "\uD83E\uDD48";
          else if (st[2] && teamPlayerIds(st[2].team).includes(pl.id))
            md = "\uD83E\uDD49";
          return md ? {
            ...pl,
            medals: [
              ...pl.medals || [],
              {
                type: md,
                tournament: n.name,
                category: catName2,
                year: new Date().getFullYear()
              }
            ]
          } : pl;
        }));
        const T2 = {
          ...n,
          champions: $2,
          status: Object.keys($2).length === n.categories.length ? "completed" : "active"
        };
        R(T2), l(T2), e(A => A.map(x => x.id === T2.id ? T2 : x));
      }
    }, "\uD83C\uDFC6 Complete League")), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${ C.border }`,
        overflow: "hidden",
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        padding: "8px 12px",
        background: C.cardAlt
      }
    }, React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "28px 1fr 34px 34px 34px 40px 40px 40px",
        gap: 3,
        fontSize: 8,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase"
      }
    }, React.createElement("div", null, "#"), React.createElement("div", null, "Team"), React.createElement("div", null, "P"), React.createElement("div", null, "W"), React.createElement("div", null, "L"), React.createElement("div", null, "PF"), React.createElement("div", null, "PA"), React.createElement("div", null, "\xB1"))), ne.map((i, o) => React.createElement("div", {
      key: i.id,
      style: {
        display: "grid",
        gridTemplateColumns: "28px 1fr 34px 34px 34px 40px 40px 40px",
        gap: 3,
        padding: "8px 12px",
        borderBottom: `1px solid ${ C.border }`,
        background: o < n.topNAdvance ? `${ C.lime }06` : "transparent",
        alignItems: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 800,
        color: o < n.topNAdvance ? C.lime : C.textDim
      }
    }, o + 1), React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, i.fullName), React.createElement("div", {
      style: {
        textAlign: "center",
        fontSize: 11,
        color: C.textMuted
      }
    }, i.gP), React.createElement("div", {
      style: {
        textAlign: "center",
        fontSize: 11,
        fontWeight: 700,
        color: C.lime
      }
    }, i.gW), React.createElement("div", {
      style: {
        textAlign: "center",
        fontSize: 11,
        color: C.red
      }
    }, i.gL), React.createElement("div", {
      style: {
        textAlign: "center",
        fontSize: 11,
        color: C.textMuted
      }
    }, i.gPF), React.createElement("div", {
      style: {
        textAlign: "center",
        fontSize: 11,
        color: C.textMuted
      }
    }, i.gPA), React.createElement("div", {
      style: {
        textAlign: "center",
        fontSize: 11,
        fontWeight: 700,
        color: i.gD > 0 ? C.lime : C.red
      }
    }, i.gD > 0 ? "+" : "", i.gD)))), React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        marginBottom: 8
      }
    }, "Matches (", P, "/", w.matches.length, ")"), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 5
      }
    }, React.createElement("div", {
      style: { display: "flex", gap: 6, alignItems: "center", marginBottom: 8, flexWrap: "wrap" }
    }, [
      { v: "score", label: "\u2328 Score entry" },
      { v: "ref", label: "\u25B6 Referee" }
    ].map(opt => React.createElement("button", {
      key: opt.v,
      onClick: () => setEntryMode(opt.v),
      style: {
        minHeight: 38, padding: "0 12px", borderRadius: 20, cursor: "pointer", fontFamily: "inherit",
        fontSize: 11.5, fontWeight: 700,
        border: `1px solid ${ entryMode === opt.v ? C.lime : C.border }`,
        background: entryMode === opt.v ? C.lime : C.card,
        color: entryMode === opt.v ? "#fff" : C.text
      }
    }, opt.label)), React.createElement("span", {
      style: { fontSize: 10, color: C.textDim }
    }, entryMode === "score" ? "Type the scores straight into the list." : "Tap SCORE on a match to open the live court.")),
    React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 5
      }
    }, w.matches.map(i => {
      const box = side => React.createElement("input", {
        type: "number",
        inputMode: "numeric",
        "aria-label": side === "a" ? "Score for " + i.teamA.fullName : "Score for " + i.teamB.fullName,
        defaultValue: i.played ? (side === "a" ? i.scoreA : i.scoreB) : "",
        disabled: n.trackScores === !1 || entryMode !== "score",
        onChange: ev => {
          const p = pend.current[i.id] || (pend.current[i.id] = {});
          p[side] = ev.target.value;
        },
        onKeyDown: ev => {
          ev.key === "Enter" && ev.target.blur();
        },
        onBlur: () => {
          const ok = parseScorePair(pend.current[i.id], i);
          if (!ok) return;
          delete pend.current[i.id];
          commitScore(i, w, ok.a, ok.b);
        },
        style: {
          width: 46, height: 38, textAlign: "center", borderRadius: 8,
          border: `1px solid ${ i.played ? C.lime + "55" : C.border }`,
          background: n.trackScores === !1 || entryMode !== "score" ? C.cardAlt : C.surface,
          color: C.text, fontSize: 15, fontWeight: 800, fontFamily: "inherit", outline: "none"
        }
      });
      const teamCell = (tm, right) => React.createElement("div", {
        style: {
          flex: 1, minWidth: 82, textAlign: right ? "left" : "right",
          fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          fontWeight: i.winner === tm.id ? 800 : 500,
          color: i.winner === tm.id ? C.lime : C.text
        }
      }, tm.fullName);
      return React.createElement("div", {
        key: i.id,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "7px 10px",
          background: C.card,
          borderRadius: 10,
          border: `1px solid ${ i.played ? C.lime + "33" : C.border }`
        }
      }, React.createElement("div", {
        style: {
          width: 26, height: 26, borderRadius: 6, flexShrink: 0,
          background: i.played ? `${ C.lime }22` : C.cardAlt,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 9, fontWeight: 800,
          color: i.played ? C.lime : C.textDim
        },
        title: i.timeStart ? i.timeStart + " \xB7 Court " + i.court : "Court " + i.court
      }, "M", i.matchNum),
        teamCell(i.teamA, !1),
        box("a"),
        React.createElement("span", { style: { fontSize: 11, color: C.textDim, fontWeight: 700 } }, "\u2013"),
        box("b"),
        teamCell(i.teamB, !0),
        React.createElement("button", {
          onClick: () => setRefM({
            match: { log: [], server: "a", posA: 0, posB: 0, timing: emptyTiming() },
            rules: resolveRules(n.sport, { target: n.pointsToWin, ...n.scoring || {} }),
            title: `${ i.teamA.fullName } v ${ i.teamB.fullName }`,
            subtitle: `Court ${ i.court } \xB7 Group ${ w.label }`,
            teamA: i.teamA.fullName,
            teamB: i.teamB.fullName,
            namesA: [i.teamA?.p1?.firstName || i.teamA?.fullName || "", i.teamA?.p2?.firstName || ""].filter(Boolean),
            namesB: [i.teamB?.p1?.firstName || i.teamB?.fullName || "", i.teamB?.p2?.firstName || ""].filter(Boolean),
            onDone: st => commitScore(i, w, st.a, st.b)
          }),
          disabled: n.trackScores === !1,
          style: {
            minHeight: 34, padding: "0 10px", borderRadius: 8, flexShrink: 0, cursor: "pointer",
            fontFamily: "inherit", fontSize: 9.5, fontWeight: 800, letterSpacing: .06,
            border: `1px solid ${ entryMode === "ref" ? C.teal : C.border }`,
            background: entryMode === "ref" ? C.teal : C.card,
            color: entryMode === "ref" ? "#fff" : C.teal
          }
        }, "SCORE"));
    })))), le && React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 10,
        flexWrap: "wrap"
      }
    }, React.createElement(Btn, {
      small: !0,
      color: C.orange,
      onClick: () => {
        if (!window.confirm("Reopen the league stage? The knockout bracket for this category will be removed so you can edit group results."))
          return;
        const kb = { ...n.knockoutBrackets };
        delete kb[S];
        const ch = { ...n.champions || {} };
        delete ch[S];
        const tp2 = { ...n.thirdPlace || {} };
        delete tp2[S];
        const T2 = {
          ...n,
          knockoutBrackets: kb,
          champions: ch,
          thirdPlace: tp2,
          status: "active"
        };
        R(T2), l(T2), e(A => A.map(x => x.id === T2.id ? T2 : x));
      }
    }, "\u21A9 Reopen League"), React.createElement(Btn, {
      small: !0,
      color: swapMode ? C.lime : C.teal,
      onClick: () => {
        setSwapMode(!swapMode), setSwapSel(null);
      }
    }, swapMode ? "\u2713 Done Rearranging" : "\u21C4 Rearrange R1"), swapMode && React.createElement("span", {
      style: {
        fontSize: 10,
        color: C.textDim,
        alignSelf: "center"
      }
    }, swapSel ? "Now tap the team to swap with" : "Tap a Round-1 team")), le && React.createElement("div", { style: { overflowX: "auto" } }, React.createElement("div", {
      style: {
        display: "flex",
        gap: 12,
        minWidth: le.length * 200
      }
    }, le.map((i, o) => React.createElement("div", {
      key: o,
      style: {
        flex: 1,
        minWidth: 190
      }
    }, React.createElement("div", {
      style: {
        textAlign: "center",
        padding: 6,
        marginBottom: 8,
        background: C.card,
        borderRadius: 8,
        fontSize: 9,
        fontWeight: 700,
        color: C.orange
      }
    }, ce(le.length, o + 1)), i.map((t, a) => {
      const W = t.p1 && t.p2 && !t.played && !t.isBye;
      return React.createElement("div", {
        key: t.id,
        onClick: () => {
          if (swapMode)
            return;
          W ? (k({
            rIdx: o,
            mIdx: a,
            match: t
          }), O(""), J("")) : t.played && !t.isBye && (k({
            rIdx: o,
            mIdx: a,
            match: t
          }), O(String(t.s1)), J(String(t.s2)));
        },
        style: {
          background: C.card,
          borderRadius: 10,
          border: `1px solid ${ t.played && !t.isBye ? C.orange + "44" : W ? C.teal + "44" : C.border }`,
          marginBottom: 8,
          cursor: W || t.played ? "pointer" : "default"
        }
      }, [
        {
          p: t.p1,
          sc: t.s1,
          w: t.winner && t.p1 && t.winner === t.p1.id
        },
        {
          p: t.p2,
          sc: t.s2,
          w: t.winner && t.p2 && t.winner === t.p2.id
        }
      ].map((q, E) => React.createElement("div", {
        key: E,
        onClick: ev => {
          if (!swapMode || o !== 0 || t.played || t.isBye || !q.p)
            return;
          ev.stopPropagation();
          if (!swapSel) {
            setSwapSel({
              mIdx: a,
              slot: E
            });
            return;
          }
          if (swapSel.mIdx === a && swapSel.slot === E) {
            setSwapSel(null);
            return;
          }
          const X2 = n.knockoutBrackets[S].map(A => A.map(x => ({ ...x })));
          const m1 = X2[0][swapSel.mIdx], m2 = X2[0][a];
          const v1 = swapSel.slot === 0 ? m1.p1 : m1.p2, v2 = E === 0 ? m2.p1 : m2.p2;
          swapSel.slot === 0 ? m1.p1 = v2 : m1.p2 = v2, E === 0 ? m2.p1 = v1 : m2.p2 = v1;
          const T2 = {
            ...n,
            knockoutBrackets: {
              ...n.knockoutBrackets,
              [S]: X2
            }
          };
          R(T2), l(T2), e(A => A.map(x => x.id === T2.id ? T2 : x)), setSwapSel(null);
        },
        style: {
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "7px 9px",
          background: swapMode && swapSel && swapSel.mIdx === a && swapSel.slot === E && o === 0 ? `${ C.lime }22` : q.w ? `${ C.orange }11` : "transparent",
          borderBottom: E === 0 ? `1px solid ${ C.border }` : "none",
          cursor: swapMode && o === 0 && !t.played && q.p ? "pointer" : void 0,
          outline: swapMode && o === 0 && !t.played && q.p ? `1px dashed ${ C.teal }55` : "none"
        }
      }, React.createElement("div", {
        style: {
          width: 4,
          height: 4,
          borderRadius: "50%",
          background: q.w ? C.orange : q.p ? C.textDim : "transparent"
        }
      }), React.createElement("div", {
        style: {
          flex: 1,
          fontSize: 10,
          fontWeight: q.w ? 700 : 500,
          color: q.p ? q.w ? C.orange : C.text : C.textDim,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }
      }, q.p ? q.p.fullName : "TBD"), q.sc !== null && React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 800,
          color: q.w ? C.orange : C.textDim
        }
      }, q.sc))), W && !swapMode && React.createElement("div", {
        style: {
          textAlign: "center",
          padding: "3px 0",
          fontSize: 8,
          color: C.teal,
          fontWeight: 600
        }
      }, "Tap to score"));
    }))))), n.tourFormat === "double_elim" && (n.loserBrackets || {})[S] && (n.loserBrackets[S] || []).length > 0 && React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 800,
        color: C.red,
        textTransform: "uppercase",
        letterSpacing: 1,
        margin: "14px 0 8px"
      }
    }, "\u2694 Losers Bracket \u2014 second chance"), React.createElement("div", { style: { overflowX: "auto" } }, React.createElement("div", {
      style: {
        display: "flex",
        gap: 12,
        minWidth: n.loserBrackets[S].length * 180
      }
    }, n.loserBrackets[S].map((rd3, ri3) => React.createElement("div", {
      key: ri3,
      style: {
        flex: 1,
        minWidth: 170
      }
    }, React.createElement("div", {
      style: {
        textAlign: "center",
        padding: 5,
        marginBottom: 8,
        background: C.card,
        borderRadius: 8,
        fontSize: 9,
        fontWeight: 700,
        color: C.red
      }
    }, "LB Round ", ri3 + 1), rd3.map((mt3, mi3) => {
      const ready3 = mt3.p1 && mt3.p2 && !mt3.played;
      return React.createElement("div", {
        key: mt3.id,
        onClick: () => {
          ready3 ? (k({
            br: "L",
            rIdx: ri3,
            mIdx: mi3,
            match: mt3
          }), O(""), J("")) : mt3.played && (k({
            br: "L",
            rIdx: ri3,
            mIdx: mi3,
            match: mt3
          }), O(String(mt3.s1)), J(String(mt3.s2)));
        },
        style: {
          background: C.card,
          borderRadius: 10,
          border: `1px solid ${ mt3.played ? C.red + "44" : ready3 ? C.teal + "44" : C.border }`,
          marginBottom: 8,
          padding: "7px 9px",
          cursor: ready3 || mt3.played ? "pointer" : "default"
        }
      }, [
        [
          mt3.p1,
          mt3.s1
        ],
        [
          mt3.p2,
          mt3.s2
        ]
      ].map(([pp3, sc3], k3) => React.createElement("div", {
        key: k3,
        style: {
          display: "flex",
          justifyContent: "space-between",
          fontSize: 10,
          color: pp3 ? mt3.winner === pp3.id ? C.red : C.text : C.textDim,
          fontWeight: pp3 && mt3.winner === pp3.id ? 700 : 500,
          padding: "2px 0"
        }
      }, React.createElement("span", null, pp3 ? pp3.fullName : "TBD"), sc3 !== null && React.createElement("b", null, sc3))));
    }))))), (() => {
      const gf3 = (n.grandFinals || {})[S];
      if (!gf3 || !gf3.p1 && !gf3.p2)
        return null;
      const ready3 = gf3.p1 && gf3.p2 && !gf3.played;
      return React.createElement("div", {
        onClick: () => {
          ready3 ? (k({
            br: "G",
            rIdx: 0,
            mIdx: 0,
            match: gf3
          }), O(""), J("")) : gf3.played && (k({
            br: "G",
            rIdx: 0,
            mIdx: 0,
            match: gf3
          }), O(String(gf3.s1)), J(String(gf3.s2)));
        },
        style: {
          background: `linear-gradient(135deg,${ C.gold }18,${ C.card })`,
          borderRadius: 12,
          border: `1px solid ${ C.gold }66`,
          padding: 12,
          marginTop: 12,
          cursor: "pointer"
        }
      }, React.createElement("div", {
        style: {
          fontSize: 10,
          fontWeight: 800,
          color: C.gold,
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 6
        }
      }, "\uD83C\uDFC6 Grand Final"), React.createElement("div", {
        style: {
          fontSize: 12,
          color: C.text,
          display: "flex",
          justifyContent: "space-between",
          gap: 8
        }
      }, React.createElement("span", { style: { fontWeight: gf3.winner && gf3.p1 && gf3.winner === gf3.p1.id ? 800 : 500 } }, gf3.p1 ? gf3.p1.fullName : "Winners bracket champ"), gf3.played ? React.createElement("b", { style: { color: C.gold } }, gf3.s1, " \u2013 ", gf3.s2) : React.createElement("span", {
        style: {
          fontSize: 10,
          color: C.textDim
        }
      }, ready3 ? "tap to score" : "awaiting finalists"), React.createElement("span", {
        style: {
          fontWeight: gf3.winner && gf3.p2 && gf3.winner === gf3.p2.id ? 800 : 500,
          textAlign: "right"
        }
      }, gf3.p2 ? gf3.p2.fullName : "Losers bracket champ")));
    })()), (n.thirdPlace || {})[S] && (() => {
      const tp = n.thirdPlace[S];
      return React.createElement("div", {
        onClick: () => {
          k({
            rIdx: -1,
            mIdx: 0,
            match: tp
          }), tp.played ? (O(String(tp.s1)), J(String(tp.s2))) : (O(""), J(""));
        },
        style: {
          background: C.card,
          borderRadius: 12,
          border: `1px solid ${ C.bronze }55`,
          padding: 12,
          marginTop: 12,
          cursor: "pointer"
        }
      }, React.createElement("div", {
        style: {
          fontSize: 10,
          fontWeight: 800,
          color: C.bronze,
          textTransform: "uppercase",
          letterSpacing: 1,
          marginBottom: 6
        }
      }, "\uD83E\uDD49 3rd Place Playoff"), React.createElement("div", {
        style: {
          fontSize: 12,
          color: C.text,
          display: "flex",
          justifyContent: "space-between",
          gap: 8
        }
      }, React.createElement("span", { style: { fontWeight: tp.winner === tp.p1.id ? 800 : 500 } }, tp.p1.fullName), tp.played ? React.createElement("b", { style: { color: C.bronze } }, tp.s1, " \u2013 ", tp.s2) : React.createElement("span", {
        style: {
          fontSize: 10,
          color: C.textDim
        }
      }, "tap to score"), React.createElement("span", {
        style: {
          fontWeight: tp.winner === tp.p2.id ? 800 : 500,
          textAlign: "right"
        }
      }, tp.p2.fullName)));
    })(), n.champions?.[S] && React.createElement("div", {
      style: {
        background: `linear-gradient(135deg,${ C.gold }22,${ C.orange }11)`,
        borderRadius: 16,
        padding: 22,
        textAlign: "center",
        border: `1px solid ${ C.gold }33`,
        marginTop: 8
      }
    }, React.createElement("div", { style: { fontSize: 32 } }, "\uD83C\uDFC6"), React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: C.gold,
        textTransform: "uppercase",
        marginTop: 4
      }
    }, "Champion"), React.createElement("div", {
      style: {
        fontSize: 20,
        fontWeight: 800,
        color: C.text,
        marginTop: 4
      }
    }, n.champions[S])), printOpen && React.createElement(Modal, {
      onClose: () => setPrintOpen(!1)
    }, React.createElement("div", { style: { padding: 20 } }, React.createElement("h3", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 4px",
        textAlign: "center"
      }
    }, "Print / Save as PDF"), React.createElement("p", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textAlign: "center",
        margin: "0 0 14px"
      }
    }, "Choose \"Save as PDF\" in the print dialog to get a file."), [
      {
        label: "Fixture sheets \u2014 blank",
        hint: "Print before play and fill in at the court",
        only: "fixtures",
        data: !1
      },
      {
        label: "Fixtures + results",
        hint: "Everything scored so far",
        only: "fixtures",
        data: !0
      },
      {
        label: "Standings",
        hint: "The table people ask for after the last match",
        only: "standings",
        data: !0
      },
      {
        label: "Knockout draw",
        hint: "Bracket sheets, blank slots where undecided",
        only: "bracket",
        data: !0
      },
      {
        label: "Everything",
        hint: "Fixtures, draw and standings in one book",
        only: null,
        data: !0
      }
    ].map(opt => React.createElement("button", {
      key: opt.label,
      onClick: () => {
        setPrintOpen(!1), setTimeout(() => printPack(n, opt.data, opt.only), 60);
      },
      style: {
        width: "100%",
        minHeight: 52,
        marginBottom: 8,
        padding: "8px 12px",
        borderRadius: 10,
        cursor: "pointer",
        textAlign: "left",
        fontFamily: "inherit",
        border: `1px solid ${ C.border }`,
        background: C.card
      }
    }, React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: C.text
      }
    }, opt.label), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim,
        marginTop: 1
      }
    }, opt.hint))), React.createElement(Btn, {
      full: !0,
      onClick: () => setPrintOpen(!1)
    }, "Cancel"))), refM && React.createElement(RefConsole, {
      match: refM.match,
      rules: refM.rules,
      title: refM.title,
      teamA: refM.teamA,
      teamB: refM.teamB,
      namesA: refM.namesA,
      namesB: refM.namesB,
      onChange: mm => setRefM(p => ({ ...p, match: mm })),
      onFinish: st => {
        /* Opened from a fixture row: commit straight to the match, no modal.
           Opened from the score modal: fill its inputs and let the organiser
           press Save, which is the path that was already there. */
        refM.onDone ? refM.onDone(st) : (O(String(st.a)), J(String(st.b))), setRefM(null);
      },
      onClose: () => setRefM(null)
    }), g && React.createElement(Modal, {
      onClose: () => {
        f(null), O(""), J("");
      }
    }, React.createElement("div", { style: { padding: 24 } }, React.createElement("h3", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 4px",
        textAlign: "center"
      }
    }, g.played ? "Edit Score" : "Enter Score"), React.createElement("p", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textAlign: "center",
        margin: "0 0 16px"
      }
    }, "Game to ", n.pointsToWin, " \xB7 Court ", g.court, " \xB7 Group ", w.label), React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12
      }
    }, React.createElement("div", {
      style: {
        flex: 1,
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text,
        marginBottom: 6
      }
    }, g.teamA.fullName), React.createElement("input", {
      ref: D,
      value: G,
      onChange: i => O(i.target.value),
      type: "number",
      style: {
        width: 56,
        padding: "10px 0",
        textAlign: "center",
        background: C.card,
        border: `2px solid ${ C.border }`,
        borderRadius: 12,
        color: C.text,
        fontSize: 24,
        fontWeight: 800,
        outline: "none",
        fontFamily: "inherit"
      }
    })), React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: C.textDim
      }
    }, "vs"), React.createElement("div", {
      style: {
        flex: 1,
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text,
        marginBottom: 6
      }
    }, g.teamB.fullName), React.createElement("input", {
      value: K,
      onChange: i => J(i.target.value),
      type: "number",
      style: {
        width: 56,
        padding: "10px 0",
        textAlign: "center",
        background: C.card,
        border: `2px solid ${ C.border }`,
        borderRadius: 12,
        color: C.text,
        fontSize: 24,
        fontWeight: 800,
        outline: "none",
        fontFamily: "inherit"
      }
    }))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 16
      }
    }, React.createElement("button", {
      onClick: () => setRefM({
        match: { log: [], server: "a", posA: 0, posB: 0, timing: emptyTiming() },
        rules: resolveRules(n.sport, { target: n.pointsToWin, ...n.scoring || {} }),
        title: `${ g.teamA.fullName } v ${ g.teamB.fullName }`,
        teamA: g.teamA.fullName,
        teamB: g.teamB.fullName,
        namesA: [g.teamA?.p1?.firstName || g.teamA?.fullName || "", g.teamA?.p2?.firstName || ""].filter(Boolean),
        namesB: [g.teamB?.p1?.firstName || g.teamB?.fullName || "", g.teamB?.p2?.firstName || ""].filter(Boolean)
      }),
      style: {
        width: "100%", minHeight: 46, marginBottom: 8, borderRadius: 10, cursor: "pointer",
        border: `1px solid ${ C.teal }`, background: C.card, color: C.teal,
        fontWeight: 800, fontSize: 13, fontFamily: "inherit"
      }
    }, "\u25B6 Referee live \u2014 score rally by rally"), React.createElement(Btn, {
      full: !0,
      onClick: () => {
        f(null), O(""), J("");
      }
    }, "Cancel"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: () => ee(!1)
    }, "Save"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.teal,
      onClick: () => ee(!0)
    }, "Save & Next ", React.createElement(Ic, {
      t: "arrowRight",
      s: 14
    }))))), u && React.createElement(Modal, {
      onClose: () => {
        k(null), O(""), J("");
      }
    }, React.createElement("div", { style: { padding: 24 } }, React.createElement("h3", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 4px",
        textAlign: "center"
      }
    }, ce(le.length, u.rIdx + 1)), React.createElement("p", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textAlign: "center",
        margin: "0 0 16px"
      }
    }, "Game to ", n.pointsToWin, " \xB7 Knockout Round"), React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12
      }
    }, React.createElement("div", {
      style: {
        flex: 1,
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text,
        marginBottom: 6
      }
    }, u.match.p1?.fullName || "TBD"), React.createElement("input", {
      ref: D,
      value: G,
      onChange: i => O(i.target.value),
      type: "number",
      style: {
        width: 56,
        padding: "10px 0",
        textAlign: "center",
        background: C.card,
        border: `2px solid ${ C.border }`,
        borderRadius: 12,
        color: C.text,
        fontSize: 24,
        fontWeight: 800,
        outline: "none",
        fontFamily: "inherit"
      }
    })), React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: C.textDim
      }
    }, "vs"), React.createElement("div", {
      style: {
        flex: 1,
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text,
        marginBottom: 6
      }
    }, u.match.p2?.fullName || "TBD"), React.createElement("input", {
      value: K,
      onChange: i => J(i.target.value),
      type: "number",
      style: {
        width: 56,
        padding: "10px 0",
        textAlign: "center",
        background: C.card,
        border: `2px solid ${ C.border }`,
        borderRadius: 12,
        color: C.text,
        fontSize: 24,
        fontWeight: 800,
        outline: "none",
        fontFamily: "inherit"
      }
    }))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 16
      }
    }, React.createElement("button", {
      onClick: () => setRefM({
        match: { log: [], server: "a", posA: 0, posB: 0, timing: emptyTiming() },
        rules: resolveRules(n.sport, { target: n.pointsToWin, ...n.scoring || {} }),
        title: `${ u.match.p1?.fullName || "TBD" } v ${ u.match.p2?.fullName || "TBD" }`,
        teamA: u.match.p1?.fullName || "Team A",
        teamB: u.match.p2?.fullName || "Team B",
        namesA: [u.match.p1?.p1?.firstName || u.match.p1?.fullName || "", u.match.p1?.p2?.firstName || ""].filter(Boolean),
        namesB: [u.match.p2?.p1?.firstName || u.match.p2?.fullName || "", u.match.p2?.p2?.firstName || ""].filter(Boolean)
      }),
      style: {
        width: "100%", minHeight: 46, marginBottom: 8, borderRadius: 10, cursor: "pointer",
        border: `1px solid ${ C.teal }`, background: C.card, color: C.teal,
        fontWeight: 800, fontSize: 13, fontFamily: "inherit"
      }
    }, "\u25B6 Referee live \u2014 score rally by rally"), React.createElement(Btn, {
      full: !0,
      onClick: () => {
        k(null), O(""), J("");
      }
    }, "Cancel"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.orange,
      onClick: () => L(!1)
    }, "Save Score"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: () => L(!0)
    }, "Save & Next")))));
  }, TournamentListTab = ({
    tournaments: m0,
    setActiveTourney: c,
    setTab: e,
    currentUser: cu
  }) => {
    const [eligOnly, setEligOnly] = useState(!1), m = eligOnly && cu ? m0.filter(tt => (tt.categories || []).some(ct => checkEligibility(cu, ct, tt.tournamentDate).length === 0)) : m0, d = m.filter(r => r.status !== "completed"), p = m.filter(r => r.status === "completed");
    return React.createElement("div", null, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "flex-end",
        marginBottom: 8
      }
    }, React.createElement("button", {
      onClick: () => cu ? setEligOnly(!eligOnly) : alert("Register as a player first to see eligible tournaments."),
      style: {
        padding: "7px 14px",
        borderRadius: 20,
        border: `1.5px solid ${ eligOnly ? C.lime : C.border }`,
        background: eligOnly ? `${ C.lime }20` : C.card,
        color: eligOnly ? C.lime : C.textMuted,
        fontWeight: 700,
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, eligOnly ? "\u2713 Eligible for me" : "\u2728 Eligible for me")), React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16
      }
    }, React.createElement("button", {
      onClick: () => e("home"),
      style: {
        background: C.card,
        border: "none",
        borderRadius: 8,
        padding: "8px 12px",
        color: C.textMuted,
        cursor: "pointer"
      }
    }, React.createElement(Ic, {
      t: "back",
      s: 16
    })), React.createElement("h2", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: C.text,
        margin: 0
      }
    }, "Tournaments")), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: () => e("create"),
      style: { marginBottom: 16 }
    }, React.createElement(Ic, {
      t: "plus",
      s: 14
    }), " Create New Tournament"), d.length > 0 && React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        marginBottom: 8
      }
    }, "Active (", d.length, ")"), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginBottom: 18
      }
    }, d.map(r => React.createElement("div", {
      key: r.id,
      onClick: () => {
        c(r), e("tourney");
      },
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${ C.lime }33`,
        cursor: "pointer",
        borderLeft: `3px solid ${ C.lime }`
      }
    }, React.createElement("div", {
      style: {
        width: 40,
        height: 40,
        borderRadius: 10,
        background: `${ C.lime }18`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: C.lime
      }
    }, React.createElement(Ic, {
      t: "trophy",
      s: 20
    })), React.createElement("div", { style: { flex: 1 } }, React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: C.text
      }
    }, r.name), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, r.categories?.length || 0, " categories \xB7 ", r.groups?.length || 0, " groups \xB7 ", fp(r.entryFee), "/team", r.venue ? ` \xB7 \u{1F4CD} ${ r.venue }` : "")))))), p.length > 0 && React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        marginBottom: 8
      }
    }, "Completed (", p.length, ")"), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, p.map(r => React.createElement("div", {
      key: r.id,
      onClick: () => {
        c(r), e("tourney");
      },
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${ C.border }`,
        cursor: "pointer",
        opacity: 0.7
      }
    }, React.createElement("div", {
      style: {
        width: 40,
        height: 40,
        borderRadius: 10,
        background: `${ C.gold }18`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: C.gold
      }
    }, React.createElement(Ic, {
      t: "trophy",
      s: 20
    })), React.createElement("div", { style: { flex: 1 } }, React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: C.text
      }
    }, r.name), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, "Champions: ", Object.values(r.champions || {}).filter(Boolean).join(", ") || "N/A")))))));
  }, PlayerProfile = ({
    player: m,
    onBack: c,
    players: e,
    currentUser: d,
    setPlayers: p
  }) => {
    const [r, l] = useState(null), [n, R] = useState(!1), [S, v] = useState(!1), [M, z] = useState(!1), [g, f] = useState(""), u = useMemo(() => {
        const i = new Set(TAG_PRESETS);
        return e.forEach(o => {
          o.tags && Object.keys(o.tags).forEach(t => i.add(t));
        }), Array.from(i).sort();
      }, [e]), k = useMemo(() => g.trim() ? u.filter(i => i.toLowerCase().includes(g.toLowerCase())) : u, [
        g,
        u
      ]), [G, O] = useState(""), [K, J] = useState(SKILLS.reduce((i, o) => ({
        ...i,
        [o]: 3
      }), {})), D = e.find(i => i.id === m.id) || m, I = getTier(D.bestRating), ae = D.wins + D.losses > 0 ? (D.wins / (D.wins + D.losses) * 100).toFixed(0) : "0", w = Object.entries(D.tags || {}).sort((i, o) => o[1] - i[1]), P = D.skillRatingsCount > 0, profStats = (() => {
        const hist = D.matchHistory || [], meds = D.medals || [], now = new Date(), yr = now.getFullYear();
        const cnt = t => meds.filter(x => x.type === t).length;
        const fmt = {};
        hist.forEach(h => {
          const f2 = h.format || "Other";
          fmt[f2] = fmt[f2] || {
            w: 0,
            l: 0
          }, h.won ? fmt[f2].w++ : fmt[f2].l++;
        });
        const inDays = (iso, days2) => iso ? now - new Date(iso) <= days2 * 86400000 : !1;
        const gWeek = hist.filter(h => inDays(h.date, 7)).length, gMonth = hist.filter(h => inDays(h.date, 30)).length, gYear = hist.filter(h => h.date && new Date(h.date).getFullYear() === yr).length;
        const tByYear = {};
        hist.forEach(h => {
          if (h.format === "Community" || !h.tournament)
            return;
          const y2 = h.date ? new Date(h.date).getFullYear() : "Earlier";
          tByYear[y2] = tByYear[y2] || new Set(), tByYear[y2].add(h.tournament);
        });
        const yrHist = hist.filter(h => h.date && new Date(h.date).getFullYear() === yr), yrWins = yrHist.filter(h => h.won).length, yrDelta = yrHist.reduce((s2, h) => s2 + (h.ratingChange || 0), 0), yrMeds = meds.filter(x => x.year === yr).length;
        const ps = D.partnerStats || {}, bpArr = Object.entries(ps).map(([pid, s3]) => ({
          pid,
          ...s3
        })).sort((a3, b3) => b3.wins - a3.wins || b3.wins / (b3.wins + b3.losses || 1) - a3.wins / (a3.wins + a3.losses || 1)), bp = bpArr[0] || null;
        const tierRec = {};
        hist.forEach(h => {
          const names = String(h.opponent || "").split(" | ");
          names.forEach(nm => {
            const op = e.find(px => px.fullName === nm);
            if (!op)
              return;
            const tn = getTier(op.bestRating).name;
            tierRec[tn] = tierRec[tn] || {
              w: 0,
              l: 0
            }, h.won ? tierRec[tn].w++ : tierRec[tn].l++;
          });
        });
        return {
          bestPartner: bp ? {
            name: e.find(px => px.id === bp.pid)?.fullName || bp.pid,
            wins: bp.wins,
            losses: bp.losses
          } : null,
          tierRec: tierRec,
          gold: cnt("\uD83E\uDD47"),
          silver: cnt("\uD83E\uDD48"),
          bronze: cnt("\uD83E\uDD49"),
          fmt: fmt,
          gWeek: gWeek,
          gMonth: gMonth,
          gYear: gYear,
          gTotal: hist.length,
          tByYear: Object.entries(tByYear).map(([y2, s2]) => [
            y2,
            s2.size
          ]).sort((a2, b2) => String(b2[0]).localeCompare(String(a2[0]))),
          yr: yr,
          yrGames: yrHist.length,
          yrWins: yrWins,
          yrPct: yrHist.length ? Math.round(yrWins / yrHist.length * 100) : 0,
          yrDelta: yrDelta,
          yrMeds: yrMeds
        };
      })(), ne = (i, o) => !i || !o ? !1 : i.matchHistory?.some(t => t.opponent === o.fullName) || o.matchHistory?.some(t => t.opponent === i.fullName) || !1, Y = d && d.id !== D.id, ee = () => {
        const i = {};
        return D.matchHistory?.forEach(o => {
          const t = e.find(a => a.fullName === o.opponent);
          if (t) {
            const a = getTier(t.bestRating).name;
            i[a] || (i[a] = {
              wins: 0,
              losses: 0
            }), o.won ? i[a].wins++ : i[a].losses++;
          }
        }), i;
      }, L = () => {
        const i = {};
        return D.matchHistory?.forEach(o => {
          const t = o.format || "Unknown";
          i[t] || (i[t] = {
            wins: 0,
            losses: 0
          }), o.won ? i[t].wins++ : i[t].losses++;
        }), i;
      }, se = () => {
        const i = D.partnerStats || {};
        return Object.entries(i).map(([o, t]) => ({
          partnerName: e.find(W => W.id === o)?.fullName || o,
          ...t
        })).sort((o, t) => t.wins - o.wins);
      }, ge = () => {
        p(i => i.map(o => {
          if (o.id !== D.id)
            return o;
          const t = o.skillRatingsCount + 1, a = {};
          return SKILLS.forEach(W => {
            a[W] = Math.round((o.skills[W] * o.skillRatingsCount + K[W]) / t * 10) / 10;
          }), {
            ...o,
            skills: a,
            skillRatingsCount: t
          };
        })), R(!1);
      }, ce = i => {
        p(o => o.map(t => t.id !== D.id ? t : {
          ...t,
          tags: {
            ...t.tags,
            [i]: (t.tags[i] || 0) + 1
          }
        })), v(!1);
      }, le = () => {
        const i = window.location.href.split("?")[0];
        window.open(`https://wa.me/?text=${ encodeURIComponent(`Rate my skills on RISE Sports!
${ i }`) }`, "_blank");
      };
    return React.createElement("div", null, React.createElement("button", {
      onClick: c,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "8px 14px",
        background: C.card,
        border: "none",
        borderRadius: 8,
        color: C.textMuted,
        fontWeight: 600,
        fontSize: 12,
        cursor: "pointer",
        marginBottom: 14,
        fontFamily: "inherit"
      }
    }, React.createElement(Ic, {
      t: "back",
      s: 16
    }), " Back"), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 16,
        padding: 18,
        border: `1px solid ${ C.border }`,
        marginBottom: 14,
        position: "relative",
        overflow: "hidden"
      }
    }, React.createElement("div", {
      style: {
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: `linear-gradient(90deg,${ I.color },${ C.lime })`
      }
    }), React.createElement("div", {
      style: {
        display: "flex",
        gap: 14,
        alignItems: "center",
        marginBottom: 12
      }
    }, React.createElement(Avi, {
      name: D.firstName,
      color: I.color,
      size: 52,
      gender: D.gender,
      imageUrl: D.avatarUrl
    }), React.createElement("div", { style: { flex: 1 } }, React.createElement("div", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: C.text
      }
    }, D.fullName), React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.lime,
        fontFamily: "monospace"
      }
    }, D.id), React.createElement("div", {
      style: {
        display: "flex",
        gap: 4,
        marginTop: 4,
        flexWrap: "wrap"
      }
    }, React.createElement(Badge, { color: I.color }, I.emoji, " ", I.name, " \xB7 ", D.bestRating, " GSR"), React.createElement(Badge, {
      color: C.textMuted,
      small: !0
    }, D.gender === "M" ? "M" : "F", " \xB7 ", D.hand), (D.medals || []).length > 0 && React.createElement(Badge, {
      color: C.gold,
      small: !0
    }, "\uD83C\uDFC5", (D.medals || []).length), D.duprId && React.createElement(Badge, {
      color: C.purple,
      small: !0
    }, "DUPR: ", D.duprId)))), (profStats.gold + profStats.silver + profStats.bronze > 0 || profStats.gTotal > 0) && React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 10
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 8
      }
    }, "Podium Finishes"), React.createElement("svg", {
      width: "100%",
      height: 120,
      viewBox: "0 0 260 120",
      style: { display: "block" }
    }, React.createElement("text", {
      x: 65,
      y: 34,
      textAnchor: "middle",
      fontSize: 16
    }, "\uD83E\uDD48"), React.createElement("rect", {
      x: 35,
      y: 60,
      width: 60,
      height: 55,
      rx: 6,
      fill: C.silver,
      opacity: 0.35
    }), React.createElement("text", {
      x: 65,
      y: 93,
      textAnchor: "middle",
      fontSize: 20,
      fontWeight: 800,
      fill: C.text
    }, profStats.silver), React.createElement("text", {
      x: 130,
      y: 34,
      textAnchor: "middle",
      fontSize: 16
    }, "\uD83E\uDD47"), React.createElement("rect", {
      x: 100,
      y: 42,
      width: 60,
      height: 73,
      rx: 6,
      fill: C.gold,
      opacity: 0.4
    }), React.createElement("text", {
      x: 130,
      y: 84,
      textAnchor: "middle",
      fontSize: 22,
      fontWeight: 800,
      fill: C.text
    }, profStats.gold), React.createElement("text", {
      x: 195,
      y: 70,
      textAnchor: "middle",
      fontSize: 16
    }, "\uD83E\uDD49"), React.createElement("rect", {
      x: 165,
      y: 78,
      width: 60,
      height: 37,
      rx: 6,
      fill: C.bronze,
      opacity: 0.35
    }), React.createElement("text", {
      x: 195,
      y: 102,
      textAnchor: "middle",
      fontSize: 18,
      fontWeight: 800,
      fill: C.text
    }, profStats.bronze)), Object.keys(profStats.fmt).length > 0 && React.createElement("div", { style: { marginTop: 12 } }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6
      }
    }, "Stats by Category"), Object.entries(profStats.fmt).map(([f2, s2]) => React.createElement("div", {
      key: f2,
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        padding: "5px 0",
        borderBottom: `1px solid ${ C.border }`
      }
    }, React.createElement("span", {
      style: {
        fontSize: 11,
        color: C.text,
        fontWeight: 600
      }
    }, f2), React.createElement("span", {
      style: {
        fontSize: 11,
        color: C.textMuted
      }
    }, s2.w, "W-", s2.l, "L", React.createElement("span", {
      style: {
        color: C.lime,
        fontWeight: 700,
        marginLeft: 8
      }
    }, s2.w + s2.l ? Math.round(s2.w / (s2.w + s2.l) * 100) : 0, "%"))))), React.createElement("div", { style: { marginTop: 12 } }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6
      }
    }, "Games Played"), React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.text,
        marginBottom: 6
      }
    }, React.createElement("b", { style: { color: C.lime } }, D.wins, "W"), " \u2013 ", React.createElement("b", { style: { color: C.red } }, D.losses, "L"), " \xB7 ", ae, "% win rate", profStats.bestPartner && React.createElement("span", { style: { color: C.textMuted } }, " \xB7 Best partner: ", React.createElement("b", { style: { color: C.teal } }, profStats.bestPartner.name), " (", profStats.bestPartner.wins, "W-", profStats.bestPartner.losses, "L)")), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(4,1fr)",
        gap: 6
      }
    }, [
      [
        "Week",
        profStats.gWeek
      ],
      [
        "Month",
        profStats.gMonth
      ],
      [
        String(profStats.yr),
        profStats.gYear
      ],
      [
        "Total",
        profStats.gTotal
      ]
    ].map(([lb, vl]) => React.createElement("div", {
      key: lb,
      style: {
        background: C.cardAlt,
        borderRadius: 8,
        padding: "8px 4px",
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.lime
      }
    }, vl), React.createElement("div", {
      style: {
        fontSize: 8,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, lb))))), profStats.tByYear.length > 0 && React.createElement("div", { style: { marginTop: 12 } }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6
      }
    }, "Tournaments by Year"), profStats.tByYear.map(([y2, ct]) => React.createElement("div", {
      key: y2,
      style: {
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        fontSize: 11
      }
    }, React.createElement("span", { style: { color: C.text } }, y2), React.createElement("span", {
      style: {
        color: C.teal,
        fontWeight: 700
      }
    }, ct, " tournament", ct > 1 ? "s" : "")))), Object.keys(profStats.tierRec).length > 0 && React.createElement("div", { style: { marginTop: 12 } }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6
      }
    }, "Record by Tier"), Object.entries(profStats.tierRec).map(([tn, s3]) => React.createElement("div", {
      key: tn,
      style: {
        display: "flex",
        justifyContent: "space-between",
        padding: "4px 0",
        fontSize: 11
      }
    }, React.createElement("span", { style: { color: C.text } }, "vs ", tn), React.createElement("span", { style: { color: C.textMuted } }, s3.w, "W-", s3.l, "L")))), profStats.yrGames > 0 && React.createElement("div", {
      style: {
        marginTop: 12,
        borderRadius: 12,
        padding: 12,
        background: `linear-gradient(135deg,${ C.lime }18,${ C.teal }10)`,
        border: `1px solid ${ C.lime }44`
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 800,
        color: C.lime,
        marginBottom: 6
      }
    }, "\uD83C\uDF89 ", profStats.yr, " Year in Review"), React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.text,
        lineHeight: 1.7
      }
    }, profStats.yrGames, " games \xB7 ", profStats.yrWins, " wins (", profStats.yrPct, "%) \xB7 ", profStats.yrDelta >= 0 ? "+" : "", profStats.yrDelta, " GSR \xB7 ", profStats.yrMeds, " medal", profStats.yrMeds === 1 ? "" : "s"))), D.duprRating !== void 0 && D.duprRating !== null || d && d.id === D.id ? React.createElement("div", {
      style: {
        marginBottom: 8,
        padding: "6px 12px",
        background: C.cardAlt,
        borderRadius: 10,
        display: "flex",
        alignItems: "center",
        gap: 10,
        flexWrap: "wrap"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "DUPR Rating"), D.duprRating !== void 0 && D.duprRating !== null ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 800,
        color: C.purple
      }
    }, D.duprRating), D.duprReliability != null && React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: D.duprReliability >= 60 ? C.lime : C.orange
      }
    }, D.duprReliability, "% reliability"), D.duprLastUpdated && React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim
      }
    }, "Updated: ", new Date(D.duprLastUpdated).toLocaleDateString("en-IN", {
      day: "numeric",
      month: "short",
      year: "numeric"
    }), Date.now() - new Date(D.duprLastUpdated).getTime() > 2160 * 60 * 60 * 1000 && React.createElement("span", {
      style: {
        color: C.orange,
        marginLeft: 6
      }
    }, "\u26A0️ Update recommended"))) : React.createElement("div", {
      style: {
        fontSize: 12,
        color: C.textDim
      }
    }, "Not set"), d && d.id === D.id && React.createElement(Btn, {
      small: !0,
      color: C.purple,
      onClick: () => z(!0)
    }, D.duprRating ? "Edit" : "Add Rating")) : null, React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        flexWrap: "wrap"
      }
    }, Object.entries(D.ratings || {}).map(([i, o]) => React.createElement("div", {
      key: i,
      style: {
        background: C.cardAlt,
        borderRadius: 8,
        padding: "5px 10px",
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 800,
        color: getTier(o).color
      }
    }, o, " GSR"), React.createElement("div", {
      style: {
        fontSize: 7,
        color: C.textDim
      }
    }, fmtLabel(i)))))), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr",
        gap: 8,
        marginBottom: 14
      }
    }, React.createElement(Stat, {
      label: "Win Rate",
      value: `${ ae }%`,
      icon: "target",
      color: C.lime,
      onClick: () => l(r === "format" ? null : "format")
    }), React.createElement(Stat, {
      label: "Record",
      value: `${ D.wins }-${ D.losses }`,
      icon: "stats",
      color: C.teal,
      onClick: () => l(r === "tier" ? null : "tier")
    }), React.createElement(Stat, {
      label: "Partners",
      value: Object.keys(D.partnerStats || {}).length || 0,
      icon: "users",
      color: C.orange,
      onClick: () => l(r === "partner" ? null : "partner")
    })), r && React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 14
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase"
      }
    }, r === "tier" ? "By Tier" : r === "partner" ? "By Partner" : "By Format"), React.createElement("button", {
      onClick: () => l(null),
      style: {
        background: "none",
        border: "none",
        color: C.textDim,
        cursor: "pointer"
      }
    }, React.createElement(Ic, {
      t: "x",
      s: 14
    }))), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4
      }
    }, r === "partner" ? se().map((i, o) => React.createElement("div", {
      key: o,
      style: {
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 10px",
        background: C.cardAlt,
        borderRadius: 8
      }
    }, React.createElement("span", {
      style: {
        fontSize: 10,
        color: C.text
      }
    }, i.partnerName), React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.lime
      }
    }, i.wins, "W - ", i.losses, "L"))) : Object.entries(r === "tier" ? ee() : L()).map(([i, o]) => React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        justifyContent: "space-between",
        padding: "6px 10px",
        background: C.cardAlt,
        borderRadius: 8
      }
    }, React.createElement("span", {
      style: {
        fontSize: 10,
        color: C.text
      }
    }, i), React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.lime
      }
    }, o.wins, "W - ", o.losses, "L"))))), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 14
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8
      }
    }, React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase"
      }
    }, "Skill Ratings"), React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim
      }
    }, D.skillRatingsCount, " peer reviews")), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6
      }
    }, d && d.id === D.id && React.createElement(Btn, {
      small: !0,
      onClick: le,
      color: "#25D366"
    }, React.createElement(Ic, {
      t: "share",
      s: 11
    }), " Ask Review"), d && Y && React.createElement(Btn, {
      small: !0,
      primary: !0,
      onClick: () => R(!0)
    }, React.createElement(Ic, {
      t: "star",
      s: 11
    }), " Rate"), d && !Y && d.id !== D.id && React.createElement("span", {
      style: {
        fontSize: 9,
        color: C.textDim
      }
    }, "Play vs to rate"))), P ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "center",
        marginBottom: 8
      }
    }, React.createElement(RadarChart, {
      skills: D.skills,
      size: 200
    })), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 4
      }
    }, SKILLS.map(i => React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        justifyContent: "space-between",
        padding: "3px 8px",
        background: C.cardAlt,
        borderRadius: 6
      }
    }, React.createElement("span", {
      style: {
        fontSize: 9,
        color: C.textMuted
      }
    }, i), React.createElement("span", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: D.skills[i] >= 4 ? C.lime : C.text
      }
    }, D.skills[i]?.toFixed(1)))))) : React.createElement("div", {
      style: {
        textAlign: "center",
        padding: "16px 0",
        color: C.textDim,
        fontSize: 11
      }
    }, "No skill ratings yet")), d && d.id !== D.id ? React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 14
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase"
      }
    }, "Endorsements"), React.createElement(Btn, {
      small: !0,
      primary: !0,
      onClick: () => v(!0)
    }, React.createElement(Ic, {
      t: "plus",
      s: 11
    }), " Endorse")), w.length > 0 ? React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        flexWrap: "wrap"
      }
    }, w.map(([i, o]) => React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        background: C.cardAlt,
        borderRadius: 20,
        border: `1px solid ${ C.border }`
      }
    }, React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text
      }
    }, i), React.createElement("span", {
      style: {
        fontSize: 9,
        fontWeight: 800,
        color: C.lime,
        background: `${ C.lime }22`,
        borderRadius: 10,
        padding: "1px 6px"
      }
    }, o)))) : React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, "No endorsements yet \u2013 be the first!")) : w.length > 0 && React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 14
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginBottom: 8
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase"
      }
    }, "Endorsements")), React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        flexWrap: "wrap"
      }
    }, w.map(([i, o]) => React.createElement("div", {
      key: i,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "5px 10px",
        background: C.cardAlt,
        borderRadius: 20,
        border: `1px solid ${ C.border }`
      }
    }, React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text
      }
    }, i), React.createElement("span", {
      style: {
        fontSize: 9,
        fontWeight: 800,
        color: C.lime,
        background: `${ C.lime }22`,
        borderRadius: 10,
        padding: "1px 6px"
      }
    }, o))))), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        marginBottom: 8
      }
    }, "Match History (", (D.matchHistory || []).length, ")"), (D.matchHistory || []).length === 0 ? React.createElement("p", {
      style: {
        color: C.textDim,
        fontSize: 11,
        margin: 0
      }
    }, "No matches yet") : React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        maxHeight: 300,
        overflow: "auto"
      }
    }, [...D.matchHistory].reverse().map((i, o) => React.createElement("div", {
      key: o,
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        padding: "7px 10px",
        background: C.cardAlt,
        borderRadius: 8,
        borderLeft: `3px solid ${ i.won ? C.lime : C.red }`
      }
    }, React.createElement(Badge, {
      color: i.won ? C.lime : C.red,
      small: !0
    }, i.won ? "W" : "L"), React.createElement("div", { style: { flex: 1 } }, React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.text
      }
    }, "vs ", i.opponent), React.createElement("div", {
      style: {
        fontSize: 8,
        color: C.textDim
      }
    }, i.tournament, " \xB7 ", i.format || "", " ", i.stage ? `\xB7 ${ i.stage }` : "")), React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: C.text
      }
    }, i.scoreFor, "-", i.scoreAgainst), React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: i.ratingChange > 0 ? C.lime : C.red
      }
    }, i.ratingChange > 0 ? "+" : "", i.ratingChange))))), n && Y && React.createElement(Modal, { onClose: () => R(!1) }, React.createElement("div", { style: { padding: 22 } }, React.createElement("h3", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 14px"
      }
    }, "Rate ", D.firstName), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8
      }
    }, SKILLS.map(i => React.createElement("div", { key: i }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 3
      }
    }, React.createElement("span", {
      style: {
        fontSize: 11,
        color: C.text
      }
    }, i), React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 800,
        color: C.lime
      }
    }, K[i])), React.createElement("div", {
      style: {
        display: "flex",
        gap: 3
      }
    }, [
      1,
      2,
      3,
      4,
      5
    ].map(o => React.createElement("button", {
      key: o,
      onClick: () => J(t => ({
        ...t,
        [i]: o
      })),
      style: {
        flex: 1,
        height: 26,
        borderRadius: 6,
        border: "none",
        background: o <= K[i] ? C.lime : C.cardAlt,
        color: o <= K[i] ? C.black : C.textDim,
        fontWeight: 700,
        fontSize: 10,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, o)))))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 16
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => R(!1)
    }, "Cancel"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: ge
    }, "Submit")))), S && Y && React.createElement(Modal, { onClose: () => v(!1) }, React.createElement("div", { style: { padding: 22 } }, React.createElement("h3", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 12px"
      }
    }, "Endorse ", D.firstName), React.createElement(Input, {
      value: g,
      onChange: i => f(i),
      placeholder: "Search or type a new tag...",
      icon: "search",
      style: { marginBottom: 8 }
    }), React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        flexWrap: "wrap",
        maxHeight: 200,
        overflow: "auto"
      }
    }, k.map(i => React.createElement("button", {
      key: i,
      onClick: () => ce(i),
      style: {
        padding: "7px 14px",
        borderRadius: 20,
        border: `1px solid ${ D.tags[i] ? C.lime + "44" : C.border }`,
        background: D.tags[i] ? `${ C.lime }12` : C.card,
        color: C.text,
        fontWeight: 600,
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, i, " ", D.tags[i] ? ` +${ D.tags[i] }` : "")), k.length === 0 && g.trim() !== "" && React.createElement("button", {
      onClick: () => ce(g.trim()),
      style: {
        padding: "7px 14px",
        borderRadius: 20,
        border: `1px solid ${ C.teal }`,
        background: `${ C.teal }18`,
        color: C.teal,
        fontWeight: 600,
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, "+ Add \"", g.trim(), "\"")), React.createElement("div", { style: { marginTop: 12 } }, React.createElement(Btn, {
      full: !0,
      onClick: () => v(!1)
    }, "Done")))), M && React.createElement(Modal, { onClose: () => z(!1) }, React.createElement("div", { style: { padding: 22 } }, React.createElement("h3", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 14px"
      }
    }, "Update DUPR Rating"), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "New DUPR Rating"), React.createElement(Input, {
      type: "number",
      step: "0.01",
      value: G,
      onChange: i => O(i),
      placeholder: "e.g. 4.25",
      style: { marginTop: 5 }
    })), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => z(!1)
    }, "Cancel"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.purple,
      onClick: () => {
        const i = parseFloat(G);
        isNaN(i) || (p(o => o.map(t => t.id === D.id ? {
          ...t,
          duprRating: i,
          duprLastUpdated: new Date().toISOString()
        } : t)), z(!1), O(""));
      }
    }, "Save"))))));
  }, LeaderboardTab = ({
    players: m,
    currentUser: c,
    selectedPlayer: e,
    setSelectedPlayer: d,
    setPlayers: p
  }) => {
    const [r, l] = useState(""), [n, R] = useState("All"), [S, v] = useState("All"), M = (g, f) => f === "Men's Singles" ? rtgIn(g, "ms") : f === "Women's Singles" ? rtgIn(g, "ws") : f === "Men's Doubles" ? rtgIn(g, "md") : f === "Women's Doubles" ? rtgIn(g, "wd") : f === "Mixed Doubles" ? rtgIn(g, "mx") : g.bestRating, z = useMemo(() => {
        let g = [...m];
        return S !== "All" ? (g = g.filter(f => M(f, S) > 0), g.sort((f, u) => M(u, S) - M(f, S))) : g.sort((f, u) => u.bestRating - f.bestRating), n !== "All" && (g = g.filter(f => getTier(S !== "All" ? M(f, S) : f.bestRating).name.startsWith(n))), r && (g = g.filter(f => f.fullName.toLowerCase().includes(r.toLowerCase()) || f.id.toLowerCase().includes(r.toLowerCase()))), g;
      }, [
        m,
        r,
        n,
        S
      ]);
    return e ? React.createElement(PlayerProfile, {
      player: m.find(g => g.id === e),
      onBack: () => d(null),
      players: m,
      currentUser: c,
      setPlayers: p
    }) : React.createElement("div", null, React.createElement("h2", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 14px"
      }
    }, "Leaderboard"), React.createElement(Input, {
      value: r,
      onChange: l,
      placeholder: "Search by name or ID...",
      icon: "search",
      style: { marginBottom: 10 }
    }), React.createElement("div", {
      style: {
        display: "flex",
        gap: 4,
        marginBottom: 8,
        overflowX: "auto"
      }
    }, [
      "All",
      "Men's Singles",
      "Women's Singles",
      "Men's Doubles",
      "Women's Doubles",
      "Mixed Doubles"
    ].map(g => React.createElement("button", {
      key: g,
      onClick: () => v(g),
      style: {
        padding: "5px 10px",
        borderRadius: 20,
        border: `1px solid ${ S === g ? C.lime : C.border }`,
        background: S === g ? `${ C.lime }18` : C.card,
        color: S === g ? C.lime : C.textDim,
        fontWeight: 600,
        fontSize: 9,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: "inherit"
      }
    }, g))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 4,
        marginBottom: 12
      }
    }, [
      "All",
      "Beginner",
      "Intermediate",
      "Advanced",
      "Pro"
    ].map(g => React.createElement("button", {
      key: g,
      onClick: () => R(g),
      style: {
        padding: "4px 10px",
        borderRadius: 8,
        border: "none",
        background: n === g ? C.lime : C.card,
        color: n === g ? C.black : C.textDim,
        fontWeight: 600,
        fontSize: 9,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, g))), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${ C.border }`,
        overflow: "hidden"
      }
    }, z.slice(0, 50).map((g, f) => {
      const u = S !== "All" ? M(g, S) : g.bestRating, k = getTier(u);
      return React.createElement("div", {
        key: g.id,
        onClick: () => d(g.id),
        style: {
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "10px 14px",
          borderBottom: `1px solid ${ C.border }`,
          cursor: "pointer"
        }
      }, React.createElement("div", {
        style: {
          width: 24,
          height: 24,
          borderRadius: 6,
          background: f < 3 ? `${ [
            C.gold,
            C.silver,
            C.bronze
          ][f] }22` : C.cardAlt,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 10,
          fontWeight: 800,
          color: f < 3 ? [
            C.gold,
            C.silver,
            C.bronze
          ][f] : C.textDim
        }
      }, f + 1), React.createElement(Avi, {
        name: g.firstName,
        color: k.color,
        size: 30,
        gender: g.gender,
        imageUrl: g.avatarUrl
      }), React.createElement("div", { style: { flex: 1 } }, React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 4
        }
      }, React.createElement("span", {
        style: {
          fontSize: 12,
          fontWeight: 600,
          color: C.text
        }
      }, g.fullName), (g.medals || []).slice(0, 2).map((G, O) => React.createElement("span", { key: O }, G.type))), React.createElement("div", {
        style: {
          fontSize: 9,
          color: C.textDim
        }
      }, g.wins, "W-", g.losses, "L")), React.createElement("div", {
        style: {
          fontSize: 14,
          fontWeight: 800,
          color: k.color
        }
      }, u, " GSR"));
    })));
  }, HomeTab = ({
    players: m,
    tournaments: c,
    currentUser: e,
    top5: d,
    setSelectedPlayer: p,
    setTab: r,
    userRole: l,
    setUserRole: n,
    setActiveTourney: R
  }) => {
    const S = c.filter(v => v.status !== "completed").slice(0, 3);
    return React.createElement("div", null, React.createElement("div", {
      style: {
        background: `linear-gradient(135deg,${ C.lime }08,${ C.teal }05)`,
        borderRadius: 18,
        padding: "22px 20px",
        marginBottom: 18,
        border: `1px solid ${ C.lime }18`,
        position: "relative",
        overflow: "hidden"
      }
    }, e ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: C.lime,
        textTransform: "uppercase",
        letterSpacing: 2,
        marginBottom: 3
      }
    }, "Welcome back"), React.createElement("h1", {
      style: {
        fontSize: 22,
        fontWeight: 900,
        color: C.text,
        margin: "0 0 3px"
      }
    }, e.fullName), React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.lime,
        fontFamily: "monospace"
      }
    }, e.id), React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        marginTop: 8
      }
    }, React.createElement(Badge, { color: getTier(e.bestRating).color }, getTier(e.bestRating).emoji, " ", e.bestRating), React.createElement(Badge, { color: C.textMuted }, e.wins, "W-", e.losses, "L"), (e.medals || []).length > 0 && React.createElement(Badge, { color: C.gold }, "\uD83C\uDFC5", (e.medals || []).length))) : React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: C.lime,
        textTransform: "uppercase",
        letterSpacing: 2,
        marginBottom: 3
      }
    }, "Multi-Sport Platform"), React.createElement("h1", {
      style: {
        fontSize: 24,
        fontWeight: 900,
        color: C.text,
        margin: "0 0 4px"
      }
    }, "RISE Sports"), React.createElement("p", {
      style: {
        fontSize: 11,
        color: C.textMuted,
        margin: "0 0 12px"
      }
    }, "Register, compete, climb the leaderboard."), React.createElement(Btn, {
      primary: !0,
      onClick: () => r("register")
    }, React.createElement(Ic, {
      t: "plus",
      s: 14
    }), " Register \u2014 Free"))), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gap: 8,
        marginBottom: 18
      }
    }, React.createElement(Stat, {
      label: "Players",
      value: m.length,
      icon: "users",
      color: C.lime
    }), React.createElement(Stat, {
      label: "Tourneys",
      value: c.length,
      icon: "trophy",
      color: C.gold
    }), React.createElement(Stat, {
      label: "Matches",
      value: Math.floor(m.reduce((v, M) => v + M.wins + M.losses, 0) / 2),
      icon: "zap",
      color: C.teal
    }), React.createElement(Stat, {
      label: "Top Rtg",
      value: `${ d[0]?.bestRating || 750 } GSR`,
      icon: "target",
      color: C.orange
    })), S.length > 0 && React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1.2,
        marginBottom: 8
      }
    }, "Active Tournaments"), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6,
        marginBottom: 18
      }
    }, S.map(v => React.createElement("div", {
      key: v.id,
      onClick: () => {
        R(v), r("tourney");
      },
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: 14,
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${ C.lime }33`,
        cursor: "pointer",
        borderLeft: `3px solid ${ C.lime }`
      }
    }, React.createElement("div", {
      style: {
        width: 40,
        height: 40,
        borderRadius: 10,
        background: `${ C.lime }18`,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: C.lime
      }
    }, React.createElement(Ic, {
      t: "trophy",
      s: 20
    })), React.createElement("div", { style: { flex: 1 } }, React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: C.text
      }
    }, v.name), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, v.categories?.length || 0, " categories \xB7 ", v.groups?.length || 0, " groups")))))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginBottom: 18
      }
    }, l >= ROLES.ORGANIZER.level && React.createElement(Btn, {
      primary: !0,
      full: !0,
      onClick: () => r("create")
    }, React.createElement(Ic, {
      t: "plus",
      s: 14
    }), " Create Tournament"), React.createElement(Btn, {
      full: !0,
      onClick: () => r("tournament")
    }, React.createElement(Ic, {
      t: "trophy",
      s: 14
    }), " All Events")), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginBottom: 18
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => r("leaderboard")
    }, React.createElement(Ic, {
      t: "award",
      s: 14
    }), " Leaderboard"), l >= ROLES.ADMIN.level && React.createElement(Btn, {
      full: !0,
      onClick: () => r("admin")
    }, React.createElement(Ic, {
      t: "shield",
      s: 14
    }), " Admin")), React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 16,
        background: C.card,
        borderRadius: 12,
        padding: 6,
        border: `1px solid ${ C.border }`
      }
    }, React.createElement("span", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        padding: "0 6px"
      }
    }, "I am a"), [
      ROLES.PLAYER,
      ROLES.ORGANIZER,
      ROLES.ADMIN
    ].map(ro => React.createElement("button", {
      key: ro.label,
      onClick: () => n(ro.level),
      style: {
        flex: 1,
        padding: "8px 4px",
        borderRadius: 8,
        border: "none",
        background: l === ro.level ? `${ ro.color }25` : "transparent",
        color: l === ro.level ? ro.color : C.textDim,
        fontWeight: 700,
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "inherit",
        transition: "all .15s"
      }
    }, ro.label))), React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1.2,
        marginBottom: 8
      }
    }, "Top Rated"), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 5
      }
    }, d.map((v, M) => {
      const z = getTier(v.bestRating);
      return React.createElement("div", {
        key: v.id,
        onClick: () => {
          p(v.id), r("leaderboard");
        },
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 12px",
          background: C.card,
          borderRadius: 12,
          border: `1px solid ${ C.border }`,
          cursor: "pointer"
        }
      }, React.createElement("div", {
        style: {
          width: 22,
          height: 22,
          borderRadius: 6,
          background: M < 3 ? `${ [
            C.gold,
            C.silver,
            C.bronze
          ][M] }22` : C.cardAlt,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 9,
          fontWeight: 800,
          color: M < 3 ? [
            C.gold,
            C.silver,
            C.bronze
          ][M] : C.textDim
        }
      }, M + 1), React.createElement(Avi, {
        name: v.firstName,
        color: z.color,
        size: 28,
        gender: v.gender,
        imageUrl: v.avatarUrl
      }), React.createElement("div", { style: { flex: 1 } }, React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 3
        }
      }, React.createElement("span", {
        style: {
          fontSize: 12,
          fontWeight: 600,
          color: C.text
        }
      }, v.fullName), (v.medals || []).slice(0, 2).map((g, f) => React.createElement("span", {
        key: f,
        style: { fontSize: 10 }
      }, g.type)))), React.createElement("div", {
        style: {
          fontSize: 14,
          fontWeight: 800,
          color: z.color
        }
      }, v.bestRating));
    })));
  }, AdminTab = ({
    players: pl0,
    setPlayers: m,
    categories: cats,
    setTournaments: c,
    setCategories: e,
    setUserRole: d,
    setTab: p
  }) => {
    const [aq, setAq] = useState(""), [nn, setNn] = useState(""), [ng, setNg] = useState("M");
    const shown = (pl0 || []).filter(x => !aq || x.fullName.toLowerCase().includes(aq.toLowerCase())).slice(0, 12);
    return React.createElement("div", null, React.createElement("h2", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: C.text,
        marginBottom: 12
      }
    }, "Admin Panel"), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 8
      }
    }, "Players (", (pl0 || []).length, ")"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 8
      }
    }, React.createElement(Input, {
      value: nn,
      onChange: setNn,
      placeholder: "Add player \u2014 full name",
      style: { flex: 1 }
    }), React.createElement(Btn, {
      small: !0,
      onClick: () => setNg(ng === "M" ? "F" : "M")
    }, ng), React.createElement(Btn, {
      small: !0,
      primary: !0,
      color: C.lime,
      onClick: () => {
        const t2 = nn.trim();
        if (!t2)
          return;
        const [fn2, ...rest] = t2.split(" ");
        m(A => [
          ...A,
          {
            id: uid(),
            firstName: fn2,
            lastName: rest.join(" "),
            fullName: t2,
            gender: ng,
            dob: null,
            phone: "",
            hand: "Right",
            city: "Mumbai",
            playingSince: new Date().getFullYear(),
            ratings: {
              [ratingKey(DEFAULT_SPORT, "ms")]: 750,
              [ratingKey(DEFAULT_SPORT, "md")]: 750,
              [ratingKey(DEFAULT_SPORT, "mx")]: 750
            },
            bestRating: 750,
            wins: 0,
            losses: 0,
            skills: SKILLS.reduce((o2, k2) => ({
              ...o2,
              [k2]: 3
            }), {}),
            skillRatingsCount: 0,
            tags: {},
            matchHistory: [],
            registered: !0,
            savedPartners: [],
            avatarUrl: "",
            medals: [],
            partnerStats: {},
            duprId: "",
            duprRating: null,
            duprReliability: null,
            duprLastUpdated: null
          }
        ]), setNn("");
      }
    }, "Add")), React.createElement(Input, {
      value: aq,
      onChange: setAq,
      placeholder: "Search players",
      icon: "search"
    }), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        marginTop: 8
      }
    }, shown.map(x => React.createElement("div", {
      key: x.id,
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        background: C.cardAlt,
        borderRadius: 8,
        padding: "6px 10px"
      }
    }, React.createElement("span", {
      style: {
        fontSize: 11,
        color: C.text
      }
    }, x.fullName, React.createElement("span", {
      style: {
        color: C.textDim,
        marginLeft: 6
      }
    }, x.bestRating, " GSR")), React.createElement(Btn, {
      small: !0,
      color: C.red,
      onClick: () => window.confirm(`Remove ${ x.fullName }?`) && m(A => A.filter(y2 => y2.id !== x.id))
    }, "Remove"))))), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 8
      }
    }, "Categories (", (cats || []).length, ")"), (cats || []).map(ct => React.createElement("div", {
      key: ct.id,
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "5px 0",
        borderBottom: `1px solid ${ C.border }`
      }
    }, React.createElement("span", {
      style: {
        fontSize: 11,
        color: C.text
      }
    }, ct.name), React.createElement(Btn, {
      small: !0,
      color: C.red,
      onClick: () => window.confirm(`Delete category ${ ct.name }?`) && e(A => A.filter(y2 => y2.id !== ct.id))
    }, "\u00D7"))), React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        marginTop: 8
      }
    }, "New categories can be added here or while creating a tournament (\u201C+ New Category\u201D).")), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 8
      }
    }, React.createElement(Btn, {
      full: !0,
      color: C.red,
      onClick: () => {
        window.confirm("Reset ALL app data? This cannot be undone.") && (localStorage.clear(), window.location.reload());
      }
    }, "Reset All Data"), React.createElement(Btn, {
      full: !0,
      color: C.blue,
      onClick: () => {
        d(ROLES.PLAYER.level), p("home");
      }
    }, "Switch to Player Mode")));
  }, PublicTournamentView = ({tournamentId: m}) => {
    const [c, e] = useState(null), [d, p] = useState(!0);
    if (useEffect(() => {
        const n = localStorage.getItem(lsKey("t"));
        if (n) {
          const S = JSON.parse(n).find(v => v.id === m);
          e(S || null);
        }
        p(!1);
      }, [m]), d)
      return React.createElement("div", {
        style: {
          textAlign: "center",
          padding: 50,
          color: C.textDim
        }
      }, "Loading...");
    if (!c)
      return React.createElement("div", {
        style: {
          textAlign: "center",
          padding: 50,
          color: C.textDim
        }
      }, "Tournament not found.");
    const r = c.categories || [], l = {};
    return c.groups.forEach(n => {
      const R = n.catId || n.catName;
      l[R] || (l[R] = []), l[R].push(n);
    }), React.createElement("div", {
      style: {
        maxWidth: 860,
        margin: "0 auto",
        padding: 20,
        fontFamily: "'Sora',sans-serif",
        color: C.text
      }
    }, React.createElement("div", {
      style: {
        textAlign: "center",
        marginBottom: 24
      }
    }, React.createElement("div", {
      style: {
        fontSize: 36,
        marginBottom: 8
      }
    }, "\uD83C\uDFC6"), React.createElement("h1", {
      style: {
        fontSize: 24,
        fontWeight: 900,
        color: C.text,
        margin: 0
      }
    }, c.name), c.venue && React.createElement("div", {
      style: {
        fontSize: 14,
        color: C.textMuted,
        marginTop: 8
      }
    }, "\uD83D\uDCCD ", c.venue), c.tournamentDate && React.createElement("div", {
      style: {
        fontSize: 14,
        color: C.textMuted
      }
    }, "\uD83D\uDDD3️ ", new Date(c.tournamentDate).toLocaleDateString("en-IN", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric"
    }), " \xB7 \uD83D\uDD50 ", c.startTime), React.createElement("div", {
      style: {
        marginTop: 12,
        display: "flex",
        gap: 8,
        justifyContent: "center",
        flexWrap: "wrap"
      }
    }, React.createElement(Badge, { color: C.gold }, fp(c.entryFee), " entry"), React.createElement(Badge, { color: C.teal }, c.pointsToWin, " pts"), React.createElement(Badge, { color: C.orange }, c.numCourts, " courts"), React.createElement(Badge, { color: c.status === "completed" ? C.gold : C.lime }, c.status === "completed" ? "Completed" : "Live"))), r.map((n, R) => {
      const S = l[n.id] || l[n.name] || [], v = c.knockoutBrackets?.[R];
      return React.createElement("div", {
        key: R,
        style: { marginBottom: 32 }
      }, React.createElement("h2", {
        style: {
          fontSize: 18,
          fontWeight: 800,
          color: C.lime,
          marginBottom: 16
        }
      }, n.name), S.length > 0 && !v && S.map((M, z) => {
        const g = {};
        M.teams.forEach(u => {
          g[u.id] = {
            ...u,
            gW: 0,
            gL: 0,
            gPF: 0,
            gPA: 0,
            gP: 0,
            gD: 0
          };
        }), M.matches.filter(u => u.played).forEach(u => {
          g[u.teamA.id].gP++, g[u.teamB.id].gP++, g[u.teamA.id].gPF += u.scoreA, g[u.teamA.id].gPA += u.scoreB, g[u.teamB.id].gPF += u.scoreB, g[u.teamB.id].gPA += u.scoreA, u.winner === u.teamA.id ? (g[u.teamA.id].gW++, g[u.teamB.id].gL++) : (g[u.teamB.id].gW++, g[u.teamA.id].gL++);
        });
        const f = Object.values(g).map(u => ({
          ...u,
          gD: u.gPF - u.gPA
        })).sort((u, k) => k.gW - u.gW || k.gD - u.gD || k.gPF - u.gPF);
        return React.createElement("div", {
          key: z,
          style: {
            background: C.card,
            borderRadius: 14,
            padding: 16,
            marginBottom: 16,
            border: `1px solid ${ C.border }`
          }
        }, React.createElement("h3", {
          style: {
            fontSize: 14,
            fontWeight: 700,
            color: C.text,
            marginBottom: 12
          }
        }, "Group ", M.label, " ", M.court ? `(Court ${ M.court })` : ""), React.createElement("div", {
          style: {
            overflowX: "auto",
            marginBottom: 16
          }
        }, React.createElement("table", {
          style: {
            width: "100%",
            borderCollapse: "collapse",
            fontSize: 11
          }
        }, React.createElement("thead", null, React.createElement("tr", {
          style: {
            color: C.textDim,
            borderBottom: `1px solid ${ C.border }`
          }
        }, React.createElement("th", {
          style: {
            padding: 6,
            textAlign: "left"
          }
        }, "Team"), React.createElement("th", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, "P"), React.createElement("th", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, "W"), React.createElement("th", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, "L"), React.createElement("th", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, "PF"), React.createElement("th", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, "PA"), React.createElement("th", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, "\xB1"))), React.createElement("tbody", null, f.map((u, k) => React.createElement("tr", {
          key: u.id,
          style: { borderBottom: `1px solid ${ C.border }22` }
        }, React.createElement("td", { style: { padding: 6 } }, u.fullName), React.createElement("td", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, u.gP), React.createElement("td", {
          style: {
            padding: 6,
            textAlign: "center",
            color: C.lime,
            fontWeight: 700
          }
        }, u.gW), React.createElement("td", {
          style: {
            padding: 6,
            textAlign: "center",
            color: C.red
          }
        }, u.gL), React.createElement("td", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, u.gPF), React.createElement("td", {
          style: {
            padding: 6,
            textAlign: "center"
          }
        }, u.gPA), React.createElement("td", {
          style: {
            padding: 6,
            textAlign: "center",
            fontWeight: 700,
            color: u.gD > 0 ? C.lime : u.gD < 0 ? C.red : C.textDim
          }
        }, u.gD > 0 ? "+" : "", u.gD)))))), React.createElement("div", {
          style: {
            display: "flex",
            flexDirection: "column",
            gap: 4
          }
        }, M.matches.map(u => React.createElement("div", {
          key: u.id,
          style: {
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "6px 10px",
            background: C.cardAlt,
            borderRadius: 8,
            borderLeft: `3px solid ${ u.played ? C.lime : C.border }`
          }
        }, React.createElement("div", {
          style: {
            width: 22,
            height: 22,
            borderRadius: 4,
            background: u.played ? `${ C.lime }22` : C.cardAlt,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 8,
            fontWeight: 800,
            color: u.played ? C.lime : C.textDim
          }
        }, "M", u.matchNum), React.createElement("div", {
          style: {
            flex: 1,
            fontSize: 11
          }
        }, React.createElement("div", {
          style: {
            fontWeight: u.winner === u.teamA.id ? 700 : 400,
            color: u.played && u.winner === u.teamA.id ? C.lime : C.text
          }
        }, u.teamA.fullName), React.createElement("div", {
          style: {
            fontWeight: u.winner === u.teamB.id ? 700 : 400,
            color: u.played && u.winner === u.teamB.id ? C.lime : C.text
          }
        }, u.teamB.fullName)), u.played && React.createElement("div", {
          style: {
            textAlign: "right",
            fontSize: 13,
            fontWeight: 800,
            color: C.text
          }
        }, React.createElement("div", null, u.scoreA), React.createElement("div", null, u.scoreB)), React.createElement("div", {
          style: {
            fontSize: 8,
            color: C.textDim
          }
        }, "Court ", u.court)))));
      }), v && React.createElement("div", { style: { overflowX: "auto" } }, React.createElement("div", {
        style: {
          display: "flex",
          gap: 12,
          minWidth: v.length * 200
        }
      }, v.map((M, z) => React.createElement("div", {
        key: z,
        style: {
          flex: 1,
          minWidth: 190
        }
      }, React.createElement("div", {
        style: {
          textAlign: "center",
          padding: 6,
          marginBottom: 8,
          background: C.card,
          borderRadius: 8,
          fontSize: 9,
          fontWeight: 700,
          color: C.orange
        }
      }, z === v.length - 1 ? "Final" : z === v.length - 2 ? "Semi\u2011Final" : z === v.length - 3 ? "Quarter\u2011Final" : `Round ${ z + 1 }`), M.map((g, f) => React.createElement("div", {
        key: g.id,
        style: {
          background: C.card,
          borderRadius: 10,
          border: `1px solid ${ g.played ? C.orange + "44" : C.border }`,
          marginBottom: 8
        }
      }, [
        {
          p: g.p1,
          sc: g.s1
        },
        {
          p: g.p2,
          sc: g.s2
        }
      ].map((u, k) => React.createElement("div", {
        key: k,
        style: {
          display: "flex",
          alignItems: "center",
          gap: 5,
          padding: "7px 9px",
          borderBottom: k === 0 ? `1px solid ${ C.border }` : "none"
        }
      }, React.createElement("div", {
        style: {
          flex: 1,
          fontSize: 10,
          color: u.p ? C.text : C.textDim
        }
      }, u.p ? u.p.fullName : "TBD"), u.sc !== null && React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 800
        }
      }, u.sc))))))))), c.champions?.[R] && React.createElement("div", {
        style: {
          background: `linear-gradient(135deg,${ C.gold }22,${ C.orange }11)`,
          borderRadius: 16,
          padding: 22,
          textAlign: "center",
          border: `1px solid ${ C.gold }33`,
          marginTop: 16
        }
      }, React.createElement("div", { style: { fontSize: 32 } }, "\uD83C\uDFC6"), React.createElement("div", {
        style: {
          fontSize: 9,
          fontWeight: 700,
          color: C.gold,
          textTransform: "uppercase",
          marginTop: 4
        }
      }, "Champion"), React.createElement("div", {
        style: {
          fontSize: 20,
          fontWeight: 800,
          color: C.text,
          marginTop: 4
        }
      }, c.champions[R])));
    }), React.createElement("div", {
      style: {
        textAlign: "center",
        marginTop: 32,
        padding: 16,
        color: C.textDim,
        fontSize: 11
      }
    }, "Powered by RISE Sports \xB7 Scores update automatically"));
  }, WEEKDAYS = [
    "Sun",
    "Mon",
    "Tue",
    "Wed",
    "Thu",
    "Fri",
    "Sat"
  ], MONTHS = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec"
  ];
function genSessionDates(m, c, e = 6) {
  const d = [], p = new Date();
  p.setHours(0, 0, 0, 0);
  let r = 0;
  for (; d.length < e && r < 200;)
    (m === "daily" || (c || []).includes(p.getDay())) && d.push(p.toISOString().slice(0, 10)), p.setDate(p.getDate() + 1), r++;
  return d;
}
const prettyDate = m => {
    const c = new Date(m + "T00:00:00");
    return `${ WEEKDAYS[c.getDay()] } ${ c.getDate() } ${ MONTHS[c.getMonth()] }`;
  }, midTime = (m, c) => {
    const [e, d] = m.split(":").map(Number), [p, r] = c.split(":").map(Number), l = Math.round((e * 60 + d + p * 60 + r) / 2);
    return `${ String(Math.floor(l / 60) % 24).padStart(2, "0") }:${ String(l % 60).padStart(2, "0") }`;
  };
function checkCommEligibility(m, c) {
  const e = c.restrict || {}, d = [];
  e.gsrMin != null && m.bestRating < e.gsrMin && d.push(`GSR ${ e.gsrMin }+ only`), e.gsrMax != null && m.bestRating > e.gsrMax && d.push(`GSR \u2264 ${ e.gsrMax } only`), e.duprMin != null && (m.duprRating || 0) < e.duprMin && d.push(`DUPR ${ e.duprMin }+ only`), e.duprMax != null && (m.duprRating || 0) > e.duprMax && d.push(`DUPR \u2264 ${ e.duprMax } only`), e.gender && e.gender !== "Any" && m.gender !== e.gender && d.push(`${ e.gender === "M" ? "Men" : "Women" } only`);
  const p = getAge(m.dob);
  return e.ageMin != null && (p == null || p < e.ageMin) && d.push(`Age ${ e.ageMin }+ only`), e.ageMax != null && (p == null || p > e.ageMax) && d.push(`Age \u2264 ${ e.ageMax } only`), d;
}
const hasRestrictions = m => Object.values(m.restrict || {}).some(c => c != null && c !== "Any"), emptySession = () => ({
    interested: [],
    requested: [],
    confirmed: [],
    waitlist: [],
    paid: {},
    linkSent: {},
    openSlots: 0,
    slotData: {},
    schedule: null
  });
function genCourtGames(m) {
  const c = (p, r) => ({
      id: uid(),
      a: p.map(l => l.id),
      b: r.map(l => l.id),
      scoreA: null,
      scoreB: null,
      winner: null,
      played: !1
    }), e = m.length, d = [];
  if (e < 2)
    return d;
  if (e === 2)
    return d.push(c([m[0]], [m[1]])), d;
  if (e === 3)
    return d.push(c([m[0]], [m[1]])), d.push(c([m[0]], [m[2]])), d.push(c([m[1]], [m[2]])), d;
  if (e === 4) {
    const [p, r, l, n] = m;
    return d.push(c([
      p,
      r
    ], [
      l,
      n
    ])), d.push(c([
      p,
      l
    ], [
      r,
      n
    ])), d.push(c([
      p,
      n
    ], [
      r,
      l
    ])), d;
  }
  for (let p = 0; p < e; p++) {
    const r = [
      m[p % e],
      m[(p + 1) % e],
      m[(p + 2) % e],
      m[(p + 3) % e]
    ];
    d.push(c([
      r[0],
      r[1]
    ], [
      r[2],
      r[3]
    ]));
  }
  return d;
}
function buildCourts(m, c, e, d, blockIdx = 0) {
  let p;
  if (d === "gsr" || d === "mexicano")
    p = [...m].sort((S, v) => v.bestRating - S.bestRating);
  else if (d === "americano") {
    p = [...m].sort((S, v) => String(S.id).localeCompare(String(v.id)));
    const rot = p.length ? (blockIdx * 2) % p.length : 0;
    p = p.slice(rot).concat(p.slice(0, rot));
  } else
    p = [...m].sort(() => Math.random() - 0.5);
  const r = Math.max(1, Math.min(c, Math.floor(p.length / e) || 1)), l = Array.from({ length: r }, () => []), n = p.slice(0, r * e);
  if (d === "gsr") {
    let S = 1, v = 0;
    n.forEach(M => {
      l[v].push(M), S === 1 ? v === r - 1 ? S = -1 : v++ : v === 0 ? S = 1 : v--;
    });
  } else if (d === "mexicano")
    n.forEach((S, v) => l[Math.floor(v / e)].push(S));
  else
    n.forEach((S, v) => l[v % r].push(S));
  const R = p.slice(r * e);
  return {
    courts: l.map((S, v) => ({
      court: v + 1,
      players: S.map(M => M.id),
      games: genCourtGames(S)
    })),
    benched: R.map(S => S.id)
  };
}
function initCommunityGames() {
  return [
    {
      id: uid(),
      name: "Bandra Evening Open Play",
      organiserId: "host",
      organiserName: "Vikram Rao",
      venue: "Smashers Arena",
      area: "Bandra West",
      freq: "weekly",
      days: [
        2,
        4
      ],
      startTime: "20:00",
      endTime: "22:00",
      courts: 2,
      perCourt: 4,
      rotation: "rotate",
      price: 300,
      scheduleMode: "gsr",
      restrict: {
        gsrMin: null,
        gsrMax: null,
        duprMin: null,
        duprMax: null,
        ageMin: null,
        ageMax: null,
        gender: null
      },
      sessions: {}
    },
    {
      id: uid(),
      name: "Powai Ladies Morning",
      organiserId: "host",
      organiserName: "Ananya Pillai",
      venue: "Powai Sports Club",
      area: "Powai",
      freq: "weekly",
      days: [6],
      startTime: "07:00",
      endTime: "09:00",
      courts: 1,
      perCourt: 4,
      rotation: "fixed",
      price: 250,
      scheduleMode: "random",
      restrict: {
        gsrMin: null,
        gsrMax: null,
        duprMin: null,
        duprMax: null,
        ageMin: null,
        ageMax: null,
        gender: "F"
      },
      sessions: {}
    }
  ];
}
const VenuesSection = ({
  players: m,
  currentUser: p
}) => {
  const [venues, setVenues] = useState(() => {
    try {
      const v = localStorage.getItem(lsKey("venues"));
      return v ? JSON.parse(v) : [];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(lsKey("venues"), JSON.stringify(venues));
    } catch {
    }
  }, [venues]);
  const [showAdd, setShowAdd] = useState(!1), [form, setForm] = useState({
      name: "",
      area: "",
      courts: "2",
      openT: "06:00",
      closeT: "22:00",
      price: "600"
    }), [sel, setSel] = useState(null), [bDate, setBDate] = useState(new Date().toISOString().split("T")[0]), [bSlot, setBSlot] = useState(""), [bName, setBName] = useState("");
  const F = (k2, v2) => setForm(f2 => ({
    ...f2,
    [k2]: v2
  }));
  const mut = (vid, fn) => setVenues(vs => vs.map(v2 => {
    if (v2.id !== vid)
      return v2;
    const cp = {
      ...v2,
      bookings: [...v2.bookings || []]
    };
    return fn(cp), cp;
  }));
  return React.createElement("div", { style: { marginBottom: 16 } }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between",
      marginBottom: 8
    }
  }, React.createElement("div", {
    style: {
      fontSize: 11,
      fontWeight: 800,
      color: C.text,
      textTransform: "uppercase",
      letterSpacing: 1
    }
  }, "\uD83C\uDFDF Venues \u2014 book a court"), React.createElement(Btn, {
    small: !0,
    color: C.teal,
    onClick: () => setShowAdd(!showAdd)
  }, showAdd ? "Close" : "+ Host Venue")), showAdd && React.createElement("div", {
    style: {
      background: C.card,
      borderRadius: 12,
      padding: 12,
      border: `1px solid ${ C.border }`,
      marginBottom: 8,
      display: "flex",
      flexDirection: "column",
      gap: 8
    }
  }, React.createElement(Input, {
    value: form.name,
    onChange: v2 => F("name", v2),
    placeholder: "Venue name"
  }), React.createElement(Input, {
    value: form.area,
    onChange: v2 => F("area", v2),
    placeholder: "Area / locality"
  }), React.createElement("div", {
    style: {
      display: "grid",
      gridTemplateColumns: "repeat(4,1fr)",
      gap: 6
    }
  }, React.createElement(Input, {
    type: "number",
    value: form.courts,
    onChange: v2 => F("courts", v2),
    placeholder: "Courts"
  }), React.createElement(Input, {
    type: "time",
    value: form.openT,
    onChange: v2 => F("openT", v2)
  }), React.createElement(Input, {
    type: "time",
    value: form.closeT,
    onChange: v2 => F("closeT", v2)
  }), React.createElement(Input, {
    type: "number",
    value: form.price,
    onChange: v2 => F("price", v2),
    placeholder: "\u20B9/hr"
  })), React.createElement(Btn, {
    primary: !0,
    full: !0,
    color: C.lime,
    onClick: () => {
      if (!form.name.trim())
        return;
      setVenues(vs => [
        ...vs,
        {
          id: uid(),
          name: form.name.trim(),
          area: form.area.trim() || "Mumbai",
          courts: parseInt(form.courts) || 1,
          openT: form.openT,
          closeT: form.closeT,
          price: parseInt(form.price) || 0,
          ownerId: p?.id || "you",
          ownerName: p?.fullName || "You",
          bookings: []
        }
      ]), setShowAdd(!1), setForm({
        name: "",
        area: "",
        courts: "2",
        openT: "06:00",
        closeT: "22:00",
        price: "600"
      });
    }
  }, "List Venue"), React.createElement("div", {
    style: {
      fontSize: 9,
      color: C.textDim
    }
  }, "Payments are settled directly between players and the venue \u2014 outside the app.")), venues.length === 0 && !showAdd ? React.createElement("div", {
    style: {
      fontSize: 10,
      color: C.textDim,
      marginBottom: 8
    }
  }, "No venues listed yet \u2014 organisers can host their venue and accept booking requests.") : venues.map(v2 => {
    const isOwner = p && v2.ownerId === p.id || v2.ownerId === "you";
    const slots = genHalfHourSlots(v2.openT, v2.closeT);
    return React.createElement("div", {
      key: v2.id,
      style: {
        background: C.card,
        borderRadius: 12,
        padding: 12,
        border: `1px solid ${ C.border }`,
        marginBottom: 8
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8
      }
    }, React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: C.text
      }
    }, v2.name), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, v2.area, " \xB7 ", v2.courts, " courts \xB7 ", v2.openT, "\u2013", v2.closeT, " \xB7 \u20B9", v2.price, "/hr \xB7 Host: ", v2.ownerName)), React.createElement(Btn, {
      small: !0,
      color: sel === v2.id ? C.lime : C.blue,
      onClick: () => setSel(sel === v2.id ? null : v2.id)
    }, sel === v2.id ? "Close" : "Book")), sel === v2.id && React.createElement("div", { style: { marginTop: 10 } }, React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 6,
        marginBottom: 6
      }
    }, React.createElement(Input, {
      type: "date",
      value: bDate,
      onChange: setBDate
    }), React.createElement(Select, {
      value: bSlot,
      onChange: setBSlot,
      options: [{
          value: "",
          label: "Pick a 30-min slot"
        }].concat(slots.map(s2 => ({
        value: s2,
        label: s2
      })))
    })), !p && React.createElement(Input, {
      value: bName,
      onChange: setBName,
      placeholder: "Your name",
      style: { marginBottom: 6 }
    }), React.createElement(Btn, {
      small: !0,
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: () => {
        if (!bSlot)
          return;
        const nm = p ? p.fullName : bName.trim() || "Guest";
        mut(v2.id, cp => cp.bookings.push({
          id: uid(),
          date: bDate,
          slot: bSlot,
          name: nm,
          status: "requested"
        })), setBSlot("");
      }
    }, "Request Booking"), (v2.bookings || []).length > 0 && React.createElement("div", { style: { marginTop: 8 } }, (v2.bookings || []).map(bk => React.createElement("div", {
      key: bk.id,
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        padding: "5px 0",
        borderBottom: `1px solid ${ C.border }`,
        fontSize: 10
      }
    }, React.createElement("span", { style: { color: C.text } }, bk.date, " \xB7 ", bk.slot, " \xB7 ", bk.name), bk.status === "confirmed" ? React.createElement(Badge, {
      color: C.lime,
      small: !0
    }, "Confirmed") : isOwner ? React.createElement("div", {
      style: {
        display: "flex",
        gap: 4
      }
    }, React.createElement(Btn, {
      small: !0,
      primary: !0,
      color: C.lime,
      onClick: () => mut(v2.id, cp => {
        const b2 = cp.bookings.find(x => x.id === bk.id);
        b2 && (b2.status = "confirmed");
      })
    }, "Approve"), React.createElement(Btn, {
      small: !0,
      color: C.red,
      onClick: () => mut(v2.id, cp => {
        cp.bookings = cp.bookings.filter(x => x.id !== bk.id);
      })
    }, "\u00D7")) : React.createElement(Badge, {
      color: C.orange,
      small: !0
    }, "Requested"))))));
  }));
}, CommunityTab0 = null;
const CommunityTab = ({
  players: m,
  setPlayers: c,
  communityGames: e,
  setCommunityGames: d,
  currentUser: p,
  setTab: r
}) => {
  const [l, n] = useState("list"), [R, S] = useState(null), [v, M] = useState(null), [z, g] = useState(!1), [f, u] = useState("requests"), [k, G] = useState({
      name: "",
      venue: "",
      area: "Mumbai",
      freq: "weekly",
      days: [
        2,
        4
      ],
      startTime: "20:00",
      endTime: "22:00",
      courts: "2",
      perCourt: "4",
      rotation: "rotate",
      price: "300",
      scheduleMode: "gsr",
      accessType: "open"
    }), [O, K] = useState({
      gsrMin: "",
      gsrMax: "",
      duprMin: "",
      duprMax: "",
      ageMin: "",
      ageMax: "",
      gender: "Any"
    }), [J, D] = useState(!1), [I, ae] = useState(null), [w, P] = useState(""), [ne, Y] = useState(""), [invQ, setInvQ] = useState(""), [slotQ, setSlotQ] = useState(""), [slotPick, setSlotPick] = useState(null), [ladQ, setLadQ] = useState(""), [ladSel, setLadSel] = useState(null), ee = o => m.find(t => t.id === o), L = e.find(o => o.id === R), se = (o, t, a, W, q, sp) => {
      const E = o.map(ee).filter(Boolean), ie = t.map(ee).filter(Boolean);
      if (!E.length || !ie.length)
        return;
      const V = x => Math.round(x.reduce((U, re) => U + re.bestRating, 0) / x.length), {
          wG: X,
          lL: j
        } = calcRtgChange(V(E), V(ie), a, W), $ = E.map(x => x.firstName).join(" & "), T = ie.map(x => x.firstName).join(" & "), A = (x, U) => {
          /* Community play is mixed doubles by default. Was picking an
             arbitrary Object.keys(x)[0] when mx was absent, which could write
             a community result into someone's singles rating. */
          const re = ratingKey(sp, "mx"), old = x[re] ?? x.mx ?? 750;
          x[re] = Math.max(100, old + U);
        };
      c(x => x.map(U => {
        if (o.includes(U.id)) {
          const re = { ...U.ratings };
          return A(re, X), {
            ...U,
            ratings: re,
            bestRating: Math.max(...Object.values(re)),
            wins: U.wins + 1,
            matchHistory: [
              ...U.matchHistory,
              {
                date: new Date().toISOString(),
                opponent: T,
                won: !0,
                scoreFor: a,
                scoreAgainst: W,
                ratingChange: X,
                tournament: q,
                format: "Community"
              }
            ]
          };
        }
        if (t.includes(U.id)) {
          const re = { ...U.ratings };
          return A(re, -j), {
            ...U,
            ratings: re,
            bestRating: Math.max(...Object.values(re)),
            losses: U.losses + 1,
            matchHistory: [
              ...U.matchHistory,
              {
                date: new Date().toISOString(),
                opponent: $,
                won: !1,
                scoreFor: W,
                scoreAgainst: a,
                ratingChange: -j,
                tournament: q,
                format: "Community"
              }
            ]
          };
        }
        return U;
      }));
    }, ge = ({
      pid: o,
      right: t,
      sub: a
    }) => {
      const W = ee(o);
      if (!W)
        return null;
      const q = getTier(W.bestRating);
      return React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "7px 10px",
          background: C.cardAlt,
          borderRadius: 8,
          marginBottom: 4
        }
      }, React.createElement(Avi, {
        name: W.firstName,
        size: 26,
        gender: W.gender,
        color: q.color,
        imageUrl: W.avatarUrl
      }), React.createElement("div", {
        style: {
          flex: 1,
          minWidth: 0
        }
      }, React.createElement("div", {
        style: {
          fontSize: 11,
          fontWeight: 600,
          color: C.text,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap"
        }
      }, W.fullName), React.createElement("div", {
        style: {
          fontSize: 8,
          color: C.textDim
        }
      }, a || `GSR ${ W.bestRating }${ W.duprRating ? ` \xB7 DUPR ${ W.duprRating }` : "" }`)), t);
    }, ce = o => {
      const t = o.restrict || {}, a = [];
      return t.gender && a.push(t.gender === "M" ? "Men only" : "Women only"), (t.gsrMin != null || t.gsrMax != null) && a.push(`GSR ${ t.gsrMin ?? "0" }\u2013${ t.gsrMax ?? "\u221E" }`), (t.duprMin != null || t.duprMax != null) && a.push(`DUPR ${ t.duprMin ?? "0" }\u2013${ t.duprMax ?? "\u221E" }`), (t.ageMin != null || t.ageMax != null) && a.push(`Age ${ t.ageMin ?? "0" }\u2013${ t.ageMax ?? "\u221E" }`), a;
    }, le = o => G(t => ({
      ...t,
      days: t.days.includes(o) ? t.days.filter(a => a !== o) : [
        ...t.days,
        o
      ].sort()
    })), i = () => {
      const o = a => a === "" ? null : Number(a), t = {
          id: uid(),
          name: k.name.trim() || "Community Open Play",
          organiserId: p?.id || "you",
          organiserName: p?.fullName || "You",
          venue: k.venue.trim() || "TBD Venue",
          area: k.area.trim() || "Mumbai",
          freq: k.freq,
          days: k.freq === "daily" ? [] : k.days.length ? k.days : [new Date().getDay()],
          startTime: k.startTime,
          endTime: k.endTime,
          courts: Number(k.courts),
          perCourt: Number(k.perCourt),
          rotation: k.rotation,
          sport: k.sport || DEFAULT_SPORT,
          price: Number(k.price) || 0,
          scheduleMode: k.scheduleMode,
          accessType: k.accessType || "open",
          members: [],
          joinRequests: [],
          invites: [],
          restrict: {
            gsrMin: o(O.gsrMin),
            gsrMax: o(O.gsrMax),
            duprMin: o(O.duprMin),
            duprMax: o(O.duprMax),
            ageMin: o(O.ageMin),
            ageMax: o(O.ageMax),
            gender: O.gender === "Any" ? null : O.gender
          },
          sessions: {}
        };
      d(a => [
        ...a,
        t
      ]), S(t.id), M(genSessionDates(t.freq, t.days, 6)[0]), g(!0), u("requests"), n("detail");
    };
  if (l === "create") {
    const o = (Number(k.courts) || 0) * (Number(k.perCourt) || 0);
    return React.createElement("div", null, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        marginBottom: 16
      }
    }, React.createElement("button", {
      onClick: () => n("list"),
      style: {
        background: C.card,
        border: "none",
        borderRadius: 8,
        padding: "8px 12px",
        color: C.textMuted,
        cursor: "pointer",
        display: "flex",
        alignItems: "center"
      }
    }, React.createElement(Ic, {
      t: "back",
      s: 16
    })), React.createElement("h2", {
      style: {
        fontSize: 18,
        fontWeight: 800,
        color: C.text,
        margin: 0
      }
    }, "Host a Game")), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 12
      }
    }, React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Game Name"), React.createElement(Input, {
      value: k.name,
      onChange: t => G(a => ({
        ...a,
        name: t
      })),
      placeholder: "Evening Open Play",
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Venue"), React.createElement(Input, {
      value: k.venue,
      onChange: t => G(a => ({
        ...a,
        venue: t
      })),
      placeholder: "Smashers Arena",
      icon: "map",
      style: { marginTop: 5 }
    }))), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Area"), React.createElement(Input, {
      value: k.area,
      onChange: t => G(a => ({
        ...a,
        area: t
      })),
      placeholder: "Bandra West",
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Frequency"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 6
      }
    }, [
      {
        v: "daily",
        l: "Daily"
      },
      {
        v: "weekly",
        l: "Specific Days"
      }
    ].map(t => React.createElement("button", {
      key: t.v,
      onClick: () => G(a => ({
        ...a,
        freq: t.v
      })),
      style: {
        flex: 1,
        padding: "9px",
        borderRadius: 10,
        border: `1px solid ${ k.freq === t.v ? C.lime : C.border }`,
        background: k.freq === t.v ? `${ C.lime }18` : C.card,
        color: k.freq === t.v ? C.lime : C.textDim,
        fontWeight: 700,
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, t.l))), k.freq === "weekly" && React.createElement("div", {
      style: {
        display: "flex",
        gap: 4,
        marginTop: 8
      }
    }, WEEKDAYS.map((t, a) => React.createElement("button", {
      key: a,
      onClick: () => le(a),
      style: {
        flex: 1,
        padding: "8px 0",
        borderRadius: 8,
        border: `1px solid ${ k.days.includes(a) ? C.teal : C.border }`,
        background: k.days.includes(a) ? `${ C.teal }22` : C.card,
        color: k.days.includes(a) ? C.teal : C.textDim,
        fontWeight: 700,
        fontSize: 10,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, t)))), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Start Time"), React.createElement(Input, {
      type: "time",
      value: k.startTime,
      onChange: t => G(a => ({
        ...a,
        startTime: t
      })),
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "End Time"), React.createElement(Input, {
      type: "time",
      value: k.endTime,
      onChange: t => G(a => ({
        ...a,
        endTime: t
      })),
      style: { marginTop: 5 }
    }))), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Courts Booked"), React.createElement(Select, {
      value: k.courts,
      onChange: t => G(a => ({
        ...a,
        courts: t
      })),
      options: [
        1,
        2,
        3,
        4,
        5,
        6,
        8,
        10
      ].map(t => ({
        value: String(t),
        label: `${ t } Court${ t > 1 ? "s" : "" }`
      })),
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Players / Court"), React.createElement(Select, {
      value: k.perCourt,
      onChange: t => G(a => ({
        ...a,
        perCourt: t
      })),
      options: [
        1,
        2,
        3,
        4,
        5,
        6,
        7,
        8,
        9,
        10
      ].map(t => ({
        value: String(t),
        label: `${ t } player${ t > 1 ? "s" : "" }${ t === 2 ? " \xB7 singles" : t === 4 ? " \xB7 doubles" : "" }`
      })),
      style: { marginTop: 5 }
    }))), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Court Composition"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 6
      }
    }, [
      {
        v: "fixed",
        l: "Same players whole session"
      },
      {
        v: "rotate",
        l: "Reshuffle after 1 hour"
      },
      {
        v: "slots",
        l: "Reserve per 30 min"
      },
      {
        v: "kotc",
        l: "King of the Court"
      },
      {
        v: "ladder",
        l: "Ladder league"
      }
    ].map(t => React.createElement("button", {
      key: t.v,
      onClick: () => G(a => ({
        ...a,
        rotation: t.v
      })),
      style: {
        flex: 1,
        padding: "9px 6px",
        borderRadius: 10,
        border: `1px solid ${ k.rotation === t.v ? C.lime : C.border }`,
        background: k.rotation === t.v ? `${ C.lime }18` : C.card,
        color: k.rotation === t.v ? C.lime : C.textDim,
        fontWeight: 600,
        fontSize: 10,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, t.l)))), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Access"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 6
      }
    }, [
      {
        v: "open",
        l: "Open \u2014 anyone eligible can join"
      },
      {
        v: "restricted",
        l: "Restricted \u2014 invite / approval only"
      }
    ].map(t => React.createElement("button", {
      key: t.v,
      onClick: () => G(a => ({
        ...a,
        accessType: t.v
      })),
      style: {
        flex: 1,
        padding: "9px 6px",
        borderRadius: 10,
        border: `1px solid ${ (k.accessType || "open") === t.v ? C.lime : C.border }`,
        background: (k.accessType || "open") === t.v ? `${ C.lime }18` : C.card,
        color: (k.accessType || "open") === t.v ? C.lime : C.textDim,
        fontWeight: 600,
        fontSize: 10,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, t.l)))), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Price / Player \u20B9"), React.createElement(Input, {
      type: "number",
      value: k.price,
      onChange: t => G(a => ({
        ...a,
        price: t
      })),
      style: { marginTop: 5 }
    })), React.createElement("div", null, React.createElement("label", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textTransform: "uppercase",
        fontWeight: 700
      }
    }, "Match Scheduling"), React.createElement(Select, {
      value: k.scheduleMode,
      onChange: t => G(a => ({
        ...a,
        scheduleMode: t
      })),
      options: [
        {
          value: "random",
          label: "Random"
        },
        {
          value: "gsr",
          label: "Balanced by GSR"
        },
        {
          value: "americano",
          label: "Americano (rotate partners)"
        },
        {
          value: "mexicano",
          label: "Mexicano (match by level)"
        }
      ],
      style: { marginTop: 5 }
    }))), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 12,
        border: `1px solid ${ C.border }`,
        overflow: "hidden"
      }
    }, React.createElement("button", {
      onClick: () => D(t => !t),
      style: {
        width: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "12px 14px",
        background: "transparent",
        border: "none",
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, React.createElement("span", {
      style: {
        fontSize: 11,
        fontWeight: 700,
        color: C.text
      }
    }, "Player Restrictions ", React.createElement("span", {
      style: {
        color: C.textDim,
        fontWeight: 500
      }
    }, "(optional)")), React.createElement("span", {
      style: {
        color: C.textDim,
        transform: J ? "rotate(90deg)" : "none",
        transition: "0.2s"
      }
    }, React.createElement(Ic, {
      t: "chevron",
      s: 16
    }))), J && React.createElement("div", {
      style: {
        padding: "0 14px 14px",
        display: "flex",
        flexDirection: "column",
        gap: 10
      }
    }, React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        fontWeight: 700,
        marginBottom: 4
      }
    }, "GSR (in-app rating) range"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, React.createElement(Input, {
      type: "number",
      value: O.gsrMin,
      onChange: t => K(a => ({
        ...a,
        gsrMin: t
      })),
      placeholder: "Min",
      style: { flex: 1 }
    }), React.createElement(Input, {
      type: "number",
      value: O.gsrMax,
      onChange: t => K(a => ({
        ...a,
        gsrMax: t
      })),
      placeholder: "Max",
      style: { flex: 1 }
    }))), React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        fontWeight: 700,
        marginBottom: 4
      }
    }, "DUPR rating range"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, React.createElement(Input, {
      type: "number",
      value: O.duprMin,
      onChange: t => K(a => ({
        ...a,
        duprMin: t
      })),
      placeholder: "Min e.g. 3.0",
      style: { flex: 1 },
      step: "0.1"
    }), React.createElement(Input, {
      type: "number",
      value: O.duprMax,
      onChange: t => K(a => ({
        ...a,
        duprMax: t
      })),
      placeholder: "Max e.g. 4.5",
      style: { flex: 1 },
      step: "0.1"
    }))), React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        fontWeight: 700,
        marginBottom: 4
      }
    }, "Age range"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, React.createElement(Input, {
      type: "number",
      value: O.ageMin,
      onChange: t => K(a => ({
        ...a,
        ageMin: t
      })),
      placeholder: "Min",
      style: { flex: 1 }
    }), React.createElement(Input, {
      type: "number",
      value: O.ageMax,
      onChange: t => K(a => ({
        ...a,
        ageMax: t
      })),
      placeholder: "Max",
      style: { flex: 1 }
    }))), React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        fontWeight: 700,
        marginBottom: 4
      }
    }, "Gender"), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6
      }
    }, [
      "Any",
      "M",
      "F"
    ].map(t => React.createElement("button", {
      key: t,
      onClick: () => K(a => ({
        ...a,
        gender: t
      })),
      style: {
        flex: 1,
        padding: "8px",
        borderRadius: 8,
        border: `1px solid ${ O.gender === t ? C.lime : C.border }`,
        background: O.gender === t ? `${ C.lime }18` : C.card,
        color: O.gender === t ? C.lime : C.textDim,
        fontWeight: 600,
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, t === "Any" ? "Anyone" : t === "M" ? "Men" : "Women")))))), React.createElement("div", {
      style: {
        background: `${ C.lime }08`,
        borderRadius: 12,
        padding: 14,
        border: `1px solid ${ C.lime }22`
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textMuted,
        lineHeight: 1.6
      }
    }, k.freq === "daily" ? "Runs daily" : `Runs on ${ k.days.length ? k.days.map(t => WEEKDAYS[t]).join(", ") : "selected days" }`, " \xB7 ", k.startTime, "\u2013", k.endTime, " \xB7 ", k.courts, " court(s) \xD7 ", k.perCourt, " = ", React.createElement("b", { style: { color: C.lime } }, o, " spots"), " \xB7 ", k.rotation === "rotate" ? "reshuffle after 1 hr" : "fixed courts", " \xB7 \u20B9", k.price, "/player \xB7 matches ", k.scheduleMode === "gsr" ? "balanced by GSR" : "random")), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: i
    }, React.createElement(Ic, {
      t: "plus",
      s: 14
    }), " Create Game")));
  }
  if (l === "detail" && L) {
    const o = genSessionDates(L.freq, L.days, 6), t = v && o.includes(v) ? v : o[0], a = {
        ...emptySession(),
        ...L.sessions[t] || {}
      }, W = L.courts * L.perCourt, q = p && L.organiserId === p.id, E = s => d(y => y.map(F => {
        if (F.id !== L.id)
          return F;
        const Q = {
          ...emptySession(),
          ...F.sessions[t] || {}
        };
        return Q.interested = [...Q.interested], Q.requested = [...Q.requested], Q.confirmed = [...Q.confirmed], Q.waitlist = [...Q.waitlist], Q.paid = { ...Q.paid }, Q.linkSent = { ...Q.linkSent }, s(Q), {
          ...F,
          sessions: {
            ...F.sessions,
            [t]: Q
          }
        };
      })), ie = (s, y) => s.confirmed.includes(y) ? "confirmed" : s.waitlist.includes(y) ? "waitlist" : s.requested.includes(y) ? "requested" : s.interested.includes(y) ? "interested" : "none", V = (s, y) => {
        s.interested = s.interested.filter(F => F !== y), s.requested = s.requested.filter(F => F !== y), s.confirmed = s.confirmed.filter(F => F !== y), s.waitlist = s.waitlist.filter(F => F !== y);
      }, X = s => E(y => {
        y.interested.includes(s) ? y.interested = y.interested.filter(F => F !== s) : ie(y, s) === "none" && y.interested.push(s);
      }), j = s => E(y => {
        y.interested = y.interested.filter(F => F !== s), !y.requested.includes(s) && !y.confirmed.includes(s) && !y.waitlist.includes(s) && y.requested.push(s);
      }), $ = s => E(y => {
        const F = y.confirmed.includes(s);
        V(y, s), delete y.paid[s], delete y.linkSent[s], F && (y.openSlots = (y.openSlots || 0) + 1);
      }), T = s => E(y => {
        (y.openSlots || 0) > 0 && y.confirmed.length < W && (y.waitlist = y.waitlist.filter(F => F !== s), y.confirmed.includes(s) || y.confirmed.push(s), y.openSlots--);
      }), A = s => E(y => {
        y.requested = y.requested.filter(F => F !== s), y.waitlist = y.waitlist.filter(F => F !== s), y.confirmed.includes(s) || (y.confirmed.length < W ? y.confirmed.push(s) : y.waitlist.push(s));
      }), x = s => E(y => {
        y.requested = y.requested.filter(F => F !== s), y.confirmed = y.confirmed.filter(F => F !== s), y.waitlist.includes(s) || y.waitlist.push(s);
      }), U = s => E(y => {
        y.confirmed.length < W && (y.waitlist = y.waitlist.filter(F => F !== s), y.confirmed.includes(s) || y.confirmed.push(s), y.openSlots > 0 && y.openSlots--);
      }), re = s => E(y => {
        y.paid[s] = !y.paid[s];
      }), ue = s => E(y => {
        y.linkSent[s] = !0;
      }), Re = s => E(y => {
        y.confirmed = y.confirmed.filter(F => F !== s), delete y.paid[s], y.openSlots = (y.openSlots || 0) + 1;
      }), be = s => E(y => {
        y.interested = y.interested.filter(F => F !== s), y.requested.includes(s) || y.requested.push(s);
      }), ve = () => E(s => {
        const y = m.filter(F => checkCommEligibility(F, L).length === 0 && ie(s, F.id) === "none").sort(() => Math.random() - 0.5);
        y.slice(0, Math.min(5, W)).forEach(F => s.requested.push(F.id)), y.slice(5, 8).forEach(F => s.interested.push(F.id));
      }), me = () => E(s => {
        const y = s.confirmed.map(ee).filter(Boolean);
        if (y.length < 2)
          return;
        const F = L.rotation === "rotate" ? 2 : 1, Q = midTime(L.startTime, L.endTime), te = [];
        for (let pe = 0; pe < F; pe++) {
          const h = F === 2 ? pe === 0 ? `${ L.startTime }\u2013${ Q }` : `${ Q }\u2013${ L.endTime }` : `${ L.startTime }\u2013${ L.endTime }`, {
              courts: B,
              benched: b
            } = buildCourts(y, L.courts, L.perCourt, L.scheduleMode, pe);
          te.push({
            id: uid(),
            label: h,
            courts: B,
            benched: b
          });
        }
        s.schedule = { blocks: te };
      }), Se = () => {
        if (!I || w === "" || ne === "")
          return;
        const s = parseInt(w), y = parseInt(ne);
        if (s === y)
          return;
        const {
          bi: F,
          ci: Q,
          gi: te,
          g: pe
        } = I;
        E(b => {
          const N = b.schedule.blocks[F].courts[Q].games[te];
          N.scoreA = s, N.scoreB = y, N.winner = s > y ? "a" : "b", N.played = !0;
        });
        const h = s > y ? pe.a : pe.b, B = s > y ? pe.b : pe.a;
        se(h, B, Math.max(s, y), Math.min(s, y), `${ L.name } \xB7 ${ prettyDate(t) }`, L.sport), ae(null), P(""), Y("");
      }, gameMut = fn => d(y => y.map(F => {
        if (F.id !== L.id)
          return F;
        const G2 = {
          ...F,
          members: [...F.members || []],
          joinRequests: [...F.joinRequests || []],
          invites: [...F.invites || []]
        };
        return fn(G2), G2;
      })), members2 = L.members || [], isRestricted = L.accessType === "restricted", isMember = p ? members2.includes(p.id) || L.organiserId === p.id : !1, canParticipate = !isRestricted || isMember || q, joinStatus = p ? L.organiserId === p.id ? "organiser" : members2.includes(p.id) ? "member" : (L.invites || []).includes(p.id) ? "invited" : (L.joinRequests || []).includes(p.id) ? "requested" : "none" : "none", requestJoin = () => p && gameMut(g2 => {
        !g2.joinRequests.includes(p.id) && !g2.members.includes(p.id) && g2.joinRequests.push(p.id);
      }), acceptInvite = () => p && gameMut(g2 => {
        g2.invites = g2.invites.filter(x => x !== p.id), g2.members.includes(p.id) || g2.members.push(p.id);
      }), approveJoin = pid => gameMut(g2 => {
        g2.joinRequests = g2.joinRequests.filter(x => x !== pid), g2.members.includes(pid) || g2.members.push(pid);
      }), denyJoin = pid => gameMut(g2 => {
        g2.joinRequests = g2.joinRequests.filter(x => x !== pid);
      }), invitePlayer = pid => gameMut(g2 => {
        !g2.invites.includes(pid) && !g2.members.includes(pid) && g2.invites.push(pid);
      }), removeMember = pid => gameMut(g2 => {
        g2.members = g2.members.filter(x => x !== pid);
      }), slotLabels = genHalfHourSlots(L.startTime, L.endTime), slotMut = (slot, fn) => d(y => y.map(F => {
        if (F.id !== L.id)
          return F;
        const sess = {
          ...emptySession(),
          ...F.sessions[t] || {}
        }, sd = { ...sess.slotData || {} };
        return sd[slot] = [...sd[slot] || []], fn(sd[slot]), sess.slotData = sd, {
          ...F,
          sessions: {
            ...F.sessions,
            [t]: sess
          }
        };
      })), reserveSlot = slot => p && slotMut(slot, list => {
        !list.includes(p.id) && list.length < W && list.push(p.id);
      }), reserveSlotFor = (slot, pid) => slotMut(slot, list => {
        !list.includes(pid) && list.length < W && list.push(pid);
      }), leaveSlot = slot => p && slotMut(slot, list => {
        const i = list.indexOf(p.id);
        i >= 0 && list.splice(i, 1);
      }), removeFromSlot = (slot, pid) => slotMut(slot, list => {
        const i = list.indexOf(pid);
        i >= 0 && list.splice(i, 1);
      }), kotcMut = fn => d(y => y.map(F => {
        if (F.id !== L.id)
          return F;
        const sess = {
          ...emptySession(),
          ...F.sessions[t] || {}
        };
        const kc = sess.kotc ? {
          courts: sess.kotc.courts.map(c2 => ({
            ...c2,
            a: [...c2.a],
            b: [...c2.b]
          })),
          bench: [...sess.kotc.bench],
          crowns: { ...sess.kotc.crowns },
          round: sess.kotc.round
        } : null;
        const res = fn(kc);
        return sess.kotc = res || kc, {
          ...F,
          sessions: {
            ...F.sessions,
            [t]: sess
          }
        };
      })), kotcStart = () => {
        const pool = [...a.confirmed].sort(() => Math.random() - 0.5);
        if (pool.length < 4)
          return;
        const courts2 = [];
        const nc = Math.min(L.courts, Math.floor(pool.length / 4));
        for (let i = 0; i < nc; i++) {
          const g2 = pool.slice(i * 4, i * 4 + 4);
          courts2.push({
            a: [
              g2[0],
              g2[1]
            ],
            b: [
              g2[2],
              g2[3]
            ],
            winner: null
          });
        }
        kotcMut(() => ({
          courts: courts2,
          bench: pool.slice(nc * 4),
          crowns: {},
          round: 1
        }));
      }, kotcPick = (ci, side) => kotcMut(kc => {
        kc.courts[ci].winner = side;
      }), kotcNext = () => kotcMut(kc => {
        if (!kc || kc.courts.some(c2 => !c2.winner))
          return kc;
        const wn = kc.courts.map(c2 => c2.winner === "a" ? c2.a : c2.b), ls = kc.courts.map(c2 => c2.winner === "a" ? c2.b : c2.a), nn = kc.courts.length;
        wn[0].forEach(pid => kc.crowns[pid] = (kc.crowns[pid] || 0) + 1);
        const useBench = kc.bench.length >= 2;
        const nc2 = [];
        for (let i2 = 0; i2 < nn; i2++) {
          const stay = i2 === 0 ? wn[0] : ls[i2 - 1];
          const up = i2 + 1 < nn ? wn[i2 + 1] : useBench ? kc.bench.slice(0, 2) : ls[nn - 1];
          nc2.push({
            a: stay,
            b: up,
            winner: null
          });
        }
        const nb = useBench ? kc.bench.slice(2).concat(ls[nn - 1]) : kc.bench;
        return {
          courts: nc2,
          bench: nb,
          crowns: kc.crowns,
          round: kc.round + 1
        };
      }), ladMut = fn => d(y => y.map(F => {
        if (F.id !== L.id)
          return F;
        const cp = {
          ...F,
          ladderOrder: [...F.ladderOrder || []],
          ladderLog: [...F.ladderLog || []]
        };
        return fn(cp), cp;
      })), ladAdd = pid => ladMut(cp => {
        cp.ladderOrder.includes(pid) || cp.ladderOrder.push(pid);
      }), ladResolve = challengerWon => {
        if (!ladSel || ladSel.def == null)
          return;
        ladMut(cp => {
          const ci = cp.ladderOrder.indexOf(ladSel.ch), di = cp.ladderOrder.indexOf(ladSel.def);
          if (ci < 0 || di < 0)
            return;
          challengerWon && ([cp.ladderOrder[ci], cp.ladderOrder[di]] = [
            cp.ladderOrder[di],
            cp.ladderOrder[ci]
          ]);
          cp.ladderLog.unshift({
            ch: ladSel.ch,
            def: ladSel.def,
            won: challengerWon,
            at: new Date().toISOString().split("T")[0]
          }), cp.ladderLog = cp.ladderLog.slice(0, 6);
        }), setLadSel(null);
      }, isKotc = L.rotation === "kotc", isLadder = L.rotation === "ladder", kotc = a.kotc || null, slotData = a.slotData || {}, isSlotMode = L.rotation === "slots", he = p ? ie(a, p.id) : "none", Me = p ? checkCommEligibility(p, L) : [], De = [
        [
          "interested",
          "Interested",
          a.interested.length
        ],
        [
          "requests",
          "Requests",
          a.requested.length
        ],
        [
          "confirmed",
          "Confirmed",
          a.confirmed.length
        ],
        [
          "waitlist",
          "Waitlist",
          a.waitlist.length
        ]
      ];
    return React.createElement("div", null, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8,
        marginBottom: 12
      }
    }, React.createElement("button", {
      onClick: () => n("list"),
      style: {
        background: C.card,
        border: "none",
        borderRadius: 8,
        padding: "8px 12px",
        color: C.textMuted,
        cursor: "pointer",
        display: "flex",
        alignItems: "center"
      }
    }, React.createElement(Ic, {
      t: "back",
      s: 16
    })), React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, React.createElement("h2", {
      style: {
        fontSize: 16,
        fontWeight: 800,
        color: C.text,
        margin: 0,
        overflow: "hidden",
        textOverflow: "ellipsis",
        whiteSpace: "nowrap"
      }
    }, L.name), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, L.venue, " \xB7 ", L.area, " \xB7 Host: ", L.organiserName))), React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 5,
        marginBottom: 8
      }
    }, React.createElement(Badge, {
      color: C.teal,
      small: !0
    }, React.createElement(Ic, {
      t: "repeat",
      s: 9
    }), " ", L.freq === "daily" ? "Daily" : L.days.map(s => WEEKDAYS[s]).join(", ")), React.createElement(Badge, {
      color: C.blue,
      small: !0
    }, React.createElement(Ic, {
      t: "clock",
      s: 9
    }), " ", L.startTime, "\u2013", L.endTime), React.createElement(Badge, {
      color: C.lime,
      small: !0
    }, L.courts, " ct \xD7 ", L.perCourt, " = ", W, " spots"), React.createElement(Badge, {
      color: C.gold,
      small: !0
    }, fp(L.price), "/player"), React.createElement(Badge, {
      color: C.purple,
      small: !0
    }, L.rotation === "rotate" ? "Reshuffle 1hr" : "Fixed courts"), React.createElement(Badge, {
      color: C.orange,
      small: !0
    }, ({
      gsr: "GSR balanced",
      random: "Random",
      americano: "Americano",
      mexicano: "Mexicano"
    })[L.scheduleMode] || "Random")), ce(L).length > 0 && React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 4
      }
    }, ce(L).map((s, y) => React.createElement("span", {
      key: y,
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: C.red,
        background: `${ C.red }15`,
        borderRadius: 6,
        padding: "2px 7px"
      }
    }, s)))), isRestricted && React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 10
      }
    }, React.createElement(Ic, {
      t: "shield",
      s: 14
    }), React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: C.text
      }
    }, "Restricted \u2014 invite / approval only")), q || z ? React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textMuted,
        textTransform: "uppercase",
        marginBottom: 6
      }
    }, "Join Requests (", (L.joinRequests || []).length, ")"), (L.joinRequests || []).length === 0 ? React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.textDim,
        marginBottom: 10
      }
    }, "No pending requests.") : React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 5,
        marginBottom: 10
      }
    }, (L.joinRequests || []).map(pid => {
      const pl = ee(pid);
      return React.createElement("div", {
        key: pid,
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 6,
          background: C.cardAlt,
          borderRadius: 8,
          padding: "6px 10px"
        }
      }, React.createElement("span", {
        style: {
          fontSize: 11,
          color: C.text
        }
      }, pl ? pl.fullName : pid), React.createElement("div", {
        style: {
          display: "flex",
          gap: 5
        }
      }, React.createElement(Btn, {
        small: !0,
        primary: !0,
        color: C.lime,
        onClick: () => approveJoin(pid)
      }, "Approve"), React.createElement(Btn, {
        small: !0,
        onClick: () => denyJoin(pid)
      }, "Deny")));
    })), React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textMuted,
        textTransform: "uppercase",
        marginBottom: 6
      }
    }, "Members (", members2.length, ")"), React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 5,
        marginBottom: 10
      }
    }, members2.length === 0 ? React.createElement("span", {
      style: {
        fontSize: 11,
        color: C.textDim
      }
    }, "No members yet.") : members2.map(pid => {
      const pl = ee(pid);
      return React.createElement("span", {
        key: pid,
        style: {
          fontSize: 10,
          fontWeight: 600,
          color: C.text,
          background: C.cardAlt,
          borderRadius: 6,
          padding: "3px 8px",
          display: "inline-flex",
          alignItems: "center",
          gap: 5
        }
      }, pl ? pl.firstName || pl.fullName : pid, React.createElement("span", {
        onClick: () => removeMember(pid),
        style: {
          cursor: "pointer",
          color: C.red,
          fontWeight: 800
        }
      }, "\u00D7"));
    })), React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textMuted,
        textTransform: "uppercase",
        marginBottom: 6
      }
    }, "Invite Players"), React.createElement(Input, {
      value: invQ,
      onChange: setInvQ,
      placeholder: "Search players to invite",
      icon: "search"
    }), invQ && React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        marginTop: 6
      }
    }, m.filter(pl => pl.id !== L.organiserId && !members2.includes(pl.id) && (pl.fullName.toLowerCase().includes(invQ.toLowerCase()) || pl.id.toLowerCase().includes(invQ.toLowerCase()))).slice(0, 6).map(pl => React.createElement("div", {
      key: pl.id,
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 6,
        background: C.cardAlt,
        borderRadius: 8,
        padding: "6px 10px"
      }
    }, React.createElement("span", {
      style: {
        fontSize: 11,
        color: C.text
      }
    }, pl.fullName), (L.invites || []).includes(pl.id) ? React.createElement(Badge, {
      color: C.blue,
      small: !0
    }, "Invited") : React.createElement(Btn, {
      small: !0,
      primary: !0,
      color: C.teal,
      onClick: () => invitePlayer(pl.id)
    }, "Invite"))))) : React.createElement("div", null, joinStatus === "member" ? React.createElement("div", {
      style: {
        fontSize: 12,
        color: C.lime,
        fontWeight: 700
      }
    }, "\u2713 You're a member of this game.") : joinStatus === "invited" ? React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.text,
        marginBottom: 8
      }
    }, "You've been invited to join this game."), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: acceptInvite
    }, "Accept Invitation")) : joinStatus === "requested" ? React.createElement("div", {
      style: {
        fontSize: 12,
        color: C.orange,
        fontWeight: 700
      }
    }, "Request sent \u2014 awaiting organiser approval.") : React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.textMuted,
        marginBottom: 8
      }
    }, "This is an invite-only game. Request access to participate."), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: requestJoin,
      disabled: !p
    }, "Request to Join")))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 12
      }
    }, [
      [
        "player",
        "Player View"
      ],
      [
        "organiser",
        "Organiser View"
      ]
    ].map(([s, y]) => React.createElement("button", {
      key: s,
      onClick: () => g(s === "organiser"),
      style: {
        flex: 1,
        padding: "8px",
        borderRadius: 10,
        border: `1px solid ${ (z ? "organiser" : "player") === s ? C.lime : C.border }`,
        background: (z ? "organiser" : "player") === s ? `${ C.lime }18` : C.card,
        color: (z ? "organiser" : "player") === s ? C.lime : C.textDim,
        fontWeight: 700,
        fontSize: 11,
        cursor: "pointer",
        fontFamily: "inherit"
      }
    }, y))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginBottom: 12,
        overflowX: "auto",
        paddingBottom: 3
      }
    }, o.map(s => {
      const y = {
        ...emptySession(),
        ...L.sessions[s] || {}
      };
      return React.createElement("button", {
        key: s,
        onClick: () => M(s),
        style: {
          padding: "7px 12px",
          borderRadius: 10,
          border: `1px solid ${ t === s ? C.lime : C.border }`,
          background: t === s ? `${ C.lime }18` : C.card,
          color: t === s ? C.lime : C.textMuted,
          fontWeight: 700,
          fontSize: 10,
          cursor: "pointer",
          whiteSpace: "nowrap",
          fontFamily: "inherit",
          textAlign: "center"
        }
      }, React.createElement("div", null, prettyDate(s)), React.createElement("div", {
        style: {
          fontSize: 8,
          color: t === s ? C.lime : C.textDim,
          fontWeight: 600
        }
      }, y.confirmed.length, "/", W));
    })), isKotc && React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        marginBottom: 8
      }
    }, React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: C.text
      }
    }, "\uD83D\uDC51 King of the Court"), kotc && React.createElement(Badge, {
      color: C.orange,
      small: !0
    }, "Round ", kotc.round)), !kotc || !kotc.courts.length ? React.createElement("div", null, React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim,
        marginBottom: 8
      }
    }, "Winners climb toward the King court, losers slide down. Confirm at least 4 players below, then start."), (q || z) && React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: kotcStart,
      disabled: a.confirmed.length < 4
    }, "Start \u2014 ", a.confirmed.length, " players ready")) : React.createElement("div", null, kotc.courts.map((ct4, ci4) => React.createElement("div", {
      key: ci4,
      style: {
        background: ci4 === 0 ? `${ C.gold }12` : C.cardAlt,
        border: `1px solid ${ ci4 === 0 ? C.gold + "55" : C.border }`,
        borderRadius: 10,
        padding: "8px 10px",
        marginBottom: 6
      }
    }, React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 800,
        color: ci4 === 0 ? C.gold : C.textDim,
        textTransform: "uppercase",
        marginBottom: 4
      }
    }, ci4 === 0 ? "\uD83D\uDC51 King Court" : "Court " + (ci4 + 1)), React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        gap: 6,
        fontSize: 10,
        color: C.text
      }
    }, React.createElement("span", { style: { fontWeight: ct4.winner === "a" ? 800 : 500 } }, ct4.a.map(x4 => ee(x4)?.firstName || x4).join(" + ")), React.createElement("span", {
      style: {
        fontSize: 9,
        color: C.textDim
      }
    }, "vs"), React.createElement("span", {
      style: {
        fontWeight: ct4.winner === "b" ? 800 : 500,
        textAlign: "right"
      }
    }, ct4.b.map(x4 => ee(x4)?.firstName || x4).join(" + "))), (q || z) && React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 6
      }
    }, React.createElement(Btn, {
      small: !0,
      color: ct4.winner === "a" ? C.lime : void 0,
      primary: ct4.winner === "a",
      onClick: () => kotcPick(ci4, "a")
    }, "Left won"), React.createElement(Btn, {
      small: !0,
      color: ct4.winner === "b" ? C.lime : void 0,
      primary: ct4.winner === "b",
      onClick: () => kotcPick(ci4, "b")
    }, "Right won")))), kotc.bench.length > 0 && React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        marginBottom: 6
      }
    }, "Waiting: ", kotc.bench.map(x4 => ee(x4)?.firstName || x4).join(", ")), (q || z) && React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.teal,
      onClick: kotcNext,
      disabled: kotc.courts.some(c4 => !c4.winner)
    }, "Next Round \u2192"), Object.keys(kotc.crowns).length > 0 && React.createElement("div", { style: { marginTop: 10 } }, React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        marginBottom: 4
      }
    }, "Crowns"), Object.entries(kotc.crowns).sort((a4, b4) => b4[1] - a4[1]).map(([pid4, cr4]) => React.createElement("div", {
      key: pid4,
      style: {
        display: "flex",
        justifyContent: "space-between",
        fontSize: 10,
        color: C.text,
        padding: "2px 0"
      }
    }, React.createElement("span", null, ee(pid4)?.fullName || pid4), React.createElement("b", { style: { color: C.gold } }, "\uD83D\uDC51 ", cr4)))))), isLadder && React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: C.text,
        marginBottom: 4
      }
    }, "\uD83E\uDE9C Ladder"), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim,
        marginBottom: 8
      }
    }, ladSel ? ladSel.def != null ? "Confirm the result below." : "Now tap a player ABOVE to challenge." : "Tap a player to start a challenge. Beat someone above you to take their spot."), ((L.ladderOrder || []).length === 0 ? React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim,
        marginBottom: 8
      }
    }, "No players on the ladder yet.") : (L.ladderOrder || []).map((pid4, idx4) => {
      const isCh = ladSel && ladSel.ch === pid4, isDef = ladSel && ladSel.def === pid4;
      return React.createElement("div", {
        key: pid4,
        onClick: () => {
          if (!(q || z || p && p.id === pid4) && !ladSel)
            return;
          if (!ladSel)
            setLadSel({
              ch: pid4,
              def: null
            });
          else if (ladSel.ch === pid4)
            setLadSel(null);
          else if (ladSel.def == null) {
            const ci4 = (L.ladderOrder || []).indexOf(ladSel.ch);
            idx4 < ci4 && setLadSel({
              ...ladSel,
              def: pid4
            });
          }
        },
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "7px 10px",
          borderRadius: 8,
          marginBottom: 4,
          background: isCh ? `${ C.lime }18` : isDef ? `${ C.orange }18` : C.cardAlt,
          border: `1px solid ${ isCh ? C.lime : isDef ? C.orange : C.border }`,
          cursor: "pointer",
          fontSize: 11,
          color: C.text
        }
      }, React.createElement("span", null, React.createElement("b", {
        style: {
          color: idx4 === 0 ? C.gold : C.textDim,
          marginRight: 8
        }
      }, "#", idx4 + 1), ee(pid4)?.fullName || pid4), isCh && React.createElement(Badge, {
        color: C.lime,
        small: !0
      }, "Challenger"), isDef && React.createElement(Badge, {
        color: C.orange,
        small: !0
      }, "Defends"));
    })), ladSel && ladSel.def != null && React.createElement("div", {
      style: {
        display: "flex",
        gap: 6,
        marginTop: 8
      }
    }, React.createElement(Btn, {
      small: !0,
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: () => ladResolve(!0)
    }, "Challenger won \u2014 swap"), React.createElement(Btn, {
      small: !0,
      full: !0,
      onClick: () => ladResolve(!1)
    }, "Defender held")), (q || z) && React.createElement("div", { style: { marginTop: 10 } }, React.createElement(Input, {
      value: ladQ,
      onChange: setLadQ,
      placeholder: "Add player to ladder",
      icon: "search"
    }), ladQ && React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        marginTop: 6
      }
    }, m.filter(pl4 => !(L.ladderOrder || []).includes(pl4.id) && pl4.fullName.toLowerCase().includes(ladQ.toLowerCase())).slice(0, 5).map(pl4 => React.createElement("div", {
      key: pl4.id,
      onClick: () => {
        ladAdd(pl4.id), setLadQ("");
      },
      style: {
        background: C.cardAlt,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 11,
        color: C.text,
        cursor: "pointer"
      }
    }, pl4.fullName)))), (L.ladderLog || []).length > 0 && React.createElement("div", { style: { marginTop: 10 } }, React.createElement("div", {
      style: {
        fontSize: 9,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        marginBottom: 4
      }
    }, "Recent challenges"), (L.ladderLog || []).map((lg4, li4) => React.createElement("div", {
      key: li4,
      style: {
        fontSize: 10,
        color: C.textMuted,
        padding: "2px 0"
      }
    }, ee(lg4.ch)?.firstName || lg4.ch, lg4.won ? " \u2B06 beat " : " lost to ", ee(lg4.def)?.firstName || lg4.def, " \xB7 ", lg4.at)))), isSlotMode && React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 14,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 4
      }
    }, React.createElement(Ic, {
      t: "clock",
      s: 14
    }), React.createElement("span", {
      style: {
        fontSize: 12,
        fontWeight: 800,
        color: C.text
      }
    }, "30-min Reservations")), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textDim,
        marginBottom: 10
      }
    }, prettyDate(t), " \xB7 ", W, " spots per slot"), !canParticipate && React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.orange,
        marginBottom: 8
      }
    }, "Join the game above to reserve a slot."), (q || z) && React.createElement("div", { style: { marginBottom: 10 } }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textMuted,
        textTransform: "uppercase",
        marginBottom: 5
      }
    }, "Reserve for a player"), slotPick ? React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 8
      }
    }, React.createElement(Badge, { color: C.teal }, slotPick.fullName), React.createElement("span", {
      onClick: () => setSlotPick(null),
      style: {
        cursor: "pointer",
        color: C.red,
        fontWeight: 800,
        fontSize: 13
      }
    }, "\u00D7"), React.createElement("span", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, "tap Reserve on a slot below")) : React.createElement(React.Fragment, null, React.createElement(Input, {
      value: slotQ,
      onChange: setSlotQ,
      placeholder: "Search player name",
      icon: "search"
    }), slotQ && React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 4,
        marginTop: 6
      }
    }, m.filter(pl => pl.fullName.toLowerCase().includes(slotQ.toLowerCase())).slice(0, 5).map(pl => React.createElement("div", {
      key: pl.id,
      onClick: () => {
        setSlotPick(pl), setSlotQ("");
      },
      style: {
        background: C.cardAlt,
        borderRadius: 8,
        padding: "6px 10px",
        fontSize: 11,
        color: C.text,
        cursor: "pointer"
      }
    }, pl.fullName))))), React.createElement("div", {
      style: {
        display: "flex",
        flexDirection: "column",
        gap: 6
      }
    }, slotLabels.map(slot => {
      const list = slotData[slot] || [], mine = p && list.includes(p.id), full = list.length >= W;
      return React.createElement("div", {
        key: slot,
        style: {
          background: C.cardAlt,
          borderRadius: 10,
          padding: "8px 10px"
        }
      }, React.createElement("div", {
        style: {
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8
        }
      }, React.createElement("div", null, React.createElement("span", {
        style: {
          fontSize: 12,
          fontWeight: 700,
          color: C.text
        }
      }, slot), React.createElement("span", {
        style: {
          fontSize: 10,
          color: list.length ? C.lime : C.textDim,
          marginLeft: 8
        }
      }, list.length, "/", W)), mine ? React.createElement(Btn, {
        small: !0,
        color: C.red,
        onClick: () => leaveSlot(slot)
      }, "Cancel") : full ? React.createElement(Badge, {
        color: C.textDim,
        small: !0
      }, "Full") : React.createElement(Btn, {
        small: !0,
        primary: !0,
        color: C.lime,
        onClick: () => (q || z) && slotPick ? reserveSlotFor(slot, slotPick.id) : reserveSlot(slot),
        disabled: q || z ? !1 : !p || !canParticipate
      }, (q || z) && slotPick ? "Add " + (slotPick.firstName || "player") : "Reserve")), list.length > 0 && React.createElement("div", {
        style: {
          display: "flex",
          flexWrap: "wrap",
          gap: 4,
          marginTop: 6
        }
      }, list.map(pid => {
        const pl = ee(pid);
        return React.createElement("span", {
          key: pid,
          style: {
            fontSize: 9,
            fontWeight: 600,
            color: C.text,
            background: C.card,
            borderRadius: 6,
            padding: "2px 7px",
            display: "inline-flex",
            alignItems: "center",
            gap: 4
          }
        }, pl ? pl.firstName || pl.fullName : pid, (q || z) && React.createElement("span", {
          onClick: () => removeFromSlot(slot, pid),
          style: {
            cursor: "pointer",
            color: C.red,
            fontWeight: 800
          }
        }, "\u00D7"));
      })));
    }))), !isSlotMode && !isLadder && React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 12,
        padding: 12,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        marginBottom: 6
      }
    }, React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textMuted
      }
    }, a.confirmed.length, " confirmed \xB7 ", a.waitlist.length, " waitlist"), React.createElement("span", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, W, " spots")), React.createElement("div", {
      style: {
        height: 7,
        borderRadius: 4,
        background: C.cardAlt,
        overflow: "hidden"
      }
    }, React.createElement("div", {
      style: {
        height: "100%",
        width: `${ Math.min(100, a.confirmed.length / W * 100) }%`,
        background: `linear-gradient(90deg, ${ C.limeDark }, ${ C.lime })`
      }
    })), a.openSlots > 0 && React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.orange,
        fontWeight: 700,
        marginTop: 6
      }
    }, "\u26A0 ", a.openSlots, " slot(s) opened by a backout \u2014 waitlist can move up")), !isSlotMode && !isLadder && canParticipate && (z ? React.createElement(React.Fragment, null, !q && React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        marginBottom: 8,
        fontStyle: "italic"
      }
    }, "Demo: explore organiser controls. In production these are visible only to the game's host."), React.createElement("div", {
      style: {
        display: "flex",
        gap: 5,
        marginBottom: 12,
        overflowX: "auto",
        paddingBottom: 3
      }
    }, De.map(([s, y, F]) => React.createElement("button", {
      key: s,
      onClick: () => u(s),
      style: {
        padding: "7px 12px",
        borderRadius: 10,
        border: `1px solid ${ f === s ? C.lime : C.border }`,
        background: f === s ? `${ C.lime }18` : C.card,
        color: f === s ? C.lime : C.textDim,
        fontWeight: 700,
        fontSize: 10,
        cursor: "pointer",
        whiteSpace: "nowrap",
        fontFamily: "inherit"
      }
    }, y, " ", React.createElement("span", { style: { opacity: 0.7 } }, F)))), f === "interested" && React.createElement("div", null, a.interested.length === 0 ? React.createElement("div", {
      style: {
        textAlign: "center",
        padding: 20,
        color: C.textDim,
        fontSize: 11
      }
    }, "No one has marked interested yet.", React.createElement("div", { style: { marginTop: 10 } }, React.createElement(Btn, {
      small: !0,
      onClick: ve
    }, React.createElement(Ic, {
      t: "users",
      s: 12
    }), " Simulate interest (demo)"))) : a.interested.map(s => React.createElement(ge, {
      key: s,
      pid: s,
      right: React.createElement(Btn, {
        small: !0,
        primary: !0,
        color: C.blue,
        onClick: () => be(s)
      }, "\u2192 Request")
    }))), f === "requests" && React.createElement("div", null, a.requested.length === 0 ? React.createElement("div", {
      style: {
        textAlign: "center",
        padding: 20,
        color: C.textDim,
        fontSize: 11
      }
    }, "No reservation requests yet.", React.createElement("div", { style: { marginTop: 10 } }, React.createElement(Btn, {
      small: !0,
      onClick: ve
    }, React.createElement(Ic, {
      t: "users",
      s: 12
    }), " Simulate requests (demo)"))) : a.requested.map(s => React.createElement(ge, {
      key: s,
      pid: s,
      sub: a.linkSent[s] ? "Payment link sent" : "Send payment link to confirm",
      right: React.createElement("div", {
        style: {
          display: "flex",
          gap: 4
        }
      }, React.createElement("button", {
        onClick: () => ue(s),
        title: "Send payment link",
        style: {
          width: 28,
          height: 28,
          borderRadius: 7,
          border: `1px solid ${ a.linkSent[s] ? C.lime + "55" : C.border }`,
          background: a.linkSent[s] ? `${ C.lime }18` : C.card,
          color: a.linkSent[s] ? C.lime : C.textMuted,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }
      }, React.createElement(Ic, {
        t: "link",
        s: 13
      })), React.createElement(Btn, {
        small: !0,
        primary: !0,
        color: C.lime,
        onClick: () => A(s)
      }, "Confirm"), React.createElement(Btn, {
        small: !0,
        onClick: () => x(s)
      }, "Waitlist"))
    }))), f === "confirmed" && React.createElement("div", null, a.confirmed.length === 0 ? React.createElement("div", {
      style: {
        textAlign: "center",
        padding: 20,
        color: C.textDim,
        fontSize: 11
      }
    }, "No confirmed players yet.") : React.createElement(React.Fragment, null, a.confirmed.map(s => React.createElement(ge, {
      key: s,
      pid: s,
      sub: a.paid[s] ? "Paid \u2713" : a.linkSent[s] ? "Link sent \xB7 unpaid" : "Unpaid",
      right: React.createElement("div", {
        style: {
          display: "flex",
          gap: 4
        }
      }, React.createElement("button", {
        onClick: () => re(s),
        style: {
          padding: "0 9px",
          height: 28,
          borderRadius: 7,
          border: `1px solid ${ a.paid[s] ? C.lime + "55" : C.border }`,
          background: a.paid[s] ? `${ C.lime }18` : C.card,
          color: a.paid[s] ? C.lime : C.textMuted,
          cursor: "pointer",
          fontSize: 10,
          fontWeight: 700,
          fontFamily: "inherit"
        }
      }, a.paid[s] ? "Paid \u2713" : "Mark paid"), React.createElement("button", {
        onClick: () => Re(s),
        title: "Player backed out",
        style: {
          width: 28,
          height: 28,
          borderRadius: 7,
          border: "none",
          background: `${ C.red }22`,
          color: C.red,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          justifyContent: "center"
        }
      }, React.createElement(Ic, {
        t: "x",
        s: 11
      })))
    })), React.createElement(Btn, {
      full: !0,
      primary: !0,
      color: C.orange,
      onClick: me,
      style: { marginTop: 8 },
      disabled: a.confirmed.length < 2
    }, React.createElement(Ic, {
      t: "zap",
      s: 13
    }), " ", a.schedule ? "Regenerate" : "Generate", " Match Schedule"))), f === "waitlist" && React.createElement("div", null, a.waitlist.length === 0 ? React.createElement("div", {
      style: {
        textAlign: "center",
        padding: 20,
        color: C.textDim,
        fontSize: 11
      }
    }, "Waitlist is empty.") : a.waitlist.map((s, y) => React.createElement(ge, {
      key: s,
      pid: s,
      sub: `Waitlist #${ y + 1 }`,
      right: React.createElement(Btn, {
        small: !0,
        primary: !0,
        color: C.lime,
        onClick: () => U(s),
        disabled: a.confirmed.length >= W
      }, "Promote")
    })))) : React.createElement(React.Fragment, null, p ? Me.length > 0 ? React.createElement("div", {
      style: {
        background: `${ C.red }10`,
        borderRadius: 12,
        padding: 14,
        border: `1px solid ${ C.red }33`,
        marginBottom: 12
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 700,
        color: C.red,
        marginBottom: 4
      }
    }, "You don't meet this game's restrictions"), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textMuted
      }
    }, Me.join(" \xB7 "))) : React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 12,
        padding: 14,
        border: `1px solid ${ C.border }`,
        marginBottom: 12
      }
    }, he === "confirmed" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: C.lime,
        marginBottom: 8
      }
    }, React.createElement(Ic, {
      t: "check",
      s: 13
    }), " You're confirmed for ", prettyDate(t)), React.createElement("div", {
      style: {
        fontSize: 10,
        color: a.paid[p.id] ? C.lime : C.orange,
        marginBottom: 10
      }
    }, a.paid[p.id] ? "Payment confirmed \u2713" : a.linkSent[p.id] ? "Payment link sent \u2014 pay to secure your spot" : "Awaiting payment link from organiser"), React.createElement(Btn, {
      full: !0,
      small: !0,
      onClick: () => $(p.id)
    }, "Can't make it \u2014 withdraw")) : he === "waitlist" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: C.orange,
        marginBottom: 8
      }
    }, "You're on the waitlist (#", a.waitlist.indexOf(p.id) + 1, ")"), a.openSlots > 0 && React.createElement(Btn, {
      full: !0,
      small: !0,
      primary: !0,
      color: C.lime,
      onClick: () => T(p.id),
      style: { marginBottom: 6 }
    }, "A slot opened \u2014 Move to Confirmed"), React.createElement(Btn, {
      full: !0,
      small: !0,
      onClick: () => $(p.id)
    }, "Leave waitlist")) : he === "requested" ? React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 12,
        fontWeight: 700,
        color: C.blue,
        marginBottom: 6
      }
    }, "Slot requested"), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textMuted,
        marginBottom: 10
      }
    }, a.linkSent[p.id] ? "The organiser sent you a payment link \u2014 pay to get confirmed." : "The organiser will send you a payment link to confirm your spot."), React.createElement(Btn, {
      full: !0,
      small: !0,
      onClick: () => $(p.id)
    }, "Cancel request")) : React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 11,
        color: C.textMuted,
        marginBottom: 10
      }
    }, "Join this session on ", prettyDate(t), ", ", L.startTime, "\u2013", L.endTime, "."), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8
      }
    }, React.createElement(Btn, {
      full: !0,
      small: !0,
      onClick: () => X(p.id),
      color: C.teal,
      primary: he === "interested"
    }, React.createElement(Ic, {
      t: "star",
      s: 12
    }), " ", he === "interested" ? "Interested \u2713" : "I'm Interested"), React.createElement(Btn, {
      full: !0,
      small: !0,
      primary: !0,
      color: C.lime,
      onClick: () => j(p.id)
    }, React.createElement(Ic, {
      t: "check",
      s: 12
    }), " Reserve Slot")))) : React.createElement("div", {
      style: {
        background: C.card,
        borderRadius: 12,
        padding: 16,
        border: `1px solid ${ C.border }`,
        textAlign: "center",
        marginBottom: 12
      }
    }, React.createElement("p", {
      style: {
        fontSize: 12,
        color: C.textMuted,
        margin: "0 0 10px"
      }
    }, "Register to join community games."), React.createElement(Btn, {
      primary: !0,
      onClick: () => r("register")
    }, React.createElement(Ic, {
      t: "user",
      s: 14
    }), " Register \u2014 Free")), a.confirmed.length > 0 && React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6
      }
    }, "Confirmed Players (", a.confirmed.length, ")"), React.createElement("div", { style: { marginBottom: 12 } }, a.confirmed.map(s => React.createElement(ge, {
      key: s,
      pid: s,
      right: a.paid[s] ? React.createElement(Badge, {
        color: C.lime,
        small: !0
      }, React.createElement(Ic, {
        t: "check",
        s: 9
      }), " Paid") : React.createElement(Badge, {
        color: C.textDim,
        small: !0
      }, "Pending")
    })))), a.waitlist.length > 0 && React.createElement(React.Fragment, null, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 6
      }
    }, "Waitlist (", a.waitlist.length, ")"), React.createElement("div", null, a.waitlist.map((s, y) => React.createElement(ge, {
      key: s,
      pid: s,
      right: React.createElement(Badge, {
        color: C.orange,
        small: !0
      }, "#", y + 1)
    })))))), a.schedule && React.createElement("div", { style: { marginTop: 16 } }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: C.textDim,
        textTransform: "uppercase",
        letterSpacing: 1,
        marginBottom: 8
      }
    }, "Match Schedule \u2014 ", prettyDate(t)), a.schedule.blocks.map((s, y) => React.createElement("div", {
      key: s.id,
      style: { marginBottom: 14 }
    }, React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 8
      }
    }, React.createElement(Badge, { color: C.teal }, React.createElement(Ic, {
      t: "clock",
      s: 10
    }), " ", s.label), a.schedule.blocks.length > 1 && React.createElement("span", {
      style: {
        fontSize: 9,
        color: C.textDim
      }
    }, "Courts reshuffled this hour")), React.createElement("div", {
      style: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))",
        gap: 10
      }
    }, s.courts.map((F, Q) => React.createElement("div", {
      key: Q,
      style: {
        background: C.card,
        borderRadius: 12,
        border: `1px solid ${ C.border }`,
        padding: 12
      }
    }, React.createElement("div", {
      style: {
        fontSize: 10,
        fontWeight: 800,
        color: C.lime,
        marginBottom: 8,
        textTransform: "uppercase",
        letterSpacing: 1
      }
    }, "Court ", F.court), F.games.map((te, pe) => {
      const h = te.a.map(N => ee(N)?.firstName || "?").join(" & "), B = te.b.map(N => ee(N)?.firstName || "?").join(" & "), b = z && !te.played;
      return React.createElement("div", {
        key: te.id,
        onClick: () => {
          b && (ae({
            bi: y,
            ci: Q,
            gi: pe,
            g: te,
            aN: h,
            bN: B
          }), P(""), Y(""));
        },
        style: {
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "7px 9px",
          background: C.cardAlt,
          borderRadius: 8,
          marginBottom: 4,
          border: `1px solid ${ te.played ? C.lime + "33" : "transparent" }`,
          cursor: b ? "pointer" : "default"
        }
      }, React.createElement("div", {
        style: {
          flex: 1,
          minWidth: 0
        }
      }, React.createElement("div", {
        style: {
          fontSize: 10,
          fontWeight: te.winner === "a" ? 700 : 500,
          color: te.winner === "a" ? C.lime : C.text
        }
      }, h), React.createElement("div", {
        style: {
          fontSize: 10,
          fontWeight: te.winner === "b" ? 700 : 500,
          color: te.winner === "b" ? C.lime : C.text
        }
      }, B)), te.played ? React.createElement("div", { style: { textAlign: "right" } }, React.createElement("div", {
        style: {
          fontSize: 12,
          fontWeight: 800,
          color: te.winner === "a" ? C.lime : C.textDim
        }
      }, te.scoreA), React.createElement("div", {
        style: {
          fontSize: 12,
          fontWeight: 800,
          color: te.winner === "b" ? C.lime : C.textDim
        }
      }, te.scoreB)) : z ? React.createElement(Badge, {
        color: C.orange,
        small: !0
      }, "Score") : React.createElement(Badge, {
        color: C.textDim,
        small: !0
      }, "\u2014"));
    })))), s.benched.length > 0 && React.createElement("div", {
      style: {
        fontSize: 9,
        color: C.textDim,
        marginTop: 6
      }
    }, "Sitting out: ", s.benched.map(F => ee(F)?.firstName).join(", "))))), I && React.createElement(Modal, {
      onClose: () => {
        ae(null), P(""), Y("");
      }
    }, React.createElement("div", { style: { padding: 24 } }, React.createElement("h3", {
      style: {
        fontSize: 15,
        fontWeight: 800,
        color: C.text,
        margin: "0 0 4px",
        textAlign: "center"
      }
    }, "Enter Score"), React.createElement("p", {
      style: {
        fontSize: 10,
        color: C.textDim,
        textAlign: "center",
        margin: "0 0 16px"
      }
    }, "Updates GSR for all players"), React.createElement("div", {
      style: {
        display: "flex",
        alignItems: "center",
        gap: 12
      }
    }, React.createElement("div", {
      style: {
        flex: 1,
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text,
        marginBottom: 6,
        minHeight: 28
      }
    }, I.aN), React.createElement("input", {
      value: w,
      onChange: s => P(s.target.value),
      type: "number",
      min: "0",
      style: {
        width: 56,
        padding: "10px 0",
        textAlign: "center",
        background: C.card,
        border: `2px solid ${ C.border }`,
        borderRadius: 12,
        color: C.text,
        fontSize: 24,
        fontWeight: 800,
        outline: "none",
        fontFamily: "inherit"
      }
    })), React.createElement("div", {
      style: {
        fontSize: 13,
        fontWeight: 800,
        color: C.textDim
      }
    }, "vs"), React.createElement("div", {
      style: {
        flex: 1,
        textAlign: "center"
      }
    }, React.createElement("div", {
      style: {
        fontSize: 11,
        fontWeight: 600,
        color: C.text,
        marginBottom: 6,
        minHeight: 28
      }
    }, I.bN), React.createElement("input", {
      value: ne,
      onChange: s => Y(s.target.value),
      type: "number",
      min: "0",
      style: {
        width: 56,
        padding: "10px 0",
        textAlign: "center",
        background: C.card,
        border: `2px solid ${ C.border }`,
        borderRadius: 12,
        color: C.text,
        fontSize: 24,
        fontWeight: 800,
        outline: "none",
        fontFamily: "inherit"
      }
    }))), React.createElement("div", {
      style: {
        display: "flex",
        gap: 8,
        marginTop: 16
      }
    }, React.createElement(Btn, {
      full: !0,
      onClick: () => {
        ae(null), P(""), Y("");
      }
    }, "Cancel"), React.createElement(Btn, {
      primary: !0,
      full: !0,
      color: C.lime,
      onClick: Se
    }, "Save Score")))));
  }
  return React.createElement("div", null, React.createElement("div", {
    style: {
      display: "flex",
      justifyContent: "space-between",
      alignItems: "center",
      marginBottom: 14
    }
  }, React.createElement("div", null, React.createElement("h2", {
    style: {
      fontSize: 18,
      fontWeight: 800,
      color: C.text,
      margin: 0
    }
  }, "Community Play"), React.createElement("p", {
    style: {
      fontSize: 11,
      color: C.textDim,
      margin: "2px 0 0"
    }
  }, "Recurring open-play games near you")), React.createElement(Btn, {
    small: !0,
    primary: !0,
    color: C.lime,
    onClick: () => n("create")
  }, React.createElement(Ic, {
    t: "plus",
    s: 13
  }), " Host")), React.createElement("div", {
    style: {
      display: "flex",
      flexDirection: "column",
      gap: 10
    }
  }, e.length === 0 && React.createElement("div", {
    style: {
      textAlign: "center",
      padding: "40px 20px",
      color: C.textDim
    }
  }, React.createElement("div", {
    style: {
      fontSize: 32,
      opacity: 0.3
    }
  }, "\u26A1"), React.createElement("p", { style: { fontSize: 12 } }, "No community games yet \u2014 host one!")), React.createElement(VenuesSection, {
    players: m,
    currentUser: p
  }), e.map(o => {
    const t = genSessionDates(o.freq, o.days, 1)[0], a = t ? {
        ...emptySession(),
        ...o.sessions[t] || {}
      } : emptySession(), W = o.courts * o.perCourt;
    return React.createElement("div", {
      key: o.id,
      onClick: () => {
        S(o.id), M(genSessionDates(o.freq, o.days, 6)[0]), g(p && o.organiserId === p.id), u("requests"), n("detail");
      },
      style: {
        background: C.card,
        borderRadius: 14,
        border: `1px solid ${ C.border }`,
        padding: 14,
        cursor: "pointer",
        borderLeft: `3px solid ${ C.lime }`
      }
    }, React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "flex-start",
        gap: 8
      }
    }, React.createElement("div", {
      style: {
        flex: 1,
        minWidth: 0
      }
    }, React.createElement("div", {
      style: {
        fontSize: 14,
        fontWeight: 700,
        color: C.text
      }
    }, o.name), React.createElement("div", {
      style: {
        fontSize: 10,
        color: C.textMuted,
        marginTop: 2,
        display: "flex",
        alignItems: "center",
        gap: 4
      }
    }, React.createElement(Ic, {
      t: "map",
      s: 10
    }), " ", o.venue, " \xB7 ", o.area)), React.createElement(Badge, {
      color: C.gold,
      small: !0
    }, fp(o.price))), React.createElement("div", {
      style: {
        display: "flex",
        flexWrap: "wrap",
        gap: 5,
        marginTop: 10
      }
    }, React.createElement(Badge, {
      color: C.teal,
      small: !0
    }, React.createElement(Ic, {
      t: "repeat",
      s: 9
    }), " ", o.freq === "daily" ? "Daily" : o.days.map(q => WEEKDAYS[q]).join(", ")), React.createElement(Badge, {
      color: C.blue,
      small: !0
    }, React.createElement(Ic, {
      t: "clock",
      s: 9
    }), " ", o.startTime, "\u2013", o.endTime), React.createElement(Badge, {
      color: C.lime,
      small: !0
    }, W, " spots"), hasRestrictions(o) && React.createElement(Badge, {
      color: C.red,
      small: !0
    }, "Restricted"), o.accessType === "restricted" && React.createElement(Badge, {
      color: C.purple,
      small: !0
    }, "Invite-only"), o.rotation === "slots" && React.createElement(Badge, {
      color: C.blue,
      small: !0
    }, "30-min slots"), o.rotation === "kotc" && React.createElement(Badge, {
      color: C.gold,
      small: !0
    }, "\uD83D\uDC51 KotC"), o.rotation === "ladder" && React.createElement(Badge, {
      color: C.purple,
      small: !0
    }, "\uD83E\uDE9C Ladder")), React.createElement("div", {
      style: {
        display: "flex",
        justifyContent: "space-between",
        alignItems: "center",
        marginTop: 10,
        paddingTop: 10,
        borderTop: `1px solid ${ C.border }`
      }
    }, React.createElement("span", {
      style: {
        fontSize: 10,
        color: C.textDim
      }
    }, "Next: ", React.createElement("b", { style: { color: C.text } }, t ? prettyDate(t) : "\u2014")), React.createElement("span", {
      style: {
        fontSize: 10,
        fontWeight: 700,
        color: a.confirmed.length >= W ? C.red : C.lime
      }
    }, a.confirmed.length, "/", W, " confirmed", a.waitlist.length ? ` \xB7 ${ a.waitlist.length } waiting` : "")));
  })));
};
/* ---------- print pack ----------
   Laid out after the OSL 2026 sheets.

   ONE PAGE PER GROUP, carrying everything an organiser needs at the court:
   the fixtures, the standings table, and the score-margin grid. Printed blank
   before play, the scores get written on by hand and the two grids below give
   somewhere to work them out — which is the whole reason paper still beats a
   phone on a windy court.

   Two things I had wrong before and OSL gets right: matches are ROWS IN ONE
   TABLE, not a table each, and the explanatory caption appears ONCE under the
   table rather than repeating under every match.

   Built into a hidden #printArea then window.print(), never window.open —
   popups are blocked on the phones organisers actually carry. */
const printEsc = s => String(s == null ? "" : s).replace(/[&<>]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));

const printHead = (tourney, title, sub) => {
  const sp = sportOf(tourney.sport);
  const meta = (sub || [
    tourney.name,
    tourney.startTime,
    tourney.numCourts ? `${ tourney.numCourts } courts` : null
  ].filter(Boolean).join(" · ")).toUpperCase();
  const logo = brandLogo();
  return `<div class="brandbar">
      ${ logo ? `<img class="blogo" src="${ logo }" alt="RISE Sports">` : "" }
      <div class="btitle">
        <div class="sport">${ printEsc(sp.name) }${ title ? ` &mdash; ${ printEsc(title) }` : "" }</div>
        <div class="meta">${ printEsc(meta) }</div>
      </div>
      <div class="printed">Printed ${ printEsc(new Date().toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }).replace(",", " ·")) }</div>
    </div>`;
};

/* Matches as rows in ONE table. Court, then the two teams either side of their
   score boxes, winner in bold. Blank boxes when printing before play. */
const fixtureTable = (matches, withData) => {
  if (!matches.length) return "";
  return `<table class="fx">
      <tr><th class="c" style="width:42px">Court</th><th>Team</th>
          <th class="c" style="width:50px">Score</th><th class="c" style="width:50px">Score</th><th>Team</th></tr>
      ${ matches.map(mt => {
        const a = mt.teamA || mt.p1, b = mt.teamB || mt.p2;
        const sa = mt.scoreA != null ? mt.scoreA : mt.s1, sb = mt.scoreB != null ? mt.scoreB : mt.s2;
        const played = withData && mt.played && sa != null && sb != null;
        return `<tr>
          <td class="c ct">${ printEsc(mt.court || "") }</td>
          <td class="${ played && sa > sb ? "win" : "" }">${ printEsc(teamName(a) || "TBD") }</td>
          <td class="c sbox">${ played ? printEsc(sa) : "" }</td>
          <td class="c sbox">${ played ? printEsc(sb) : "" }</td>
          <td class="${ played && sb > sa ? "win" : "" }">${ printEsc(teamName(b) || "TBD") }</td>
        </tr>`;
      }).join("") }
    </table>
    <div class="cap">Left score box belongs to the team on the left, right box to the team on the right. The higher score wins &mdash; no separate winner column.</div>`;
};

/* The score-margin grid. Worth the space because the row total IS the point
   difference that separates teams level on wins — and printed blank it is
   somewhere to work the table out by hand. */
const marginGrid = (group, withData) => {
  const teams = group.teams || [];
  if (teams.length < 2) return "";
  const played = (group.matches || []).filter(m => m.played);
  const marginOf = (row, col) => {
    const m = played.find(x =>
      (x.teamA.id === row.id && x.teamB.id === col.id) ||
      (x.teamA.id === col.id && x.teamB.id === row.id));
    if (!m || !withData) return null;
    return m.teamA.id === row.id ? m.scoreA - m.scoreB : m.scoreB - m.scoreA;
  };
  const rows = teams.map(t => {
    const cells = teams.map(o => (o.id === t.id ? null : marginOf(t, o)));
    return { t, cells, wins: cells.filter(v => v != null && v > 0).length,
             diff: cells.reduce((s2, v) => s2 + (v || 0), 0) };
  });
  const ranked = [...rows].sort((a, b) => b.wins - a.wins || b.diff - a.diff);
  const needsH2H = r => ranked.some(o => o !== r && o.wins === r.wins && o.diff === r.diff);

  return `<div class="sub">Score margin</div>
    <table class="mg">
      <tr><th style="width:20%">Group ${ printEsc(group.label) }</th>
        ${ teams.map(t => `<th class="c">${ printEsc(teamName(t)) }</th>`).join("") }
        <th class="c" style="width:40px">Wins</th><th class="c" style="width:40px">Diff</th>
        <th class="c" style="width:38px">Rank</th><th class="c" style="width:34px">H2H</th></tr>
      ${ rows.map(r => `<tr>
        <td class="nm">${ printEsc(teamName(r.t)) }</td>
        ${ /* the diagonal is found by POSITION — an unplayed match is null too */
           r.cells.map((v, ci) => teams[ci].id === r.t.id
            ? `<td class="self"></td>`
            : `<td class="c">${ v == null ? "" : (v > 0 ? "+" : "") + v }</td>`).join("") }
        <td class="c b">${ withData ? r.wins : "" }</td>
        <td class="c b">${ withData ? (r.diff > 0 ? "+" : "") + r.diff : "" }</td>
        <td class="c b">${ withData ? ranked.indexOf(r) + 1 : "" }</td>
        <td class="c">${ withData && needsH2H(r) ? "&#9679;" : "" }</td></tr>`).join("") }
    </table>
    <div class="cap">Row team's margin against the column team. A 25&ndash;20 win is <b>+5</b> for the winner and <b>&minus;5</b> for the loser. Count the pluses for wins; the row total is the points difference, which separates teams level on wins &mdash; head-to-head only comes into it if the difference is level too.</div>`;
};

const rulesLine = tourney => {
  const r = resolveRules(tourney.sport, { target: tourney.pointsToWin, ...tourney.scoring || {} });
  if (!r) return "";
  return `<div class="rules">One game to ${ r.target }.` +
    (r.sideOut ? " Service points — only the serving side scores." : " Rally scoring — every rally is a point.") +
    (r.winBy > 1 ? ` Won by ${ r.winBy } clear points.` : "") +
    (r.cap ? ` Golden point at ${ r.golden }–${ r.golden }, so no score passes ${ r.cap }.` : "") +
    (r.switchAt ? ` Ends change at ${ r.switchAt }.` : "") + `</div>`;
};

/* ONE PAGE PER GROUP: fixtures, then the margin grid.
   No standings table — the margin grid already carries wins, difference and
   rank, and it is the grid an organiser fills in by hand, so printing both was
   asking for two sets of numbers to disagree with each other. */
const groupSheet = (tourney, group, withData) =>
  `<div class="psheet">${
    printHead(tourney, `Group ${ group.label }`,
      [tourney.name, group.catName, group.court ? `Court ${ group.court }` : null].filter(Boolean).join(" · "))
  }<div class="sub">Fixtures</div>${
    fixtureTable(group.matches || [], withData)
  }${ marginGrid(group, withData) }${ rulesLine(tourney) }</div>`;

const bracketSheet = (tourney, withData) => {
  const kb = tourney.knockoutBrackets || {};
  const keys = Object.keys(kb).filter(k => (kb[k] || []).length);
  if (!keys.length) return "";
  let h = `<div class="psheet">${ printHead(tourney, "Knockout") }`;
  keys.forEach(k => {
    const cat = (tourney.categories || [])[k];
    const rounds = kb[k] || [];
    h += `<div class="grp">${ printEsc(cat ? cat.name : "Category " + k) }</div>`;
    rounds.forEach((round, ri) => {
      const names = ["Final", "Semi-finals", "Quarter-finals"];
      const label = names[rounds.length - 1 - ri] || `Round ${ ri + 1 }`;
      h += `<div class="sub">${ printEsc(label) }</div>` + fixtureTable(round, withData);
    });
  });
  return h + rulesLine(tourney) + `</div>`;
};

/* only: "fixtures" | "standings" | "bracket" | undefined for the whole book */
const printPack = (tourney, withData, only) => {
  const area = document.getElementById("printArea");
  if (!area) return;
  const groups = tourney.groups || [];
  let html = "";
  if (only === "bracket") html = bracketSheet(tourney, withData);
  else if (only === "standings") {
    /* standings-only: every group on one sheet, which is what gets pinned up */
    html = `<div class="psheet">${ printHead(tourney, "Score margin") }` +
      groups.map(g => marginGrid(g, withData)).join("") + rulesLine(tourney) + `</div>`;
  } else {
    html = groups.map(g => groupSheet(tourney, g, withData)).join("");
    if (only !== "fixtures") html += bracketSheet(tourney, withData);
  }
  if (!html) { alert("Nothing to print yet — create some groups first."); return; }
  area.innerHTML = html;
  window.print();
};

/* ---------- referee console ----------
   Live rally-by-rally scoring. Everything shown is derived from the match's
   rally log by replayRallies(), so Undo is just "drop the last entry" and the
   display can never disagree with the court.

   The layout follows Format/pickleboss-35split 12.html:965-1065, which was
   built for and used at real events. The important idea there is that THE
   COURT IS THE INPUT: a referee standing courtside taps the half belonging to
   the side that won the rally, rather than hunting for a labelled button. The
   service boxes show who is standing where, the ball marks the server, and the
   +/- row underneath is the fallback for corrections.

   "Flip my view" matters more than it looks: the referee may be standing at
   either end, and a court drawn the wrong way round guarantees mis-taps. */

const PAUSE_REASONS = ["timeout", "injury", "weather", "other"];

/* One service box. Tapping it scores for that side, exactly like tapping the
   half — the whole court surface is live. */
/* Real pickleball court colours: a blue playing surface with the rust-coloured
   non-volley zone ("kitchen") either side of the net. A referee glancing down
   should recognise the court, not read a diagram. */
const COURT = { blue: "#31637f", blueLit: "#3f7ba0", kitchen: "#b4571f", line: "rgba(255,255,255,.55)", slot: "#ffd24a" };

const CourtBox = ({ team, posSide, st, names, over, onScore }) => {
  const idx = st.pos[team][posSide === "R" ? 0 : 1];
  const serving = st.serving === team && st.servePos === posSide && !over;
  return React.createElement("button", {
    onClick: over ? undefined : e => { e.stopPropagation(); onScore(team); },
    disabled: over,
    style: {
      flex: 1, minHeight: 84, display: "flex", flexDirection: "column",
      justifyContent: "center", gap: 3, padding: "8px 10px", cursor: over ? "default" : "pointer",
      border: "none", borderBottom: `1px solid ${ COURT.line }`,
      background: serving ? COURT.blueLit : COURT.blue,
      fontFamily: "inherit", textAlign: "left", opacity: over ? .65 : 1,
      WebkitTapHighlightColor: "transparent", touchAction: "manipulation"
    }
  },
    React.createElement("div", { style: { fontSize: 8.5, fontWeight: 800, letterSpacing: .1, textTransform: "uppercase", color: "rgba(255,255,255,.7)" } },
      posSide === "R" ? "Right / even" : "Left / odd"),
    React.createElement("div", { style: { display: "flex", alignItems: "center", gap: 5 } },
      serving && React.createElement("span", { style: { fontSize: 13 } }, "🎾"),
      React.createElement("span", { style: { fontSize: 9.5, fontWeight: 800, color: COURT.slot } }, team.toUpperCase() + (idx + 1)),
      React.createElement("span", { style: { fontSize: 13, fontWeight: 700, color: "#fff", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
        (names || [])[idx] || "—")),
    serving && React.createElement("div", { style: { fontSize: 8.5, fontWeight: 800, letterSpacing: .06, textTransform: "uppercase", color: COURT.slot } },
      `serving from the ${ posSide === "R" ? "right" : "left" }`));
};

const RefConsole = ({ match, rules, title, subtitle, teamA, teamB, namesA, namesB, onChange, onFinish, onClose }) => {
  const [, forceTick] = useState(0);
  const st = replayRallies(match, rules);
  const timing = match.timing || emptyTiming();
  const paused = timing.pauseMono != null;
  const fresh = !(match.log || []).length;
  const lead = Math.max(st.a, st.b);
  const ends = rules.switchAt ? lead >= rules.switchAt : false;

  /* Which team is drawn on the left. Ends change flips it, and the referee can
     flip the whole view again to match the end they are standing at. */
  let leftK = (match.startLeft === "b") ? "b" : "a";
  if (ends) leftK = leftK === "a" ? "b" : "a";
  if (match.invert) leftK = leftK === "a" ? "b" : "a";
  const rightK = leftK === "a" ? "b" : "a";

  const nameOf = k => (k === "a" ? teamA : teamB);
  const namesOf = k => (k === "a" ? namesA : namesB);
  const scoreOf = k => (k === "a" ? st.a : st.b);
  const colourOf = k => (k === "a" ? C.teal : C.purple);

  useEffect(() => {
    if (!timing.startedAt || timing.endedAt || paused) return;
    const h = setInterval(() => forceTick(n => n + 1), 1000);
    return () => clearInterval(h);
  }, [timing.startedAt, timing.endedAt, paused]);

  /* Keep the screen awake while refereeing, where the browser allows it. */
  useEffect(() => {
    let lock = null, dead = false;
    navigator.wakeLock && navigator.wakeLock.request &&
      navigator.wakeLock.request("screen").then(l => { dead ? l.release() : (lock = l); }).catch(() => {});
    return () => { dead = true; lock && lock.release().catch(() => {}); };
  }, []);

  const commit = next => onChange({ ...match, ...next });
  const applyLog = log => {
    const after = replayRallies({ ...match, log }, rules);
    let t = { ...timing };
    if (log.length && !t.startedAt) t = timerStart(t);
    if (after.over && !t.endedAt) t = timerStop(t);
    /* Reopening a finished match restarts the clock, or it would sit frozen
       while play carries on. */
    if (!after.over && t.endedAt) { t.endedAt = null; t.playingMs = 0; }
    commit({ log, sa: after.a, sb: after.b, timing: t });
  };
  const point = team => { if (!st.over) applyLog((match.log || []).concat([team])); };
  const undo = () => { if ((match.log || []).length) applyLog(match.log.slice(0, -1)); };
  /* Walk back to the last rally that gave this side a point — the referee
     thinks "take one off them", not "undo the Nth rally". */
  const minus = team => {
    const log = (match.log || []).slice();
    for (let i = log.length; i > 0; i--) {
      const before = replayRallies({ ...match, log: log.slice(0, i - 1) }, rules);
      const after = replayRallies({ ...match, log: log.slice(0, i) }, rules);
      if (after[team] > before[team]) { applyLog(log.slice(0, i - 1)); return; }
    }
  };

  const scoreCell = k => React.createElement("div", {
    style: { flex: 1, textAlign: k === leftK ? "left" : "right", minWidth: 0 }
  },
    React.createElement("div", { style: { height: 3, borderRadius: 2, background: colourOf(k), marginBottom: 6 } }),
    React.createElement("div", { style: { fontSize: 11, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, nameOf(k)),
    React.createElement("div", { style: { fontSize: 46, fontWeight: 900, lineHeight: 1.05, color: colourOf(k), fontVariantNumeric: "tabular-nums" } }, scoreOf(k)));

  const setupRow = (label, children, hint) => React.createElement("div", {
    style: { display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: "6px 0", borderTop: `1px solid ${ C.border }` }
  },
    React.createElement("span", { style: { fontSize: 9, fontWeight: 800, letterSpacing: .09, textTransform: "uppercase", color: C.textDim, minWidth: 96 } }, label),
    children,
    hint && React.createElement("span", { style: { fontSize: 10, color: C.textDim } }, hint));

  const smallBtn = (label, onClick, active) => React.createElement("button", {
    key: label, onClick,
    style: {
      minHeight: 36, padding: "0 10px", borderRadius: 8, cursor: "pointer", fontFamily: "inherit",
      fontSize: 11.5, fontWeight: 700,
      border: `1px solid ${ active ? C.lime : C.border }`,
      background: active ? C.lime : C.card, color: active ? "#fff" : C.text
    }
  }, label);

  return React.createElement("div", {
    style: {
      position: "fixed", inset: 0, zIndex: 300, background: C.bg, display: "flex", flexDirection: "column",
      paddingTop: "env(safe-area-inset-top, 0px)", paddingBottom: "env(safe-area-inset-bottom, 0px)"
    }
  },
    React.createElement("div", {
      style: { display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${ C.border }`, background: C.surface, width: "100%", maxWidth: 560, margin: "0 auto", boxSizing: "border-box" }
    },
      React.createElement("button", {
        onClick: onClose,
        style: { minWidth: 44, minHeight: 44, border: "none", background: "transparent", color: C.textDim, cursor: "pointer", fontFamily: "inherit", fontSize: 18 }
      }, "✕"),
      React.createElement("div", { style: { flex: 1, minWidth: 0 } },
        React.createElement("div", { style: { fontSize: 13, fontWeight: 800, color: C.text, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" } }, title || "Referee"),
        React.createElement("div", { style: { fontSize: 9.5, color: C.textDim } },
          [
            subtitle,
            rules.sideOut ? "side-out" : "rally scoring",
            `to ${ rules.target }`,
            rules.winBy > 1 ? `win by ${ rules.winBy }` : "sudden death",
            rules.cap ? `golden point ${ rules.cap }–${ rules.golden }` : null
          ].filter(Boolean).join(" \xB7 "))),
      React.createElement("div", {
        style: { fontSize: 15, fontWeight: 800, color: paused ? C.orange : C.textDim, fontVariantNumeric: "tabular-nums", minWidth: 50, textAlign: "right" }
      }, fmtClock(timerElapsed(timing)))),

    /* Capped width: on a laptop the court and the score strip would otherwise
       stretch across the whole screen, which reads as empty and puts the two
       tap targets an arm's width apart. A referee holds a phone; this keeps the
       same proportions on a desktop. */
    React.createElement("div", { style: { flex: 1, overflowY: "auto", padding: 12, width: "100%", maxWidth: 560, margin: "0 auto" } },
      st.over && React.createElement("div", {
        style: { background: C.lime, color: "#fff", borderRadius: 10, padding: "10px 12px", marginBottom: 10, fontWeight: 800, fontSize: 13, textAlign: "center" }
      }, `🏆 ${ nameOf(st.winner) } win ${ lead }–${ Math.min(st.a, st.b) }` +
         (rules.cap && lead === rules.cap && Math.min(st.a, st.b) === rules.golden ? " on the golden point" : "")),
      !st.over && st.golden && React.createElement("div", {
        style: { background: C.gold, color: C.black, borderRadius: 10, padding: "8px 12px", marginBottom: 10, fontWeight: 800, fontSize: 12, textAlign: "center" }
      }, `⚡ Golden point — the next rally wins it at ${ rules.cap }–${ rules.golden }.`),
      !st.over && !st.golden && st.gamePoint.length > 0 && React.createElement("div", {
        style: { background: C.cardAlt, border: `1px solid ${ C.orange }`, color: C.orange, borderRadius: 10, padding: "7px 12px", marginBottom: 10, fontWeight: 800, fontSize: 12, textAlign: "center" }
      }, `Game point \xB7 ${ st.gamePoint.map(nameOf).join(" & ") }`),
      paused && React.createElement("div", {
        style: { background: C.orange, color: "#fff", borderRadius: 10, padding: "8px 12px", marginBottom: 10, fontWeight: 800, fontSize: 12, textAlign: "center" }
      }, `Paused — ${ timing.pauseReason }. The clock is stopped.`),

      /* score strip: teams laid out as they stand, serve indicator between */
      React.createElement("div", {
        style: { display: "flex", alignItems: "center", gap: 10, background: C.card, border: `1px solid ${ C.border }`, borderRadius: 12, padding: "10px 12px", marginBottom: 10 }
      }, scoreCell(leftK),
        React.createElement("div", { style: { textAlign: "center", minWidth: 46 } },
          React.createElement("div", { style: { fontSize: 15 } },
            st.over ? "—" : (st.serving === leftK ? "🎾◀" : "▶🎾")),
          React.createElement("div", { style: { fontSize: 8.5, fontWeight: 800, letterSpacing: .1, textTransform: "uppercase", color: C.textDim, marginTop: 2 } }, "Serve")),
        scoreCell(rightK)),

      /* pre-match setup, locked the moment the first rally is recorded */
      fresh && !st.over && React.createElement("div", {
        style: { background: C.card, border: `1px solid ${ C.border }`, borderRadius: 12, padding: "2px 12px 8px", marginBottom: 10 }
      },
        setupRow("Serves first", [leftK, rightK].map(k =>
          smallBtn((match.server || "a") === k ? "● " + nameOf(k) : nameOf(k), () => commit({ server: k }), (match.server || "a") === k)),
          "first server starts on the right"),
        setupRow("Court sides",
          React.createElement("span", { style: { fontSize: 11.5, fontWeight: 700, color: C.text } },
            `${ nameOf(leftK) } left \xB7 ${ nameOf(rightK) } right`),
          null),
        setupRow("", smallBtn("⇄ Swap", () => commit({ startLeft: (match.startLeft === "b") ? "a" : "b" })),
          "set this to match where the teams actually stand"),
        setupRow("Start positions", [leftK, rightK].map(k =>
          React.createElement("span", { key: k, style: { fontSize: 11, fontWeight: 700, color: C.text, display: "inline-flex", alignItems: "center", gap: 4 } },
            `${ nameOf(k) }: `,
            React.createElement("span", { style: { color: C.textDim } }, (namesOf(k) || [])[st.pos[k][0]] || "—", " right"),
            smallBtn("⇄", () => commit(k === "a" ? { posA: match.posA ? 0 : 1 } : { posB: match.posB ? 0 : 1 })))),
          "the pair chooses its starting server")),

      /* The court. Tapping a half scores for that side — the surface IS the
         input, which is what a referee standing courtside actually reaches for.
         Kitchen strips sit either side of the net, as on a real court. */
      React.createElement("div", {
        style: {
          display: "flex", marginBottom: 6, borderRadius: 12, overflow: "hidden",
          border: `3px solid ${ C.surface }`, boxShadow: `0 1px 3px rgba(0,0,0,.18)`
        }
      },
        [leftK, "net", rightK].map((k, i) => k === "net"
          ? React.createElement("div", {
              key: "net",
              style: { display: "flex", alignItems: "stretch", background: COURT.kitchen }
            },
              React.createElement("div", {
                style: {
                  width: 26, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 7, fontWeight: 800, letterSpacing: .18, textTransform: "uppercase",
                  color: "rgba(255,255,255,.45)", writingMode: "vertical-rl", transform: "rotate(180deg)"
                }
              }, "Kitchen"),
              React.createElement("div", { style: { width: 3, background: "#fff", opacity: .95 } }),
              React.createElement("div", {
                style: {
                  width: 26, display: "flex", alignItems: "center", justifyContent: "center",
                  fontSize: 7, fontWeight: 800, letterSpacing: .18, textTransform: "uppercase",
                  color: "rgba(255,255,255,.45)", writingMode: "vertical-rl"
                }
              }, "Kitchen"))
          : React.createElement("div", {
              key: k,
              onClick: st.over ? undefined : () => point(k),
              style: {
                flex: 1, display: "flex", flexDirection: "column",
                cursor: st.over ? "default" : "pointer", minWidth: 0,
                background: COURT.blue
              }
            },
              /* the box nearest the net is listed first on the left half */
              (i === 0 ? ["L", "R"] : ["R", "L"]).map(side2 =>
                React.createElement(CourtBox, {
                  key: side2, team: k, posSide: side2, st, names: namesOf(k),
                  over: st.over, onScore: point
                })),
              React.createElement("div", {
                style: {
                  fontSize: 8.5, fontWeight: 800, letterSpacing: .08, textTransform: "uppercase",
                  textAlign: "center", color: "rgba(255,255,255,.6)", padding: "5px 4px"
                }
              }, st.over ? "—" : `tap = +1 ${ nameOf(k) }`)))),

      React.createElement("div", {
        style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8, marginBottom: 10, flexWrap: "wrap" }
      },
        React.createElement("span", { style: { fontSize: 10, color: C.textDim } },
          ends ? `⇄ Ends changed at ${ rules.switchAt } — ${ nameOf(leftK) } now on the left` : ""),
        smallBtn(match.invert ? "⇄ View flipped" : "⇄ Flip my view", () => commit({ invert: !match.invert }), !!match.invert)),

      /* +/- fallback for corrections */
      React.createElement("div", { style: { display: "flex", flexDirection: "column", gap: 6, marginBottom: 10 } },
        [leftK, rightK].map(k => React.createElement("div", {
          key: k, style: { display: "flex", alignItems: "center", gap: 8 }
        },
          React.createElement("button", {
            onClick: () => minus(k), disabled: scoreOf(k) === 0,
            style: {
              width: 52, minHeight: 44, borderRadius: 9, fontFamily: "inherit", fontSize: 20, fontWeight: 800,
              cursor: scoreOf(k) ? "pointer" : "default", border: `1px solid ${ C.border }`,
              background: C.card, color: scoreOf(k) ? C.text : C.textDim
            }
          }, "−"),
          React.createElement("div", { style: { flex: 1, fontSize: 12, fontWeight: 700, color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, nameOf(k)),
          React.createElement("button", {
            onClick: () => point(k), disabled: st.over,
            style: {
              width: 52, minHeight: 44, borderRadius: 9, fontFamily: "inherit", fontSize: 20, fontWeight: 800,
              cursor: st.over ? "default" : "pointer", border: "none",
              background: st.over ? C.cardAlt : colourOf(k), color: "#fff"
            }
          }, "+")))),

      React.createElement("div", { style: { display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10 } },
        React.createElement("button", {
          onClick: undo, disabled: fresh,
          style: {
            flex: "1 1 120px", minHeight: 46, borderRadius: 10, border: `1px solid ${ C.border }`,
            background: C.card, color: fresh ? C.textDim : C.text, fontWeight: 700, fontSize: 13,
            cursor: fresh ? "default" : "pointer", fontFamily: "inherit"
          }
        }, "↶ Undo last rally"),
        React.createElement("button", {
          onClick: () => commit({ timing: paused ? timerResume(timing) : timerPause(timing, "timeout") }),
          disabled: !timing.startedAt || !!timing.endedAt,
          style: {
            flex: "1 1 100px", minHeight: 46, borderRadius: 10,
            border: `1px solid ${ paused ? C.orange : C.border }`,
            background: paused ? C.orange : C.card, color: paused ? "#fff" : C.text,
            fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit"
          }
        }, paused ? "Resume" : "Pause"),
        React.createElement("button", {
          onClick: () => { if (window.confirm("Clear this match back to 0–0?")) applyLog([]); },
          style: {
            flex: "1 1 90px", minHeight: 46, borderRadius: 10, border: `1px solid ${ C.red }`,
            background: C.card, color: C.red, fontWeight: 700, fontSize: 13, cursor: "pointer", fontFamily: "inherit"
          }
        }, "Clear"),
        onFinish && React.createElement("button", {
          onClick: () => onFinish(st), disabled: !st.rallies,
          style: {
            flex: "1 1 100%", minHeight: 48, borderRadius: 10, border: "none",
            background: st.over ? C.lime : C.cardAlt, color: st.over ? "#fff" : C.textDim,
            fontWeight: 800, fontSize: 14, cursor: st.rallies ? "pointer" : "default", fontFamily: "inherit"
          }
        }, st.over ? "Save & close" : "Save current score & close")),

      paused && React.createElement("div", { style: { display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10 } },
        PAUSE_REASONS.map(reason => smallBtn(reason,
          () => commit({ timing: { ...timing, pauseReason: reason } }), timing.pauseReason === reason))),

      React.createElement("div", {
        style: { background: C.card, border: `1px solid ${ C.border }`, borderRadius: 12, padding: 12 }
      },
        React.createElement("div", { style: { fontSize: 9, fontWeight: 800, letterSpacing: .1, textTransform: "uppercase", color: C.textDim, marginBottom: 6 } }, "Reading the court"),
        React.createElement("p", { style: { fontSize: 11, color: C.textDim, margin: 0, lineHeight: 1.5 } },
          rules.sideOut
            ? "Side-out scoring — only the serving side can score. Tap the half of the court belonging to the side that won the rally. If the receiving side wins, no point is scored and the serve moves on. The ball marks the server, who always serves from the right when their own score is even, so partners swap sides each time they score."
            : "Rally scoring — every rally is a point, whoever served. Tap the half of the court belonging to the side that won it. If the receiving side wins, the serve crosses with the point. The ball marks the server, who always serves from the right when their own score is even."),
        React.createElement("p", { style: { fontSize: 11, color: C.textDim, margin: "8px 0 0", lineHeight: 1.5 } },
          `Game to ${ rules.target }`,
          rules.winBy > 1 ? `, won by ${ rules.winBy } clear points` : ", sudden death",
          rules.cap ? `. The two-point rule stops at ${ rules.golden }: if both sides reach ${ rules.golden } the very next rally takes it, so no score can go past ${ rules.cap }.` : ".",
          ` ${ st.rallies } ${ st.rallies === 1 ? "rally" : "rallies" } recorded — ${ st.a }+${ st.b }=${ st.a + st.b }.`))));
};

function RiseSports() {
  const c = new URLSearchParams(window.location.search).get("view");
  if (c)
    return React.createElement("div", {
      style: {
        minHeight: "100vh",
        background: C.bg,
        fontFamily: "'Sora',sans-serif",
        color: C.text
      }
    }, React.createElement(PublicTournamentView, { tournamentId: c }));
  const [e, d] = useState("home"), [p, r] = useState(() => {
      try {
        const I = localStorage.getItem(lsKey("pl"));
        return I ? JSON.parse(I) : genPlayers();
      } catch {
        return genPlayers();
      }
    }), [l, n] = useState(() => {
      try {
        const I = localStorage.getItem(lsKey("u"));
        return I ? JSON.parse(I) : null;
      } catch {
        return null;
      }
    }), [R, S] = useState(null), [v, M] = useState(() => {
      try {
        const I = localStorage.getItem(lsKey("t"));
        return I ? JSON.parse(I) : [];
      } catch {
        return [];
      }
    }), [z, g] = useState(null), [f, u] = useState(() => {
      try {
        const I = localStorage.getItem(lsKey("c"));
        return I ? JSON.parse(I) : DEFAULT_CATS;
      } catch {
        return DEFAULT_CATS;
      }
    }), [k, G] = useState(() => {
      try {
        const I = localStorage.getItem(lsKey("r"));
        return I ? parseInt(I) : ROLES.PLAYER.level;
      } catch {
        return ROLES.PLAYER.level;
      }
    }), [O, K] = useState(() => {
      try {
        const I = localStorage.getItem(lsKey("cg"));
        return I ? JSON.parse(I) : initCommunityGames();
      } catch {
        return initCommunityGames();
      }
    });
  useEffect(() => {
    try {
      localStorage.setItem(lsKey("pl"), JSON.stringify(p));
    } catch {
    }
  }, [p]), useEffect(() => {
    try {
      localStorage.setItem(lsKey("u"), JSON.stringify(l));
    } catch {
    }
  }, [l]), useEffect(() => {
    try {
      localStorage.setItem(lsKey("t"), JSON.stringify(v));
    } catch {
    }
  }, [v]), useEffect(() => {
    try {
      localStorage.setItem(lsKey("c"), JSON.stringify(f));
    } catch {
    }
  }, [f]), useEffect(() => {
    try {
      localStorage.setItem(lsKey("r"), k.toString());
    } catch {
    }
  }, [k]), useEffect(() => {
    try {
      localStorage.setItem(lsKey("cg"), JSON.stringify(O));
    } catch {
    }
  }, [O]), useEffect(() => {
    hideLoading();
  }, []);
  const J = useMemo(() => [...p].sort((I, ae) => ae.bestRating - I.bestRating).slice(0, 5), [p]), D = [
      {
        id: "home",
        l: "Home",
        i: "grid"
      },
      {
        id: "leaderboard",
        l: "Ratings",
        i: "award"
      },
      {
        id: "create",
        l: "Tournament",
        i: "plus"
      },
      {
        id: "tournament",
        l: "Events",
        i: "trophy"
      },
      {
        id: "community",
        l: "Play",
        i: "calendar"
      },
      {
        id: "register",
        l: "Join",
        i: "user"
      }
    ];
  return k >= ROLES.ADMIN.level && D.push({
    id: "admin",
    l: "Admin",
    i: "shield"
  }), React.createElement("div", {
    style: {
      minHeight: "100vh",
      background: C.bg,
      fontFamily: "'Sora',sans-serif",
      color: C.text,
      paddingLeft: "env(safe-area-inset-left, 0px)",
      paddingRight: "env(safe-area-inset-right, 0px)"
    }
  }, React.createElement("div", {
    style: {
      background: C.surface,
      borderBottom: `1px solid ${ C.border }`,
      padding: "10px 16px",
      position: "sticky",
      top: 0,
      zIndex: 100
    }
  }, React.createElement("div", {
    style: {
      maxWidth: 860,
      margin: "0 auto",
      display: "flex",
      alignItems: "center",
      justifyContent: "space-between"
    }
  }, React.createElement("div", {
    style: {
      display: "flex",
      alignItems: "center",
      gap: 8
    }
  }, brandLogo() ? React.createElement("img", {
    src: brandLogo(),
    alt: "RISE Sports",
    style: {
      height: 26,
      width: "auto",
      display: "block"
    }
  }) : React.createElement(React.Fragment, null, React.createElement("div", {
    style: {
      width: 30,
      height: 30,
      borderRadius: 8,
      background: `linear-gradient(135deg,${ C.lime },${ C.teal })`,
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      fontSize: 14
    }
  }, "\u26A1"), React.createElement("h1", {
    style: {
      fontSize: 13,
      fontWeight: 800,
      color: C.text
    }
  }, "RISE Sports"))), l ? React.createElement("div", {
    onClick: () => {
      S(l.id), d("leaderboard");
    },
    style: {
      cursor: "pointer",
      display: "flex",
      alignItems: "center",
      gap: 5
    }
  }, React.createElement(Avi, {
    name: l.firstName,
    color: getTier(l.bestRating).color,
    size: 24,
    gender: l.gender,
    imageUrl: l.avatarUrl
  }), React.createElement("div", {
    style: {
      fontSize: 10,
      fontWeight: 700,
      color: C.lime
    }
  }, l.bestRating)) : React.createElement(Badge, { color: C.lime }, "Mumbai"))), React.createElement("div", {
    style: {
      maxWidth: 860,
      margin: "0 auto",
      padding: `14px 14px calc(90px + env(safe-area-inset-bottom, 0px))`
    }
  }, e === "home" && React.createElement(HomeTab, {
    players: p,
    tournaments: v,
    currentUser: l,
    top5: J,
    setSelectedPlayer: S,
    setTab: d,
    userRole: k,
    setUserRole: G,
    setActiveTourney: g
  }), e === "create" && React.createElement(CreateTab, {
    players: p,
    setPlayers: r,
    tournaments: v,
    setTournaments: M,
    activeTourney: z,
    setActiveTourney: g,
    categories: f,
    setCategories: u,
    currentUser: l,
    setTab: d
  }), e === "tourney" && React.createElement(TourneyTab, {
    activeTourney: z,
    tournaments: v,
    setTournaments: M,
    players: p,
    setPlayers: r,
    setTab: d,
    setActiveTourney: g
  }), e === "tournament" && React.createElement(TournamentListTab, {
    tournaments: v,
    setActiveTourney: g,
    setTab: d,
    currentUser: l
  }), e === "community" && React.createElement(CommunityTab, {
    players: p,
    setPlayers: r,
    communityGames: O,
    setCommunityGames: K,
    currentUser: l,
    setTab: d
  }), e === "leaderboard" && React.createElement(LeaderboardTab, {
    players: p,
    currentUser: l,
    selectedPlayer: R,
    setSelectedPlayer: S,
    setPlayers: r
  }), e === "register" && React.createElement(RegisterTab, {
    players: p,
    setPlayers: r,
    currentUser: l,
    setCurrentUser: n,
    setTab: d
  }), e === "admin" && React.createElement(AdminTab, {
    players: p,
    setPlayers: r,
    categories: f,
    setTournaments: M,
    setCategories: u,
    setUserRole: G,
    setTab: d
  })), React.createElement("div", {
    style: {
      position: "fixed",
      bottom: 0,
      left: 0,
      right: 0,
      background: C.surface,
      borderTop: `1px solid ${ C.border }`,
      padding: "5px 0 env(safe-area-inset-bottom,5px)",
      zIndex: 100
    }
  }, React.createElement("div", {
    style: {
      maxWidth: 860,
      margin: "0 auto",
      display: "flex",
      justifyContent: "space-around"
    }
  }, D.map(I => React.createElement("button", {
    key: I.id,
    onClick: () => {
      d(I.id), I.id === "leaderboard" && S(null);
    },
    style: {
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: 2,
      padding: "4px 12px",
      minHeight: 44,
      minWidth: 44,
      border: "none",
      background: "transparent",
      color: e === I.id ? C.lime : C.textDim,
      cursor: "pointer",
      fontFamily: "inherit",
      WebkitTapHighlightColor: "transparent",
      touchAction: "manipulation"
    }
  }, React.createElement(Ic, {
    t: I.i,
    s: 18
  }), React.createElement("span", {
    style: {
      fontSize: 8,
      fontWeight: 700
    }
  }, I.l))))));
}
const root = ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(RiseSports, null)), console.log("\u26A1 RISE Sports v11 \u2013 multi-sport tournaments, ratings & community play");