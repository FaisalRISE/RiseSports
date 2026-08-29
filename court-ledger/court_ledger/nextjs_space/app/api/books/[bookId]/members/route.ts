import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, getMembership, touchBook } from '@/lib/server-helpers'
import type { Role } from '@/lib/finance'
import { canManageMembers, pickColor } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

export async function POST(
  req: Request,
  { params }: { params: Promise<{ bookId: string }> }
) {
  const { bookId } = await params
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const membership = await getMembership(bookId, user)
  if (!membership || !canManageMembers(membership.role as Role)) {
    return NextResponse.json({ error: 'Only admins can add members.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  const email = String(body?.email ?? '').toLowerCase().trim() || null
  const role = ['BOOK_ADMIN', 'DATA_OPERATOR', 'VIEWER'].includes(body?.role)
    ? (body.role as Role)
    : 'DATA_OPERATOR'
  if (!name) return NextResponse.json({ error: 'Member name is required.' }, { status: 400 })

  if (email) {
    const dup = await prisma.bookMember.findFirst({ where: { bookId, email } })
    if (dup) return NextResponse.json({ error: `${dup.name} is already in this book with that email.` }, { status: 409 })
  }

  const count = await prisma.bookMember.count({ where: { bookId } })
  const linkedUser = email ? await prisma.user.findUnique({ where: { email } }) : null

  const member = await prisma.bookMember.create({
    data: {
      bookId,
      name,
      email,
      userId: linkedUser?.id ?? null,
      role: role as 'BOOK_ADMIN' | 'DATA_OPERATOR' | 'VIEWER',
      color: pickColor(count),
    },
  })
  await touchBook(bookId)
  return NextResponse.json({ member })
}
