import "server-only";

/* Putting times and courts against matches.
 *
 * Ported in spirit from `buildTimedSchedule` (app.source.js:666) — the greedy
 * slot fill and the back-to-back penalty are its ideas and they are good ones.
 * Two things are different here, and both are the reason the port was worth
 * doing rather than copying.
 *
 * ── 1. A person, not a player row ────────────────────────────────────────
 * The legacy app had one category per event, so "this player is busy" was a
 * player id. Here a person may enter Men's Doubles and Mixed with different
 * partners, which is two TEAMS and two `players` rows for one human. Keyed on
 * the player row, the scheduler would happily put the same person on two courts
 * at 10:30 and every check would pass. The clash key is therefore `personId`,
 * and see `busyKey` for what happens when there is not one.
 *
 * ── 2. Dependencies are real, not a round number ─────────────────────────
 * The legacy version sorted by an integer `round` and used it as a TIEBREAK, so
 * a knockout match could be placed before the group that feeds it whenever the
 * group matches happened to clash. It got away with it because one category and
 * a sorted list usually agree.
 *
 * This model knows better and should say so: a knockout slot is stored as a
 * seed reference — "A1" is the winner of group A, "W:Semi-Final 1" the winner
 * of an earlier tie — so what a match waits for is written down. `dependsOn`
 * carries those ids and a match is not eligible for a slot until every one of
 * them is in an EARLIER slot. That is a constraint, not a preference, and it is
 * what stops a final being scheduled for 10:00.
 *
 * ── What it does not promise ─────────────────────────────────────────────
 * A match whose teams are not decided yet has nobody to clash with, so it is
 * placed by its dependencies alone and reported in `provisional`. Guessing at
 * the possible finalists and keeping them apart would push every knockout to
 * the end of the day to avoid collisions that will mostly not happen.
 */

export type ScheduleMatch = {
  id: string;
  /** Clash keys for everyone KNOWN to be on court — see `busyKey`. */
  people: string[];
  /** False while either side is still a seed reference rather than a team. */
  decided: boolean;
  /** Ids of matches that must be FINISHED before this one can start. */
  dependsOn: string[];
  /** Has a result, or is being played right now. Keeps the time it has. */
  started: boolean;
};

export type Placement = {
  matchId: string;
  /** 0-based round of play. Every match in one slot is on court at once. */
  slot: number;
  /** 1-based. */
  court: number;
  startsAt: Date;
};

export type SchedulePlan = {
  placements: Placement[];
  /** How many rounds of play the whole thing takes. */
  slots: number;
  /** Placed with no clash guarantee, because their teams are undecided. */
  provisional: string[];
  /** Left out, and why. Nothing is ever dropped in silence. */
  skipped: { matchId: string; reason: string }[];
};

export type ScheduleInput = {
  matches: ScheduleMatch[];
  courts: number;
  startsAt: Date;
  matchMinutes: number;
};

/**
 * What makes two entries the same human.
 *
 * `personId` where there is one. Where there is not — an organiser who typed a
 * name in rather than linking a profile — the NAME is used, normalised. That is
 * a deliberate choice about which mistake to make: two different Rahuls merged
 * costs a slightly longer schedule, while one Rahul missed puts a real person
 * on two courts at 10:30 and is discovered by him standing there. The cheap
 * error is the one worth risking.
 */
export function busyKey(p: { personId: string | null; name: string; id: string }): string {
  if (p.personId) return `person:${p.personId}`;
  const n = p.name.trim().toLowerCase().replace(/\s+/g, " ");
  return n ? `name:${n}` : `player:${p.id}`;
}

/* ── Times on a schedule are WALL CLOCK at the venue ──────────────────────
 *
 * An organiser types 09:00 and every player reads 09:00 at the court. Nobody
 * converts anything, because everybody is standing in the same building. So the
 * thing being stored is a time of day, not an instant — and the legacy app's
 * date bug (CLAUDE.md: a Monday game stored as Sunday) is what happens when the
 * two are confused.
 *
 * The convention here, and it has to be kept: the datetime-local value the
 * organiser types is read AS IF IT WERE UTC, and every render passes
 * `timeZone: "UTC"` back. What goes in comes out, on any server, in any zone,
 * with no conversion anywhere to get wrong. `matches.scheduled_at` therefore
 * holds a "floating" time — the wall clock wearing a UTC label.
 *
 * Which means: do NOT treat `scheduled_at` as a true instant. Subtracting it
 * from `Date.now()`, or exporting it to a calendar, is wrong by the venue's
 * offset — five and a half hours in India. If that is ever needed, the event
 * needs a stored timezone first, and then this convention changes in one place.
 */

/** A `datetime-local` value → the floating instant that formats back to it. */
export function floatingInstant(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value.trim());
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number) as unknown as number[];
  const at = new Date(Date.UTC(y, mo - 1, d, h, mi));
  return Number.isNaN(at.getTime()) ? null : at;
}

/** "09:20". */
export const floatingTime = (d: Date): string =>
  d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

/** "Sun 20 Sep". */
export const floatingDay = (d: Date): string =>
  d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** Back into a `datetime-local` input's value. */
export const floatingInputValue = (d: Date): string =>
  `${d.toISOString().slice(0, 10)}T${d.toISOString().slice(11, 16)}`;

const MAX_SLOTS = 500;

