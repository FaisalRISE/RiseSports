import { describe, it, expect } from "vitest";
import { scheduleCsv, scheduleText, whatsappHref, type ScheduleRow } from "./share";

const row = (over: Partial<ScheduleRow> = {}): ScheduleRow => ({
  time: "09:00",
  court: 1,
  category: "Main",
  round: "Group A · R1",
  aLabel: "Smashers",
  bLabel: "Dinkers",
  score: "",
  played: false,
  ...over,
});

describe("CSV", () => {
  it("writes a header and one line per match", () => {
    const csv = scheduleCsv([row(), row({ time: "09:20", court: 2, aLabel: "Aces" })]);
    const lines = csv.split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[0]).toBe(
      '"Time","Court","Category","Stage","Team A","Team B","Score"',
    );
    expect(lines[1]).toContain('"09:00","1","Main"');
    expect(lines[2]).toContain('"Aces"');
  });

  it("uses CRLF, because the thing that opens this is Excel", () => {
    expect(scheduleCsv([row()])).toContain("\r\n");
  });

  it("escapes a quote by doubling it", () => {
    const csv = scheduleCsv([row({ aLabel: 'The "Real" Smashers' })]);
    expect(csv).toContain('"The ""Real"" Smashers"');
  });

  it("keeps a comma inside its field", () => {
    const csv = scheduleCsv([row({ aLabel: "Smith, R" })]);
    expect(csv.split("\r\n")[1].split('","')).toHaveLength(7);
  });

  it("defuses a team name a spreadsheet would run as a formula", () => {
    /* A team called =1+1 is a spreadsheet injection, and the legacy exporter
       escaped quotes but not this. The value is preserved, not stripped — the
       organiser still sees what was typed. */
    for (const evil of ["=1+1", "+cmd", "-2", "@SUM(A1)"]) {
      const csv = scheduleCsv([row({ aLabel: evil })]);
      expect(csv).toContain(`"'${evil}"`);
    }
  });

  it("leaves an ordinary name alone", () => {
    expect(scheduleCsv([row({ aLabel: "Smashers" })])).toContain('"Smashers"');
    expect(scheduleCsv([row({ aLabel: "Smashers" })])).not.toContain("'Smashers");
  });

  it("writes an empty court and score as empty, not as null", () => {
    const line = scheduleCsv([row({ court: null, score: "" })]).split("\r\n")[1];
    expect(line).toBe('"09:00","","Main","Group A · R1","Smashers","Dinkers",""');
  });
});

describe("the WhatsApp message", () => {
  const ctx = {
    name: "Thursday Club Night",
    day: "Sun 20 Sept",
    venue: "Rise Arena",
    url: "https://rise-sports.vercel.app/t/club-night",
  };

  it("leads with the event, the day and the venue", () => {
    const text = scheduleText(ctx, [row()]);
    expect(text.startsWith("*Thursday Club Night*\nSun 20 Sept @ Rise Arena")).toBe(true);
  });

  it("groups by time, so a player reads when they are on", () => {
    const text = scheduleText(ctx, [
      row({ time: "09:00", court: 1, aLabel: "A", bLabel: "B" }),
      row({ time: "09:00", court: 2, aLabel: "C", bLabel: "D" }),
      row({ time: "09:20", court: 1, aLabel: "E", bLabel: "F" }),
    ]);
    expect(text).toContain("_09:00_");
    expect(text).toContain("_09:20_");
    /* The time appears ONCE for the two matches that share it. */
    expect(text.match(/_09:00_/g)).toHaveLength(1);
    expect(text).toContain("Ct1 Main · A v B");
  });

  it("shows a score where there is one", () => {
    expect(scheduleText(ctx, [row({ score: "11–7", played: true })])).toContain("(11–7)");
  });

  it("always ends with the link", () => {
    expect(scheduleText(ctx, [row()]).trimEnd().endsWith(ctx.url)).toBe(true);
  });

  it("says so when there is no order of play yet", () => {
    const text = scheduleText(ctx, [row({ time: "", court: null })]);
    expect(text).toContain("not drawn yet");
    expect(text).toContain(ctx.url);
  });

  it("CUTS a long schedule and says how much is missing", () => {
    /* The legacy version pasted everything into the URL. A fifty-match event
       then produces a link long enough that clients truncate it silently, and
       the organiser sends half a message without knowing. */
    const many = Array.from({ length: 120 }, (_, i) =>
      row({ time: `${9 + Math.floor(i / 4)}:00`, court: (i % 4) + 1, aLabel: `Team ${i}` }),
    );
    const text = scheduleText(ctx, many);
    expect(text).toMatch(/…and \d+ more\./);
    expect(text).toContain(ctx.url);
    expect(text.length).toBeLessThan(1800);
    /* The part it did send is whole — it stops between matches, not mid-name. */
    expect(text).toContain("Team 0");
    expect(text).not.toMatch(/Team \d+ v $/m);
  });

  it("does not cut a schedule that fits", () => {
    const text = scheduleText(ctx, [row(), row({ time: "09:20" })]);
    expect(text).not.toContain("more.");
  });

  it("encodes into a link WhatsApp will open", () => {
    const href = whatsappHref(scheduleText(ctx, [row()]));
    expect(href.startsWith("https://wa.me/?text=")).toBe(true);
    expect(href).not.toContain(" ");
    expect(decodeURIComponent(href.slice("https://wa.me/?text=".length))).toContain("Smashers");
  });
});
