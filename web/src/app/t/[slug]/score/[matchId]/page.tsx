import { notFound } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches, players, teams, tournaments } from "@/lib/db/schema";
import Link from "next/link";
import { viewMatch, rulesFor, describeCourt, noLiveCourt, teamsNotIn } from "@/lib/matchState";
import { matchResult, resultSentence } from "@/lib/results";
import { principalFor } from "@/lib/auth/guard";
import { canScore, canView } from "@/lib/auth/policy";
import { RefConsole, type ConsoleTeam } from "@/components/RefConsole";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { scorePoint, undoPoint, minusPoint, confirmRotation, setMatchSetup, pushLog } from "../../actions";
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
  if (!canView(principal, row.tournament.status)) notFound();

  const [teamRows, playerRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.tournamentId, row.tournament.id)),
    db.select().from(players).where(eq(players.tournamentId, row.tournament.id)),
  ]);

  const byTeam = new Map(teamRows.map((t) => [t.id, t]));
  const nameOf = new Map(playerRows.map((p) => [p.id, p.name]));

  const consoleTeam = (teamId: string | null, lineup: string[], side: "a" | "b"): ConsoleTeam => {
    const t = teamId ? byTeam.get(teamId) : null;
    return {
      /* Distinct even when NEITHER slot is filled yet. The console tells the
         two sides apart by this id — `sideOf` is `t.id === teamA.id ? "a" : "b"`
         — so one shared "tbd" made side B answer as side A, and React warned
         that two children shared a key, which it may duplicate or drop. A
         knockout match drawn before its feeders have played has exactly that
         shape. */
      id: t?.id ?? `tbd:${side}`,
      name: t?.name ?? "TBD",
      colour: t?.colour ?? null,
      players: lineup.map((id) => nameOf.get(id) ?? "—"),
    };
  };

  const view = viewMatch(row.tournament, row.match);
  /* Tennis, padel, carrom over a set number of boards: the court counts
     points and cannot finish these, so the page says how they ARE recorded
     instead of offering a court that never ends. */
  const noCourt = noLiveCourt(row.tournament, row.match);
  /* A knockout match whose slots are not filled: every rally would be refused,
     so there is no court to tap — only what unlocks it. */
  const waiting = noCourt ? null : teamsNotIn(row.match);
  /* Who won and how, in the words every other screen uses ("2–1", "0–2 w/o"). */
  const result = matchResult(row.tournament, row.match, view);
  const teamName = (id: string | null) => (id ? byTeam.get(id)?.name : null) ?? "TBD";
  const recorded = result ? resultSentence(result, teamName(row.match.teamAId), teamName(row.match.teamBId)) : null;

  /* The resolved rules cross to the client as DATA, never as code: the browser
     needs the numbers to score offline, but `resolveRules` and the format
     presets stay here. See lib/scoring/replayLite.ts for where that line is.
     The MATCH's rules — the ones it finished under, once it has. */
  const rules = rulesFor(row.tournament, row.match);
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

      {waiting ? (
        <div data-testid="teams-not-in" className="space-y-3 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <h2 className="text-base font-black">{waiting.title}</h2>
          <p className="text-sm text-neutral-300">{waiting.body}</p>
          <Link
            href={`/t/${slug}/manage`}
            className="inline-block rounded-lg bg-neutral-200 px-4 py-2 text-sm font-black text-neutral-900"
          >
            Go to the manage screen
          </Link>
        </div>
      ) : noCourt ? (
        <div data-testid="no-live-court" className="space-y-3 rounded-xl border border-neutral-700 bg-neutral-900 p-4">
          <h2 className="text-base font-black">{noCourt.title}</h2>
          <p className="text-sm text-neutral-300">{noCourt.body}</p>
          {recorded && (
            <p data-testid="recorded-result" className="text-sm font-bold text-emerald-300">
              Recorded: {recorded}
            </p>
          )}
          {/* Back to the event, not to the manage screen: there is nothing
              there yet to record this match with (step 10). */}
          <Link
            href={`/t/${slug}`}
            className="inline-block rounded-lg bg-neutral-200 px-4 py-2 text-sm font-black text-neutral-900"
          >
            Back to the event
          </Link>
        </div>
      ) : (
      <RefConsole
        view={view}
        teamA={consoleTeam(row.match.teamAId, row.match.lineupA, "a")}
        teamB={consoleTeam(row.match.teamBId, row.match.lineupB, "b")}
        canScore={canScore(principal)}
        notes={describeCourt(row.tournament, row.match)}
        eventHref={`/t/${slug}`}
        actions={{
          score: scorePoint,
          undo: undoPoint,
          minus: minusPoint,
          confirm: confirmRotation,
          setup: setMatchSetup,
          push: pushLog,
        }}
        offline={{
          rules: liteRules,
          format: row.tournament.format,
          serverLog: (row.match.log ?? []) as Side[],
          server: row.match.server as Side | null,
          posA: row.match.posA as 0 | 1 | null,
          posB: row.match.posB as 0 | 1 | null,
        }}
      />
      )}
    </main>
    </>
  );
}
