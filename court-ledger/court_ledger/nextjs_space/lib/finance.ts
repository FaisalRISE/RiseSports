// Pure calculation engine — ported from the original Court Ledger app.
// All amounts are integers in paise.

export type Role = 'PRIMARY_ADMIN' | 'BOOK_ADMIN' | 'DATA_OPERATOR' | 'VIEWER'

export interface MemberLite {
  id: string
  name: string
  email?: string | null
  color: string
  role: Role
  userId?: string | null
}

export interface ActivityLite {
  id: string
  type: string
  amount: number // paise
  date: string
  slotText?: string | null
  venue?: string | null
  note?: string | null
  payerId: string
  participantIds: string[]
  createdByUserId?: string | null
  createdAt?: string
}

export interface PaymentLite {
  id: string
  fromId: string
  toId: string
  amount: number // paise
  mode: string
  note?: string | null
  status: string
  date: string
  confirmedAt?: string | null
  createdByUserId?: string | null
}

export interface BookData {
  members: MemberLite[]
  activities: ActivityLite[]
  payments: PaymentLite[]
}

/** Equal split of an activity among its participants; remainder paise go to the payer. */
export function calcShares(book: BookData, act: ActivityLite): Record<string, number> {
  const memberIds = new Set((book?.members ?? []).map((m) => m?.id))
  const ids = (act?.participantIds ?? []).filter((id) => memberIds.has(id))
  const out: Record<string, number> = {}
  const n = ids.length
  if (!n) return out
  const total = act?.amount ?? 0
  const base = Math.floor(total / n)
  let rem = total - base * n
  ids.forEach((id) => {
    out[id] = base
  })
  if (rem > 0) {
    if (out[act.payerId] != null) {
      out[act.payerId] += rem
    } else {
      let i = 0
      while (rem-- > 0) {
        out[ids[i % n]] += 1
        i++
      }
    }
  }
  return out
}

/** m[a][b] = total paise a owes b (before netting). Confirmed payments reduce it. */
export function calcOwedMap(book: BookData): Record<string, Record<string, number>> {
  const m: Record<string, Record<string, number>> = {}
  const add = (a: string, b: string, v: number) => {
    if (a === b || !v) return
    if (!m[a]) m[a] = {}
    m[a][b] = (m[a][b] ?? 0) + v
  }
  ;(book?.activities ?? []).forEach((act) => {
    const s = calcShares(book, act)
    Object.keys(s ?? {}).forEach((pid) => {
      if (pid !== act?.payerId) add(pid, act.payerId, s[pid])
    })
  })
  ;(book?.payments ?? []).forEach((p) => {
    if (p?.status === 'CONFIRMED') add(p.fromId, p.toId, -(p.amount ?? 0))
  })
  return m
}

/** Net between a and b: positive → a owes b. */
export function calcNetFromMap(
  m: Record<string, Record<string, number>>,
  a: string,
  b: string
): number {
  return (m?.[a]?.[b] ?? 0) - (m?.[b]?.[a] ?? 0)
}

/** Balance of pid: positive → others owe pid (net receivable). */
export function calcBalance(book: BookData, pid: string): number {
  const m = calcOwedMap(book)
  let t = 0
  ;(book?.members ?? []).forEach((o) => {
    if (o?.id !== pid) t += calcNetFromMap(m, o.id, pid)
  })
  return t
}

export function calcAllBalances(book: BookData): Record<string, number> {
  const m = calcOwedMap(book)
  const out: Record<string, number> = {}
  const members = book?.members ?? []
  members.forEach((p) => {
    let t = 0
    members.forEach((o) => {
      if (o?.id !== p?.id) t += calcNetFromMap(m, o.id, p.id)
    })
    out[p.id] = t
  })
  return out
}

export interface PairBalance {
  a: string
  b: string
  net: number // positive → a owes b
  legAB: number
  legBA: number
  paidAB: number
  paidBA: number
}

export function calcPairs(book: BookData): PairBalance[] {
  const out: PairBalance[] = []
  const ppl = book?.members ?? []
  const m = calcOwedMap(book)
  const shareCache = (book?.activities ?? []).map((act) => ({
    act,
    shares: calcShares(book, act),
  }))
  for (let i = 0; i < ppl.length; i++) {
    for (let j = i + 1; j < ppl.length; j++) {
      const a = ppl[i]?.id
      const b = ppl[j]?.id
      if (!a || !b) continue
      const net = calcNetFromMap(m, a, b)
      let legAB = 0
      let legBA = 0
      shareCache.forEach(({ act, shares }) => {
        if (act?.payerId === b && shares?.[a]) legAB += shares[a]
        if (act?.payerId === a && shares?.[b]) legBA += shares[b]
      })
      let paidAB = 0
      let paidBA = 0
      ;(book?.payments ?? []).forEach((p) => {
        if (p?.status !== 'CONFIRMED') return
        if (p.fromId === a && p.toId === b) paidAB += p.amount ?? 0
        if (p.fromId === b && p.toId === a) paidBA += p.amount ?? 0
      })
      if (legAB || legBA || paidAB || paidBA) {
        out.push({ a, b, net, legAB, legBA, paidAB, paidBA })
      }
    }
  }
  return out.sort((x, y) => Math.abs(y.net) - Math.abs(x.net))
}

