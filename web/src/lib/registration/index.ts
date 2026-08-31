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

import type { FormField, Tournament, Waiver } from "@/lib/db/schema";
import { acceptsEntries } from "@/lib/auth/policy";

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
      reason: `Entries open on ${fmt(t.registrationOpensAt)}.`,
    };
  }
  if (t.registrationClosesAt && now > t.registrationClosesAt) {
    return {
      open: false,
      when: "after",
      reason: `Entries closed on ${fmt(t.registrationClosesAt)}.`,
    };
  }
  return { open: true };
}

const fmt = (d: Date) =>
  d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export type EntryInput = {
  teamName: string;
  players: { name: string; phone?: string | null; gender?: "M" | "F" }[];
  divisionId?: string | null;
  answers: Record<string, string>;
  waiversAccepted: string[];
};

export type Problem = { field: string; message: string };

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
     id would otherwise attach the entry to nothing. */
  if (divisionIds.length > 0 && !entry.divisionId) {
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
