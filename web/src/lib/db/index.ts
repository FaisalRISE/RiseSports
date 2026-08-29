import "server-only";

import { drizzle as drizzleNeon, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/* Production: Neon over HTTP — one round trip per query, no connection to hold
 * open, which is what a serverless function wants. Provision with
 * `vercel install neon`, which sets DATABASE_URL on the project.
 *
 * Local development: set DATABASE_URL to `pglite://.pgdata` and the app runs on
 * PGlite (Postgres compiled to WASM, stored in that directory) with no server
 * and no cloud account. Same SQL, same constraints — it is real Postgres — so
 * the whole app can be exercised offline before Neon is provisioned.
 *
 * Initialised lazily so a build that never queries does not need DATABASE_URL.
 */

type Db = NeonHttpDatabase<typeof schema>;

let instance: Db | null = null;

function getDb(): Db {
  if (instance) return instance;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Either run `vercel install neon` and `vercel env pull .env.local`, " +
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

  instance = drizzleNeon(neon(url), { schema });
  return instance;
}

export const db = new Proxy({} as Db, {
  get: (_t, prop) => Reflect.get(getDb(), prop),
});

export { schema };
