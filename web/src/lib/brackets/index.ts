/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Knockout brackets — seeding, single elimination and double elimination.
 *
 * Ported from app.source.js:906-1032, keeping the algorithms and adding types.
 * The double-elimination routing in particular is subtle and was working in the
 * legacy app, so it is reproduced rather than reinvented.
 */

export type Entrant = { id: string; name: string; strength?: number };

export type BracketMatch = {
  id: string;
  matchNum: number;
  p1: Entrant | null;
  p2: Entrant | null;
  s1: number | null;
  s2: number | null;
  winner: string | null;
  played: boolean;
  isBye: boolean;
};

export type Round = BracketMatch[];

/**
 * Standard seeding order for a bracket of `n` slots: 1 plays n, 2 plays n-1,
 * and the halves are arranged so the top two seeds can only meet in the final.
 * seedOrder(8) -> [0,7,3,4,1,6,2,5]
 */
export function seedOrder(n: number): number[] {
  let r = [0];
  while (r.length < n) {
    const m = r.length * 2;
    r = r.flatMap((x) => [x, m - 1 - x]);
  }
  return r;
}

let counter = 0;
const uid = () => `bm${(++counter).toString(36)}${Date.now().toString(36)}`;

const emptyMatch = (matchNum: number): BracketMatch => ({
  id: uid(), matchNum, p1: null, p2: null, s1: null, s2: null,
  winner: null, played: false, isBye: false,
});

const strengthOf = (e: Entrant) => e.strength ?? 0;

/**
 * Build a single-elimination bracket, strongest first, padded to a power of two.
 *
 * A slot with no opponent is a BYE: it is marked played and its entrant is
 * advanced immediately, so the bracket is never waiting on a match that cannot
 * be played.
 */
export function seedBracket(entrants: Entrant[]): Round[] | null {
  const N = entrants.length;
  if (N < 2) return null;

  const sorted = [...entrants].sort((a, b) => strengthOf(b) - strengthOf(a));
  const size = Math.pow(2, Math.ceil(Math.log2(N)));
  const ord = seedOrder(size);
  const slots: (Entrant | null)[] = new Array(size).fill(null);
  ord.forEach((seedIdx, slot) => {
    if (seedIdx < N) slots[slot] = sorted[seedIdx];
  });

  const rounds: Round[] = [];
  let count = size / 2;
  let mn = 1;
  while (count >= 1) {
    const rd: Round = [];
    for (let i = 0; i < count; i++) rd.push(emptyMatch(mn++));
    rounds.push(rd);
    count /= 2;
  }

  for (let i = 0; i < size; i += 2) {
    const m = rounds[0][i / 2];
    m.p1 = slots[i];
    m.p2 = slots[i + 1];
    const lonely = (m.p1 && !m.p2) || (!m.p1 && m.p2);
    if (lonely) {
      const adv = (m.p1 ?? m.p2)!;
      m.isBye = true;
      m.played = true;
      m.winner = adv.id;
      if (rounds.length > 1) {
        const nx = rounds[1][Math.floor(i / 2 / 2)];
        if ((i / 2) % 2 === 0) nx.p1 = adv;
        else nx.p2 = adv;
      }
    }
  }
  return rounds;
}

/** The losers' bracket for a winners' bracket of `size` slots. 4/8/16 only. */
export function buildLoserBracket(size: number): Round[] {
  if (size < 4) return [];
  const k = Math.log2(size);
  const rounds: Round[] = [];
  let mn = 100;
  for (let r = 0; r < 2 * (k - 1); r++) {
    const cnt = Math.pow(2, k - 2 - Math.floor(r / 2));
    const rd: Round = [];
    for (let i = 0; i < cnt; i++) rd.push(emptyMatch(mn++));
    rounds.push(rd);
  }
  return rounds;
}

export type Bracket = "W" | "L" | "G";
export type Stage = "group" | "quarter" | "semi" | "final";

export type AdvanceResult = {
  wb: Round[];
  lb: Round[];
  gf: BracketMatch;
  winnerTeam: Entrant | null;
  loserTeam: Entrant | null;
  champion: Entrant | null;
  stage: Stage;
};

/**
 * Record a double-elimination result and route both teams onward.
 *
 * The routing is the part worth reading twice:
 *   - winners' bracket round 0 losers pair off into LB round 0;
 *   - a later winners' loser drops into the ODD losers' round `2r-1` as p2,
 *     meeting whoever came up through the losers' bracket;
 *   - losers' even-round winners keep their index, odd-round winners pair up.
 * Grand final is the single-game club version — no bracket reset.
 */
