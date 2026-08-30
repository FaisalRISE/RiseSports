import type { GroupTable } from "@/lib/tournamentState";

/* A group table. Server-rendered: the sort, including every tie-break, has
 * already happened on the server. */
export function StandingsTable({ table, allowDraws }: { table: GroupTable; allowDraws: boolean }) {
  const { group, rows, complete } = table;
  return (
    <section className="rounded-xl border border-neutral-800 bg-neutral-900/60">
      <header className="flex items-baseline gap-2 border-b border-neutral-800 px-4 py-3">
        <h3 className="font-bold">{group.name ?? `Group ${group.key}`}</h3>
        {group.court && <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">{group.court}</span>}
        <span className={`ml-auto text-[10px] font-bold uppercase tracking-widest ${complete ? "text-emerald-400" : "text-neutral-500"}`}>
          {complete ? "complete" : "in progress"}
        </span>
      </header>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-[10px] uppercase tracking-widest text-neutral-500">
              <th className="w-8 px-2 py-2 text-left font-bold">#</th>
              <th className="px-2 py-2 text-left font-bold">Team</th>
              <th className="px-2 py-2 text-right font-bold">P</th>
              <th className="px-2 py-2 text-right font-bold">W</th>
              {allowDraws && <th className="px-2 py-2 text-right font-bold">D</th>}
              <th className="px-2 py-2 text-right font-bold">L</th>
              <th className="px-2 py-2 text-right font-bold">For</th>
              <th className="px-2 py-2 text-right font-bold">Diff</th>
              <th className="px-2 py-2 text-right font-bold">Pts</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.teamId} className="border-t border-neutral-800">
                <td className="px-2 py-2 font-mono text-neutral-500">{r.rank}</td>
                <td className="px-2 py-2 font-semibold">{r.name}</td>
                <td className="px-2 py-2 text-right font-mono text-neutral-400">{r.played}</td>
                <td className="px-2 py-2 text-right font-mono">{r.won}</td>
                {allowDraws && <td className="px-2 py-2 text-right font-mono text-neutral-400">{r.drawn}</td>}
                <td className="px-2 py-2 text-right font-mono text-neutral-400">{r.lost}</td>
                <td className="px-2 py-2 text-right font-mono text-neutral-400">{r.pointsFor}</td>
                <td className={`px-2 py-2 text-right font-mono ${r.diff > 0 ? "text-emerald-400" : r.diff < 0 ? "text-rose-400" : "text-neutral-500"}`}>
                  {r.diff > 0 ? "+" : ""}{r.diff}
                </td>
                <td className="px-2 py-2 text-right font-mono font-black">{r.points}</td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={9} className="px-4 py-6 text-center text-neutral-500">No teams drawn yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
