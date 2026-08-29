/* The acceptance test for "hard to copy".
 *
 * The whole point of moving off the single self-contained HTML file is that the
 * valuable logic — scoring rules, rating maths, championship points, PIN
 * hashing — executes on the server and is never shipped to the browser. That
 * property is easy to lose by accident: one `import` of an engine module into a
 * component marked "use client" and the entire algorithm is in the bundle again.
 *
 * This test fails if that happens. Run `pnpm build` first; it skips otherwise
 * so a plain `pnpm test` on a clean checkout is not a false alarm. */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const STATIC_DIR = path.resolve(process.cwd(), ".next/static");

function clientBundles(): string[] {
  if (!fs.existsSync(STATIC_DIR)) return [];
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js")) out.push(full);
    }
  };
  walk(STATIC_DIR);
  return out;
}

/* Identifiers unique enough that a match means the module really is in the
   bundle. Bare numbers and short names are avoided deliberately: "1499" appears
   as a webpack module id and "K_BASE" as a substring of
   TURBOPACK_CHUNK_BASE_PATH, so either would produce a false failure. */
const MUST_NOT_SHIP = [
  // scoring engine
  "replayRallies", "rallyGolden", "rallyGamePoint", "resolveRules", "goldenInfo",
  // rating engine
  "calcRtgChange", "phaseMultiplier", "MAX_DELTA",
  // ledger money engine
  "ledgerSettleUp", "ledgerOwedMap", "ledgerShares",
  // OSL format and championship
  "oslPairIndex", "oslPointsFor", "oslChampionship", "OSL_POINTS", "oslPlaceByRecord",
  // credentials
  "hashPin", "verifyPin", "generateGrantToken", "scorerPinHash",
];

const files = clientBundles();

describe.skipIf(files.length === 0)("no engine code reaches the browser", () => {
  const contents = files.map((f) => ({ file: path.relative(process.cwd(), f), text: fs.readFileSync(f, "utf8") }));

  it.each(MUST_NOT_SHIP)("%s is absent from every client bundle", (needle) => {
    const leaked = contents.filter((c) => c.text.includes(needle)).map((c) => c.file);
    expect(leaked, `${needle} leaked into: ${leaked.join(", ")}`).toEqual([]);
  });

  it("found client bundles to check (guards against the test silently passing)", () => {
    expect(files.length).toBeGreaterThan(0);
  });
});
