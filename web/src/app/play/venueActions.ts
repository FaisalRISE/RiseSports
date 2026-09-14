"use server";

/* Server Actions for venues.
 *
 * Same authorisation split as community play: who you are comes from the
 * cookie, never the form, and anything only the venue's host may do re-reads
 * the venue and checks its owner.
 */

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { OPEN_ACCESS } from "@/lib/auth/access";
import { myPersonId } from "@/lib/community/me";
import * as v from "@/lib/venues";
import type { Venue } from "@/lib/db/schema";

export type VenueActionResult = { ok: true } | { ok: false; error: string };
const fail = (error: string): VenueActionResult => ({ ok: false, error });

const idSchema = z.string().trim().min(1).max(64);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a date.");
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

/* ── Listing one ──────────────────────────────────────────────────────────*/

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the venue a name.").max(80),
  area: z.string().trim().max(80),
  courts: z.coerce.number().int().min(1).max(50),
  openTime: z.string().regex(HHMM, "Opening time must look like 06:00."),
  closeTime: z.string().regex(HHMM, "Closing time must look like 22:00."),
  price: z.union([z.string(), z.number()]).transform((x) => {
    const n = Number(String(x).trim());
    return Number.isFinite(n) && n > 0 ? n : 0;
  }),
});

export async function createVenueAction(formData: FormData): Promise<VenueActionResult> {
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    area: formData.get("area") ?? "",
    courts: formData.get("courts"),
    openTime: formData.get("openTime"),
    closeTime: formData.get("closeTime"),
    price: formData.get("price") ?? 0,
  });
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the form.");

  const d = parsed.data;
  await v.createVenue({
    name: d.name,
    area: d.area,
    courts: d.courts,
    openTime: d.openTime,
    closeTime: d.closeTime,
    /* Rupees per hour in the form, integer paise in the database. */
    pricePaise: Math.round(d.price * 100),
    ownerPersonId: await myPersonId(),
  });

  revalidatePath("/play");
  return { ok: true };
}

/* ── Booking ──────────────────────────────────────────────────────────────*/

export async function requestBookingAction(
  venueSlug: string, date: string, slot: string, guestName: string,
): Promise<VenueActionResult> {
  const s = idSchema.safeParse(venueSlug);
  const dt = dateSchema.safeParse(date);
  const sl = z.string().trim().min(1).max(20).safeParse(slot);
  if (!s.success || !dt.success || !sl.success) return fail("Check the date and time.");

  const venue = await v.venueBySlug(s.data);
  if (!venue) return fail("No such venue.");

  /* The person id comes from the cookie. A booking made while signed in is
     attributable and cancellable; a guest booking is neither, which is why the
     name box only appears when the app does not know who you are. */
  const personId = await myPersonId();
  const name = z.string().trim().max(60).catch("").parse(guestName);

  const res = await v.requestBooking(venue, {
    date: dt.data, slot: sl.data, personId, guestName: name,
  });
  revalidatePath("/play");
  return res;
}

/** Load a venue and assert the caller runs it. */
async function ownerGuard(slug: string): Promise<Venue> {
  const venue = await v.venueBySlug(slug);
  if (!venue) throw new Error("No such venue.");
  if (OPEN_ACCESS) return venue;
  if (!v.isVenueOwner(venue, await myPersonId())) throw new Error("Only the venue host can do that.");
  return venue;
}

export async function decideBookingAction(
  venueSlug: string, bookingId: string, approve: boolean,
): Promise<VenueActionResult> {
  const s = idSchema.safeParse(venueSlug);
  const b = idSchema.safeParse(bookingId);
  if (!s.success || !b.success) return fail("Bad request.");

  let venue;
  try {
    venue = await ownerGuard(s.data);
  } catch (e) {
    return fail(e instanceof Error ? e.message : "Not allowed.");
  }

  const res = approve
    ? await v.confirmBooking(venue, b.data)
    : await v.declineBooking(venue, b.data);
  revalidatePath("/play");
  return res;
}

/** Take back a booking you made yourself. */
export async function cancelBookingAction(
  venueSlug: string, bookingId: string,
): Promise<VenueActionResult> {
  const s = idSchema.safeParse(venueSlug);
  const b = idSchema.safeParse(bookingId);
  if (!s.success || !b.success) return fail("Bad request.");

  const venue = await v.venueBySlug(s.data);
  if (!venue) return fail("No such venue.");

  const res = await v.cancelBooking(venue, b.data, await myPersonId());
  revalidatePath("/play");
  return res;
}
