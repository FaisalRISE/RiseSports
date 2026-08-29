import { describe, it, expect } from "vitest";

/* The switch is read at module load, so each case re-imports with a fresh
 * module registry rather than trying to mutate an already-evaluated const. */
async function loadWith(value: string | undefined) {
  const prev = process.env.RISE_OPEN_ACCESS;
  if (value === undefined) delete process.env.RISE_OPEN_ACCESS;
  else process.env.RISE_OPEN_ACCESS = value;
  vi.resetModules();
  const mod = await import("./access");
  if (prev === undefined) delete process.env.RISE_OPEN_ACCESS;
  else process.env.RISE_OPEN_ACCESS = prev;
  return mod;
}

import { vi } from "vitest";

describe("open-access switch", () => {
  it("defaults to OPEN when the variable is unset, so a fresh deploy is usable", async () => {
    expect((await loadWith(undefined)).OPEN_ACCESS).toBe(true);
  });

  it("only the exact string \"0\" locks it down", async () => {
    expect((await loadWith("0")).OPEN_ACCESS).toBe(false);
  });

  it("any other value leaves it open — no accidental half-locked state", async () => {
    for (const v of ["1", "true", "yes", "", "false", "00"]) {
      expect((await loadWith(v)).OPEN_ACCESS, `RISE_OPEN_ACCESS=${JSON.stringify(v)}`).toBe(true);
    }
  });
});

describe("the authorization system underneath is untouched", () => {
  it("policy functions still enforce roles, ready for RISE_OPEN_ACCESS=0", async () => {
    const { canScore, canManage, anonymous } = await import("./policy");
    expect(canScore(anonymous())).toBe(false);
    expect(canManage({ userId: "u", role: "SCORER", hasScorerGrant: false, isOwner: false })).toBe(false);
  });

  it("PIN hashing still works, ready for RISE_OPEN_ACCESS=0", async () => {
    const { hashPin, verifyPin } = await import("./pin");
    const stored = await hashPin("123456");
    expect(await verifyPin("123456", stored)).toBe(true);
    expect(await verifyPin("999999", stored)).toBe(false);
  });
});
