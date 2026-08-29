/* Court Ledger money engine.
 *
 * Originally lib/finance.ts in the Next.js court-ledger app, ported to plain JS
 * for the single-file build, and now back to TypeScript — it was always portable
 * because it is pure: no ORM, no React, no framework.
 *
 * EVERY AMOUNT IS AN INTEGER NUMBER OF PAISE. Money is never held in floats.
 * A 3-way split of ₹1000 is 33333+33333+33334, with the odd paise going to the
 * payer, so a book always sums to exactly what was spent. */

export type MemberId = string;

export type LedgerMember = { id: MemberId; name: string; me?: boolean };

export type LedgerActivity = {
  id: string;
  /** Integer paise. */
  amount: number;
  payerId: MemberId;
  participantIds: MemberId[];
  type?: LedgerType;
  note?: string;
  date?: string;
};

export type PaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED";

export type LedgerPayment = {
  id: string;
  fromId: MemberId;
  toId: MemberId;
  /** Integer paise. */
  amount: number;
  status: PaymentStatus;
  date?: string;
};

export type LedgerBook = {
  id: string;
  name: string;
  members: LedgerMember[];
  activities: LedgerActivity[];
  payments: LedgerPayment[];
};

export type OwedMap = Record<MemberId, Record<MemberId, number>>;
export type Balances = Record<MemberId, number>;
export type Transfer = { from: MemberId; to: MemberId; amount: number };
export type Pair = {
  a: MemberId; b: MemberId;
  net: number; legAB: number; legBA: number; paidAB: number; paidBA: number;
};

/** Equal split of an activity among its participants; remainder paise to the payer. */
export function ledgerShares(book: LedgerBook, act: LedgerActivity): Record<MemberId, number> {
  const memberIds = new Set((book?.members ?? []).map((m) => m?.id));
  const ids = (act?.participantIds ?? []).filter((id) => memberIds.has(id));
  const out: Record<MemberId, number> = {};
  const n = ids.length;
  if (!n) return out;

  const total = act?.amount ?? 0;
  const base = Math.floor(total / n);
  let rem = total - base * n;
  for (const id of ids) out[id] = base;

  if (rem > 0) {
    if (out[act.payerId] != null) out[act.payerId] += rem;
    else {
      let i = 0;
      while (rem-- > 0) { out[ids[i % n]] += 1; i++; }
    }
  }
  return out;
}

/** m[a][b] = total paise a owes b, before netting. Confirmed payments reduce it. */
export function ledgerOwedMap(book: LedgerBook): OwedMap {
  const m: OwedMap = {};
  const add = (a: MemberId, b: MemberId, v: number) => {
    if (a === b || !v) return;
    (m[a] ??= {})[b] = (m[a][b] ?? 0) + v;
  };
  for (const act of book?.activities ?? []) {
    const s = ledgerShares(book, act);
    for (const pid of Object.keys(s)) {
      if (pid !== act?.payerId) add(pid, act.payerId, s[pid]);
    }
  }
  for (const p of book?.payments ?? []) {
    if (p?.status === "CONFIRMED") add(p.fromId, p.toId, -(p.amount ?? 0));
  }
  return m;
}

/** Net between a and b: positive means a owes b. */
export const ledgerNet = (m: OwedMap, a: MemberId, b: MemberId): number =>
  (m?.[a]?.[b] ?? 0) - (m?.[b]?.[a] ?? 0);

/** Balance of one member: positive means others owe them. */
export function ledgerBalances(book: LedgerBook): Balances {
  const m = ledgerOwedMap(book);
  const out: Balances = {};
  const members = book?.members ?? [];
  for (const p of members) {
    let t = 0;
    for (const o of members) if (o && p && o.id !== p.id) t += ledgerNet(m, o.id, p.id);
    out[p.id] = t;
  }
  return out;
}

/** Per-pair detail: the two legs and any settled payments between them. */
export function ledgerPairs(book: LedgerBook): Pair[] {
  const out: Pair[] = [];
  const ppl = book?.members ?? [];
  const m = ledgerOwedMap(book);
  const shareCache = (book?.activities ?? []).map((act) => ({ act, shares: ledgerShares(book, act) }));

  for (let i = 0; i < ppl.length; i++) {
    for (let j = i + 1; j < ppl.length; j++) {
      const a = ppl[i]?.id, b = ppl[j]?.id;
      if (!a || !b) continue;
      const net = ledgerNet(m, a, b);
      let legAB = 0, legBA = 0;
      for (const { act, shares } of shareCache) {
        if (act?.payerId === b && shares?.[a]) legAB += shares[a];
        if (act?.payerId === a && shares?.[b]) legBA += shares[b];
      }
      let paidAB = 0, paidBA = 0;
      for (const p of book?.payments ?? []) {
        if (p?.status !== "CONFIRMED") continue;
        if (p.fromId === a && p.toId === b) paidAB += p.amount ?? 0;
        if (p.fromId === b && p.toId === a) paidBA += p.amount ?? 0;
      }
      if (legAB || legBA || paidAB || paidBA) out.push({ a, b, net, legAB, legBA, paidAB, paidBA });
    }
  }
  return out.sort((x, y) => Math.abs(y.net) - Math.abs(x.net));
}

/** Minimum-transaction settlement: largest debtor pays largest creditor, repeat. */
export function ledgerSettleUp(book: LedgerBook): Transfer[] {
  const balances = ledgerBalances(book);
  const cred: { id: MemberId; v: number }[] = [];
  const debt: { id: MemberId; v: number }[] = [];
  for (const id of Object.keys(balances)) {
    const b = balances[id] || 0;
    if (b > 0) cred.push({ id, v: b });
    else if (b < 0) debt.push({ id, v: -b });
  }
  cred.sort((a, b) => b.v - a.v);
  debt.sort((a, b) => b.v - a.v);

  const out: Transfer[] = [];
  let i = 0, j = 0;
  while (i < debt.length && j < cred.length) {
    const v = Math.min(debt[i].v, cred[j].v);
    if (v > 0) out.push({ from: debt[i].id, to: cred[j].id, amount: v });
    debt[i].v -= v; cred[j].v -= v;
    if (debt[i].v <= 0) i++;
    if (cred[j].v <= 0) j++;
  }
  return out;
}

export type LedgerType = "COURT_BOOKING" | "EQUIPMENT" | "FOOD_DRINKS" | "OTHER";

export const LEDGER_TYPES: Record<LedgerType, { emoji: string; label: string }> = {
  COURT_BOOKING: { emoji: "🏸", label: "Court Booking" },
  EQUIPMENT: { emoji: "🎽", label: "Equipment" },
  FOOD_DRINKS: { emoji: "🥤", label: "Food & Drinks" },
  OTHER: { emoji: "📌", label: "Other" },
};

export const ledgerTypeMeta = (type?: LedgerType | null) => LEDGER_TYPES[type ?? "OTHER"] ?? LEDGER_TYPES.OTHER;

export const ledgerMemberName = (book: LedgerBook, id: MemberId): string =>
  (book?.members ?? []).find((x) => x?.id === id)?.name ?? "—";

/** Indian-grouped rupees from paise. Uses a real minus sign, not a hyphen. */
export function ledgerMoney(paise: number): string {
  const v = (paise || 0) / 100;
  const abs = Math.abs(v);
  const str = abs.toLocaleString("en-IN", {
    maximumFractionDigits: abs % 1 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
  });
  return `${v < 0 ? "−" : ""}₹${str}`;
}

/** Rupees (as typed) to integer paise. */
export const ledgerPaise = (v: number | string): number => Math.round((Number(v) || 0) * 100);
