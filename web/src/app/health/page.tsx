/* A PAGE that touches no database.
 *
 * `/api/health/db` opens a real connection through the pooler and runs
 * `select 1` in about 1.2 seconds, while `/`, `/people` and `/t/[slug]` return
 * nothing at all for two minutes. So "the database is unreachable" is no longer
 * a story that fits: the database path works from the same deployment, in the
 * same region, through the same driver.
 *
 * The other difference between those two is everything a PAGE does and a Route
 * Handler does not — the root layout, the fonts, the React render, the streamed
 * response. This page is the same shape as the hanging ones and queries
 * nothing, which separates the two halves:
 *
 *   answers          → rendering is fine; the fault is a query made FROM a page
 *   hangs            → the fault is in rendering, and no database work is
 *                      involved in it at all
 *
 * Kept after the diagnosis: it costs one static-ish route and is the first
 * thing worth hitting the next time the site goes quiet.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default function HealthPage() {
  return (
    <main className="mx-auto max-w-lg p-6">
      <h1 className="text-2xl font-black">Rendering works</h1>
      <p className="mt-2 text-sm text-neutral-400">
        This page ran on the server just now and asked the database nothing.
      </p>
      <dl className="mt-4 space-y-1 font-mono text-[11px] text-neutral-500">
        <div>
          <dt className="inline">rendered: </dt>
          <dd className="inline">{new Date().toISOString()}</dd>
        </div>
        <div>
          <dt className="inline">commit: </dt>
          <dd className="inline">{process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? "local"}</dd>
        </div>
        <div>
          <dt className="inline">region: </dt>
          <dd className="inline">{process.env.VERCEL_REGION ?? "local"}</dd>
        </div>
      </dl>
    </main>
  );
}
