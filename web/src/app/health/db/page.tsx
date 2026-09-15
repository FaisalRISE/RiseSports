import { climb, verdict } from "@/lib/db/probe";

/* The same connection ladder, run from a PAGE.
 *
 * This is the twin of /api/health/db and exists only to be compared with it.
 * What is established so far:
 *
 *   /health           a page, no query        renders in 1.5s
 *   /api/health/db    a route, four queries   all four rungs pass, warm and cold
 *   /  /people  /t/…  pages that query        zero bytes in two minutes, and
 *                                            NO backend ever appears in
 *                                            pg_stat_activity — the queries
 *                                            never reach Postgres at all
 *
 * So rendering works and querying works, but not together, which should be
 * impossible. This page is the missing cell of that table: the same rungs, the
 * same driver, the same connection, reached through the page render path with
 * the root layout and the fonts in place.
 *
 *   it answers  → the fault is in what those particular pages import or do,
 *                 not in querying from a page
 *   it hangs    → querying from a page is the fault, and the difference from
 *                 the route handler is the whole search space
 *
 * Deliberately imports NOTHING but the ladder — no registry, no rating, no
 * banner. Every import it does not have is a suspect it cannot be confused
 * with.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function HealthDbPage() {
  const rungs = await climb();

  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-2xl font-black">
        {rungs.every((r) => r.ok) ? "Queries work from a page" : "A query stopped"}
      </h1>
      <p className="mt-2 text-sm text-neutral-400">{verdict(rungs)}</p>
      <ul className="mt-4 space-y-1 font-mono text-[11px]">
        {rungs.map((r) => (
          <li key={r.name} className={r.ok ? "text-neutral-500" : "text-rose-400"}>
            {r.ok ? "ok  " : "STOP"} {r.name} · {r.ms}ms
            {r.reason ? ` · ${r.reason}` : ""}
            {r.code ? ` · ${r.code}` : ""}
          </li>
        ))}
      </ul>
      <p className="mt-4 font-mono text-[11px] text-neutral-600">
        {process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"} ·{" "}
        {process.env.VERCEL_REGION ?? "local"}
      </p>
    </main>
  );
}
