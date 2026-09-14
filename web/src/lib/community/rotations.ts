import "server-only";

/* The three other ways to run a session.
 *
 * A game's `rotation` decides which of these it uses: `slots` (people book
 * half-hour blocks), `kotc` (King of the Court), `ladder` (a standing order you
 * climb by beating someone above you). `fixed` and `rotate` need none of this —
 * they use the pairings engine instead.
 *
 * Ported from app.source.js — half-hour slots (:8801 `genHalfHourSlots`,
 * :10100 the reserve/leave engine), King of the Court (:10124-10200), and the
 * ladder (:10200-10229).
 *
 * Everything here is pure. The state each one owns is small and lives in a
 * jsonb column — `communitySessions.slotData`, `communitySessions.kotc`, and
 * `communityGames.ladderOrder` / `ladderLog` — so these take a state and return
 * the next one rather than reaching for the database.
 */

/* ── Half-hour slots ──────────────────────────────────────────────────────*/

const toMinutes = (hhmm: string): number => {
  const [h, m] = String(hhmm).split(":").map((x) => parseInt(x, 10));
  return (h || 0) * 60 + (m || 0);
};

const fmt = (mins: number): string =>
  `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

/**
 * "20:00–20:30", "20:30–21:00", … across the game's hours.
 *
 * A session ending at or before it starts is treated as one hour long, which is
 * the legacy behaviour and stops a typo producing an empty screen. Capped at 48
 * so a mis-entered end time cannot generate a day of slots.
 */
export function halfHourSlots(start: string, end: string): string[] {
  const from = toMinutes(start);
  let to = toMinutes(end);
  /* Past midnight — 22:00 to 00:30 — is a real evening, not a typo. */
  if (to <= from) to = from + (toMinutes(end) < toMinutes(start) ? 1440 - from + toMinutes(end) : 60);

  const out: string[] = [];
  for (let t = from; t + 30 <= to && out.length < 48; t += 30) out.push(`${fmt(t)}–${fmt(t + 30)}`);
  return out;
}

export type SlotData = Record<string, string[]>;

/** Take a place in one slot. Full slots and double-booking are both no-ops. */
export function reserveSlot(
  slots: SlotData, slot: string, personId: string, capacity: number,
): SlotData {
  const list = slots[slot] ?? [];
  if (list.includes(personId) || list.length >= capacity) return slots;
  return { ...slots, [slot]: [...list, personId] };
}

/** Give a slot back. */
export function leaveSlot(slots: SlotData, slot: string, personId: string): SlotData {
  const list = slots[slot] ?? [];
  if (!list.includes(personId)) return slots;
  return { ...slots, [slot]: list.filter((id) => id !== personId) };
}

/* ── King of the Court ────────────────────────────────────────────────────
 *
 * Courts are ranked, court 1 being the King court. Each round every court
 * plays; then the winners of court 1 stay, the winners of court 2 move up to
 * court 1, the losers of court 1 drop to court 2, and so on down. The bottom
 * court takes two off the bench, and its losers go to the back of the bench.
 * A crown is awarded each round to whoever held the King court. */

export type KotcCourt = { a: string[]; b: string[]; winner: "a" | "b" | null };
export type KotcState = {
  courts: KotcCourt[];
  bench: string[];
  crowns: Record<string, number>;
  round: number;
};

/** Fisher-Yates, with the caller's own `rand` so a test can pin the order. */
function shuffle<T>(xs: T[], rand: () => number): T[] {
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Draw the opening round. Needs four players; returns null below that.
 *
 * King of the Court is doubles by definition — two against two, winners hold
 * the court — so this is four per court regardless of the game's `perCourt`.
 */
export function kotcStart(
  confirmed: string[], courts: number, rand: () => number = Math.random,
): KotcState | null {
  if (confirmed.length < 4) return null;

  const pool = shuffle(confirmed, rand);
  const usable = Math.max(1, Math.min(courts, Math.floor(pool.length / 4)));

  const courtList: KotcCourt[] = Array.from({ length: usable }, (_, i) => {
    const four = pool.slice(i * 4, i * 4 + 4);
    return { a: [four[0], four[1]], b: [four[2], four[3]], winner: null };
  });

  return { courts: courtList, bench: pool.slice(usable * 4), crowns: {}, round: 1 };
}

/** Record who won one court. */
export function kotcPickWinner(state: KotcState, courtIndex: number, side: "a" | "b"): KotcState {
  if (!state.courts[courtIndex]) return state;
  return {
    ...state,
    courts: state.courts.map((c, i) => (i === courtIndex ? { ...c, winner: side } : c)),
  };
}

/** True once every court has a result and the round can be closed. */
export const kotcRoundComplete = (state: KotcState): boolean =>
  state.courts.length > 0 && state.courts.every((c) => c.winner !== null);

/**
 * Close the round and promote, demote and rotate the bench.
 *
 * Returns the state unchanged when a court still has no result — closing early
 * would promote a pair that had not won anything.
 *
 * The degenerate case is one court with nobody waiting: the same four play
 * again with the same partners, which is the legacy behaviour and is what
 * "winners stay on" means when there is nobody to come on. Rotating partners
 * there would be a different game, not a bug fix.
 */
export function kotcNextRound(state: KotcState): KotcState {
  if (!kotcRoundComplete(state)) return state;

  const winners = state.courts.map((c) => (c.winner === "a" ? c.a : c.b));
  const losers = state.courts.map((c) => (c.winner === "a" ? c.b : c.a));
  const n = state.courts.length;

  /* The crown goes to whoever held the King court this round. */
  const crowns = { ...state.crowns };
  for (const id of winners[0]) crowns[id] = (crowns[id] ?? 0) + 1;

  const useBench = state.bench.length >= 2;

  const courts: KotcCourt[] = Array.from({ length: n }, (_, i) => ({
    /* Court 1 keeps its winners; every court below takes the pair that just
       dropped from the court above it. */
    a: i === 0 ? winners[0] : losers[i - 1],
    /* …and is challenged by the winners from the court below, or — on the
       bottom court — by the next two off the bench. */
    b: i + 1 < n ? winners[i + 1] : useBench ? state.bench.slice(0, 2) : losers[n - 1],
    winner: null,
  }));

  return {
    courts,
    bench: useBench ? [...state.bench.slice(2), ...losers[n - 1]] : state.bench,
    crowns,
    round: state.round + 1,
  };
}

/** Everyone currently in a KotC session, on a court or on the bench. */
export const kotcEveryone = (state: KotcState): string[] => [
  ...state.courts.flatMap((c) => [...c.a, ...c.b]),
  ...state.bench,
];

/* ── Ladder ───────────────────────────────────────────────────────────────
 *
 * A standing order that persists across dates — which is why it lives on the
 * GAME rather than on a session. You challenge someone above you; win and you
 * take their place. */

export type LadderEntry = { challenger: string; defender: string; won: boolean; at: string };

export const ladderAdd = (order: string[], personId: string): string[] =>
  order.includes(personId) ? order : [...order, personId];

export const ladderRemove = (order: string[], personId: string): string[] =>
  order.filter((id) => id !== personId);

export type LadderResult =
  | { ok: true; order: string[]; log: LadderEntry[] }
  | { ok: false; error: string };

/**
 * Settle a challenge.
 *
 * The challenger must be BELOW the defender. The legacy engine does not check
 * this — it swaps whatever two positions it is handed (:10211), and only the UI
 * stops you challenging downwards. That means any path to it that is not that
 * screen can silently invert the ladder, so the rule lives here instead.
 *
 * A win swaps the two places. A loss changes nothing but is still recorded —
 * "I challenged and lost" is the more useful half of a ladder's history,
 * because it is what stops the same challenge being made every week.
 */
export function ladderChallenge(
  order: string[],
  log: LadderEntry[],
  challenger: string,
  defender: string,
  challengerWon: boolean,
  today: string,
): LadderResult {
  if (challenger === defender) return { ok: false, error: "Pick two different players." };

  const ci = order.indexOf(challenger);
  const di = order.indexOf(defender);
  if (ci < 0 || di < 0) return { ok: false, error: "Both players have to be on the ladder." };
  if (ci < di) return { ok: false, error: "You can only challenge somebody above you." };

  const next = [...order];
  if (challengerWon) {
    next[ci] = order[di];
    next[di] = order[ci];
  }

  return {
    ok: true,
    order: next,
    /* Newest first, and only the last six kept — this is a recent-form note on
       the screen, not an archive. */
    log: [{ challenger, defender, won: challengerWon, at: today }, ...log].slice(0, 6),
  };
}