export function advanceDE(
  wb: Round[],
  lb: Round[] | null,
  gf: Partial<BracketMatch> | null,
  bracket: Bracket,
  r: number,
  mIdx: number,
  sA: number,
  sB: number,
): AdvanceResult {
  const W: Round[] = wb.map((x) => x.map((y) => ({ ...y })));
  const L: Round[] = (lb ?? []).map((x) => x.map((y) => ({ ...y })));
  const G = { ...(gf ?? emptyMatch(999)) } as BracketMatch;

  let winnerTeam: Entrant | null = null;
  let loserTeam: Entrant | null = null;
  let champion: Entrant | null = null;
  let stage: Stage = "group";

  if (bracket === "G") {
    G.s1 = sA; G.s2 = sB;
    G.winner = sA > sB ? G.p1!.id : G.p2!.id;
    G.played = true;
    winnerTeam = sA > sB ? G.p1 : G.p2;
    loserTeam = sA > sB ? G.p2 : G.p1;
    champion = winnerTeam;
    stage = "final";
  } else if (bracket === "L") {
    const m = L[r][mIdx];
    m.s1 = sA; m.s2 = sB;
    m.winner = sA > sB ? m.p1!.id : m.p2!.id;
    m.played = true;
    winnerTeam = sA > sB ? m.p1 : m.p2;
    loserTeam = sA > sB ? m.p2 : m.p1;
    stage = r >= L.length - 2 ? "semi" : "quarter";

    if (r + 1 < L.length) {
      if (r % 2 === 0) {
        L[r + 1][mIdx].p1 = winnerTeam;
      } else {
        const nx = L[r + 1][Math.floor(mIdx / 2)];
        if (mIdx % 2 === 0) nx.p1 = winnerTeam;
        else nx.p2 = winnerTeam;
      }
    } else {
      G.p2 = winnerTeam;
    }
  } else {
    const m = W[r][mIdx];
    m.s1 = sA; m.s2 = sB;
    m.winner = sA > sB ? m.p1!.id : m.p2!.id;
    m.played = true;
    winnerTeam = sA > sB ? m.p1 : m.p2;
    loserTeam = sA > sB ? m.p2 : m.p1;
    stage = r === W.length - 1 ? "semi" : r === W.length - 2 ? "quarter" : "group";

    if (r + 1 < W.length) {
      const nx = W[r + 1][Math.floor(mIdx / 2)];
      if (mIdx % 2 === 0) nx.p1 = winnerTeam;
      else nx.p2 = winnerTeam;
    } else {
      G.p1 = winnerTeam;
    }

    if (L.length) {
      if (r === 0) {
        const t = L[0][Math.floor(mIdx / 2)];
        if (mIdx % 2 === 0) t.p1 = loserTeam;
        else t.p2 = loserTeam;
      } else {
        L[2 * r - 1][mIdx].p2 = loserTeam;
      }
    }
  }

  return { wb: W, lb: L, gf: G, winnerTeam, loserTeam, champion, stage };
}

/* ---------- seed references ----------
 * How a knockout slot fills itself from earlier results, copied from the
 * Pickleboss app (index.html:571-582). "A1" is the winner of group A, "B2" the
 * runner-up of group B; "W:SF1" and "L:SF1" are the winner and loser of a tie.
 * OSL uses the same idea for its semi-finals: A1 v B2, B1 v A2.
 */

export type SeedRef = string;

const GROUP_REF = /^([A-Z])([1-9])$/;

export type RefResolver = {
  /** Team id placed `rank` (1-based) in group `key`, or null while undecided. */
  groupPlacing: (key: string, rank: number) => string | null;
  /** Winner / loser of an earlier knockout tie, or null while unplayed. */
  tieWinner: (code: string) => string | null;
  tieLoser: (code: string) => string | null;
};

export function resolveRef(ref: SeedRef, r: RefResolver): string | null {
  const g = GROUP_REF.exec(ref);
  if (g) return r.groupPlacing(g[1], Number(g[2]));
  if (ref.startsWith("W:")) return r.tieWinner(ref.slice(2));
  if (ref.startsWith("L:")) return r.tieLoser(ref.slice(2));
  return null;
}

/** Human label for a slot that is not filled yet. */
export function refLabel(ref: SeedRef): string {
  const g = GROUP_REF.exec(ref);
  if (g) return `${g[1]}${g[2]} · group ${g[1]} #${g[2]}`;
  if (ref.startsWith("W:")) return `Winner ${ref.slice(2)}`;
  if (ref.startsWith("L:")) return `Loser ${ref.slice(2)}`;
  return ref;
}

export const isSeedRef = (ref: string): boolean =>
  GROUP_REF.test(ref) || ref.startsWith("W:") || ref.startsWith("L:");

/* ── Which row answers to a knockout label ─────────────────────────────── */

export type LabelledRow = {
  id: string;
  round: string;
  bracket?: string | null;
  groupId?: string | null;
  createdAt: Date;
};

