import "server-only";

/* Venues — a court somebody hosts, and the requests to use it.
 *
 * Ported from `VenuesSection` (app.source.js:8963-9220). In the legacy app this
 * renders INSIDE the Play tab, and it stays there: a venue is where community
 * play happens, not a separate part of the product.
 *
 * Payments are settled directly between the player and the venue, outside the
 * app. That is a deliberate design decision in the original, not an omission —
 * the price is shown so both sides know what they are agreeing to, and nothing
 * here moves money.
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  people, venueBookings, venues,
  type BookingStatus, type Person, type Venue, type VenueBooking,
} from "@/lib/db/schema";
import { halfHourSlots } from "@/lib/community/rotations";
import { slugifyGame } from "@/lib/community";

export type VenueResult = { ok: true } | { ok: false; error: string };
const no = (error: string): VenueResult => ({ ok: false, error });

/* ── Reading ──────────────────────────────────────────────────────────────*/

export async function listVenues(): Promise<Venue[]> {
  return db.select().from(venues).where(isNull(venues.archivedAt)).orderBy(desc(venues.createdAt));
}

export async function venueBySlug(slug: string): Promise<Venue | null> {
  const [v] = await db.select().from(venues).where(eq(venues.slug, slug)).limit(1);
  return v ?? null;
}

/** The bookable half hours, from the venue's own opening hours. */
export const slotsFor = (venue: Venue): string[] => halfHourSlots(venue.openTime, venue.closeTime);

export type BookingView = {
  id: string;
  date: string;
  slot: string;
  who: string;
  status: BookingStatus;
  personId: string | null;
};

/**
 * Every live booking for a venue, soonest first.
 *
 * Declined ones are dropped rather than shown greyed out — a venue host wants
 * the list of things still to deal with, and a refused request is not one.
 */
export async function bookingsFor(venue: Venue): Promise<BookingView[]> {
  return (await bookingsForVenues([venue])).get(venue.id) ?? [];
}

/**
 * Live bookings for many venues, in two queries however many venues there are.
 *
 * /play shows every venue with its bookings, and used to ask once per venue with
 * all the requests fired together — a fan-out that grows with the number of
 * venues. Past the pool of eight that pipelines on one socket and wedges the
 * whole instance behind the transaction pooler (the 2026-09-15 outage). So it
 * asks for everything at once and sorts it out in memory.
 *
 * Every venue asked about comes back with an entry, empty if nothing is booked,
 * so a caller reading by id never needs its own fallback.
 */
export async function bookingsForVenues(list: Venue[]): Promise<Map<string, BookingView[]>> {
  const out = new Map<string, BookingView[]>(list.map((v) => [v.id, []]));
  if (list.length === 0) return out;

  /* Ordered here, once, so each venue's slice comes out already soonest first
     — grouping keeps the relative order of rows. */
  const rows = await db
    .select()
    .from(venueBookings)
    .where(inArray(venueBookings.venueId, [...out.keys()]))
    .orderBy(asc(venueBookings.date), asc(venueBookings.slot), asc(venueBookings.createdAt));

  const live = rows.filter((b) => b.status !== "declined");
  const ids = [...new Set(live.map((b) => b.personId).filter((x): x is string => !!x))];
  const folk: Pick<Person, "id" | "name">[] = ids.length
    ? await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, ids))
    : [];
  const nameOf = new Map(folk.map((p) => [p.id, p.name]));

  for (const b of live) {
    out.get(b.venueId)?.push({
      id: b.id,
      date: b.date,
      slot: b.slot,
      /* A linked person's real name wins over whatever was typed in the box. */
      who: (b.personId && nameOf.get(b.personId)) || b.guestName,
      status: b.status,
      personId: b.personId,
    });
  }
  return out;
}

/** How many of the venue's courts are already spoken for in one half hour. */
export function confirmedIn(bookings: BookingView[], date: string, slot: string): number {
  return bookings.filter((b) => b.date === date && b.slot === slot && b.status === "confirmed").length;
}

export const isVenueOwner = (venue: Venue, personId: string | null): boolean =>
  !!personId && venue.ownerPersonId === personId;

/* ── Listing a venue ──────────────────────────────────────────────────────*/

