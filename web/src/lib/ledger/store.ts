import "server-only";

/* The Court Ledger's database side.
 *
 * ── The one job of this file ──────────────────────────────────────────────
 * `lib/finance` already holds the money engine, ported from the standalone
 * ledger app and pinned by tests: the equal split with the odd paise going to
 * the payer, the who-owes-whom netting, the per-member balances, and the
 * minimum-transfer settle-up. None of that is touched here.
 *
 * So `loadBook` returns exactly the `LedgerBook` shape that engine already
 * takes, and every calculation below is a call into it. If a balance is ever
 * wrong, it is wrong in `lib/finance` and its own tests will say so — there is
 * no second implementation to check.
 *
 * Legacy source: LedgerTab (app.source.js:12544+), which kept the same book
 * object in localStorage under `rs_ledger`.
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  ledgerBooks, ledgerEntries, ledgerMembers, ledgerPayments,
  type LedgerBookRow, type LedgerEntryType, type LedgerMemberRow,
  type LedgerPaymentMethod,
} from "@/lib/db/schema";
import {
  ledgerBalances, ledgerPairs, ledgerSettleUp,
  type LedgerBook, type Transfer,
} from "@/lib/finance";
import { slugifyGame } from "@/lib/community";
import { todayInIndia } from "@/lib/eligibility";

export type LedgerResult = { ok: true; id?: string } | { ok: false; error: string };
const no = (error: string): LedgerResult => ({ ok: false, error });

/* ── Loading ──────────────────────────────────────────────────────────────*/

export type LoadedBook = {
  row: LedgerBookRow;
  /** The shape lib/finance takes. `me` marks whose side the book reads from. */
  book: LedgerBook;
  members: LedgerMemberRow[];
  entries: (typeof ledgerEntries.$inferSelect)[];
  payments: (typeof ledgerPayments.$inferSelect)[];
};

/**
 * One book, assembled for the engine.
 *
 * `meId` decides whose side the book is read from — the "you" in "you are owed
 * ₹450". It is a VIEW, not a permission: anyone looking at the book can switch
 * to any member, which is how the legacy app works too and is enough to see
 * the book from every angle while there is no sign-in.
 */
export async function loadBook(slug: string, meId: string | null): Promise<LoadedBook | null> {
  const [row] = await db.select().from(ledgerBooks).where(eq(ledgerBooks.slug, slug)).limit(1);
  if (!row) return null;

  const [members, entries, payments] = await Promise.all([
    db.select().from(ledgerMembers).where(eq(ledgerMembers.bookId, row.id))
      .orderBy(asc(ledgerMembers.position), asc(ledgerMembers.createdAt)),
    db.select().from(ledgerEntries).where(eq(ledgerEntries.bookId, row.id))
      .orderBy(desc(ledgerEntries.date), desc(ledgerEntries.createdAt)),
    db.select().from(ledgerPayments).where(eq(ledgerPayments.bookId, row.id))
      .orderBy(desc(ledgerPayments.createdAt)),
  ]);

  return assemble(row, members, entries, payments, meId);
}

/* Rows into the shape lib/finance takes. One place, used by the one-book page
   and by the list, so the list can never become a second way of building a book
   that disagrees with the book's own page. */
function assemble(
  row: LedgerBookRow,
  members: LedgerMemberRow[],
  entries: LoadedBook["entries"],
  payments: LoadedBook["payments"],
  meId: string | null,
): LoadedBook {
  /* Fall back to the first member so the book always reads from somebody's
     side — a ledger with no "you" shows every number as a stranger's. */
  const me = members.find((m) => m.id === meId) ?? members[0];

  return {
    row,
    members,
    entries,
    payments,
    book: {
      id: row.id,
      name: row.name,
      members: members.map((m) => ({ id: m.id, name: m.name, me: m.id === me?.id })),
      activities: entries.map((e) => ({
        id: e.id,
        amount: e.amount,
        payerId: e.payerId,
        participantIds: e.participantIds,
        type: e.type,
        note: e.note,
        date: e.date,
      })),
      payments: payments.map((p) => ({
        id: p.id,
        fromId: p.fromId,
        toId: p.toId,
        amount: p.amount,
        status: p.status,
        date: p.date,
      })),
    },
  };
}

/**
 * Every open book, with its counts and your balance.
 *
 * Four queries however many books there are. It used to call `loadBook` for
 * every book with all of them fired together — about four queries per book —
 * and on the transaction pooler anything past eight concurrent queries
 * pipelines on one socket and wedges the whole instance, which is what took the
 * site down on 2026-09-15. Three books would have done it again. The only
 * reason it had not was that nobody had made a third book yet.
 *
 * So the rows for every book arrive in three queries, grouped in memory. The
 * global ORDER BY carries through: grouping keeps each book's rows in the order
 * they came, which is the same order `loadBook` asks for. The balance is still
 * computed by lib/finance and nowhere else.
 */
