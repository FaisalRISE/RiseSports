/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Rally replay engine — ported from app.source.js:261-341.
 *
 * The rally log is the ONLY stored state: one entry per rally, "a" or "b" for
 * whoever won it. Score, serving side, court positions and service box are all
 * derived by replaying it. That is why undo is just "drop the last entry", why
 * the display can never disagree with the court, and why only the log has to
 * travel when devices sync.
 *
 * Ported change: the original rallyStats re-ran the whole replay once per rally
 * (O(n^2)). Here both replayRallies and rallyStats drive the same `step`
 * function, so a walk is O(n) and there is exactly one copy of the rules. */

import type { Rules } from "./rules";

export type Side = "a" | "b";
export type RallyLog = Side[];

export type MatchLike = {
  log?: RallyLog | null;
  /** Which side serves first. */
  server?: Side | null;
  /** 1 = the second-listed player starts on the right. */
  posA?: 0 | 1 | null;
  posB?: 0 | 1 | null;
};

/** pos[team] = [index of the player standing RIGHT, index standing LEFT] */
export type Positions = { a: [number, number]; b: [number, number] };

export type ReplayState = {
  a: number;
  b: number;
  serving: Side;
  pos: Positions;
  serverIdx: number;
  serverNum: number;
  servePos: "R" | "L";
  rallies: number;
  over: boolean;
  winner: Side | null;
  golden: boolean;
  gamePoint: Side[];
};

const other = (t: Side): Side => (t === "a" ? "b" : "a");

export const rallyOver = (a: number, b: number, r: Rules | null): boolean =>
  !!r &&
  (((a >= r.target || b >= r.target) && Math.abs(a - b) >= r.winBy) ||
    (r.cap != null && (a >= r.cap || b >= r.cap)));

/** Both sides one rally from the end with the win-by rule spent. */
export const rallyGolden = (a: number, b: number, r: Rules | null): boolean =>
  !!r && r.golden != null && a >= r.golden && b >= r.golden && !rallyOver(a, b, r);

/** Which sides would end the match by winning the next rally. Under side-out
 *  only the side holding serve can convert, so replayRallies filters by server. */
export function rallyGamePoint(a: number, b: number, r: Rules | null): Side[] {
  if (!r || rallyOver(a, b, r)) return [];
  const out: Side[] = [];
  if (rallyOver(a + 1, b, r)) out.push("a");
  if (rallyOver(a, b + 1, r)) out.push("b");
  return out;
}

type Walk = {
  a: number;
  b: number;
  serving: Side;
  pos: Positions;
  who: number;
  serverNum: number;
};

function initWalk(m: MatchLike): Walk {
  const first: Side = m?.server === "b" ? "b" : "a";
  const pos: Positions = {
    a: m?.posA === 1 ? [1, 0] : [0, 1],
    b: m?.posB === 1 ? [1, 0] : [0, 1],
  };
  return {
    a: 0,
    b: 0,
    serving: first,
    pos,
    who: pos[first][0],
    /* The opening service turn has only one server, so it behaves as though the
       second server is already up: the first fault hands the serve straight over. */
    serverNum: 2,
  };
}

/** Advance one rally, won by `w`. Mutates and returns `s`. */
function step(s: Walk, w: Side, r: Rules, first: Side): Walk {
  if (r.sideOut) {
    if (w === s.serving) {
      if (s.serving === "a") s.a++;
      else s.b++;
      s.pos[s.serving] = [s.pos[s.serving][1], s.pos[s.serving][0]]; // partners swap, same server
    } else if (s.serverNum === 1 && r.perCourt > 2) {
      s.serverNum = 2; // partner takes the second serve
      s.who = s.pos[s.serving][0] === s.who ? s.pos[s.serving][1] : s.pos[s.serving][0];
    } else {
      s.serving = w; // side-out
      s.serverNum = 1;
      s.who = s.pos[s.serving][(s.serving === "a" ? s.a : s.b) % 2 === 0 ? 0 : 1];
    }
    return s;
  }

  // rally scoring: every rally is a point
  const was = s.serving;
  if (w === "a") s.a++;
  else s.b++;

  if (r.serve === "alt2") {
    const total = s.a + s.b;
    const deuce = s.a >= r.target - 1 && s.b >= r.target - 1;
    const turns = deuce ? total : Math.floor(total / 2);
    s.serving = turns % 2 === 0 ? first : other(first);
    s.who = s.pos[s.serving][0];
    return s;
  }

  if (w === was) {
    s.pos[s.serving] = [s.pos[s.serving][1], s.pos[s.serving][0]]; // held serve: partners swap
  } else {
    s.serving = w;
    s.who = s.pos[s.serving][(s.serving === "a" ? s.a : s.b) % 2 === 0 ? 0 : 1];
  }
  return s;
}

