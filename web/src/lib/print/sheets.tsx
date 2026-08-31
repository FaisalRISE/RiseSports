import "server-only";

/* The print pack — one page per group, made to be printed BLANK and filled in
 * by hand at the court, or printed with scores as the record of an event.
 *
 * Ported from the OSL sheets in the single-file app (`app.source.js:12005`).
 * Four rules came out of getting it wrong there, and each is load-bearing:
 *
 *   1. ONE PAGE PER GROUP, fixtures and margin grid together. An organiser
 *      running Group C needs one sheet, not a page of fixtures somewhere and a
 *      page of grids somewhere else.
 *
 *   2. MATCHES ARE ROWS IN ONE TABLE, not a table each, and the caption appears
 *      ONCE beneath the table. A table per match with the caption repeated under
 *      every one is what made the first attempt unusable.
 *
 *   3. NO STANDINGS TABLE. The margin grid already carries wins, difference and
 *      rank, and it is the grid that gets filled in by hand — printing both
 *      invites two sets of numbers that disagree with each other.
 *
 *   4. THE DIAGONAL IS FOUND BY POSITION, not by the cell being null. An
 *      unplayed match is null too, so testing for null shades the wrong cell.
 *
 * All of this renders on the server. The margin arithmetic never reaches the
 * browser, so the bundle-leak guard stays honest. */

import type { Group, Match, Team, Tournament } from "@/lib/db/schema";
import { viewMatch, rulesFor } from "@/lib/matchState";
import { sportOf } from "@/lib/sports/registry";

export type PrintMatch = {
  /** `matches.court` is an integer, `groups.court` is text — both print. */
  court: number | string | null;
  aLabel: string;
  bLabel: string;
  aId: string | null;
  bId: string | null;
  scoreA: number | null;
  scoreB: number | null;
  played: boolean;
};

/** A match reduced to what the sheets need. `withData` false prints it blank. */
export function toPrintMatch(
  t: Tournament,
  m: Match,
  labels: [string, string],
  withData: boolean,
): PrintMatch {
  const v = viewMatch(t, m);
  const [a, b] = v.typed ? [m.typedScoreA ?? 0, m.typedScoreB ?? 0] : [v.a, v.b];
  const played = withData && (v.typed || v.over);
  return {
    court: m.court,
    aLabel: labels[0],
    bLabel: labels[1],
    aId: m.teamAId,
    bId: m.teamBId,
    scoreA: played ? a : null,
    scoreB: played ? b : null,
    played,
  };
}

export function PrintHead({
  tournament,
  title,
  sub,
  printedAt,
}: {
  tournament: Tournament;
  title?: string;
  sub?: string;
  printedAt: string;
}) {
  const sp = sportOf(tournament.sport);
  return (
    <div className="brandbar">
      <div className="btitle">
        <div className="sport">
          {sp.name}
          {title ? ` — ${title}` : ""}
        </div>
        <div className="meta">{(sub ?? tournament.name).toUpperCase()}</div>
      </div>
      <div className="printed">Printed {printedAt}</div>
    </div>
  );
}

export const FIXTURE_CAPTION =
  "Left score box belongs to the team on the left, right box to the team on the right. " +
  "The higher score wins — no separate winner column.";

/* Court, then the two teams either side of their score boxes, winner in bold.
   Blank boxes when printing before play — that is the whole point.
   `caption` is optional because a sheet with several tables (the knockout has
   one per round) must still show the explanation ONCE, not under each. */
