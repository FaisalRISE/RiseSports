/* The ORIGINAL engine, extracted verbatim by text from the legacy app.source.js
 * and evaluated at test time. Following the repo's own convention: test what
 * shipped, not a retyped copy that can drift. Used only to prove the TypeScript
 * port behaves identically. */
import fs from "node:fs";
import path from "node:path";

const LEGACY = path.resolve(process.cwd(), "../app.source.js");

/** Pull a top-level `const name = ...;` declaration out by brace/paren matching. */
function extract(src: string, name: string): string {
  const start = src.indexOf(`const ${name} = `);
  if (start < 0) throw new Error(`legacy source: ${name} not found`);
  let i = src.indexOf("=", start) + 1;
  let depth = 0;
  let inStr: string | null = null;
  for (; i < src.length; i++) {
    const c = src[i];
    const prev = src[i - 1];
    if (inStr) {
      if (c === inStr && prev !== "\\") inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") { inStr = c; continue; }
    if ("([{".includes(c)) depth++;
    else if (")]}".includes(c)) depth--;
    else if (c === ";" && depth === 0) break;
  }
  return src.slice(start, i + 1);
}

export type Legacy = {
  resolveRules: (sport: string, over?: unknown) => any;
  replayRallies: (m: unknown, r: unknown) => any;
  rallyStats: (m: unknown, r: unknown, tp?: unknown) => any;
};

export function loadLegacy(): Legacy {
  const src = fs.readFileSync(LEGACY, "utf8");
  const parts = [
    extract(src, "DEFAULT_SPORT"),           // also carries SPORTS (one declaration)
    extract(src, "sportOf"),
    extract(src, "resolveRules"),
    extract(src, "rallyOver"),
    extract(src, "rallyGolden"),
    extract(src, "rallyGamePoint"),
    extract(src, "replayRallies"),
    extract(src, "rallyStats"),
  ].join("\n");
  const factory = new Function(`${src.includes("") ? "" : ""}${parts}
    return { resolveRules, replayRallies, rallyStats };`);
  return factory() as Legacy;
}
