"use client";

/* Venues, on the Play screen — because that is where they are in the original
 * (`VenuesSection` renders inside `CommunityTab`, app.source.js:11698). A venue
 * is where community play happens, not a separate corner of the app.
 *
 * Ported from app.source.js:8963-9220.
 */

import { useState, useTransition } from "react";
import {
  createVenueAction, requestBookingAction, decideBookingAction, cancelBookingAction,
} from "./venueActions";

export type BookingView = {
  id: string;
  date: string;
  slot: string;
  who: string;
  status: "requested" | "confirmed" | "declined";
  personId: string | null;
};

export type VenueView = {
  slug: string;
  name: string;
  area: string;
  courts: number;
  openTime: string;
  closeTime: string;
  priceLabel: string;
  ownerName: string | null;
  isOwner: boolean;
  slots: string[];
  bookings: BookingView[];
};

const btn = "rounded-lg border px-2.5 py-1 text-[11px] font-bold disabled:opacity-40";
const plain = `${btn} border-neutral-700 text-neutral-300 hover:border-neutral-500`;
const primary = `${btn} border-amber-400 bg-amber-400 text-amber-950`;
const danger = `${btn} border-neutral-700 text-neutral-400 hover:border-rose-400/60 hover:text-rose-400`;
const field = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm";

export function Venues({
  venues, today, meId, meName,
}: {
  venues: VenueView[];
  today: string;
  meId: string | null;
  meName: string | null;
}) {
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const submit = (form: FormData) =>
    start(async () => {
      const res = await createVenueAction(form);
      if (res.ok) { setAdding(false); setError(null); } else setError(res.error);
    });

  return (
    <section className="mt-8">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
          Venues — book a court
        </h2>
        <button
          type="button" onClick={() => setAdding((a) => !a)}
          className={adding ? plain : `${btn} border-emerald-400/50 text-emerald-400 hover:bg-emerald-400/10`}
        >
          {adding ? "Close" : "+ Host a venue"}
        </button>
      </div>

      {adding && (
        <form action={submit} className="mb-3 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <input name="name" placeholder="Venue name" required minLength={2} maxLength={80} className={field} />
          <input name="area" placeholder="Area or locality" maxLength={80} className={field} />
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <label className="block">
              <span className="text-[11px] font-bold text-neutral-500">Courts</span>
              <input name="courts" type="number" min={1} max={50} defaultValue={2} className={field} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-neutral-500">Opens</span>
              <input name="openTime" type="time" defaultValue="06:00" className={field} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-neutral-500">Closes</span>
              <input name="closeTime" type="time" defaultValue="22:00" className={field} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-neutral-500">₹ / hour</span>
              <input name="price" inputMode="decimal" defaultValue="600" className={field} />
            </label>
          </div>

          <button type="submit" disabled={pending} className={`${primary} w-full px-3 py-2 text-xs`}>
            {pending ? "Listing…" : "List venue"}
          </button>

          {/* Deliberate in the original, and kept: the app shows the price so
              both sides know the deal, and takes no payment. */}
          <p className="text-xs text-neutral-500">
            Payments are settled directly between players and the venue — outside the app.
          </p>

          {error && <p className="text-xs font-bold text-rose-400">{error}</p>}
        </form>
      )}

      {venues.length === 0 && !adding ? (
        <p className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
          No venues listed yet — a host can list theirs and take booking requests.
        </p>
      ) : (
        <ul className="space-y-2">
          {venues.map((venue) => (
            <li key={venue.slug}>
              <VenueCard venue={venue} today={today} meId={meId} meName={meName} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function VenueCard({
  venue, today, meId, meName,
}: { venue: VenueView; today: string; meId: string | null; meName: string | null }) {
  const [open, setOpen] = useState(false);
  const [date, setDate] = useState(today);
  const [slot, setSlot] = useState("");
  const [guest, setGuest] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.error ?? "That did not work.");
      if (res.ok) setSlot("");
    });

  /* How many courts are left in each half hour on the chosen date — the thing
     somebody picking a time actually wants to know. */
  const freeIn = (s: string) =>
    venue.courts -
    venue.bookings.filter((b) => b.date === date && b.slot === s && b.status === "confirmed").length;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="truncate font-bold">{venue.name}</p>
          <p className="text-sm text-neutral-400">
            {[venue.area, `${venue.courts} court${venue.courts === 1 ? "" : "s"}`,
              `${venue.openTime}–${venue.closeTime}`, `${venue.priceLabel}/hr`]
              .filter(Boolean).join(" · ")}
          </p>
          {venue.ownerName && (
            <p className="text-[11px] text-neutral-500">Host: {venue.ownerName}</p>
          )}
        </div>
        <button type="button" onClick={() => setOpen((o) => !o)} className={open ? plain : primary}>
          {open ? "Close" : "Book"}
        </button>
      </div>

      {open && (
        <div className="mt-3 space-y-2 border-t border-neutral-800 pt-3">
          <div className="grid gap-2 sm:grid-cols-2">
            <label className="block">
              <span className="text-[11px] font-bold text-neutral-500">Date</span>
              <input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)}
                className={field} />
            </label>
            <label className="block">
              <span className="text-[11px] font-bold text-neutral-500">Half hour</span>
              <select value={slot} onChange={(e) => setSlot(e.target.value)} className={field}>
                <option value="">Pick a 30-minute slot</option>
                {venue.slots.map((s) => {
                  const free = freeIn(s);
                  return (
                    <option key={s} value={s} disabled={free <= 0}>
                      {s}{free <= 0 ? " — full" : ` — ${free} free`}
                    </option>
                  );
                })}
              </select>
            </label>
          </div>

          {/* Only asked for when the app does not already know who you are. */}
          {!meId && (
            <input value={guest} onChange={(e) => setGuest(e.target.value)}
              placeholder="Your name" maxLength={60} className={field} />
          )}

          <button
            type="button" disabled={pending || !slot}
            onClick={() => act(() => requestBookingAction(venue.slug, date, slot, meName ?? guest))}
            className={`${primary} w-full px-3 py-2 text-xs`}
          >
            {pending ? "Asking…" : "Request booking"}
          </button>

          <p className="text-[11px] text-neutral-500">
            The host confirms it. Payment is settled with the venue directly.
          </p>

          {error && <p className="text-xs font-bold text-rose-400">{error}</p>}
        </div>
      )}

      {venue.bookings.length > 0 && (
        <ul className="mt-3 space-y-1 border-t border-neutral-800 pt-3">
          {venue.bookings.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-2 text-sm">
              <span className="min-w-0 flex-1 truncate text-neutral-300">
                <span className="tabular-nums">{b.date}</span> · {b.slot} · {b.who}
              </span>

              {b.status === "confirmed" ? (
                <span className="rounded bg-emerald-400/10 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                  Confirmed
                </span>
              ) : venue.isOwner ? (
                <span className="flex gap-1.5">
                  <button type="button" className={primary} disabled={pending}
                    onClick={() => act(() => decideBookingAction(venue.slug, b.id, true))}>Approve</button>
                  <button type="button" className={danger} disabled={pending}
                    onClick={() => act(() => decideBookingAction(venue.slug, b.id, false))}>Decline</button>
                </span>
              ) : (
                <span className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                  Requested
                </span>
              )}

              {/* You can always take back your own. */}
              {meId && b.personId === meId && (
                <button type="button" className={danger} disabled={pending}
                  onClick={() => act(() => cancelBookingAction(venue.slug, b.id))}>Cancel</button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
