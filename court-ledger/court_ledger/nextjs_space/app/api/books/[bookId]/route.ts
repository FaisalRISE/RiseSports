import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, getMembership, bookInclude, toBookData } from '@/lib/server-helpers'
import { calcAllBalances, calcPairs, calcSettleUp } from '@/lib/finance'
import type { Role } from '@/lib/finance'
import { canSeeAllBalances, canSeeOwnPairs, canManageBookSettings, canDeleteBook } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership) return NextResponse.json({ error: 'Not a member of this book.' }, { status: 403 })

  const book = await prisma.book.findUnique({ where: { id: bookId }, include: bookInclude })
  if (!book) return NextResponse.json({ error: 'Book not found.' }, { status: 404 })

  const data = toBookData(book)
  const role = membership.role as Role
  const myMemberId = membership.id

  // Role-gated balance visibility
  const allBalances = calcAllBalances(data)
  let balances: Record<string, number> = {}
  let pairs = calcPairs(data)
  let settleUp: ReturnType<typeof calcSettleUp> = []

  if (canSeeAllBalances(role)) {
    balances = allBalances
    settleUp = calcSettleUp(data)
  } else if (canSeeOwnPairs(role)) {
    balances = { [myMemberId]: allBalances?.[myMemberId] ?? 0 }
    pairs = pairs.filter((p) => p.a === myMemberId || p.b === myMemberId)
  } else {
    balances = { [myMemberId]: allBalances?.[myMemberId] ?? 0 }
    pairs = []
  }

  return NextResponse.json({
    book: {
      id: book.id,
      name: book.name,
      archived: book.archived,
      createdAt: book.createdAt.toISOString(),
      updatedAt: book.updatedAt.toISOString(),
    },
    myMemberId,
    myRole: role,
    members: data.members,
    activities: data.activities,
    payments: data.payments,
    balances,
    pairs,
    settleUp,
  })
}

export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership || !canManageBookSettings(membership.role as Role)) {
    return NextResponse.json({ error: 'Only admins can edit book settings.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const patch: { name?: string; archived?: boolean } = {}
  if (typeof body?.name === 'string' && body.name.trim()) patch.name = body.name.trim()
  if (typeof body?.archived === 'boolean') patch.archived = body.archived

  const book = await prisma.book.update({ where: { id: bookId }, data: patch })
  return NextResponse.json({ book: { id: book.id, name: book.name, archived: book.archived } })
}

export async function DELETE(
  _req: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership || !canDeleteBook(membership.role as Role)) {
    return NextResponse.json({ error: 'Only the primary admin can delete this book.' }, { status: 403 })
  }
  await prisma.book.delete({ where: { id: bookId } })
  return NextResponse.json({ ok: true })
}
