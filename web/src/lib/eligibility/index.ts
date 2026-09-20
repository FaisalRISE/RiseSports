import "server-only";

/* Who may enter a category — the rules, and nothing but the rules.
 *
 * Faisal, 2026-09-17: each category gets limits — men, women or mixed; an age
 * range; a rating level; a DUPR range — and anyone who does not qualify is
 * turned away with the reason. Until this, a category was a NAME: nothing
 * stopped a man entering Women's Doubles or a 40-year-old entering Under-17.
 *
 * Pure: no database, no React, no clock read inside a rule. Every date arrives
 * as a "YYYY-MM-DD" string, so nothing here can be moved a day by the server's
 * timezone — the trap `genSessionDates` fell into east of UTC. Callers load the
 * evidence (lib/eligibility/store, the entry and approval paths) and this file
 * judges it.
 *
 * ONE checker for the whole app. Community games restrict entry too, and
 * `lib/community` now calls into this rather than keeping its own copy — two
 * copies of "who may play" drift within a release.
 *
 * ── Decisions, and why ───────────────────────────────────────────────────
 *  - Every bound is INCLUSIVE. "35+" admits a 35-year-old; "Under-17" is
 *    stored as 16 and admits a 16-year-old.
 *  - Every failure comes back at once, never just the first. Being told
 *    "Women only", fixing it, and then being told "also 35+" is worse.
 *  - Missing evidence mostly FAILS, because the organiser set a limit and an
 *    unknown value cannot be shown to meet it:
 *      no date of birth           → fails any age bound
 *      no DUPR                    → fails a DUPR minimum AND maximum
 *      no gender                  → fails a gender rule
 *      no rating, "at least" rule → fails
 *  - The one exception, decided by Faisal 2026-09-17: a player with NO rating
 *    under an "up to" limit is let in with a NOTE for the organiser ("Unrated:
 *    check this player's level"). A newcomer belongs in the beginners'
 *    category; refusing them from it would be absurd. The note is never shown
 *    to the entrant and never blocks.
 *  - Legacy bugs NOT ported (checkEligibility, app.source.js:573): an EMPTY
 *    age rule demanding a date of birth anyway; age measured on "now" rather
 *    than the event; tier matching by `startsWith`, which made "Pro" match
 *    "Pro+"; `playingSince` and `duprUpdatedAfter`, which nothing here needs.
 */

import type { Division, GenderRule, Person, Restrictions } from "@/lib/db/schema";
import { TIERS } from "@/lib/rating";

/* ── Shapes ───────────────────────────────────────────────────────────────*/

export type Rules = {
  gender: GenderRule | null;
  ageMin: number | null;
  ageMax: number | null;
  /** "YYYY-MM-DD" — the day ages are counted on. */
  ageOn: string | null;
  ratingMin: number | null;
  ratingMax: number | null;
  /** DUPR ×100. */
  duprMin: number | null;
  duprMax: number | null;
};

export const NO_RULES: Rules = {
  gender: null, ageMin: null, ageMax: null, ageOn: null,
  ratingMin: null, ratingMax: null, duprMin: null, duprMax: null,
};

export type Gender = "M" | "F";

/** What is known about one player, from wherever it came. */
export type Evidence = {
  name: string;
  gender: Gender | null;
  /** "YYYY-MM-DD". */
  dob: string | null;
  /** RISE Rating in THIS sport, or null when the player has none. */
  rating: number | null;
  /** DUPR ×100. */
  dupr: number | null;
  /** The person's own date of birth, where their record counted and differs
      from what was declared. Produces a NOTE, never a block — see
      `personFailures`. Null everywhere else, including the public form. */
  storedDob?: string | null;
  /** The person's own DUPR ×100, on the same terms. */
  storedDupr?: number | null;
};

export type Failure = {
  /** Stable, for tests and for matching a waiver: "gender:F", "age:min:35". */
  code: string;
  /** Plain words, shown to people. */
  text: string;
  /** True when the rule failed for lack of evidence rather than on it. */
  missing: boolean;
  /** A `note` is for the organiser and never stops anything. */
  severity: "block" | "note";
};

const block = (code: string, text: string, missing = false): Failure =>
  ({ code, text, missing, severity: "block" });

