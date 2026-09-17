import "server-only";

import { count, sql } from "drizzle-orm";
import { db } from "./index";
import { people, tournaments } from "./schema";

/* The connection ladder, in one place because two callers need the same rungs.
 *
 * A Route Handler runs it at /api/health/db and a PAGE runs it at /health/db,
 * and the whole value is that the two are compared. Written twice they would
 * drift, and then a difference between them would be the test's own and not the
 * app's — which is the one thing this must never do.
 *
 * Each rung adds one thing and is timed alone, so the answer names the step
 * that stops rather than "the database":
 *
 *   plain   select 1                  no parameters at all
 *   param   select $1::int            a parameter, no table
 *   table   count(*) from people      a table, no parameter
 *   both    ... from people limit $1  a table AND a parameter
 *
 * Every one of those passes from a route AND from a page, in about 200ms warm,
 * while `/`, `/people`, `/play`, `/ledger`, `/t/[slug]` and `/e/[slug]` all
 * return zero bytes — and `/new`, the only page that queries nothing, answers
 * in 440ms. So it is not the pooler, not the network, not rendering, and not
 * querying from a page. What is left is one difference between this file and
 * every real page: the four rungs above are RAW SQL, and every page in the app
 * uses drizzle's schema query builder.
 *
 *   builder select id from people limit 1  the builder, one table
 *   count   count() from people            drizzle's count() helper
 *   order   tournaments ordered            the home page's own first query
 *
 * Sequential, never Promise.all. When these were written the client was
 * `max: 1`, so concurrent queries queued on one connection and a rung that hung
 * would have been blamed on whichever rung sat behind it. The pool is `max: 8`
 * now; running the rungs one at a time still keeps each rung's timing its own.
 *
 * Short rung budget on purpose. A hanging rung must not hold the response for
 * the whole function budget — four rungs at six seconds still answers inside
 * any page timeout, and "timeout" is itself the finding.
 */

const RUNG_MS = 6_000;

export type Rung = {
  name: string;
  ok: boolean;
  ms: number;
  reason?: string;
  code?: string | null;
  /* What the rung read back, when the VALUE is the finding rather than
     whether it answered — the session's own timeout settings, for instance. */
  note?: string;
};

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

async function rung(
  name: string,
  run: () => Promise<unknown>,
  describe?: (result: unknown) => string,
): Promise<Rung> {
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
    return { name, ok: true, ms, note: describe?.(outcome) };
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

export async function climb(): Promise<Rung[]> {
  const rungs: Rung[] = [];
  rungs.push(await rung("plain", () => db.execute(sql`select 1 as one`)));
  rungs.push(await rung("param", () => db.execute(sql`select ${1}::int as one`)));
  rungs.push(await rung("table", () => db.execute(sql`select count(*) from people`)));
  rungs.push(await rung("both", () => db.execute(sql`select id from people limit ${1}`)));

  /* The builder, which is the only thing the working probes have never used and
     every hanging page does. Same tables, same connection — the difference is
     drizzle's schema layer rather than a hand-written string. */
  rungs.push(
    await rung("builder", () => db.select({ id: people.id }).from(people).limit(1)),
  );
  rungs.push(await rung("count", () => db.select({ n: count() }).from(people)));
  /* The home page's own first query, verbatim — a full row select with an
     order by, which is where it stops answering. */
  rungs.push(
    await rung("order", () =>
      db.select().from(tournaments).orderBy(sql`${tournaments.createdAt} desc`),
    ),
  );

  /* ── The last rung, and the one every other rung was built to isolate ──
   * Every rung above runs ALONE, which is how they were written: the client was
   * `max: 1` then, so concurrent queries queued on one connection and a hanging
   * rung would have been blamed on whichever sat behind it. That caution is why
   * the probes passed for hours while every real page hung.
   *
   * Because the pages do the opposite. `Promise.all` over three queries is in
   * the home page, /people, /play, /e/[slug], and in the stores behind /ledger
   * and /t/[slug] — and /new, the one page in the app that never runs queries
   * concurrently, is the one page still answering. Seven for seven.
   *
   * So this rung runs three at once, exactly as a page does. If it hangs where
   * the same three passed one at a time, concurrency on a single pooled
   * connection is the whole outage. (It was: the pool is `max: 8` since.)
   *
   * Deliberately THREE and not nine. A rung wide enough to exceed the pool
   * would reproduce the wedge — on a public route, on the instance serving the
   * site. A health check must never be able to cause the outage it reports.
   * The wide case is guarded statically instead, by db-fanout.test.ts. */
  rungs.push(
    await rung("concurrent", () =>
      Promise.all([
        db.select({ n: count() }).from(people),
        db.select({ id: people.id }).from(people).limit(1),
        db.select().from(tournaments).limit(1),
      ]),
    ),
  );
  /* ── What limits is this session actually running under? ──────────────
   * `select 1` came back `57014: canceling statement due to statement timeout`
   * in 945ms — while seven heavier rungs passed on either side of it. The
   * database's global statement_timeout is 120000ms and the `postgres` role
   * carries no override, so nothing in the database's own configuration can
   * cancel a `select 1` inside a second.
   *
   * Which means the limit is being set on the way in, and the session is the
   * only thing that can be asked. Postgres reports its own effective values,
   * so this stops the guessing: whatever number comes back is the number the
   * app is really given, whoever set it. */
  rungs.push(
    await rung(
      "limits",
      () =>
        db.execute(
          sql`select current_setting('statement_timeout') as stmt,
                     current_setting('idle_in_transaction_session_timeout') as idle,
                     current_user as who,
                     current_setting('application_name') as app`,
        ),
      (r) => {
        const row = (Array.isArray(r) ? r[0] : (r as { rows?: unknown[] })?.rows?.[0]) as
          | Record<string, unknown>
          | undefined;
        if (!row) return "no row";
        return `statement_timeout=${row.stmt} idle_in_txn=${row.idle} user=${row.who} app=${row.app}`;
      },
    ),
  );

  /* The home page's remaining query, which no rung has covered: a count over
     `matches` filtered on jsonb. Every other query it makes now has a rung. */
  rungs.push(
    await rung("jsonb", () =>
      db.execute(
        sql`select count(*) from matches
            where (typed_score_a is not null or jsonb_array_length(log) > 0)`,
      ),
    ),
  );

  return rungs;
}

export function verdict(rungs: Rung[]): string {
  const stopped = rungs.find((r) => !r.ok);
  if (!stopped) return "Every kind of query works from here.";
  if (stopped.name === "param" || stopped.name === "both") {
    return (
      "Queries with a PARAMETER stop; queries without one work. The fault is " +
      "parameter binding over the pooler, not the tables or the network."
    );
  }
  if (stopped.name === "concurrent") {
    return (
      "Every query passes ALONE and three at once hang. That is the 2026-09-15 " +
      "outage: concurrent queries pipelined onto one pooled connection. Check the " +
      "pool in lib/db/index.ts is still max: 8 and has not been lowered."
    );
  }
  if (stopped.name === "builder" || stopped.name === "count" || stopped.name === "order") {
    return (
      "Raw SQL works and drizzle's query BUILDER does not, on the same tables " +
      "and the same connection. The fault is above the driver."
    );
  }
  return `Stopped at "${stopped.name}".`;
}
