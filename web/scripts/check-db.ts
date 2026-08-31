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

import postgres from "postgres";

/* The parts already proven correct against the Rise Sports project, so a check
   only has to establish the one thing in doubt. */
const HOST = "aws-0-ap-south-1.pooler.supabase.com";
const USER = "postgres.utfvjsvvbifwcektzrwj";
const PORT = 6543;
const DB = "postgres";

/* Keys, as typed. */
const CTRL_C = "\u0003";
const CTRL_D = "\u0004";
const BACKSPACE = "\u007f";

/* Ask for the password without echoing it.
 *
 * This was readline with its private `_writeToOutput` overridden — the widely
 * copied trick. On a real Windows terminal it ATE THE PROMPT: readline redraws
 * the current line, the nulled writer drew nothing, and the question vanished,
 * leaving a blank screen with no way to tell a captured password from a dropped
 * one. It had looked fine under test because the test piped input, and piped
 * input never enters terminal mode — the same "tested the branch nobody uses"
 * mistake this whole cutover kept making.
 *
 * Reading the keys directly sidesteps readline's redraw, so the prompt stays
 * on screen and the input is unambiguous. */
function askHidden(prompt: string): Promise<string> {
  const stdin = process.stdin;

  /* Piped or redirected: take the first line, and do not touch raw mode, which
     does not exist without a terminal. */
  if (!stdin.isTTY) {
    return new Promise((resolve) => {
      let buf = "";
      stdin.setEncoding("utf8");
      stdin.on("data", (d: string) => {
        buf += d;
      });
      stdin.on("end", () => resolve(buf.split(/\r?\n/)[0]));
    });
  }

  return new Promise((resolve) => {
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");

    let typed = "";
    const finish = (value: string) => {
      stdin.setRawMode(false);
      stdin.pause();
      stdin.removeListener("data", onData);
      process.stdout.write("\n");
      resolve(value);
    };

    const onData = (chunk: string) => {
      for (const ch of chunk) {
        if (ch === "\r" || ch === "\n" || ch === CTRL_D) return finish(typed);
        if (ch === CTRL_C) {
          /* Raw mode swallows the usual interrupt, so honour it here or the
             terminal is left with its echo off. */
          stdin.setRawMode(false);
          process.stdout.write("\n");
          process.exit(130);
        }
        if (ch === BACKSPACE || ch === "\b") typed = typed.slice(0, -1);
        else if (ch >= " ") typed += ch;
      }
    };

    stdin.on("data", onData);
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

    /* How many characters arrived — never the characters themselves. A silent
       terminal gives no way to know whether every keystroke registered, and a
       count that disagrees with what you typed IS the answer. */
    console.log(`Read ${pw.length} characters.`);
    if (pw !== pw.trim()) {
      console.warn("Note: what you entered has leading or trailing whitespace.");
    }

    /* encodeURIComponent so a password with punctuation is checked exactly as
       the connection string in Vercel would need it written. */
    url = `postgresql://${USER}:${encodeURIComponent(pw)}@${HOST}:${PORT}/${DB}`;
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
        "  Check the character count above against what you meant to type, then reset at\n" +
        "  Supabase → Database → Settings → Reset password and try again HERE, before Vercel.\n",
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
