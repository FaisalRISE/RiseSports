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
 */

type Db = PostgresJsDatabase<typeof schema>;

let instance: Db | null = null;

function getDb(): Db {
  if (instance) return instance;

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
    instance = drizzlePglite(new PGlite(dir), { schema }) as unknown as Db;
    return instance;
  }

  const client = postgres(url, {
    prepare: false,
    /* A serverless invocation handles one request and freezes. A large pool per
       instance would multiply across concurrent invocations and exhaust the
       pooler; one connection each is what the pooler is designed for. */
    max: 1,
    idle_timeout: 20,
  });
  instance = drizzlePostgres(client, { schema });
  return instance;
}

export const db = new Proxy({} as Db, {
  get: (_t, prop) => Reflect.get(getDb(), prop),
});

export { schema };
