import "server-only";

/* The global roster.
 *
 * A RISE Rating is a reference for player skill, so it has to follow the
 * player. That means one record per PERSON, matched when an organiser adds
 * them to an event — which is the whole reason this module exists.
 *
 * ── Phone as the key ─────────────────────────────────────────────────────
 * It is the identifier a club player actually knows, it is stable, and it is
 * already the login id for when auth ships. It is stored UNVERIFIED: an
 * organiser adding someone to a draw is asserting "same Rahul as last week",
 * which needs no OTP and costs nothing. Verification belongs to the day a
 * player claims their own profile, so SMS spend scales with engaged players
 * rather than roster size.
 *
 * Nullable, because some people will not give one. They still get a rating —
 * it simply cannot follow them to another club, and the UI says so rather than
 * pretending otherwise.
 */

import { and, eq, ilike, inArray, isNotNull, or, sql, type SQL } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { people, players, type Person } from "@/lib/db/schema";
import { DEFAULT_SEED, seedFromDupr, getTier, sportRating, startingRating, type Tier } from "@/lib/rating";
import { DEFAULT_SPORT, usesDupr, type SportId } from "@/lib/sports/registry";

/**
 * Normalise a phone number to E.164-ish for MATCHING.
 *
 * The job here is that the same human typed two ways lands on one record:
 * "98765 43210", "+91 98765 43210" and "098765-43210" are one person. Anything
 * that cannot be made sense of returns null and is stored as no phone at all,
 * which is honest — a half-parsed number that matches the wrong person is worse
 * than none.
 *
 * `defaultCountry` is the dialling code assumed for a bare local number.
 */
export function normalisePhone(raw: string | null | undefined, defaultCountry = "91"): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hadPlus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (hadPlus) return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;

  /* A leading 0 is a domestic trunk prefix, not part of the number. */
  digits = digits.replace(/^0+/, "");
  if (!digits) return null;

  /* Already carries the country code (e.g. 919876543210 for India). */
  if (digits.startsWith(defaultCountry) && digits.length > 10) return `+${digits}`;
  if (digits.length === 10) return `+${defaultCountry}${digits}`;
  return digits.length >= 8 && digits.length <= 15 ? `+${digits}` : null;
}

/** Never show a full number on a page: "+919876543210" → "…3210". */
export const maskPhone = (phone: string | null): string | null =>
  phone ? `…${phone.slice(-4)}` : null;

export type PersonSummary = {
  id: string;
  name: string;
  gender: "M" | "F";
  phoneMasked: string | null;
  hasPhone: boolean;
  rating: number | null;
  tier: Tier | null;
  reliability: number | null;
  lastPlayedAt: Date | null;
  /** Events this person already appears in — what tells two Rahuls apart. */
  appearances: number;
};

/** A person at a glance, with their rating IN ONE SPORT — the sport of the
    event or game they are being picked for (2026-09-21: a rating is specific
    to its sport). */
export const summarise = (p: Person, appearances = 0, sport: string = DEFAULT_SPORT): PersonSummary => {
  const rating = sportRating(p, sport);
  return {
    id: p.id,
    name: p.name,
    gender: p.gender,
    phoneMasked: maskPhone(p.phone),
    hasPhone: !!p.phone,
    rating,
    tier: rating == null ? null : getTier(rating),
    reliability: p.reliability,
    lastPlayedAt: p.lastPlayedAt,
    appearances,
  };
};

/* ── The same ratings, in SQL, for sorting and filtering a list ───────────
 *
 * `sportRating` and `formatRating` (lib/rating) decide what a person's rating
 * in one sport, or one format, IS. A list sorted by it has to ask the database
 * the same question, and these ask it — a test holds the two languages to the
 * same answer, because two definitions of "the rating" drift.
 *
 *  - A correlated subquery over `jsonb_each_text`, matching keys by PREFIX
 *    (`starts_with`), so it cannot miss a key the registry does not list —
 *    exactly as `startsWith` does in TypeScript.
 *  - The sport and the key are BOUND parameters, never `sql.raw`: they come
 *    from the URL. Callers check them against the registry first as well.
 *  - Not the `?` jsonb operator, which several Postgres drivers read as a
 *    placeholder (CLAUDE.md, "The player pages").
 *  - Use these to FILTER and SORT only. The number shown on the page comes from
 *    the TypeScript on the loaded row: a computed numeric can arrive as a
 *    string from postgres-js and a number from PGlite, and no local test would
 *    ever see the difference.
 */
