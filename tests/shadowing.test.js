/**
 * shadowing.test.js — module-level helpers must not be shadowed by locals.
 *
 * This exists because of a real, shipped bug. Wave 0.1 added a storage-key
 * helper named `K`:
 *
 *     const PREFIX = "rs_", K = n => PREFIX + n;
 *
 * `K` is a single uppercase letter, which is exactly this file's convention for
 * minified LOCAL variables. The root component already bound it:
 *
 *     }), [O, K] = useState(...)          // K is setCommunityGames
 *
 * so inside RiseSports every `K("pl")` called a React setter instead. Reads hit
 * the temporal dead zone and fell back to seed data; writes went to a key
 * literally named "undefined" and turned communityGames into a string, which
 * crashed the Play tab. All of it silent — 76 other tests stayed green.
 *
 * SCOPE. This lints the module HEADER BLOCK (everything above `hideLoading`) —
 * the hand-written storage and sports helpers. It deliberately does not try to
 * infer declarations from the rest of the file: that code was recovered from a
 * minified build, its function bodies sit at the same indent as the top-level
 * comma chains, and regex-based discovery there produces dozens of false
 * positives. A lint that cries wolf gets switched off, which is worse than no
 * lint. The header block is the code we add to, so it is the code at risk.
 *
 * Run against a deliberately broken copy to confirm it still bites:
 *     node tests/shadowing.test.js path/to/broken.source.js
 */
const fs = require("fs"), path = require("path");
const target = process.argv[2] || path.join(__dirname, "..", "app.source.js");
const src = fs.readFileSync(target, "utf8");
const lines = src.split("\n");

let pass = 0, fail = 0;
const check = (name, cond, extra) => cond ? (pass++, console.log("  PASS  " + name))
                                          : (fail++, console.log("  FAIL  " + name + "  " + (extra === undefined ? "" : extra)));

/* Nesting depth at the start of each line, ignoring braces in strings and
   comments. Indentation cannot be used: function bodies sit at 2-space indent,
   exactly like the top-level comma chains. */
const depthAt = (() => {
  const d = new Array(lines.length).fill(0);
  let depth = 0, inBlockComment = false;
  lines.forEach((line, i) => {
    d[i] = depth;
    let q = null;
    for (let j = 0; j < line.length; j++) {
      const ch = line[j], next = line[j + 1];
      if (inBlockComment) { if (ch === "*" && next === "/") { inBlockComment = false; j++; } continue; }
      if (q) { if (ch === "\\") j++; else if (ch === q) q = null; continue; }
      if (ch === "/" && next === "/") break;
      if (ch === "/" && next === "*") { inBlockComment = true; j++; continue; }
      if (ch === '"' || ch === "'" || ch === "`") { q = ch; continue; }
      if (ch === "{" || ch === "(" || ch === "[") depth++;
      else if (ch === "}" || ch === ")" || ch === "]") depth--;
    }
  });
  return d;
})();

const headerEnd = lines.findIndex(l => l.startsWith("const hideLoading"));

console.log("module header block");
check("header block is found", headerEnd > 0, "ends at line " + headerEnd);

