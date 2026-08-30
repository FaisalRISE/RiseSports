/* Client-safe rally scorer — THE ONLY SCORING CODE ALLOWED IN THE BROWSER.
 *
 * ── Why this exists, and why it is not a hole in the "hard to copy" design ──
 *
 * `RefConsole` deliberately holds no scoring logic: it renders state the server
 * derived and calls Server Actions. That is the point of the rewrite, and
 * `lib/__tests__/bundle-leak.test.ts` fails the build if `replayRallies` ever
 * reaches a client bundle.
 *
 * Offline scoring needs the opposite. With no signal the browser must work out
 * the new score itself — a queue alone would leave a referee tapping the court
 * and seeing nothing change, which is worse than an error, because it looks
 * like the app is broken at the exact moment they cannot check.
 *
 * So the boundary moves, deliberately and narrowly:
 *
 *   SHIPPED (here)      point counting, serving side and service box for the
 *                       sideout / rally / alt2 models. This is the published
 *                       rulebook of pickleball, badminton and table tennis.
 *                       Anyone can read it on a governing body's website.
 *
 *   NEVER SHIPPED       OSL rotation and championship points, the per-format
 *                       tie-break chains, RISE Rating, the ledger settle-up,
 *                       PIN hashing. That is the part with value in it, and it
 *                       stays on the server.
 *
 * Two things keep this honest rather than a slow leak:
 *   1. `replayRallies` is untouched, stays server-only, and stays in the guard's
 *      MUST_NOT_SHIP list. This module has a different name so the guard keeps
 *      protecting the real engine.
 *   2. Rules arrive as DATA (`LiteRules`), never as code. `resolveRules`,
 *      `buildScoring` and the format presets stay on the server; it sends the
 *      already-resolved numbers.
 *
 * OSL matches are not scored here at all — `supportsLite` returns false for
 * them, and the console queues their rallies without showing a derived score.
 * Their rotation IS the intellectual property, and a wrong score shown
 * confidently is worse than an honest "3 rallies queued".
 *
 * This file must agree with replay.ts exactly. `replayLite.test.ts` proves it
 * differentially over thousands of generated logs; if you change one, that test
 * tells you immediately.
 */

export type Side = "a" | "b";
export type RallyLog = Side[];

/** The resolved rules, as plain data. Mirrors the server's `Rules` minus
 *  anything that would require shipping the resolver. */
export type LiteRules = {
  target: number;
  winBy: number;
  cap: number | null;
  golden: number | null;
  sideOut: boolean;
  serve: "sideout" | "rally" | "alt2" | "turns" | "games";
  perCourt: number;
};

export type LiteMatch = {
  log?: RallyLog | null;
  server?: Side | null;
  posA?: 0 | 1 | null;
  posB?: 0 | 1 | null;
};

export type Positions = { a: [number, number]; b: [number, number] };

export type LiteState = {
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

/** Whether the browser may derive this match's score at all. Formats with
 *  rotation rules of their own (OSL) are server-only by design. */
export const supportsLite = (rules: LiteRules | null, format?: string | null): boolean =>
  !!rules && format !== "osl" && (rules.serve === "sideout" || rules.serve === "rally" || rules.serve === "alt2");

const other = (t: Side): Side => (t === "a" ? "b" : "a");

export const liteOver = (a: number, b: number, r: LiteRules | null): boolean =>
  !!r &&
  (((a >= r.target || b >= r.target) && Math.abs(a - b) >= r.winBy) ||
    (r.cap != null && (a >= r.cap || b >= r.cap)));

export const liteGolden = (a: number, b: number, r: LiteRules | null): boolean =>
  !!r && r.golden != null && a >= r.golden && b >= r.golden && !liteOver(a, b, r);

export function liteGamePoint(a: number, b: number, r: LiteRules | null): Side[] {
  if (!r || liteOver(a, b, r)) return [];
  const out: Side[] = [];
  if (liteOver(a + 1, b, r)) out.push("a");
  if (liteOver(a, b + 1, r)) out.push("b");
  return out;
}

type Walk = { a: number; b: number; serving: Side; pos: Positions; who: number; serverNum: number };

function initWalk(m: LiteMatch): Walk {
  const first: Side = m?.server === "b" ? "b" : "a";
  const pos: Positions = {
    a: m?.posA === 1 ? [1, 0] : [0, 1],
    b: m?.posB === 1 ? [1, 0] : [0, 1],
  };
  /* The opening service turn has only one server, so it behaves as though the
     second server is already up: the first fault hands the serve straight over. */
  return { a: 0, b: 0, serving: first, pos, who: pos[first][0], serverNum: 2 };
}

function step(s: Walk, w: Side, r: LiteRules, first: Side): Walk {
  if (r.sideOut) {
    if (w === s.serving) {
      if (s.serving === "a") s.a++;
      else s.b++;
      s.pos[s.serving] = [s.pos[s.serving][1], s.pos[s.serving][0]];
    } else if (s.serverNum === 1 && r.perCourt > 2) {
      s.serverNum = 2;
      s.who = s.pos[s.serving][0] === s.who ? s.pos[s.serving][1] : s.pos[s.serving][0];
    } else {
      s.serving = w;
      s.serverNum = 1;
      s.who = s.pos[s.serving][(s.serving === "a" ? s.a : s.b) % 2 === 0 ? 0 : 1];
    }
    return s;
  }

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
    s.pos[s.serving] = [s.pos[s.serving][1], s.pos[s.serving][0]];
  } else {
    s.serving = w;
    s.who = s.pos[s.serving][(s.serving === "a" ? s.a : s.b) % 2 === 0 ? 0 : 1];
  }
  return s;
}

/** Replay a log in the browser. Same result as the server's `replayRallies`
 *  for every model `supportsLite` accepts — proven differentially in tests. */
export function replayLite(m: LiteMatch, r: LiteRules | null): LiteState {
  const log = m?.log ?? [];
  const first: Side = m?.server === "b" ? "b" : "a";
  const s = initWalk(m);
  if (r) for (const w of log) step(s, w, r, first);

  const over = liteOver(s.a, s.b, r);
  const gp = liteGamePoint(s.a, s.b, r);
  return {
    a: s.a,
    b: s.b,
    serving: s.serving,
    pos: s.pos,
    serverIdx: s.who,
    serverNum: s.serverNum,
    servePos: s.pos[s.serving][0] === s.who ? "R" : "L",
    rallies: log.length,
    over,
    winner: over ? (s.a > s.b ? "a" : "b") : null,
    golden: liteGolden(s.a, s.b, r),
    gamePoint: r?.sideOut ? gp.filter((t) => t === s.serving) : gp,
  };
}