const counted = (key: SQL) =>
  sql`(coalesce((${people.matchCount} ->> ${key})::numeric, 0) > 0 or ${people.seedSource} in ('dupr', 'organiser'))`;

/** A person's rating in one sport, as SQL. Null when they have none. */
export const sportRatingSql = (sport: string): SQL<number | null> => sql<number | null>`(
  select max(r.value::numeric)
  from jsonb_each_text(${people.riseRatings}) as r(key, value)
  where starts_with(r.key, ${`${sport}:`}) and ${counted(sql`r.key`)}
)`;

/** A person's rating in one format ("pb:md"), as SQL. Null when it does not count. */
export const formatRatingSql = (key: string): SQL<number | null> =>
  sql<number | null>`(case when ${counted(sql`${key}`)} then (${people.riseRatings} ->> ${key})::numeric end)`;

/**
 * Search the roster so an organiser can pick the right person.
 *
 * Returns enough to disambiguate — rating, reliability, when they last played
 * and how many events they appear in. A bare list of names would guarantee
 * mis-picks the moment two people share one. The rating is the one in `sport`.
 */
export async function searchPeople(query: string, limit = 10, sport: string = DEFAULT_SPORT): Promise<PersonSummary[]> {
  const q = query.trim();
  if (q.length < 2) return [];

  const phone = normalisePhone(q);
  const rows = await db
    .select()
    .from(people)
    .where(
      phone
        ? or(eq(people.phone, phone), ilike(people.name, `%${q}%`))
        : ilike(people.name, `%${q}%`),
    )
    .limit(limit);

  if (rows.length === 0) return [];

  const counts = await db
    .select({ personId: players.personId, n: sql<number>`count(*)::int` })
    .from(players)
    .where(isNotNull(players.personId))
    .groupBy(players.personId);
  const byId = new Map(counts.map((c) => [c.personId, c.n]));

  return rows.map((p) => summarise(p, byId.get(p.id) ?? 0, sport));
}

/** An exact-phone lookup. The only match that is safe to make automatically. */
export async function findByPhone(rawPhone: string): Promise<Person | null> {
  const phone = normalisePhone(rawPhone);
  if (!phone) return null;
  const [row] = await db.select().from(people).where(eq(people.phone, phone)).limit(1);
  return row ?? null;
}

/**
 * Everyone behind a list of phone numbers, in ONE query, keyed by the
 * normalised number.
 *
 * For checking a whole entry, or a whole list of entries, against a category's
 * rules. One `findByPhone` per player would be a query per player — and fired
 * together, a fan-out that grows with the entry, which is the shape that wedged
 * the site on 2026-09-15 (see lib/db/index.ts).
 */
export async function peopleByPhones(raw: (string | null | undefined)[]): Promise<Map<string, Person>> {
  const phones = [...new Set(raw.map((p) => normalisePhone(p)).filter((p): p is string => !!p))];
  if (phones.length === 0) return new Map();
  const rows = await db.select().from(people).where(inArray(people.phone, phones));
  return new Map(rows.map((p) => [p.phone!, p]));
}

export type NewPersonInput = {
  name: string;
  gender: "M" | "F";
  phone?: string | null;
  /** DUPR as entered, e.g. 3.75. Converted once, then RiseR moves on its own. */
  dupr?: number | null;
  /** A §12.2 placement band, when there is no DUPR. */
  bandSeed?: number | null;
  /** Which format the seed applies to, e.g. "pb:md". */
  formatKey: string;
  seededBy?: string | null;
};

/**
 * Create a person with a starting rating, per spec §3.
 *
 * Order matters: a verified DUPR beats an organiser's guess, and an
 * organiser's guess beats the default. Whichever was used is recorded, along
 * with who chose it, because §3 requires an organiser-set seed to be
 * attributable — a rating nobody can account for is not a reference.
 */
export async function createPerson(input: NewPersonInput): Promise<Person> {
  const [row] = await db
    .insert(people)
    .values(newPersonRow(input, normalisePhone(input.phone)))
    .returning();
  return row;
}