/**
 * In ONE category, the row each knockout label means — for `W:`/`L:`
 * references, the scheduler's ties, and the podium's Final and Third Place.
 *
 * The DRAWN bracket's row wins (0020's unique index keeps its labels one per
 * category). Only where the category has no drawn row of that label does a
 * match added by hand answer to it — the EARLIEST (created_at, then id), so the
 * answer is stable. That fallback is load-bearing, not a nicety: deleting a
 * drawn semi-final and adding it back by hand is today the only way to change
 * who plays it, and without the fallback the Final waited on it for ever and
 * the scheduler let the Final be timed alongside it.
 *
 * One definition, because three readers used to keep their own: the resolver
 * and the scheduler had no fallback while the podium did, so the three
 * disagreed about the same category. `honours.ts` repeats the rule in SQL.
 */
export function rowsByLabel<R extends LabelledRow>(rows: R[]): Map<string, R> {
  const drawn = new Map<string, R>();
  const byHand = new Map<string, R>();
  const earlier = (a: R, b: R) =>
    (a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)) < 0;
  for (const r of rows) {
    if (r.bracket != null) drawn.set(r.round, r);
    else if (r.groupId == null) {
      const seen = byHand.get(r.round);
      if (!seen || earlier(r, seen)) byHand.set(r.round, r);
    }
  }
  for (const [label, r] of byHand) if (!drawn.has(label)) drawn.set(label, r);
  return drawn;
}

/* ── Which round each knockout row is in, read off the draw ────────────── */

export type BracketRow = { id: string; round: string; slotA: string | null; slotB: string | null };

/**
 * The rounds of ONE bracket, earliest first, each named for where it sits.
 *
 * Read from the draw itself, not from the labels: the top round is the rows
 * nothing feeds from, the rows their `W:` slots name are one round earlier, and
 * so on — and each round is named by its WIDTH (one match: Final; two:
 * Semi-finals; four: Quarter-finals), not by counting down from a final that an
 * incomplete draw may not have.
 * The print pack used to take every distinct label across the whole event and
 * name them counting back from the end — so with two semi-finals and a final,
 * "Semi-Final 1" printed under "Quarter-finals", and two categories' finals
 * shared one section. A Third Place (fed by `L:`, fed into nothing) sits with
 * the Final, where it is played.
 */
export function bracketRounds<R extends BracketRow>(rows: R[]): { name: string; matches: R[] }[] {
  const byLabel = new Map(rows.map((r) => [r.round, r]));
  /* A row's parent is the row whose slot says W:<this row's label>. */
  const parentOf = new Map<string, R>();
  for (const r of rows) {
    for (const slot of [r.slotA, r.slotB]) {
      const m = slot?.match(/^W:(.+)$/);
      const fed = m ? byLabel.get(m[1]) : undefined;
      if (fed) parentOf.set(fed.id, r);
    }
  }
  const depth = (r: R, seen = new Set<string>()): number => {
    const p = parentOf.get(r.id);
    if (!p || seen.has(p.id)) return 1; // a cycle cannot happen in a draw; guard anyway
    seen.add(r.id);
    return depth(p, seen) + 1;
  };

  const byDepth = new Map<number, R[]>();
  for (const r of rows) {
    const d = depth(r);
    byDepth.set(d, [...(byDepth.get(d) ?? []), r]);
  }

  /* The top round is not always a final. A draw that stopped at quarter-finals
     (possible until the draw builds complete brackets) has four rows that feed
     nothing, and so does a category whose drawn Final was deleted; named by
     depth alone, those printed under "Final". So the top round is named by how
     WIDE it is, and each round below it is twice as wide. A third-place match —
     fed only by losers — sits with the top round but does not widen it. */
  const losersOnly = (r: R) =>
    [r.slotA, r.slotB].some((s) => s?.startsWith("L:")) && ![r.slotA, r.slotB].some((s) => s?.startsWith("W:"));
  const top = (byDepth.get(1) ?? []).filter((r) => !losersOnly(r));
  const base = 2 ** Math.ceil(Math.log2(Math.max(1, top.length))); // matches in the top round
  const nameOf = (d: number) => {
    const m = base * 2 ** (d - 1); // matches in this round
    return m === 1 ? "Final" : m === 2 ? "Semi-finals" : m === 4 ? "Quarter-finals" : `Round of ${2 * m}`;
  };
  /* The Final first, the third-place match last, the rest 1, 2, 10 in numeric
     order between them. */
  const order = (a: R, b: R) => {
    const rank = (r: R) => (r.round === "Final" ? 0 : r.round === "Third Place" ? 2 : 1);
    const num = (r: R) => Number(r.round.match(/(\d+)$/)?.[1] ?? 0);
    return rank(a) - rank(b) || num(a) - num(b) || a.round.localeCompare(b.round);
  };
  return [...byDepth.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([d, list]) => ({ name: nameOf(d), matches: [...list].sort(order) }));
}
