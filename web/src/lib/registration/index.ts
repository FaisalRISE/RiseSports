import "server-only";

/* Whether a tournament will take an entry right now, and why not.
 *
 * Pure and separate from the page because the SAME decision has to be made in
 * two places that must never disagree: the public page decides what to render,
 * and the submit action decides what to accept. A form that shows itself open
 * while the server refuses the entry is worse than one that is plainly closed —
 * the registrant fills the whole thing in and then loses it.
 *
 * `reason` is written to be shown to a player, not logged for a developer. */

import type { FormField, Person, Tournament, Waiver } from "@/lib/db/schema";
import { acceptsEntries } from "@/lib/auth/policy";
import {
  duprLabel, duprToX100, needsFrom, parseDobISO, playerEvidence,
  type Evidence, type EntryVerdict, type Rules,
} from "@/lib/eligibility";

export type EntryWindow =
  | { open: true }
  | { open: false; reason: string; when?: "before" | "after" | "closed" };

export function entryWindow(
  t: Pick<Tournament, "status" | "registrationOpensAt" | "registrationClosesAt">,
  now: Date = new Date(),
): EntryWindow {
  /* The lifecycle wins over the dates. A live tournament has its draw made, so
     an entry arriving now has nowhere to go however early the window said. */
  if (!acceptsEntries(t.status)) {
    return {
      open: false,
      when: "closed",
      reason:
        t.status === "draft" ? "Entries are not open yet."
        : t.status === "live" ? "This tournament has started — entries are closed."
        : "This tournament has finished.",
    };
  }

  if (t.registrationOpensAt && now < t.registrationOpensAt) {
    return {
      open: false,
      when: "before",
      reason: `Entries open on ${indiaTimeLabel(t.registrationOpensAt)} (India time).`,
    };
  }
  if (t.registrationClosesAt && now > t.registrationClosesAt) {
    return {
      open: false,
      when: "after",
      reason: `Entries closed on ${indiaTimeLabel(t.registrationClosesAt)} (India time).`,
    };
  }
  return { open: true };
}

/* ── Entry open/close times are India time ────────────────────────────────
 *
 * An entry window is a TRUE instant — `entryWindow` compares it with the real
 * clock — unlike a match time, which is "floating" and never compared with now
 * (see lib/schedule). So the organiser's "09:00" has to become the instant
 * 09:00 IS, somewhere. That somewhere is India, where the app's organisers are.
 *
 * It used to be the SERVER's timezone: `new Date("2026-10-12T09:00")`, read on
 * a Vercel machine running in UTC, is 09:00 UTC — 14:30 in India. Entries opened
 * and closed five and a half hours late, and nothing looked wrong, because the
 * form and the page converted back through the same offset. On a laptop in
 * India, where the app was tested, every step happened to be right.
 *
 * India keeps no daylight saving, so +05:30 is a fixed offset and plain
 * arithmetic is exact. `Intl` is deliberately NOT used to build the input's
 * value: formats like en-CA can come back as "09:00 a.m." or "24:00", the
 * `datetime-local` box then renders empty, and the next Save of ANY setting on
 * that form posts it empty and silently erases the window. */

const IST_MS = (5 * 60 + 30) * 60_000;
const LOCAL = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

/** A `datetime-local` value, read as India time. Null for anything else. */
export function parseIndiaLocal(s: string | null | undefined): Date | null {
  const hit = LOCAL.exec(String(s ?? "").trim());
  if (!hit) return null;
  const [y, mo, d, h, mi, sec] = hit.slice(1).map((x) => Number(x ?? 0));
  if (mo < 1 || mo > 12 || d < 1 || d > 31 || h > 23 || mi > 59 || sec > 59) return null;
  const utc = Date.UTC(y, mo - 1, d, h, mi, sec);
  /* Date.UTC rolls 31 April over into May; refuse it rather than move it. */
  if (new Date(utc).getUTCDate() !== d) return null;
  return new Date(utc - IST_MS);
}

/** The value a `datetime-local` box needs to show this instant in India time. */
export function indiaLocalInput(d: Date | null | undefined): string {
  return d ? new Date(d.getTime() + IST_MS).toISOString().slice(0, 16) : "";
}

/** "12 Oct, 09:00" in India time, on any server. */
export function indiaTimeLabel(d: Date): string {
  return d.toLocaleString("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Asia/Kolkata",
  });
}

