import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, getMembership, touchBook } from '@/lib/server-helpers'
import type { Role } from '@/lib/finance'
import { canAddEntries } from '@/lib/rbac'
import { rupeesToPaise } from '@/lib/finance'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership || !canAddEntries(membership.role as Role)) {
    return NextResponse.json({ error: 'Your role cannot log payments.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const amount = rupeesToPaise(body?.amount)
  const fromId = String(body?.fromId ?? '')
  const toId = String(body?.toId ?? '')
  const mode = ['UPI', 'Cash', 'Bank Transfer'].includes(body?.mode) ? body.mode : 'UPI'

  if (amount <= 0) return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
  if (!fromId || !toId || fromId === toId) {
    return NextResponse.json({ error: 'Select valid payer and recipient.' }, { status: 400 })
  }

  const members = await prisma.bookMember.findMany({
    where: { bookId, id: { in: [fromId, toId] } },
  })
  if (members.length !== 2) return NextResponse.json({ error: 'Invalid members.' }, { status: 400 })

  const payment = await prisma.payment.create({
    data: {
      bookId,
      fromId,
      toId,
      amount,
      mode,
      note: String(body?.note ?? '').trim() || null,
      status: 'PENDING',
      date: body?.date ? new Date(body.date) : new Date(),
      createdByUserId: user.id,
    },
  })
  await touchBook(bookId)
  return NextResponse.json({ payment: { id: payment.id, status: payment.status } })
}
