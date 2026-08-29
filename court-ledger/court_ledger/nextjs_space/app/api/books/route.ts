import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser, bookInclude, toBookData } from '@/lib/server-helpers'
import { calcBalance } from '@/lib/finance'
import { pickColor } from '@/lib/rbac'

export const dynamic = 'force-dynamic'

export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberships = await prisma.bookMember.findMany({
    where: { OR: [{ userId: user.id }, { email: user.email }] },
    select: { bookId: true, id: true, role: true },
  })
  const bookIds = Array.from(new Set(memberships.map((m) => m.bookId)))
  const books = await prisma.book.findMany({
    where: { id: { in: bookIds } },
    include: bookInclude,
    orderBy: { updatedAt: 'desc' },
  })

  const result = books.map((b) => {
    const data = toBookData(b)
    const myMember =
      data.members.find((m) => m.userId === user.id) ??
      data.members.find((m) => (m.email ?? '') === user.email)
    const myBalance = myMember ? calcBalance(data, myMember.id) : 0
    return {
      id: b.id,
      name: b.name,
      archived: b.archived,
      updatedAt: b.updatedAt.toISOString(),
      createdAt: b.createdAt.toISOString(),
      memberCount: data.members.length,
      entryCount: data.activities.length,
      myRole: myMember?.role ?? 'VIEWER',
      myBalance,
    }
  })

  return NextResponse.json({ books: result })
}

export async function POST(req: Request) {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const name = String(body?.name ?? '').trim()
  if (!name) return NextResponse.json({ error: 'Book name is required.' }, { status: 400 })

  const book = await prisma.book.create({
    data: {
      name,
      createdById: user.id,
      members: {
        create: {
          name: user.name || user.email,
          email: user.email,
          userId: user.id,
          role: 'PRIMARY_ADMIN',
          color: pickColor(0),
        },
      },
    },
  })

  return NextResponse.json({ book: { id: book.id, name: book.name } })
}
