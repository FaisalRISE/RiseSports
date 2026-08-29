import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { matches, players, teams, tournaments } from "@/lib/db/schema";
import { viewMatch } from "@/lib/matchState";
import { sportOf } from "@/lib/sports/registry";
import { oslLineupIssues } from "@/lib/formats/osl";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { addTeam, addPlayer, removePlayer, addMatch, removeMatch } from "./actions";

export const dynamic = "force-dynamic";

export default async function ManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  if (!t) notFound();

  const [teamRows, playerRows, matchRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.tournamentId, t.id)),
    db.select().from(players).where(eq(players.tournamentId, t.id)),
    db.select().from(matches).where(eq(matches.tournamentId, t.id)),
  ]);
  const byTeam = new Map(teamRows.map((x) => [x.id, x]));
  const nameOf = new Map(playerRows.map((p) => [p.id, p.name]));
  const isOsl = t.format === "osl";

  const squadOf = (teamId: string) => playerRows.filter((p) => p.teamId === teamId);

  /* Bind the tournament id server-side so the client cannot aim these actions
     at a different tournament by editing the form. */
  const addTeamHere = addTeam.bind(null, t.id);
  const addMatchHere = addMatch.bind(null, t.id);

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl space-y-8 p-4 sm:p-6">
        <header>
          <Link href="/" className="text-xs font-bold text-neutral-400 hover:underline">← All tournaments</Link>
          <h1 className="mt-2 text-2xl font-black">{t.name}</h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
            {sportOf(t.sport).name}{isOsl ? " · OSL team format" : ""} ·{" "}
            <Link href={`/t/${slug}`} className="text-amber-400 underline">public page</Link>
          </p>
        </header>

        {/* ---------- teams and squads ---------- */}
        <section>
          <h2 className="mb-3 text-lg font-black">Teams</h2>
          <div className="space-y-3">
            {teamRows.map((team) => {
              const squad = squadOf(team.id);
              const issues = isOsl && squad.length >= 6
                ? oslLineupIssues(squad.slice(0, 6).map((p) => ({ id: p.id, name: p.name, gender: p.gender })))
                : [];
              return (
                <div key={team.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded" style={{ background: team.colour ?? "#666" }} />
                    <span className="font-bold">{team.name}</span>
                    <span className="ml-auto text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                      {squad.length} player{squad.length === 1 ? "" : "s"}
                      {isOsl && squad.length < 6 ? " · needs 6" : ""}
                    </span>
                  </div>

                  <ol className="mb-3 space-y-1">
                    {squad.map((p, i) => (
                      <li key={p.id} className="flex items-center gap-2 text-sm">
                        <span className="w-6 font-mono text-[11px] text-neutral-500">
                          {isOsl ? `A${i + 1}` : i + 1}
                        </span>
                        <span className="flex-1 truncate">{p.name}</span>
                        <span className={`rounded px-1.5 text-[10px] font-bold ${p.gender === "F" ? "bg-violet-500/20 text-violet-300" : "bg-blue-500/20 text-blue-300"}`}>
                          {p.gender}
                        </span>
                        <form action={removePlayer.bind(null, t.id, p.id)}>
                          <button className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">remove</button>
                        </form>
                      </li>
                    ))}
                  </ol>

                  {issues.length > 0 && (
                    <p className="mb-2 rounded-lg border border-rose-500/50 bg-rose-500/10 p-2 text-[11px] font-semibold text-rose-300">
                      {issues.join(" · ")}
                    </p>
                  )}

                  <form action={addPlayer.bind(null, t.id, team.id)} className="flex gap-2">
                    <input name="name" required placeholder="Player name"
                      className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm" />
                    <select name="gender" defaultValue="M"
                      className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm">
                      <option value="M">M</option>
                      <option value="F">F</option>
                    </select>
                    <button className="rounded-lg border border-neutral-600 px-3 text-xs font-bold">Add</button>
                  </form>
                </div>
              );
            })}
          </div>

          <form action={addTeamHere} className="mt-3 flex gap-2">
            <input name="name" required placeholder="New team name"
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            <button className="rounded-lg bg-neutral-200 px-4 text-xs font-black text-neutral-900">Add team</button>
          </form>
          {isOsl && (
            <p className="mt-2 text-[11px] text-neutral-500">
              OSL: the squad order is the declared pair order — A1+A2 play to 7, A3+A4 to 14, A5+A6 to 25.
              At least one woman must be in the six, and no two women may be paired (Rules 3.1, 3.2).
            </p>
          )}
        </section>

        {/* ---------- matches ---------- */}
        <section>
          <h2 className="mb-3 text-lg font-black">Matches</h2>
          <ul className="space-y-2">
            {matchRows.map((m) => {
              const v = viewMatch(t, m);
              const a = m.teamAId ? byTeam.get(m.teamAId) : null;
              const b = m.teamBId ? byTeam.get(m.teamBId) : null;
              return (
                <li key={m.id} className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                      {m.round}
                      {v.osl && !v.over ? ` · ${v.osl.pairLabel}` : ""}
                      {v.over ? " · final" : v.rallies > 0 ? " · live" : ""}
                    </p>
                    <p className="truncate text-sm">
                      {a?.name ?? "TBD"} <span className="font-mono font-bold">{v.a}–{v.b}</span> {b?.name ?? "TBD"}
                    </p>
                    {m.lineupA.length > 0 && (
                      <p className="truncate text-[11px] text-neutral-500">
                        {m.lineupA.map((id) => nameOf.get(id)).join(", ")}
                      </p>
                    )}
                  </div>
                  <Link href={`/t/${slug}/score/${m.id}`}
                    className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-black text-amber-950">
                    Score
                  </Link>
                  <form action={removeMatch.bind(null, t.id, m.id)}>
                    <button className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">delete</button>
                  </form>
                </li>
              );
            })}
            {matchRows.length === 0 && (
              <li className="rounded-xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
                No matches yet.
              </li>
            )}
          </ul>

          <form action={addMatchHere} className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
            <input name="round" defaultValue="Round 1" placeholder="Round"
              className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            <select name="teamA" required className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm">
              <option value="">Team A…</option>
              {teamRows.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select name="teamB" required className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm">
              <option value="">Team B…</option>
              {teamRows.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <button className="rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900">Add match</button>
          </form>
          <p className="mt-2 text-[11px] text-neutral-500">
            The line-up is seeded from each squad in listed order; reorder the squad above before play begins.
          </p>
        </section>
      </main>
    </>
  );
}
