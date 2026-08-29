import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { prisma } from '@/lib/db'
import { getFileUrl } from '@/lib/s3'

export const dynamic = 'force-dynamic'

async function currentUserId(): Promise<string | null> {
  const session = await auth()
  return (session?.user as { id?: string } | undefined)?.id ?? null
}

async function serialize(userId: string) {
  const u = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      firstName: true,
      lastName: true,
      mobile: true,
      gender: true,
      upiId: true,
      qrImagePath: true,
      qrIsPublic: true,
    },
  })
  if (!u) return null
  let qrImageUrl: string | null = null
  if (u.qrImagePath) {
    try {
      qrImageUrl = await getFileUrl(u.qrImagePath, 'image/png', u.qrIsPublic)
    } catch {
      qrImageUrl = null
    }
  }
  const { qrIsPublic: _p, ...rest } = u
  return { ...rest, qrImageUrl }
}

export async function GET() {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  const profile = await serialize(userId)
  if (!profile) return NextResponse.json({ error: 'Not found' }, { status: 404 })
  return NextResponse.json({ profile })
}

export async function PATCH(req: Request) {
  const userId = await currentUserId()
  if (!userId) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const str = (v: unknown) => {
    const s = String(v ?? '').trim()
    return s === '' ? null : s
  }

  const data: Record<string, string | null | boolean> = {}
  if ('firstName' in body) data.firstName = str(body.firstName)
  if ('lastName' in body) data.lastName = str(body.lastName)
  if ('mobile' in body) {
    const m = str(body.mobile)
    if (m && !/^[+\d][\d\s-]{6,15}$/.test(m)) {
      return NextResponse.json({ error: 'Enter a valid mobile number.' }, { status: 400 })
    }
    data.mobile = m
  }
  if ('gender' in body) {
    const g = str(body.gender)
    if (g && !['MALE', 'FEMALE', 'OTHER', 'UNDISCLOSED'].includes(g)) {
      return NextResponse.json({ error: 'Invalid gender.' }, { status: 400 })
    }
    data.gender = g
  }
  if ('upiId' in body) {
    const upi = str(body.upiId)
    if (upi && !/^[\w.-]{2,}@[a-zA-Z][a-zA-Z0-9]{1,}$/.test(upi)) {
      return NextResponse.json({ error: 'Enter a valid UPI ID (e.g. name@upi).' }, { status: 400 })
    }
    data.upiId = upi
  }
  if ('qrImagePath' in body) {
    data.qrImagePath = str(body.qrImagePath)
    data.qrIsPublic = true
  }

  // Keep display name in sync when first/last provided
  const fn = 'firstName' in data ? (data.firstName as string | null) : undefined
  const ln = 'lastName' in data ? (data.lastName as string | null) : undefined
  if (fn !== undefined || ln !== undefined) {
    const existing = await prisma.user.findUnique({
      where: { id: userId },
      select: { firstName: true, lastName: true, name: true },
    })
    const first = fn !== undefined ? fn : existing?.firstName
    const last = ln !== undefined ? ln : existing?.lastName
    const combined = [first, last].filter(Boolean).join(' ').trim()
    if (combined) data.name = combined
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'Nothing to update.' }, { status: 400 })
  }

  await prisma.user.update({ where: { id: userId }, data })
  const profile = await serialize(userId)
  return NextResponse.json({ profile })
}
