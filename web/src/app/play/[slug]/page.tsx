import Link from "next/link";
import { notFound } from "next/navigation";

import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { sportOf } from "@/lib/sports/registry";
import { me } from "@/lib/community/me";
import { viewingAsHost } from "@/lib/community/guard";
import { gameBySlug, sessionView, myEntry, canJoinSessions } from "@/lib/community/store";
import { openSlotsIn } from "@/lib/community/roster";
import {
  capacityOf, eligibilityFailures, prettyDate, prettyDays, priceLabel, restrictionChips, sessionDates,
} from "@/lib/community";
import { scheduleFor } from "@/lib/community/schedule";
import { halfHourSlots } from "@/lib/community/rotations";
import { slotsFor, kotcFor, ladderFor, slotCapacity } from "@/lib/community/rotationsStore";
import { PlayerCard } from "./PlayerCard";
import { HostRoster, type RosterRow } from "./HostRoster";
import { Schedule } from "./Schedule";
import { SlotsPanel, KotcPanel, LadderPanel } from "./Rotations";

export const dynamic = "force-dynamic";

const ROTATION_LABEL: Record<string, string> = {
  fixed: "Same players all session",
  rotate: "Reshuffle at half time",
  slots: "Reserve per 30 min",
  kotc: "King of the Court",
  ladder: "Ladder league",
};

const SCHEDULE_LABEL: Record<string, string> = {
  random: "Random pairings",
  balanced: "Balanced by rating",
  americano: "Americano",
  mexicano: "Mexicano",
};

