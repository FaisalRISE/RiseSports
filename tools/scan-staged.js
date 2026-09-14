#!/usr/bin/env node
/* Scan the STAGED tree for secrets, before they become permanent.
 *
 * ── Why this exists as a script rather than two git grep commands ─────────
 * Because the two git grep commands were themselves the leak. CLAUDE.md — a
 * file committed to a PUBLIC repo — carried the check written as
 *
 *     git grep -c --cached "<the organiser password>"
 *
 * with the password spelled out as the search term. The instruction for
 * keeping secrets out of the repo was publishing one, in the file everyone
 * opens first, and had been since fde7431.
 *
 * So: the needles live in `tools/secret-patterns.local.json`, which is
 * gitignored and never committed. A scanner for secrets must not contain any.
 * If that file is missing the scan FAILS rather than passing quietly — a
 * security check that silently does nothing is worse than no check, because it
 * is trusted.
 *
 * ── Why the staged tree, not the working tree ─────────────────────────────
 * `git grep` without --cached reads the working tree, which can differ from
 * what is about to be committed. The thing that matters is what goes in.
 *
 * Usage:  node tools/scan-staged.js
 * Exits 0 when clean, 1 when something matched or the patterns are missing.
 */

"use strict";

const { execFileSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const PATTERNS = path.join(ROOT, "tools", "secret-patterns.local.json");
const EXAMPLE = path.join(ROOT, "tools", "secret-patterns.example.json");

function die(message) {
  console.error(`\n  ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(PATTERNS)) {
  die(
    `No secret patterns found.\n\n` +
      `  Expected: tools/secret-patterns.local.json (gitignored, never committed)\n` +
      `  Start from: tools/secret-patterns.example.json\n\n` +
      `  Refusing to report "clean" without actually checking anything.`,
  );
}

/** @type {{name: string, pattern: string}[]} */
let patterns;
try {
  patterns = JSON.parse(fs.readFileSync(PATTERNS, "utf8")).patterns;
} catch (e) {
  die(`tools/secret-patterns.local.json is not readable JSON: ${e.message}`);
}
if (!Array.isArray(patterns) || patterns.length === 0) {
  die("tools/secret-patterns.local.json lists no patterns.");
}

/* A half-filled template is the dangerous state: it scans, finds nothing, and
   prints "clean" — which is exactly what a real leak also looks like from the
   outside. Refuse instead. */
const PLACEHOLDER = /^(PUT-THE-|REPLACE-THIS)/;
const unfilled = patterns.filter((p) => PLACEHOLDER.test(String(p.pattern ?? "")));
if (unfilled.length > 0) {
  die(
    `tools/secret-patterns.local.json still has template placeholders:\n\n` +
      unfilled.map((p) => `    ${p.name}`).join("\n") +
      `\n\n  Replace each with the real value. Until then this scan cannot report "clean".`,
  );
}

/* The template deliberately CONTAINS a pattern — the Supabase anon JWT prefix,
 * which is public by design and useful as a canary for a full key being
 * committed. Scanning the pattern files against their own contents therefore
 * reports a hit on every run, which is the fastest way to teach someone to
 * ignore this scanner's output. Skip them. */
const SELF = /^tools\/secret-patterns\./;

let bad = 0;
for (const { name, pattern } of patterns) {
  let out = "";
  try {
    /* -F: the needles are literals, not regular expressions — a password with
       a "." or "$" in it must not be read as a wildcard. */
    out = execFileSync("git", ["grep", "-n", "-F", "--cached", "-e", pattern], {
      cwd: ROOT,
      encoding: "utf8",
    });
  } catch (e) {
    /* git grep exits 1 for "no match", which is the good case here. Any other
       code is a real failure and must not be mistaken for a clean scan. */
    if (e.status === 1) continue;
    die(`git grep failed for ${name}: ${e.message}`);
  }

  const hits = out
    .trim()
    .split("\n")
    .filter(Boolean)
    .filter((line) => !SELF.test(line.split(":")[0]));
  if (hits.length === 0) continue;

  bad += hits.length;
  /* The MATCHED TEXT IS NOT PRINTED — only where it was found. Printing it
     would copy the secret into the terminal, the scrollback and any CI log. */
  console.error(`\n  ${name} — ${hits.length} staged occurrence(s):`);
  for (const hit of hits) console.error(`    ${hit.split(":").slice(0, 2).join(":")}`);
}

if (bad > 0) {
  console.error(
    `\n  ${bad} staged occurrence(s) of a known secret. Do NOT commit.\n` +
      `  Unstage those files, then treat the secret as compromised and rotate it —\n` +
      `  a committed secret is not removed by deleting it later.\n`,
  );
  process.exit(1);
}

console.log(`Staged tree is clean (${patterns.length} pattern(s) checked).`);
