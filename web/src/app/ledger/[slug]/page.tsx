import Link from "next/link";
import { notFound } from "next/navigation";

import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { describeDbError, describeDbTarget } from "@/lib/db/error";
import { loadBook, balancesOf } from "@/lib/ledger/store";
import { LEDGER_TYPES, ledgerMoney, ledgerShares, ledgerTypeMeta } from "@/lib/finance";
import { localISO } from "@/lib/community";
import { currentMemberId } from "../actions";
import { BookView, type EntryView, type MemberView, type PairView, type PaymentView, type TransferView } from "./BookView";

export const dynamic = "force-dynamic";

export default async function BookPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  /* An unreachable database is not the same thing as a book that does not
     exist, and answering both with a 500 is what /play/[slug] used to do. */
  let loaded;
  try {
    /* The book id is needed to read the per-book "viewing as" cookie, and the
       cookie is needed to load the book from that member's side — so it loads
       once to find the id, then again from the right side. Two cheap reads
       beats threading a slug-keyed cookie through the store. */
    const first = await loadBook(slug, null);
    if (!first) notFound();
    const meId = await currentMemberId(first.row.id);
    loaded = meId ? (await loadBook(slug, meId)) ?? first : first;
  } catch (e) {
    const reason = describeDbError(e);
    console.error("[db]", reason, "||", describeDbTarget());
    return (
      <>
        <OpenAccessBanner />
        <main className="mx-auto max-w-3xl p-4 sm:p-6">
          <Link href="/ledger" className="text-xs font-bold text-neutral-400 hover:underline">← All books</Link>
          <div className="mt-4 rounded-xl border border-rose-500 bg-rose-500/10 p-4 text-sm text-rose-200">
            <p className="font-bold">The database is not reachable.</p>
            <p className="mt-2 font-mono text-[11px] text-rose-400/70">{reason}</p>
          </div>
        </main>
      </>
    );
  }

  /* Every number below comes from lib/finance. Nothing is recomputed here, and
     no money arithmetic crosses to the browser. */
  const { balances, pairs, settleUp, pending } = balancesOf(loaded);
  const nameOf = new Map(loaded.members.map((m) => [m.id, m.name]));
  const meId = loaded.book.members.find((m) => m.me)?.id ?? null;
  const myBalance = meId ? balances[meId] ?? 0 : 0;

  const members: MemberView[] = loaded.members.map((m) => ({
    id: m.id, name: m.name, balance: balances[m.id] ?? 0, isMe: m.id === meId,
  }));

  const entries: EntryView[] = loaded.entries.map((e) => {
    const meta = ledgerTypeMeta(e.type);
    /* The per-head figure the list shows is the REAL share for this entry, from
       the engine — not amount ÷ heads, which hides the odd-paise rule. */
    const shares = ledgerShares(loaded.book, {
      id: e.id, amount: e.amount, payerId: e.payerId, participantIds: e.participantIds,
    });
    const first = e.participantIds[0];
    return {
      id: e.id,
      amount: e.amount,
      money: ledgerMoney(e.amount),
      payerId: e.payerId,
      payerName: nameOf.get(e.payerId) ?? "Unknown",
      participantIds: e.participantIds,
      type: e.type,
      emoji: meta.emoji,
      label: meta.label,
      note: e.note,
      venue: e.venue,
      date: e.date,
      perHead: ledgerMoney(first ? shares[first] ?? 0 : 0),
    };
  });

  const transfers: TransferView[] = settleUp.map((t) => ({
    from: t.from, to: t.to,
    fromName: nameOf.get(t.from) ?? "Unknown",
    toName: nameOf.get(t.to) ?? "Unknown",
    money: ledgerMoney(t.amount),
  }));

  /* `ledgerNet(m, a, b)` is how much A OWES B — `ledgerOwedMap` keys as
     m[debtor][creditor], and `ledgerBalances` sums net(other, me) to get
     "positive means others owe them". So a POSITIVE net makes A the debtor.
     I had this backwards first time and the screen said "You owes Nadeem"
     directly above a settle-up row reading "Nadeem pays You". */
  const pairViews: PairView[] = pairs
    .filter((p) => p.net !== 0)
    .map((p) => {
      const debtor = p.net > 0 ? p.a : p.b;
      const creditor = p.net > 0 ? p.b : p.a;
      return {
        debtorName: nameOf.get(debtor) ?? "Unknown",
        creditorName: nameOf.get(creditor) ?? "Unknown",
        money: ledgerMoney(Math.abs(p.net)),
      };
    });

  const pendingViews: PaymentView[] = pending.map((p) => ({
    id: p.id,
    fromName: nameOf.get(p.fromId) ?? "Unknown",
    toName: nameOf.get(p.toId) ?? "Unknown",
    toId: p.toId,
    money: ledgerMoney(p.amount),
    method: p.method,
    note: p.note,
    date: p.date,
  }));

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <Link href="/ledger" className="text-xs font-bold text-neutral-400 hover:underline">← All books</Link>
        <header className="mb-4 mt-2">
          <h1 className="text-2xl font-black leading-tight">{loaded.row.name}</h1>
          <p className="text-sm text-neutral-400">
            {loaded.members.length} member{loaded.members.length === 1 ? "" : "s"}
            {meId ? ` · reading as ${nameOf.get(meId)}` : ""}
          </p>
        </header>

        <BookView
          slug={slug}
          members={members}
          entries={entries}
          settleUp={transfers}
          pairs={pairViews}
          pending={pendingViews}
          myBalance={myBalance}
          myBalanceLabel={ledgerMoney(Math.abs(myBalance))}
          today={localISO(new Date())}
          /* One source of truth for the categories: the picker and the entries
             list must never disagree about what a Court Booking looks like. */
          types={Object.entries(LEDGER_TYPES).map(([id, m]) => ({ id, ...m }))}
        />
      </main>
    </>
  );
}
