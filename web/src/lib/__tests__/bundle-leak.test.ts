/* The acceptance test for "hard to copy".
 *
 * The point of moving off the single self-contained HTML file is that the
 * valuable logic — scoring rules, rating maths, championship points, PIN
 * hashing — executes on the server and is never shipped to the browser. That
 * property is easy to lose by accident: one `import` of an engine module into a
 * component marked "use client" and the whole algorithm is in the bundle again.
 *
 * ── Why this test looks the way it does ───────────────────────────────────
 * It used to work by grepping the built client bundles for engine identifiers
 * ("replayRallies", "calcRtgChange", …). That does not work, and was verified
 * not to work: importing `calcRtgChange` into RefConsole and building shipped
 * the entire rating algorithm to the browser —
 *
 *   Math.max(1,Math.min(40,16*Math.min(1.25,Math.max(.75,.75+.5*Math.sqrt(…
 *
 * — while all twenty name checks passed. The minifier renames every imported
 * binding, so the algorithm ships intact under a one-letter name and a
 * name-based grep cannot see it. Only object-property names and string literals
 * survive minification.
 *
 * So the guarantee now comes from `import "server-only"` in each engine module,
 * which makes the BUILD FAIL (with an import trace) when a Client Component
 * reaches for one. This file's job is to make sure that marker is actually
 * present on everything that needs it — including modules added next year by
 * someone who never read this comment. */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

const LIB = path.resolve(process.cwd(), "src/lib");
const STATIC_DIR = path.resolve(process.cwd(), ".next/static");

/* Modules deliberately allowed in the browser. Everything else under lib/ must
 * carry the marker — so a NEW engine module fails this test by default rather
 * than passing unnoticed. Adding a name here is a decision that needs a reason.
 *
 * `replayLite` is the one substantive entry: offline scoring needs the browser
 * to derive a score with no network, so it ships point counting, serving side
 * and service box for the sideout / rally / alt2 models. That is the published
 * rulebook of three sports, not the valuable part. It has a different name from
 * `replayRallies`, and imports nothing, so it cannot quietly drag the real
 * engine along with it. */
const CLIENT_SAFE = [
  "scoring/replayLite.ts", // published rules of pb/bd/tt — see above
  "offline/queue.ts", // IndexedDB queue; imports one type and nothing else
];

/* A separate category, kept separate on purpose: these are NOT client-safe.
 * They are imported by drizzle-kit and the `seed` / `db:setup` node scripts,
 * which run outside Next's resolver and through tsx's CJS transform, where the
 * `react-server` condition does not reach — so the marker throws there.
 *
 * They are also not engines. `schema.ts` is table definitions and `seed.ts` is
 * demo data; neither carries an algorithm worth protecting. The module that
 * does hold something sensitive — `db/index.ts`, which builds the connection —
 * keeps its marker and is imported only from server code. */
const TOOLING_SHARED = ["db/schema.ts", "db/seed.ts"];

const EXEMPT = [...CLIENT_SAFE, ...TOOLING_SHARED];

function libModules(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__fixtures__") continue;
        walk(full);
      } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts")) {
        out.push(path.relative(LIB, full).split(path.sep).join("/"));
      }
    }
  };
  walk(LIB);
  return out.sort();
}

const modules = libModules();
const engines = modules.filter((m) => !EXEMPT.includes(m));

describe("engine code cannot reach the browser", () => {
  /* The real guard. A missing marker here is the exact hole that let the rating
     algorithm ship while every old test passed. */
  it.each(engines)("%s is marked server-only", (rel) => {
    const src = fs.readFileSync(path.join(LIB, rel), "utf8");
    expect(
      /^import ["']server-only["'];?$/m.test(src),
      `${rel} has no \`import "server-only"\`. Add it — or, with a reason, add ` +
        `the file to CLIENT_SAFE (it is meant to run in the browser) or to ` +
        `TOOLING_SHARED (a CLI script imports it and it holds no engine logic).`,
    ).toBe(true);
  });

  /* The allowlists must not silently rot into "everything". */
  it("the exemptions are few and every entry still exists", () => {
    expect(CLIENT_SAFE.length).toBeLessThanOrEqual(4);
    expect(TOOLING_SHARED.length).toBeLessThanOrEqual(3);
    for (const rel of EXEMPT) expect(modules, `${rel} is stale`).toContain(rel);
  });

  /* db/index.ts builds the connection from DATABASE_URL. It is the one file
     under db/ that must never be reachable from the browser, so it is called
     out by name rather than left to the discovery above. */
  it("the database connection module is marked, whatever else under db/ is not", () => {
    const src = fs.readFileSync(path.join(LIB, "db/index.ts"), "utf8");
    expect(/^import ["']server-only["'];?$/m.test(src)).toBe(true);
  });

  it("exempt modules do NOT carry the marker (it would throw where they run)", () => {
    for (const rel of EXEMPT) {
      const src = fs.readFileSync(path.join(LIB, rel), "utf8");
      expect(/^import ["']server-only["'];?$/m.test(src), `${rel} would throw where it runs`).toBe(false);
    }
  });

  /* Guards the guard: if nothing is discovered, every it.each above vanishes
     and the suite goes green having checked nothing. */
  it("found engine modules to check", () => {
    expect(engines.length).toBeGreaterThan(10);
  });
});

/* ── Secondary net ────────────────────────────────────────────────────────
 * Only for things that SURVIVE minification: string literals and object
 * property names. Identifiers are useless here — see the header. This cannot
 * prove absence of logic; it catches leaked secrets and messages. */
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

const files = clientBundles();

describe.skipIf(files.length === 0)("no secrets in the built client bundles", () => {
  const contents = files.map((f) => ({
    file: path.relative(process.cwd(), f),
    text: fs.readFileSync(f, "utf8"),
  }));

  /* CANARY. The old suite's fatal flaw was passing while checking nothing.
     This asserts the scan can actually see into the bundles: "Flip my view" is
     a literal in RefConsole, which is unambiguously client code. If this fails,
     the scan below is meaningless — fix it before trusting anything here. */
  it("the scan can see client code at all", () => {
    const seen = contents.some((c) => c.text.includes("Flip my view"));
    expect(seen, "no known client string found — the bundle scan is not working").toBe(true);
  });

  it.each([
    "DATABASE_URL",
    "postgres://",
    "postgresql://",
    "scorerPinHash", // a property name, so this one does survive minification
  ])("%s does not appear in any client bundle", (needle) => {
    const leaked = contents.filter((c) => c.text.includes(needle)).map((c) => c.file);
    expect(leaked, `${needle} leaked into: ${leaked.join(", ")}`).toEqual([]);
  });
});
