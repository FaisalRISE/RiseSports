import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches, players, teams, tournaments } from "@/lib/db/schema";
import { viewMatch, rulesFor } from "@/lib/matchState";
import { principalFor } from "@/lib/auth/guard";
import { canScore, canView } from "@/lib/auth/policy";
import { RefConsole, type ConsoleTeam } from "@/components/RefConsole";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { scorePoint, undoPoint, confirmRotation, pushLog } from "../../actions";
import type { LiteRules } from "@/lib/scoring/replayLite";
import type { Side } from "@/lib/scoring/replay";

/* Never cached: this is the live scoring surface. */
export const dynamic = "force-dynamic";

export default async function ScorePage({
  params,
}: {
  params: Promise<{ slug: string; matchId: string }>;
}) {
  const { slug, matchId } = await params;

  const [row] = await db
    .select({ match: matches, tournament: tournaments })
    .from(matches)
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(and(eq(matches.id, matchId), eq(tournaments.slug, slug)))
    .limit(1);
  if (!row) notFound();

  const principal = await principalFor(row.tournament.id);
  if (!canView(principal, row.tournament.published)) notFound();

  const [teamRows, playerRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.tournamentId, row.tournament.id)),
    db.select().from(players).where(eq(players.tournamentId, row.tournament.id)),
  ]);

  const byTeam = new Map(teamRows.map((t) => [t.id, t]));
  const nameOf = new Map(playerRows.map((p) => [p.id, p.name]));

  const consoleTeam = (teamId: string | null, lineup: string[]): ConsoleTeam => {
    const t = teamId ? byTeam.get(teamId) : null;
    return {
      id: t?.id ?? "tbd",
      name: t?.name ?? "TBD",
      colour: t?.colour ?? null,
      players: lineup.map((id) => nameOf.get(id) ?? "—"),
    };
  };

  const view = viewMatch(row.tournament, row.match);

  /* The resolved rules cross to the client as DATA, never as code: the browser
     needs the numbers to score offline, but `resolveRules` and the format
     presets stay here. See lib/scoring/replayLite.ts for where that line is. */
  const rules = rulesFor(row.tournament);
  const liteRules: LiteRules | null = rules
    ? {
        target: rules.target,
        winBy: rules.winBy,
        cap: rules.cap,
        golden: rules.golden,
        sideOut: rules.sideOut,
        serve: rules.serve as LiteRules["serve"],
        perCourt: rules.perCourt,
      }
    : null;

  return (
    <>
    <OpenAccessBanner />
    <main className="mx-auto max-w-3xl p-4 sm:p-6">
      <h1 className="mb-1 text-xl font-black">{row.tournament.name}</h1>
      <p className="mb-4 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
        {row.match.round}
        {row.match.court ? ` · Court ${row.match.court}` : ""}
        {canScore(principal) ? "" : " · view only"}
      </p>

      <RefConsole
        view={view}
        teamA={consoleTeam(row.match.teamAId, row.match.lineupA)}
        teamB={consoleTeam(row.match.teamBId, row.match.lineupB)}
        canScore={canScore(principal)}
        actions={{ score: scorePoint, undo: undoPoint, confirm: confirmRotation, push: pushLog }}
        offline={{
          rules: liteRules,
          format: row.tournament.format,
          serverLog: (row.match.log ?? []) as Side[],
          server: row.match.server as Side | null,
          posA: row.match.posA as 0 | 1 | null,
          posB: row.match.posB as 0 | 1 | null,
        }}
      />
    </main>
    </>
  );
}
