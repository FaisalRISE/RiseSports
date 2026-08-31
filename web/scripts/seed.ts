/* pnpm seed — fills the configured database with demo data. */
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../src/lib/db/schema";
import { seed } from "../src/lib/db/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first, or set it to pglite://.pgdata.");
  process.exit(1);
}

const db = drizzle(postgres(url, { prepare: false, max: 1 }), { schema });

seed(db as never)
  .then((r) => {
    console.log("Seeded:");
    for (const slug of r.slugs) console.log(`  http://localhost:3000/t/${slug}`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