export function FixtureTable({
  matches,
  caption = true,
}: {
  matches: PrintMatch[];
  caption?: boolean;
}) {
  if (!matches.length) return null;
  return (
    <>
      <table className="fx">
        <thead>
          <tr>
            <th className="c" style={{ width: 42 }}>Court</th>
            <th>Team</th>
            <th className="c" style={{ width: 50 }}>Score</th>
            <th className="c" style={{ width: 50 }}>Score</th>
            <th>Team</th>
          </tr>
        </thead>
        <tbody>
          {matches.map((m, i) => {
            const aWon = m.played && m.scoreA! > m.scoreB!;
            const bWon = m.played && m.scoreB! > m.scoreA!;
            return (
              <tr key={i}>
                <td className="c ct">{m.court ?? ""}</td>
                <td className={aWon ? "win" : ""}>{m.aLabel || "TBD"}</td>
                <td className="c sbox">{m.played ? m.scoreA : ""}</td>
                <td className="c sbox">{m.played ? m.scoreB : ""}</td>
                <td className={bWon ? "win" : ""}>{m.bLabel || "TBD"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {/* ONCE, under the table — not under every match. */}
      {caption && <div className="cap">{FIXTURE_CAPTION}</div>}
    </>
  );
}

type GridRow = { team: Team; cells: (number | null)[]; wins: number; diff: number };

/** The score-margin grid. The row total IS the point difference that separates
 *  teams level on wins, and printed blank it is somewhere to work the table out
 *  by hand — which is why paper still beats a phone on a windy court. */
export function MarginGrid({
  label,
  teams,
  matches,
  withData,
}: {
  label: string;
  teams: Team[];
  matches: PrintMatch[];
  withData: boolean;
}) {
  if (teams.length < 2) return null;
  const played = matches.filter((m) => m.played);

  const marginOf = (row: Team, col: Team): number | null => {
    const m = played.find(
      (x) =>
        (x.aId === row.id && x.bId === col.id) || (x.aId === col.id && x.bId === row.id),
    );
    if (!m || !withData) return null;
    return m.aId === row.id ? m.scoreA! - m.scoreB! : m.scoreB! - m.scoreA!;
  };

  const rows: GridRow[] = teams.map((t) => {
    const cells = teams.map((o) => (o.id === t.id ? null : marginOf(t, o)));
    return {
      team: t,
      cells,
      wins: cells.filter((v) => v != null && v > 0).length,
      diff: cells.reduce<number>((s, v) => s + (v ?? 0), 0),
    };
  });

  const ranked = [...rows].sort((a, b) => b.wins - a.wins || b.diff - a.diff);
  const needsH2H = (r: GridRow) =>
    ranked.some((o) => o !== r && o.wins === r.wins && o.diff === r.diff);

  return (
    <>
      <div className="sub">Score margin</div>
      <table className="mg">
        <thead>
          <tr>
            <th style={{ width: "20%" }}>Group {label}</th>
            {teams.map((t) => (
              <th key={t.id} className="c">{t.name}</th>
            ))}
            <th className="c" style={{ width: 40 }}>Wins</th>
            <th className="c" style={{ width: 40 }}>Diff</th>
            <th className="c" style={{ width: 38 }}>Rank</th>
            <th className="c" style={{ width: 34 }}>H2H</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.team.id}>
              <td className="nm">{r.team.name}</td>
              {/* BY POSITION. An unplayed match is null too, so testing the
                  value would shade the wrong cell. */}
              {r.cells.map((v, ci) =>
                teams[ci].id === r.team.id ? (
                  <td key={ci} className="self" />
                ) : (
                  <td key={ci} className="c">{v == null ? "" : (v > 0 ? "+" : "") + v}</td>
                ),
              )}
              <td className="c b">{withData ? r.wins : ""}</td>
              <td className="c b">{withData ? (r.diff > 0 ? "+" : "") + r.diff : ""}</td>
              <td className="c b">{withData ? ranked.indexOf(r) + 1 : ""}</td>
              <td className="c">{withData && needsH2H(r) ? "●" : ""}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="cap">
        Row team&apos;s margin against the column team. A 25–20 win is <b>+5</b> for the
        winner and <b>−5</b> for the loser. Count the pluses for wins; the row total is the
        points difference, which separates teams level on wins — head-to-head only comes
        into it if the difference is level too.
      </div>
    </>
  );
}

/** The rules, stated in words, so a paper sheet is enough to settle an argument. */
export function RulesLine({ tournament }: { tournament: Tournament }) {
  const r = rulesFor(tournament);
  if (!r) return null;
  return (
    <div className="rules">
      One game to {r.target}.
      {r.sideOut ? " Service points — only the serving side scores." : " Rally scoring — every rally is a point."}
      {r.winBy > 1 ? ` Won by ${r.winBy} clear points.` : ""}
      {r.cap ? ` Golden point at ${r.golden}–${r.golden}, so no score passes ${r.cap}.` : ""}
      {r.switchAt ? ` Ends change at ${r.switchAt}.` : ""}
    </div>
  );
}

/** One group, one page: fixtures, then the margin grid, then the rules. */
export function GroupSheet({
  tournament,
  group,
  teams,
  matches,
  withData,
  printedAt,
}: {
  tournament: Tournament;
  group: Group;
  teams: Team[];
  matches: PrintMatch[];
  withData: boolean;
  printedAt: string;
}) {
  /* Courts are free text and organisers name them either way — "1" or
     "Court One". Prefixing unconditionally printed "COURT COURT ONE". */
  const court = group.court
    ? /^court\b/i.test(group.court.trim())
      ? group.court.trim()
      : `Court ${group.court.trim()}`
    : null;
  const sub = [tournament.name, court].filter(Boolean).join(" · ");
  return (
    <section className="psheet">
      <PrintHead
        tournament={tournament}
        title={`Group ${group.key}`}
        sub={sub}
        printedAt={printedAt}
      />
      <div className="sub">Fixtures</div>
      <FixtureTable matches={matches} />
      <MarginGrid label={group.key} teams={teams} matches={matches} withData={withData} />
      <RulesLine tournament={tournament} />
    </section>
  );
}

/** The knockout, grouped by round. Rounds are named from the end, so the last
 *  round is the Final whatever it happens to be called in the data. */
export function KnockoutSheet({
  tournament,
  rounds,
  printedAt,
}: {
  tournament: Tournament;
  rounds: { label: string; matches: PrintMatch[] }[];
  printedAt: string;
}) {
  if (!rounds.length) return null;
  return (
    <section className="psheet">
      <PrintHead tournament={tournament} title="Knockout" printedAt={printedAt} />
      {rounds.map((r) => (
        <div key={r.label}>
          <div className="sub">{r.label}</div>
          {/* Caption suppressed per round — see below. */}
          <FixtureTable matches={r.matches} caption={false} />
        </div>
      ))}
      {/* ONCE for the whole sheet. Repeating it under each round is the same
          mistake as repeating it under each match, just at a coarser grain. */}
      <div className="cap">{FIXTURE_CAPTION}</div>
      <RulesLine tournament={tournament} />
    </section>
  );
}
