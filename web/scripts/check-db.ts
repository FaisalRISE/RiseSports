/* Can we actually log in to the database?
 *
 * Written during the Supabase cutover, when the only way to test a password was
 * to put it in Vercel, redeploy, wait for the build and read the server log —
 * five minutes a guess, with nothing to show for a wrong one but the same
 * opaque "password authentication failed".
 *
 * This asks the same question in ten seconds, from here, and connects EXACTLY
 * the way the app does (same driver, same options) so a pass here means a pass
 * there. Nothing is written, nothing is stored, and the password never leaves
 * this process.
 *
 *   pnpm db:check                      # prompts for the password, hidden
 *   pnpm db:check "postgresql://…"     # or check a whole connection string
 */

import { createInterface } from "node:readline";
import postgres from "postgres";

/* The parts already proven correct against the Rise Sports project, so a check
   only has to establish the one thing in doubt. */
const HOST = "aws-0-ap-south-1.pooler.supabase.com";
const USER = "postgres.utfvjsvvbifwcektzrwj";
const PORT = 6543;
const DB = "postgres";

/** Ask for the password without echoing it to the terminal. */
function askHidden(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    process.stdout.write(prompt);
    /* readline has no "silent" mode; suppressing its echo is the documented
       workaround. The prompt above is already on screen. */
    (rl as unknown as { _writeToOutput: (s: string) => void })._writeToOutput = () => {};
    rl.question("", (answer) => {
      rl.close();
      process.stdout.write("\n");
      resolve(answer);
    });
  });
}

/** Innermost reason first — the driver's, not the wrapper's. */
function reason(e: unknown): string {
  const seen = new Set<unknown>();
  const chain: string[] = [];
  let cur: unknown = e;
  while (cur instanceof Error && !seen.has(cur) && chain.length < 5) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    const line = cur.message.split("\n")[0].trim();
    chain.push(typeof code === "string" && code ? `${code}: ${line}` : line);
    cur = cur.cause;
  }
  return chain.length ? chain.reverse().join("  ←  ") : String(e);
}

async function main() {
  const arg = process.argv[2];
  let url: string;

  if (arg) {
    url = arg.trim();
  } else {
    console.log(`\nChecking ${USER}@${HOST}:${PORT}/${DB}`);
    const pw = await askHidden("Database password (nothing will appear as you type): ");
    if (!pw) {
      console.error("\nNo password entered.");
      process.exit(1);
    }
    /* encodeURIComponent so a password with punctuation is checked as typed —
       the same escaping the connection string in Vercel needs. */
    url = `postgresql://${USER}:${encodeURIComponent(pw)}@${HOST}:${PORT}/${DB}`;

    if (pw !== pw.trim()) {
      console.warn("Note: what you entered has leading or trailing whitespace.");
    }
  }

  /* Exactly the app's connection — see src/lib/db/index.ts. */
  const sql = postgres(url, { prepare: false, max: 1, idle_timeout: 5, connect_timeout: 15 });

  try {
    const [row] = await sql`select current_user as who, current_database() as db, version() as v`;
    console.log("\n  CONNECTED");
    console.log(`  user     ${row.who}`);
    console.log(`  database ${row.db}`);
    console.log(`  server   ${String(row.v).split(" on ")[0]}`);

    const [t] = await sql`select count(*)::int as n from information_schema.tables where table_schema = 'public'`;
    console.log(`  tables   ${t.n} in public\n`);
    console.log("  This password works. Put the same one in Vercel's DATABASE_URL.\n");
  } catch (e) {
    console.error("\n  FAILED");
    console.error(`  ${reason(e)}\n`);
    console.error(
      "  28P01 means the password is wrong — the host, port and user are already known good.\n" +
        "  Reset it at Supabase → Database → Settings → Reset password, and try again here\n" +
        "  BEFORE putting it in Vercel.\n",
    );
    process.exitCode = 1;
  } finally {
    await sql.end({ timeout: 5 });
  }
}

main().catch((e) => {
  console.error(reason(e));
  process.exit(1);
});