function finish(s: Walk, r: Rules | null, rallies: number): ReplayState {
  const over = rallyOver(s.a, s.b, r);
  const gp = rallyGamePoint(s.a, s.b, r);
  return {
    a: s.a,
    b: s.b,
    serving: s.serving,
    pos: s.pos,
    serverIdx: s.who,
    serverNum: s.serverNum,
    servePos: s.pos[s.serving][0] === s.who ? "R" : "L",
    rallies,
    over,
    winner: over ? (s.a > s.b ? "a" : "b") : null,
    golden: rallyGolden(s.a, s.b, r),
    gamePoint: r?.sideOut ? gp.filter((t) => t === s.serving) : gp,
  };
}

/** Replay the log and return the full derived state. */
export function replayRallies(m: MatchLike, r: Rules | null): ReplayState {
  const log = m?.log ?? [];
  const first: Side = m?.server === "b" ? "b" : "a";
  const s = initWalk(m);
  if (r) for (const w of log) step(s, w, r, first);
  return finish(s, r, log.length);
}

/* ---------- per-side and per-player splits ---------- */

export type Split = {
  won: number;
  lost: number;
  serveWon: number;
  serveLost: number;
  clutchWon: number;
  clutchLost: number;
  serveHoldPct?: number | null;
};

export type RallyStats = {
  a: Split;
  b: Split;
  players: Record<string, Split>;
};

/** teamPlayers maps "a"/"b" to player ids in court order. Clutch counts rallies
 *  played once either side is within 3 of the target. */
export function rallyStats(
  m: MatchLike,
  r: Rules | null,
  teamPlayers?: Partial<Record<Side, string[]>> | null,
): RallyStats | null {
  const log = m?.log ?? [];
  if (!r) return null;

  const clutchFrom = Math.max(0, r.target - 3);
  const blank = (): Split => ({ won: 0, lost: 0, serveWon: 0, serveLost: 0, clutchWon: 0, clutchLost: 0 });
  const out: RallyStats = { a: blank(), b: blank(), players: {} };
  const touch = (id: string) => (out.players[id] ??= blank());

  const first: Side = m?.server === "b" ? "b" : "a";
  const s = initWalk(m);

  for (const w of log) {
    // state BEFORE this rally is what attributes it
    const servingBefore = s.serving;
    const serverIdxBefore = s.who;
    const clutch = s.a >= clutchFrom || s.b >= clutchFrom;
    const lose = other(w);

    out[w].won++;
    out[lose].lost++;
    if (clutch) {
      out[w].clutchWon++;
      out[lose].clutchLost++;
    }
    if (servingBefore === w) out[w].serveWon++;
    else out[servingBefore].serveLost++;

    for (const id of teamPlayers?.[w] ?? []) touch(id).won++;
    for (const id of teamPlayers?.[lose] ?? []) touch(id).lost++;

    const srv = teamPlayers?.[servingBefore];
    if (srv && srv[serverIdxBefore] !== undefined) {
      const sid = srv[serverIdxBefore];
      if (servingBefore === w) touch(sid).serveWon++;
      else touch(sid).serveLost++;
    }

    step(s, w, r, first);
  }

  const pct = (won: number, lost: number) => (won + lost ? Math.round((won / (won + lost)) * 100) : null);
  out.a.serveHoldPct = pct(out.a.serveWon, out.a.serveLost);
  out.b.serveHoldPct = pct(out.b.serveWon, out.b.serveLost);
  for (const p of Object.values(out.players)) p.serveHoldPct = pct(p.serveWon, p.serveLost);
  return out;
}
