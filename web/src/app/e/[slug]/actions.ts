"use server";

/* Taking an entry from a stranger.
 *
 * This is the first surface in the app designed for people who are not the
 * organiser, so it is the first that has to assume the input is hostile as well
 * as careless. Everything is re-validated here against the tournament's OWN
 * settings — the same `validateEntry` the page renders from — because the form
 * that produced this submission is entirely under the sender's control.
 *
 * An accepted entry is `pending` and creates nothing else. No team, no player,
 * no person. Nothing reaches the draw without an organiser saying so. */

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { divisions, registrations, tournaments } from "@/lib/db/schema";
import { writeEntry } from "@/lib/registration/store";
import {
  entryRuleProblems, entryWindow, validateEntry, verdictProblems, type Problem, type TypedPlayer,
} from "@/lib/registration";
import { normalisePhone, peopleByPhones } from "@/lib/people";
import {
  NO_RULES, duprToX100, entryFailures, hasRules, needsFrom, playerEvidence, rulesOfDivision,
} from "@/lib/eligibility";

export type SubmitResult =
  | { ok: true; reference: string }
  | { ok: false; problems: Problem[] };

const str = (v: FormDataEntryValue | null, max = 200) => String(v ?? "").trim().slice(0, max);

export async function submitEntry(slug: string, formData: FormData): Promise<SubmitResult> {
  const s = z.string().min(1).max(80).parse(slug);

  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, s)).limit(1);
  if (!t) return { ok: false, problems: [{ field: "form", message: "That event no longer exists." }] };

  /* Checked again on the server. The page also checks it, but the page is not
     what decides. */
  const window = entryWindow(t);
  if (!window.open) return { ok: false, problems: [{ field: "form", message: window.reason }] };

  const divs = await db.select().from(divisions).where(eq(divisions.tournamentId, t.id));

  /* With one category the form shows no picker, so nothing comes back — record
     the category anyway rather than leaving it null, or approval would have to
     guess later what the entry already implied. */
  const chosen = str(formData.get("divisionId"), 64) || null;
  const divisionId = chosen ?? (divs.length === 1 ? divs[0].id : null);
  const division = divs.find((d) => d.id === divisionId) ?? null;
  const rules = division ? rulesOfDivision(division) : NO_RULES;
  const needs = needsFrom(rules);

  /* Players arrive as parallel arrays from the form. Capped well above any
     real squad so a crafted post cannot make us build a huge insert.

     Every row sends every field, so the arrays line up by position. Date of
     birth and DUPR only appear on the form when the category needs them; they
     are read regardless and simply ignored when it does not. */
  const names = formData.getAll("playerName").slice(0, 12).map((v) => str(v, 80));
  const phones = formData.getAll("playerPhone").slice(0, 12).map((v) => str(v, 32));
  const dobs = formData.getAll("playerDob").slice(0, 12).map((v) => str(v, 10));
  const duprs = formData.getAll("playerDupr").slice(0, 12).map((v) => str(v, 8));
  /* An unchosen gender is kept as unknown ONLY where the category has a gender
     rule, so "Choose man or woman" can be said. Everywhere else it becomes "M"
     exactly as it always has — a category with no rules must submit as before. */
  const genders = formData.getAll("playerGender").slice(0, 12).map((v) => {
    const g = String(v);
    if (g === "F" || g === "M") return g as "M" | "F";
    return needs.gender ? null : ("M" as const);
  });

  const answers: Record<string, string> = {};
  for (const f of t.formFields ?? []) {
    const v = str(formData.get(`field:${f.id}`), 500);
    if (v) answers[f.id] = v;
  }
  const waiversAccepted = (t.waivers ?? [])
    .filter((w) => formData.get(`waiver:${w.id}`) === "on")
    .map((w) => w.id);

  const entry = {
    teamName: str(formData.get("teamName"), 60),
    players: names.map((name, i) => ({ name, phone: phones[i] ?? null, gender: genders[i] ?? null })),
    divisionId,
    answers,
    waiversAccepted,
  };

  const problems = validateEntry(t, entry, divs.map((d) => d.id));
  if (problems.length > 0) return { ok: false, problems };

  /* Blank rows are skipped, but each kept player remembers its ROW, so a reason
     lands under the right name even with an empty row in between. */
  const typed: TypedPlayer[] = names
    .map((name, row) => ({
      row, name, phone: phones[row] || null, gender: genders[row] ?? null,
      dob: dobs[row] ?? "", dupr: duprs[row] ?? "",
    }))
    .filter((p) => p.name.trim());

  /* ── The category's rules ─────────────────────────────────────────────
     Checked here, on the server, because the form that produced this post is
     under the sender's control: a hidden `required` or a removed field is one
     edit away. Nothing is written for an entry that does not fit.

     First what is MISSING — an empty box is a different problem from a limit
     not met, and saying "Age 35+ only" to someone who left the date blank tells
     them the wrong thing. Then the rules themselves. */
  if (hasRules(rules)) {
    const missing = entryRuleProblems(rules, typed, normalisePhone);
    if (missing.length) return { ok: false, problems: missing };

    const known = await peopleByPhones(typed.map((p) => p.phone));
    const squad = typed.map((p) => {
      const phone = normalisePhone(p.phone);
      return playerEvidence(
        {
          name: p.name,
          gender: p.gender,
          dob: needs.dob ? p.dob : null,
          dupr: needs.dupr ? duprToX100(p.dupr) : null,
        },
        phone ? known.get(phone) : null,
        t.sport,
        /* Never the stored record from a public form — see playerEvidence. */
        { useStored: false },
      );
    });
    const verdict = entryFailures(squad, rules, {
      complete: true, minTeamSize: t.minTeamSize, dated: true,
    });
    if (!verdict.ok) {
      return { ok: false, problems: verdictProblems(verdict, typed, division?.name ?? "this category") };
    }
  }

  const named = typed;

  /* One entry per phone per event. Without this a double-tapped submit button
     puts the same pair in the draw twice, and an organiser has to spot it.
     This look-up is the cheap, common case; `writeEntry` settles the rare one
     where two submits arrive together, through the database. */
  const already = { ok: false as const, problems: [{ field: "form", message: "An entry from this number is already in for this event." }] };
  const contactPhone = normalisePhone(named[0]?.phone ?? null);
  if (contactPhone) {
    const existing = await db
      .select({ id: registrations.id, status: registrations.status })
      .from(registrations)
      .where(and(eq(registrations.tournamentId, t.id), eq(registrations.contactPhone, contactPhone)));
    if (existing.some((e) => e.status === "pending" || e.status === "approved")) return already;
  }

  const registrationId = randomUUID();
  const written = await writeEntry(
    {
      id: registrationId,
      tournamentId: t.id,
      divisionId: entry.divisionId,
      teamName: entry.teamName,
      contactName: named[0]?.name ?? entry.teamName,
      contactPhone,
      contactEmail: str(formData.get("contactEmail"), 120) || null,
      answers,
      waiversAccepted,
      status: "pending",
      /* Free events still start unpaid; the organiser can waive or the fee is
         simply zero. One state machine, no special case. */
      paymentState: t.entryFee === 0 ? "waived" : "unpaid",
    },
    named.map((p, i) => ({
      id: randomUUID(),
      name: p.name,
      /* Normalised here so the roster can match it later without guessing. */
      phone: normalisePhone(p.phone),
      /* Past the rules check, a gender rule has already refused a blank; a
         category without one never produced one. */
      gender: p.gender ?? "M",
      position: i,
      /* Only what the category asked for. A date of birth typed into a form
         that did not need it is not kept — the less personal data held, the
         less there is to hold carefully. */
      dob: needs.dob ? p.dob || null : null,
      dupr: needs.dupr ? duprToX100(p.dupr) : null,
    })),
  );
  if (!written) return already;

  revalidatePath(`/t/${s}/manage`);
  /* A short human-quotable reference, so a registrant chasing an organiser on
     WhatsApp has something to say. */
  return { ok: true, reference: registrationId.slice(0, 8).toUpperCase() };
}