/** Longest path to each match, or null for anything caught in a cycle. */
function depths(items: ScheduleMatch[]): Map<string, number> | null {
  const byId = new Map(items.map((m) => [m.id, m]));
  const depth = new Map<string, number>();
  const state = new Map<string, 0 | 1 | 2>();   // unseen / on the stack / done
  let cyclic = false;

  const walk = (id: string): number => {
    if (state.get(id) === 2) return depth.get(id)!;
    if (state.get(id) === 1) { cyclic = true; return 0; }
    state.set(id, 1);
    let d = 0;
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      /* A dependency that is not in this set is already finished, or never
         existed — either way it is not something to wait for. */
      if (byId.has(dep)) d = Math.max(d, walk(dep) + 1);
    }
    state.set(id, 2);
    depth.set(id, d);
    return d;
  };

  for (const m of items) walk(m.id);
  return cyclic ? null : depth;
}

/** Everything in a cycle, so it can be reported rather than hang the fill. */
function cyclicIds(items: ScheduleMatch[]): Set<string> {
  const byId = new Map(items.map((m) => [m.id, m]));
  const state = new Map<string, 0 | 1 | 2>();
  const bad = new Set<string>();

  const walk = (id: string, stack: string[]): void => {
    if (state.get(id) === 2) return;
    if (state.get(id) === 1) {
      for (const s of stack.slice(stack.indexOf(id))) bad.add(s);
      return;
    }
    state.set(id, 1);
    for (const dep of byId.get(id)?.dependsOn ?? []) {
      if (byId.has(dep)) walk(dep, [...stack, id]);
    }
    state.set(id, 2);
  };

  for (const m of items) walk(m.id, []);
  return bad;
}

/**
 * Fill courts slot by slot, earliest first.
 *
 * Termination is not a hope: within a slot the first candidate can never clash,
 * because nobody is on court yet, and an acyclic dependency graph with anything
 * left in it always has a match whose dependencies are all placed. So every
 * slot places at least one match and the loop is bounded by the match count.
 * `MAX_SLOTS` is a backstop against a future edit breaking that reasoning, not
 * part of the argument.
 */
export function buildSchedule(input: ScheduleInput): SchedulePlan {
  const courts = Math.max(1, Math.floor(input.courts) || 1);
  const mins = Math.max(5, Math.floor(input.matchMinutes) || 20);
  const base = input.startsAt.getTime();

  const skipped: { matchId: string; reason: string }[] = [];
  const todo = input.matches.filter((m) => !m.started);

  const bad = depths(todo) === null ? cyclicIds(todo) : new Set<string>();
  for (const id of bad) {
    skipped.push({ matchId: id, reason: "waits on a match that waits on it" });
  }

  const remaining = todo.filter((m) => !bad.has(m.id));
  const depth = depths(remaining) ?? new Map<string, number>();
  const order = new Map(remaining.map((m, i) => [m.id, i]));

  const placedSlot = new Map<string, number>();
  /* The last slot each person was on court, for the back-to-back penalty. */
  const lastSlot = new Map<string, number>();
  const placements: Placement[] = [];

  let pool = [...remaining];
  let slot = 0;

  while (pool.length > 0 && slot < MAX_SLOTS) {
    const busy = new Set<string>();
    let placedHere = 0;

    while (placedHere < courts) {
      let pick = -1;
      let best = Number.POSITIVE_INFINITY;

      for (let i = 0; i < pool.length; i++) {
        const m = pool[i];
        /* Every dependency must be in an EARLIER slot. One placed in this same
           slot is being played at the same moment and settles nothing. */
        let ready = true;
        for (const dep of m.dependsOn) {
          const s = placedSlot.get(dep);
          if (order.has(dep) && (s === undefined || s >= slot)) { ready = false; break; }
        }
        if (!ready) continue;
        if (m.people.some((p) => busy.has(p))) continue;

        /* Fewest people coming straight off the previous slot, then the
           shallowest match, then the order they arrived in so the same input
           always produces the same sheet. */
        const backToBack = m.people.reduce((n, p) => n + (lastSlot.get(p) === slot - 1 ? 1 : 0), 0);
        const score = backToBack * 1e6 + (depth.get(m.id) ?? 0) * 1e3 + (order.get(m.id) ?? 0) / 1e6;
        if (score < best) { best = score; pick = i; }
      }

      if (pick === -1) break;

      const m = pool.splice(pick, 1)[0];
      placedHere++;
      placedSlot.set(m.id, slot);
      for (const p of m.people) { busy.add(p); lastSlot.set(p, slot); }
      placements.push({
        matchId: m.id,
        slot,
        court: placedHere,
        startsAt: new Date(base + slot * mins * 60_000),
      });
    }

    if (placedHere === 0) {
      /* Unreachable for an acyclic graph — see the note above. Reported rather
         than looped on, because a scheduler that spins is worse than one that
         admits it could not finish. */
      for (const m of pool) skipped.push({ matchId: m.id, reason: "nothing it waits for could be scheduled" });
      pool = [];
      break;
    }
    slot++;
  }

  for (const m of pool) skipped.push({ matchId: m.id, reason: "the day ran out of slots" });

  /* Reported by whether the TEAMS are known, not by whether any names came
     through. A match with one side decided is still clash-checked against that
     side — half a guarantee is worth having — but it is not a promise, and
     saying so is the difference between a schedule and a claim. */
  const byId = new Map(remaining.map((m) => [m.id, m]));
  const provisional = placements
    .filter((p) => byId.get(p.matchId)?.decided === false)
    .map((p) => p.matchId);

  return { placements, slots: slot, provisional, skipped };
}
