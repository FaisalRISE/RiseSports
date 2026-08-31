import { describe, it, expect } from "vitest";
import { normalisePhone, maskPhone } from "./index";

/* Phone normalisation IS the identity matching, so the stakes here are not
 * cosmetic: two spellings that fail to match create a duplicate person and a
 * rating that stops following someone, and two different numbers that DO match
 * fuse two people's ratings — much harder to unpick than a duplicate.
 *
 * Everything else in this module is database work, covered by e2e. */

describe("normalisePhone", () => {
  it("treats the ways one Indian mobile is written as one number", () => {
    const forms = [
      "9876543210",
      "98765 43210",
      "098765 43210",
      "+91 98765 43210",
      "+919876543210",
      "919876543210",
      "0-98765-43210",
      " 9876543210 ",
    ];
    const normalised = forms.map((f) => normalisePhone(f));
    expect(new Set(normalised).size).toBe(1);
    expect(normalised[0]).toBe("+919876543210");
  });

  it("keeps a foreign number under its own country code", () => {
    expect(normalisePhone("+44 7700 900123")).toBe("+447700900123");
    expect(normalisePhone("+1 415 555 0134")).toBe("+14155550134");
  });

  it("respects a different default country", () => {
    expect(normalisePhone("7700900123", "44")).toBe("+447700900123");
  });

  /* Returning null is the safe answer: no phone at all is honest, whereas a
     half-parsed number that matches the WRONG person merges two ratings. */
  it("refuses anything it cannot make sense of", () => {
    expect(normalisePhone("")).toBeNull();
    expect(normalisePhone("   ")).toBeNull();
    expect(normalisePhone(null)).toBeNull();
    expect(normalisePhone(undefined)).toBeNull();
    expect(normalisePhone("not a phone")).toBeNull();
    expect(normalisePhone("12345")).toBeNull();
    expect(normalisePhone("0")).toBeNull();
    expect(normalisePhone("+")).toBeNull();
  });

  it("rejects an implausibly long number rather than storing it", () => {
    expect(normalisePhone("+1234567890123456789")).toBeNull();
  });

  it("is idempotent — normalising twice changes nothing", () => {
    const once = normalisePhone("098765 43210")!;
    expect(normalisePhone(once)).toBe(once);
  });

  /* Two genuinely different people must not collapse onto one record. */
  it("keeps different numbers distinct", () => {
    expect(normalisePhone("9876543210")).not.toBe(normalisePhone("9876543211"));
    expect(normalisePhone("+919876543210")).not.toBe(normalisePhone("+449876543210"));
  });
});

describe("maskPhone", () => {
  /* A phone number is how a person is matched, not something to publish. */
  it("shows only the last four digits", () => {
    expect(maskPhone("+919876543210")).toBe("…3210");
    expect(maskPhone(null)).toBeNull();
  });

  it("never returns the full number", () => {
    const full = "+919876543210";
    expect(maskPhone(full)).not.toContain("98765");
  });
});
