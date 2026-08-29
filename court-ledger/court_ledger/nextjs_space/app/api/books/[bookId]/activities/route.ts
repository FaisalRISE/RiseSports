import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, getMembership, touchBook } from '@/lib/server-helpers'
import type { Role } from '@/lib/finance'
import { canAddEntries } from '@/lib/rbac'
import { rupeesToPaise } from '@/lib/finance'

export const dynamic = 'force-dynamic'

const TYPES = ['COURT_BOOKING', 'EQUIPMENT', 'FOOD_DRINKS', 'OTHER']

export async function POST(
  req: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership || !canAddEntries(membership.role as Role)) {
    return NextResponse.json({ error: 'Your role cannot add entries.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const amount = rupeesToPaise(body?.amount)
  const type = TYPES.includes(body?.type) ? body.type : 'COURT_BOOKING'
  const payerId = String(body?.payerId ?? '')
  const participantIds: string[] = Array.isArray(body?.participantIds) ? body.participantIds : []
  const date = body?.date ? new Date(body.date) : new Date()

  if (amount <= 0) return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
  if (!payerId) return NextResponse.json({ error: 'Select who paid.' }, { status: 400 })
  if (participantIds.length < 1) return NextResponse.json({ error: 'Select at least one participant.' }, { status: 400 })

  const validMembers = await prisma.bookMember.findMany({
    where: { bookId, id: { in: [payerId, ...participantIds] } },
    select: { id: true },
  })
  const validIds = new Set(validMembers.map((m) => m.id))
  if (!validIds.has(payerId)) return NextResponse.json({ error: 'Invalid payer.' }, { status: 400 })
  const cleanParts = Array.from(new Set(participantIds.filter((id) => validIds.has(id))))
  if (!cleanParts.length) return NextResponse.json({ error: 'Invalid participants.' }, { status: 400 })

  const activity = await prisma.activity.create({
    data: {
      bookId,
      type: type as 'COURT_BOOKING',
      amount,
      date,
      slotText: String(body?.slotText ?? '').trim() || null,
      venue: String(body?.venue ?? '').trim() || null,
      note: String(body?.note ?? '').trim() || null,
      payerId,
      createdByUserId: user.id,
      participants: { create: cleanParts.map((memberId) => ({ memberId })) },
    },
  })
  await touchBook(bookId)
  return NextResponse.json({ activity: { id: activity.id } })
}
