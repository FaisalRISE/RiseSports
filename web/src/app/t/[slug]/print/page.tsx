import { notFound } from "next/navigation";
import Link from "next/link";
import { loadTournament, resolverFactory, groupTables, resolveSlots } from "@/lib/tournamentState";
import { principalFor } from "@/lib/auth/guard";
import { canView } from "@/lib/auth/policy";
import { PrintButton } from "@/components/PrintButton";
import { GroupSheet, KnockoutSheet, OrderOfPlaySheet, toPrintMatch, type OrderRow, type PrintMatch } from "@/lib/print/sheets";
import { scheduleRows, scheduleDay } from "@/lib/schedule/share";
import { divisionsOf } from "@/lib/divisions";
import { bracketRounds } from "@/lib/brackets";
import type { Team } from "@/lib/db/schema";

/* The printable pack.
 *
 * A real route rather than the hidden-div-plus-window.print() the single-file
 * app used, because here the margin arithmetic and the tie-break chain run on
 * the server and never reach the browser. The only client code is the button.
 *
 * `?blank=1` prints it with empty score boxes, which is how it is normally
 * used: printed before play and filled in by hand at the court. */
export const dynamic = "force-dynamic";

export default async function PrintPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ blank?: string }>;
}) {
  const { slug } = await params;
  const { blank } = await searchParams;
  const withData = blank !== "1";

  const loaded = await loadTournament(slug);
  if (!loaded) notFound();
  const t = loaded.tournament;
  if (!canView(await principalFor(t.id), t.status)) notFound();

  const divisionRows = await divisionsOf(t.id);
  const divisionName = new Map(divisionRows.map((d) => [d.id, d.name]));

  const tables = groupTables(loaded);
  /* Per category: "A1" means the A of the match's OWN category. */
  const resolverFor = resolverFactory(loaded, tables);
  const byId = new Map(loaded.teams.map((x) => [x.id, x]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "—";

  const printedAt = new Date().toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  }).replace(",", " ·");

  const asPrint = (m: (typeof loaded.matches)[number]): PrintMatch => {
    const [a, b] = resolveSlots(m, resolverFor(m.divisionId), nameOf);
    return toPrintMatch(t, m, [a.label, b.label], withData);
  };

  /* One sheet per group, carrying that group's own teams so the margin grid
     axes match the fixtures on the same page. */
  const groupSheets = loaded.groups.map((g) => {
    const ms = loaded.matches.filter((m) => m.groupId === g.id);
    const ids = new Set<string>();
    for (const m of ms) {
      if (m.teamAId) ids.add(m.teamAId);
      if (m.teamBId) ids.add(m.teamBId);
    }
    const teams = [...ids].map((id) => byId.get(id)).filter((x): x is Team => !!x);
    return { group: g, teams, matches: ms.map(asPrint) };
  });

  /* The order of play, across every category. First in the pack because it is
     the sheet people walk up to and read; the group sheets are for running a
     group, not for finding out when you are on. */
  const orderRows: OrderRow[] = scheduleRows(loaded, { tables, resolverFor, divisionName })
    .filter((r) => r.time)
    .map((r) => ({
      time: r.time,
      court: r.court,
      category: r.category,
      round: r.round,
      aLabel: r.aLabel,
      bLabel: r.bLabel,
    }));
  const day = scheduleDay(loaded);

  /* The knockout, per CATEGORY and per bracket, each round named for where it
     sits in the draw (`bracketRounds` reads the W: feeders). It used to lump
     every category's knockout onto one sheet and name the distinct labels
     counting back from the end, so "Semi-Final 1" printed under
     "Quarter-finals" and two categories' finals shared one section. A match
     added by hand is in no bracket, and prints under "Other matches". */
  const many = divisionRows.length > 1;
  const rounds: { label: string; matches: PrintMatch[] }[] = [];
  for (const d of divisionRows) {
    const mine = loaded.matches.filter((m) => m.divisionId === d.id && m.groupId === null);
    const prefix = many ? `${d.name} · ` : "";
    for (const b of [...new Set(mine.map((m) => m.bracket).filter((x): x is string => !!x))].sort()) {
      const tag = b === "main" ? "" : `${b[0].toUpperCase()}${b.slice(1)} · `;
      for (const r of bracketRounds(mine.filter((m) => m.bracket === b))) {
        rounds.push({ label: `${prefix}${tag}${r.name}`, matches: r.matches.map(asPrint) });
      }
    }
    const other = mine.filter((m) => !m.bracket);
    if (other.length) rounds.push({ label: `${prefix}Other matches`, matches: other.map(asPrint) });
  }

  return (
    <>
      {/* Scoped to this route — in globals.css these would hit every page. */}
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        .pack { color: #000; background: #fff; font-family: ui-sans-serif, system-ui, sans-serif; }
        .psheet { break-after: page; page-break-after: always; padding-bottom: 8mm; }
        .psheet:last-child { break-after: auto; page-break-after: auto; }
        .brandbar { display: flex; align-items: flex-end; gap: 12px; border-bottom: 2px solid #000;
                    padding-bottom: 6px; margin-bottom: 10px; }
        .btitle { flex: 1; }
        .sport { font-size: 17px; font-weight: 900; letter-spacing: -0.01em; }
        .meta { font-size: 10px; font-weight: 700; letter-spacing: .08em; color: #444; }
        .printed { font-size: 9px; color: #666; white-space: nowrap; }
        .sub { font-size: 11px; font-weight: 900; text-transform: uppercase; letter-spacing: .08em;
               margin: 12px 0 4px; }
        table { width: 100%; border-collapse: collapse; font-size: 12px; }
        th, td { border: 1px solid #999; padding: 5px 6px; text-align: left; }
        th { background: #eee; font-size: 10px; text-transform: uppercase; letter-spacing: .05em; }
        .c { text-align: center; }
        .b { font-weight: 800; }
        .ct { color: #555; font-size: 11px; }
        .nm { font-weight: 700; }
        .win { font-weight: 800; }
        /* Score boxes are deliberately tall: they get written in by hand. */
        .sbox { height: 26px; background: #fafafa; }
        .self { background: #ddd; }
        .cap { font-size: 9.5px; color: #444; margin-top: 4px; line-height: 1.45; }
        .rules { font-size: 10px; color: #222; margin-top: 12px; padding-top: 6px;
                 border-top: 1px solid #bbb; }
        @media print { .noprint { display: none !important; } }
      `}</style>

      <div className="noprint sticky top-0 z-10 flex flex-wrap items-center gap-3 border-b border-neutral-800 bg-neutral-950 p-4">
        <Link href={`/t/${slug}`} className="text-sm font-semibold text-neutral-400 hover:text-neutral-200">
          ← {t.name}
        </Link>
        <span className="text-xs text-neutral-500">
          {withData ? "With scores" : "Blank — fill in by hand"}
        </span>
        <div className="ml-auto flex items-center gap-3">
          <Link
            href={`/t/${slug}/print${withData ? "?blank=1" : ""}`}
            className="rounded-lg border border-neutral-600 px-3 py-2 text-sm font-bold text-neutral-200 hover:border-neutral-400"
          >
            {withData ? "Print blank instead" : "Print with scores"}
          </Link>
          <PrintButton />
        </div>
      </div>

      <div className="pack mx-auto max-w-4xl bg-white p-6 text-black">
        <OrderOfPlaySheet tournament={t} day={day} rows={orderRows} printedAt={printedAt} />
        {groupSheets.map((s) => (
          <GroupSheet
            key={s.group.id}
            tournament={t}
            group={s.group}
            teams={s.teams}
            matches={s.matches}
            withData={withData}
            printedAt={printedAt}
          />
        ))}
        <KnockoutSheet tournament={t} rounds={rounds} printedAt={printedAt} />
        {groupSheets.length === 0 && rounds.length === 0 && orderRows.length === 0 && (
          <p className="p-8 text-center text-sm text-neutral-600">
            Nothing to print yet — draw the groups first.
          </p>
        )}
      </div>
    </>
  );
}
