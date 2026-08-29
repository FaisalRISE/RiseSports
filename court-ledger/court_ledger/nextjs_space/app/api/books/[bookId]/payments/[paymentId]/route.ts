import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, getMembership, touchBook } from '@/lib/server-helpers'
import type { Role } from '@/lib/finance'
import { isAdmin } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

/** PATCH with { action: 'confirm' | 'decline' } — recipient acknowledges; admins may also act. */
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ bookId: string; paymentId: string }> }
) {
  const { bookId, paymentId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership) return NextResponse.json({ error: 'Not a member.' }, { status: 403 })

  const payment = await prisma.payment.findFirst({ where: { id: paymentId, bookId } })
  if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })
  if (payment.status !== 'PENDING') {
    return NextResponse.json({ error: 'This payment has already been processed.' }, { status: 409 })
  }

  const body = await req.json().catch(() => ({}))
  const action = body?.action

  // Only the recipient (or an admin) can confirm/decline
  const isRecipient = payment.toId === membership.id
  if (!isRecipient && !isAdmin(membership.role as Role)) {
    return NextResponse.json({ error: 'Only the recipient can acknowledge this payment.' }, { status: 403 })
  }

  if (action === 'confirm') {
    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'CONFIRMED', confirmedAt: new Date() },
    })
    await touchBook(bookId)
    return NextResponse.json({ payment: { id: updated.id, status: updated.status } })
  }
  if (action === 'decline') {
    const updated = await prisma.payment.update({
      where: { id: paymentId },
      data: { status: 'DECLINED' },
    })
    await touchBook(bookId)
    return NextResponse.json({ payment: { id: updated.id, status: updated.status } })
  }
  return NextResponse.json({ error: 'Invalid action.' }, { status: 400 })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ bookId: string; paymentId: string }> }
) {
  const { bookId, paymentId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership) return NextResponse.json({ error: 'Not a member.' }, { status: 403 })

  const payment = await prisma.payment.findFirst({ where: { id: paymentId, bookId } })
  if (!payment) return NextResponse.json({ error: 'Payment not found.' }, { status: 404 })

  const mayDelete =
    isAdmin(membership.role as Role) ||
    (payment.status === 'PENDING' && payment.createdByUserId === user.id)
  if (!mayDelete) {
    return NextResponse.json({ error: 'You cannot delete this payment.' }, { status: 403 })
  }

  await prisma.payment.delete({ where: { id: paymentId } })
  await touchBook(bookId)
  return NextResponse.json({ ok: true })
}
