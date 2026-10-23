import Link from "next/link";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { and, countDistinct, eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { matches, players, ratingHistory, registrations, teams, tournaments } from "@/lib/db/schema";
import { DrawButton } from "./DrawButton";
import { ConfirmButton } from "./ConfirmButton";
import { RestartCategory } from "./RestartCategory";
import { drawSignature, lockedIds } from "@/lib/draw/guard";
import { ProblemNotice } from "./ProblemNotice";
import { viewMatch } from "@/lib/matchState";
import { hasPlay, matchLine, matchResult } from "@/lib/results";
import { pairPlan, pairSignature, restartSignature } from "@/lib/results/clear";
import { dependentsByTarget } from "@/lib/brackets";
import { principalFor } from "@/lib/auth/guard";
import { canManage } from "@/lib/auth/policy";
import { RESULT_ENTRY_ON_SCREEN, walkoverScore } from "@/lib/results/record";
import { sportOf, usesDupr } from "@/lib/sports/registry";
import { oslLineupIssues } from "@/lib/formats/osl";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { addTeam, addPlayer, removePlayer, addMatch, removeMatch, clearResult, giveWalkover, removePair, startCategoryAgain, generateGroups, generateKnockout, generateSingleElim, fillKnockoutSlots, seedByRating, searchRoster, addDivision, setDivisionShape, generateSchedule, dropSchedule } from "./actions";
import { floatingTime, floatingDay, floatingInputValue } from "@/lib/schedule";
import { scheduleRows, scheduleText, whatsappHref } from "@/lib/schedule/share";
import { divisionsOf } from "@/lib/divisions";
import { SEED_BANDS } from "@/lib/rating";
import { loadTournament, groupTables, resolverFactory, resolveSlots, groupMembers, fixtureDeletionProblem, entrantNoun } from "@/lib/tournamentState";
import { StandingsTable } from "@/components/StandingsTable";
import { ScoringControls, type ScoringState } from "./ScoringControls";
import { maxGroupsFor } from "@/lib/formats/pickleboss";
import { resolveRules } from "@/lib/scoring/rules";
import { allowsDraws, boardsOf, endingOf } from "@/lib/matchState";
import { PersonLink } from "@/components/PersonLink";
import { AddPlayerForm } from "./AddPlayerForm";
import { DivisionRulesForm } from "./DivisionRulesForm";
import { setDivisionRules, describeDivisionRules } from "./actions";
import {
  PRESETS, dateLabel, duprLabel, floatingDateISO, hasRules, needsFrom, ruleChips, rulesOfDivision, todayInIndia,
} from "@/lib/eligibility";
import { divisionMisfits } from "@/lib/eligibility/store";
import { TIERS } from "@/lib/rating";

export const dynamic = "force-dynamic";

export default async function ManagePage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ problem?: string; category?: string; match?: string; team?: string; done?: string; refill?: string }>;
}) {
  const { slug } = await params;
  const { problem, category: problemCategory, match: problemMatch, team: problemTeam, done, refill } = await searchParams;
  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  if (!t) notFound();
  /* The organiser's screen — as the registration screen already was. While
     access is open everybody passes (lib/auth/access); once sign-in exists, a
     PIN referee gets a 404 here rather than buttons whose every press the
     server refuses (clearing a result is the organiser's alone, Faisal). */
  if (!canManage(await principalFor(t.id))) notFound();

  const [teamRows, playerRows, matchRows, divisionRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.tournamentId, t.id)),
    db.select().from(players).where(eq(players.tournamentId, t.id)),
    db.select().from(matches).where(eq(matches.tournamentId, t.id)),
    divisionsOf(t.id),
  ]);
  const byTeam = new Map(teamRows.map((x) => [x.id, x]));
  const playerNameOf = new Map(playerRows.map((p) => [p.id, p.name]));
  const isOsl = t.format === "osl";
  /* "pair", "player" or "team" — one noun for every sentence about an entrant. */
  const noun = entrantNoun(t);

  const squadOf = (teamId: string) => playerRows.filter((p) => p.teamId === teamId);
  /* A pair that was removed stays on the team list, marked Withdrawn, and is
     counted nowhere else: not in "N teams", not in what a draw may split, not
     in the lists a match is added from (step 8b). */
  const activeTeams = teamRows.filter((x) => !x.withdrawnAt);
  const teamsIn = (divisionId: string) =>
    activeTeams.filter((x) => x.divisionId === divisionId).length;

  const divisionName = new Map(divisionRows.map((d) => [d.id, d.name]));

  /* Matches whose rating change is still on record. The server's guard counts
     them as played (a result that was undone after its rating moved still
     locks the draw), so the page must too — or it offers a redraw the server
     then refuses with no match named. One query, AFTER the fixed Promise.all. */
  const locked = await lockedIds(matchRows);
  const recorded = (m: (typeof matchRows)[number]) => locked.has(m.id);
  /* How many people each match's rating moved, and each category's — what a
     clear and a restart take back, said before they do. Two grouped queries,
     sequential, after the fixed Promise.all (lib/db/index.ts). */
  const ratedPeople = new Map(
    (await db
      .select({ id: ratingHistory.matchId, n: countDistinct(ratingHistory.personId) })
      .from(ratingHistory)
      .innerJoin(matches, eq(ratingHistory.matchId, matches.id))
      .where(eq(matches.tournamentId, t.id))
      .groupBy(ratingHistory.matchId)).map((r) => [r.id, Number(r.n)]),
  );
  const ratedInCategory = new Map(
    (await db
      .select({ id: matches.divisionId, n: countDistinct(ratingHistory.personId) })
      .from(ratingHistory)
      .innerJoin(matches, eq(ratingHistory.matchId, matches.id))
      .where(eq(matches.tournamentId, t.id))
      .groupBy(matches.divisionId)).map((r) => [r.id, Number(r.n)]),
  );
  /* Who each match's rating moved, so "Remove the pair" can say how many
     DIFFERENT people its matches moved — a sum per match counts a partner
     once per match. And each team's approved online entries, which the
     removal withdraws. Two more queries, sequential. */
  const ratedBy = new Map<string, Set<string>>();
  for (const r of await db
    .select({ matchId: ratingHistory.matchId, personId: ratingHistory.personId })
    .from(ratingHistory)
    .innerJoin(matches, eq(ratingHistory.matchId, matches.id))
    .where(eq(matches.tournamentId, t.id))) {
    if (!r.matchId) continue;
    if (!ratedBy.has(r.matchId)) ratedBy.set(r.matchId, new Set());
    ratedBy.get(r.matchId)!.add(r.personId);
  }
  const entriesOf = new Map<string, string[]>();
  for (const e of await db
    .select({ id: registrations.id, teamId: registrations.teamId })
    .from(registrations)
    .where(and(eq(registrations.tournamentId, t.id), eq(registrations.status, "approved")))) {
    if (e.teamId) entriesOf.set(e.teamId, [...(entriesOf.get(e.teamId) ?? []), e.id]);
  }

  /* What each draw would replace, and whether any of it has a result. A draw
     with a result in it is refused on the server (lib/draw/guard), so the page
     says why instead of offering a button that will not work, and a redraw that
     replaces unplayed fixtures asks twice (`DrawButton`). */
  const drawState = (divisionId: string) => {
    const mine = matchRows.filter((m) => m.divisionId === divisionId);
    const whole = mine.filter((m) => m.groupId !== null || m.bracket !== null);
    const bracketRows = mine.filter((m) => m.bracket !== null);
    /* The fingerprint the server checks (drawSignature). It also keys the
       button, so a redraw — new rows, new fingerprint — remounts it closed. */
    const sig = (rows: typeof mine) => drawSignature(rows.map((m) => m.id));
    return {
      wholePlayed: whole.filter(recorded).map((m) => m.round),
      wholeCount: whole.length,
      wholeSig: sig(whole),
      bracketPlayed: bracketRows.filter(recorded).map((m) => m.round),
      bracketCount: bracketRows.length,
      bracketSig: sig(bracketRows),
    };
  };

  /* The submit end of a draw form. With a result in what it would replace: no
     button, the reason. Otherwise `DrawButton`: one tap for a first draw, two
     for a redraw, and the server refuses a redraw that did not confirm. */
  const drawControl = (token: string, label: string, played: string[], count: number, replaces: string) =>
    played.length > 0 ? (
      <p data-draw-locked className="self-center text-[11px] font-semibold text-amber-300">
        Can’t redraw — {played.length === 1 ? "a match here has been played or started" : `${played.length} matches here have been played or started`}{" "}
        ({played.slice(0, 3).join(", ")}{played.length > 3 ? ", …" : ""}), and a redraw would throw{" "}
        {played.length === 1 ? "it" : "them"} away. Clear or reset {played.length === 1 ? "it" : "them"} in
        the match list, or start this category again.
      </p>
    ) : (
      <DrawButton key={`${label}:${token}`} token={token} label={label} replaces={count > 0 ? replaces : null} />
    );
  const fixtures = (n: number) => `${n} ${n === 1 ? "match" : "matches"}`;
  /* "Qualify per group" can ask no more of a group than the pairs it has left
     — the server refuses more (`knockout-too-many`). Four at most, as before. */
  const qualifyMax = (divisionId: string) =>
    Math.max(1, Math.min(4, ...tables.filter((tb) => tb.group.divisionId === divisionId).map((tb) => tb.members.length)));

  /* A refusal comes back as a CODE (see runDraw); the sentence is built here,
     from the database, never carried in the URL. */
  const problemName = (problemCategory && divisionName.get(problemCategory)) || "This category";
  const problemText =
    problem === "draw-locked" ? `${problemName} already has results, so it was not redrawn: a redraw would throw them away. Clear them, or start the category again, first.`
    : problem === "draw-changed" ? `A result came in for ${problemName} while the draw was being made, so nothing was changed.`
    : problem === "unknown-category" ? "That category is not part of this event, so nothing was drawn."
    : problem === "restart-gone" ? "That category is no longer part of this event — it was removed — so there was nothing to start again."
    : problem === "confirm-needed" ? `Nothing in ${problemName} was redrawn: a redraw replaces its fixtures, so it needs “Yes, redraw”.`
    : problem === "draw-stale" ? `${problemName} changed since this page was opened, so nothing was redrawn. Look at it again, then redraw if you still want to.`
    : problem === "knockout-too-many" ? `The knockout for ${problemName} was not drawn: a group there has fewer ${noun.many} left than the number asked to qualify from each group.`
    : problem === "match-gone" ? "That match is not part of this event any more — it may have been deleted, for example with a pair that was removed — so nothing was done to it."
    : problem === "team-gone" ? "That team is no longer in this event, so nothing was removed."
    : null;

  /* ── Who can enter each category ──────────────────────────────────────
     Loaded AFTER the page's fixed Promise.all, never inside it: it is a fixed
     number of queries of its own, and folding it into the fan-out would widen
     it past what the pool is sized for (lib/db/index.ts). */
  const misfits = await divisionMisfits(t.id);
  const misfitOf = new Map(misfits.map((m) => [m.teamId, m]));
  const rulesOf = new Map(divisionRows.map((d) => [d.id, rulesOfDivision(d)]));
  const eventDay = t.startsAt ? floatingDateISO(t.startsAt) : null;

  /* Bind the tournament id server-side so the client cannot aim these actions
     at a different tournament by editing the form. */
  const addTeamHere = addTeam.bind(null, t.id);
  const addMatchHere = addMatch.bind(null, t.id);

  /* ── Scoring, for the controls below ──────────────────────────────────
   * The current rules come from the engine rather than being re-derived here,
   * so what the form starts on is exactly what a match will be played under.
   * A FORMAT preset fixes the rules, in which case the controls cannot apply. */
  const presetName =
    t.format === "osl" ? "OSL Rules v4.8"
    : t.format === "pickleboss" ? "Pickleboss"
    : null;

  const liveRules = resolveRules(t.sport, (t.scoring ?? null) as never);
  const sportRules = resolveRules(t.sport, null);
  const sportDefaultLabel = sportRules
    ? `to ${sportRules.target}${sportRules.winBy > 1 ? `, win by ${sportRules.winBy}` : ""}`
    : "this sport's own rules";

  const scoringState: ScoringState = {
    target: liveRules?.target ?? 11,
    winBy2: (liveRules?.winBy ?? 2) > 1,
    /* `cap` is one above the golden point; "none" means the two-point rule has
       no ceiling at all. */
    goldenAt: liveRules?.golden ?? "none",
    switchAt: liveRules?.switchAt ?? null,
    /* Only show an explicit choice when the organiser has actually made one.
       Deriving it from the resolved rules would pre-select "Service" on every
       pickleball event and then WRITE that as an override on the first save —
       pinning a value that was only ever the sport's default. */
    scoreType: t.scoring == null ? "" : liveRules?.sideOut ? "service" : "rally",
    boards: t.sport === "cr" ? boardsOf(t.scoring) : null,
  };

  const loaded = await loadTournament(slug);
  const tables = loaded ? groupTables(loaded) : [];
  /* Per category: "A1" means the A of the match's OWN category. */
  const resolverFor = loaded ? resolverFactory(loaded, tables) : null;
  const teamNameOf = (id: string) => teamRows.find((x) => x.id === id)?.name ?? "—";

  /* The order of play, from the one definition the print pack, the CSV and the
     WhatsApp message also use — see lib/schedule/share. Four hand-written
     versions of "the schedule as a table" is four things to drift. */
  const allRows = loaded && resolverFor
    ? scheduleRows(loaded, { tables, resolverFor, divisionName })
    : [];
  const timed = allRows.filter((r) => r.time);
  const firstTimed = matchRows
    .filter((m) => m.scheduledAt)
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0];

  /* The link the message points at, built from the request rather than an env
     var so it is right on localhost, on a preview deploy and in production
     without anything to configure. */
  const host = (await headers()).get("host") ?? "rise-sports.vercel.app";
  const publicUrl = `${host.startsWith("localhost") ? "http" : "https"}://${host}/t/${slug}`;
  const shareHref = whatsappHref(
    scheduleText(
      { name: t.name, day: firstTimed ? floatingDay(firstTimed.scheduledAt!) : null,
        venue: t.venue, url: publicUrl },
      allRows,
    ),
  );

  /* An unfilled knockout side shows its seed reference in words rather than
     "TBD", so an organiser can see where the team will come from. */
  const slotLabel = (m: (typeof matchRows)[number], side: "a" | "b", teamName?: string) => {
    if (teamName) return teamName;
    if (!resolverFor) return "TBD";
    const [ra, rb] = resolveSlots(m, resolverFor(m.divisionId), teamNameOf);
    return (side === "a" ? ra : rb).label;
  };

  /* ── Clearing, resetting and deleting a match (step 8) ────────────────
     The page shows the control the server will accept, or the reason in its
     place — judged the way the server judges (lib/results/clear): "played" is
     `lockedIds`, and what waits on a match is the one dependency graph. */
  const matchById = new Map(matchRows.map((m) => [m.id, m]));
  const dependents = dependentsByTarget(matchRows, loaded?.groups ?? []);
  const groupKeyOf = new Map((loaded?.groups ?? []).map((g) => [g.id, g.key]));
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const hasResult = (m: (typeof matchRows)[number]) => !!matchResult(t, m);
  const labelOf = (m: (typeof matchRows)[number]) =>
    `${m.round} — ${slotLabel(m, "a", m.teamAId ? byTeam.get(m.teamAId)?.name : undefined)} v ${slotLabel(m, "b", m.teamBId ? byTeam.get(m.teamBId)?.name : undefined)}`;

  /** What removing a team would do — `pairPlan`, the server's own reading. */
  const planFor = (teamId: string) => {
    const team = byTeam.get(teamId)!;
    const rows = matchRows.filter((r) => r.divisionId === team.divisionId);
    const gs = (loaded?.groups ?? []).filter((g) => g.divisionId === team.divisionId);
    const shape = divisionRows.find((d) => d.id === team.divisionId)?.shape;
    return pairPlan(teamId, rows, gs, teamRows.filter((x) => x.divisionId === team.divisionId), (id) => locked.has(id), shape === "groups_ko");
  };
  const joinNames = (names: string[]) =>
    names.length <= 1 ? (names[0] ?? "") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

  /** Why a group fixture cannot go — the server's `fixtureDeletionProblem`,
      read from the same members: the group's only match, or a pair's last. */
  const groupShort = (m: (typeof matchRows)[number]): string | null => {
    if (!m.groupId) return null;
    const key = groupKeyOf.get(m.groupId) ?? "";
    const fixtures = matchRows.filter((r) => r.groupId === m.groupId);
    const members = groupMembers(teamRows, fixtures, m.groupId).map((x) => x.id);
    const p = fixtureDeletionProblem(members, fixtures, m.id);
    if (!p) return null;
    if (p.code === "group-short") {
      return `Can’t delete — it’s Group ${key}’s only match. Without it Group ${key} could never finish, and nobody from it would reach the knockout.`;
    }
    /* "…or remove the pair" only where their card offers it — the card may
       refuse (a knockout match, or a group too small without them). */
    const theirs = planFor(p.teamId);
    const removable = !theirs.knockout && !theirs.blocks && !theirs.groupProblem;
    return `Can’t delete — it’s ${byTeam.get(p.teamId)?.name ?? `a ${noun.one}`}’s last match in Group ${key}, and the table would show them at nought played. If they pulled out, give the walkover${removable ? `, or remove the ${noun.one}` : ""}.`;
  };

  /** "Walkover…" on a match nobody has played, with both teams known. Asks
      who gets it; the question says what it counts as and where it sends them. */
  const walkoverControl = (m: (typeof matchRows)[number]) => {
    if (!m.teamAId || !m.teamBId || recorded(m)) return null;
    const a = byTeam.get(m.teamAId)?.name ?? "Team A";
    const b = byTeam.get(m.teamBId)?.name ?? "Team B";
    const score = `${walkoverScore(endingOf(t, m))}–0`;
    const key = m.groupId ? groupKeyOf.get(m.groupId) : null;
    const waits = (dependents.get(m.id) ?? []).map((d) => ({ d, row: matchById.get(d.id) })).filter((x) => x.row && x.d.kind === "tie");
    const onward = [...new Set(waits.filter((x) => !(x.d.side === "a" ? x.row!.slotA : x.row!.slotB)?.startsWith("L:")).map((x) => x.row!.round))];
    const loserTo = [...new Set(waits.filter((x) => (x.d.side === "a" ? x.row!.slotA : x.row!.slotB)?.startsWith("L:")).map((x) => x.row!.round))];
    const question = [
      `Who gets the walkover? It counts as ${score}${key ? ` in the Group ${key} table` : ""}, and nobody’s rating changes.`,
      onward.length ? `The winner goes through to ${onward.join(" and ")} — press “Fill resolved slots” afterwards.` : "",
      loserTo.length ? `The side walked over still goes to ${loserTo.join(" and ")}; if they have left, give a walkover there too.` : "",
    ].filter(Boolean).join(" ");
    return (
      <form action={giveWalkover.bind(null, t.id, m.id)} className="flex max-w-full flex-wrap items-center gap-2">
        <ConfirmButton key={m.rev} token={m.rev} hook="walkover" label="Walkover…" yes="" question={question}
          choices={[{ value: "a", label: `Walkover to ${a}` }, { value: "b", label: `Walkover to ${b}` }]} />
      </form>
    );
  };

  /** The control at the end of a match's row: a form, or the reason there is none. */
  const rowControl = (m: (typeof matchRows)[number]) => {
    const deps = (dependents.get(m.id) ?? []).map((d) => ({ d, row: matchById.get(d.id) })).filter((x) => x.row);
    if (recorded(m)) {
      const live = hasPlay(m) && !hasResult(m);
      const verb = live ? "reset" : "clear";
      const blocked = deps.find((x) => recorded(x.row!));
      if (blocked) {
        const r = blocked.row!;
        /* Named by the control that match's own row offers: Reset while it is
           being played, Clear otherwise — including a rating with no score,
           which an old bug could leave and which its row offers to clear. */
        const isLive = hasPlay(r) && !hasResult(r);
        return (
          <p data-row-locked className="basis-full text-[11px] font-semibold text-amber-300">
            Can’t {verb} yet — {r.round} {isLive ? "has already started" : hasResult(r) ? "has a result" : "has a rating on record"}.{" "}
            {isLive ? `Reset ${r.round} first.` : `Clear ${r.round} first.`}
          </p>
        );
      }
      const n = ratedPeople.get(m.id) ?? 0;
      const line = matchLine(t, m, viewMatch(t, m));
      const a = slotLabel(m, "a", m.teamAId ? byTeam.get(m.teamAId)?.name : undefined);
      const b = slotLabel(m, "b", m.teamBId ? byTeam.get(m.teamBId)?.name : undefined);
      const emptied = deps.filter((x) => (x.d.side === "a" ? x.row!.teamAId : x.row!.teamBId)).map((x) => x.row!.round);
      const afterward = emptied.length ? ` ${[...new Set(emptied)].join(" and ")} will wait for this match’s result again.` : "";
      const question = live
        ? `Reset ${a} ${line.score} ${b} to 0–0? The ${plural((m.log ?? []).length, "rally", "rallies")} scored so far will be removed. If a referee is still scoring it, their phone is told, and the points on it are not kept.${afterward}`
        : !hasPlay(m)
          ? `This match has no score, but the rating changes it gave ${plural(n, "player", "players")} are still on record. Take them back?`
          : n > 0
            ? `Clear the result ${a} ${line.score} ${b}? The rating changes it gave ${plural(n, "player", "players")} will be taken back, and the match goes back to not played.${afterward}`
            : `Clear the result ${a} ${line.score} ${b}? It didn’t change anyone’s rating. The match goes back to not played.${afterward}`;
      return (
        <form action={clearResult.bind(null, t.id, m.id)} className="flex max-w-full flex-wrap items-center gap-2">
          <ConfirmButton key={m.rev} token={m.rev} hook={live ? "reset" : "clear"}
            label={live ? "Reset to 0–0…" : "Clear result…"}
            yes={live ? "Yes, reset to 0–0" : !hasPlay(m) ? "Yes, take them back" : "Yes, clear the result"}
            question={question} />
        </form>
      );
    }
    /* Not played: "Walkover…" whenever both teams are known — even where a
       delete is refused, because a semi-final the Final waits on is exactly
       where a pair pulls out — and beside it the delete, or why not. */
    const deleteControl = (() => {
      const feeds = deps.find((x) => x.d.kind === "tie");
      if (feeds) {
        return (
          <p data-row-locked className="basis-full text-[11px] font-semibold text-amber-300">
            Can’t delete — {feeds.row!.round} waits on the{" "}
            {(feeds.d.side === "a" ? feeds.row!.slotA : feeds.row!.slotB)?.startsWith("L:") ? "loser" : "winner"} of this
            match. To change the knockout, redraw it while none of it has been played.
          </p>
        );
      }
      const short = groupShort(m);
      if (short) return <p data-row-locked className="basis-full text-[11px] font-semibold text-amber-300">{short}</p>;
      const key = m.groupId ? groupKeyOf.get(m.groupId) : null;
      const a = slotLabel(m, "a", m.teamAId ? byTeam.get(m.teamAId)?.name : undefined);
      const b = slotLabel(m, "b", m.teamBId ? byTeam.get(m.teamBId)?.name : undefined);
      const question = `Delete ${m.round} — ${a} v ${b}? It hasn’t been played.${key ? ` Group ${key} will finish without it, and ${a} and ${b} will each play one match fewer than the rest of the group.` : ""}`;
      return (
        <form action={removeMatch.bind(null, t.id, m.id)} className="flex max-w-full flex-wrap items-center gap-2">
          <ConfirmButton key={m.rev} token={m.rev} hook="delete" label="Delete match…" yes="Yes, delete" question={question} />
        </form>
      );
    })();
    return <>{walkoverControl(m)}{deleteControl}</>;
  };

  /** A refusal or a done message for one match, said in that match's row. */
  const rowNotice = (m: (typeof matchRows)[number]): { code: string; text: string; done: boolean } | null => {
    if (problemMatch !== m.id) return null;
    const label = labelOf(m);
    if (done === "walkover") {
      const res = matchResult(t, m);
      const winner = res?.winner ? byTeam.get((res.winner === "a" ? m.teamAId : m.teamBId) ?? "")?.name : null;
      const onward = (dependents.get(m.id) ?? [])
        .filter((d) => d.kind === "tie" && !(d.side === "a" ? matchById.get(d.id)?.slotA : matchById.get(d.id)?.slotB)?.startsWith("L:"))
        .map((d) => matchById.get(d.id)?.round).filter(Boolean);
      const hi = res ? Math.max(res.a, res.b) : null;
      return {
        code: done, done: true,
        text: winner && hi !== null
          ? `Walkover to ${winner}, ${hi}–0. Nobody’s rating changed.${onward.length ? ` Press “Fill resolved slots” to put ${winner} into ${[...new Set(onward)].join(" and ")}.` : ""}`
          : `${label}: the walkover was recorded.`,
      };
    }
    if (done === "cleared") {
      return { code: done, done: true, text: `Done — ${label} is back to not played, and any rating changes it made were taken back.` };
    }
    /* The clear had happened before this tap arrived — another page, or a
       retry. Whatever has happened since is left alone, and said. */
    if (done === "already") {
      return recorded(m)
        ? { code: done, done: true, text: `${label} had already been cleared, and has been played again since — nothing was changed now. Look at it again if it needs clearing.` }
        : { code: done, done: true, text: `${label} had already been cleared: it is back to not played, and its rating changes were taken back.` };
    }
    const after = (dependents.get(m.id) ?? []).map((d) => matchById.get(d.id)).find((r) => r && recorded(r));
    const text =
      problem === "match-played" ? `${label} was not deleted: it has a result. Clear the result first.`
      : problem === "match-started" ? `${label} was not deleted: it has been started. Reset it to 0–0 first.`
      : problem === "match-stale" ? `${label} changed since this page was opened, so nothing was done. Look at it again.`
      : problem === "match-feeds" ? `${label} was not deleted: a later match waits on its result.`
      : problem === "group-short" ? `${label} was not deleted: it is its group’s only match, and the group could not finish without it.`
      : problem === "pair-stranded" ? `${label} was not deleted: it is the last match in the group for one of its ${noun.many}. If they pulled out, give the walkover.`
      : problem === "walkover-confirm" ? `${label}: no walkover was given — choose who gets it.`
      : problem === "walkover-played" ? `${label}: no walkover was given — it already has a result. Clear it first.`
      : problem === "walkover-started" ? `${label}: no walkover was given — it has been started. Reset it to 0–0 first.`
      : problem === "walkover-stale" ? `${label} changed since this page was opened, so no walkover was given. Look at it again.`
      : problem === "walkover-teams" ? `${label}: no walkover was given — both teams must be known first.`
      : problem === "walkover-refused" ? `${label}: the walkover was not recorded.`
      : problem === "match-changed" ? `${label} got a score while it was being deleted, so it was kept.`
      : problem === "match-confirm" ? `${label} was not changed: it needs the second tap.`
      : problem === "clear-stale" ? `${label} changed since this page was opened (it is now ${matchLine(t, m, viewMatch(t, m)).score}), so it was not cleared. Look at it again — if it is being scored, ask the referee to stop first.`
      : problem === "clear-blocked" ? (() => {
          /* Said as the waiting match's own row says it: started (Reset), a
             result, or a rating with no score (both Clear). Nothing waits on it
             any more — cleared or reset since — and the clear can just be tried
             again. */
          if (!after) return `${label} was not cleared, because a later match had started or had a result. Nothing waits on it now: clear it again.`;
          const isLive = hasPlay(after) && !hasResult(after);
          const state = isLive ? "has started" : hasResult(after) ? "has a result" : "has a rating on record";
          return `${label} was not cleared: ${after.round} ${state}. ${isLive ? "Reset" : "Clear"} ${after.round} first.`;
        })()
      : null;
    return text && problem ? { code: problem, done: false, text } : null;
  };

  /** A refusal or a done message for "Start this category again", in its card. */
  const categoryNotice = (divisionId: string, name: string): { code: string; text: string; done: boolean } | null => {
    if (problemCategory !== divisionId) return null;
    if (done === "restarted") {
      return { code: done, done: true, text: `${name} has started again: every result was cleared and the rating changes taken back. You can redraw it now.` };
    }
    const text =
      problem === "restart-stale" ? `${name}’s results changed since this page was opened, so nothing was cleared. Look at it again.`
      : problem === "restart-name" ? `Nothing was cleared: type the category’s name, ${name}, to confirm.`
      : problem === "restart-empty" ? `Nothing to start again — no match in ${name} has a result yet.`
      : problem === "restart-confirm" ? `Nothing in ${name} was cleared: starting it again needs “Start ${name} again”.`
      : null;
    return text && problem ? { code: problem, done: false, text } : null;
  };

  /** "Start this category again…", with what it would clear, or nothing. */
  const restartControl = (divisionId: string, name: string) => {
    const rec = matchRows.filter((m) => m.divisionId === divisionId && recorded(m));
    if (rec.length === 0) return null;
    const live = rec.filter((m) => hasPlay(m) && !hasResult(m)).length;
    const finished = rec.length - live;
    const people = ratedInCategory.get(divisionId) ?? 0;
    const parts = [
      finished > 0 ? `${finished} finished` : null,
      live > 0 ? `${live} being played right now` : null,
    ].filter(Boolean).join(" and ");
    const what = `This clears every result in ${name} — ${parts}${people > 0 ? ` — and takes back the rating changes for ${plural(people, "player", "players")}.` : "."} Teams, groups, fixtures, courts and times stay. The group tables and the knockout go back to empty.${live > 0 ? ` Referees scoring a ${name} match right now will be told it was reset.` : ""}`;
    const token = restartSignature(t, rec);
    return (
      <form action={startCategoryAgain.bind(null, t.id)} className="border-t border-neutral-800 pt-3">
        <RestartCategory key={token} divisionId={divisionId} name={name} token={token} what={what} />
      </form>
    );
  };

  /* ── A pair that pulled out (step 8b) ──────────────────────────────────
     "Remove the pair…" on each team's card: the question says exactly what
     goes, or the card says why it cannot — the reason the server would give,
     read from the same plan (`pairPlan`). */
  const removeControl = (team: (typeof teamRows)[number]) => {
    const plan = planFor(team.id);
    const word = noun.one;
    const key = plan.groupKey;
    const reason = (text: string) => (
      <p data-row-locked className="text-[11px] font-semibold text-amber-300">{text}</p>
    );
    if (plan.knockout) {
      const k = matchById.get(plan.knockout.id)!;
      const ko = plan.mine.filter((r) => r.groupId === null).map((r) => matchById.get(r.id)!);
      const open = ko.find((r) => !recorded(r)) ?? null;
      if (open && open.teamAId && open.teamBId) {
        return reason(`Can’t remove — this ${word} is in ${open.round}. If they pull out, give the walkover there.`);
      }
      if (open) {
        return reason(`Can’t remove — this ${word} is in ${open.round}. If they pull out, give the walkover there once both sides are filled in — “Fill resolved slots” fills the other side when it is decided.`);
      }
      const live = ko.find((r) => hasPlay(r) && !hasResult(r));
      if (live) return reason(`Can’t remove — this ${word} is playing ${live.round}. If they pull out, reset it to 0–0, then give the walkover.`);
      return reason(`Can’t remove — this ${word} has played in the knockout (${k.round}), and removing them would delete it.`);
    }
    if (plan.blocks) {
      const r = matchById.get(plan.blocks.id)!;
      const isLive = hasPlay(r) && !hasResult(r);
      /* Name every match to undo, in the order their rows allow it: a match a
         later one waits on refuses to clear until that one is cleared. */
      const chain = [r];
      for (let cur = r; ;) {
        const next = (dependents.get(cur.id) ?? []).map((d) => matchById.get(d.id)).find((x) => x && recorded(x) && !chain.includes(x));
        if (!next) break;
        chain.push(next);
        cur = next;
      }
      const steps = [...chain].reverse().map((x) => `${hasPlay(x) && !hasResult(x) ? "reset" : "clear"} ${x.round}`).join(", then ");
      return reason(`Can’t remove — ${r.round} waits on Group ${key}’s table and ${isLive ? "has already started" : hasResult(r) ? "has a result" : "has a rating on record"}. ${steps[0].toUpperCase()}${steps.slice(1)} first.`);
    }
    if (plan.groupProblem) {
      const unplayed = plan.mine.some((r) => !recorded(matchById.get(r.id)!));
      const played = plan.mine.some((r) => recorded(matchById.get(r.id)!));
      if (plan.groupProblem.code === "pair-group-short") {
        const { asked, left } = plan.groupProblem;
        const instead = unplayed
          ? "Give walkovers against them in their remaining matches instead, so the group still fills its places."
          : `${played ? "Their results stand; i" : "I"}f they reach the knockout and pull out, give the walkover there.`;
        /* The last one left: a groups-then-knockout category takes at least
           the winner of every group, so a group is never emptied. */
        if (left === 0) {
          return reason(`Can’t remove — they are the only ${word} left in Group ${key}, and the knockout ${plan.fed.length ? "takes" : "will take"} its winner. If they pull out, give the walkover in the knockout once they are in it — “Fill resolved slots” puts them there.`);
        }
        return reason(`Can’t remove — the knockout takes ${plural(asked, noun.one, noun.many)} from Group ${key}, and only ${left} would be left. ${instead}`);
      }
      return reason(`Can’t remove — the ${noun.many} left in Group ${key} would have no match to play between them. ${unplayed ? `Give walkovers against this ${word} instead.` : ""}`.trim());
    }

    const mine = plan.mine.map((r) => matchById.get(r.id)!);
    const rec = mine.filter(recorded);
    const live = rec.filter((m) => hasPlay(m) && !hasResult(m)).length;
    const finished = rec.length - live;
    const people = new Set(mine.flatMap((m) => [...(ratedBy.get(m.id) ?? [])])).size;
    const entries = entriesOf.get(team.id) ?? [];
    const token = pairSignature(t, mine, (id) => locked.has(id), plan.emptied, entries);
    const cat = divisionRows.length > 1 ? divisionName.get(team.divisionId) : null;
    const detail = [
      finished > 0 ? `${finished} with ${finished === 1 ? "a result" : "results"}` : null,
      live > 0 ? `${live} being played right now` : null,
    ].filter(Boolean).join(" and ");
    const left = plan.members.filter((id) => id !== team.id);
    /* Who loses a match: only those who had one with them. A fixture deleted
       earlier means somebody may not. */
    const met = new Set(mine.filter((m) => m.groupId).map((m) => (m.teamAId === team.id ? m.teamBId : m.teamAId)));
    const fewer = left.filter((id) => met.has(id));
    const fewerLine = !key || left.length < 2 || fewer.length === 0 ? ""
      : fewer.length === left.length ? ` The other ${noun.many} in Group ${key} play one match fewer.`
      : ` One match fewer for ${joinNames(fewer.map((id) => byTeam.get(id)?.name ?? "—"))}.`;
    const first = mine.length === 0
      ? `This ${word} has no matches to remove.`
      : `This removes their ${plural(mine.length, "match", "matches")}${key ? ` in Group ${key}` : ""}${detail ? ` — ${detail}${people > 0 ? " —" : ""}` : ""}${people > 0 ? ` and takes back the rating changes those matches gave ${plural(people, "player", "players")}` : ""}.${fewerLine}${live > 0 ? " A referee scoring one of them now is told it was deleted." : ""}`;
    const after = [
      plan.emptied.length ? `${[...new Set(plan.emptied.map((d) => d.round))].join(" and ")} will lose the ${word} Group ${key}’s table put there — press “Fill resolved slots” afterwards to fill it again.` : "",
      key && left.length === 1 ? `That leaves one ${word} in Group ${key}, and the group goes to ${byTeam.get(left[0])?.name ?? "them"}.` : "",
      key && left.length === 0 ? `Group ${key} is left with no ${noun.many}.` : "",
    ].filter(Boolean).join(" ");
    const question = [
      after ? `${first} ${after}` : first,
      `The ${word} stays on the team list marked Withdrawn, and is left out of the tables, the draw and the order of play.${entries.length ? " Their online entry is marked withdrawn too." : ""}`,
      "This can’t be undone.",
    ].join("\n\n");
    return (
      <form action={removePair.bind(null, t.id, team.id)}>
        <ConfirmButton key={token} token={token} hook="withdraw" label={`Remove the ${word}…`}
          heading={`Remove ${team.name}${cat ? ` from ${cat}` : ""}?`}
          yes={`Yes, remove ${team.name}`} question={question} />
      </form>
    );
  };

  /** A refusal or a done message for one team, said on its card. */
  const teamNotice = (team: (typeof teamRows)[number]): { code: string; text: string; done: boolean } | null => {
    if (problemTeam !== team.id) return null;
    if (done === "withdrawn") {
      return {
        code: done, done: true,
        text: `Done — ${team.name} was removed: their matches are gone, the rating changes those matches made were taken back, and the team list marks them Withdrawn.${refill ? " Press “Fill resolved slots” to fill the knockout place their group’s table decides." : ""}`,
      };
    }
    if (done === "already") return { code: done, done: true, text: `${team.name} had already been removed.` };
    const text =
      /* What happened, never what to do instead: the card beside this says
         that, from the page as it is now, and only where it is on screen. */
      problem === "pair-in-knockout" ? `${team.name} was not removed: they are in a match outside the groups.`
      : problem === "pair-blocked" ? `${team.name} was not removed: a knockout match waiting on their group has started or has a result.`
      : problem === "pair-group-short" ? `${team.name} was not removed: their group would be left with fewer ${noun.many} than the knockout takes from it.`
      : problem === "pair-strands-group" ? `${team.name} was not removed: the ${noun.many} left in their group would have no match between them.`
      : problem === "pair-confirm" ? `${team.name} was not removed: it needs the second tap.`
      : problem === "pair-stale" ? `${team.name}’s matches changed since this page was opened, so nothing was removed. Look at it again.`
      : problem === "pair-changed" ? `A result came in for one of ${team.name}’s matches while they were being removed, so nothing was changed.`
      : null;
    return text && problem ? { code: problem, done: false, text } : null;
  };

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
          {problemText && <ProblemNotice code={problem ?? ""} text={problemText} />}

          {/* Where entries are configured and decided on. Split out rather than
              added to this page, which is already long. */}
          <nav className="mt-3 flex flex-wrap gap-2">
            <Link
              href={`/t/${slug}/manage/registration`}
              className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-2 text-xs font-black text-amber-300 hover:bg-amber-500/20"
            >
              📝 Registration
            </Link>
            <Link
              href={`/e/${slug}`}
              className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-300 hover:border-neutral-500"
            >
              Public entry page ↗
            </Link>
          </nav>
        </header>

        {/* ---------- teams and squads ---------- */}
        <section>
          <h2 className="mb-3 text-lg font-black">Teams</h2>
          <div className="space-y-3">
            {teamRows.map((team) => {
              const squad = squadOf(team.id);
              const gone = !!team.withdrawnAt;
              const notice = teamNotice(team);
              const issues = !gone && isOsl && squad.length >= 6
                ? oslLineupIssues(squad.slice(0, 6).map((p) => ({ id: p.id, name: p.name, gender: p.gender })))
                : [];
              return (
                /* `data-team` for the same reason the category cards carry
                   `data-category`: the e2e scripts have to address ONE team's
                   roster form, and every card is the same chain of utility
                   classes. */
                <div key={team.id} id={`team-${team.id}`} data-team={team.name} data-withdrawn={gone ? "" : undefined}
                  className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded" style={{ background: team.colour ?? "#666" }} />
                    <span className={`font-bold ${gone ? "text-neutral-500" : ""}`}>{team.name}</span>
                    {gone && (
                      <span className="rounded-full bg-neutral-800 px-2 py-0.5 text-[10px] font-black uppercase tracking-widest text-neutral-400">
                        Withdrawn
                      </span>
                    )}
                    {/* Which category, but only when there is more than one to
                        be in — otherwise it is the same word on every card. */}
                    {divisionRows.length > 1 && (
                      <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                        {divisionRows.find((d) => d.id === team.divisionId)?.name ?? "—"}
                      </span>
                    )}
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
                        <PersonLink personId={p.personId} name={p.name} className="flex-1 truncate" />
                        <span className={`rounded px-1.5 text-[10px] font-bold ${p.gender === "F" ? "bg-violet-500/20 text-violet-300" : "bg-blue-500/20 text-blue-300"}`}>
                          {p.gender}
                        </span>
                        {!gone && (
                          <form action={removePlayer.bind(null, t.id, p.id)}>
                            <button className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">remove</button>
                          </form>
                        )}
                      </li>
                    ))}
                  </ol>

                  {issues.length > 0 && (
                    <p className="mb-2 rounded-lg border border-rose-500/50 bg-rose-500/10 p-2 text-[11px] font-semibold text-rose-300">
                      {issues.join(" · ")}
                    </p>
                  )}

                  {/* Category rules this team no longer meets. Marked, never
                      acted on: the draw still works, and what to do about it is
                      the organiser's call (Faisal, 2026-09-17). */}
                  {(() => {
                    const m = gone ? undefined : misfitOf.get(team.id);
                    if (!m) return null;
                    const cat = divisionName.get(team.divisionId) ?? "this category";
                    return (
                      <div className="mb-2 space-y-1.5" data-misfit>
                        {m.reasons.length > 0 && (
                          <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-2 text-[11px] font-semibold text-rose-300">
                            Doesn’t meet {cat} rules: {m.reasons.join(" · ")}
                          </p>
                        )}
                        {m.waived.length > 0 && (
                          <p className="flex flex-wrap items-center gap-2 text-[11px] text-neutral-500">
                            <span className="rounded-full border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest">
                              Let in by organiser
                            </span>
                            {m.waived.join(" · ")}
                          </p>
                        )}
                        {m.notes.length > 0 && (
                          <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-2 text-[11px] text-neutral-500">
                            {m.notes.join(" · ")}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  {/* Phone is what makes a RISE Rating follow the player. It is
                      optional and unverified — an organiser typing it is only
                      saying "same person as last week", which needs no OTP. If
                      the number already exists, that person's rating comes with
                      them; if not, DUPR or a placement band seeds a new one. */}
                  {gone && (
                    <p className="text-[11px] text-neutral-500">
                      Removed{divisionRows.length > 1 ? ` from ${divisionName.get(team.divisionId) ?? "its category"}` : ""}.
                      Their matches were deleted and the rating changes from them taken back.
                    </p>
                  )}
                  {!gone && (() => {
                    const need = needsFrom(rulesOf.get(team.divisionId));
                    return (
                      <AddPlayerForm
                        add={addPlayer.bind(null, t.id, team.id)}
                        search={searchRoster.bind(null, t.sport)}
                        needs={{ dob: need.dob, dupr: need.dupr, duprRequired: need.duprRequired }}
                        showDupr={usesDupr(t.sport)}
                        hasGenderRule={need.gender}
                        seedBands={SEED_BANDS}
                      />
                    );
                  })()}
                  {!gone && <div className="mt-3 border-t border-neutral-800 pt-3">{removeControl(team)}</div>}
                  {notice && (
                    <div className="mt-2">
                      <ProblemNotice code={notice.code} text={notice.text} done={notice.done} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          <form action={addTeamHere} className="mt-3 flex flex-wrap gap-2">
            <input name="name" required placeholder="New team name"
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            {/* Only when there is a choice to make. With one category the team
                goes there and the question is noise. */}
            {divisionRows.length > 1 && (
              <select name="divisionId" defaultValue={divisionRows[0]?.id}
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm">
                {divisionRows.map((d) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            )}
            <button className="rounded-lg bg-neutral-200 px-4 text-xs font-black text-neutral-900">Add team</button>
          </form>
          {isOsl && (
            <p className="mt-2 text-[11px] text-neutral-500">
              OSL: the squad order is the declared pair order — A1+A2 play to 7, A3+A4 to 14, A5+A6 to 25.
              At least one woman must be in the six, and no two women may be paired (Rules 3.1, 3.2).
            </p>
          )}
        </section>

        {/* ---------- how games are scored ---------- */}
        <section>
          <h2 className="mb-1 text-lg font-black">Scoring</h2>
          <p className="mb-3 text-[11px] text-neutral-500">
            How a game is won. A change applies to every match not yet finished,
            including one being played now. Finished matches keep the result they
            finished with.
          </p>
          <ScoringControls
            tournamentId={t.id}
            initial={scoringState}
            isCustom={t.scoring != null}
            presetName={presetName}
            sportDefault={sportDefaultLabel}
            carrom={t.sport === "cr" && RESULT_ENTRY_ON_SCREEN}
          />
        </section>

        {/* ---------- draw, one block per category ---------- */}
        <section>
          <h2 className="mb-1 text-lg font-black">Draw</h2>
          <p className="mb-3 text-[11px] text-neutral-500">
            {divisionRows.length > 1
              ? "Each category is drawn separately and can be run a different way — groups and knockout for one, a straight league for another."
              : "One category. Add another below if this event runs Men’s Doubles and Mixed side by side."}
          </p>

          <div className="space-y-4">
            {divisionRows.map((d) => {
              const entered = teamsIn(d.id);
              const withdrew = teamRows.filter((x) => x.divisionId === d.id && x.withdrawnAt).length;
              /* data-category is a stable hook for e2e: the draw controls are
                 identical across categories and differ only by a hidden
                 division id, so a test needs some way to say "the Mixed one"
                 that is not a chain of Tailwind classes. */
              return (
                <div key={d.id} data-category={d.name}
                  className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-black">{d.name}</h3>
                    <span className="flex items-baseline gap-2 text-[11px] text-neutral-500">
                      {(() => {
                        const n = misfits.filter((m) => m.divisionId === d.id && m.reasons.length > 0).length;
                        return n > 0 ? (
                          <span className="rounded-full border border-rose-500/50 bg-rose-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-rose-300">
                            {n} {n === 1 ? "doesn’t" : "don’t"} fit
                          </span>
                        ) : null;
                      })()}
                      {entered} {entered === 1 ? "team" : "teams"}
                      {withdrew > 0 ? ` · ${withdrew} withdrawn` : ""}
                    </span>
                  </div>

                  {/* Who can enter. Closed, it is one line; open, the controls
                      with the rules said back in words underneath. */}
                  {(() => {
                    const r = rulesOf.get(d.id)!;
                    const chips = ruleChips(r);
                    const str = (n: number | null) => (n == null ? "" : String(n));
                    return (
                      <DivisionRulesForm
                        tournamentId={t.id}
                        divisionId={d.id}
                        summary={hasRules(r) ? chips.join(" · ") : "Anyone"}
                        initial={{
                          gender: r.gender ?? "",
                          ageMin: str(r.ageMin),
                          ageMax: str(r.ageMax),
                          ageOn: r.ageOn ?? eventDay ?? todayInIndia(),
                          ratingMin: str(r.ratingMin),
                          ratingMax: str(r.ratingMax),
                          duprMin: r.duprMin == null ? "" : duprLabel(r.duprMin),
                          duprMax: r.duprMax == null ? "" : duprLabel(r.duprMax),
                          duprStrict: r.duprStrict ? "on" : "",
                        }}
                        eventDay={eventDay}
                        eventDayLabel={eventDay ? dateLabel(eventDay) : null}
                        tiers={TIERS.map((x) => ({ name: x.name, min: x.min, max: x.max }))}
                        allowMixed={t.maxTeamSize >= 2}
                        allowDupr={usesDupr(t.sport)}
                        save={setDivisionRules}
                        describe={describeDivisionRules}
                      />
                    );
                  })()}

                  {/* How this category is run. Saving the shape does NOT redraw —
                      choosing a format is not the same as asking for the
                      existing fixtures to be thrown away. */}
                  <form action={setDivisionShape.bind(null, t.id)} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="divisionId" value={d.id} />
                    <select name="shape" defaultValue={d.shape}
                      className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm">
                      <option value="groups_ko">Groups, then knockout</option>
                      <option value="league">League — everyone plays everyone</option>
                      <option value="single_elim">Straight knockout</option>
                    </select>
                    <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                      <input type="checkbox" name="thirdPlace" defaultChecked={d.thirdPlace} />
                      Third-place playoff
                    </label>
                    <button className="rounded-lg border border-neutral-600 px-3 py-1.5 text-xs font-bold">
                      Save format
                    </button>
                  </form>

                  {d.shape === "single_elim" ? (
                    <>
                      <form action={generateSingleElim.bind(null, t.id)} className="border-t border-neutral-800 pt-3">
                        <input type="hidden" name="divisionId" value={d.id} />
                        {(() => {
                          const st = drawState(d.id);
                          return drawControl(st.wholeSig, "Draw the bracket", st.wholePlayed, st.wholeCount,
                            `this category's ${fixtures(st.wholeCount)} — its bracket, and any groups and fixtures from before`);
                        })()}
                      </form>
                      <p className="text-[11px] text-neutral-500">
                        Teams are seeded so the strongest meets the weakest first and the top two can only
                        meet in the final. An odd entry count gives byes — a bye is not a fixture, so no
                        match appears for it and that team simply starts a round later.
                      </p>
                    </>
                  ) : (
                    <>
                      <form action={generateGroups.bind(null, t.id)} className="grid gap-2 border-t border-neutral-800 pt-3 sm:grid-cols-[auto_1fr_auto]">
                        <input type="hidden" name="divisionId" value={d.id} />
                        {d.shape === "league" ? (
                          <span className="self-center text-[11px] font-bold uppercase tracking-widest text-neutral-400">
                            One table
                          </span>
                        ) : (
                          <label className="flex items-center gap-2 text-sm">
                            <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Groups</span>
                            {/* The ceiling is what the field can actually fill —
                                a group of one has nobody to play. The server
                                clamps to the same number (planGroups), so this
                                is the constraint made visible rather than the
                                place it is enforced. */}
                            <input name="groups" type="number" min={1}
                              max={Math.min(8, maxGroupsFor(teamsIn(d.id)))}
                              defaultValue={Math.min(2, maxGroupsFor(teamsIn(d.id)))}
                              className="w-16 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" />
                            <span className="text-[11px] text-neutral-500">
                              max {Math.min(8, maxGroupsFor(teamsIn(d.id)))} for {teamsIn(d.id)} teams
                            </span>
                          </label>
                        )}
                        <input name="courts" placeholder="Court names, comma separated (optional)"
                          className="min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm" />
                        {(() => {
                          const st = drawState(d.id);
                          return drawControl(st.wholeSig, d.shape === "league" ? "Draw league fixtures" : "Draw groups & fixtures",
                            st.wholePlayed, st.wholeCount,
                            `this category's ${fixtures(st.wholeCount)} — its groups, their fixtures${st.bracketCount ? " and the knockout drawn from them" : ""}`);
                        })()}
                      </form>
                      <p className="text-[11px] text-neutral-500">
                        {d.shape === "league"
                          ? "Everyone plays everyone once, in one table, with the rounds spread so a team rarely plays twice in a row. No knockout."
                          : "Teams are snaked across the groups so the strong ones do not all land in group A, and each group plays a full round robin. A redraw replaces this category’s groups, their fixtures and any knockout drawn from them — only while none of it has been played."}
                      </p>

                      {d.shape === "groups_ko" && (
                        <>
                          <form action={generateKnockout.bind(null, t.id)} className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
                            <input type="hidden" name="divisionId" value={d.id} />
                            <label className="flex items-center gap-2 text-sm">
                              <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Qualify per group</span>
                              <input name="qualify" type="number" min={1} max={qualifyMax(d.id)} defaultValue={Math.min(2, qualifyMax(d.id))}
                                className="w-16 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" />
                            </label>
                            {(() => {
                              /* A group with nobody left can send nobody through,
                                 whatever is asked — say so rather than offer a
                                 draw the server refuses every time. */
                              const empty = tables.find((tb) => tb.group.divisionId === d.id && tb.members.length === 0);
                              if (empty) {
                                return (
                                  <p data-draw-locked className="self-center text-[11px] font-semibold text-amber-300">
                                    Can’t draw the knockout — {empty.group.name ?? `Group ${empty.group.key}`} has no {noun.many} left.
                                  </p>
                                );
                              }
                              const st = drawState(d.id);
                              return drawControl(st.bracketSig, "Draw knockout", st.bracketPlayed, st.bracketCount,
                                `the ${fixtures(st.bracketCount)} of the knockout drawn before`);
                            })()}
                          </form>
                          <p className="text-[11px] text-neutral-500">
                            Knockout places are stored as references — A1, B2, W:Semi-Final 1 — and resolve
                            themselves as each group finishes, so a bracket can never be seeded from a
                            half-played table.
                          </p>
                        </>
                      )}
                    </>
                  )}

                  {(() => {
                    const n = categoryNotice(d.id, d.name);
                    return n ? <ProblemNotice code={n.code} text={n.text} done={n.done} /> : null;
                  })()}
                  {restartControl(d.id, d.name)}
                </div>
              );
            })}
          </div>

          <div className="mt-3 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <form action={addDivision.bind(null, t.id)} className="flex flex-wrap items-center gap-2">
              <input name="name" placeholder="Add a category — Men’s Doubles, Mixed, U-17…"
                className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm" />
              {/* A starting point fills the rules in; a blank name takes its
                  label. Mixed is not offered for a singles event. */}
              <label className="flex items-center gap-1.5 text-[11px] text-neutral-400">
                <span className="font-bold uppercase tracking-widest">Starting point</span>
                <select name="preset" defaultValue="open"
                  className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm text-neutral-200">
                  {PRESETS.filter((p) => p.id !== "mixed" || t.maxTeamSize >= 2).map((p) => (
                    <option key={p.id} value={p.id}>{p.label}{p.hint ? ` (${p.hint})` : ""}</option>
                  ))}
                </select>
              </label>
              <button className="rounded-lg border border-neutral-600 px-3 py-1.5 text-xs font-bold">
                Add category
              </button>
            </form>

            {/* The point of the whole rating: the snake above draws from the
                seed order, so putting SKILL into that column is the entire
                change. Deliberately a button rather than automatic — an
                organiser knows things the number does not, and their own order
                must not be silently overwritten. */}
            <form action={seedByRating.bind(null, t.id)} className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
              <button className="rounded-lg border border-amber-500/60 bg-amber-500/10 px-3 py-1.5 text-xs font-black text-amber-300 hover:bg-amber-500/20">
                📈 Seed by RISE Rating
              </button>
              <span className="text-[11px] text-neutral-500">
                Orders the teams by their players&apos; average rating before you draw. Teams with nobody
                linked to a RISE profile go last — no rating is not the same as a low one.
              </span>
            </form>

            {/* A separate form: HTML forbids nesting one form inside another,
                and React hydration fails outright if you try. */}
            <form action={fillKnockoutSlots.bind(null, t.id)} className="border-t border-neutral-800 pt-3">
              <button className="rounded-lg border border-neutral-600 px-3 py-2 text-xs font-bold">
                Fill resolved slots
              </button>
            </form>
          </div>
        </section>

        {tables.length > 0 && (
          <section className="space-y-3">
            <h2 className="text-lg font-black">Standings</h2>
            {tables.map((table) => (
              <StandingsTable key={table.group.id} table={table} allowDraws={allowsDraws(t.sport)} noun={noun} />
            ))}
          </section>
        )}

        {/* ---------- order of play ---------- */}
        <section>
          <h2 className="mb-1 text-lg font-black">Order of play</h2>
          <p className="mb-3 text-[12px] text-neutral-500">
            Times and courts for every match still to be played. Nobody is given two matches at
            once — across categories, so a player entered in two of them is counted as one person.
            A knockout is never placed before the group that feeds it.
          </p>

          <form action={generateSchedule.bind(null, t.id)}
            className="grid gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 sm:grid-cols-[1fr_auto_auto_auto]">
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-neutral-500">First match</span>
              <input type="datetime-local" name="startsAt" required
                defaultValue={t.startsAt ? floatingInputValue(t.startsAt) : ""}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-neutral-500">Courts</span>
              <input type="number" name="courts" min={1} max={20} defaultValue={t.courts}
                className="w-20 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] font-bold uppercase tracking-widest text-neutral-500">Minutes each</span>
              <input type="number" name="matchMinutes" min={5} max={180} step={5} defaultValue={t.matchMinutes}
                className="w-24 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            </label>
            <button className="self-end rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900">
              Draw up the times
            </button>
          </form>

          {timed.length > 0 && (
            <div className="mt-3 overflow-x-auto rounded-xl border border-neutral-800">
              {/* Addressed by the e2e suite: the standings tables above are
                  also `table tbody tr`, and scraping both silently mixed a
                  four-row group table into the order of play. */}
              <table data-testid="order-of-play" className="w-full min-w-[34rem] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-neutral-800 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    <th className="p-2">Time</th>
                    <th className="p-2">Court</th>
                    <th className="p-2">Category</th>
                    <th className="p-2">Match</th>
                  </tr>
                </thead>
                <tbody>
                  {timed.map((r, i) => (
                    <tr key={i} className="border-b border-neutral-800 last:border-0">
                      <td className="whitespace-nowrap p-2 font-mono font-bold tabular-nums">{r.time}</td>
                      <td className="p-2 font-mono tabular-nums text-neutral-500">{r.court ?? "—"}</td>
                      <td className="truncate p-2 text-[11px] text-neutral-500">{r.category}</td>
                      <td className="p-2">
                        <span className="text-[11px] text-neutral-500">{r.round}</span>{" "}
                        {r.aLabel} v {r.bLabel}
                        {r.score && <span className="ml-2 font-mono font-bold">{r.score}</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {timed.length > 0 && (
            <>
              <div className="mt-2 flex flex-wrap items-center gap-3">
                <p className="text-[11px] text-neutral-500">
                  {firstTimed ? `${floatingDay(firstTimed.scheduledAt!)} · ` : ""}
                  {timed.length} match{timed.length === 1 ? "" : "es"} · last starts{" "}
                  {timed[timed.length - 1].time}
                </p>
                <form action={dropSchedule.bind(null, t.id)} className="ml-auto">
                  <button className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">
                    clear the times
                  </button>
                </form>
              </div>

              {/* Getting it to the players. Both are plain links to something
                  the server produces — no popup and no blob: download, either
                  of which a phone browser is entitled to block silently. */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <a href={shareHref} target="_blank" rel="noopener noreferrer"
                  className="rounded-lg bg-emerald-400 px-3 py-2 text-xs font-black text-emerald-950 hover:brightness-110">
                  Send on WhatsApp
                </a>
                <a href={`/t/${slug}/schedule`}
                  className="rounded-lg border border-neutral-600 px-3 py-2 text-xs font-bold text-neutral-300 hover:border-neutral-400">
                  Download CSV
                </a>
                <Link href={`/t/${slug}/print`}
                  className="rounded-lg border border-neutral-600 px-3 py-2 text-xs font-bold text-neutral-300 hover:border-neutral-400">
                  Print pack
                </Link>
                <span className="text-[11px] text-neutral-500">
                  The message carries the order of play and a link to this event&apos;s page.
                </span>
              </div>
            </>
          )}
        </section>

        {/* ---------- matches ---------- */}
        <section>
          <h2 className="mb-3 text-lg font-black">Matches</h2>
          <ul className="space-y-2">
            {matchRows.map((m) => {
              const v = viewMatch(t, m);
              /* The shared rule, so a TYPED result reads as one here too — this list
                 used to print the rally log only, and showed a typed 11–7 as 0–0. */
              const line = matchLine(t, m, v);
              const a = m.teamAId ? byTeam.get(m.teamAId) : null;
              const b = m.teamBId ? byTeam.get(m.teamBId) : null;
              const notice = rowNotice(m);
              /* data-match and data-round are stable hooks for e2e: a row's
                 words now name OTHER matches ("the Final waits on…"), so a
                 test finding a row by its text could pick the wrong one. */
              return (
                <li key={m.id} id={`match-${m.id}`} data-match={m.id} data-round={m.round}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                      {m.scheduledAt ? `${floatingTime(m.scheduledAt)}${m.court ? ` · court ${m.court}` : ""} · ` : ""}
                      {m.round}
                      {v.osl && !line.finished ? ` · ${v.osl.pairLabel}` : ""}
                      {line.tag}
                    </p>
                    <p className="truncate text-sm">
                      {slotLabel(m, "a", a?.name)} <span className="font-mono font-bold">{line.score}</span> {slotLabel(m, "b", b?.name)}
                    </p>
                    {m.lineupA.length > 0 && (
                      <p className="truncate text-[11px] text-neutral-500">
                        {m.lineupA.map((id) => playerNameOf.get(id)).join(", ")}
                      </p>
                    )}
                  </div>
                  <Link href={`/t/${slug}/score/${m.id}`}
                    className="rounded-lg bg-amber-400 px-3 py-1.5 text-xs font-black text-amber-950">
                    Score
                  </Link>
                  {rowControl(m)}
                  {notice && (
                    <div className="basis-full">
                      <ProblemNotice code={notice.code} text={notice.text} done={notice.done} />
                    </div>
                  )}
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
              {activeTeams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
            </select>
            <select name="teamB" required className="rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm">
              <option value="">Team B…</option>
              {activeTeams.map((x) => <option key={x.id} value={x.id}>{x.name}</option>)}
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
