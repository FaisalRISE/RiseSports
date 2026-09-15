/* Is the server alive at all?
 *
 * ── Why this exists ──────────────────────────────────────────────────────
 * Observed 2026-09-15: every database-backed page stopped answering. Not a
 * 500, not a 504 — two full minutes with zero bytes returned, while
 * `/definitely-not-a-page` came back in 300ms. That 300ms proves nothing,
 * because Vercel serves its OWN static 404 for an unmatched path (the same
 * behaviour that made `/t/[slug]/schedule.csv` return a static 404 in
 * production and work perfectly under `next start`). So the fast response and
 * the hanging one were never compared like with like: one was a file, the
 * other a function.
 *
 * This route is the missing comparison — a FUNCTION that touches nothing.
 * If it answers while the pages hang, the fault is on the database path. If it
 * hangs too, the fault is in front of the app and no amount of connection
 * tuning will help.
 *
 * ── What it deliberately does not say ────────────────────────────────────
 * It reports whether DATABASE_URL is set and which PORT it points at, because
 * 6543 (transaction pooler) versus 5432 (session pooler) is the one thing worth
 * knowing and the one thing nobody can see from outside. It reports no
 * username, no password, no host. This is a public URL on a public site.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

export function GET() {
  const url = process.env.DATABASE_URL;

  /* The port, and nothing else, out of a string that also holds a password.
     Parsed defensively: a malformed URL must not throw a health check. */
  let port: string | null = null;
  let driver: string | null = null;
  if (url) {
    driver = url.startsWith("pglite:") ? "pglite" : "postgres";
    const m = /:(\d{2,5})\//.exec(url);
    port = m ? m[1] : null;
  }

  return Response.json(
    {
      ok: true,
      /* Not a clock reading anyone should subtract — just proof this ran now. */
      at: new Date().toISOString(),
      runtime: process.env.NEXT_RUNTIME ?? "nodejs",
      region: process.env.VERCEL_REGION ?? null,
      commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
      database: { configured: Boolean(url), driver, port },
    },
    { headers: { "cache-control": "no-store" } },
  );
}
