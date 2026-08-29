import { NextResponse } from 'next/server'
import { prisma } from '@/lib/db'
import { getSessionUser } from '@/lib/server-helpers'

export const dynamic = 'force-dynamic'

/** Global player directory: distinct people across all books the caller belongs to. */
export async function GET() {
  const user = await getSessionUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const memberships = await prisma.bookMember.findMany({
    where: { OR: [{ userId: user.id }, { email: user.email }] },
    select: { bookId: true },
  })
  const bookIds = Array.from(new Set(memberships.map((m) => m.bookId)))
  const members = await prisma.bookMember.findMany({
    where: { bookId: { in: bookIds } },
    select: { name: true, email: true },
    orderBy: { createdAt: 'desc' },
  })

  const seen = new Set<string>()
  const people: { name: string; email: string | null }[] = []
  for (const m of members) {
    const key = (m.email ?? '').trim() || `name:${m.name.toLowerCase()}`
    if (seen.has(key)) continue
    seen.add(key)
    people.push({ name: m.name, email: m.email })
  }
  return NextResponse.json({ people })
}