export type EntryInput = {
  teamName: string;
  players: { name: string; phone?: string | null; gender?: "M" | "F" | null }[];
  divisionId?: string | null;
  answers: Record<string, string>;
  waiversAccepted: string[];
};

export type Problem = { field: string; message: string };

/** One row of the entry form's players, as typed, with its row number kept. */
export type TypedPlayer = {
  /** The row on the form, so a message lands under the right player even when
      a blank row in between was skipped. */
  row: number;
  name: string;
  phone: string | null;
  gender: "M" | "F" | null;
  dob: string;
  dupr: string;
};

/**
 * What a player left out that the chosen category needs — asked BEFORE judging
 * the rules, so the entrant hears "Enter date of birth" rather than "Age 35+
 * only" when the real problem is an empty box.
 *
 * Returns one message per player at most, several reasons joined, under
 * `player:<row>`. A category with no rules needs nothing and returns nothing,
 * which is what keeps its form behaving exactly as it did.
 */
export function entryRuleProblems(rules: Rules, players: TypedPlayer[], normalisePhone: (p: string | null) => string | null): Problem[] {
  const needs = needsFrom(rules);
  const out: Problem[] = [];
  /* Where the phone IS the evidence, it has to belong to one player. Two rows
     carrying one number both read as that person, so both clear a rating limit
     — and approval then deliberately leaves the second unlinked, because one
     person cannot be on a team twice. The team would be created with a player
     the rules were never really applied to, and the manage screen would flag it
     red for a reason the entrant was never told about. Said here, where the
     number can still be corrected. */
  const usedPhones = new Set<string>();

  for (const p of players) {
    const says: string[] = [];
    if (needs.gender && p.gender == null) says.push("Choose man or woman.");
    if (needs.dob) {
      if (!p.dob.trim()) says.push("Enter date of birth. This category has an age limit.");
      else if (!parseDobISO(p.dob)) says.push("Enter a real date of birth.");
    }
    if (needs.dupr) {
      if (!p.dupr.trim()) {
        const bound = rules.duprMin != null
          ? `DUPR ${duprLabel(rules.duprMin)}+`
          : `DUPR ${duprLabel(rules.duprMax!)} and under`;
        says.push(`Enter your DUPR. This category needs ${bound}.`);
      } else if (duprToX100(p.dupr) == null) {
        says.push("DUPR must be a number between 1.00 and 8.00.");
      }
    }
    if (needs.phone) {
      const key = normalisePhone(p.phone);
      if (!key) {
        says.push("Enter a mobile number. This category has a rating limit, and the number is how we find the player's rating.");
      } else if (usedPhones.has(key)) {
        says.push("Use each player's own mobile number. This category has a rating limit, and one number can only stand for one player.");
      } else {
        usedPhones.add(key);
      }
    }
    if (says.length) out.push({ field: `player:${p.row}`, message: says.join(" ") });
  }
  return out;
}

/** One player of an entry as it is stored, for judging against a category. */
export type EntrantRow = {
  name: string;
  gender: "M" | "F" | null;
  dob: string | null;
  dupr: number | null;
  phone: string | null;
};

/**
 * Evidence for a whole stored entry — the approvals list and approval itself,
 * which must never reach different verdicts about the same waiting entry.
 *
 * ONE person per phone number, because that is how the entry will be WRITTEN:
 * approval links the first player carrying a number and deliberately leaves any
 * later one unlinked, since a person cannot be on a team twice. Letting both
 * borrow that person's rating approved teams whose second player the rating
 * limit had never really been applied to — and the manage screen then flagged
 * them red, for a reason nobody had been given the chance to fix.
 *
 * `normalisePhone` arrives as an argument so this file stays out of the
 * database layer.
 */
export function entrantEvidence(
  rows: EntrantRow[],
  known: Map<string, Person>,
  sport: string,
  normalisePhone: (p: string | null) => string | null,
): Evidence[] {
  const used = new Set<string>();
  return rows.map((r) => {
    const phone = normalisePhone(r.phone);
    const own = phone && !used.has(phone) ? known.get(phone) ?? null : null;
    if (phone) used.add(phone);
    return playerEvidence(
      { name: r.name, gender: r.gender, dob: r.dob, dupr: r.dupr },
      own,
      sport,
      { useStored: true },
    );
  });
}

/**
 * A refused verdict, as messages for the entry form.
 *
 * The note at the top says what happened; the reason goes under each player it
 * is about, so the entrant can see WHO does not fit rather than reading a list.
 * Organiser notes ("unrated") are left out — they never block, and they are for
 * the organiser at approval, not for the entrant.
 */
