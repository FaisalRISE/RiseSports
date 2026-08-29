import { describe, it, expect } from "vitest";
import { hashPin, verifyPin, generatePin, generateGrantToken } from "./pin";

describe("scorer PIN hashing", () => {
  it("verifies the right PIN and rejects the wrong one", async () => {
    const stored = await hashPin("123456");
    expect(await verifyPin("123456", stored)).toBe(true);
    expect(await verifyPin("123457", stored)).toBe(false);
    expect(await verifyPin("", stored)).toBe(false);
  });

  it("never stores the PIN itself", async () => {
    const stored = await hashPin("246810");
    expect(stored).not.toContain("246810");
  });

  it("salts, so the same PIN hashes differently every time", async () => {
    const a = await hashPin("111111");
    const b = await hashPin("111111");
    expect(a).not.toBe(b);
    expect(await verifyPin("111111", a)).toBe(true);
    expect(await verifyPin("111111", b)).toBe(true);
  });

  it("treats a missing or malformed hash as a failure, never a pass", async () => {
    expect(await verifyPin("123456", null)).toBe(false);
    expect(await verifyPin("123456", undefined)).toBe(false);
    expect(await verifyPin("123456", "")).toBe(false);
    expect(await verifyPin("123456", "notahash")).toBe(false);
    expect(await verifyPin("123456", "scrypt$abc")).toBe(false);
    expect(await verifyPin("123456", "md5$aa$bb")).toBe(false);
    // right shape, wrong length key
    expect(await verifyPin("123456", "scrypt$aabb$ccdd")).toBe(false);
  });

  it("normalises unicode so a PIN typed on a different keyboard still matches", async () => {
    const stored = await hashPin("1234é");        // é as one code point
    expect(await verifyPin("1234é", stored)).toBe(true); // e + combining accent
  });
});

describe("PIN and token generation", () => {
  it("generates 6 digits", () => {
    for (let i = 0; i < 200; i++) expect(generatePin()).toMatch(/^\d{6}$/);
  });

  it("is not obviously biased across the range", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 500; i++) seen.add(generatePin());
    expect(seen.size).toBeGreaterThan(400); // collisions should be rare in 10^6
  });

  it("grant tokens are long, unguessable and url-safe", () => {
    const t = generateGrantToken();
    expect(t.length).toBeGreaterThanOrEqual(43);
    expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    const many = new Set(Array.from({ length: 200 }, generateGrantToken));
    expect(many.size).toBe(200);
  });
});
