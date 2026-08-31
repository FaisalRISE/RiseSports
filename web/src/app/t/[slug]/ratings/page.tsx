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

/* Rating movement across this tournament.
 *
 * Everything here is derived on request from the finished matches — nothing is
 * stored, so undoing a rally that un-completes a match simply changes what this
 * page shows, with no rating to reverse. See lib/rating/tournament.ts. */
export const dynamic = "force-dynamic";

export default async function RatingsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await loadTournament(slug);
  if (!loaded) notFound();
  const t = loaded.tournament;
  if (!canView(await principalFor(t.id), t.published)) notFound();

  const people = await db.select().from(playersTable).where(eq(playersTable.tournamentId, t.id));
  const rows = tournamentRatings(t, people, loaded.matches);
  const teamName = (id: string | null) => loaded.teams.find((x) => x.id === id)?.name ?? "—";
  const sport = sportOf(t.sport);
  const anyPlayed = rows.some((r) => r.played > 0);

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <header>
          <Link href={`/t/${slug}`} className="text-sm font-semibold text-neutral-400 hover:text-neutral-200">
            ← {t.name}
          </Link>
          <h1 className="mt-2 text-2xl font-black tracking-tight">Ratings</h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
            {sport.name} · {ratingKeyLabel(ratingFormatFor(people))} · this tournament only
          </p>
        </header>

        {!anyPlayed && (
          <p className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
            No finished matches yet. Ratings move once a match is complete.
          </p>
        )}

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[34rem] border-collapse text-sm">
              <thead>
                <tr className="border-b border-neutral-800 text-[10px] uppercase tracking-widest text-neutral-500">
                  <th className="p-2 text-left font-bold">Player</th>
                  <th className="p-2 text-left font-bold">Team</th>
                  <th className="p-2 text-center font-bold">P</th>
                  <th className="p-2 text-right font-bold">Start</th>
                  <th className="p-2 text-right font-bold">Change</th>
                  <th className="p-2 text-right font-bold">Rating</th>
                  <th className="p-2 text-left font-bold">Tier</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.playerId} className="border-b border-neutral-900">
                    <td className="p-2 font-semibold">{r.name}</td>
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
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Say plainly what this is, so nobody reads it as a career rating. */}
        <p className="text-xs leading-relaxed text-neutral-600">
          Movement is calculated from this tournament&apos;s finished matches only. Players are
          recorded per event here, so a rating does not yet carry between tournaments.
        </p>
      </main>
    </>
  );
}

function ratingKeyLabel(format: string): string {
  return (
    {
      ms: "Men's singles", ws: "Women's singles", md: "Men's doubles",
      wd: "Women's doubles", mx: "Mixed doubles", gn: "Open",
    }[format] ?? "Open"
  );
}
