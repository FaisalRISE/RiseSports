"use server";

/* Organiser-side registration actions.
 *
 * Same discipline as every other mutation here: load, authorise server-side,
 * write. `requireManager` is the only thing standing between a public
 * registration URL and someone editing the event it belongs to. */

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { randomUUID } from "node:crypto";
import { and, asc, eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { divisions, matches, players, registrations, teams, tournaments, type FormField, type TournamentStatus, type Waiver } from "@/lib/db/schema";
import { DrawChanged, categorySignature, deleteUnplayed, lockedIds } from "@/lib/draw/guard";
import { principalFor } from "@/lib/auth/guard";
import { canManage, assert } from "@/lib/auth/policy";
import { feeToPaise, parseIndiaLocal } from "@/lib/registration";
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

/* The organiser types India time. `new Date(s)` read it in the SERVER's
   timezone — UTC on Vercel — which opened and closed entries five and a half
   hours late. See `parseIndiaLocal`. */
const dateOrNull = (v: FormDataEntryValue | null): Date | null => parseIndiaLocal(String(v ?? ""));

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

  /* A Mixed category needs a man AND a woman on every team, which a team of
     one can never have. Saving team size 1 underneath one would make every
     entry to it impossible and say nothing about why. Refused with the name of
     the category, before anything is written. */
  if (max < 2) {
    const [mixed] = await db
      .select({ name: divisions.name })
      .from(divisions)
      .where(and(eq(divisions.tournamentId, t.id), eq(divisions.genderRule, "MX")))
      .limit(1);
    /* A CODE in the URL, never the sentence: the page builds the message from
       the database, so a crafted link cannot put words on an organiser's
       screen. */
    if (mixed) redirect(`/t/${t.slug}/manage/registration?problem=mixed-team-size`);
  }

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

/* ── Removing a category never destroys a result ──────────────────────────
 * A category's matches, teams and groups go with it (ON DELETE CASCADE), and a
 * match's rating history goes with the match — while the players' ratings stay
 * moved: a rating that moved with no record of what moved it. It is the hole a
 * redraw had, and the redraw's guard closes it (lib/draw/guard): refused while
 * any match in the category has play or rating history, and the matches then
 * deleted through `deleteUnplayed`, which re-checks each row inside the DELETE
 * and rolls everything back if one was played after it was read.
 *
 * Removing a category that still has teams, fixtures or waiting entries takes
 * two taps (RemoveCategoryButton), and like a redraw the second tap carries a
 * fingerprint of what the page SAW (`categorySignature`): a page opened while
 * the category was empty cannot remove what arrived since.
 *
 * What goes WITH it is settled here rather than left to the foreign keys. Its
 * entries — approved ones (through their teams) and ones still WAITING — are
 * WITHDRAWN, with a note saying why. The cascade would leave an approved one
 * "approved" with no team — impossible to decline — and a waiting one pending
 * with no category and no record of which it chose; both still counted as the
 * pair's live entry, so they could not enter another category. The waiting
 * ones are part of the fingerprint, so a category with only those asks twice.
 * Its players rows are deleted (nothing in the category was played, so no
 * rating history points at them): left behind with no team, they counted as
 * "another event's row holding this seed" and pinned a misfiled seed for ever
 * (`refileSeeds`).
 *
 * A refusal is a CODE carried back to the registration page, which builds the
 * sentence from the database — never a message in the URL. */
type RemoveProblem = "category-played" | "category-changed" | "confirm-needed" | "category-stale";

export async function removeDivision(tournamentId: string, divisionId: string, formData?: FormData) {
  const t = await requireManager(tournamentId);
  const sent = String(formData?.get("confirm") ?? "");
  let problem: RemoveProblem | null = null;
  try {
    problem = await db.transaction(async (tx): Promise<RemoveProblem | null> => {
      /* The event row first: the cascade deletes and updates many matches in
         its own order, and every other writer of many matches takes this lock
         first (see lib/scoring/change). */
      await tx.select({ id: tournaments.id }).from(tournaments).where(eq(tournaments.id, t.id)).for("no key update");
      /* Only a category of THIS event. Deleting by id alone let a manager of one
         event remove another event's category — and with it, by cascade, its
         teams. Locked as a draw locks it, so nothing new is filed under it
         between the check and the delete: an insert naming it waits here, then
         finds it gone. One already gone is nothing to do. */
      const [d] = await tx
        .select({ id: divisions.id })
        .from(divisions)
        .where(and(eq(divisions.id, divisionId), eq(divisions.tournamentId, t.id)))
        .for("update");
      if (!d) return null;
      /* Every match the cascade would take: chosen by category alone, exactly
         as the foreign key chooses them. */
      const doomed = await tx
        .select({ id: matches.id, log: matches.log, typedScoreA: matches.typedScoreA, typedScoreB: matches.typedScoreB })
        .from(matches)
        .where(eq(matches.divisionId, d.id));
      if ((await lockedIds(doomed, tx)).size > 0) return "category-played";
      /* Nothing played. Anything to lose must have been seen by the page that
         asked; an empty category needs no second tap. */
      const squads = await tx.select({ id: teams.id }).from(teams).where(eq(teams.divisionId, d.id));
      /* An entry waiting here cannot change under us: approval and a new
         entry both take the category (KEY SHARE) before they write. */
      const waitingHere = and(eq(registrations.tournamentId, t.id), eq(registrations.status, "pending"), eq(registrations.divisionId, d.id));
      const waiting = await tx.select({ id: registrations.id }).from(registrations).where(waitingHere);
      if (squads.length + doomed.length + waiting.length > 0) {
        if (!sent) return "confirm-needed";
        const seen = categorySignature(squads.map((x) => x.id), doomed.map((m) => m.id), waiting.map((r) => r.id));
        if (sent !== seen) return "category-stale";
      }
      await deleteUnplayed(tx, doomed.map((m) => m.id));
      const squadIds = squads.map((x) => x.id);
      if (squadIds.length + waiting.length > 0) {
        const [name] = await tx.select({ name: divisions.name }).from(divisions).where(eq(divisions.id, d.id));
        /* The team and category links are cleared HERE, not left to the
           cascade: Postgres re-checks a foreign key on a row changed earlier in
           the same transaction, and the team is being deleted in this very
           statement, so the cascade refused it. The note keeps the name. */
        const withdrawn = {
          status: "withdrawn" as const, decidedAt: new Date(), teamId: null, divisionId: null,
          note: `Its category, ${name?.name ?? "a category"}, was removed.`,
        };
        if (squadIds.length > 0) {
          await tx
            .update(registrations)
            .set(withdrawn)
            .where(and(eq(registrations.tournamentId, t.id), eq(registrations.status, "approved"), inArray(registrations.teamId, squadIds)));
        }
        if (waiting.length > 0) await tx.update(registrations).set(withdrawn).where(waitingHere);
        if (squadIds.length > 0) await tx.delete(players).where(inArray(players.teamId, squadIds));
      }
      await tx.delete(divisions).where(eq(divisions.id, d.id));
      return null;
    });
  } catch (e) {
    if (!(e instanceof DrawChanged)) throw e;
    problem = "category-changed";
  }
  refresh(t.slug);
  /* Outside the try: redirect() works by throwing. */
  if (problem) redirect(`/t/${t.slug}/manage/registration?problem=${problem}&category=${encodeURIComponent(divisionId)}`);
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
  /* Scoped to THIS event: `requireManager` proved the caller manages the
     tournament in the URL, which says nothing about an entry id sent with it. */
  const res = await approveRegistration(registrationId, t.ownerId, { tournamentId: t.id });
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
  const res = await setRegistrationStatus(registrationId, "declined", note, { tournamentId: t.id });
  refresh(t.slug);
  return res.ok ? { ok: true } : res;
}

export async function markPayment(
  tournamentId: string,
  registrationId: string,
  state: "unpaid" | "paid" | "waived",
): Promise<DecisionResult> {
  const t = await requireManager(tournamentId);
  const res = await setPaymentState(registrationId, state, { tournamentId: t.id });
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
