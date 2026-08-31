"use server";

/* Organiser-side registration actions.
 *
 * Same discipline as every other mutation here: load, authorise server-side,
 * write. `requireManager` is the only thing standing between a public
 * registration URL and someone editing the event it belongs to. */

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { asc, eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { divisions, registrations, tournaments, type FormField, type TournamentStatus, type Waiver } from "@/lib/db/schema";
import { principalFor } from "@/lib/auth/guard";
import { canManage, assert } from "@/lib/auth/policy";
import { feeToPaise } from "@/lib/registration";
import { approveRegistration, setRegistrationStatus, setPaymentState } from "@/lib/registration/approve";

async function requireManager(tournamentId: string) {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!t) throw new Error("Tournament not found");
  assert(canManage(await principalFor(t.id)), "manage this tournament");
  return t;
}

const refresh = (slug: string) => {
  revalidatePath(`/t/${slug}/manage/registration`);
  revalidatePath(`/t/${slug}/manage`);
  /* The public page too — a changed window or fee is visible there instantly. */
  revalidatePath(`/e/${slug}`);
};

const dateOrNull = (v: FormDataEntryValue | null): Date | null => {
  const s = String(v ?? "").trim();
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
};

/** Move the tournament through its lifecycle: draft → open → live → finished. */
export async function setStatus(tournamentId: string, status: TournamentStatus) {
  const t = await requireManager(tournamentId);
  const parsed = z.enum(["draft", "open", "live", "finished"]).parse(status);
  await db.update(tournaments).set({ status: parsed }).where(eq(tournaments.id, t.id));
  refresh(t.slug);
}

export async function saveRegistrationSettings(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);

  const min = Math.max(1, Number(formData.get("minTeamSize") ?? 1) || 1);
  const max = Math.max(min, Number(formData.get("maxTeamSize") ?? min) || min);

  await db
    .update(tournaments)
    .set({
      about: String(formData.get("about") ?? "").trim().slice(0, 1000) || null,
      venue: String(formData.get("venue") ?? "").trim().slice(0, 120) || null,
      registrationOpensAt: dateOrNull(formData.get("opensAt")),
      registrationClosesAt: dateOrNull(formData.get("closesAt")),
      minTeamSize: min,
      maxTeamSize: max,
      /* Stored as integer paise — floats are how a book stops balancing. */
      entryFee: feeToPaise(String(formData.get("entryFee") ?? "0")),
      hideEntrants: formData.get("hideEntrants") === "on",
    })
    .where(eq(tournaments.id, t.id));
  refresh(t.slug);
}

/* ── Divisions ───────────────────────────────────────────────────────────── */

export async function addDivision(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const name = String(formData.get("name") ?? "").trim().slice(0, 60);
  if (!name) return;

  const existing = await db.select({ id: divisions.id }).from(divisions).where(eq(divisions.tournamentId, t.id));
  await db.insert(divisions).values({
    id: randomUUID(),
    tournamentId: t.id,
    name,
    description: String(formData.get("description") ?? "").trim().slice(0, 120) || null,
    position: existing.length,
  });
  refresh(t.slug);
}

export async function removeDivision(tournamentId: string, divisionId: string) {
  const t = await requireManager(tournamentId);
  await db.delete(divisions).where(eq(divisions.id, divisionId));
  refresh(t.slug);
}

/* ── Form fields and waivers ─────────────────────────────────────────────
 *
 * Kept as jsonb on the tournament: they are configuration an organiser edits as
 * a set, and nothing joins to them. A row per question would buy referential
 * integrity nobody needs and cost a migration every time the shape changes. */

export async function addFormField(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const question = String(formData.get("question") ?? "").trim().slice(0, 120);
  if (!question) return;

  const type = z.enum(["text", "choice", "number"]).catch("text").parse(formData.get("type"));
  const options = String(formData.get("options") ?? "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean)
    .slice(0, 20);

  const field: FormField = {
    id: randomUUID().slice(0, 8),
    question,
    type,
    ...(type === "choice" && options.length ? { options } : {}),
    required: formData.get("required") === "on",
  };

  await db
    .update(tournaments)
    .set({ formFields: [...(t.formFields ?? []), field].slice(0, 20) })
    .where(eq(tournaments.id, t.id));
  refresh(t.slug);
}

export async function removeFormField(tournamentId: string, fieldId: string) {
  const t = await requireManager(tournamentId);
  await db
    .update(tournaments)
    .set({ formFields: (t.formFields ?? []).filter((f) => f.id !== fieldId) })
    .where(eq(tournaments.id, t.id));
  refresh(t.slug);
}

export async function addWaiver(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const title = String(formData.get("title") ?? "").trim().slice(0, 80);
  const body = String(formData.get("body") ?? "").trim().slice(0, 2000);
  if (!title || !body) return;

  const waiver: Waiver = { id: randomUUID().slice(0, 8), title, body };
  await db
    .update(tournaments)
    .set({ waivers: [...(t.waivers ?? []), waiver].slice(0, 10) })
    .where(eq(tournaments.id, t.id));
  refresh(t.slug);
}

export async function removeWaiver(tournamentId: string, waiverId: string) {
  const t = await requireManager(tournamentId);
  await db
    .update(tournaments)
    .set({ waivers: (t.waivers ?? []).filter((w) => w.id !== waiverId) })
    .where(eq(tournaments.id, t.id));
  refresh(t.slug);
}

/* ── Deciding on entries ─────────────────────────────────────────────────── */

export type DecisionResult = { ok: true; message?: string } | { ok: false; error: string };

export async function approveEntry(tournamentId: string, registrationId: string): Promise<DecisionResult> {
  const t = await requireManager(tournamentId);
  const res = await approveRegistration(registrationId, t.ownerId);
  refresh(t.slug);
  if (!res.ok) return res;
  return {
    ok: true,
    message:
      res.carried > 0
        ? `Approved — ${res.carried} player${res.carried === 1 ? "" : "s"} brought an existing RISE Rating.`
        : "Approved.",
  };
}

export async function declineEntry(tournamentId: string, registrationId: string, note?: string): Promise<DecisionResult> {
  const t = await requireManager(tournamentId);
  const res = await setRegistrationStatus(registrationId, "declined", note);
  refresh(t.slug);
  return res.ok ? { ok: true } : res;
}

export async function markPayment(
  tournamentId: string,
  registrationId: string,
  state: "unpaid" | "paid" | "waived",
): Promise<DecisionResult> {
  const t = await requireManager(tournamentId);
  const res = await setPaymentState(registrationId, state);
  refresh(t.slug);
  return res.ok ? { ok: true } : res;
}

/** Everything the Registration tab needs, in one round trip. */
export async function loadRegistrationTab(slug: string) {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  if (!t) return null;
  const [divs, entries] = await Promise.all([
    db.select().from(divisions).where(eq(divisions.tournamentId, t.id)).orderBy(asc(divisions.position)),
    db.select().from(registrations).where(eq(registrations.tournamentId, t.id)).orderBy(asc(registrations.createdAt)),
  ]);
  return { tournament: t, divisions: divs, entries };
}
