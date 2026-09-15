import "server-only";

import { drizzle as drizzlePostgres, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/* The database connection.
 *
 * ── Why postgres-js and NOT the Neon HTTP driver ─────────────────────────
 * This used to be `drizzle-orm/neon-http`, which looks ideal for serverless —
 * one round trip per query, no connection to hold open. It cannot open a
 * transaction. The driver contains, literally:
 *
 *     async transaction() { throw new Error("No transactions support in neon-http driver"); }
 *
 * The app opens transactions in four places: submitting a registration,
 * approving one into a team, and applying and reverting ratings. All four would
 * have thrown on the first real deployment — and the rating ones sit inside a
 * try/catch, so they would have failed SILENTLY, with matches finishing and
 * ratings never moving.
 *
 * It went unnoticed for three milestones because every test and every e2e run
 * uses PGlite, which supports transactions. Nothing had ever run against the
 * production driver. **Do not swap this back for an HTTP driver** without
 * checking that every `db.transaction()` in the codebase still works.
 *
 * ── prepare: false ───────────────────────────────────────────────────────
 * Production points at Supabase's TRANSACTION POOLER (pgBouncer, port 6543),
 * because a serverless function opens a connection per request and would
 * exhaust a direct one. pgBouncer in transaction mode does not support prepared
 * statements, which postgres-js uses by default — so they are turned off. It
 * does support transactions, which is the thing that actually matters here.
 *
 * ── Local development ────────────────────────────────────────────────────
 * Set DATABASE_URL to `pglite://.pgdata` and the app runs on PGlite (Postgres
 * compiled to WASM, stored in that directory) with no server and no cloud
 * account. Same SQL, same constraints, same transaction behaviour as the
 * driver above — which is the point: local and production should not disagree.
 *
 * Initialised lazily so a build that never queries does not need DATABASE_URL.
 *
 * ── Why the instance hangs off globalThis ────────────────────────────────
 * A module-level `let` is one instance per MODULE COPY, not per process, and
 * Next gives a Route Handler its own copy of the module graph. So a page and a
 * route handler in the same server each built their own client — and on PGlite,
 * which is a single-process embedded database, two clients opened the same
 * directory. The symptoms were a route handler that could not see a tournament
 * the pages could (it was reading its own older snapshot), and then
 * `RuntimeError: Aborted()` out of the WASM as the two writers collided.
 *
 * Neither is hypothetical and neither announced itself: the first looked like a
 * missing row, the second like a corrupt database. `globalThis` is one instance
 * per PROCESS, which is what "the connection" was always meant to mean. It also
 * stops `next dev` leaking a new pool on every hot reload.
 */

type Db = PostgresJsDatabase<typeof schema>;

const KEY = Symbol.for("rise.db");
type Holder = { [KEY]?: Db };

function getDb(): Db {
  const holder = globalThis as unknown as Holder;
  const existing = holder[KEY];
  if (existing) return existing;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Point it at your Postgres connection string " +
        "(Supabase: Settings → Database → Connection string → Transaction pooler), " +
        "or set DATABASE_URL=pglite://.pgdata to run on a local file-backed Postgres.",
    );
  }

  if (url.startsWith("pglite:")) {
    /* Required lazily and kept out of the bundle via serverExternalPackages, so
       the WASM build never ships to production. */
    const req = eval("require") as NodeRequire;
    const { PGlite } = req("@electric-sql/pglite");
    const { drizzle: drizzlePglite } = req("drizzle-orm/pglite");
    const dir = url.replace(/^pglite:\/\//, "") || ".pgdata";
    const pglite = drizzlePglite(new PGlite(dir), { schema }) as unknown as Db;
    holder[KEY] = pglite;
    return pglite;
  }

  const client = postgres(url, {
    prepare: false,

    /* ── Why this is not 1, which cost a day ─────────────────────────────
     * It was `max: 1`, with the reasoning that a serverless invocation
     * handles one request and freezes, so one connection each is what the
     * pooler is designed for. That is true of CONNECTIONS and false of
     * QUERIES, and the gap between those two took the whole site down on
     * 2026-09-15.
     *
     * With one connection, `Promise.all` over three queries does not run
     * three queries — postgres-js pipelines all three down the same socket
     * back to back. Supavisor in TRANSACTION mode binds a client to a server
     * backend for the length of a transaction, and three independent implicit
     * transactions arriving interleaved on one socket wedge it: the backend
     * sits in `ClientRead` waiting for the rest of an exchange that never
     * comes, and the driver waits for a reply that never comes either.
     *
     * Every property of the outage follows from that, including the ones that
     * sent the search in the wrong direction for hours:
     *
     *  - It hangs rather than erroring. No statement is executing, so no
     *    statement_timeout can fire; the socket is open, so `connect_timeout`
     *    cannot either. The session reports the normal 2min timeout.
     *  - The query never reaches Postgres, so `pg_stat_activity` shows nothing
     *    running while a request hangs — which reads exactly like a database
     *    that is idle and healthy, because it is one.
     *  - ONE wedge kills the instance. The client is a per-process singleton
     *    (see above), so every later query queues behind the wedged one
     *    forever. Measured: a probe that passed seven rungs in 200ms each
     *    failed the eighth, then failed all of them.
     *  - Only pages that run queries CONCURRENTLY were affected — /, /people,
     *    /play, /ledger, /t/[slug], /e/[slug] — and /new, the one page that
     *    queries nothing, stayed up throughout.
     *  - It is intermittent per attempt, which is why it looked like a flaky
     *    network. Once it catches, the instance never recovers, which is why
     *    the site looked permanently down.
     *
     * So the pool has to cover the app's real concurrency instead. The widest
     * fan-out written down is four (`/t/[slug]/manage`); eight leaves room
     * without inviting a page to open twenty.
     *
     * Connections are opened ON DEMAND up to this number, so a page needing
     * one still opens one — this is a ceiling, not a reservation. The original
     * worry was not baseless though: many concurrent invocations each holding
     * several pooler clients is a real limit to watch if traffic ever arrives.
     * Supavisor's per-tenant client limit is the number to check then, not
     * Postgres's 60 backends, which the pooler exists to multiplex.
     *
     * **A `Promise.all` over a mapped list is still the hazard here.** Three
     * sites map an unbounded array into concurrent queries; past eight they
     * queue and pipeline again. Prefer a sequential loop for those. */
    max: 8,
    idle_timeout: 20,

    /* ── A query that cannot run must FAIL, not hang ──────────────────────
     * Observed 2026-09-15: every database-backed page stopped answering —
     * no error, no 500, just an open socket until the client gave up, while
     * static files served instantly and the database itself was healthy
     * (15 of 60 connections, nothing stuck, the same queries instant through
     * Supabase's own API). Intermittent: roughly one request in four returned
     * normally in under two seconds.
     *
     * Whatever the cause upstream, hanging is the app's own fault. postgres-js
     * waits FOREVER by default, so a connection the pooler has quietly dropped
     * never errors and never gets replaced — and every page that could have
     * told somebody what was wrong was the page that hung. The home page
     * already renders a "database is not reachable" panel with the real
     * message; it had no way to fire.
     *
     * `connect_timeout` turns an unreachable pooler into an error in ten
     * seconds. `max_lifetime` retires a connection periodically rather than
     * holding one open indefinitely on a warm instance — a long-lived client
     * against a TRANSACTION pooler is exactly the thing that goes stale, and
     * this client is now one per process by design (see the note above). */
    connect_timeout: 10,
    max_lifetime: 60 * 15,
  });
  const pg = drizzlePostgres(client, { schema });
  holder[KEY] = pg;
  return pg;
}

export const db = new Proxy({} as Db, {
  get: (_t, prop) => Reflect.get(getDb(), prop),
});

export { schema };
