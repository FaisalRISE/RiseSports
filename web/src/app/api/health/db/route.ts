import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

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
 * ── What the first version established, and what it left open ───────────
 * `select 1` answers in about 200ms warm. Meanwhile `/`, `/people` and
 * `/t/[slug]` return zero bytes for two minutes, and `/health` — a page with
 * the same layout, fonts and render path that queries nothing — answers in
 * 1.5s. So the pooler is fine and rendering is fine. What is left is the
 * queries the pages actually run, and they differ from `select 1` in one
 * visible way: PARAMETERS.
 *
 * The evidence for that came from the database's own view of a stuck backend,
 * caught mid-outage at five and a half minutes:
 *
 *     state: active   wait_event: ClientRead
 *     select "id","name","rise_best" from "people" ... limit $1
 *
 * `ClientRead` means the backend had received part of an extended-protocol
 * exchange and was waiting for the client to send the rest. It never did. A
 * statement timeout cannot fire on that, because nothing is executing — which
 * is exactly why the pages hang instead of erroring, and why `connect_timeout`
 * never fired either.
 *
 * ── So the probes are a LADDER, not one check ───────────────────────────
 * Each rung adds one thing, and each is timed on its own, so the answer names
 * the step that stops rather than "the database":
 *
 *     plain      select 1                 no parameters at all
 *     param      select $1::int           a parameter, no table
 *     table      count(*) from people     a table, no parameter
 *     both       ... from people limit $1 a table AND a parameter
 *
 * If `plain` and `table` pass while `param` and `both` hang, parameter binding
 * over the transaction pooler is the fault and nothing about the tables or the
 * network is. If all four pass, the fault is above the driver.
 *
 * ── What it deliberately does not say ───────────────────────────────────
 * A driver error message can carry the host and username. This is a public URL
 * on a public site, so credentials are stripped from any message before it is
 * passed through, and nothing here reports a host, a user or a password.
 */

export const dynamic = "force-dynamic";
export const revalidate = 0;

/* Short on purpose. A hanging rung must not hold the response for the whole
   function budget — four rungs at 6s still answers inside any page timeout. */
const RUNG_MS = 6_000;

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

type Rung = { name: string; ok: boolean; ms: number; reason?: string; code?: string | null };

async function rung(name: string, run: () => Promise<unknown>): Promise<Rung> {
  const started = Date.now();
  const give_up = Symbol("timeout");
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const clock = new Promise<typeof give_up>((resolve) => {
      timer = setTimeout(() => resolve(give_up), RUNG_MS);
    });
    const outcome = await Promise.race([run(), clock]);
    const ms = Date.now() - started;
    if (outcome === give_up) return { name, ok: false, ms, reason: "timeout" };
    return { name, ok: true, ms };
  } catch (e) {
    const err = rootCause(e);
    return {
      name,
      ok: false,
      ms: Date.now() - started,
      reason: scrub(err.message ?? (e as Error).message ?? String(e)).slice(0, 200),
      code: err.code ?? err.errno ?? null,
    };
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function GET() {
  /* Sequential, not Promise.all. The client is `max: 1`, so concurrent queries
     queue on one connection and a rung that hangs would be blamed on whichever
     rung happened to be behind it. */
  const rungs: Rung[] = [];
  rungs.push(await rung("plain", () => db.execute(sql`select 1 as one`)));
  rungs.push(await rung("param", () => db.execute(sql`select ${1}::int as one`)));
  rungs.push(await rung("table", () => db.execute(sql`select count(*) from people`)));
  rungs.push(
    await rung("both", () => db.execute(sql`select id from people limit ${1}`)),
  );

  const stopped = rungs.find((r) => !r.ok);
  return Response.json(
    {
      ok: !stopped,
      /* Said in words, because the point of this route is to be read by
         somebody who is not going to interpret a driver code. */
      verdict: !stopped
        ? "Every kind of query works from here."
        : stopped.name === "param" || stopped.name === "both"
          ? "Queries with a PARAMETER stop; queries without one work. The fault " +
            "is parameter binding over the pooler, not the tables or the network."
          : `Stopped at "${stopped.name}".`,
      rungs,
    },
    { status: stopped ? 503 : 200, headers: { "cache-control": "no-store" } },
  );
}