export interface SettleTxn {
  from: string
  to: string
  amount: number
}

/** Minimum-transaction settlement plan (greedy largest-debtor → largest-creditor). */
export function calcSettleUp(book: BookData): SettleTxn[] {
  const balances = calcAllBalances(book)
  const cred: { id: string; v: number }[] = []
  const debt: { id: string; v: number }[] = []
  Object.keys(balances ?? {}).forEach((id) => {
    const b = balances[id] ?? 0
    if (b > 0) cred.push({ id, v: b })
    else if (b < 0) debt.push({ id, v: -b })
  })
  cred.sort((a, b) => b.v - a.v)
  debt.sort((a, b) => b.v - a.v)
  const out: SettleTxn[] = []
  let i = 0
  let j = 0
  while (i < debt.length && j < cred.length) {
    const v = Math.min(debt[i].v, cred[j].v)
    if (v > 0) out.push({ from: debt[i].id, to: cred[j].id, amount: v })
    debt[i].v -= v
    cred[j].v -= v
    if (debt[i].v <= 0) i++
    if (cred[j].v <= 0) j++
  }
  return out
}

export interface LedgerRow {
  at: string
  delta: number // positive → credit for this person
  title: string
  sub: string
  isPayment?: boolean
  run?: number
}

const TYPE_META: Record<string, { emoji: string; label: string }> = {
  COURT_BOOKING: { emoji: '🏸', label: 'Court Booking' },
  EQUIPMENT: { emoji: '🎽', label: 'Equipment' },
  FOOD_DRINKS: { emoji: '🥤', label: 'Food & Drinks' },
  OTHER: { emoji: '📌', label: 'Other' },
}

export function typeMeta(type?: string | null) {
  return TYPE_META[type ?? 'OTHER'] ?? TYPE_META.OTHER
}

export function memberName(book: BookData, id: string): string {
  return (book?.members ?? []).find((m) => m?.id === id)?.name ?? '—'
}

/** Bank-statement style ledger for one member, newest first with running balance. */
export function calcLedgerFor(book: BookData, pid: string): LedgerRow[] {
  const rows: LedgerRow[] = []
  ;(book?.activities ?? []).forEach((act) => {
    const s = calcShares(book, act)
    const t = typeMeta(act?.type)
    const slotInfo = act?.slotText ?? ''
    if (act?.payerId === pid) {
      let lent = 0
      Object.keys(s ?? {}).forEach((k) => {
        if (k !== pid) lent += s[k]
      })
      if (lent) {
        rows.push({
          at: act.date,
          delta: lent,
          title: `${t.emoji} ${t.label}${act.venue ? ' · ' + act.venue : ''}`,
          sub: `You paid ${formatMoney(act.amount)} for ${Object.keys(s).length} · covered ${formatMoney(lent)} for others${slotInfo ? ` (${slotInfo})` : ''}`,
        })
      }
    } else if (s?.[pid] != null) {
      rows.push({
        at: act.date,
        delta: -s[pid],
        title: `${t.emoji} ${t.label}${act.venue ? ' · ' + act.venue : ''}`,
        sub: `Share of ${formatMoney(act.amount)} split ${Object.keys(s).length} ways · paid by ${memberName(book, act.payerId)}${slotInfo ? ` (${slotInfo})` : ''}`,
      })
    }
  })
  ;(book?.payments ?? []).forEach((p) => {
    if (p?.status !== 'CONFIRMED') return
    if (p.fromId === pid) {
      rows.push({
        at: p.date,
        delta: p.amount,
        title: `💸 Paid ${memberName(book, p.toId)}`,
        sub: `${p.note || 'Settlement'} (${p.mode || 'UPI'})`,
        isPayment: true,
      })
    }
    if (p.toId === pid) {
      rows.push({
        at: p.date,
        delta: -p.amount,
        title: `✅ Received from ${memberName(book, p.fromId)}`,
        sub: `${p.note || 'Settlement'} (${p.mode || 'UPI'})`,
        isPayment: true,
      })
    }
  })
  rows.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime())
  let run = 0
  rows.forEach((r) => {
    run += r.delta
    r.run = run
  })
  return rows.reverse()
}

/** ₹ formatting for paise, Indian grouping. */
export function formatMoney(paise: number): string {
  const v = (paise ?? 0) / 100
  const abs = Math.abs(v)
  const str = abs.toLocaleString('en-IN', {
    maximumFractionDigits: abs % 1 === 0 ? 0 : 2,
    minimumFractionDigits: 0,
  })
  return `${v < 0 ? '−' : ''}₹${str}`
}

export function rupeesToPaise(v: number | string): number {
  return Math.round((Number(v) || 0) * 100)
}
