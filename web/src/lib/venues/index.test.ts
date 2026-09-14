import { describe, it, expect, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

const client = new PGlite();
const testDb = drizzle(client, { schema });

vi.mock("@/lib/db", () => ({ db: testDb }));
vi.mock("server-only", () => ({}));

const dir = path.resolve(process.cwd(), "drizzle");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

const v = await import("./index");

const DATE = "2026-09-18";
let venue: schema.Venue;

async function setUp(courts = 2) {
  await testDb.delete(schema.venues);
  await testDb.delete(schema.people);
  await testDb.insert(schema.people).values(
    Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` })),
  );
  return v.createVenue({
    name: "Smash Arena", area: "Bandra", courts,
    openTime: "06:00", closeTime: "08:00", pricePaise: 60000,
    ownerPersonId: "p1",
  });
}

beforeEach(async () => { venue = await setUp(); });

const SLOT = "06:00–06:30";

describe("listing a venue", () => {
  it("gives it a URL key from its name", async () => {
    expect(venue.slug).toBe("smash-arena");
  });

  it("does not collide when two venues share a name", async () => {
    const second = await v.createVenue({
      name: "Smash Arena", area: "Andheri", courts: 1,
      openTime: "06:00", closeTime: "08:00", pricePaise: 0, ownerPersonId: null,
    });
    expect(second.slug).not.toBe(venue.slug);
    expect(second.slug.startsWith("smash-arena-")).toBe(true);
  });

  it("offers half hours across its opening times", async () => {
    expect(v.slotsFor(venue)).toEqual([
      "06:00–06:30", "06:30–07:00", "07:00–07:30", "07:30–08:00",
    ]);
  });

  it("knows who runs it", async () => {
    expect(v.isVenueOwner(venue, "p1")).toBe(true);
    expect(v.isVenueOwner(venue, "p2")).toBe(false);
    expect(v.isVenueOwner(venue, null)).toBe(false);
  });
});

describe("asking for a slot", () => {
  it("records a request from a linked player", async () => {
    expect(await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: "p2", guestName: "" }))
      .toEqual({ ok: true });

    const list = await v.bookingsFor(venue);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ date: DATE, slot: SLOT, who: "Player 2", status: "requested" });
  });

  it("records a guest by the name they typed", async () => {
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: null, guestName: "  Asha  " });
    expect((await v.bookingsFor(venue))[0].who).toBe("Asha");
  });

  it("falls back to Guest rather than an empty name", async () => {
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: null, guestName: "   " });
    expect((await v.bookingsFor(venue))[0].who).toBe("Guest");
  });

  it("refuses a time the venue is not open for", async () => {
    const res = await v.requestBooking(venue, { date: DATE, slot: "23:00–23:30", personId: "p2", guestName: "" });
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("opening hours");
  });

  it("refuses a nonsense date", async () => {
    expect((await v.requestBooking(venue, { date: "next tuesday", slot: SLOT, personId: "p2", guestName: "" })).ok)
      .toBe(false);
  });

  it("stops one person asking for the same half hour twice", async () => {
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: "p2", guestName: "" });
    const again = await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: "p2", guestName: "" });
    expect(again.ok).toBe(false);
    expect(await v.bookingsFor(venue)).toHaveLength(1);
  });

  it("lets several different guests ask for the same half hour", async () => {
    /* They are distinct by a null person id, and the host picks between them —
       the venue has more than one court. */
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: null, guestName: "Asha" });
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: null, guestName: "Ravi" });
    expect(await v.bookingsFor(venue)).toHaveLength(2);
  });

  it("does NOT cap requests at the court count", async () => {
    /* Asking is not taking. Five people may want the same two courts. */
    for (const p of ["p2", "p3", "p4", "p5", "p6"]) {
      expect((await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: p, guestName: "" })).ok).toBe(true);
    }
    expect(await v.bookingsFor(venue)).toHaveLength(5);
  });
});

describe("the host deciding", () => {
  const ask = (p: string, slot = SLOT) =>
    v.requestBooking(venue, { date: DATE, slot, personId: p, guestName: "" });

  it("confirms a booking", async () => {
    await ask("p2");
    const [b] = await v.bookingsFor(venue);
    expect(await v.confirmBooking(venue, b.id)).toEqual({ ok: true });
    expect((await v.bookingsFor(venue))[0].status).toBe("confirmed");
  });

  it("fills every court and then refuses", async () => {
    /* Two courts. The third confirmation in the same half hour must fail —
       the legacy version confirms all of them. */
    for (const p of ["p2", "p3", "p4"]) await ask(p);
    const list = await v.bookingsFor(venue);

    expect((await v.confirmBooking(venue, list[0].id)).ok).toBe(true);
    expect((await v.confirmBooking(venue, list[1].id)).ok).toBe(true);

    const third = await v.confirmBooking(venue, list[2].id);
    expect(third.ok).toBe(false);
    expect(third.ok === false && third.error).toContain("2 courts are booked");

    expect(v.confirmedIn(await v.bookingsFor(venue), DATE, SLOT)).toBe(2);
  });

  it("counts each half hour separately", async () => {
    await ask("p2", "06:00–06:30");
    await ask("p3", "06:30–07:00");
    for (const b of await v.bookingsFor(venue)) {
      expect((await v.confirmBooking(venue, b.id)).ok).toBe(true);
    }
    expect(v.confirmedIn(await v.bookingsFor(venue), DATE, "06:00–06:30")).toBe(1);
    expect(v.confirmedIn(await v.bookingsFor(venue), DATE, "06:30–07:00")).toBe(1);
  });

  it("counts each date separately", async () => {
    await v.requestBooking(venue, { date: "2026-09-18", slot: SLOT, personId: "p2", guestName: "" });
    await v.requestBooking(venue, { date: "2026-09-19", slot: SLOT, personId: "p2", guestName: "" });
    for (const b of await v.bookingsFor(venue)) await v.confirmBooking(venue, b.id);
    expect(v.confirmedIn(await v.bookingsFor(venue), "2026-09-18", SLOT)).toBe(1);
    expect(v.confirmedIn(await v.bookingsFor(venue), "2026-09-19", SLOT)).toBe(1);
  });

  it("frees the court again when a confirmed booking is declined", async () => {
    for (const p of ["p2", "p3", "p4"]) await ask(p);
    const list = await v.bookingsFor(venue);
    await v.confirmBooking(venue, list[0].id);
    await v.confirmBooking(venue, list[1].id);
    expect((await v.confirmBooking(venue, list[2].id)).ok).toBe(false);

    await v.declineBooking(venue, list[0].id);
    expect((await v.confirmBooking(venue, list[2].id)).ok).toBe(true);
  });

  it("drops a declined booking off the list rather than greying it out", async () => {
    await ask("p2");
    const [b] = await v.bookingsFor(venue);
    await v.declineBooking(venue, b.id);
    expect(await v.bookingsFor(venue)).toEqual([]);
    /* …but the row is kept, so the same person cannot immediately re-ask. */
    expect(await testDb.select().from(schema.venueBookings)).toHaveLength(1);
  });

  it("will not touch another venue's booking", async () => {
    const other = await v.createVenue({
      name: "Other Courts", area: "X", courts: 1,
      openTime: "06:00", closeTime: "08:00", pricePaise: 0, ownerPersonId: "p5",
    });
    await ask("p2");
    const [b] = await v.bookingsFor(venue);
    expect((await v.confirmBooking(other, b.id)).ok).toBe(false);
    expect((await v.declineBooking(other, b.id)).ok).toBe(false);
  });
});

describe("two hosts tapping confirm at once", () => {
  it("never puts more on court than there are courts", async () => {
    venue = await setUp(1);
    for (const p of ["p2", "p3", "p4"]) {
      await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: p, guestName: "" });
    }
    const list = await v.bookingsFor(venue);
    await Promise.all(list.map((b) => v.confirmBooking(venue, b.id)));
    expect(v.confirmedIn(await v.bookingsFor(venue), DATE, SLOT)).toBe(1);
  });
});

describe("cancelling your own booking", () => {
  it("lets the person who made it take it back", async () => {
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: "p2", guestName: "" });
    const [b] = await v.bookingsFor(venue);
    expect(await v.cancelBooking(venue, b.id, "p2")).toEqual({ ok: true });
    expect(await v.bookingsFor(venue)).toEqual([]);
  });

  it("refuses somebody else's", async () => {
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: "p2", guestName: "" });
    const [b] = await v.bookingsFor(venue);
    expect((await v.cancelBooking(venue, b.id, "p3")).ok).toBe(false);
    expect(await v.bookingsFor(venue)).toHaveLength(1);
  });

  it("refuses a guest booking, which has nobody to prove it belongs to", async () => {
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: null, guestName: "Asha" });
    const [b] = await v.bookingsFor(venue);
    expect((await v.cancelBooking(venue, b.id, "p2")).ok).toBe(false);
    expect((await v.cancelBooking(venue, b.id, null)).ok).toBe(false);
  });

  it("frees the court for somebody else", async () => {
    venue = await setUp(1);
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: "p2", guestName: "" });
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: "p3", guestName: "" });
    const list = await v.bookingsFor(venue);
    await v.confirmBooking(venue, list[0].id);
    expect((await v.confirmBooking(venue, list[1].id)).ok).toBe(false);

    await v.cancelBooking(venue, list[0].id, "p2");
    expect((await v.confirmBooking(venue, list[1].id)).ok).toBe(true);
  });
});

describe("deleting a venue", () => {
  it("takes its bookings with it", async () => {
    await v.requestBooking(venue, { date: DATE, slot: SLOT, personId: "p2", guestName: "" });
    await testDb.delete(schema.venues).where(eq(schema.venues.id, venue.id));
    expect(await testDb.select().from(schema.venueBookings)).toHaveLength(0);
  });
});
