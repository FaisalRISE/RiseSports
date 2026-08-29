/* pnpm seed — fills the configured database with demo data. */
import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import * as schema from "../src/lib/db/schema";
import { seed } from "../src/lib/db/seed";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Run `vercel env pull .env.local` first.");
  process.exit(1);
}

const db = drizzle(neon(url), { schema });

seed(db as never)
  .then((r) => {
    console.log("Seeded:");
    for (const slug of r.slugs) console.log(`  http://localhost:3000/t/${slug}`);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
