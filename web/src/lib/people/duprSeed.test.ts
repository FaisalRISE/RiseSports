import { describe, it, expect, beforeAll, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

/* DUPR is a PICKLEBALL rating (Faisal, 2026-09-21). Every form hides the box
 * outside pickleball, but a Server Action is a public endpoint, so the place a
 * DUPR becomes a rating refuses it too: a badminton key seeded from one would
 * start a badminton player at their pickleball level, and from then on nothing
 * could tell that number apart from one they had earned. */

const client = new PGlite();
const testDb = drizzle(client, { schema });
vi.mock("@/lib/db", () => ({ db: testDb }));
vi.mock("server-only", () => ({}));

const { createPerson } = await import("./index");
const { DEFAULT_SEED, seedFromDupr } = await import("@/lib/rating");
const { usesDupr, SPORT_IDS } = await import("@/lib/sports/registry");

beforeAll(async () => {
  const dir = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
      if (stmt.trim()) await client.exec(stmt.trim());
    }
  }
}, 120_000);

describe("which sports have a DUPR", () => {
  it("pickleball, and only pickleball", () => {
    expect(SPORT_IDS.filter((id) => usesDupr(id))).toEqual(["pb"]);
  });

  it("reads a record's sport, and a record with none as pickleball", () => {
    expect(usesDupr({ sport: "bd" })).toBe(false);
    expect(usesDupr({ sport: null })).toBe(true);
    expect(usesDupr()).toBe(true);
  });
});

describe("a DUPR seeds a pickleball rating and nothing else", () => {
  it("in pickleball it is the seed, and is kept on the record", async () => {
    const p = await createPerson({ name: "Pickler", gender: "M", phone: null, dupr: 4.0, formatKey: "pb:md" });
    expect(p.riseRatings).toEqual({ "pb:md": seedFromDupr(4.0) });
    expect(p.seedSource).toBe("dupr");
    expect(p.dupr).toBe(400);
  });

  it("in badminton it is dropped: the standard start, and no DUPR on file", async () => {
    const p = await createPerson({ name: "Shuttler", gender: "F", phone: null, dupr: 4.0, formatKey: "bd:md" });
    expect(p.riseRatings).toEqual({ "bd:md": DEFAULT_SEED });
    expect(p.seedSource).toBe("default");
    expect(p.dupr).toBeNull();
    expect(p.duprEnteredAt).toBeNull();
  });

  it("an organiser's placement still counts in any sport", async () => {
    const p = await createPerson({ name: "Placed", gender: "M", phone: null, dupr: 4.0, bandSeed: 1000, formatKey: "tt:ms" });
    expect(p.riseRatings).toEqual({ "tt:ms": 1000 });
    expect(p.seedSource).toBe("organiser");
  });
});