export async function listBooks(): Promise<
  { row: LedgerBookRow; memberCount: number; entryCount: number; myBalance: number }[]
> {
  const rows = await db
    .select()
    .from(ledgerBooks)
    .where(isNull(ledgerBooks.archivedAt))
    .orderBy(desc(ledgerBooks.createdAt));
  if (rows.length === 0) return [];

  const ids = rows.map((r) => r.id);
  const [members, entries, payments] = await Promise.all([
    db.select().from(ledgerMembers).where(inArray(ledgerMembers.bookId, ids))
      .orderBy(asc(ledgerMembers.position), asc(ledgerMembers.createdAt)),
    db.select().from(ledgerEntries).where(inArray(ledgerEntries.bookId, ids))
      .orderBy(desc(ledgerEntries.date), desc(ledgerEntries.createdAt)),
    db.select().from(ledgerPayments).where(inArray(ledgerPayments.bookId, ids))
      .orderBy(desc(ledgerPayments.createdAt)),
  ]);

  const membersOf = byBook(members);
  const entriesOf = byBook(entries);
  const paymentsOf = byBook(payments);

  return rows.map((row) => {
    const loaded = assemble(
      row, membersOf.get(row.id) ?? [], entriesOf.get(row.id) ?? [], paymentsOf.get(row.id) ?? [], null,
    );
    const balances = ledgerBalances(loaded.book);
    const me = loaded.book.members.find((m) => m.me);
    return {
      row,
      memberCount: loaded.members.length,
      entryCount: loaded.entries.length,
      myBalance: me ? balances[me.id] ?? 0 : 0,
    };
  });
}

function byBook<T extends { bookId: string }>(rows: T[]): Map<string, T[]> {
  const out = new Map<string, T[]>();
  for (const r of rows) {
    const list = out.get(r.bookId);
    if (list) list.push(r);
    else out.set(r.bookId, [r]);
  }
  return out;
}

/* Everything the Balances tab shows, all of it from lib/finance. */
export function balancesOf(loaded: LoadedBook) {
  return {
    balances: ledgerBalances(loaded.book),
    pairs: ledgerPairs(loaded.book),
    settleUp: ledgerSettleUp(loaded.book) as Transfer[],
    pending: loaded.payments.filter((p) => p.status === "PENDING"),
  };
}

/* ── Books ────────────────────────────────────────────────────────────────*/

export async function createBook(name: string, memberNames: string[]): Promise<LedgerResult> {
  const trimmed = name.trim().slice(0, 80);
  if (trimmed.length < 2) return no("Give the book a name.");

  const names = memberNames.map((n) => n.trim()).filter(Boolean).slice(0, 50);
  if (names.length === 0) return no("A book needs at least one member.");

  let slug = slugifyGame(trimmed);
  const taken = await db.select({ slug: ledgerBooks.slug }).from(ledgerBooks).where(eq(ledgerBooks.slug, slug));
  if (taken.length) slug = `${slug}-${randomUUID().slice(0, 4)}`;

  const bookId = randomUUID();
  await db.transaction(async (tx) => {
    await tx.insert(ledgerBooks).values({ id: bookId, slug, name: trimmed });
    await tx.insert(ledgerMembers).values(
      names.map((n, i) => ({ id: randomUUID(), bookId, name: n, position: i })),
    );
  });

  return { ok: true, id: slug };
}

export async function addMember(bookId: string, name: string): Promise<LedgerResult> {
  const trimmed = name.trim().slice(0, 60);
  if (!trimmed) return no("Give them a name.");

  const existing = await db
    .select({ position: ledgerMembers.position })
    .from(ledgerMembers)
    .where(eq(ledgerMembers.bookId, bookId));

  await db.insert(ledgerMembers).values({
    id: randomUUID(),
    bookId,
    name: trimmed,
    position: existing.reduce((m, r) => Math.max(m, r.position), -1) + 1,
  });
  return { ok: true };
}

/* ── Entries ──────────────────────────────────────────────────────────────*/

export type EntryInput = {
  amount: number;
  payerId: string;
  participantIds: string[];
  type: LedgerEntryType;
  note: string;
  venue: string;
  date: string;
};

/**
 * The three things that make an expense meaningless if wrong.
 *
 * Ported from the legacy `canSave` guard: an amount above zero, somebody to
 * split it between, and somebody who paid. Kept here rather than only in the
 * form, because a form is one caller and the rule is about the data.
 */
