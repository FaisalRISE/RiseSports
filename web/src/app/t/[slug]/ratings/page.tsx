import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { players as playersTable } from "@/lib/db/schema";
import { loadTournament } from "@/lib/tournamentState";
import { tournamentRatings, ratingFormatFor } from "@/lib/rating/tournament";
import { principalFor } from "@/lib/auth/guard";
import { canView } from "@/lib/auth/policy";
import { sportOf } from "@/lib/sports/registry";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

/* RISE Ratings for this event.
 *
 * Movement is read from `rating_history`, not recomputed — the number here is
 * exactly the number the player carries away. See lib/rating/tournament.ts. */
export const dynamic = "force-dynamic";

const band = (score: number | null) =>
  score == null ? null : score >= 70 ? "High" : score >= 40 ? "Medium" : "Low";

const bandClass = (score: number | null) =>
  score == null ? "text-neutral-600"
  : score >= 70 ? "text-emerald-400"
  : score >= 40 ? "text-amber-400"
  : "text-rose-400";

export default async function RatingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await loadTournament(slug);
  if (!loaded) notFound();
  const t = loaded.tournament;
  if (!canView(await principalFor(t.id), t.published)) notFound();

  const people = await db.select().from(playersTable).where(eq(playersTable.tournamentId, t.id));
  const rows = await tournamentRatings(t, people);
  const teamName = (id: string | null) => loaded.teams.find((x) => x.id === id)?.name ?? "—";
  const sport = sportOf(t.sport);

  const anyPlayed = rows.some((r) => r.played > 0);
  const unlinked = rows.filter((r) => !r.carried).length;

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-4xl space-y-6 p-4 sm:p-6">
        <header>
          <Link href={`/t/${slug}`} className="text-sm font-semibold text-neutral-400 hover:text-neutral-200">
            ← {t.name}
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight">RISE Ratings</h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
            {sport.name} · {formatLabel(ratingFormatFor(people))}
          </p>
        </header>

        {!anyPlayed && (
          <p className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
            No finished matches yet. Ratings move once a match is complete.
          </p>
        )}

        {/* Say plainly whose rating cannot travel, because the fix — adding a
            phone number — is something the organiser can still do. */}
        {unlinked > 0 && (
          <p className="rounded-xl border border-amber-600/40 bg-amber-500/5 p-3 text-xs text-amber-300">
            {unlinked} {unlinked === 1 ? "player is" : "players are"} not linked to a RISE profile.
            Their rating works here but will not follow them to another event — add a phone number
            when entering them to fix that.
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[46rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-widest text-neutral-500">
                  <th className="p-2 text-left font-bold">Player</th>
                  <th className="p-2 text-left font-bold">Team</th>
                  <th className="p-2 text-center font-bold">P</th>
                  <th className="p-2 text-right font-bold">Start</th>
                  <th className="p-2 text-right font-bold">Change</th>
                  <th className="p-2 text-right font-bold">RISE</th>
                  <th className="p-2 text-left font-bold">Tier</th>
                  {/* §7: shown wherever the rating is, because a rating without
                      it looks authoritative when it isn't. */}
                  <th className="p-2 text-left font-bold">Reliability</th>
                  <th className="p-2 text-right font-bold">DUPR</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.playerId} className="border-b border-neutral-900">
                    <td className="p-2 font-semibold">
                      {r.personId ? (
                        <Link href={`/people/${r.personId}`} className="hover:text-amber-400 hover:underline">
                          {r.name}
                        </Link>
                      ) : (
                        <span title="Not linked to a RISE profile">
                          {r.name} <span className="text-neutral-600">·</span>
                        </span>
                      )}
                    </td>
                    <td className="truncate p-2 text-neutral-400">{teamName(r.teamId)}</td>
                    <td className="p-2 text-center tabular-nums text-neutral-400">{r.played}</td>
                    <td className="p-2 text-right tabular-nums text-neutral-500">{r.start}</td>
                    <td
                      className={`p-2 text-right font-bold tabular-nums ${
                        r.delta > 0 ? "text-emerald-400" : r.delta < 0 ? "text-rose-400" : "text-neutral-600"
                      }`}
                    >
                      {r.delta > 0 ? "+" : ""}
                      {r.delta || "—"}
                    </td>
                    <td className="p-2 text-right font-black tabular-nums">{r.current}</td>
                    <td className="whitespace-nowrap p-2 text-neutral-300">
                      {r.tier.emoji} {r.tier.name}
                    </td>
                    <td className={`whitespace-nowrap p-2 text-xs font-bold ${bandClass(r.reliability)}`}>
                      {band(r.reliability) ?? "—"}
                      {r.reliability != null && (
                        <span className="ml-1 font-normal text-neutral-600">{r.reliability}</span>
                      )}
                    </td>
                    {/* Dated, because the premise of RiseR is that DUPR goes stale. */}
                    <td className="whitespace-nowrap p-2 text-right text-xs text-neutral-400">
                      {r.dupr == null ? (
                        "—"
                      ) : (
                        <>
                          {r.dupr.toFixed(2)}
                          {r.duprEnteredAt && (
                            <span className="ml-1 text-neutral-600">
                              {r.duprEnteredAt.toLocaleDateString("en-GB", { month: "short", year: "2-digit" })}
                            </span>
                          )}
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-xs leading-relaxed text-neutral-600">
          Change is what moved at this event. RISE is the player&apos;s current rating across every
          event they have played. Reliability is how much evidence sits behind it — it falls with
          inactivity, but the rating itself never does.
        </p>
      </main>
    </>
  );
}

function formatLabel(format: string): string {
  return (
    {
      ms: "Men's singles", ws: "Women's singles", md: "Men's doubles",
      wd: "Women's doubles", mx: "Mixed doubles", gn: "Open",
    }[format] ?? "Open"
  );
}
