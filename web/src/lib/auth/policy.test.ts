import { describe, it, expect } from "vitest";
import {
  canView, acceptsEntries, canScore, canManage, canAdminister, anonymous, assert,
  AuthorizationError, grantIsUsable, type Principal,
} from "./policy";
import type { Role } from "@/lib/db/schema";

const p = (over: Partial<Principal> = {}): Principal => ({ ...anonymous(), ...over });
const ROLES: Role[] = ["PLAYER", "SCORER", "ORGANIZER", "ADMIN"];

describe("viewing", () => {
  /* Visibility is derived from the LIFECYCLE now, not a separate `published`
     flag — one field, so the two can never disagree. */
  it("anyone may read a tournament that has left draft", () => {
    expect(canView(anonymous(), "open")).toBe(true);
    expect(canView(anonymous(), "live")).toBe(true);
    expect(canView(anonymous(), "finished")).toBe(true);
  });

  it("a draft is hidden from the public and from players", () => {
    expect(canView(anonymous(), "draft")).toBe(false);
    expect(canView(p({ userId: "u", role: "PLAYER" }), "draft")).toBe(false);
    expect(canView(p({ userId: "u", role: "SCORER" }), "draft")).toBe(false);
  });

  it("the organiser and owner can see their own draft", () => {
    expect(canView(p({ userId: "u", role: "ORGANIZER" }), "draft")).toBe(true);
    expect(canView(p({ userId: "u", isOwner: true }), "draft")).toBe(true);
  });

  /* Entries are taken ONLY while open. A live tournament is visible but its
     draw is made — an entry arriving then has nowhere to go. */
  it("only an open tournament accepts entries", () => {
    expect(acceptsEntries("open")).toBe(true);
    expect(acceptsEntries("draft")).toBe(false);
    expect(acceptsEntries("live")).toBe(false);
    expect(acceptsEntries("finished")).toBe(false);
  });
});

describe("scoring", () => {
  it("a redeemed PIN is enough on its own, with no account", () => {
    expect(canScore(p({ hasScorerGrant: true }))).toBe(true);
  });

  it("an anonymous visitor cannot score", () => {
    expect(canScore(anonymous())).toBe(false);
  });

  it("a mere PLAYER cannot score", () => {
    expect(canScore(p({ userId: "u", role: "PLAYER" }))).toBe(false);
  });

  it("SCORER and above can score", () => {
    for (const role of ["SCORER", "ORGANIZER", "ADMIN"] as Role[]) {
      expect(canScore(p({ userId: "u", role }))).toBe(true);
    }
  });
});

describe("managing and administering", () => {
  it("a PIN grants scoring only — never management", () => {
    const scorer = p({ hasScorerGrant: true });
    expect(canScore(scorer)).toBe(true);
    expect(canManage(scorer)).toBe(false);
    expect(canAdminister(scorer)).toBe(false);
  });

  it("a SCORER cannot manage the tournament", () => {
    expect(canManage(p({ userId: "u", role: "SCORER" }))).toBe(false);
  });

  it("an ORGANIZER can manage but not administer", () => {
    const org = p({ userId: "u", role: "ORGANIZER" });
    expect(canManage(org)).toBe(true);
    expect(canAdminister(org)).toBe(false);
  });

  it("the owner can do everything on their own tournament", () => {
    const owner = p({ userId: "u", isOwner: true });
    expect(canScore(owner)).toBe(true);
    expect(canManage(owner)).toBe(true);
    expect(canAdminister(owner)).toBe(true);
  });

  it("roles are scoped to one tournament — no role here means no powers here", () => {
    // organiser of some OTHER event arrives with role:null for this one
    const outsider = p({ userId: "u", role: null });
    expect(canScore(outsider)).toBe(false);
    expect(canManage(outsider)).toBe(false);
  });

  it("privileges are monotonic in rank", () => {
    const allowed = (r: Role) => [canScore, canManage, canAdminister].map((f) => f(p({ userId: "u", role: r })));
    for (let i = 0; i < ROLES.length - 1; i++) {
      const lo = allowed(ROLES[i]), hi = allowed(ROLES[i + 1]);
      lo.forEach((v, j) => { if (v) expect(hi[j]).toBe(true); });
    }
  });
});

describe("grant validity", () => {
  const now = new Date("2026-06-01T12:00:00Z");

  it("accepts a live grant", () => {
    expect(grantIsUsable({ revokedAt: null, expiresAt: null }, now)).toBe(true);
    expect(grantIsUsable({ revokedAt: null, expiresAt: new Date("2026-06-02") }, now)).toBe(true);
  });

  it("rejects revoked, expired and missing grants", () => {
    expect(grantIsUsable({ revokedAt: new Date("2026-05-01"), expiresAt: null }, now)).toBe(false);
    expect(grantIsUsable({ revokedAt: null, expiresAt: new Date("2026-05-31") }, now)).toBe(false);
    expect(grantIsUsable(null, now)).toBe(false);
    expect(grantIsUsable(undefined, now)).toBe(false);
  });
});

describe("assert", () => {
  it("throws a typed error naming the action", () => {
    expect(() => assert(false, "score a point")).toThrow(AuthorizationError);
    expect(() => assert(false, "score a point")).toThrow(/score a point/);
    expect(() => assert(true, "score a point")).not.toThrow();
  });
});
