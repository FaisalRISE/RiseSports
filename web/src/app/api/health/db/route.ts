import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/* Can the app reach Postgres, and if not, at which step does it stop?
 *
 * ── Why a route and not the `db:check` script ────────────────────────────
 * CLAUDE.md records that telling "the pooler is broken" from "our code is
 * broken" needs one test: connect with the SAME driver and the SAME options
 * the app uses. The script that does this (`npm run db:check`) needs the
 * database password, so it was Faisal's to run and nobody's to automate.
 *
 * Vercel already holds that password. Running the check INSIDE the deployment
 * asks exactly the same question from exactly the right place — the serverless
 * instance, through the pooler, with the app's own client — and needs nobody to
 * type a secret anywhere.
 *
 * ── The timeout is the whole point ──────────────────────────────────────
 * `connect_timeout` only covers opening the socket. Supavisor's logs during
 * the outage show clients AUTHENTICATING and then never being handed a
 * database backend, which is past the point `connect_timeout` guards: the
 * socket is open, so postgres-js waits forever for a reply that never comes.
 * That is why the pages hung rather than erroring, and why this probe has to
 * race its own timer instead of trusting the driver to give up.
 *
 * So the answer separates three outcomes that look identical from outside:
 *
 *   ok                      → the path is fine; look elsewhere
 *   error + a driver code   → it refused, and said why (auth, DNS, refused)
 *   timeout + elapsed ms    → it accepted us and went silent — the pooler
 *
 * ── What it deliberately does not say ───────────────────────────────────
 * A driver error message can carry the host and username. This is a public URL
 * on a public site, so the message is passed through only after the connection
 * string's own credentials are stripped out of it.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

const BUDGET_MS = 20_000;

/** Never let a connection string's user:password reach a public response. */
function scrub(text: string): string {
  return text.replace(/\/\/[^@\s/]+@/g, "//***@");
}

/* Drizzle rethrows a driver failure wrapped in its own error, whose message is
   always "Failed query: <sql>" — the SQL we already knew, and nothing about why
   it failed. The driver's error, with the code that names the fault, is on
   `cause`. Walk to the end of that chain. */
function rootCause(e: unknown): { code?: string; errno?: string; message?: string } {
  let cur = e as { cause?: unknown; code?: string; errno?: string; message?: string };
  for (let hop = 0; hop < 5 && cur?.cause; hop++) {
    cur = cur.cause as typeof cur;
  }
  return cur ?? {};
}

export async function GET() {
  const started = Date.now();
  const give_up = Symbol("timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    const probe = db.execute(sql`select 1 as one`);
    const clock = new Promise<typeof give_up>((resolve) => {
      timer = setTimeout(() => resolve(give_up), BUDGET_MS);
    });
    const outcome = await Promise.race([probe, clock]);
    const ms = Date.now() - started;

    if (outcome === give_up) {
      return Response.json(
        {
          ok: false,
          stage: "query",
          reason: "timeout",
          ms,
          /* Said in words, because the point of this route is to be read by
             somebody who is not going to interpret a driver code. */
          means:
            "The socket opened and the server never answered. That is the pooler " +
            "holding the connection without handing it a database backend.",
        },
        { status: 503, headers: { "cache-control": "no-store" } },
      );
    }

    return Response.json(
      { ok: true, stage: "query", ms },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (e) {
    const ms = Date.now() - started;
    const err = rootCause(e);
    const wrapper = (e as { message?: string }).message ?? String(e);
    return Response.json(
      {
        ok: false,
        stage: "connect",
        reason: "error",
        code: err.code ?? err.errno ?? null,
        message: scrub(err.message ?? wrapper).slice(0, 300),
        ms,
      },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  } finally {
    /* The probe may still be pending; the timer must not keep the instance
       awake waiting to resolve a promise nobody is reading any more. */
    if (timer) clearTimeout(timer);
  }
}