/* Names declared in the header block — the helpers we own. */
const HELPERS = (() => {
  const found = new Set();
  lines.slice(0, headerEnd).forEach(l => {
    for (const m of l.matchAll(/^(?:const |  )([A-Za-z_$][\w$]*) = /g)) found.add(m[1]);
    for (const m of l.matchAll(/^const ([A-Za-z_$][\w$]*) = [^,]*, ([A-Za-z_$][\w$]*) = /g)) { found.add(m[1]); found.add(m[2]); }
    for (const m of l.matchAll(/^\(function ([A-Za-z_$][\w$]*)\(/g)) found.add(m[1]);
  });
  return [...found];
})();
check("helpers were discovered", HELPERS.length >= 10, HELPERS.length + ": " + HELPERS.join(", "));

/* THE RULE. A helper name shorter than 3 characters cannot survive in a file
   whose locals are single letters. This is what makes shadowing impossible by
   construction, rather than something to detect after the fact. */
const tooShort = HELPERS.filter(n => n.length < 3);
check("every helper name is at least 3 characters", tooShort.length === 0, tooShort.join(", "));

/* Belt and braces: verify none is actually re-bound deeper in the file. */
const shadows = [];
for (const g of HELPERS) {
  const e = g.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const patterns = [
    new RegExp(`\\[\\s*[\\w$]+\\s*,\\s*${e}\\s*\\]`),
    new RegExp(`\\[\\s*${e}\\s*,\\s*[\\w$]+\\s*\\]`),
    new RegExp(`\\b(?:const|let|var)\\s+${e}\\s*=`),
    new RegExp(`,\\s*${e}\\s*=(?!=|>)`)
  ];
  lines.forEach((l, i) => {
    if (i < headerEnd || depthAt[i] === 0) return;
    if (patterns.some(p => p.test(l))) shadows.push(`${g} at :${i + 1}`);
  });
}
check("no helper is re-bound as a local", shadows.length === 0, shadows.join("; "));

/* `C` (the palette) is a pre-existing 1-char global referenced everywhere. It
   cannot be renamed cheaply, so its shadows are checked explicitly instead.
   buildTimedSchedule used to bind `C` as a court count — harmless only until
   someone reached for a colour in there. */
/* C is declared mid-chain on the line that also destructures React, and that
   line starts with `}` closing hideLoading — so its depth is 1, not 0. Exclude
   the declaration explicitly rather than loosening the depth rule. */
const cDeclLine = lines.findIndex(l => /=\s*React,\s*C\s*=\s*\{/.test(l));
const cShadows = [];
lines.forEach((l, i) => {
  if (i < headerEnd || depthAt[i] === 0 || i === cDeclLine) return;
  if (/\b(?:const|let|var)\s+C\s*=|,\s*C\s*=(?!=|>)|\[\s*[\w$]+\s*,\s*C\s*\]|\[\s*C\s*,\s*[\w$]+\s*\]/.test(l)) {
    cShadows.push(`:${i + 1}  ${l.trim().slice(0, 70)}`);
  }
});
check("the palette C is not shadowed", cShadows.length === 0, cShadows.join(" | "));

console.log("\nstorage helper");
const declMatch = src.match(/const PREFIX = "[^"]*", (\w+) = n => PREFIX \+ n;/);
check("storage helper is declared", !!declMatch, declMatch ? declMatch[1] : "not found");
const helper = declMatch && declMatch[1];
check("helper name is longer than 2 characters", !!helper && helper.length > 2, helper);
check("helper name is not a single uppercase letter", !!helper && !/^[A-Z]$/.test(helper), helper);

/* Two literals are legitimate: the "pr9_" legacy read in the migration, and the
   one-off cleanup of the "undefined" key the broken build wrote. */
const ALLOWED_LITERAL = /^(?:pr9_|undefined$)/;
const rawKeys = [...src.matchAll(/localStorage\.(?:get|set|remove)Item\(\s*"([^"]*)"/g)]
  .filter(m => !ALLOWED_LITERAL.test(m[1]));
check("no localStorage call uses an unexpected raw key", rawKeys.length === 0, rawKeys.map(m => m[1]).join(","));

/* CommunityTab's own K setter is a legitimate local — blanket-replacing `K(`
   during the rename would have silently broken the restrict form. */
console.log("\nCommunityTab's local K setter survived the rename");
const localK = (src.match(/(^|[^A-Za-z0-9_$])K\(/gm) || []).length;
check("still 7 local K( setter calls", localK === 7, localK + " found");
check("no K( remains in a storage context", !/localStorage\.[gs]etItem\(K\(/.test(src));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail ? 1 : 0);
