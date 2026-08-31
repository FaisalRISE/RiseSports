import { notFound } from "next/navigation";
import Link from "next/link";
import { sportOf } from "@/lib/sports/registry";
import { principalFor } from "@/lib/auth/guard";
import { canView } from "@/lib/auth/policy";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { StandingsTable } from "@/components/StandingsTable";
import { viewMatch, allowsDraws } from "@/lib/matchState";
import { loadTournament, groupTables, refResolver, resolveSlots } from "@/lib/tournamentState";

/* Spectator view. A Server Component: the scoring engine, the tie-break chain
 * and the knockout resolution all run here; the browser receives finished rows.
 * This is the read-heavy surface, cached at the edge and revalidated on write. */
export const revalidate = 30;

export default async function TournamentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const loaded = await loadTournament(slug);
  if (!loaded) notFound();

  const t = loaded.tournament;
  if (!canView(await principalFor(t.id), t.published)) notFound();

  const sport = sportOf(t.sport);
  const tables = groupTables(loaded);
  const resolver = refResolver(loaded, tables);
  const nameOf = (id: string) => loaded.teams.find((x) => x.id === id)?.name ?? "—";

  const knockout = loaded.matches.filter((m) => m.groupId === null);
  const groupMatches = loaded.matches.filter((m) => m.groupId !== null);

  const matchRow = (m: (typeof loaded.matches)[number]) => {
    const view = viewMatch(t, m);
    const [a, b] = resolveSlots(m, resolver, nameOf);
    const [sa, sb] = view.typed ? [m.typedScoreA, m.typedScoreB] : [view.a, view.b];
    const live = view.rallies > 0 && !view.over;
    const decided = view.over || view.typed;
    return (
      <li key={m.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
        <div className="mb-1 flex items-center gap-2 text-[10px] font-bold uppercase tracking-widest">
          <span className="text-neutral-500">{m.round}</span>
          {live && <span className="text-rose-400">● Live</span>}
          {decided && <span className="text-emerald-400">Final</span>}
          {view.osl && !view.over && <span className="ml-auto text-amber-400">{view.osl.pairLabel}</span>}
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex-1 truncate text-sm ${view.winner === "a" ? "font-bold" : a.teamId ? "" : "text-neutral-500"}`}>
            {a.label}
          </span>
          <span className="font-mono text-xl font-black tabular-nums">
            {decided || live ? `${sa ?? 0}–${sb ?? 0}` : "–"}
          </span>
          <span className={`flex-1 truncate text-right text-sm ${view.winner === "b" ? "font-bold" : b.teamId ? "" : "text-neutral-500"}`}>
            {b.label}
          </span>
        </div>
      </li>
    );
  };

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
        <header>
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
            {sport.emoji} {sport.name}
            {t.format === "osl" ? " · OSL team format" : t.format === "pickleboss" ? " · Pickleboss" : ""}
          </p>
          <h1 className="text-3xl font-black tracking-tight">{t.name}</h1>
        </header>

        {tables.length > 0 && (
          <section className="space-y-4">
            <h2 className="text-lg font-black">Standings</h2>
            {tables.map((table) => (
              <StandingsTable key={table.group.id} table={table} allowDraws={allowsDraws(t.sport)} />
            ))}
          </section>
        )}

        {knockout.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-black">Knockout</h2>
            <ol className="space-y-2">{knockout.map(matchRow)}</ol>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-black">{tables.length > 0 ? "Group matches" : "Matches"}</h2>
          <ol className="space-y-2">
            {(groupMatches.length ? groupMatches : loaded.matches.filter((m) => m.groupId === null && knockout.length === 0)).map(matchRow)}
            {loaded.matches.length === 0 && (
              <li className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
                No matches yet.
              </li>
            )}
          </ol>
        </section>

        <nav className="flex flex-wrap items-center gap-2 border-t border-neutral-900 pt-4">
          <Link
            href={`/t/${slug}/print?blank=1`}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-300 hover:border-neutral-500"
          >
            🖨 Print sheets
          </Link>
          <Link
            href={`/t/${slug}/ratings`}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-300 hover:border-neutral-500"
          >
            📈 Ratings
          </Link>
          <Link
            href={`/t/${slug}/score`}
            className="ml-auto rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-amber-950 hover:bg-amber-300"
          >
            Referee console
          </Link>
        </nav>
      </main>
    </>
  );
}
