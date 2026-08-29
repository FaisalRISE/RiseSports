import "server-only";

import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "./schema";

/* Neon over HTTP: one round trip per query with no connection to hold open,
 * which is what a serverless function wants. Provision with `vercel install
 * neon`, which sets DATABASE_URL on the project.
 *
 * Initialised lazily so a build (or a unit test) that never touches the
 * database does not need DATABASE_URL — only an actual query does. */

let instance: NeonHttpDatabase<typeof schema> | null = null;

function getDb(): NeonHttpDatabase<typeof schema> {
  if (instance) return instance;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Run `vercel install neon`, then `vercel env pull .env.local`.",
    );
  }
  instance = drizzle(neon(url), { schema });
  return instance;
}

export const db = new Proxy({} as NeonHttpDatabase<typeof schema>, {
  get: (_t, prop) => Reflect.get(getDb(), prop),
});

export { schema };
