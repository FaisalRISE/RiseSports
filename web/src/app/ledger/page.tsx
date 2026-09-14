import Link from "next/link";

import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { describeDbError, describeDbTarget } from "@/lib/db/error";
import { listBooks } from "@/lib/ledger/store";
import { ledgerMoney } from "@/lib/finance";
import { NewBookForm } from "./NewBookForm";

export const dynamic = "force-dynamic";

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  let books: Awaited<ReturnType<typeof listBooks>> = [];
  let dbError: string | null = null;
  try {
    books = await listBooks();
  } catch (e) {
    dbError = describeDbError(e);
    console.error("[db]", dbError, "||", describeDbTarget());
  }

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <header className="mb-5">
          <h1 className="text-3xl font-black tracking-tight">Ledger</h1>
          <p className="text-sm text-neutral-400">
            Who paid for what, and who owes whom.
          </p>
        </header>

        {error && (
          <p className="mb-4 rounded-xl border border-rose-500 bg-rose-500/10 p-3 text-sm font-bold text-rose-300">
            {error}
          </p>
        )}

        {dbError && (
          <div className="mb-4 rounded-xl border border-rose-500 bg-rose-500/10 p-4 text-sm text-rose-200">
            <p className="font-bold">The database is not reachable.</p>
            <p className="mt-2 font-mono text-[11px] text-rose-400/70">{dbError}</p>
          </div>
        )}

        {!dbError && <NewBookForm />}

        <ul className="mt-4 space-y-2">
          {books.map(({ row, memberCount, entryCount, myBalance }) => (
            <li key={row.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60">
              <Link href={`/ledger/${row.slug}`} className="flex items-center gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{row.name}</p>
                  <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                    {memberCount} member{memberCount === 1 ? "" : "s"} ·{" "}
                    {entryCount} {entryCount === 1 ? "entry" : "entries"}
                  </p>
                </div>
                {/* The number somebody opens a ledger to see. */}
                <div className="shrink-0 text-right">
                  <p className={`text-lg font-black tabular-nums ${
                    myBalance > 0 ? "text-emerald-400" : myBalance < 0 ? "text-rose-400" : "text-neutral-500"
                  }`}>
                    {ledgerMoney(Math.abs(myBalance))}
                  </p>
                  <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    {myBalance > 0 ? "you are owed" : myBalance < 0 ? "you owe" : "settled"}
                  </p>
                </div>
              </Link>
            </li>
          ))}

          {!dbError && books.length === 0 && (
            <li className="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-sm text-neutral-500">
              No books yet. A book is one group&rsquo;s shared spending — court fees, shuttles,
              dinner — and who paid for what.
            </li>
          )}
        </ul>
      </main>
    </>
  );
}