export function entryProblems(input: EntryInput, memberIds: string[]): string[] {
  const out: string[] = [];
  if (!Number.isInteger(input.amount) || input.amount <= 0) out.push("Enter an amount above zero.");
  if (input.participantIds.length === 0) out.push("Tick at least one person to split it between.");
  if (!input.payerId) out.push("Choose who paid.");

  const known = new Set(memberIds);
  if (input.payerId && !known.has(input.payerId)) out.push("That payer is not in this book.");
  if (input.participantIds.some((id) => !known.has(id))) out.push("Somebody in the split is not in this book.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date)) out.push("Pick a date.");
  return out;
}

export async function saveEntry(
  bookId: string, input: EntryInput, entryId?: string,
): Promise<LedgerResult> {
  const members = await db
    .select({ id: ledgerMembers.id })
    .from(ledgerMembers)
    .where(eq(ledgerMembers.bookId, bookId));

  const problems = entryProblems(input, members.map((m) => m.id));
  if (problems.length) return no(problems[0]);

  const values = {
    bookId,
    amount: input.amount,
    payerId: input.payerId,
    participantIds: input.participantIds,
    type: input.type,
    note: input.note.trim().slice(0, 120),
    venue: input.venue.trim().slice(0, 80),
    date: input.date,
  };

  if (entryId) {
    /* Scoped to the book, so an id from another book cannot be edited. */
    const res = await db
      .update(ledgerEntries)
      .set(values)
      .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.bookId, bookId)))
      .returning({ id: ledgerEntries.id });
    return res.length ? { ok: true, id: entryId } : no("No such entry.");
  }

  const id = randomUUID();
  await db.insert(ledgerEntries).values({ id, ...values });
  return { ok: true, id };
}

export async function deleteEntry(bookId: string, entryId: string): Promise<LedgerResult> {
  const res = await db
    .delete(ledgerEntries)
    .where(and(eq(ledgerEntries.id, entryId), eq(ledgerEntries.bookId, bookId)))
    .returning({ id: ledgerEntries.id });
  return res.length ? { ok: true } : no("No such entry.");
}

/* ── Payments ─────────────────────────────────────────────────────────────*/

export type PaymentInput = {
  fromId: string;
  toId: string;
  amount: number;
  method: LedgerPaymentMethod;
  note: string;
};

export function paymentProblems(input: PaymentInput, memberIds: string[]): string[] {
  const out: string[] = [];
  if (!Number.isInteger(input.amount) || input.amount <= 0) out.push("Enter an amount above zero.");
  if (!input.fromId || !input.toId) out.push("Choose who paid and who was paid.");
  else if (input.fromId === input.toId) out.push("A payment needs two different people.");

  const known = new Set(memberIds);
  if (input.fromId && !known.has(input.fromId)) out.push("That payer is not in this book.");
  if (input.toId && !known.has(input.toId)) out.push("That recipient is not in this book.");
  return out;
}

/**
 * Record money handed over.
 *
 * Lands as PENDING. Only the RECIPIENT confirming it moves a balance, so one
 * side cannot clear a debt by asserting they paid — the same rule the legacy
 * app has, and the reason `ledgerOwedMap` counts only CONFIRMED payments.
 */
export async function recordPayment(bookId: string, input: PaymentInput): Promise<LedgerResult> {
  const members = await db
    .select({ id: ledgerMembers.id })
    .from(ledgerMembers)
    .where(eq(ledgerMembers.bookId, bookId));

  const problems = paymentProblems(input, members.map((m) => m.id));
  if (problems.length) return no(problems[0]);

  const id = randomUUID();
  await db.insert(ledgerPayments).values({
    id,
    bookId,
    fromId: input.fromId,
    toId: input.toId,
    amount: input.amount,
    method: input.method,
    note: input.note.trim().slice(0, 120),
    status: "PENDING",
    /* India's date: the server runs in UTC and is a day behind until 05:30. */
    date: todayInIndia(),
  });
  return { ok: true, id };
}

export async function decidePayment(
  bookId: string, paymentId: string, confirm: boolean,
): Promise<LedgerResult> {
  const res = await db
    .update(ledgerPayments)
    .set({ status: confirm ? "CONFIRMED" : "REJECTED", confirmedAt: new Date() })
    .where(and(eq(ledgerPayments.id, paymentId), eq(ledgerPayments.bookId, bookId)))
    .returning({ id: ledgerPayments.id });
  return res.length ? { ok: true } : no("No such payment.");
}