export default async function GamePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { slug } = await params;
  const { date: wanted } = await searchParams;

  const game = await gameBySlug(slug);
  if (!game) notFound();

  const sport = sportOf(game.sport);
  const dates = sessionDates(game, 6);
  /* A date from the query string is only honoured if this game actually runs
     then — otherwise a stale or hand-typed link would open a session for a day
     the game does not exist on. */
  const date = wanted && dates.includes(wanted) ? wanted : dates[0];

  const viewer = await me();
  const host = await viewingAsHost(game);
  const mayJoin = await canJoinSessions(game, viewer?.id ?? null);

  const view = date
    ? await sessionView(game, date)
    : { confirmed: [], waitlist: [], roster: [], capacity: capacityOf(game), freedSpots: 0 };

  const mine = "roster" in view ? myEntry(view as never, viewer?.id ?? null) : null;
  const blockers = viewer ? eligibilityFailures(viewer, game.restrictions) : [];
  const chips = restrictionChips(game.restrictions);
  const capacity = capacityOf(game);
  const courtWord = sport.court.charAt(0).toUpperCase() + sport.court.slice(1);

  /* Spots freed by a backout and still empty — the only thing that unlocks
     "take the free spot" for someone on the waitlist. Derived from the rows,
     never tallied; see lib/community/roster.openSlotsIn. */
  const openSlots = openSlotsIn(
    {
      confirmed: view.confirmed.length,
      withdrawn: view.roster.filter((r) => r.state === "withdrawn").length,
      maxWaitlistPosition: 0,
    },
    capacity,
  );

  /* Where I sit in the waitlist queue, so the card can say "3rd" rather than
     just "waiting". */
  const queuePosition =
    mine?.state === "waitlist"
      ? view.waitlist.findIndex((r) => r.personId === mine.personId) + 1
      : null;

  /* Which of the four session shapes this game runs. `fixed` and `rotate` use
     the pairings engine; the other three each have their own screen. */
  const mode = game.rotation;
  const usesPairings = mode === "fixed" || mode === "rotate";

  const schedule =
    date && usesPairings ? await scheduleFor(game, date) : { blocks: [], names: new Map() };

  const slots = date && mode === "slots" ? await slotsFor(game, date) : {};
  const kotc = date && mode === "kotc" ? await kotcFor(game, date) : null;
  const ladder = mode === "ladder" ? await ladderFor(game) : { order: [], log: [] };

  /* One name lookup covering everyone any of those screens might show — the
     roster, the pairings, the slot bookings, the courts and the ladder. */
  const nameIds = new Set<string>([
    ...view.roster.map((r) => r.personId),
    ...schedule.names.keys(),
    ...Object.values(slots).flat(),
    ...(kotc ? [...kotc.courts.flatMap((c) => [...c.a, ...c.b]), ...kotc.bench] : []),
    ...ladder.order,
    ...ladder.log.flatMap((e) => [e.challenger, e.defender]),
  ]);
  const names: Record<string, string> = {};
  for (const r of view.roster) names[r.personId] = r.person.name;
  for (const [id, n] of schedule.names) names[id] = n;
  const missing = [...nameIds].filter((id) => !names[id]);
  if (missing.length > 0) {
    const { db } = await import("@/lib/db");
    const { people } = await import("@/lib/db/schema");
    const { inArray } = await import("drizzle-orm");
    for (const p of await db
      .select({ id: people.id, name: people.name })
      .from(people)
      .where(inArray(people.id, missing))) {
      names[p.id] = p.name;
    }
  }

  const hostRows: RosterRow[] = view.roster.map((r) => ({
    personId: r.personId,
    name: r.person.name,
    rating: r.person.riseBest,
    state: r.state,
    paid: r.paid,
    linkSent: r.paymentLinkSentAt !== null,
  }));

  /* The counts for the date strip, in one pass rather than a query per date. */
  const countsByDate = new Map<string, number>();
  if (date) countsByDate.set(date, view.confirmed.length);

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link href="/play" className="text-xs font-bold text-neutral-400 hover:underline">← All games</Link>

        {/* ── Header ──────────────────────────────────────────────────── */}
        <header className="mt-2">
          <div className="flex items-start gap-3">
            <span className="text-3xl leading-none" aria-hidden>{sport.emoji}</span>
            <div className="min-w-0 flex-1">
              <h1 className="text-2xl font-black leading-tight">{game.name}</h1>
              <p className="text-sm text-neutral-400">
                {game.venue}
                {game.area ? ` · ${game.area}` : ""}
              </p>
            </div>
            {host && (
              <span className="shrink-0 rounded-lg border border-amber-400/50 bg-amber-400/10 px-2 py-1 text-[10px] font-bold uppercase tracking-widest text-amber-400">
                You host this
              </span>
            )}
          </div>

          <div className="mt-3 flex flex-wrap gap-1.5">
            <Badge>{prettyDays(game)}</Badge>
            <Badge>{game.startTime}–{game.endTime}</Badge>
            <Badge>{capacityOf(game)} spots</Badge>
            <Badge>{priceLabel(game.pricePaise)}</Badge>
            <Badge>{ROTATION_LABEL[game.rotation] ?? game.rotation}</Badge>
            <Badge>{SCHEDULE_LABEL[game.scheduleMode] ?? game.scheduleMode}</Badge>
            {game.accessType === "restricted" && <Badge tone="warn">Invite only</Badge>}
            {chips.map((c) => <Badge key={c} tone="warn">{c}</Badge>)}
          </div>
        </header>

        {/* ── Which date ──────────────────────────────────────────────── */}
        <section className="mt-5">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Pick a date</h2>
          {dates.length === 0 ? (
            <p className="mt-2 rounded-xl border border-dashed border-neutral-800 p-4 text-sm text-neutral-500">
              No days are set for this game, so there is nothing to sign up for yet.
            </p>
          ) : (
            <ul className="mt-2 flex gap-2 overflow-x-auto pb-1">
              {dates.map((d) => {
                const on = d === date;
                const n = countsByDate.get(d);
                return (
                  <li key={d} className="shrink-0">
                    <Link
                      href={`/play/${game.slug}?date=${d}`}
                      aria-current={on ? "page" : undefined}
                      className={`block rounded-xl border px-3 py-2 text-center ${
                        on ? "border-amber-400 bg-amber-400/10" : "border-neutral-800 hover:border-neutral-600"
                      }`}
                    >
                      <span className="block text-xs font-bold">{prettyDate(d)}</span>
                      <span className="block text-[10px] tabular-nums text-neutral-500">
                        {n == null ? "—" : `${n}/${capacityOf(game)}`}
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        {/* ── Where you stand ─────────────────────────────────────────── */}
        {date && (
          <section className="mt-5 space-y-3">
            <CapacityBar
              confirmed={view.confirmed.length}
              capacity={capacity}
              waiting={view.waitlist.length}
              freed={openSlots}
            />

            {!viewer && (
              <Note>
                Say who you are at the top of <Link href="/play" className="underline">Play</Link> and
                you can put your name down for this date.
              </Note>
            )}

            {viewer && blockers.length > 0 && (
              <div className="rounded-xl border border-rose-500/50 bg-rose-500/10 p-4">
                <p className="text-sm font-bold text-rose-300">You cannot join this game.</p>
                <ul className="mt-1.5 space-y-0.5 text-sm text-rose-200/80">
                  {blockers.map((b) => <li key={b}>· {b}</li>)}
                </ul>
              </div>
            )}

            {viewer && blockers.length === 0 && !mayJoin && (
              <Note>This game is invite only. Ask the host to add you.</Note>
            )}

            {viewer && blockers.length === 0 && mayJoin && (
              <PlayerCard
                slug={game.slug}
                date={date}
                prettyDate={prettyDate(date)}
                state={mine?.state ?? "none"}
                paid={mine?.paid ?? false}
                pricePaise={game.pricePaise}
                queuePosition={queuePosition}
                openSlots={openSlots}
              />
            )}

            {host && (
              <HostRoster
                slug={game.slug}
                date={date}
                rows={hostRows}
                capacity={capacity}
                pricePaise={game.pricePaise}
              />
            )}

            {/* Each rotation gets its own screen. "court", "table" or "board"
                comes from the sport registry — a chess evening should not be
                told which court to sit at. */}
            {usesPairings && (
              <Schedule
                slug={game.slug}
                date={date}
                blocks={schedule.blocks}
                names={names}
                isHost={host}
                confirmedCount={view.confirmed.length}
                courtWord={courtWord}
              />
            )}

            {mode === "slots" && (
              <SlotsPanel
                slug={game.slug}
                date={date}
                slots={slots}
                labels={halfHourSlots(game.startTime, game.endTime)}
                capacity={slotCapacity(game)}
                names={names}
                meId={viewer?.id ?? null}
                isHost={host}
              />
            )}

            {mode === "kotc" && (
              <KotcPanel
                slug={game.slug}
                date={date}
                state={kotc}
                names={names}
                isHost={host}
                confirmedCount={view.confirmed.length}
                courtWord={courtWord}
              />
            )}

            {mode === "ladder" && (
              <LadderPanel
                slug={game.slug}
                order={ladder.order}
                log={ladder.log}
                names={names}
                isHost={host}
                meId={viewer?.id ?? null}
              />
            )}

            {/* ── Who is playing ───────────────────────────────────────── */}
            <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Confirmed · {view.confirmed.length}
              </h2>
              {view.confirmed.length === 0 ? (
                <p className="mt-2 text-sm text-neutral-500">Nobody yet.</p>
              ) : (
                <ul className="mt-2 space-y-1">
                  {view.confirmed.map((r) => (
                    <li key={r.personId} className="flex items-center gap-2 text-sm">
                      <span className="min-w-0 flex-1 truncate font-bold">{r.person.name}</span>
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
                          r.paid ? "bg-emerald-400/10 text-emerald-400" : "bg-neutral-800 text-neutral-500"
                        }`}
                      >
                        {r.paid ? "Paid" : "Pending"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}

              {view.waitlist.length > 0 && (
                <>
                  <h2 className="mt-4 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    Waitlist · {view.waitlist.length}
                  </h2>
                  <ol className="mt-2 space-y-1">
                    {view.waitlist.map((r, i) => (
                      <li key={r.personId} className="flex items-center gap-2 text-sm text-neutral-400">
                        <span className="w-5 shrink-0 tabular-nums text-neutral-600">{i + 1}.</span>
                        <span className="min-w-0 flex-1 truncate">{r.person.name}</span>
                      </li>
                    ))}
                  </ol>
                </>
              )}
            </div>
          </section>
        )}
      </main>
    </>
  );
}

/* ── Pieces ───────────────────────────────────────────────────────────────*/

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

function Note({ children }: { children: React.ReactNode }) {
  return (
    <p className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-400">
      {children}
    </p>
  );
}

/** How full the session is, and whether a spot has just come free. */
function CapacityBar({
  confirmed, capacity, waiting, freed,
}: { confirmed: number; capacity: number; waiting: number; freed: number }) {
  const pct = capacity > 0 ? Math.min(100, (confirmed / capacity) * 100) : 0;
  const full = capacity > 0 && confirmed >= capacity;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-bold">
          {confirmed} of {capacity} spots taken
        </span>
        {waiting > 0 && (
          <span className="text-xs text-neutral-500">{waiting} waiting</span>
        )}
      </div>
      <div className="mt-2 h-2 overflow-hidden rounded-full bg-neutral-800">
        <div
          className={`h-full ${full ? "bg-rose-400" : "bg-emerald-400"}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      {freed > 0 && (
        /* The legacy app's orange warning: somebody dropped out and the spot is
           sitting empty. It is the one thing a host must act on quickly, so it
           is stated rather than left to be inferred from two numbers.

           The instruction only appears when there IS a waitlist — telling a host
           to "promote someone from the waitlist" that nobody is on reads as a
           bug in the app rather than a nudge. */
        <p className="mt-2 rounded-lg bg-amber-400/10 px-3 py-2 text-xs font-bold text-amber-400">
          {freed} spot{freed === 1 ? "" : "s"} came free
          {waiting > 0 ? " — promote someone from the waitlist." : " after a drop-out."}
        </p>
      )}
    </div>
  );
}