/* ── Dates, as strings, so no timezone ever touches them ──────────────────*/

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar date, or null. Refuses 2026-02-30 and 2023-02-29. */
export function parseISODate(s: string | null | undefined): { y: number; m: number; d: number } | null {
  const hit = ISO.exec(String(s ?? "").trim());
  if (!hit) return null;
  const y = Number(hit[1]);
  const m = Number(hit[2]);
  const d = Number(hit[3]);
  if (m < 1 || m > 12 || d < 1) return null;
  const leap = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= days ? { y, m, d } : null;
}

/**
 * The earliest date of birth this app will take — and the same floor the
 * database keeps (`0018`: `dob >= DATE '1900-01-01'` on `players` and on
 * `registration_players`).
 *
 * Without it the two disagree, and the gap is not theoretical: a browser's date
 * field hands over "0019-05-17" when two digits are typed into the year, and
 * "1089" for "1989" is one slip of a finger. `parseISODate` calls those real
 * dates, the age comes out as 937, every "35 and over" rule passes — and the
 * insert then trips the CHECK, which throws inside the transaction and leaves
 * the entrant with no entry and no message. Refusing it HERE turns that into
 * "Enter a real date of birth."
 */
export const EARLIEST_DOB_YEAR = 1900;

/** A date that could be somebody's birthday. See `EARLIEST_DOB_YEAR`. */
export function parseDobISO(s: string | null | undefined): { y: number; m: number; d: number } | null {
  const p = parseISODate(s);
  return p && p.y >= EARLIEST_DOB_YEAR ? p : null;
}

/**
 * Whole years old on `onISO`, or null when it cannot be known.
 *
 * Integer arithmetic on the Y-M-D parts, never a `Date`: a `Date` built from
 * "2000-09-14" is a UTC instant, and reading its day back in India can land on
 * the 13th. The birthday itself counts. Someone born on 29 February has their
 * birthday on 1 March in a non-leap year, which falls out of the comparison
 * without a special case.
 *
 * Null for an invalid date, for a year the database would refuse
 * (`EARLIEST_DOB_YEAR`), AND for a date of birth after the day being asked
 * about — a negative age is not an age, and treating it as one used to pass
 * any "N and under" limit.
 */
