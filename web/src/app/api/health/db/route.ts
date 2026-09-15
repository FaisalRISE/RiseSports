import { climb, verdict } from "@/lib/db/probe";

/* Can the app reach Postgres, and if not, which KIND of query stops?
 *
 * ── Why a route and not the `db:check` script ────────────────────────────
 * CLAUDE.md records that telling "the pooler is broken" from "our code is
 * broken" needs one test: connect with the SAME driver and the SAME options
 * the app uses. The script that does this (`npm run db:check`) needs the
 * database password, so it was Faisal's to run and nobody's to automate.
 * Vercel already holds that password, so running the check INSIDE the
 * deployment asks the same question from the right place with no secret typed
 * anywhere.
 *
 * ── The pair, not the route ─────────────────────────────────────────────
 * The ladder itself is `lib/db/probe.ts`, and the point is that /health/db
 * runs the SAME rungs from a PAGE. Established so far: `/health` (a page that
 * queries nothing) renders in 1.5s, every rung here passes warm and cold, and
 * every page that queries returns zero bytes for two minutes — with no backend
 * ever appearing in `pg_stat_activity`, so those queries never reach Postgres
 * at all. Comparing this route with its page is what separates "a query made
 * from a page" from "those particular pages".
 *
 * ── What it deliberately does not say ───────────────────────────────────
 * A driver error message can carry the host and username. This is a public URL
 * on a public site, so credentials are stripped from any message before it is
 * passed through, and nothing here reports a host, a user or a password.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function GET() {
  const rungs = await climb();
  const stopped = rungs.some((r) => !r.ok);
  return Response.json(
    { ok: !stopped, from: "route handler", verdict: verdict(rungs), rungs },
    { status: stopped ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
