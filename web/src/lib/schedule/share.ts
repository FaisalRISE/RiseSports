import "server-only";

/* The schedule as a table, and the two ways it leaves the app.
 *
 * ── Why this is one module and not four ──────────────────────────────────
 * The manage screen, the print pack, the CSV and the WhatsApp message all want
 * the same list: every match, with its time, court, category and score. Written
 * four times they drift — the print pack gains a column the CSV does not have,
 * the message shows a score the table does not. `scheduleRows` is the one
 * definition and everything else formats it.
 *
 * ── What is NOT ported ───────────────────────────────────────────────────
 * The legacy `exportSchedulePDF` (app.source.js:841) opens a blank window and
 * writes a document into it. `/t/[slug]/print` already does that job better and
 * for the reason CLAUDE.md gives about the print pack: popups are blocked on
 * the phones organisers actually carry, and a "download" that silently does
 * nothing is worse than no button. The CSV here is a normal link to a route
 * that returns a file, so nothing can block it.
 */

import { viewMatch } from "@/lib/matchState";
import { resolveSlots, type GroupTable, type LoadedTournament } from "@/lib/tournamentState";
import type { RefResolver } from "@/lib/brackets";
import { floatingTime, floatingDay } from "./index";

export type ScheduleRow = {
  /** "09:20", or empty when the order of play has not been drawn. */
  time: string;
  court: number | null;
  category: string;
  round: string;
  aLabel: string;
  bLabel: string;
  /** "11–7", or empty while unplayed. */
  score: string;
  played: boolean;
};

export type RowOptions = {
  tables: GroupTable[];
  resolverFor: (divisionId: string) => RefResolver;
  divisionName: Map<string, string>;
};

/**
 * Every match, in the order it will be played.
 *
 * Timed matches first, by the clock. Untimed ones after, grouped by category —
 * they are the ones the organiser has not scheduled yet, and burying them among
 * the timed rows hides exactly the thing they need to notice.
 */
export function scheduleRows(loaded: LoadedTournament, opts: RowOptions): ScheduleRow[] {
  const t = loaded.tournament;
  const byId = new Map(loaded.teams.map((x) => [x.id, x]));
  const nameOf = (id: string) => byId.get(id)?.name ?? "—";

  const rows = loaded.matches.map((m) => {
    const v = viewMatch(t, m);
    const [a, b] = resolveSlots(m, opts.resolverFor(m.divisionId), nameOf);
    const played = v.typed || v.over;
    const [sa, sb] = v.typed ? [m.typedScoreA ?? 0, m.typedScoreB ?? 0] : [v.a, v.b];
    return {
      row: {
        time: m.scheduledAt ? floatingTime(m.scheduledAt) : "",
        court: m.court,
        category: opts.divisionName.get(m.divisionId) ?? "",
        round: m.round,
        aLabel: a.label,
        bLabel: b.label,
        score: played ? `${sa}–${sb}` : "",
        played,
      } satisfies ScheduleRow,
      at: m.scheduledAt ? m.scheduledAt.getTime() : null,
      court: m.court ?? 0,
    };
  });

  return rows
    .sort((x, y) => {
      if (x.at === null && y.at === null) {
        return x.row.category.localeCompare(y.row.category) || x.row.round.localeCompare(y.row.round);
      }
      if (x.at === null) return 1;
      if (y.at === null) return -1;
      return x.at - y.at || x.court - y.court;
    })
    .map((x) => x.row);
}

/** The day the event is on, from the first scheduled match. */
export function scheduleDay(loaded: LoadedTournament): string | null {
  const first = loaded.matches
    .filter((m) => m.scheduledAt)
    .sort((a, b) => a.scheduledAt!.getTime() - b.scheduledAt!.getTime())[0];
  return first ? floatingDay(first.scheduledAt!) : null;
}

const CSV_HEADER = ["Time", "Court", "Category", "Stage", "Team A", "Team B", "Score"];

/**
 * A CSV of the whole schedule.
 *
 * `\r\n` and quoted-everything, because the thing that opens this is Excel on
 * an organiser's laptop. A leading `'` guard is added to any value Excel would
 * otherwise treat as a formula: a team called "=Smashers" is a spreadsheet
 * injection, and the legacy version escaped quotes but not that.
 */
export function scheduleCsv(rows: ScheduleRow[]): string {
  const esc = (s: unknown) => {
    const raw = s == null ? "" : String(s);
    const safe = /^[=+\-@\t\r]/.test(raw) ? `'${raw}` : raw;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = [CSV_HEADER.map(esc).join(",")];
  for (const r of rows) {
    lines.push(
      [r.time, r.court ?? "", r.category, r.round, r.aLabel, r.bLabel, r.score].map(esc).join(","),
    );
  }
  return lines.join("\r\n");
}

/** Safe-ish for a `wa.me?text=` URL once encoded, with room for the rest. */
const SHARE_BUDGET = 1400;

export type ShareContext = {
  name: string;
  day: string | null;
  venue: string | null;
  /** The public page, so a truncated message still leads somewhere complete. */
  url: string;
};

/**
 * The order of play as a WhatsApp message.
 *
 * Grouped by time rather than by category, because that is how a player reads
 * it: "when am I on", not "show me the Mixed draw". WhatsApp's own markers —
 * `*bold*`, `_italic_` — are what the legacy version used and they render in
 * every client.
 *
 * ── The cap is the part that matters ─────────────────────────────────────
 * The legacy version pasted the whole schedule into a `wa.me` URL. A fifty-match
 * event makes a URL long enough that clients quietly truncate it, so the
 * organiser sends a message that stops mid-sentence and has no idea. Here the
 * list is cut at a budget and the remainder becomes a line pointing at the
 * public page, which always has all of it.
 */
export function scheduleText(ctx: ShareContext, rows: ScheduleRow[]): string {
  const head = [
    `*${ctx.name}*`,
    [ctx.day, ctx.venue ? `@ ${ctx.venue}` : null].filter(Boolean).join(" "),
  ].filter(Boolean).join("\n");

  const timed = rows.filter((r) => r.time);
  const listed: string[] = [];
  let lastTime = "";
  let used = 0;
  let shown = 0;

  for (const r of timed) {
    const parts: string[] = [];
    if (r.time !== lastTime) parts.push(`\n_${r.time}_`);
    const court = r.court ? `Ct${r.court} ` : "";
    const cat = r.category ? `${r.category} · ` : "";
    const score = r.score ? ` (${r.score})` : "";
    parts.push(`${court}${cat}${r.aLabel} v ${r.bLabel}${score}`);

    const chunk = parts.join("\n");
    if (used + chunk.length > SHARE_BUDGET) break;
    used += chunk.length;
    listed.push(chunk);
    lastTime = r.time;
    shown++;
  }

  const tail: string[] = [];
  const left = timed.length - shown;
  if (left > 0) tail.push(`…and ${left} more.`);
  if (timed.length === 0) tail.push("The order of play is not drawn yet.");
  tail.push(ctx.url);

  return [head, listed.join("\n").trim(), tail.join("\n")].filter(Boolean).join("\n\n");
}

/** The link that opens WhatsApp with the message ready to send. */
export const whatsappHref = (text: string): string =>
  `https://wa.me/?text=${encodeURIComponent(text)}`;