export function verdictProblems(verdict: EntryVerdict, players: TypedPlayer[], categoryName: string): Problem[] {
  const perPlayer = verdict.players
    .map((fs, i) => ({ row: players[i].row, texts: fs.filter((f) => f.severity === "block").map((f) => f.text) }))
    .filter((p) => p.texts.length > 0);
  const team = verdict.team.filter((f) => f.severity === "block").map((f) => f.text);

  /* The note at the top says what happened, and it has to match what is
     actually written underneath. A Mixed team of two men breaks NOTHING about
     either player — so "see the note under each player" sent the entrant
     hunting under two names with nothing beneath them. When only the team rule
     failed, the team rule is what the banner says. */
  const out: Problem[] = [
    {
      field: "form",
      message: perPlayer.length
        ? `Not everyone on this entry can play in ${categoryName}. See the note under each player.`
        : `This team cannot enter ${categoryName}: ${team.join(" ")}`,
    },
  ];
  for (const p of perPlayer) out.push({ field: `player:${p.row}`, message: p.texts.join(" · ") });
  if (team.length) out.push({ field: "division", message: team.join(" ") });
  return out;
}

/**
 * Validate an entry against the organiser's own settings.
 *
 * Returns EVERY problem rather than the first, because a registrant on a phone
 * should not have to submit four times to discover four things.
 */
export function validateEntry(
  t: Pick<Tournament, "minTeamSize" | "maxTeamSize" | "formFields" | "waivers">,
  entry: EntryInput,
  divisionIds: string[] = [],
): Problem[] {
  const problems: Problem[] = [];

  if (!entry.teamName.trim()) problems.push({ field: "teamName", message: "Give your team a name." });

  const named = entry.players.filter((p) => p.name.trim());
  if (named.length < t.minTeamSize) {
    problems.push({
      field: "players",
      message: `This event needs at least ${t.minTeamSize} player${t.minTeamSize === 1 ? "" : "s"} per team.`,
    });
  }
  if (named.length > t.maxTeamSize) {
    problems.push({
      field: "players",
      message: `No more than ${t.maxTeamSize} player${t.maxTeamSize === 1 ? "" : "s"} per team.`,
    });
  }

  /* A division must be one the organiser actually created — a stale or forged
     id would otherwise attach the entry to nothing.

     Only ASKED for when there is a real choice. Every event now has at least
     one category (see lib/divisions), so requiring a pick whenever any exist
     would make a one-category club night demand that entrants choose from a
     list of one — and reject the entry when they did not. A single category is
     implied, not selected. */
  if (divisionIds.length > 1 && !entry.divisionId) {
    problems.push({ field: "division", message: "Choose a division." });
  }
  if (entry.divisionId && divisionIds.length > 0 && !divisionIds.includes(entry.divisionId)) {
    problems.push({ field: "division", message: "That division is not part of this event." });
  }

  for (const f of (t.formFields ?? []) as FormField[]) {
    const answer = (entry.answers[f.id] ?? "").trim();
    if (f.required && !answer) {
      problems.push({ field: `field:${f.id}`, message: `${f.question} is required.` });
      continue;
    }
    if (answer && f.type === "choice" && f.options?.length && !f.options.includes(answer)) {
      problems.push({ field: `field:${f.id}`, message: `Choose one of the listed options for ${f.question}.` });
    }
    if (answer && f.type === "number" && !Number.isFinite(Number(answer))) {
      problems.push({ field: `field:${f.id}`, message: `${f.question} must be a number.` });
    }
  }

  /* Every waiver, not just some. An entry that skipped one is not consented. */
  for (const w of (t.waivers ?? []) as Waiver[]) {
    if (!entry.waiversAccepted.includes(w.id)) {
      problems.push({ field: `waiver:${w.id}`, message: `You must accept "${w.title}".` });
    }
  }

  return problems;
}

/** ₹ from integer paise. Money is never a float here — see lib/finance. */
export const formatFee = (paise: number): string =>
  paise === 0 ? "Free" : `₹${(paise / 100).toLocaleString("en-IN", { minimumFractionDigits: paise % 100 ? 2 : 0 })}`;

/** Paise from a rupee amount typed by an organiser. */
export const feeToPaise = (rupees: string | number): number => {
  const n = typeof rupees === "number" ? rupees : Number(String(rupees).replace(/[^0-9.]/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.round(n * 100) : 0;
};
