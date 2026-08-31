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

import { and, eq, ilike, isNotNull, or, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { people, players, type Person } from "@/lib/db/schema";
import { DEFAULT_SEED, seedFromDupr, getTier, type Tier } from "@/lib/rating";
import { ratingKey } from "@/lib/sports/registry";

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

export const summarise = (p: Person, appearances = 0): PersonSummary => ({
  id: p.id,
  name: p.name,
  gender: p.gender,
  phoneMasked: maskPhone(p.phone),
  hasPhone: !!p.phone,
  rating: p.riseBest,
  tier: p.riseBest == null ? null : getTier(p.riseBest),
  reliability: p.reliability,
  lastPlayedAt: p.lastPlayedAt,
  appearances,
});

/**
 * Search the roster so an organiser can pick the right person.
 *
 * Returns enough to disambiguate — rating, reliability, when they last played
 * and how many events they appear in. A bare list of names would guarantee
 * mis-picks the moment two people share one.
 */
export async function searchPeople(query: string, limit = 10): Promise<PersonSummary[]> {
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

  return rows.map((p) => summarise(p, byId.get(p.id) ?? 0));
}

/** An exact-phone lookup. The only match that is safe to make automatically. */
export async function findByPhone(rawPhone: string): Promise<Person | null> {
  const phone = normalisePhone(rawPhone);
  if (!phone) return null;
  const [row] = await db.select().from(people).where(eq(people.phone, phone)).limit(1);
  return row ?? null;
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
  const phone = normalisePhone(input.phone);

  const seed =
    input.dupr != null ? seedFromDupr(input.dupr)
    : input.bandSeed != null ? input.bandSeed
    : DEFAULT_SEED;

  const seedSource: Person["seedSource"] =
    input.dupr != null ? "dupr" : input.bandSeed != null ? "organiser" : "default";

  const [row] = await db
    .insert(people)
    .values({
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
      dupr: input.dupr != null ? Math.round(input.dupr * 100) : null,
      duprEnteredAt: input.dupr != null ? new Date() : null,
      seedSource,
      seededBy: input.seededBy ?? null,
    })
    .returning();

  return row;
}

/**
 * The organiser's normal path: reuse the person if the phone already exists,
 * otherwise create them.
 *
 * Matching is by PHONE ONLY. Auto-matching on name would silently merge two
 * different players, and merging ratings wrongly is far harder to undo than
 * creating a duplicate — so a name collision is left for the organiser to
 * resolve by picking from `searchPeople`.
 */
export async function findOrCreatePerson(
  input: NewPersonInput,
): Promise<{ person: Person; created: boolean }> {
  const phone = normalisePhone(input.phone);
  if (phone) {
    const existing = await findByPhone(phone);
    if (existing) return { person: existing, created: false };
  }
  return { person: await createPerson(input), created: true };
}

/** The rating this person brings INTO an event, for the format being played. */
export function carriedRating(person: Person, sport: string, format: string): number {
  const key = ratingKey(sport as never, format);
  return person.riseRatings?.[key] ?? person.riseBest ?? DEFAULT_SEED;
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
