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
