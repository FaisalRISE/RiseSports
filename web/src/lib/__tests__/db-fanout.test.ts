/* The guard against the outage of 2026-09-15.
 *
 * ── What happened ────────────────────────────────────────────────────────
 * Every database-backed page hung for a day. The client was `max: 1`, and a
 * `Promise.all` over three queries does not open three connections: postgres-js
 * PIPELINES them down one socket, and Supavisor in transaction mode wedges when
 * several implicit transactions interleave on it. The backend waits in
 * `ClientRead` for the rest of an exchange that never comes, the driver waits
 * for a reply that never comes, and — because the client is one per process —
 * every later query on that instance queues behind the wedge forever.
 *
 * The pool is `max: 8` now, which covers every FIXED fan-out in the app. It does
 * not cover a fan-out that grows with the data: `Promise.all(rows.map(...))` is
 * three queries on a quiet day and thirty on a busy one, and past eight it
 * pipelines and wedges again. The ledger's book list did exactly that — about
 * three queries per book, so a third book would have taken the site down. It had
 * not happened only because production had no books yet.
 *
 * ── Why a test, and why this kind of test ────────────────────────────────
 * Nothing else can catch it. Every unit test and e2e suite runs on PGlite, which
 * has no pool and no pooler, so the hazard is invisible locally by construction
 * — that is how it reached production the first time. A health probe that fired
 * more than eight queries would find it, but the probe is a PUBLIC route, and a
 * probe that can wedge the instance serving the site is a denial of service with
 * a friendly name. So the check is static.
 *
 * It parses with the TypeScript compiler rather than grepping, for the same
 * reason bundle-leak.test.ts stopped grepping: a regex cannot tell code from a
 * comment or a string, cannot follow a call across line breaks, and passes
 * quietly when it is wrong. The canaries below prove the detector both catches
 * what it must and ignores what it must, so a detector that silently stopped
 * working fails here rather than passing everything.
 *
 * ── It runs on every deploy, not only when someone remembers ─────────────
 * `npm run build` runs this file before `next build` (web/package.json), and
 * Vercel's build is that script. It was first written as "fails the build"
 * while nothing on the way to production ran a test at all — no CI, no hook,
 * `build` was bare `next build` — which an adversarial review caught. A guard
 * against a hazard nothing else can see is worthless if it is optional. It is
 * in the `build` script itself rather than a `prebuild` hook because Vercel
 * installs with pnpm, and pnpm does not run pre-scripts. It takes about a
 * second and touches no database. */

import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const SRC = path.resolve(process.cwd(), "src");

/* A literal array of up to this many queries is a fixed fan-out the pool was
   sized for. The widest in the app is four, on /t/[slug]/manage. Raising this
   number is raising the pool's guarantee, and needs `max` in lib/db/index.ts to
   stay comfortably above it. */
const MAX_LITERAL = 4;

const COMBINATORS = new Set(["all", "allSettled", "any", "race"]);
const ITERATORS = new Set(["map", "flatMap", "forEach"]);

type Rule = "combinator-over-list" | "async-iterator" | "combinator-in-transaction";
type Violation = { file: string; line: number; rule: Rule; code: string };

function isPromiseCombinator(node: ts.CallExpression): boolean {
  const callee = node.expression;
  return (
    ts.isPropertyAccessExpression(callee) &&
    ts.isIdentifier(callee.expression) &&
    callee.expression.text === "Promise" &&
    COMBINATORS.has(callee.name.text)
  );
}

function isAsyncFunction(node: ts.Node): boolean {
  return (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    !!node.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword)
  );
}

function scan(file: string, text: string): Violation[] {
  const kind = file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, kind);
  const out: Violation[] = [];

  const flag = (node: ts.Node, rule: Rule) =>
    out.push({
      file,
      line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
      rule,
      code: node.getText(sf).split("\n")[0].slice(0, 90),
    });

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node)) {
      /* Rule 1. Anything but a short literal list is a fan-out whose width the
         code does not control: a mapped array, a variable holding one, or a
         spread. `const ps = rows.map(q); await Promise.all(ps)` is the same
         hazard spelled in two statements, and this catches that too. */
      if (isPromiseCombinator(node)) {
        const arg = node.arguments[0];
        const fixed =
          !!arg &&
          ts.isArrayLiteralExpression(arg) &&
          arg.elements.length <= MAX_LITERAL &&
          !arg.elements.some(ts.isSpreadElement);
        if (!fixed) flag(node, "combinator-over-list");
      }

      const callee = node.expression;
      if (ts.isPropertyAccessExpression(callee)) {
        /* Rule 2. An async callback to map fires every call before any finishes;
           to forEach it does the same and also drops the promises, so a failure
           vanishes. Either way the width is the length of the data. */
        if (ITERATORS.has(callee.name.text) && node.arguments.some(isAsyncFunction)) {
          flag(node, "async-iterator");
        }

        /* Rule 3. A transaction holds ONE connection by definition, so even a
           two-item Promise.all inside it pipelines on that connection. Worse
           than the outage case, not a milder version of it. */
        if (callee.name.text === "transaction") {
          const inner = (n: ts.Node): void => {
            if (ts.isCallExpression(n) && isPromiseCombinator(n)) flag(n, "combinator-in-transaction");
            ts.forEachChild(n, inner);
          };
          node.arguments.forEach(inner);
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

/* Every exception needs a reason written next to it, and the list is capped so
   it cannot quietly become the place hazards go to be ignored. */
const ALLOWED: { file: string; rule: Rule; why: string }[] = [];

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__fixtures__") continue;
        walk(full);
      } else if (/\.tsx?$/.test(entry.name) && !/\.(test|d)\.tsx?$/.test(entry.name)) {
        out.push(path.relative(SRC, full).split(path.sep).join("/"));
      }
    }
  };
  walk(SRC);
  return out.sort();
}

