#!/usr/bin/env node
/**
 * tests/run.js — runs every *.test.js in this folder.
 *
 * Usage: node tests/run.js
 *
 * The app ships as one HTML file with no build step and no test framework, so
 * these tests follow the project convention: pull the real function out of
 * app.source.js by text, run it against a stub, and assert. Testing what ships
 * beats testing a retyped copy that can drift.
 */
const fs = require("fs"), path = require("path"), { execFileSync } = require("child_process");

const files = fs.readdirSync(__dirname).filter(f => f.endsWith(".test.js")).sort();
if (!files.length) { console.log("no tests found"); process.exit(0); }

let failed = 0;
for (const f of files) {
  console.log(`\n─── ${f} ${"─".repeat(Math.max(0, 50 - f.length))}`);
  try {
    process.stdout.write(execFileSync(process.execPath, [path.join(__dirname, f)], { encoding: "utf8" }));
  } catch (e) {
    process.stdout.write(e.stdout || "");
    process.stderr.write(e.stderr || "");
    failed++;
  }
}
console.log(`\n${"═".repeat(56)}`);
console.log(failed ? `${failed} of ${files.length} test file(s) FAILED` : `all ${files.length} test file(s) passed`);
process.exit(failed ? 1 : 0);
