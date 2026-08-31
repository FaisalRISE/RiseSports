/* Applies the generated migrations, then seeds. Works against Neon or PGlite,
 * whichever DATABASE_URL points at. */
import fs from "node:fs";
import path from "node:path";
import { seed } from "../src/lib/db/seed";
import * as schema from "../src/lib/db/schema";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set. Try DATABASE_URL=pglite://.pgdata pnpm db:setup");
  process.exit(1);
}

async function main() {
  const statements = fs
    .readdirSync(path.resolve("drizzle"))
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .flatMap((f) =>
      fs.readFileSync(path.resolve("drizzle", f), "utf8").split("--> statement-breakpoint"),
    )
    .map((s) => s.trim())
    .filter(Boolean);

  if (url!.startsWith("pglite:")) {
    const { PGlite } = await import("@electric-sql/pglite");
    const { drizzle } = await import("drizzle-orm/pglite");
    const client = new PGlite(url!.replace(/^pglite:\/\//, "") || ".pgdata");
    for (const s of statements) await client.exec(s);
    await seed(drizzle(client, { schema }) as never);
  } else {
    /* postgres-js rather than an HTTP driver — see lib/db/index.ts for why:
       the HTTP one cannot open a transaction, and the seed writes several
       related rows. `prepare: false` for Supabase's pgBouncer pooler. */
    const { default: postgres } = await import("postgres");
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const sql = postgres(url!, { prepare: false, max: 1 });
    for (const s of statements) await sql.unsafe(s);
    await seed(drizzle(sql, { schema }) as never);
    await sql.end();
  }
  console.log("Database ready. Try /t/club-night and /t/osl-2026");
}

main().catch((e) => { console.error(e); process.exit(1); });
