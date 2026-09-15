import Link from "next/link";
import { count, desc, isNotNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { describeDbError, describeDbTarget } from "@/lib/db/error";
import { matches, people, tournaments } from "@/lib/db/schema";
import { sportOf } from "@/lib/sports/registry";
import { getTier } from "@/lib/rating";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { PersonLink } from "@/components/PersonLink";

export const dynamic = "force-dynamic";

type Top = { id: string; name: string; riseBest: number | null };

export default async function Home() {
  let rows: (typeof tournaments.$inferSelect)[] = [];
  let top: Top[] = [];
  let totals = { players: 0, matches: 0, tournaments: 0 };
  let dbError: string | null = null;
  try {
    rows = await db.select().from(tournaments).orderBy(desc(tournaments.createdAt));

    /* The numbers and the top five, as the original's home tab has them. One
       round of queries, all counted in the database rather than by loading rows
       and measuring the array. `count()` is drizzle's helper, which maps to
       Number — a hand-written count(*) comes back as a STRING from postgres-js
       and a number from PGlite, so it would read right locally and be wrong in
       production. */
    const [pc, mc, best] = await Promise.all([
      db.select({ n: count() }).from(people),
      /* Played, not drawn: a fixture nobody has turned up for is not a match
         that happened. */
      db
        .select({ n: count() })
        .from(matches)
        .where(sql`(${matches.typedScoreA} is not null or jsonb_array_length(${matches.log}) > 0)`),
      db
        .select({ id: people.id, name: people.name, riseBest: people.riseBest })
        .from(people)
        .where(isNotNull(people.riseBest))
        .orderBy(sql`${people.riseBest} desc nulls last`, people.name)
        .limit(5),
    ]);
    totals = {
      players: Number(pc[0]?.n ?? 0),
      matches: Number(mc[0]?.n ?? 0),
      tournaments: rows.length,
    };
    top = best;
  } catch (e) {
    dbError = describeDbError(e);
    /* The page gets the reason; the SERVER LOG also gets what was connected to.
       Which host and user a deployment uses is not for a public error page, and
       without it "password authentication failed" cannot tell a wrong password
       apart from a correct one the URL parser rewrote. */
    console.error("[db]", dbError, "||", describeDbTarget());
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

        {!dbError && totals.players > 0 && (
          <section className="mb-6 grid grid-cols-3 gap-2">
            {[
              { label: "Players", value: totals.players, href: "/people" },
              { label: "Matches", value: totals.matches, href: null },
              { label: "Events", value: totals.tournaments, href: null },
            ].map((s) => (
              <div key={s.label} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 text-center">
                <div className="font-mono text-2xl font-black tabular-nums">{s.value}</div>
                {s.href ? (
                  <Link href={s.href} className="text-[10px] font-bold uppercase tracking-widest text-neutral-500 hover:text-neutral-300">
                    {s.label}
                  </Link>
                ) : (
                  <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">{s.label}</div>
                )}
              </div>
            ))}
          </section>
        )}

        {top.length > 0 && (
          <section className="mb-6">
            <div className="mb-2 flex items-baseline justify-between">
              <h2 className="text-lg font-black">Top rated</h2>
              <Link href="/people" className="text-[11px] font-bold text-neutral-500 hover:text-neutral-300">
                the whole roster
              </Link>
            </div>
            <ol className="rounded-xl border border-neutral-800 bg-neutral-900/60">
              {top.map((p, i) => {
                const tier = p.riseBest == null ? null : getTier(p.riseBest);
                return (
                  <li key={p.id} className="flex items-center gap-3 border-b border-neutral-800 p-3 last:border-0">
                    <span className="w-4 shrink-0 text-center font-mono text-[11px] text-neutral-600">{i + 1}</span>
                    <PersonLink personId={p.id} name={p.name} className="min-w-0 flex-1 truncate text-sm font-bold" />
                    {tier && <span className="text-[11px] text-neutral-500">{tier.emoji} {tier.name}</span>}
                    <span className="font-mono text-lg font-black tabular-nums">{p.riseBest}</span>
                  </li>
                );
              })}
            </ol>
          </section>
        )}

        {rows.length > 0 && <h2 className="mb-2 text-lg font-black">Events</h2>}
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
