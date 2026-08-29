import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import type { BookData, Role } from '@/lib/finance'

export interface SessionUser {
  id: string
  email: string
  name: string
}

export async function getSessionUser(): Promise<SessionUser | null> {
  const session = await auth()
  const u = session?.user as { id?: string; email?: string | null; name?: string | null } | undefined
  if (!u?.id) return null
  return { id: u.id, email: (u.email ?? '').toLowerCase(), name: u.name ?? '' }
}

/** Find the caller's membership in a book (by linked userId, falling back to email). */
export async function getMembership(bookId: string, user: SessionUser) {
  let member = await prisma.bookMember.findFirst({
    where: { bookId, userId: user.id },
  })
  if (!member && user.email) {
    member = await prisma.bookMember.findFirst({
      where: { bookId, email: user.email },
    })
    if (member) {
      // Auto-link the account
      member = await prisma.bookMember.update({
        where: { id: member.id },
        data: { userId: user.id },
      })
    }
  }
  return member
}

export const bookInclude = {
  members: { orderBy: { createdAt: 'asc' as const } },
  activities: {
    include: { participants: true },
    orderBy: { date: 'desc' as const },
  },
  payments: { orderBy: { date: 'desc' as const } },
}

type FullBook = NonNullable<
  Awaited<ReturnType<typeof prisma.book.findUnique<{ where: { id: string }; include: typeof bookInclude }>>>
>

export function toBookData(book: FullBook): BookData {
  return {
    members: (book?.members ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      email: m.email,
      color: m.color,
      role: m.role as Role,
      userId: m.userId,
    })),
    activities: (book?.activities ?? []).map((a) => ({
      id: a.id,
      type: a.type,
      amount: a.amount,
      date: a.date.toISOString(),
      slotText: a.slotText,
      venue: a.venue,
      note: a.note,
      payerId: a.payerId,
      participantIds: (a.participants ?? []).map((p) => p.memberId),
      createdByUserId: a.createdByUserId,
      createdAt: a.createdAt.toISOString(),
    })),
    payments: (book?.payments ?? []).map((p) => ({
      id: p.id,
      fromId: p.fromId,
      toId: p.toId,
      amount: p.amount,
      mode: p.mode,
      note: p.note,
      status: p.status,
      date: p.date.toISOString(),
      confirmedAt: p.confirmedAt?.toISOString() ?? null,
      createdByUserId: p.createdByUserId,
    })),
  }
}

export async function touchBook(bookId: string) {
  await prisma.book.update({ where: { id: bookId }, data: { updatedAt: new Date() } }).catch(() => {})
}
