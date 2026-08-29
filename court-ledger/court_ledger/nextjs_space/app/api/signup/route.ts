import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import { prisma } from '@/lib/db'

export const dynamic = 'force-dynamic'

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}))
    const email = String(body?.email ?? '').toLowerCase().trim()
    const password = String(body?.password ?? '')
    const name = String(body?.name ?? '').trim()

    if (!email || !/^\S+@\S+\.\S+$/.test(email)) {
      return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 })
    }
    if (password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters.' }, { status: 400 })
    }
    if (!name) {
      return NextResponse.json({ error: 'Please enter your name.' }, { status: 400 })
    }

    const existing = await prisma.user.findUnique({ where: { email } })
    if (existing) {
      return NextResponse.json({ error: 'An account with this email already exists.' }, { status: 409 })
    }

    const passwordHash = await bcrypt.hash(password, 10)
    const user = await prisma.user.create({
      data: { email, passwordHash, name },
    })

    // Link any existing book memberships invited via this email
    await prisma.bookMember.updateMany({
      where: { email, userId: null },
      data: { userId: user.id },
    })

    return NextResponse.json({ ok: true, id: user.id })
  } catch (e) {
    console.error('signup error', e)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
