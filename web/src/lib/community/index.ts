import "server-only";

/* Community play — the pure part.
 *
 * Dates, capacity, and who is allowed in. No database, no React: everything
 * here is a function of its arguments, so it can be unit-tested against the
 * legacy behaviour rather than checked by eye in a browser.
 *
 * Ported from app.source.js — `genSessionDates` (8785), `checkCommEligibility`
 * (8800), `ce` restriction chips (9360) and the plain-English summary (9973).
 */

import type { CommunityGame, Person, Restrictions } from "@/lib/db/schema";
import {
  ageOnISO, dateLabel, indiaDateISO, personFailures, rulesOfRestrictions, sportRating, todayInIndia,
} from "@/lib/eligibility";
import type { SportId } from "@/lib/sports/registry";

/* ── Dates ────────────────────────────────────────────────────────────────
 *
 * The legacy version of this has a real bug, and it is NOT ported.
 *
 * It walks forward from local midnight, tests `d.getDay()` against the chosen
 * weekdays, then stores `d.toISOString().slice(0, 10)`. Those two disagree
 * anywhere east of UTC: at local midnight in India the UTC instant is still
 * 18:30 the PREVIOUS day, so a game set to run on Mondays matches Monday's
 * getDay() and stores Sunday's date string. Every Indian user — which is all of
 * them — sees a session strip shifted one day back, and a date the roster then
 * keys itself by.
 *
 * The fix is to never let a local date go through UTC: format the local Y-M-D
 * directly. `localISO` below is the whole of it, and a test pins it.
 *
 * ── Whose "today" ────────────────────────────────────────────────────────
 * `localISO(new Date())` is the SERVER's today, and the live server runs in
 * UTC — so from 00:00 to 05:30 India time it is still yesterday: the session
 * strip started a day early and ages were counted on the wrong day. Every
 * "today" in community play is `todayInIndia()` (lib/eligibility), a fixed
 * +05:30 that does not care where the server is. `localISO`/`fromISO` stay the
 * pair that walks and names calendar days once the first one is known; they
 * are never the way to FIND today.
 */

/** "2026-09-14" from a Date's LOCAL year, month and day. Never via toISOString.
 *  Not for "today" — see above. */
