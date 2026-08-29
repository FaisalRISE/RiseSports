import type { Role, MemberLite, ActivityLite, PaymentLite, PairBalance, SettleTxn } from '@/lib/finance'

export interface BookSummary {
  id: string
  name: string
  archived: boolean
  updatedAt: string
  createdAt: string
  memberCount: number
  entryCount: number
  myRole: Role
  myBalance: number
}

export interface BookDetail {
  book: { id: string; name: string; archived: boolean; createdAt: string; updatedAt: string }
  myMemberId: string
  myRole: Role
  members: MemberLite[]
  activities: ActivityLite[]
  payments: PaymentLite[]
  balances: Record<string, number>
  pairs: PairBalance[]
  settleUp: SettleTxn[]
}

export interface OverviewData {
  grandTotal: number
  books: { id: string; name: string; balance: number; memberCount: number; updatedAt: string; role: Role }[]
  people: { name: string; color: string; total: number; parts: { bookId: string; bookName: string; net: number }[] }[]
  pendingForMe: { paymentId: string; bookId: string; bookName: string; fromName: string; amount: number; mode: string; date: string }[]
  pendingByMe: { paymentId: string; bookId: string; bookName: string; toName: string; amount: number; date: string }[]
  userName: string
}

export function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString('en-IN', {
      day: 'numeric',
      month: 'short',
      year: 'numeric',
      timeZone: 'Asia/Kolkata',
    })
  } catch {
    return ''
  }
}

export function fmtRelative(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  const now = Date.now()
  const diff = Math.max(0, now - then)
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo ago`
  return `${Math.floor(months / 12)}y ago`
}