/* The row a new person starts as. One definition, because `createPerson` and
   the race-safe insert in `findOrCreatePerson` must seed a rating identically —
   two copies would drift, and a person's starting rating would then depend on
   which path happened to create them. */
function newPersonRow(input: NewPersonInput, phone: string | null): typeof people.$inferInsert {
  /* DUPR is a pickleball rating, so it seeds a pickleball key and nothing
     else. Every form hides the box outside pickleball; this is the last line,
     because a badminton key seeded from one would start a badminton player at
     their pickleball level, and nothing downstream could tell. */
  const dupr = input.dupr != null && usesDupr(input.formatKey.split(":")[0] as SportId) ? input.dupr : null;

  const seed =
    dupr != null ? seedFromDupr(dupr)
    : input.bandSeed != null ? input.bandSeed
    : DEFAULT_SEED;

  const seedSource: Person["seedSource"] =
    dupr != null ? "dupr" : input.bandSeed != null ? "organiser" : "default";

  return {
    id: randomUUID(),
    phone,
    name: input.name.trim(),
    gender: input.gender,
    riseRatings: { [input.formatKey]: seed },
    riseBest: seed,
    matchCount: {},
    /* Deliberately null, not 0: nobody has a reliability score before they
       have played. Zero would read as "known to be unreliable". */
    reliability: null,
    dupr: dupr != null ? Math.round(dupr * 100) : null,
    duprEnteredAt: dupr != null ? new Date() : null,
    seedSource,
    seededBy: input.seededBy ?? null,
  };
}

/**
 * The organiser's normal path: reuse the person if the phone already exists,
 * otherwise create them.
 *
 * Matching is by PHONE ONLY. Auto-matching on name would silently merge two
 * different players, and merging ratings wrongly is far harder to undo than
 * creating a duplicate — so a name collision is left for the organiser to
 * resolve by picking from `searchPeople`.
 *
 * ── Two callers, one phone, at the same moment ───────────────────────────
 * "Look it up, and if nobody has it, insert" is two statements, and two
 * requests can both finish the look-up before either inserts. The second insert
 * then hits `people_phone_idx`, which is UNIQUE, and throws — so an approval, or
 * an organiser adding a player, failed outright with a database error. Approval
 * used to trigger this on its own: it looked up every entrant at once, so a pair
 * who gave the same contact phone raced itself.
 *
 * The index is the arbiter rather than a lock or a retry. The insert does
 * nothing on a phone conflict, and whoever loses reads back the row the winner
 * wrote. On Postgres the losing insert waits for the winner's commit before
 * deciding, so the read-back always finds it; on PGlite the two simply run one
 * after the other. Either way there is one person and nobody sees an error.
 */
export async function findOrCreatePerson(
  input: NewPersonInput,
): Promise<{ person: Person; created: boolean }> {
  const phone = normalisePhone(input.phone);
  /* No phone means nothing to collide on: a phoneless person is always new. */
  if (!phone) return { person: await createPerson(input), created: true };

  const existing = await findByPhone(phone);
  if (existing) return { person: existing, created: false };

  const [made] = await db
    .insert(people)
    .values(newPersonRow(input, phone))
    .onConflictDoNothing({ target: people.phone })
    .returning();
  if (made) return { person: made, created: true };

  const winner = await findByPhone(phone);
  /* A conflict means the row exists, so this cannot be null unless it was
     deleted in the instant between — worth an error that says so, rather than
     a person-shaped undefined further down. */
  if (!winner) throw new Error(`The person with phone ${maskPhone(phone)} was removed while being added.`);
  return { person: winner, created: false };
}

/** The rating this person brings INTO an event, for the format being played.
    Their level in THIS sport, never another's — see `startingRating`. */
export function carriedRating(person: Person, sport: string, format: string): number {
  return startingRating(person, sport, format);
}

/** Everywhere a person appears in a tournament. Used to seed draws by skill. */
export async function peopleForTournament(tournamentId: string): Promise<Map<string, Person>> {
  const rows = await db
    .select({ person: people })
    .from(players)
    .innerJoin(people, eq(players.personId, people.id))
    .where(and(eq(players.tournamentId, tournamentId), isNotNull(players.personId)));
  return new Map(rows.map((r) => [r.person.id, r.person]));
}
