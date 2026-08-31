import "server-only";

/* WHY a query failed, not WHICH query failed.
 *
 * Drizzle wraps every driver error in a DrizzleQueryError whose `message` is
 * "Failed query: select …  params: …" — the SQL, which you already knew — and
 * hangs the part you actually need off `cause`: ECONNREFUSED, ENOTFOUND,
 * CONNECT_TIMEOUT, "password authentication failed", SASL_SIGNATURE_MISMATCH.
 *
 * Printing `e.message` on an error page is therefore the worst of both worlds:
 * a paragraph of SQL and no reason. That is exactly what the first Supabase
 * deploy showed — a red box quoting the SELECT, with nothing to say whether the
 * host was wrong, the password was wrong, or the port was closed.
 */

/** One readable line for a database failure: innermost reason first. */
export function describeDbError(e: unknown): string {
  const seen = new Set<unknown>();
  const chain: string[] = [];

  let cur: unknown = e;
  /* Bounded and cycle-guarded: an error page must never be the thing that
     hangs the request. */
  while (cur instanceof Error && !seen.has(cur) && chain.length < 5) {
    seen.add(cur);
    const code = (cur as { code?: unknown }).code;
    const line = cur.message.split("\n")[0].trim().slice(0, 300);
    chain.push(typeof code === "string" && code ? `${code}: ${line}` : line);
    cur = cur.cause;
  }

  if (chain.length === 0) return String(e);
  /* Reversed, so the driver's reason leads and the wrapper trails it. */
  return chain.reverse().join("  ←  ");
}

/* WHAT the app thinks it is connecting to.
 *
 * "password authentication failed" is honest but not actionable: it cannot
 * distinguish a genuinely wrong password from a correct one that was rewritten
 * on the way to the driver. `postgres-js` does, in `parseOptions`:
 *
 *     password: decodeURIComponent(urlObj.password)
 *
 * so a pasted password containing a `%` is DECODED before Postgres sees it —
 * `pa%73s` is sent as `pass` — and fails exactly like a mistyped one. A `#` or
 * `/` is worse: `new URL` ends the userinfo there, so the password is truncated
 * and the host comes out wrong too.
 *
 * This is for the SERVER LOG, never the page. The parts it names are not
 * secret, but a public error page is no place to publish which host and user a
 * deployment connects as — and the password is never included in any form, not
 * its value and not its length.
 */
export function describeDbTarget(raw = process.env.DATABASE_URL): string {
  if (!raw) return "DATABASE_URL is not set";
  if (raw.startsWith("pglite:")) return `local PGlite (${raw})`;

  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return (
      "DATABASE_URL is not a parseable URL — look for an unencoded #, / or ? in the password, " +
      "or a stray space, quote or line break"
    );
  }

  const bits = [
    `scheme=${u.protocol.replace(":", "")}`,
    `user=${u.username || "(none)"}`,
    `host=${u.hostname || "(none)"}`,
    `port=${u.port || "(default)"}`,
    `db=${u.pathname.replace(/^\//, "") || "(none)"}`,
  ];

  if (!u.password) {
    bits.push("password=MISSING");
  } else {
    /* What the driver will actually send, against the characters that were
       literally typed between the userinfo ':' and the last '@'. If those
       differ, the fix is percent-encoding, not another password reset. */
    const afterScheme = raw.indexOf("//") + 2;
    const colon = raw.indexOf(":", afterScheme);
    const at = raw.lastIndexOf("@");
    const typed = colon > 0 && at > colon ? raw.slice(colon + 1, at) : null;

    let sent: string;
    try {
      sent = decodeURIComponent(u.password);
    } catch {
      /* A lone '%' is not a valid escape; decodeURIComponent throws and the
         driver never connects at all. */
      bits.push("password=present, but contains a stray % the driver cannot decode — write it as %25");
      return bits.join("  ");
    }

    bits.push(
      typed === null ? "password=present"
      : sent === typed ? "password=present, reaches the driver exactly as typed"
      : "password=present, but DECODING CHANGES IT before it is sent — percent-encode the special characters",
    );

    /* Encoding is not the only way a correct password arrives wrong. A space or
       newline caught in a copy-paste survives every check above — `new URL`
       encodes it and the driver decodes it straight back — so it reads as
       "exactly as typed" while Postgres rejects it. Same for the curly quotes a
       document editor substitutes. */
    const suspects: string[] = [];
    if (sent !== sent.trim()) suspects.push("leading or trailing whitespace");
    if (/[\r\n\t]/.test(sent)) suspects.push("a line break or tab");
    if (/[^\x20-\x7E]/.test(sent)) suspects.push("non-ASCII characters (curly quotes?)");
    if (suspects.length > 0) bits.push(`password CONTAINS ${suspects.join(" and ")}`);
  }

  return bits.join("  ");
}
