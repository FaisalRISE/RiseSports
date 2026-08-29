import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, getMembership, touchBook } from '@/lib/server-helpers'
import type { Role } from '@/lib/finance'
import { canManageMembers } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ bookId: string; memberId: string }> }
) {
  const { bookId, memberId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership || !canManageMembers(membership.role as Role)) {
    return NextResponse.json({ error: 'Only admins can manage members.' }, { status: 403 })
  }

  const target = await prisma.bookMember.findFirst({ where: { id: memberId, bookId } })
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (target.role === 'PRIMARY_ADMIN') {
    return NextResponse.json({ error: 'The primary admin role cannot be changed.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const patch: { name?: string; email?: string | null; role?: 'BOOK_ADMIN' | 'DATA_OPERATOR' | 'VIEWER' } = {}
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body?.email === 'string') patch.email = body.email.toLowerCase().trim() || null
  if (['BOOK_ADMIN', 'DATA_OPERATOR', 'VIEWER'].includes(body?.role)) patch.role = body.role

  const member = await prisma.bookMember.update({ where: { id: memberId }, data: patch })
  await touchBook(bookId)
  return NextResponse.json({ member })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ bookId: string; memberId: string }> }
) {
  const { bookId, memberId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership || !canManageMembers(membership.role as Role)) {
    return NextResponse.json({ error: 'Only admins can remove members.' }, { status: 403 })
  }

  const target = await prisma.bookMember.findFirst({ where: { id: memberId, bookId } })
  if (!target) return NextResponse.json({ error: 'Member not found.' }, { status: 404 })
  if (target.role === 'PRIMARY_ADMIN') {
    return NextResponse.json({ error: 'The primary admin cannot be removed.' }, { status: 403 })
  }

  const involvement = await prisma.activityParticipant.count({ where: { memberId } })
  const paid = await prisma.activity.count({ where: { payerId: memberId } })
  const pays = await prisma.payment.count({ where: { OR: [{ fromId: memberId }, { toId: memberId }] } })
  if (involvement + paid + pays > 0) {
    return NextResponse.json(
      { error: 'This member has ledger entries and cannot be removed. Settle and delete their entries first.' },
      { status: 409 }
    )
  }

  await prisma.bookMember.delete({ where: { id: memberId } })
  await touchBook(bookId)
  return NextResponse.json({ ok: true })
}