export type NewVenueInput = {
  name: string;
  area: string;
  courts: number;
  openTime: string;
  closeTime: string;
  pricePaise: number;
  ownerPersonId: string | null;
};

export async function createVenue(input: NewVenueInput): Promise<Venue> {
  let slug = slugifyGame(input.name);
  const taken = await db.select({ slug: venues.slug }).from(venues).where(eq(venues.slug, slug));
  if (taken.length) slug = `${slug}-${randomUUID().slice(0, 4)}`;

  const [venue] = await db.insert(venues).values({ id: randomUUID(), slug, ...input }).returning();
  return venue;
}

/* ── Booking ──────────────────────────────────────────────────────────────*/

/**
 * Ask for a half hour.
 *
 * A request is only ever a request — the host decides. So this does NOT check
 * the court count: several people may ask for the same slot and the host picks.
 * The cap lands at confirmation, where it belongs.
 *
 * The legacy version checks nothing at either end (`cp.bookings.push(...)` at
 * :9155) and will happily confirm fifty bookings onto two courts.
 */
export async function requestBooking(
  venue: Venue,
  input: { date: string; slot: string; personId: string | null; guestName: string },
): Promise<VenueResult> {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) return no("Pick a date.");
  if (!slotsFor(venue).includes(input.slot)) {
    return no("That time is outside the venue's opening hours.");
  }

  const who = input.guestName.trim().slice(0, 60) || "Guest";

  try {
    await db.insert(venueBookings).values({
      id: randomUUID(),
      venueId: venue.id,
      date: input.date,
      slot: input.slot,
      personId: input.personId,
      guestName: who,
    });
  } catch {
    /* The unique index on (venue, date, slot, person) — only reachable by a
       linked person, since guests are distinct by a null person id. */
    return no("You have already asked for that time.");
  }
  return { ok: true };
}

/**
 * Confirm one booking, if a court is free in that half hour.
 *
 * Counted inside a transaction against what is currently confirmed, so two
 * taps on the last free court cannot both succeed.
 */
export async function confirmBooking(venue: Venue, bookingId: string): Promise<VenueResult> {
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select()
      .from(venueBookings)
      .where(and(eq(venueBookings.id, bookingId), eq(venueBookings.venueId, venue.id)))
      .limit(1);
    if (!booking) return no("No such booking.");
    if (booking.status === "confirmed") return { ok: true } as VenueResult;

    const taken = await tx
      .select({ id: venueBookings.id })
      .from(venueBookings)
      .where(
        and(
          eq(venueBookings.venueId, venue.id),
          eq(venueBookings.date, booking.date),
          eq(venueBookings.slot, booking.slot),
          eq(venueBookings.status, "confirmed"),
        ),
      );

    if (taken.length >= venue.courts) {
      return no(
        `All ${venue.courts} court${venue.courts === 1 ? "" : "s"} are booked at ${booking.slot}.`,
      );
    }

    await tx
      .update(venueBookings)
      .set({ status: "confirmed", decidedAt: new Date() })
      .where(eq(venueBookings.id, bookingId));
    return { ok: true } as VenueResult;
  });
}

export async function declineBooking(venue: Venue, bookingId: string): Promise<VenueResult> {
  const res = await db
    .update(venueBookings)
    .set({ status: "declined", decidedAt: new Date() })
    .where(and(eq(venueBookings.id, bookingId), eq(venueBookings.venueId, venue.id)))
    .returning({ id: venueBookings.id });
  return res.length ? { ok: true } : no("No such booking.");
}

/** Someone taking back their own request, or giving up a confirmed slot. */
export async function cancelBooking(
  venue: Venue, bookingId: string, personId: string | null,
): Promise<VenueResult> {
  const [booking] = await db
    .select()
    .from(venueBookings)
    .where(and(eq(venueBookings.id, bookingId), eq(venueBookings.venueId, venue.id)))
    .limit(1);
  if (!booking) return no("No such booking.");

  /* Only your own, and only when the app knows who you are — a guest booking
     has nobody to prove ownership, so the venue host cancels those. */
  if (!personId || booking.personId !== personId) {
    return no("You can only cancel a booking you made.");
  }

  await db.delete(venueBookings).where(eq(venueBookings.id, bookingId));
  return { ok: true };
}

export type { Venue, VenueBooking };
