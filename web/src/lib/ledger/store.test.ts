import { describe, it, expect, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";
import type { EntryInput, PaymentInput } from "./store";

/* The money maths lives in lib/finance and has its own tests. These are about
 * the seam: that a book loads into exactly the shape that engine takes, that
 * the rules which make an expense meaningful are enforced on the DATA rather
 * than only in a form, and that a payment cannot move a balance until the
 * person who was paid says it happened. */
const client = new PGlite();
const testDb = drizzle(client, { schema });

vi.mock("@/lib/db", () => ({ db: testDb }));
vi.mock("server-only", () => ({}));

const dir = path.resolve(process.cwd(), "drizzle");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

const s = await import("./store");
const { ledgerBalances, ledgerMoney } = await import("@/lib/finance");

const DATE = "2026-09-18";
let slug: string;
let ids: Record<string, string>;

async function book(members = ["You", "Nadeem", "Sumit"]) {
  await testDb.delete(schema.ledgerBooks);
  const res = await s.createBook("Thursday Court", members);
  if (!res.ok) throw new Error(res.error);
  const loaded = (await s.loadBook(res.id!, null))!;
  ids = Object.fromEntries(loaded.members.map((m) => [m.name, m.id]));
  return res.id!;
}

const entry = (over: Partial<EntryInput> = {}): EntryInput => ({
  amount: 90000, payerId: ids.You, participantIds: Object.values(ids),
  type: "COURT_BOOKING", note: "Court", venue: "Smash Arena", date: DATE, ...over,
});

beforeEach(async () => { slug = await book(); });

describe("creating a book", () => {
  it("seeds the members it was given", async () => {
    const loaded = (await s.loadBook(slug, null))!;
    expect(loaded.members.map((m) => m.name)).toEqual(["You", "Nadeem", "Sumit"]);
  });

  it("refuses a book with no name or no members", async () => {
    expect((await s.createBook("x", ["A"])).ok).toBe(false);
    expect((await s.createBook("Fine name", [])).ok).toBe(false);
  });

  it("does not collide when two books share a name", async () => {
    const again = await s.createBook("Thursday Court", ["A"]);
    expect(again.ok && again.id).not.toBe(slug);
  });

  it("adds a member afterwards, at the end", async () => {
    const loaded = (await s.loadBook(slug, null))!;
    await s.addMember(loaded.row.id, "Kautubh");
    const after = (await s.loadBook(slug, null))!;
    expect(after.members.map((m) => m.name)).toEqual(["You", "Nadeem", "Sumit", "Kautubh"]);
  });
});

describe("the book loads into the shape lib/finance takes", () => {
  it("marks whose side it is read from", async () => {
    const loaded = (await s.loadBook(slug, ids.Nadeem))!;
    expect(loaded.book.members.find((m) => m.me)?.name).toBe("Nadeem");
  });

  it("falls back to the first member rather than nobody", async () => {
    /* A book with no "you" shows every number as a stranger's. */
    const loaded = (await s.loadBook(slug, "not-a-member"))!;
    expect(loaded.book.members.find((m) => m.me)?.name).toBe("You");
  });

  it("is null for a book that does not exist", async () => {
    expect(await s.loadBook("no-such-book", null)).toBeNull();
  });
});

describe("what an expense must have", () => {
  const memberIds = () => Object.values(ids);

  it("needs an amount above zero", () => {
    expect(s.entryProblems(entry({ amount: 0 }), memberIds())[0]).toContain("above zero");
    expect(s.entryProblems(entry({ amount: -5 }), memberIds())[0]).toContain("above zero");
  });

  it("needs somebody to split between", () => {
    expect(s.entryProblems(entry({ participantIds: [] }), memberIds())[0]).toContain("at least one");
  });

  it("needs a payer", () => {
    expect(s.entryProblems(entry({ payerId: "" }), memberIds())[0]).toContain("who paid");
  });

  it("refuses a payer or participant from another book", async () => {
    expect(s.entryProblems(entry({ payerId: "someone-else" }), memberIds()).join()).toContain("not in this book");
    expect(s.entryProblems(entry({ participantIds: ["outsider"] }), memberIds()).join()).toContain("not in this book");
  });

  it("passes a complete one", () => {
    expect(s.entryProblems(entry(), memberIds())).toEqual([]);
  });

  it("is enforced on save, not just in the form", async () => {
    const loaded = (await s.loadBook(slug, null))!;
    expect((await s.saveEntry(loaded.row.id, entry({ amount: 0 }))).ok).toBe(false);
    expect(await testDb.select().from(schema.ledgerEntries)).toHaveLength(0);
  });
});

describe("entries", () => {
  let bookId: string;
  beforeEach(async () => { bookId = (await s.loadBook(slug, null))!.row.id; });

  it("splits ₹900 three ways with no paise lost", async () => {
    await s.saveEntry(bookId, entry({ amount: 90000 }));
    const loaded = (await s.loadBook(slug, ids.You))!;
    const bal = ledgerBalances(loaded.book);

    /* You paid 900 and owe 300, so you are owed 600; the other two owe 300. */
    expect(bal[ids.You]).toBe(60000);
    expect(bal[ids.Nadeem]).toBe(-30000);
    expect(bal[ids.Sumit]).toBe(-30000);
    expect(Object.values(bal).reduce((a, b) => a + b, 0)).toBe(0);
  });

  it("gives the odd paise to the payer, so the book sums exactly", async () => {
    /* ₹1000 three ways is 33333 + 33333 + 33334. */
    await s.saveEntry(bookId, entry({ amount: 100000 }));
    const loaded = (await s.loadBook(slug, null))!;
    const bal = ledgerBalances(loaded.book);
    expect(Object.values(bal).reduce((a, b) => a + b, 0)).toBe(0);
    expect(bal[ids.You]).toBe(100000 - 33334);
  });

  it("edits in place rather than adding a second one", async () => {
    const created = await s.saveEntry(bookId, entry({ amount: 90000 }));
    await s.saveEntry(bookId, entry({ amount: 60000, note: "Corrected" }), created.ok ? created.id : undefined);

    const rows = await testDb.select().from(schema.ledgerEntries);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(60000);
    expect(rows[0].note).toBe("Corrected");
  });

  it("will not edit an entry belonging to another book", async () => {
    const created = await s.saveEntry(bookId, entry());
    const other = await s.createBook("Other Book", ["X", "Y"]);
    const otherId = (await s.loadBook(other.ok ? other.id! : "", null))!.row.id;

    const res = await s.saveEntry(otherId, entry({ payerId: "", amount: 1 }), created.ok ? created.id : undefined);
    expect(res.ok).toBe(false);
  });

  it("deletes, and the balances follow", async () => {
    const created = await s.saveEntry(bookId, entry({ amount: 90000 }));
    await s.deleteEntry(bookId, created.ok ? created.id! : "");

    const loaded = (await s.loadBook(slug, null))!;
    expect(loaded.entries).toHaveLength(0);
    expect(Object.values(ledgerBalances(loaded.book)).every((v) => v === 0)).toBe(true);
  });

  it("will not delete another book's entry", async () => {
    const created = await s.saveEntry(bookId, entry());
    const other = await s.createBook("Other Book 2", ["X"]);
    const otherId = (await s.loadBook(other.ok ? other.id! : "", null))!.row.id;
    expect((await s.deleteEntry(otherId, created.ok ? created.id! : "")).ok).toBe(false);
    expect(await testDb.select().from(schema.ledgerEntries)).toHaveLength(1);
  });
});

describe("payments need the recipient to agree", () => {
  let bookId: string;
  beforeEach(async () => {
    bookId = (await s.loadBook(slug, null))!.row.id;
    await s.saveEntry(bookId, entry({ amount: 90000 }));   // Nadeem owes You 300
  });

  const pay = (over: Partial<PaymentInput> = {}): PaymentInput => ({
    fromId: ids.Nadeem, toId: ids.You, amount: 30000, method: "UPI", note: "", ...over,
  });

  it("lands as pending", async () => {
    await s.recordPayment(bookId, pay());
    const [row] = await testDb.select().from(schema.ledgerPayments);
    expect(row.status).toBe("PENDING");
  });

  it("does NOT move a balance while pending", async () => {
    /* The whole point: one side cannot clear a debt by asserting they paid. */
    const before = ledgerBalances((await s.loadBook(slug, null))!.book);
    await s.recordPayment(bookId, pay());
    const after = ledgerBalances((await s.loadBook(slug, null))!.book);
    expect(after).toEqual(before);
  });

  it("moves it once the recipient confirms", async () => {
    const res = await s.recordPayment(bookId, pay());
    await s.decidePayment(bookId, res.ok ? res.id! : "", true);

    const bal = ledgerBalances((await s.loadBook(slug, null))!.book);
    expect(bal[ids.Nadeem]).toBe(0);
    expect(bal[ids.You]).toBe(30000);
  });

  it("leaves it alone when the recipient rejects it", async () => {
    const res = await s.recordPayment(bookId, pay());
    await s.decidePayment(bookId, res.ok ? res.id! : "", false);

    const bal = ledgerBalances((await s.loadBook(slug, null))!.book);
    expect(bal[ids.Nadeem]).toBe(-30000);
  });

  it("refuses a payment to yourself", async () => {
    const res = await s.recordPayment(bookId, pay({ toId: ids.Nadeem }));
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("two different people");
  });

  it("refuses a zero or negative amount", async () => {
    expect((await s.recordPayment(bookId, pay({ amount: 0 }))).ok).toBe(false);
    expect((await s.recordPayment(bookId, pay({ amount: -100 }))).ok).toBe(false);
  });

  it("refuses somebody who is not in the book", async () => {
    expect((await s.recordPayment(bookId, pay({ toId: "outsider" }))).ok).toBe(false);
  });
});

describe("settling up", () => {
  it("squares everyone off when its plan is applied", async () => {
    const bookId = (await s.loadBook(slug, null))!.row.id;
    await s.saveEntry(bookId, entry({ amount: 90000, payerId: ids.You }));
    await s.saveEntry(bookId, entry({ amount: 30000, payerId: ids.Nadeem }));

    const loaded = (await s.loadBook(slug, null))!;
    const { settleUp } = s.balancesOf(loaded);
    expect(settleUp.length).toBeGreaterThan(0);

    for (const t of settleUp) {
      const res = await s.recordPayment(bookId, {
        fromId: t.from, toId: t.to, amount: t.amount, method: "UPI", note: "",
      });
      await s.decidePayment(bookId, res.ok ? res.id! : "", true);
    }

    const after = ledgerBalances((await s.loadBook(slug, null))!.book);
    for (const [id, v] of Object.entries(after)) expect(v, id).toBe(0);
  });

  it("needs no transfers when nobody owes anything", async () => {
    const loaded = (await s.loadBook(slug, null))!;
    expect(s.balancesOf(loaded).settleUp).toEqual([]);
  });
});

describe("which way round a debt points", () => {
  /* The screen briefly said "You owes Nadeem ₹300" directly above a settle-up
     row reading "Nadeem pays You ₹300". Both came from the same data; only the
     sign convention was read wrong. `ledgerNet(m, a, b)` is how much A OWES B,
     so a POSITIVE net makes A the debtor.

     Pinned here because it is invisible in any test that only checks amounts. */
  it("agrees with the settle-up plan about who pays whom", async () => {
    const bookId = (await s.loadBook(slug, null))!.row.id;
    await s.saveEntry(bookId, entry({ amount: 90000, payerId: ids.You }));

    const loaded = (await s.loadBook(slug, ids.You))!;
    const { pairs, settleUp, balances } = s.balancesOf(loaded);

    /* You paid, so You are owed and the other two are the debtors. */
    expect(balances[ids.You]).toBeGreaterThan(0);

    for (const p of pairs.filter((x) => x.net !== 0)) {
      const debtor = p.net > 0 ? p.a : p.b;
      const creditor = p.net > 0 ? p.b : p.a;

      expect(balances[debtor], "a debtor's balance is negative").toBeLessThan(0);
      expect(balances[creditor], "a creditor's balance is positive").toBeGreaterThan(0);

      /* And the settle-up plan must move money the SAME way. */
      const matching = settleUp.filter((t) => t.from === debtor && t.to === creditor);
      expect(matching.length, `settle-up should send ${debtor} -> ${creditor}`).toBeGreaterThan(0);
      expect(settleUp.some((t) => t.from === creditor && t.to === debtor)).toBe(false);
    }
  });

  it("points the other way when somebody else pays", async () => {
    const bookId = (await s.loadBook(slug, null))!.row.id;
    await s.saveEntry(bookId, entry({ amount: 90000, payerId: ids.Nadeem }));

    const loaded = (await s.loadBook(slug, null))!;
    const { pairs, balances } = s.balancesOf(loaded);
    expect(balances[ids.Nadeem]).toBeGreaterThan(0);

    const pair = pairs.find((p) => (p.a === ids.You && p.b === ids.Nadeem) || (p.a === ids.Nadeem && p.b === ids.You))!;
    const debtor = pair.net > 0 ? pair.a : pair.b;
    expect(debtor, "You owe Nadeem now").toBe(ids.You);
  });
});

describe("the book list", () => {
  it("counts members and entries, and shows your own balance", async () => {
    const bookId = (await s.loadBook(slug, null))!.row.id;
    await s.saveEntry(bookId, entry({ amount: 90000 }));

    const [card] = await s.listBooks();
    expect(card.memberCount).toBe(3);
    expect(card.entryCount).toBe(1);
    expect(ledgerMoney(card.myBalance)).toBe(ledgerMoney(60000));
  });
});

describe("deleting a book", () => {
  it("takes its members, entries and payments with it", async () => {
    const bookId = (await s.loadBook(slug, null))!.row.id;
    await s.saveEntry(bookId, entry());
    await s.recordPayment(bookId, { fromId: ids.Nadeem, toId: ids.You, amount: 100, method: "CASH", note: "" });

    await testDb.delete(schema.ledgerBooks).where(eq(schema.ledgerBooks.id, bookId));

    expect(await testDb.select().from(schema.ledgerMembers)).toHaveLength(0);
    expect(await testDb.select().from(schema.ledgerEntries)).toHaveLength(0);
    expect(await testDb.select().from(schema.ledgerPayments)).toHaveLength(0);
  });
});
