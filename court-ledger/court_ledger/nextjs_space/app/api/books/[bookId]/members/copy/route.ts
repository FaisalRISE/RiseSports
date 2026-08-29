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
    return NextResponse.json({ error: 'Only admins can copy members.' }, { status: 403 })
  }

  const body = await req.json().catch(() => ({}))
  const sourceBookId = String(body?.sourceBookId ?? '')
  if (!sourceBookId) return NextResponse.json({ error: 'Source book is required.' }, { status: 400 })

  // Caller must also be a member of the source book
  const sourceMembership = await getMembership(sourceBookId, user)
  if (!sourceMembership) return NextResponse.json({ error: 'You are not a member of the source book.' }, { status: 403 })

  const sourceMembers = await prisma.bookMember.findMany({ where: { bookId: sourceBookId } })
  const existing = await prisma.bookMember.findMany({ where: { bookId } })
  const existingEmails = new Set(existing.map((m) => m.email ?? '').filter(Boolean))
  const existingNames = new Set(existing.map((m) => m.name.toLowerCase()))

  let added = 0
  let idx = existing.length
  for (const sm of sourceMembers) {
    const emailDup = sm.email && existingEmails.has(sm.email)
    const nameDup = !sm.email && existingNames.has(sm.name.toLowerCase())
    if (emailDup || nameDup) continue
    await prisma.bookMember.create({
      data: {
        bookId,
        name: sm.name,
        email: sm.email,
        userId: sm.userId,
        role: sm.role === 'PRIMARY_ADMIN' ? 'DATA_OPERATOR' : sm.role,
        color: pickColor(idx++),
      },
    })
    added++
  }
  await touchBook(bookId)
  return NextResponse.json({ added })
}
