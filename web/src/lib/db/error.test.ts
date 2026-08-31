import { describe, it, expect } from "vitest";
import { describeDbError } from "./error";

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
