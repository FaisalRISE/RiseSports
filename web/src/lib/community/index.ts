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
 */

/** "2026-09-14" from a Date's LOCAL year, month and day. Never via toISOString. */
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
 * The next `count` dates this game runs, starting today.
 *
 * A weekly game with no days set would loop forever looking for a match, so the
 * walk is bounded: 200 days is a generous ceiling on "the next six sessions"
 * for any weekly pattern, and returning a short list beats hanging.
 */
export function sessionDates(game: Recurrence, count = 6, now = new Date()): string[] {
  const out: string[] = [];
  const cursor = new Date(now);
  cursor.setHours(0, 0, 0, 0);

  const days = game.days ?? [];
  for (let guard = 0; out.length < count && guard < 200; guard++) {
    if (game.freq === "daily" || days.includes(cursor.getDay())) out.push(localISO(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

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

/** Whole years old on `on`, or null when the date of birth is unknown. */
export function ageOn(dob: string | null, on: Date): number | null {
  if (!dob) return null;
  const b = fromISO(dob);
  if (Number.isNaN(b.getTime())) return null;
  let age = on.getFullYear() - b.getFullYear();
  const months = on.getMonth() - b.getMonth();
  if (months < 0 || (months === 0 && on.getDate() < b.getDate())) age--;
  return age;
}

type Entrant = Pick<Person, "gender" | "dob" | "riseBest" | "dupr">;

/**
 * Every reason this person may not join, in plain words. Empty means eligible.
 *
 * Returns ALL failures rather than the first, because the player's card lists
 * them — being told "Men only" and then, after asking, "also 18+" is worse than
 * being told both at once.
 *
 * An age limit on a player with no date of birth FAILS. That is deliberate and
 * matches the legacy app: the organiser set an age rule, and an unknown age
 * cannot satisfy it. Failing open would quietly admit exactly the people the
 * rule exists to exclude.
 */
export function eligibilityFailures(
  person: Entrant,
  r: Restrictions | null | undefined,
  on = new Date(),
): string[] {
  if (!r) return [];
  const out: string[] = [];

  /* The rating here is `riseBest`, the max across formats — the same number the
     restriction is written in terms of ("GSR 600+"). A player with no rating at
     all reads as 0 and so fails a minimum, which is the legacy behaviour. */
  const rating = person.riseBest ?? 0;
  if (r.gsrMin != null && rating < r.gsrMin) out.push(`Rating ${r.gsrMin}+ only`);
  if (r.gsrMax != null && rating > r.gsrMax) out.push(`Rating ${r.gsrMax} and under only`);

  /* DUPR is stored ×100 (3.75 → 375) so it stays an integer; the restriction is
     entered in the same units by the form. */
  const dupr = person.dupr ?? 0;
  if (r.duprMin != null && dupr < r.duprMin) out.push(`DUPR ${(r.duprMin / 100).toFixed(2)}+ only`);
  if (r.duprMax != null && dupr > r.duprMax) out.push(`DUPR ${(r.duprMax / 100).toFixed(2)} and under only`);

  if (r.gender && person.gender !== r.gender) out.push(r.gender === "M" ? "Men only" : "Women only");

  const age = ageOn(person.dob, on);
  if (r.ageMin != null && (age == null || age < r.ageMin)) out.push(`Age ${r.ageMin}+ only`);
  if (r.ageMax != null && (age == null || age > r.ageMax)) out.push(`Age ${r.ageMax} and under only`);

  return out;
}

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

  if (r.ageMin != null && r.ageMax != null) out.push(`Age ${r.ageMin}–${r.ageMax}`);
  else if (r.ageMin != null) out.push(`Age ${r.ageMin}+`);
  else if (r.ageMax != null) out.push(`Age up to ${r.ageMax}`);

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
