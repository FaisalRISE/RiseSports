import { notFound } from "next/navigation";
import { divisionsOf } from "@/lib/divisions";
import { principalFor } from "@/lib/auth/guard";
import { canView } from "@/lib/auth/policy";
import { loadTournament, groupTables, resolverFactory } from "@/lib/tournamentState";
import { scheduleRows, scheduleCsv } from "@/lib/schedule/share";

/* The schedule as a file.
 *
 * A route rather than a button that builds a Blob in the browser, for the same
 * reason the print pack is a route: this is a server-rendered app and the thing
 * being exported is derived on the server. It is also the only download shape a
 * phone reliably honours — an `<a download>` with a blob: href is blocked in
 * more places than it works.
 *
 * The URL ends in `.csv` deliberately: some Android file managers and mail
 * clients pick the handler from the name rather than the content type.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;
  const loaded = await loadTournament(slug);
  if (!loaded) notFound();

  const t = loaded.tournament;
  if (!canView(await principalFor(t.id), t.status)) notFound();

  const tables = groupTables(loaded);
  const divisionRows = await divisionsOf(t.id);
  const rows = scheduleRows(loaded, {
    tables,
    resolverFor: resolverFactory(loaded, tables),
    divisionName: new Map(divisionRows.map((d) => [d.id, d.name])),
  });

  const file = `${t.slug.replace(/[^a-z0-9]+/gi, "-")}-schedule.csv`;
  /* A BOM, because Excel on Windows reads a CSV as the system codepage without
     one and turns every "–" and every Indian name with a diacritic into
     mojibake. The organiser opening this is on Windows. */
  return new Response(`﻿${scheduleCsv(rows)}`, {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="${file}"`,
      "cache-control": "no-store",
    },
  });
}
