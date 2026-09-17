import Link from "next/link";

import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { describeDbError, describeDbTarget } from "@/lib/db/error";
import { gameCards, type GameCard } from "@/lib/community/store";
import { me } from "@/lib/community/me";
import {
  localISO, prettyDate, prettyDays, priceLabel, restrictionChips,
} from "@/lib/community";
import { listVenues, slotsFor, bookingsForVenues, isVenueOwner } from "@/lib/venues";
import { sportOf } from "@/lib/sports/registry";
import { IdentityBar } from "./IdentityBar";
import { Venues, type VenueView } from "./Venues";

export const dynamic = "force-dynamic";

const ROTATION_LABEL: Record<string, string> = {
  fixed: "Same players all session",
  rotate: "Reshuffle at half time",
  slots: "Reserve per 30 min",
  kotc: "King of the Court",
  ladder: "Ladder league",
};

export default async function PlayPage() {
  let cards: GameCard[] = [];
  let dbError: string | null = null;
  try {
    cards = await gameCards();
  } catch (e) {
    dbError = describeDbError(e);
    console.error("[db]", dbError, "||", describeDbTarget());
  }

  const viewer = dbError ? null : await me();

  /* Venues live on this screen, under the games — that is where they are in the
     original, and a venue is where community play happens. */
  let venueViews: VenueView[] = [];
  if (!dbError) {
    const all = await listVenues();
    const owners = new Map<string, string>();
    for (const v of all) {
      if (v.ownerPersonId && !owners.has(v.ownerPersonId)) owners.set(v.ownerPersonId, "");
    }
    if (owners.size > 0) {
      const { db: d } = await import("@/lib/db");
      const { people } = await import("@/lib/db/schema");
      const { inArray } = await import("drizzle-orm");
      for (const p of await d
        .select({ id: people.id, name: people.name })
        .from(people)
        .where(inArray(people.id, [...owners.keys()]))) {
        owners.set(p.id, p.name);
      }
    }

    /* One call for every venue's bookings, not one per venue fired together —
       that grew with the number of venues, and past eight concurrent queries
       it wedges the instance (see lib/db/index.ts). */
    const bookings = await bookingsForVenues(all);

    venueViews = all.map((v) => ({
      slug: v.slug,
      name: v.name,
      area: v.area,
      courts: v.courts,
      openTime: v.openTime,
      closeTime: v.closeTime,
      priceLabel: priceLabel(v.pricePaise),
      ownerName: (v.ownerPersonId && owners.get(v.ownerPersonId)) || null,
      /* Open access lets anyone run an unclaimed venue, same posture as the
         rest of the app while there is no sign-in. */
      isOwner: isVenueOwner(v, viewer?.id ?? null) || v.ownerPersonId === null,
      slots: slotsFor(v),
      bookings: bookings.get(v.id) ?? [],
    }));
  }

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <header className="mb-5 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight">Play</h1>
            <p className="text-sm text-neutral-400">
              Regular games near you. Put your hand up for a date.
            </p>
          </div>
          <Link
            href="/play/new"
            className="shrink-0 rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-amber-950"
          >
            Host a game
          </Link>
        </header>

        {!dbError && <IdentityBar name={viewer?.name ?? null} />}

        {dbError && (
          <div className="mb-4 rounded-xl border border-rose-500 bg-rose-500/10 p-4 text-sm text-rose-200">
            <p className="font-bold">The database is not reachable.</p>
            <p className="mt-2 font-mono text-[11px] text-rose-400/70">{dbError}</p>
          </div>
        )}

        <ul className="space-y-2">
          {cards.map(({ game, nextDate, confirmedCount, capacity }) => {
            const sport = sportOf(game.sport);
            const chips = restrictionChips(game.restrictions);
            const full = capacity > 0 && confirmedCount >= capacity;

            return (
              <li key={game.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60">
                <Link href={`/play/${game.slug}`} className="block p-4">
                  <div className="flex items-start gap-3">
                    <span className="text-2xl leading-none" aria-hidden>{sport.emoji}</span>

                    <div className="min-w-0 flex-1">
                      <p className="truncate font-bold">{game.name}</p>
                      <p className="truncate text-sm text-neutral-400">
                        {game.venue}
                        {game.area ? ` · ${game.area}` : ""}
                      </p>

                      <p className="mt-1 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                        {prettyDays(game)} · {game.startTime}–{game.endTime} · {priceLabel(game.pricePaise)}
                      </p>

                      <div className="mt-2 flex flex-wrap gap-1.5">
                        <Badge>{ROTATION_LABEL[game.rotation] ?? game.rotation}</Badge>
                        {game.accessType === "restricted" && <Badge>Invite only</Badge>}
                        {chips.map((c) => (
                          <Badge key={c} tone="warn">{c}</Badge>
                        ))}
                      </div>
                    </div>

                    {/* The number that decides whether it is worth tapping. */}
                    <div className="shrink-0 text-right">
                      <p className={`text-lg font-black tabular-nums ${full ? "text-rose-400" : "text-emerald-400"}`}>
                        {confirmedCount}
                        <span className="text-neutral-500">/{capacity}</span>
                      </p>
                      <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                        {nextDate ? prettyDate(nextDate) : "No date set"}
                      </p>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}

          {!dbError && cards.length === 0 && (
            <li className="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-sm text-neutral-500">
              No games yet. Host one and it shows up here for everyone.
            </li>
          )}
        </ul>

        {!dbError && (
          <Venues
            venues={venueViews}
            today={localISO(new Date())}
            meId={viewer?.id ?? null}
            meName={viewer?.name ?? null}
          />
        )}
      </main>
    </>
  );
}

function Badge({ children, tone = "plain" }: { children: React.ReactNode; tone?: "plain" | "warn" }) {
  const cls =
    tone === "warn"
      ? "border-rose-400/40 bg-rose-400/10 text-rose-400"
      : "border-neutral-700 text-neutral-400";
  return (
    <span className={`rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}>
      {children}
    </span>
  );
}
