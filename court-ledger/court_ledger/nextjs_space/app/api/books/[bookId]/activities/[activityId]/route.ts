import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, getMembership, touchBook } from '@/lib/server-helpers'
import type { Role } from '@/lib/finance'
import { canEditEntry, canDeleteEntry } from '@/lib/rbac'
import { rupeesToPaise } from '@/lib/finance'

export const dynamic = 'force-dynamic'

const TYPES = ['COURT_BOOKING', 'EQUIPMENT', 'FOOD_DRINKS', 'OTHER']

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ bookId: string; activityId: string }> }
) {
  const { bookId, activityId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership) return NextResponse.json({ error: 'Not a member.' }, { status: 403 })

  const activity = await prisma.activity.findFirst({ where: { id: activityId, bookId } })
  if (!activity) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })
  if (!canEditEntry(membership.role as Role, activity.createdByUserId, user.id)) {
    return NextResponse.json({ error: 'You can only edit entries you created.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const patch: Record<string, unknown> = {}
  if (body?.amount != null) {
    const amount = rupeesToPaise(body.amount)
    if (amount <= 0) return NextResponse.json({ error: 'Enter a valid amount.' }, { status: 400 })
    patch.amount = amount
  }
  if (TYPES.includes(body?.type)) patch.type = body.type
  if (body?.date) patch.date = new Date(body.date)
  if (body?.slotText !== undefined) patch.slotText = String(body.slotText ?? '').trim() || null
  if (body?.venue !== undefined) patch.venue = String(body.venue ?? '').trim() || null
  if (body?.note !== undefined) patch.note = String(body.note ?? '').trim() || null
  if (typeof body?.payerId === 'string' && body.payerId) patch.payerId = body.payerId

  await prisma.activity.update({ where: { id: activityId }, data: patch })

  if (Array.isArray(body?.participantIds) && body.participantIds.length > 0) {
    const validMembers = await prisma.bookMember.findMany({
      where: { bookId, id: { in: body.participantIds } },
      select: { id: true },
    })
    const clean = validMembers.map((m) => m.id)
    if (clean.length) {
      await prisma.activityParticipant.deleteMany({ where: { activityId } })
      await prisma.activityParticipant.createMany({
        data: clean.map((memberId) => ({ activityId, memberId })),
      })
    }
  }
  await touchBook(bookId)
  return NextResponse.json({ ok: true })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ bookId: string; activityId: string }> }
) {
  const { bookId, activityId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership) return NextResponse.json({ error: 'Not a member.' }, { status: 403 })

  const activity = await prisma.activity.findFirst({ where: { id: activityId, bookId } })
  if (!activity) return NextResponse.json({ error: 'Entry not found.' }, { status: 404 })
  if (!canDeleteEntry(membership.role as Role, activity.createdByUserId, user.id)) {
    return NextResponse.json({ error: 'You can only delete entries you created.' }, { status: 403 })
  }

  await prisma.activity.delete({ where: { id: activityId } })
  await touchBook(bookId)
  return NextResponse.json({ ok: true })
}
