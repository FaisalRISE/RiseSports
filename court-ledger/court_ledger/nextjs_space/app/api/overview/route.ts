import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, bookInclude, toBookData } from '@/lib/server-helpers'
import { calcBalance, calcOwedMap, calcNetFromMap } from '@/lib/finance'
import type { Role } from '@/lib/finance'
import { canSeeOwnPairs } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberships = await prisma.bookMember.findMany({
    where: { OR: [{ userId: user.id }, { email: user.email }] },
    select: { bookId: true },
  })
  const bookIds = Array.from(new Set(memberships.map((m) => m.bookId)))
  const books = await prisma.book.findMany({
    where: { id: { in: bookIds }, archived: false },
    include: bookInclude,
    orderBy: { updatedAt: 'desc' },
  })

  let grandTotal = 0
  const bookCards: {
    id: string
    name: string
    balance: number
    memberCount: number
    updatedAt: string
    role: Role
  }[] = []
  // person key: email if present else `${bookId}:${memberId}` — consolidate across books by email/name
  const personMap: Record<
    string,
    { name: string; color: string; total: number; parts: { bookId: string; bookName: string; net: number }[] }
  > = {}
  const pendingForMe: {
    paymentId: string
    bookId: string
    bookName: string
    fromName: string
    amount: number
    mode: string
    date: string
  }[] = []
  const pendingByMe: {
    paymentId: string
    bookId: string
    bookName: string
    toName: string
    amount: number
    date: string
  }[] = []

  for (const b of books) {
    const data = toBookData(b)
    const me =
      data.members.find((m) => m.userId === user.id) ??
      data.members.find((m) => (m.email ?? '') === user.email)
    if (!me) continue
    const myBalance = calcBalance(data, me.id)
    grandTotal += myBalance
    bookCards.push({
      id: b.id,
      name: b.name,
      balance: myBalance,
      memberCount: data.members.length,
      updatedAt: b.updatedAt.toISOString(),
      role: me.role,
    })

    // Per-person consolidated (only where role allows seeing own pairwise detail)
    if (canSeeOwnPairs(me.role)) {
      const m = calcOwedMap(data)
      data.members.forEach((other) => {
        if (other.id === me.id) return
        const net = calcNetFromMap(m, other.id, me.id) // positive → other owes me
        if (!net) return
        const key = (other.email ?? '').trim() || `name:${other.name.toLowerCase()}`
        if (!personMap[key]) {
          personMap[key] = { name: other.name, color: other.color, total: 0, parts: [] }
        }
        personMap[key].total += net
        personMap[key].parts.push({ bookId: b.id, bookName: b.name, net })
      })
    }

    // Pending acknowledgments
    data.payments.forEach((p) => {
      if (p.status !== 'PENDING') return
      if (p.toId === me.id) {
        pendingForMe.push({
          paymentId: p.id,
          bookId: b.id,
          bookName: b.name,
          fromName: data.members.find((mm) => mm.id === p.fromId)?.name ?? '—',
          amount: p.amount,
          mode: p.mode,
          date: p.date,
        })
      }
      if (p.fromId === me.id) {
        pendingByMe.push({
          paymentId: p.id,
          bookId: b.id,
          bookName: b.name,
          toName: data.members.find((mm) => mm.id === p.toId)?.name ?? '—',
          amount: p.amount,
          date: p.date,
        })
      }
    })
  }

  const people = Object.values(personMap)
    .filter((p) => p.total !== 0)
    .sort((a, b) => Math.abs(b.total) - Math.abs(a.total))

  return NextResponse.json({
    grandTotal,
    books: bookCards,
    people,
    pendingForMe,
    pendingByMe,
    userName: user.name,
  })
}