describe("the detector", () => {
  const hits = (code: string) => scan("canary.ts", code).map((v) => v.rule);

  it.each([
    ["a mapped list", `await Promise.all(rows.map((r) => load(r)));`, "combinator-over-list"],
    ["a mapped list across line breaks", `await Promise.all(\n  rows\n    .map(\n      async (r) => load(r),\n    ),\n);`, "combinator-over-list"],
    ["a variable holding the promises", `const ps = rows.map(load);\nawait Promise.all(ps);`, "combinator-over-list"],
    ["a spread", `await Promise.all([first(), ...rest.map(load)]);`, "combinator-over-list"],
    ["a literal wider than the pool was sized for", `await Promise.all([a(), b(), c(), d(), e()]);`, "combinator-over-list"],
    ["allSettled over a list", `await Promise.allSettled(ids.map(load));`, "combinator-over-list"],
    ["an async map on its own", `const ps = rows.map(async (r) => load(r));`, "async-iterator"],
    ["an async forEach", `rows.forEach(async function (r) { await load(r); });`, "async-iterator"],
    ["a fan-out inside a template expression", "const s = `${await Promise.all(ids.map(load))}`;", "combinator-over-list"],
    ["even a short literal inside a transaction", `await db.transaction(async (tx) => {\n  await Promise.all([tx.a(), tx.b()]);\n});`, "combinator-in-transaction"],
  ])("flags %s", (_label, code, rule) => {
    expect(hits(code)).toContain(rule);
  });

  it.each([
    ["a short literal list", `const [a, b, c] = await Promise.all([one(), two(), three()]);`],
    ["four, the widest the app uses", `await Promise.all([a(), b(), c(), d()]);`],
    ["a plain synchronous map", `const ids = rows.map((r) => r.id);`],
    ["a sequential loop", `for (const r of rows) await load(r);`],
    ["the hazard written in a line comment", `// await Promise.all(rows.map(async (r) => load(r)));\nconst x = 1;`],
    ["the hazard written in a block comment", `/* rows.forEach(async (r) => load(r)); */\nconst x = 1;`],
    ["the hazard written in a string", `const s = "await Promise.all(rows.map(async (r) => load(r)))";`],
    ["the hazard written in a template with no expression", "const s = `Promise.all(rows.map(async (r) => r))`;"],
    ["a transaction with sequential awaits", `await db.transaction(async (tx) => {\n  await tx.a();\n  await tx.b();\n});`],
    ["Promise.resolve, which is not a fan-out", `const xs = ids.length ? await load(ids) : await Promise.resolve([]);`],
    ["TSX", `export function C() { return <ul>{rows.map((r) => <li key={r.id}>{r.name}</li>)}</ul>; }`],
  ])("ignores %s", (_label, code) => {
    const file = code.includes("<ul>") ? "canary.tsx" : "canary.ts";
    expect(scan(file, code)).toEqual([]);
  });
});

describe("the codebase", () => {
  const files = sourceFiles();
  const found = files.flatMap((rel) =>
    scan(rel, fs.readFileSync(path.join(SRC, rel), "utf8")),
  );
  const isAllowed = (v: Violation) => ALLOWED.some((a) => a.file === v.file && a.rule === v.rule);

  /* Guards the guard: a walk that found nothing would pass everything below. */
  it("scans the whole source tree, not a corner of it", () => {
    expect(files.length).toBeGreaterThan(80);
    /* Named because it holds a NUL byte, which makes grep treat it as binary
       and skip it — reading with the compiler must not. */
    expect(files).toContain("lib/community/store.ts");
    expect(files).toContain("app/page.tsx");
  });

  it("has no fan-out that grows with the data", () => {
    const bad = found.filter((v) => !isAllowed(v));
    expect(
      bad,
      "Past eight concurrent queries postgres-js pipelines on one socket and the " +
        "transaction pooler wedges the whole instance. Use a sequential loop, or one " +
        "query with inArray grouped in memory. Found:\n" +
        bad.map((v) => `  ${v.file}:${v.line} [${v.rule}] ${v.code}`).join("\n"),
    ).toEqual([]);
  });

  it("keeps its exceptions few, and none of them stale", () => {
    expect(ALLOWED.length).toBeLessThanOrEqual(3);
    for (const a of ALLOWED) {
      expect(a.why.length, `${a.file} needs a reason`).toBeGreaterThan(20);
      expect(
        found.some((v) => v.file === a.file && v.rule === a.rule),
        `${a.file} [${a.rule}] no longer matches anything — remove it`,
      ).toBe(true);
    }
  });
});
