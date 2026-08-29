import { notFound } from "next/navigation";
import Link from "next/link";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches, teams, tournaments } from "@/lib/db/schema";
import { viewMatch } from "@/lib/matchState";
import { sportOf } from "@/lib/sports/registry";
import { principalFor } from "@/lib/auth/guard";
import { canView } from "@/lib/auth/policy";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

/* Spectator view. A Server Component: the scoring engine runs here, the browser
 * receives finished numbers. This is the read-heavy surface, so it is cached at
 * the edge and revalidated when a Server Action writes. */
export const revalidate = 30;

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  if (!t) notFound();
  /* Drafts are visible to the organiser — and to everyone while open access is on. */
  if (!canView(await principalFor(t.id), t.published)) notFound();

  const [teamRows, matchRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.tournamentId, t.id)),
    db.select().from(matches).where(eq(matches.tournamentId, t.id)),
  ]);
  const byId = new Map(teamRows.map((x) => [x.id, x]));
  const sport = sportOf(t.sport);

  return (
    <>
    <OpenAccessBanner />
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <header className="mb-6">
        <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
          {sport.emoji} {sport.name}
          {t.format === "osl" ? " · OSL team format" : ""}
        </p>
        <h1 className="text-3xl font-black tracking-tight">{t.name}</h1>
      </header>

      <ol className="space-y-2">
        {matchRows.map((m) => {
          const view = viewMatch(t, m);
          const a = m.teamAId ? byId.get(m.teamAId) : null;
          const b = m.teamBId ? byId.get(m.teamBId) : null;
          const [sa, sb] = view.typed ? [m.typedScoreA, m.typedScoreB] : [view.a, view.b];
          const live = view.rallies > 0 && !view.over;

          return (
            <li key={m.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
              <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
                <span className="text-neutral-500">{m.round}</span>
                {live && <span className="text-rose-400">● Live</span>}
                {view.over && <span className="text-emerald-400">Final</span>}
                {view.typed && <span className="text-neutral-600">entered</span>}
                {view.osl && !view.over && (
                  <span className="ml-auto text-amber-400">{view.osl.pairLabel}</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className={`flex-1 truncate text-sm ${view.winner === "a" ? "font-bold" : ""}`}>
                  {a?.name ?? "TBD"}
                </span>
                <span className="font-mono text-xl font-black tabular-nums">
                  {sa ?? "–"}–{sb ?? "–"}
                </span>
                <span className={`flex-1 truncate text-right text-sm ${view.winner === "b" ? "font-bold" : ""}`}>
                  {b?.name ?? "TBD"}
                </span>
              </div>
            </li>
          );
        })}
        {matchRows.length === 0 && (
          <li className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
            No matches yet.
          </li>
        )}
      </ol>

      <p className="mt-6 text-xs text-neutral-600">
        Scoring?{" "}
        <Link href={`/t/${slug}/score`} className="font-semibold text-amber-400 underline">
          Enter the referee PIN
        </Link>
      </p>
    </main>
    </>
  );
}