export function localISO(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Parse "2026-09-14" as LOCAL midnight, not UTC — the same trap, inbound. */
export function fromISO(iso: string): Date {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

type Recurrence = Pick<CommunityGame, "freq" | "days">;

/**
 * The next `count` dates this game runs, starting today — India's today.
 *
 * A weekly game with no days set would loop forever looking for a match, so the
 * walk is bounded: 200 days is a generous ceiling on "the next six sessions"
 * for any weekly pattern, and returning a short list beats hanging.
 */
export function sessionDates(game: Recurrence, count = 6, now = new Date()): string[] {
  const out: string[] = [];
  /* The walk starts on India's calendar day, then moves in local midnights —
     `fromISO` and `localISO` name the same day whatever the server's zone, so
     only the START had to stop depending on it. */
  const cursor = fromISO(todayInIndia(now));

  const days = game.days ?? [];
  for (let guard = 0; out.length < count && guard < 200; guard++) {
    if (game.freq === "daily" || days.includes(cursor.getDay())) out.push(localISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/** Today's weekday in India, 0 = Sunday like `days`. A new game's default day. */
export const todayWeekday = (now = new Date()): number => fromISO(todayInIndia(now)).getDay();

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "Mon 14 Sep" — how a session date is shown everywhere. */
export function prettyDate(iso: string): string {
  const d = fromISO(iso);
  return `${WEEKDAYS[d.getDay()]} ${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

/** "Tue, Thu", or "Every day". */
export function prettyDays(game: Recurrence): string {
  if (game.freq === "daily") return "Every day";
  const days = [...(game.days ?? [])].sort((a, b) => a - b);
  return days.length ? days.map((d) => WEEKDAYS[d]).join(", ") : "No days set";
}

/* ── Capacity ─────────────────────────────────────────────────────────────*/

/** Spots in one session: courts × players per court. */
export const capacityOf = (game: Pick<CommunityGame, "courts" | "perCourt">): number =>
  Math.max(0, game.courts * game.perCourt);

/* ── Who is allowed in ────────────────────────────────────────────────────*/

/**
 * Whole years old on `on`, or null when it cannot be known.
 *
 * A thin wrapper since 2026-09-17: the arithmetic is `ageOnISO` in
 * lib/eligibility, which tournament categories use too. `on` is turned into
 * India's calendar day first — the day the session strip shows — not the
 * server's, which is a day behind for five and a half hours every night.
 */
export function ageOn(dob: string | null, on: Date): number | null {
  return ageOnISO(dob, indiaDateISO(on));
}

type Entrant = Pick<Person, "gender" | "dob" | "dupr" | "riseRatings" | "matchCount" | "seedSource">;

export type CommunityVerdict = {
  /** Reasons this person may not join, in plain words. Empty means eligible. */
  blocks: string[];
  /** Things the HOST should see and the player need not: "No DUPR", "Unrated". */
  notes: string[];
};

/**
 * Whether this person may join a game with these limits — and, separately,
 * anything the host should know about them.
 *
 * ONE call for both, so the host's "No DUPR" flag and the join check cannot
 * come from two different readings of the same person.
 *
 * Returns ALL failures rather than the first, because the player's card lists
 * them — being told "Men only" and then, after asking, "also 18+" is worse than
 * being told both at once.
 *
 * An age limit on a player with no date of birth FAILS. That is deliberate and
 * matches the legacy app: the organiser set an age rule, and an unknown age
 * cannot satisfy it. Failing open would quietly admit exactly the people the
 * rule exists to exclude.
 *
 * ── One checker, not two ─────────────────────────────────────────────────
 * The rules live in lib/eligibility, which tournament categories use as well,
 * so "who may play" cannot be written twice and drift. The evidence is the
 * tournaments' evidence too, since 2026-09-21 (Faisal: "RiseR rating is
 * specific to each sport"):
 *   - the rating is `sportRating` — the rating in THIS GAME'S SPORT, counting
 *     only keys with matches behind them or a deliberate seed. It used to be
 *     `riseBest`, the best across every sport, so a strong badminton player
 *     was kept out of a beginners' pickleball game. A newcomer still on the
 *     default 750 is UNRATED now, not 750: refused by "Rating 600+" (which used
 *     to let them in) and let in, with a note, under "up to 700" (which used to
 *     keep them out). Tournaments have always treated them that way.
 *   - a missing DUPR is MISSING, not 0. It is let in and flagged unless the
 *     host made the game strict — the organiser's discretion, like
 *     tournaments. As 0 it slipped under every "DUPR up to" limit silently.
 *   - ages are counted on the host's cut-off date (Faisal, 2026-09-21: "cut off
 *     date to be set by the organiser"), as a tournament category counts on
 *     its own. A game saved without one counts on `on`, else today in India.
 *     The refusal names the date — "Age 18+ only (on 1 Jan 2026)" — because a
 *     player who is 18 today and was 17 then would otherwise be told a rule
 *     they seem to meet.
 *
 * Two behaviours changed when the rules moved to lib/eligibility, both tested:
 *   - an invalid date of birth ("1994-13-45") used to roll over into a real
 *     date via `fromISO`; it now counts as unknown and fails an age rule;
 *   - a date of birth AFTER the day of play used to give a negative age, which
 *     passed any "N and under" limit; it now fails both bounds.
 */
export function communityVerdict(
  person: Entrant,
  r: Restrictions | null | undefined,
  opts: { sport: SportId; on?: Date },
): CommunityVerdict {
  if (!r) return { blocks: [], notes: [] };
  const fs = personFailures(
    {
      name: "",
      gender: person.gender,
      dob: person.dob,
      rating: sportRating(person, opts.sport),
      dupr: person.dupr ?? null,
    },
    rulesOfRestrictions(r),
    { fallbackOn: indiaDateISO(opts.on ?? new Date()), dated: true },
  );
  return {
    blocks: fs.filter((f) => f.severity === "block").map((f) => f.text),
    notes: fs.filter((f) => f.severity === "note").map((f) => f.text),
  };
}

/** Just the reasons a person may not join. See `communityVerdict`. */
export const eligibilityFailures = (
  person: Entrant,
  r: Restrictions | null | undefined,
  opts: { sport: SportId; on?: Date },
): string[] => communityVerdict(person, r, opts).blocks;

/** The short red chips on a game's header. Same rules, stated as limits. */
export function restrictionChips(r: Restrictions | null | undefined): string[] {
  if (!r) return [];
  const out: string[] = [];

  if (r.gender) out.push(r.gender === "M" ? "Men only" : "Women only");

  if (r.gsrMin != null && r.gsrMax != null) out.push(`Rating ${r.gsrMin}–${r.gsrMax}`);
  else if (r.gsrMin != null) out.push(`Rating ${r.gsrMin}+`);
  else if (r.gsrMax != null) out.push(`Rating up to ${r.gsrMax}`);

  const d = (n: number) => (n / 100).toFixed(2);
  if (r.duprMin != null && r.duprMax != null) out.push(`DUPR ${d(r.duprMin)}–${d(r.duprMax)}`);
  else if (r.duprMin != null) out.push(`DUPR ${d(r.duprMin)}+`);
  else if (r.duprMax != null) out.push(`DUPR up to ${d(r.duprMax)}`);
  if (r.duprStrict && (r.duprMin != null || r.duprMax != null)) out.push("DUPR required");

  /* The cut-off belongs in the chip: "Age 18+" means something else a week
     before a birthday. */
  const on = r.ageOn ? ` on ${dateLabel(r.ageOn)}` : "";
  if (r.ageMin != null && r.ageMax != null) out.push(`Age ${r.ageMin}–${r.ageMax}${on}`);
  else if (r.ageMin != null) out.push(`Age ${r.ageMin}+${on}`);
  else if (r.ageMax != null) out.push(`Age up to ${r.ageMax}${on}`);

  return out;
}

/** True when the organiser set no limits at all. */
export const isUnrestricted = (r: Restrictions | null | undefined): boolean =>
  restrictionChips(r).length === 0;

/* ── Money ────────────────────────────────────────────────────────────────
 * Integer paise in, rupees out — the ledger's rule, applied here too so a price
 * can never be a float. */
export const rupees = (paise: number): string =>
  (paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0 });

export const priceLabel = (paise: number): string => (paise > 0 ? `₹${rupees(paise)}` : "Free");

/* ── URL keys ─────────────────────────────────────────────────────────────*/

export function slugifyGame(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "game";
}
