import Link from "next/link";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import { matches, players, teams, tournaments } from "@/lib/db/schema";
import { viewMatch } from "@/lib/matchState";
import { sportOf } from "@/lib/sports/registry";
import { oslLineupIssues } from "@/lib/formats/osl";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { addTeam, addPlayer, removePlayer, addMatch, removeMatch, generateGroups, generateKnockout, generateSingleElim, fillKnockoutSlots, seedByRating, searchRoster, addDivision, setDivisionShape, generateSchedule, dropSchedule } from "./actions";
import { floatingTime, floatingDay, floatingInputValue } from "@/lib/schedule";
import { divisionsOf } from "@/lib/divisions";
import { SEED_BANDS } from "@/lib/rating";
import { PersonPicker } from "@/components/PersonPicker";
import { loadTournament, groupTables, resolverFactory, resolveSlots } from "@/lib/tournamentState";
import { StandingsTable } from "@/components/StandingsTable";
import { ScoringControls, type ScoringState } from "./ScoringControls";
import { resolveRules } from "@/lib/scoring/rules";
import { allowsDraws } from "@/lib/matchState";

export const dynamic = "force-dynamic";

export default async function ManagePage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  if (!t) notFound();

  const [teamRows, playerRows, matchRows, divisionRows] = await Promise.all([
    db.select().from(teams).where(eq(teams.tournamentId, t.id)),
    db.select().from(players).where(eq(players.tournamentId, t.id)),
    db.select().from(matches).where(eq(matches.tournamentId, t.id)),
    divisionsOf(t.id),
  ]);
  const byTeam = new Map(teamRows.map((x) => [x.id, x]));
  const playerNameOf = new Map(playerRows.map((p) => [p.id, p.name]));
  const isOsl = t.format === "osl";

  const squadOf = (teamId: string) => playerRows.filter((p) => p.teamId === teamId);

  /* The order of play, as it stands. Sorted by the time itself rather than by
     the slot, so a match given a time by hand sits where it belongs. */
  const divisionName = new Map(divisionRows.map((d) => [d.id, d.name]));
  const timed = matchRows
    .filter((m) => m.scheduledAt)
    .sort((a, b) =>
      a.scheduledAt!.getTime() - b.scheduledAt!.getTime() || (a.court ?? 0) - (b.court ?? 0));

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
  };

  const loaded = await loadTournament(slug);
  const tables = loaded ? groupTables(loaded) : [];
  /* Per category: "A1" means the A of the match's OWN category. */
  const resolverFor = loaded ? resolverFactory(loaded, tables) : null;
  const teamNameOf = (id: string) => teamRows.find((x) => x.id === id)?.name ?? "—";

  /* An unfilled knockout side shows its seed reference in words rather than
     "TBD", so an organiser can see where the team will come from. */
  const slotLabel = (m: (typeof matchRows)[number], side: "a" | "b", teamName?: string) => {
    if (teamName) return teamName;
    if (!resolverFor) return "TBD";
    const [ra, rb] = resolveSlots(m, resolverFor(m.divisionId), teamNameOf);
    return (side === "a" ? ra : rb).label;
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
              const issues = isOsl && squad.length >= 6
                ? oslLineupIssues(squad.slice(0, 6).map((p) => ({ id: p.id, name: p.name, gender: p.gender })))
                : [];
              return (
                /* `data-team` for the same reason the category cards carry
                   `data-category`: the e2e scripts have to address ONE team's
                   roster form, and every card is the same chain of utility
                   classes. */
                <div key={team.id} data-team={team.name}
                  className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                  <div className="mb-2 flex items-center gap-2">
                    <span className="h-3 w-3 rounded" style={{ background: team.colour ?? "#666" }} />
                    <span className="font-bold">{team.name}</span>
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

                  {/* Phone is what makes a RISE Rating follow the player. It is
                      optional and unverified — an organiser typing it is only
                      saying "same person as last week", which needs no OTP. If
                      the number already exists, that person's rating comes with
                      them; if not, DUPR or a placement band seeds a new one. */}
                  <form action={addPlayer.bind(null, t.id, team.id)} className="space-y-2">
                    <div className="flex gap-2">
                      <input name="name" required placeholder="Player name"
                        className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm" />
                      <select name="gender" defaultValue="M"
                        className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm">
                        <option value="M">M</option>
                        <option value="F">F</option>
                      </select>
                      <button className="rounded-lg border border-neutral-600 px-3 text-xs font-bold">Add</button>
                    </div>
                    {/* Reuse an existing player when their number is not to
                        hand. Phone stays the only automatic match; this is the
                        deliberate, organiser-confirmed one. */}
                    <PersonPicker search={searchRoster} />
                    <div className="flex flex-wrap gap-2">
                      <input name="phone" inputMode="tel" placeholder="Phone (optional)"
                        className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs" />
                      <input name="dupr" inputMode="decimal" placeholder="DUPR"
                        className="w-20 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs" />
                      <select name="band" defaultValue=""
                        className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs">
                        <option value="">Starting level…</option>
                        {SEED_BANDS.map((b) => (
                          <option key={b.seed} value={b.seed}>{b.label}</option>
                        ))}
                      </select>
                    </div>
                    <p className="text-[10px] leading-snug text-neutral-600">
                      No phone: their rating works here but will not follow them to another event.
                    </p>
                  </form>
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
            How a game is won. It applies to every match in the event, and the
            referee console reads it.
          </p>
          <ScoringControls
            tournamentId={t.id}
            initial={scoringState}
            isCustom={t.scoring != null}
            presetName={presetName}
            sportDefault={sportDefaultLabel}
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
              const entered = teamRows.filter((x) => x.divisionId === d.id).length;
              /* data-category is a stable hook for e2e: the draw controls are
                 identical across categories and differ only by a hidden
                 division id, so a test needs some way to say "the Mixed one"
                 that is not a chain of Tailwind classes. */
              return (
                <div key={d.id} data-category={d.name}
                  className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <h3 className="text-sm font-black">{d.name}</h3>
                    <span className="text-[11px] text-neutral-500">
                      {entered} {entered === 1 ? "team" : "teams"}
                    </span>
                  </div>

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
                        <button className="rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900">
                          Draw the bracket
                        </button>
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
                            <input name="groups" type="number" min={1} max={8} defaultValue={2}
                              className="w-16 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" />
                          </label>
                        )}
                        <input name="courts" placeholder="Court names, comma separated (optional)"
                          className="min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm" />
                        <button className="rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900">
                          {d.shape === "league" ? "Draw league fixtures" : "Draw groups & fixtures"}
                        </button>
                      </form>
                      <p className="text-[11px] text-neutral-500">
                        {d.shape === "league"
                          ? "Everyone plays everyone once, in one table, with the rounds spread so a team rarely plays twice in a row. No knockout."
                          : "Teams are snaked across the groups so the strong ones do not all land in group A, and each group plays a full round robin. Redrawing replaces this category’s groups and their matches."}
                      </p>

                      {d.shape === "groups_ko" && (
                        <>
                          <form action={generateKnockout.bind(null, t.id)} className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
                            <input type="hidden" name="divisionId" value={d.id} />
                            <label className="flex items-center gap-2 text-sm">
                              <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Qualify per group</span>
                              <input name="qualify" type="number" min={1} max={4} defaultValue={2}
                                className="w-16 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm" />
                            </label>
                            <button className="rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900">
                              Draw knockout
                            </button>
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
                </div>
              );
            })}
          </div>

          <div className="mt-3 space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <form action={addDivision.bind(null, t.id)} className="flex flex-wrap items-center gap-2">
              <input name="name" placeholder="Add a category — Men’s Doubles, Mixed, U-17…"
                className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm" />
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
              <StandingsTable key={table.group.id} table={table} allowDraws={allowsDraws(t.sport)} />
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
                  {timed.map((m) => (
                    <tr key={m.id} className="border-b border-neutral-800 last:border-0">
                      <td className="whitespace-nowrap p-2 font-mono font-bold tabular-nums">
                        {floatingTime(m.scheduledAt!)}
                      </td>
                      <td className="p-2 font-mono tabular-nums text-neutral-500">{m.court ?? "—"}</td>
                      <td className="truncate p-2 text-[11px] text-neutral-500">
                        {divisionName.get(m.divisionId) ?? ""}
                      </td>
                      <td className="p-2">
                        <span className="text-[11px] text-neutral-500">{m.round}</span>{" "}
                        {slotLabel(m, "a", m.teamAId ? byTeam.get(m.teamAId)?.name : undefined)}
                        {" v "}
                        {slotLabel(m, "b", m.teamBId ? byTeam.get(m.teamBId)?.name : undefined)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {timed.length > 0 && (
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <p className="text-[11px] text-neutral-500">
                {floatingDay(timed[0].scheduledAt!)} · {timed.length} to play · last starts{" "}
                {floatingTime(timed[timed.length - 1].scheduledAt!)}
              </p>
              <form action={dropSchedule.bind(null, t.id)} className="ml-auto">
                <button className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">
                  clear the times
                </button>
              </form>
            </div>
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
                      {m.scheduledAt ? `${floatingTime(m.scheduledAt)}${m.court ? ` · court ${m.court}` : ""} · ` : ""}
                      {m.round}
                      {v.osl && !v.over ? ` · ${v.osl.pairLabel}` : ""}
                      {v.over ? " · final" : v.rallies > 0 ? " · live" : ""}
                    </p>
                    <p className="truncate text-sm">
                      {slotLabel(m, "a", a?.name)} <span className="font-mono font-bold">{v.a}–{v.b}</span> {slotLabel(m, "b", b?.name)}
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
