import Link from "next/link";
import { desc } from "drizzle-orm";
import { db } from "@/lib/db";
import { describeDbError } from "@/lib/db/error";
import { tournaments } from "@/lib/db/schema";
import { sportOf } from "@/lib/sports/registry";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

export const dynamic = "force-dynamic";

export default async function Home() {
  let rows: (typeof tournaments.$inferSelect)[] = [];
  let dbError: string | null = null;
  try {
    rows = await db.select().from(tournaments).orderBy(desc(tournaments.createdAt));
  } catch (e) {
    dbError = describeDbError(e);
  }

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl p-4 sm:p-6">
        <header className="mb-6 flex items-end justify-between gap-4">
          <div>
            <h1 className="text-3xl font-black tracking-tight">RISE Sports</h1>
            <p className="text-sm text-neutral-400">Tournaments, scoring and ledgers.</p>
          </div>
          <div className="flex items-center gap-2">
            {/* The roster is the reference RiseR exists to be — it was only
                reachable by typing the URL. */}
            <Link
              href="/people"
              className="rounded-xl border border-neutral-700 px-4 py-2 text-sm font-bold text-neutral-200 hover:border-neutral-500"
            >
              Players
            </Link>
            <Link
              href="/new"
              className="rounded-xl bg-amber-400 px-4 py-2 text-sm font-black text-amber-950"
            >
              New tournament
            </Link>
          </div>
        </header>

        {dbError && (
          <div className="mb-4 rounded-xl border border-rose-500 bg-rose-500/10 p-4 text-sm text-rose-200">
            <p className="font-bold">The database is not reachable.</p>
            <p className="mt-1 text-rose-300/80">
              Check <code className="rounded bg-black/40 px-1">DATABASE_URL</code>. Locally that is{" "}
              <code className="rounded bg-black/40 px-1">pglite://.pgdata</code> plus{" "}
              <code className="rounded bg-black/40 px-1">pnpm db:setup</code>; in production it is the
              Supabase transaction pooler string, port 6543.
            </p>
            <p className="mt-2 font-mono text-[11px] text-rose-400/70">{dbError}</p>
          </div>
        )}

        <ul className="space-y-2">
          {rows.map((t) => {
            const sport = sportOf(t.sport);
            return (
              <li key={t.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60">
                <div className="flex items-center gap-3 p-4">
                  <span className="text-2xl" aria-hidden>{sport.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/t/${t.slug}`} className="block truncate font-bold hover:underline">
                      {t.name}
                    </Link>
                    <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
                      {sport.name}
                      {t.format === "osl" ? " · OSL team format" : ""}
                      {t.status === "draft" ? " · draft" : t.status === "open" ? " · entries open" : t.status === "live" ? " · live" : ""}
                    </p>
                  </div>
                  <Link
                    href={`/t/${t.slug}/manage`}
                    className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:border-neutral-500"
                  >
                    Manage
                  </Link>
                </div>
              </li>
            );
          })}
          {!dbError && rows.length === 0 && (
            <li className="rounded-xl border border-dashed border-neutral-800 p-10 text-center text-sm text-neutral-500">
              No tournaments yet. Create one, or run <code className="rounded bg-black/40 px-1">pnpm seed</code> for demo data.
            </li>
          )}
        </ul>
      </main>
    </>
  );
}