export function ageOnISO(dob: string | null | undefined, onISO: string | null | undefined): number | null {
  const b = parseDobISO(dob);
  const o = parseISODate(onISO);
  if (!b || !o) return null;
  const beforeBirthday = o.m < b.m || (o.m === b.m && o.d < b.d);
  const age = o.y - b.y - (beforeBirthday ? 1 : 0);
  return age < 0 ? null : age;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Oct 2026", from the string's own parts. */
export function dateLabel(iso: string): string {
  const p = parseISODate(iso);
  return p ? `${p.d} ${MONTHS[p.m - 1]} ${p.y}` : iso;
}

/**
 * The calendar day of a "floating" timestamp.
 *
 * Event and match times are wall clock at the venue stored AS IF UTC (see
 * lib/schedule), so the UTC date IS the venue's date — and reading it in local
 * time would be the conversion the whole scheme exists to avoid.
 */
export const floatingDateISO = (d: Date): string => d.toISOString().slice(0, 10);

/** Today where the app's players are. For an event with no date yet. */
export function todayInIndia(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(now);
}

/* ── DUPR, stored in hundredths ───────────────────────────────────────────*/

/** "3.75" → 375. Null for anything that is not a DUPR between 1.00 and 8.00. */
export function duprToX100(raw: string | null | undefined): number | null {
  const s = String(raw ?? "").trim().replace(",", ".");
  if (!/^\d(\.\d{1,3})?$/.test(s)) return null;
  const x = Math.round(Number(s) * 100);
  return x >= 100 && x <= 800 ? x : null;
}

export const duprLabel = (x100: number): string => (x100 / 100).toFixed(2);

/* ── The rating that counts ───────────────────────────────────────────────*/

/**
 * A person's RISE Rating in one sport, or null when they have none worth the
 * name.
 *
 * NOT `riseBest`: that is a max() across every sport and format, so a strong
 * badminton player would read as strong at pickleball. Only keys for THIS sport
 * count, and only ones that mean something:
 *
 *   - a key with matches behind it — a rating that has been earned;
 *   - a key with no matches that someone placed on purpose — seeded from a DUPR
 *     or an organiser's placement band (`seedSource`). `createPerson` writes
 *     only that one key, so a zero-match key on such a person IS the seed.
 *
 * A key sitting at the default seed with no matches is not evidence of
 * anything, so a person with only that reads as unrated. The highest counting
 * key wins, because the limit is about the player's level, and their best
 * format is the level they bring.
 */
export function sportRating(
  person: Pick<Person, "riseRatings" | "matchCount" | "seedSource"> | null | undefined,
  sport: string,
): number | null {
  if (!person) return null;
  const placed = person.seedSource === "dupr" || person.seedSource === "organiser";
  let best: number | null = null;
  for (const [key, value] of Object.entries(person.riseRatings ?? {})) {
    if (!key.startsWith(`${sport}:`) || typeof value !== "number") continue;
    const played = (person.matchCount?.[key] ?? 0) > 0;
    if (!played && !placed) continue;
    if (best == null || value > best) best = value;
  }
  return best;
}

/* ── Evidence ─────────────────────────────────────────────────────────────*/

/**
 * What a rule is judged on, for one player — the ONE precedence rule.
 *
 * What was declared for this team (typed on the entry form, or by the organiser
 * adding the player) comes first; the person's stored record second; otherwise
 * it is missing. Entry, approval and the "doesn't fit" flags all build evidence
 * here, which is what stops two of them reaching different verdicts about the
 * same player.
 *
 * `useStored: false` is for the PUBLIC entry form. There is no sign-in, so
 * typing somebody else's phone number must not test an entrant against that
 * person's stored date of birth or DUPR. The form asks for those whenever the
 * category needs them, so nothing is lost. The rating always comes from the
 * person, because nobody declares their own rating — and ratings are already
 * public on every profile page.
 *
 * ── Declared wins, and what that costs ───────────────────────────────────
 * A declaration is not proof and the stored value is not proof either: both are
 * things somebody typed, and `people.dob` is itself filled from an earlier
 * declaration. So the later one wins, which is what lets a player correct a
 * date of birth a stranger got wrong. Where the two DISAGREE and the record
 * counted, that is carried out as `storedDob`/`storedDupr` and reported to the
 * organiser as a note — the app holds the contradiction, so it says so instead
 * of quietly picking a side.
 *
 * `declared.rating` is the ONE case where a rating does not come from a person
 * record: the organiser is adding somebody who does not exist yet, and the
 * starting level they picked on the form is the rating the write is about to
 * place. Judging the rule without it asks about a person who is a moment from
 * existing and gets the answer "unrated". It is ignored the instant there IS a
 * person, because then the write does not re-seed anyone.
 */
export function playerEvidence(
  declared: { name: string; gender: Gender | null; dob: string | null; dupr: number | null; rating?: number | null },
  person: Pick<Person, "dob" | "dupr" | "riseRatings" | "matchCount" | "seedSource"> | null | undefined,
  sport: string,
  opts: { useStored: boolean },
): Evidence {
  const stored = opts.useStored ? person : null;
  return {
    name: declared.name,
    gender: declared.gender,
    dob: declared.dob ?? stored?.dob ?? null,
    dupr: declared.dupr ?? stored?.dupr ?? null,
    rating: person ? sportRating(person, sport) : declared.rating ?? null,
    storedDob: declared.dob && stored?.dob && stored.dob !== declared.dob ? stored.dob : null,
    storedDupr: declared.dupr != null && stored?.dupr != null && stored.dupr !== declared.dupr ? stored.dupr : null,
  };
}

/* ── Judging one player ───────────────────────────────────────────────────*/

/**
 * Every rule one player breaks, in the order community play has always listed
 * them: rating, DUPR, gender, age. Team rules (Mixed) are `squadFailures`.
 *
 * `fallbackOn` is the day to count ages on when the rules carry none — only
 * community games, which count on the day of play. `dated` adds the day to an
 * age reason, because "Age 35+ only" is ambiguous a week before a birthday.
 */
export function personFailures(
  e: Evidence,
  r: Rules | null | undefined,
  opts: { fallbackOn?: string; dated?: boolean } = {},
): Failure[] {
  if (!r) return [];
  const out: Failure[] = [];

  if (r.ratingMin != null) {
    if (e.rating == null) out.push(block(`rating:min:${r.ratingMin}:unrated`, `Rating ${r.ratingMin}+ only (unrated)`, true));
    else if (e.rating < r.ratingMin) out.push(block(`rating:min:${r.ratingMin}`, `Rating ${r.ratingMin}+ only`));
  }
  if (r.ratingMax != null) {
    if (e.rating == null) {
      out.push({ code: `rating:max:${r.ratingMax}:unrated`, text: "Unrated: check this player's level", missing: true, severity: "note" });
    } else if (e.rating > r.ratingMax) {
      out.push(block(`rating:max:${r.ratingMax}`, `Rating ${r.ratingMax} and under only`));
    }
  }

  if (r.duprMin != null && (e.dupr == null || e.dupr < r.duprMin)) {
    out.push(block(`dupr:min:${r.duprMin}`, `DUPR ${duprLabel(r.duprMin)}+ only`, e.dupr == null));
  }
  if (r.duprMax != null && (e.dupr == null || e.dupr > r.duprMax)) {
    out.push(block(`dupr:max:${r.duprMax}`, `DUPR ${duprLabel(r.duprMax)} and under only`, e.dupr == null));
  }
  /* See the date-of-birth note below: the record disagrees, so say so. */
  if ((r.duprMin != null || r.duprMax != null) && e.storedDupr != null) {
    out.push({
      code: "dupr:mismatch",
      text: `DUPR typed here (${duprLabel(e.dupr!)}) is not the one on file`,
      missing: false, severity: "note",
    });
  }

  if (r.gender === "M" || r.gender === "F") {
    if (e.gender == null) out.push(block(`gender:${r.gender}:missing`, "Choose man or woman", true));
    else if (e.gender !== r.gender) out.push(block(`gender:${r.gender}`, r.gender === "M" ? "Men only" : "Women only"));
  }

  if (r.ageMin != null || r.ageMax != null) {
    const on = r.ageOn ?? opts.fallbackOn ?? null;
    const age = on ? ageOnISO(e.dob, on) : null;
    const when = opts.dated && r.ageOn ? ` (on ${dateLabel(r.ageOn)})` : "";
    if (r.ageMin != null && (age == null || age < r.ageMin)) {
      out.push(block(`age:min:${r.ageMin}`, `Age ${r.ageMin}+ only${when}`, age == null));
    }
    if (r.ageMax != null && (age == null || age > r.ageMax)) {
      out.push(block(`age:max:${r.ageMax}`, `Age ${r.ageMax} and under only${when}`, age == null));
    }
    /* The record says something else. Not a refusal — neither number is proof,
       and the newer one is often the correction — but the organiser is the one
       who can ask, so they are told rather than left with a rule judged on a
       date the app itself contradicts. Never on the public form: `storedDob`
       is only set where the record counted, and telling an entrant what is on
       file for a number they typed would hand out somebody else's details. */
    if (e.storedDob) {
      out.push({
        code: "dob:mismatch",
        text: `Date of birth typed here (${dateLabel(e.dob!)}) is not the one on file`,
        missing: false,
        severity: "note",
      });
    }
  }

  return out;
}

/* ── Judging a team ───────────────────────────────────────────────────────*/

/**
 * The smallest squad that already counts as a team — the event's minimum, and
 * never fewer than two, because "Mixed" means nothing for one person.
 *
 * ONE definition, used by the organiser's add-player check AND by the
 * "doesn't fit" flags. They had two, and the two disagreed: adding a second man
 * to a min-2/max-6 Mixed team was allowed (the check waited for six) and the
 * card then went red on the very next render (the flags judged it complete at
 * two) — with nothing on `rules_waived`, and no way to put anything there,
 * because the organiser was never stopped and so was never offered the tick.
 * Faisal's decision is that a team shown in red is a team the organiser was
 * asked about first.
 */
export const squadIsComplete = (size: number, minTeamSize: number): boolean =>
  size >= Math.max(2, minTeamSize);

/**
 * The rules that belong to the team rather than to anybody on it. Today that is
 * Mixed: at least one man and one woman.
 *
 * `complete: false` is an organiser adding players one at a time: a lone man is
 * not yet a problem, because his partner may be a woman. It fails once the
 * squad is big enough to take the court with one gender in it — `squadIsComplete`,
 * the same line the flags use.
 */
export function squadFailures(
  genders: (Gender | null)[],
  r: Rules | null | undefined,
  opts: { complete: boolean; minTeamSize: number },
): Failure[] {
  if (!r || r.gender !== "MX") return [];
  if (genders.some((g) => g == null)) {
    return [block("team:mixed:missing", "Mixed needs every player marked man or woman.", true)];
  }
  const both = genders.includes("M") && genders.includes("F");
  if (both) return [];
  if (!opts.complete && !squadIsComplete(genders.length, opts.minTeamSize)) return [];
  return [block("team:mixed", "Mixed needs at least one man and one woman.")];
}

export type EntryVerdict = {
  /** False when any player or the team breaks a rule. Notes do not count. */
  ok: boolean;
  team: Failure[];
  /** Per player, in the order given — blocks AND notes. */
  players: Failure[][];
};

export function entryFailures(
  squad: Evidence[],
  r: Rules | null | undefined,
  opts: { complete: boolean; minTeamSize: number; fallbackOn?: string; dated?: boolean },
): EntryVerdict {
  const players = squad.map((e) => personFailures(e, r, opts));
  const team = squadFailures(squad.map((e) => e.gender), r, opts);
  const ok = team.every((f) => f.severity !== "block") && players.every((fs) => fs.every((f) => f.severity !== "block"));
  return { ok, team, players };
}

/* ── What the organiser let in anyway ─────────────────────────────────────*/

/**
 * One line of `teams.rules_waived`: the RULE that was broken and the player row
 * it was broken by, never the sentence shown on screen.
 *
 * The sentence moves with the evidence, and that silently undid the organiser's
 * decision. An unrated player refused by "Rating 1200+ only (unrated)" was
 * waived under exactly that wording; the moment the player had a number — a
 * seed placed by the same form, or one match played — the flags produced
 * "Rating 1200+ only" instead, which the stored line did not match, so the team
 * went red again with nobody having changed anything. The code does not move,
 * and `:unrated`/`:missing` is dropped from it because a waiver is about the
 * rule, not about which piece of evidence happened to be absent when it was
 * given. A rule TIGHTENED later is a different bound, so a different code, so
 * still red — which is the behaviour Faisal asked for.
 *
 * Keyed on the player row rather than the name, so two people called Rahul on
 * one team are waived separately.
 */
export const waiverLine = (f: Failure, playerId: string | null): string =>
  `${f.code.replace(/:(unrated|missing)$/, "")}\t${playerId ?? ""}`;

/* ── Reading and describing a category's rules ────────────────────────────*/

export function rulesOfDivision(
  d: Pick<Division, "genderRule" | "ageMin" | "ageMax" | "ageOn" | "ratingMin" | "ratingMax" | "duprMin" | "duprMax">,
): Rules {
  return {
    gender: d.genderRule ?? null,
    ageMin: d.ageMin ?? null,
    ageMax: d.ageMax ?? null,
    ageOn: d.ageOn ?? null,
    ratingMin: d.ratingMin ?? null,
    ratingMax: d.ratingMax ?? null,
    duprMin: d.duprMin ?? null,
    duprMax: d.duprMax ?? null,
  };
}

/** A community game's restrictions, in the same terms. Ages count on the day. */
export function rulesOfRestrictions(r: Restrictions): Rules {
  return {
    gender: r.gender,
    ageMin: r.ageMin, ageMax: r.ageMax, ageOn: null,
    ratingMin: r.gsrMin, ratingMax: r.gsrMax,
    duprMin: r.duprMin, duprMax: r.duprMax,
  };
}

export const hasRules = (r: Rules | null | undefined): boolean =>
  !!r && (r.gender != null || r.ageMin != null || r.ageMax != null ||
    r.ratingMin != null || r.ratingMax != null || r.duprMin != null || r.duprMax != null);

/**
 * What the entry form must ask for, because the rules cannot be judged without
 * it. A category with no rules needs nothing new, which is what keeps its form
 * exactly as it was.
 *
 * `phone` is true whenever there is a RATING limit. The phone number is how an
 * entrant is matched to their rating; left optional, leaving it blank would be
 * a way to look unrated and walk into a capped category.
 */
export function needsFrom(r: Rules | null | undefined): { gender: boolean; dob: boolean; dupr: boolean; phone: boolean } {
  return {
    gender: !!r?.gender,
    dob: r?.ageMin != null || r?.ageMax != null,
    dupr: r?.duprMin != null || r?.duprMax != null,
    phone: r?.ratingMin != null || r?.ratingMax != null,
  };
}

/* A tier name only where the bound sits exactly on a tier edge — the screen
   offers tiers, so that is the normal case. A hand-set 800 is shown as 800
   rather than rounded into a tier it does not match. */
const tierFrom = (n: number) => TIERS.find((t) => t.min === n)?.name ?? null;
const tierTo = (n: number) => TIERS.find((t) => t.max === n)?.name ?? null;

/**
 * The rules in one plain paragraph — under the controls as they change, and on
 * the public page under the category picker. The same words in both places, so
 * the organiser reads exactly what entrants will.
 */
export function rulesSentence(r: Rules | null | undefined): string {
  if (!hasRules(r)) return "Open: anyone can enter.";
  const rules = r!;
  const parts: string[] = [];

  if (rules.gender === "M") parts.push("Men only.");
  if (rules.gender === "F") parts.push("Women only.");
  if (rules.gender === "MX") parts.push("At least one man and one woman per team.");

  if (rules.ageMin != null || rules.ageMax != null) {
    const on = rules.ageOn ? ` on ${dateLabel(rules.ageOn)}` : "";
    if (rules.ageMin != null && rules.ageMax != null) parts.push(`Age ${rules.ageMin} to ${rules.ageMax}${on}.`);
    else if (rules.ageMin != null) parts.push(`Age ${rules.ageMin} or older${on}.`);
    else parts.push(`Age ${rules.ageMax} or younger${on}.`);
  }

  if (rules.ratingMin != null || rules.ratingMax != null) {
    const lo = rules.ratingMin != null ? tierFrom(rules.ratingMin) : null;
    const hi = rules.ratingMax != null ? tierTo(rules.ratingMax) : null;
    if (rules.ratingMin != null && rules.ratingMax != null) {
      parts.push(`Rating ${rules.ratingMin} to ${rules.ratingMax}${lo && hi ? ` (${lo} to ${hi})` : ""}.`);
    } else if (rules.ratingMin != null) {
      parts.push(`Rating ${rules.ratingMin} or higher${lo ? ` (${lo} and above)` : ""}.`);
    } else {
      parts.push(`Rating ${rules.ratingMax} or lower${hi ? ` (up to ${hi})` : ""}.`);
    }
  }

  if (rules.duprMin != null && rules.duprMax != null) parts.push(`DUPR ${duprLabel(rules.duprMin)} to ${duprLabel(rules.duprMax)}.`);
  else if (rules.duprMin != null) parts.push(`DUPR ${duprLabel(rules.duprMin)} or higher.`);
  else if (rules.duprMax != null) parts.push(`DUPR ${duprLabel(rules.duprMax)} or lower.`);

  if (rules.ratingMin != null || rules.ratingMax != null) {
    parts.push("A phone number is needed so we can find each player's rating.");
  }
  return parts.join(" ");
}

/** The short tags beside a category's name. Empty for a category with no rules. */
export function ruleChips(r: Rules | null | undefined): string[] {
  if (!hasRules(r)) return [];
  const rules = r!;
  const out: string[] = [];

  if (rules.gender === "M") out.push("Men only");
  if (rules.gender === "F") out.push("Women only");
  if (rules.gender === "MX") out.push("Mixed");

  if (rules.ageMin != null && rules.ageMax != null) out.push(`Age ${rules.ageMin}–${rules.ageMax}`);
  else if (rules.ageMin != null) out.push(`${rules.ageMin}+`);
  else if (rules.ageMax != null) out.push(`${rules.ageMax} and under`);

  if (rules.ratingMin != null && rules.ratingMax != null) {
    const lo = tierFrom(rules.ratingMin);
    const hi = tierTo(rules.ratingMax);
    out.push(lo && hi ? `${lo} to ${hi}` : `Rating ${rules.ratingMin}–${rules.ratingMax}`);
  } else if (rules.ratingMin != null) {
    const lo = tierFrom(rules.ratingMin);
    out.push(lo ? `${lo} and above` : `Rating ${rules.ratingMin}+`);
  } else if (rules.ratingMax != null) {
    const hi = tierTo(rules.ratingMax);
    out.push(hi ? `Up to ${hi}` : `Rating up to ${rules.ratingMax}`);
  }

  if (rules.duprMin != null && rules.duprMax != null) out.push(`DUPR ${duprLabel(rules.duprMin)}–${duprLabel(rules.duprMax)}`);
  else if (rules.duprMin != null) out.push(`DUPR ${duprLabel(rules.duprMin)}+`);
  else if (rules.duprMax != null) out.push(`DUPR up to ${duprLabel(rules.duprMax)}`);

  return out;
}

/* ── Starting points ──────────────────────────────────────────────────────
 * Picked when adding a category, so the common ones need no typing. An age
 * preset leaves `ageOn` to the caller, which knows the event's date. */

export type PresetId = "open" | "mens" | "womens" | "mixed" | "age35" | "age50" | "u17";

export const PRESETS: { id: PresetId; label: string; hint?: string; rules: Partial<Rules> }[] = [
  { id: "open", label: "Open", hint: "anyone", rules: {} },
  { id: "mens", label: "Men’s", rules: { gender: "M" } },
  { id: "womens", label: "Women’s", rules: { gender: "F" } },
  { id: "mixed", label: "Mixed", hint: "1 man + 1 woman", rules: { gender: "MX" } },
  { id: "age35", label: "35+", rules: { ageMin: 35 } },
  { id: "age50", label: "50+", rules: { ageMin: 50 } },
  { id: "u17", label: "Under-17", hint: "16 and under", rules: { ageMax: 16 } },
];

/* ── Reading the organiser's form ─────────────────────────────────────────*/

export type RulesInput = {
  gender?: string | null;
  ageMin?: string | null;
  ageMax?: string | null;
  ageOn?: string | null;
  ratingMin?: string | null;
  ratingMax?: string | null;
  duprMin?: string | null;
  duprMax?: string | null;
};

export type RulesProblem = { field: keyof RulesInput; message: string };

/**
 * The organiser's controls, checked and turned into rules.
 *
 * A minimum above its maximum is REFUSED, not quietly swapped: swapping guesses
 * which of the two numbers was the mistake. The same limits are CHECKs in the
 * database (migration 0018); saying so here first gives the organiser a sentence
 * instead of a failed save.
 */
export function parseRules(
  input: RulesInput,
  ctx: { maxTeamSize: number },
): { ok: true; rules: Rules } | { ok: false; problems: RulesProblem[] } {
  const problems: RulesProblem[] = [];
  const text = (v: string | null | undefined) => String(v ?? "").trim();

  const whole = (field: keyof RulesInput, lo: number, hi: number, label: string): number | null => {
    const s = text(input[field]);
    if (!s) return null;
    const n = Number(s);
    if (!Number.isInteger(n) || n < lo || n > hi) {
      problems.push({ field, message: `${label} must be a whole number from ${lo} to ${hi}.` });
      return null;
    }
    return n;
  };

  const g = text(input.gender);
  const gender: GenderRule | null = g === "M" || g === "F" || g === "MX" ? g : null;
  if (gender === "MX" && ctx.maxTeamSize < 2) {
    problems.push({ field: "gender", message: "Mixed needs teams of at least two. Change the team size first." });
  }

  const ageMin = whole("ageMin", 0, 120, "Youngest age");
  const ageMax = whole("ageMax", 0, 120, "Oldest age");
  if (ageMin != null && ageMax != null && ageMin > ageMax) {
    problems.push({ field: "ageMin", message: "Youngest age is above oldest age." });
  }
  const onRaw = text(input.ageOn);
  const ageOn = onRaw ? parseISODate(onRaw) && onRaw : null;
  if (onRaw && !ageOn) problems.push({ field: "ageOn", message: "Choose a real date to count ages on." });
  if ((ageMin != null || ageMax != null) && !onRaw) {
    problems.push({ field: "ageOn", message: "Choose the date ages are counted on." });
  }

  const ratingMin = whole("ratingMin", 0, 9999, "Lowest rating");
  const ratingMax = whole("ratingMax", 0, 9999, "Highest rating");
  if (ratingMin != null && ratingMax != null && ratingMin > ratingMax) {
    problems.push({ field: "ratingMin", message: "Lowest rating level is above the highest." });
  }

  const dupr = (field: "duprMin" | "duprMax"): number | null => {
    const s = text(input[field]);
    if (!s) return null;
    const x = duprToX100(s);
    if (x == null) problems.push({ field, message: "DUPR must be between 1.00 and 8.00." });
    return x;
  };
  const duprMin = dupr("duprMin");
  const duprMax = dupr("duprMax");
  if (duprMin != null && duprMax != null && duprMin > duprMax) {
    problems.push({ field: "duprMin", message: "Lowest DUPR is above the highest." });
  }

  if (problems.length) return { ok: false, problems };
  return {
    ok: true,
    rules: {
      gender, ageMin, ageMax,
      /* A date with no age bound means nothing; not stored, so it cannot go
         stale in the background and surprise somebody later. */
      ageOn: ageMin != null || ageMax != null ? (ageOn as string) : null,
      ratingMin, ratingMax, duprMin, duprMax,
    },
  };
}
