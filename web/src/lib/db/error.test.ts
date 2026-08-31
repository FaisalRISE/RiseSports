import { describe, it, expect } from "vitest";
import { describeDbError, describeDbTarget } from "./error";

/* The first Supabase deploy rendered a red box quoting the SELECT it had tried
 * and nothing about why it failed, because the page printed `e.message` and
 * Drizzle's message is the SQL. These tests pin the fix: the driver's reason
 * leads. */

/** Drizzle's wrapper, shaped the way the real one is. */
const wrapped = (cause: Error) =>
  Object.assign(new Error('Failed query: select "id" from "tournaments"\nparams: '), { cause });

const withCode = (code: string, message: string) =>
  Object.assign(new Error(message), { code });

describe("describeDbError", () => {
  it("leads with the driver's reason, not the SQL", () => {
    const out = describeDbError(wrapped(withCode("ECONNREFUSED", "connect ECONNREFUSED 1.2.3.4:6543")));
    expect(out.startsWith("ECONNREFUSED: connect ECONNREFUSED 1.2.3.4:6543")).toBe(true);
  });

  it("keeps the wrapper too, so the failing query is still visible", () => {
    expect(describeDbError(wrapped(new Error("password authentication failed")))).toContain(
      "Failed query",
    );
  });

  it("handles a plain error with no cause", () => {
    expect(describeDbError(new Error("boom"))).toBe("boom");
  });

  it("omits the code prefix when there is no code", () => {
    expect(describeDbError(new Error("boom"))).not.toContain(":");
  });

  it("survives a non-Error", () => {
    expect(describeDbError("just a string")).toBe("just a string");
    expect(describeDbError(null)).toBe("null");
  });

  /* An error page must never be the thing that hangs the request. */
  it("does not loop forever on a cycle", () => {
    const a = new Error("a");
    const b = Object.assign(new Error("b"), { cause: a });
    (a as Error & { cause?: unknown }).cause = b;
    expect(describeDbError(b)).toContain("a");
  });

  it("keeps one line out of a multi-line message, and bounds its length", () => {
    const long = new Error(`${"x".repeat(500)}\nsecond line`);
    const out = describeDbError(long);
    expect(out).not.toContain("second line");
    expect(out.length).toBeLessThanOrEqual(300);
  });
});

const POOLER = "aws-0-ap-south-1.pooler.supabase.com";
const url = (pw: string) => `postgresql://postgres.abc:${pw}@${POOLER}:6543/postgres`;

describe("describeDbTarget", () => {
  it("names the parts that are safe to name", () => {
    const out = describeDbTarget(url("plainpassword"));
    expect(out).toContain("user=postgres.abc");
    expect(out).toContain(`host=${POOLER}`);
    expect(out).toContain("port=6543");
    expect(out).toContain("db=postgres");
  });

  /* The whole point. Nothing about the password may reach the caller — not the
     value, not the length — because this line ends up in a log. */
  it("never reveals the password or its length", () => {
    const secret = "s3cr3t-do-not-print";
    const out = describeDbTarget(url(secret));
    expect(out).not.toContain(secret);
    expect(out).not.toContain(String(secret.length));
  });

  it("says so when the password reaches the driver as typed", () => {
    expect(describeDbTarget(url("abc123XYZ"))).toContain("exactly as typed");
  });

  /* postgres-js does `decodeURIComponent(urlObj.password)`, so a pasted `%73`
     is sent as `s` and fails identically to a mistyped password. This is the
     line that tells those two apart. */
  it("flags a password that decoding rewrites before it is sent", () => {
    expect(describeDbTarget(url("pa%73s"))).toContain("DECODING CHANGES IT");
  });

  /* A lone % is not a valid escape: decodeURIComponent throws and the driver
     never opens a connection at all. */
  it("flags a stray percent sign, without throwing", () => {
    expect(describeDbTarget(url("100%sure"))).toContain("stray %");
  });

  /* A '#' in the password does not merely truncate it — it makes the whole
     string unparseable, so this is caught before any part is named. */
  it("catches a # in the password and points at it", () => {
    const out = describeDbTarget(url("pa#ss"));
    expect(out).toContain("not a parseable URL");
    expect(out).toContain("#");
  });

  /* The gap the first version had: a space survives encoding and decoding
     intact, so it reads as "exactly as typed" while Postgres rejects it. */
  it("catches whitespace a copy-paste dragged in", () => {
    const out = describeDbTarget(url("goodpassword "));
    expect(out).toContain("reaches the driver exactly as typed");
    expect(out).toContain("CONTAINS leading or trailing whitespace");
  });

  it("catches a newline and curly quotes", () => {
    expect(describeDbTarget(url("good%0Apass"))).toContain("a line break or tab");
    expect(describeDbTarget(url("good“pass"))).toContain("non-ASCII");
  });

  it("says nothing extra about a clean password", () => {
    expect(describeDbTarget(url("abc123XYZ"))).not.toContain("CONTAINS");
  });

  it("notices a missing password", () => {
    expect(describeDbTarget(`postgresql://postgres.abc@${POOLER}:6543/postgres`)).toContain(
      "password=MISSING",
    );
  });

  it("reports an unset or unparseable value plainly", () => {
    expect(describeDbTarget(undefined)).toBe("DATABASE_URL is not set");
    expect(describeDbTarget("not a url at all")).toContain("not a parseable URL");
  });

  it("recognises the local driver", () => {
    expect(describeDbTarget("pglite://.pgdata")).toContain("PGlite");
  });
});
