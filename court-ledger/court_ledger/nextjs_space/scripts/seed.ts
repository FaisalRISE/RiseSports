import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';

const prisma = new PrismaClient();

async function main() {
  const email = 'abacus-9721b2b7@example.com';
  const password = 'VniaTp72$h';
  const hash = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { email },
    update: { passwordHash: hash },
    create: {
      email,
      passwordHash: hash,
      isAdmin: true,
      name: 'Test Admin',
    },
  });

  // Seed a demo book for the test account (idempotent by name+owner)
  let book = await prisma.book.findFirst({
    where: { name: 'Badminton Crew', createdById: admin.id },
  });
  if (!book) {
    book = await prisma.book.create({
      data: {
        name: 'Badminton Crew',
        createdById: admin.id,
      },
    });
  }

  const memberDefs = [
    { name: 'Test Admin', email, role: 'PRIMARY_ADMIN' as const, color: '#a3e635', userId: admin.id },
    { name: 'Hamid', email: 'hamid@example.com', role: 'DATA_OPERATOR' as const, color: '#2dd4bf', userId: null },
    { name: 'Ravi', email: 'ravi@example.com', role: 'DATA_OPERATOR' as const, color: '#60B5FF', userId: null },
    { name: 'Sana', email: 'sana@example.com', role: 'VIEWER' as const, color: '#FF90BB', userId: null },
  ];

  const members: Record<string, string> = {};
  for (const m of memberDefs) {
    let existing = await prisma.bookMember.findFirst({
      where: { bookId: book.id, name: m.name },
    });
    if (!existing) {
      existing = await prisma.bookMember.create({
        data: {
          bookId: book.id,
          name: m.name,
          email: m.email,
          role: m.role,
          color: m.color,
          userId: m.userId,
        },
      });
    }
    members[m.name] = existing.id;
  }

  const activityCount = await prisma.activity.count({ where: { bookId: book.id } });
  if (activityCount === 0) {
    const all = Object.values(members ?? {});
    await prisma.activity.create({
      data: {
        bookId: book.id,
        type: 'COURT_BOOKING',
        note: 'Court 3 evening slot',
        amount: 120000,
        date: new Date('2026-08-20T18:00:00+05:30'),
        slotText: '6-8 PM',
        venue: 'Smash Arena',
        payerId: members['Test Admin'],
        createdByUserId: admin.id,
        participants: { create: all.map((id: string) => ({ memberId: id })) },
      },
    });
    await prisma.activity.create({
      data: {
        bookId: book.id,
        type: 'EQUIPMENT',
        note: 'Shuttlecocks (Yonex Mavis)',
        amount: 65000,
        date: new Date('2026-08-22T10:00:00+05:30'),
        payerId: members['Hamid'],
        createdByUserId: admin.id,
        participants: { create: all.map((id: string) => ({ memberId: id })) },
      },
    });
    await prisma.activity.create({
      data: {
        bookId: book.id,
        type: 'FOOD_DRINKS',
        note: 'Post-game juice and snacks',
        amount: 48000,
        date: new Date('2026-08-24T20:30:00+05:30'),
        payerId: members['Ravi'],
        createdByUserId: admin.id,
        participants: {
          create: [members['Test Admin'], members['Hamid'], members['Ravi']].map((id: string) => ({ memberId: id })),
        },
      },
    });
  }

  // ── Demo admin account for the user to explore features ──
  const demoEmail = 'demo@courtledger.app';
  const demoPassword = 'Demo@1234';
  const demoHash = await bcrypt.hash(demoPassword, 10);
  const demoUser = await prisma.user.upsert({
    where: { email: demoEmail },
    update: {
      passwordHash: demoHash,
      firstName: 'Demo',
      lastName: 'Admin',
      upiId: 'demoadmin@upi',
      mobile: '+91 98765 43210',
    },
    create: {
      email: demoEmail,
      passwordHash: demoHash,
      isAdmin: true,
      name: 'Demo Admin',
      firstName: 'Demo',
      lastName: 'Admin',
      upiId: 'demoadmin@upi',
      mobile: '+91 98765 43210',
    },
  });

  let demoBook = await prisma.book.findFirst({
    where: { name: 'Badminton Crew (Demo)', createdById: demoUser.id },
  });
  if (!demoBook) {
    demoBook = await prisma.book.create({
      data: { name: 'Badminton Crew (Demo)', createdById: demoUser.id },
    });
  }

  const demoMemberDefs = [
    { name: 'Demo Admin', email: demoEmail, role: 'PRIMARY_ADMIN' as const, color: '#a3e635', userId: demoUser.id },
    { name: 'Hamid', email: 'hamid@example.com', role: 'BOOK_ADMIN' as const, color: '#2dd4bf', userId: null },
    { name: 'Ravi', email: 'ravi@example.com', role: 'DATA_OPERATOR' as const, color: '#60B5FF', userId: null },
    { name: 'Sana', email: 'sana@example.com', role: 'VIEWER' as const, color: '#FF90BB', userId: null },
  ];
  const demoMembers: Record<string, string> = {};
  for (const m of demoMemberDefs) {
    let existing = await prisma.bookMember.findFirst({
      where: { bookId: demoBook.id, name: m.name },
    });
    if (!existing) {
      existing = await prisma.bookMember.create({
        data: { bookId: demoBook.id, name: m.name, email: m.email, role: m.role, color: m.color, userId: m.userId },
      });
    }
    demoMembers[m.name] = existing.id;
  }

  const demoActCount = await prisma.activity.count({ where: { bookId: demoBook.id } });
  if (demoActCount === 0) {
    const all = Object.values(demoMembers);
    await prisma.activity.create({
      data: {
        bookId: demoBook.id,
        type: 'COURT_BOOKING',
        note: 'Court 2 weekend slot',
        amount: 140000,
        date: new Date('2026-08-22T08:00:00+05:30'),
        slotText: '8-10 AM',
        venue: 'Smash Arena',
        payerId: demoMembers['Demo Admin'],
        createdByUserId: demoUser.id,
        participants: { create: all.map((id: string) => ({ memberId: id })) },
      },
    });
    await prisma.activity.create({
      data: {
        bookId: demoBook.id,
        type: 'EQUIPMENT',
        note: 'Shuttlecocks (Yonex Mavis 350)',
        amount: 72000,
        date: new Date('2026-08-24T10:00:00+05:30'),
        payerId: demoMembers['Hamid'],
        createdByUserId: demoUser.id,
        participants: { create: all.map((id: string) => ({ memberId: id })) },
      },
    });
    await prisma.activity.create({
      data: {
        bookId: demoBook.id,
        type: 'FOOD_DRINKS',
        note: 'Post-game refreshments',
        amount: 52000,
        date: new Date('2026-08-26T20:30:00+05:30'),
        payerId: demoMembers['Ravi'],
        createdByUserId: demoUser.id,
        participants: {
          create: [demoMembers['Demo Admin'], demoMembers['Hamid'], demoMembers['Ravi']].map((id: string) => ({ memberId: id })),
        },
      },
    });
    await prisma.payment.create({
      data: {
        bookId: demoBook.id,
        fromId: demoMembers['Ravi'],
        toId: demoMembers['Demo Admin'],
        amount: 35000,
        mode: 'UPI',
        note: 'Part settlement for court booking',
        status: 'PENDING',
        createdByUserId: demoUser.id,
      },
    });
  }

  console.log('Seed complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
