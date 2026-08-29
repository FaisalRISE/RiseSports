import { describe, it, expect } from "vitest";
import {
  ledgerShares, ledgerBalances, ledgerSettleUp, ledgerPairs, ledgerMoney, ledgerPaise,
  type LedgerBook,
} from "./index";

const book = (
  members: string[],
  activities: LedgerBook["activities"],
  payments: LedgerBook["payments"] = [],
): LedgerBook => ({
  id: "b", name: "Book",
  members: members.map((id) => ({ id, name: id.toUpperCase() })),
  activities, payments,
});

const sum = (o: Record<string, number>) => Object.values(o).reduce((s, v) => s + v, 0);

/** Apply a settle-up plan as confirmed payments and re-balance. */
const afterSettle = (b: LedgerBook) => {
  const plan = ledgerSettleUp(b);
  const settled: LedgerBook = {
    ...b,
    payments: [
      ...b.payments,
      ...plan.map((t, i) => ({ id: `s${i}`, fromId: t.from, toId: t.to, amount: t.amount, status: "CONFIRMED" as const })),
    ],
  };
  return ledgerBalances(settled);
};

describe("paise invariants", () => {
  it("a 3-way split of ₹1000 is 33333+33333+33334, odd paise to the payer", () => {
    const b = book(["a", "b", "c"], [
      { id: "x", amount: ledgerPaise(1000), payerId: "a", participantIds: ["a", "b", "c"] },
    ]);
    const s = ledgerShares(b, b.activities[0]);
    expect(sum(s)).toBe(100000);
    expect(s.a).toBe(33334); // payer carries the remainder
    expect(s.b).toBe(33333);
    expect(s.c).toBe(33333);
  });

  it("shares always sum to exactly the amount spent, for any split", () => {
    for (let n = 1; n <= 9; n++) {
      for (const rupees of [1, 7, 99.99, 1000, 1234.56]) {
        const ids = Array.from({ length: n }, (_, i) => `p${i}`);
        const amount = ledgerPaise(rupees);
        const b = book(ids, [{ id: "x", amount, payerId: "p0", participantIds: ids }]);
        expect(sum(ledgerShares(b, b.activities[0]))).toBe(amount);
      }
    }
  });

  it("remainder spreads across participants when the payer is not one of them", () => {
    const b = book(["a", "b", "c", "d"], [
      { id: "x", amount: 100, payerId: "d", participantIds: ["a", "b", "c"] },
    ]);
    const s = ledgerShares(b, b.activities[0]);
    expect(sum(s)).toBe(100);
    expect(s.d).toBeUndefined();
  });

  it("ignores participants who are not members of the book", () => {
    const b = book(["a", "b"], [
      { id: "x", amount: 100, payerId: "a", participantIds: ["a", "b", "ghost"] },
    ]);
    const s = ledgerShares(b, b.activities[0]);
    expect(Object.keys(s).sort()).toEqual(["a", "b"]);
    expect(sum(s)).toBe(100);
  });

  it("an activity with no valid participants splits nothing", () => {
    const b = book(["a"], [{ id: "x", amount: 500, payerId: "a", participantIds: [] }]);
    expect(ledgerShares(b, b.activities[0])).toEqual({});
  });
});

describe("balances and settle-up", () => {
  it("balances always sum to zero", () => {
    const b = book(["a", "b", "c", "d"], [
      { id: "1", amount: 120001, payerId: "a", participantIds: ["a", "b", "c", "d"] },
      { id: "2", amount: 5000, payerId: "b", participantIds: ["b", "c"] },
      { id: "3", amount: 33333, payerId: "c", participantIds: ["a", "c", "d"] },
    ]);
    expect(sum(ledgerBalances(b))).toBe(0);
  });

  it("applying the settle-up plan zeroes everyone", () => {
    const b = book(["a", "b", "c", "d"], [
      { id: "1", amount: 120001, payerId: "a", participantIds: ["a", "b", "c", "d"] },
      { id: "2", amount: 5000, payerId: "b", participantIds: ["b", "c"] },
      { id: "3", amount: 33333, payerId: "c", participantIds: ["a", "c", "d"] },
    ]);
    const after = afterSettle(b);
    for (const v of Object.values(after)) expect(v).toBe(0);
  });

  it("circular debt needs no transfers at all", () => {
    // a pays for b, b pays for c, c pays for a — same amount each, all square
    const b = book(["a", "b", "c"], [
      { id: "1", amount: 3000, payerId: "a", participantIds: ["b"] },
      { id: "2", amount: 3000, payerId: "b", participantIds: ["c"] },
      { id: "3", amount: 3000, payerId: "c", participantIds: ["a"] },
    ]);
    expect(ledgerBalances(b)).toEqual({ a: 0, b: 0, c: 0 });
    expect(ledgerSettleUp(b)).toEqual([]);
  });

  it("only CONFIRMED payments move money", () => {
    const acts: LedgerBook["activities"] = [
      { id: "1", amount: 10000, payerId: "a", participantIds: ["a", "b"] },
    ];
    const pending = book(["a", "b"], acts, [
      { id: "p", fromId: "b", toId: "a", amount: 5000, status: "PENDING" },
    ]);
    const confirmed = book(["a", "b"], acts, [
      { id: "p", fromId: "b", toId: "a", amount: 5000, status: "CONFIRMED" },
    ]);
    expect(ledgerBalances(pending).a).toBe(5000);
    expect(ledgerBalances(confirmed).a).toBe(0);
  });

  it("settle-up plan never invents or destroys money", () => {
    const b = book(["a", "b", "c", "d", "e"], [
      { id: "1", amount: 99999, payerId: "a", participantIds: ["a", "b", "c", "d", "e"] },
      { id: "2", amount: 12345, payerId: "e", participantIds: ["a", "e"] },
      { id: "3", amount: 700, payerId: "d", participantIds: ["b", "c", "d"] },
    ]);
    const plan = ledgerSettleUp(b);
    const balances = ledgerBalances(b);
    const owed = Object.values(balances).filter((v) => v > 0).reduce((s, v) => s + v, 0);
    expect(plan.reduce((s, t) => s + t.amount, 0)).toBe(owed);
    for (const t of plan) expect(t.amount).toBeGreaterThan(0);
  });

  it("pairs report both legs and settled payments", () => {
    const b = book(["a", "b"], [
      { id: "1", amount: 10000, payerId: "a", participantIds: ["a", "b"] },
      { id: "2", amount: 4000, payerId: "b", participantIds: ["a", "b"] },
    ], [{ id: "p", fromId: "b", toId: "a", amount: 1000, status: "CONFIRMED" }]);
    const [pair] = ledgerPairs(b);
    expect(pair.legAB).toBe(2000); // a's share of b's activity
    expect(pair.legBA).toBe(5000); // b's share of a's activity
    expect(pair.paidBA).toBe(1000);
  });
});

describe("formatting", () => {
  it("renders Indian grouping and a real minus sign", () => {
    expect(ledgerMoney(100000)).toBe("₹1,000");
    expect(ledgerMoney(-250050)).toBe("−₹2,500.5");
    expect(ledgerMoney(0)).toBe("₹0");
  });

  it("round-trips rupees through paise without float drift", () => {
    for (const r of [0.1, 0.2, 1.15, 99.99, 1234.56]) {
      expect(ledgerPaise(r)).toBe(Math.round(r * 100));
    }
    expect(ledgerPaise("1000")).toBe(100000);
    expect(ledgerPaise("")).toBe(0);
  });
});
