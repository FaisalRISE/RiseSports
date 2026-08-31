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
import { divisions, registrations, registrationPlayers, tournaments } from "@/lib/db/schema";
import { entryWindow, validateEntry, type Problem } from "@/lib/registration";
import { normalisePhone } from "@/lib/people";

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

  /* Players arrive as parallel arrays from the form. Capped well above any
     real squad so a crafted post cannot make us build a huge insert. */
  const names = formData.getAll("playerName").slice(0, 12).map((v) => str(v, 80));
  const phones = formData.getAll("playerPhone").slice(0, 12).map((v) => str(v, 32));
  const genders = formData.getAll("playerGender").slice(0, 12).map((v) => (String(v) === "F" ? "F" : "M") as "M" | "F");

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
    players: names.map((name, i) => ({ name, phone: phones[i] ?? null, gender: genders[i] ?? "M" })),
    divisionId: str(formData.get("divisionId"), 64) || null,
    answers,
    waiversAccepted,
  };

  const problems = validateEntry(t, entry, divs.map((d) => d.id));
  if (problems.length > 0) return { ok: false, problems };

  const named = entry.players.filter((p) => p.name.trim());

  /* One entry per phone per event. Without this a double-tapped submit button
     puts the same pair in the draw twice, and an organiser has to spot it. */
  const contactPhone = normalisePhone(named[0]?.phone ?? null);
  if (contactPhone) {
    const existing = await db
      .select({ id: registrations.id, status: registrations.status })
      .from(registrations)
      .where(and(eq(registrations.tournamentId, t.id), eq(registrations.contactPhone, contactPhone)));
    const live = existing.find((e) => e.status === "pending" || e.status === "approved");
    if (live) {
      return {
        ok: false,
        problems: [{ field: "form", message: "An entry from this number is already in for this event." }],
      };
    }
  }

  const registrationId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(registrations).values({
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
    });

    await tx.insert(registrationPlayers).values(
      named.map((p, i) => ({
        id: randomUUID(),
        registrationId,
        name: p.name,
        /* Normalised here so the roster can match it later without guessing. */
        phone: normalisePhone(p.phone),
        gender: p.gender,
        position: i,
      })),
    );
  });

  revalidatePath(`/t/${s}/manage`);
  /* A short human-quotable reference, so a registrant chasing an organiser on
     WhatsApp has something to say. */
  return { ok: true, reference: registrationId.slice(0, 8).toUpperCase() };
}
