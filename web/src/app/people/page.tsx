import Link from "next/link";
import { count, desc, ilike, inArray, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { people, players, ratingHistory } from "@/lib/db/schema";
import { getTier } from "@/lib/rating";
import { maskPhone, normalisePhone } from "@/lib/people";
import { reliabilityForPerson } from "@/lib/rating/reliability";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

/* The roster — every player RISE knows about, and what their rating is.
 *
 * This is the reference the whole thing exists to be: an organiser looking up
 * someone before an event, or checking that the Rahul they just added is the
 * Rahul who played last month. */
export const dynamic = "force-dynamic";

const bandOf = (score: number | null) =>
  score == null ? null : score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";

export default async function PeoplePage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const query = (q ?? "").trim();
  const phone = normalisePhone(query);

  const found = await db
    .select()
    .from(people)
    .where(
      query.length >= 2
        ? phone
          ? or(ilike(people.name, `%${query}%`), ilike(people.phone, `%${phone}%`))
          : ilike(people.name, `%${query}%`)
        : undefined,
    )
    .orderBy(desc(people.riseBest))
    .limit(100);

  const ids = found.map((p) => p.id);

  /* Counted with a separate grouped query rather than a correlated subquery in
     a `sql` template — the template version silently returned 0 for everyone,
     and a count that is quietly wrong is worse than one that is obviously
     missing. Same pattern as lib/people/searchPeople. */
  const [counts, history] = await Promise.all([
    ids.length
      ? db
          .select({ personId: players.personId, n: count() })
          .from(players)
          .where(inArray(players.personId, ids))
          .groupBy(players.personId)
      : Promise.resolve([]),
    ids.length
      ? db
          .select({
            personId: ratingHistory.personId,
            createdAt: ratingHistory.createdAt,
            ratingBefore: ratingHistory.ratingBefore,
            notes: ratingHistory.notes,
          })
          .from(ratingHistory)
          .where(inArray(ratingHistory.personId, ids))
      : Promise.resolve([]),
  ]);

  const eventsBy = new Map(counts.map((c) => [c.personId, Number(c.n)]));
  const rows = found.map((person) => ({
    person,
    events: eventsBy.get(person.id) ?? 0,
    /* Computed, never read from the column: reliability DECAYS WITH TIME, so a
       stored value goes stale without anyone playing a match. */
    reliability: reliabilityForPerson(history, person.id, new Date()),
  }));

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <header>
          <Link href="/" className="text-sm font-semibold text-neutral-400 hover:text-neutral-200">
            ← RISE Sports
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Players</h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
            RISE Ratings across every event
          </p>
        </header>

        <form className="flex gap-2">
          <input
            name="q"
            defaultValue={query}
            placeholder="Search by name or phone"
            className="min-w-0 flex-1 rounded-xl border border-neutral-700 bg-neutral-950 px-4 py-2.5 text-sm"
          />
          <button className="rounded-xl bg-neutral-200 px-4 text-xs font-black text-neutral-900">Search</button>
        </form>

        {rows.length === 0 ? (
          <p className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
            {query ? `Nobody matching "${query}".` : "No players yet — add one to a tournament with a phone number."}
          </p>
        ) : (
          <ol className="space-y-2">
            {rows.map(({ person, events, reliability }) => {
              const tier = person.riseBest == null ? null : getTier(person.riseBest);
              const band = events > 0 ? bandOf(reliability.score) : null;
              return (
                <li key={person.id}>
                  <Link
                    href={`/people/${person.id}`}
                    className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 hover:border-neutral-600"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-bold">{person.name}</div>
                      <div className="text-[11px] text-neutral-500">
                        {/* Masked — the number is for matching, not display. */}
                        {person.phone ? maskPhone(person.phone) : "no phone"}
                        {" · "}
                        {events} {events === 1 ? "event" : "events"}
                        {tier ? ` · ${tier.emoji} ${tier.name}` : ""}
                      </div>
                    </div>
                    {band && (
                      <span
                        className={`text-[10px] font-bold uppercase tracking-widest ${
                          band === "High" ? "text-emerald-400" : band === "Medium" ? "text-amber-400" : "text-rose-400"
                        }`}
                      >
                        {band}
                      </span>
                    )}
                    <span className="font-mono text-2xl font-black tabular-nums">{person.riseBest ?? "—"}</span>
                  </Link>
                </li>
              );
            })}
          </ol>
        )}
      </main>
    </>
  );
}
