import { notFound } from "next/navigation";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches, people, ratingHistory, tournaments } from "@/lib/db/schema";
import { getTier } from "@/lib/rating";
import { reliabilityForPerson, playedFromHistory } from "@/lib/rating/reliability";
import { detectSandbagging, sandbaggingNote } from "@/lib/rating/sandbagging";
import { maskPhone } from "@/lib/people";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

/* One person's RISE Rating and how it got there.
 *
 * This page is the answer to "why is my rating that?" — spec §9 keeps every
 * input precisely so an organiser can show the working instead of asserting a
 * number. It is also where the Reliability Index earns its place: a rating
 * built on four games against the same two people should not look like one
 * built on forty. */
export const dynamic = "force-dynamic";

export default async function PersonPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const [person] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  if (!person) notFound();

  const history = await db
    .select({ h: ratingHistory, match: matches, tournament: tournaments })
    .from(ratingHistory)
    .innerJoin(matches, eq(ratingHistory.matchId, matches.id))
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(eq(ratingHistory.personId, id))
    .orderBy(desc(ratingHistory.createdAt))
    .limit(100);

  /* Everything derived comes through the one shared reader, so this page cannot
     drift from the roster or the tournament view. */
  const reliability = reliabilityForPerson(history.map((r) => r.h), id, new Date());

  /* §8.1 — recomputed here rather than trusting `people.flags`, so the profile
     shows the current picture even if the stored flag is behind. */
  const played = playedFromHistory(history.map((r) => r.h), id);
  const flag = detectSandbagging(
    played
      .filter((m) => (m.opponentRatings?.length ?? 0) > 0)
      .map((m) => ({
        avgOpponentRating: m.opponentRatings!.reduce((s, n) => s + n, 0) / m.opponentRatings!.length,
        won: m.won,
        playedAt: m.playedAt,
      })),
    person.riseBest ?? 0,
  );
  const flagNote = sandbaggingNote(flag);

  const names = await opponentNames(history);
  const tier = person.riseBest == null ? null : getTier(person.riseBest);

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <header>
          <Link href="/people" className="text-sm font-semibold text-neutral-400 hover:text-neutral-200">
            ← Players
          </Link>
          <h1 className="mt-2 text-3xl font-black tracking-tight">{person.name}</h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
            {person.gender === "F" ? "Women" : "Men"}
            {/* Masked: a phone number is how a person is matched, not something
                to publish. */}
            {person.phone ? ` · ${maskPhone(person.phone)}` : " · no phone on file"}
          </p>
        </header>

        {/* §8.1. Neutral wording on purpose: this fires just as readily on a
            player improving fast as on one hiding, and the spec is explicit
            that it is a prompt for a human, never an automatic correction. */}
        {flagNote && (
          <p className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm font-bold text-amber-300">
            ⚠ {flagNote}
          </p>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">RISE Rating</div>
            <div className="font-mono text-4xl font-black">{person.riseBest ?? "—"}</div>
            {tier && <div className="text-sm text-neutral-300">{tier.emoji} {tier.name}</div>}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Reliability</div>
            <div
              className={`font-mono text-4xl font-black ${
                reliability.band === "High" ? "text-emerald-400"
                : reliability.band === "Medium" ? "text-amber-400"
                : "text-rose-400"
              }`}
            >
              {reliability.band}
            </div>
            <div className="text-xs text-neutral-400">{reliability.reason}</div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">DUPR</div>
            <div className="font-mono text-4xl font-black text-neutral-300">
              {person.dupr == null ? "—" : (person.dupr / 100).toFixed(2)}
            </div>
            <div className="text-xs text-neutral-500">
              {person.duprEnteredAt
                ? `entered ${person.duprEnteredAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                : "not provided"}
              {person.seedSource === "dupr" && " · used to seed"}
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-3 text-lg font-black">How this rating was earned</h2>
          {history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
              No rated matches yet. Started at {person.riseBest ?? "—"}
              {person.seedSource === "dupr" ? ", seeded from DUPR."
                : person.seedSource === "organiser" ? ", set by an organiser."
                : "."}
            </p>
          ) : (
            <ol className="space-y-2">
              {history.map((r) => {
                const notes = (r.h.notes ?? {}) as { won?: boolean; damped?: boolean; carried?: boolean; opponentIds?: string[] };
                const opps = (notes.opponentIds ?? []).map((o) => names.get(o) ?? "—").join(" & ");
                return (
                  <li key={r.h.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                    <div className="flex items-baseline gap-2">
                      <span className={`font-mono text-lg font-black ${r.h.deltaApplied >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {r.h.deltaApplied > 0 ? "+" : ""}{r.h.deltaApplied}
                      </span>
                      <span className="text-sm font-semibold">{notes.won ? "beat" : "lost to"} {opps || "—"}</span>
                      <span className="ml-auto font-mono text-xs text-neutral-500">
                        {r.h.ratingBefore} → {r.h.ratingAfter}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-neutral-500">
                      <span>{r.tournament.name} · {r.match.round}</span>
                      <span>expected {(r.h.expected / 1000).toFixed(2)}</span>
                      <span>margin ×{(r.h.marginMultiplier / 1000).toFixed(2)}</span>
                      <span>stage ×{(r.h.stageMultiplier / 1000).toFixed(2)}</span>
                      <span>verified ×{(r.h.verificationWeight / 1000).toFixed(2)}</span>
                      {/* Named explicitly, so a small gain is explainable rather
                          than looking like a bug. */}
                      {notes.damped && <span className="text-amber-400">repeat opponent ×0.6</span>}
                      {notes.carried && <span className="text-amber-400">carry guard ×0.7</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </>
  );
}

/** Opponent ids are person ids; the page needs names. */
async function opponentNames(
  history: { h: { notes: unknown } }[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of history) {
    for (const o of ((r.h.notes ?? {}) as { opponentIds?: string[] }).opponentIds ?? []) ids.add(o);
  }
  if (ids.size === 0) return new Map();
  const rows = await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.name]));
}
