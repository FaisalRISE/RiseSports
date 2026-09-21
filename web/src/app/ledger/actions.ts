"use server";

/* Server Actions for the Court Ledger.
 *
 * Every one re-reads the book and scopes its write to it, so an id from another
 * book cannot be edited through this one. There is no sign-in yet, so these do
 * not attempt per-member authorisation — the book is shared by the group that
 * keeps it, which is how the legacy app works. What they DO enforce is the
 * rules that make the numbers mean something: an expense needs an amount, a
 * payer and somebody to split between, and a payment needs the recipient to
 * confirm it before it moves a balance.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import * as store from "@/lib/ledger/store";
import { ledgerPaise } from "@/lib/finance";
import { todayInIndia } from "@/lib/eligibility";
import type { LedgerEntryType, LedgerPaymentMethod } from "@/lib/db/schema";

export type LedgerActionResult = { ok: true; id?: string } | { ok: false; error: string };
const fail = (error: string): LedgerActionResult => ({ ok: false, error });

const slugSchema = z.string().trim().min(1).max(80);
const idSchema = z.string().trim().min(1).max(64);
const moneySchema = z.union([z.string(), z.number()]);

/** Rupees from a form become integer paise. Never a float past this line. */
const toPaise = (v: unknown): number => ledgerPaise(v as string | number);

async function bookIdFor(slug: string): Promise<string | null> {
  const parsed = slugSchema.safeParse(slug);
  if (!parsed.success) return null;
  const loaded = await store.loadBook(parsed.data, null);
  return loaded?.row.id ?? null;
}

/* ── Books ────────────────────────────────────────────────────────────────*/

export async function createBookAction(formData: FormData): Promise<never> {
  const name = z.string().trim().min(2).max(80).safeParse(formData.get("name"));
  if (!name.success) redirect("/ledger?error=" + encodeURIComponent("Give the book a name."));

  const members = String(formData.get("members") ?? "")
    .split(/[\n,]/)
    .map((m) => m.trim())
    .filter(Boolean);

  const res = await store.createBook(name.data, members.length ? members : ["You"]);
  if (!res.ok) redirect("/ledger?error=" + encodeURIComponent(res.error));

  revalidatePath("/ledger");
  redirect(`/ledger/${res.id}`);
}

export async function addMemberAction(slug: string, name: string): Promise<LedgerActionResult> {
  const bookId = await bookIdFor(slug);
  if (!bookId) return fail("No such book.");

  const res = await store.addMember(bookId, name);
  revalidatePath(`/ledger/${slug}`);
  return res;
}

/* ── Entries ──────────────────────────────────────────────────────────────*/

const TYPES = ["COURT_BOOKING", "EQUIPMENT", "FOOD_DRINKS", "OTHER"] as const;

const entrySchema = z.object({
  amount: moneySchema,
  payerId: idSchema,
  participantIds: z.array(idSchema).min(1, "Tick at least one person."),
  type: z.enum(TYPES),
  note: z.string().trim().max(120).catch(""),
  venue: z.string().trim().max(80).catch(""),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).catch(() => todayInIndia()),
});

export async function saveEntryAction(
  slug: string,
  input: {
    amount: string | number; payerId: string; participantIds: string[];
    type: string; note: string; venue: string; date: string;
  },
  entryId?: string,
): Promise<LedgerActionResult> {
  const bookId = await bookIdFor(slug);
  if (!bookId) return fail("No such book.");

  const parsed = entrySchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Check the entry.");

  const id = entryId ? idSchema.safeParse(entryId) : null;
  if (entryId && !id?.success) return fail("Bad request.");

  const res = await store.saveEntry(
    bookId,
    {
      amount: toPaise(parsed.data.amount),
      payerId: parsed.data.payerId,
      participantIds: parsed.data.participantIds,
      type: parsed.data.type as LedgerEntryType,
      note: parsed.data.note,
      venue: parsed.data.venue,
      date: parsed.data.date,
    },
    id?.success ? id.data : undefined,
  );

  revalidatePath(`/ledger/${slug}`);
  revalidatePath("/ledger");
  return res;
}

export async function deleteEntryAction(slug: string, entryId: string): Promise<LedgerActionResult> {
  const bookId = await bookIdFor(slug);
  const id = idSchema.safeParse(entryId);
  if (!bookId || !id.success) return fail("Bad request.");

  const res = await store.deleteEntry(bookId, id.data);
  revalidatePath(`/ledger/${slug}`);
  revalidatePath("/ledger");
  return res;
}

/* ── Payments ─────────────────────────────────────────────────────────────*/

const METHODS = ["UPI", "CASH", "BANK"] as const;

export async function recordPaymentAction(
  slug: string,
  input: { fromId: string; toId: string; amount: string | number; method: string; note: string },
): Promise<LedgerActionResult> {
  const bookId = await bookIdFor(slug);
  if (!bookId) return fail("No such book.");

  const parsed = z
    .object({
      fromId: idSchema, toId: idSchema, amount: moneySchema,
      method: z.enum(METHODS), note: z.string().trim().max(120).catch(""),
    })
    .safeParse(input);
  if (!parsed.success) return fail("Check the payment.");

  const res = await store.recordPayment(bookId, {
    fromId: parsed.data.fromId,
    toId: parsed.data.toId,
    amount: toPaise(parsed.data.amount),
    method: parsed.data.method as LedgerPaymentMethod,
    note: parsed.data.note,
  });

  revalidatePath(`/ledger/${slug}`);
  return res;
}

/**
 * Confirm or reject a payment.
 *
 * Only a confirmed payment moves a balance, which is what stops one side
 * clearing a debt on their own. With no sign-in there is nothing to check that
 * the confirmer IS the recipient — the screen only offers the button on
 * payments made TO whoever the book is being read as, and that is a convention
 * rather than a guarantee until sign-in lands.
 */
export async function decidePaymentAction(
  slug: string, paymentId: string, confirm: boolean,
): Promise<LedgerActionResult> {
  const bookId = await bookIdFor(slug);
  const id = idSchema.safeParse(paymentId);
  if (!bookId || !id.success) return fail("Bad request.");

  const res = await store.decidePayment(bookId, id.data, !!confirm);
  revalidatePath(`/ledger/${slug}`);
  revalidatePath("/ledger");
  return res;
}

/* ── Whose side the book reads from ───────────────────────────────────────*/

const ME_COOKIE = (bookId: string) => `rs_ledger_me_${bookId}`;

/**
 * "Switch to their side" — the standing-in mechanism from the legacy app.
 *
 * A VIEW, not a permission: it changes whose number the hero card shows, not
 * what anyone may do. Per book, so standing in as Nadeem in one does not carry
 * into another.
 */
export async function viewAsAction(slug: string, memberId: string): Promise<LedgerActionResult> {
  const bookId = await bookIdFor(slug);
  const id = idSchema.safeParse(memberId);
  if (!bookId || !id.success) return fail("Bad request.");

  const { cookies } = await import("next/headers");
  const jar = await cookies();
  jar.set(ME_COOKIE(bookId), id.data, {
    httpOnly: true, sameSite: "lax", path: "/",
    maxAge: 60 * 60 * 24 * 365,
    secure: process.env.NODE_ENV === "production",
  });

  revalidatePath(`/ledger/${slug}`);
  return { ok: true };
}

/** Server-side read of the same cookie, for the page. */
export async function currentMemberId(bookId: string): Promise<string | null> {
  const { cookies } = await import("next/headers");
  return (await cookies()).get(ME_COOKIE(bookId))?.value ?? null;
}
