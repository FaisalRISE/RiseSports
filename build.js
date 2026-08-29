#!/usr/bin/env node
/**
 * build.js — assembles the self-contained offline HTML for RISE Sports.
 *
 * Usage:  node build.js [template.html] [source.js] [output.html]
 * Defaults: rise-sports.html  app.source.js  rise-sports.html
 *
 * How it works:
 *  - The offline HTML contains 4 <script> blocks: React, ReactDOM (2 parts), and the app.
 *  - This script replaces the LAST <script> block (the app) with the contents of app.source.js.
 *  - It validates the JS parses and contains no literal "</script>" (which would break the HTML).
 *
 * The template is also the shell: <head>, <style>, favicon and the loading screen live in
 * it and are NOT touched by the build. Edit them there.
 *
 * COMPAT_COPY writes a byte-identical duplicate under the old Pickle Rank filename so
 * existing GitHub Pages / Vercel links keep working through the rename. Delete it (and the
 * old file) a release or two after the rebrand has gone out.
 *
 * No dependencies beyond Node >= 16. If "acorn" is resolvable it is used for a syntax check;
 * otherwise the check falls back to new Function() (slower, but dependency-free).
 */
const fs = require("fs");

const tplPath = process.argv[2] || "rise-sports.html";
const srcPath = process.argv[3] || "app.source.js";
const outPath = process.argv[4] || "rise-sports.html";
const COMPAT_COPY = "pickle-rank-offline.html";

const html = fs.readFileSync(tplPath, "utf8");
const src = fs.readFileSync(srcPath, "utf8");

// --- validate the source ---
if (/<\/script>/i.test(src)) {
  console.error("ERROR: app source contains a literal </script>; this will truncate the HTML.");
  console.error("Escape it as <\/script> inside strings.");
  process.exit(1);
}
let parsed = false;
try {
  const acorn = require("acorn");
  acorn.parse(src, { ecmaVersion: 2022 });
  parsed = true;
  console.log("syntax check: OK (acorn)");
} catch (e) {
  if (e.code === "MODULE_NOT_FOUND") {
    try {
      new Function(src);
      parsed = true;
      console.log("syntax check: OK (Function fallback)");
    } catch (e2) {
      console.error("SYNTAX ERROR:", e2.message);
      process.exit(1);
    }
  } else {
    console.error("SYNTAX ERROR:", e.message, "at", e.loc ? `${e.loc.line}:${e.loc.column}` : "");
    process.exit(1);
  }
}

// --- locate the last <script> block in the template ---
const open = "<script>";
const close = "</script>";
const lastClose = html.lastIndexOf(close);
const lastOpen = html.lastIndexOf(open, lastClose);
if (lastOpen === -1 || lastClose === -1 || lastClose < lastOpen) {
  console.error("ERROR: could not locate the app <script> block in the template.");
  process.exit(1);
}

let out = html.slice(0, lastOpen + open.length) + src + html.slice(lastClose);

// --- brand assets ---------------------------------------------------------
// The RISE Sports wordmark is a 2MB PNG; tools/make-logo.js downscales it to
// ~32KB and writes brand/logo-inline.json. It is injected HERE rather than
// stored in app.source.js or the template, so neither source file carries a
// 40KB data URI. Idempotent: the placeholder script's contents are replaced
// every build, so repeated builds do not accumulate.
try {
  const brand = JSON.parse(fs.readFileSync("brand/logo-inline.json", "utf8"));
  const payload = `window.RISE_LOGO=${JSON.stringify(brand)};`;
  const slot = /(<script id="rise-brand">)[\s\S]*?(<\/script>)/;
  // Test for the slot explicitly. Comparing before/after would report a false
  // "not found" on every rebuild, because re-injecting the same logo yields an
  // identical string. Note the output IS the next build's template, so after
  // the first build the payload lives in rise-sports.html — that is fine, the
  // point of injecting was to keep it out of app.source.js.
  if (!slot.test(out)) {
    console.warn('warning: <script id="rise-brand"> slot missing; logo not injected');
  } else {
    out = out.replace(slot, `$1${payload}$2`);
    console.log(`brand: logo injected (${Math.round(payload.length / 1024)} KB)`);
  }
} catch (e) {
  console.warn("warning: brand/logo-inline.json missing; run node tools/make-logo.js");
}

// --- Court Ledger ---------------------------------------------------------
// A complete standalone app that lives in its own folder. It is inlined here
// and hosted in an iframe rather than ported, because it already works: RBAC,
// the global player directory and the payment-acknowledgment flow are all
// built. Inlining keeps the single-file promise intact.
// NOTE: it keeps its own localStorage, so it does not share the RISE player
// list yet. That is the price of embedding rather than porting.
/* Make the embedded ledger sit seamlessly inside RISE Sports, WITHOUT editing
   court-ledger/Uploads/index.html — that file is the owner's, and it will keep
   being updated. Everything here is applied at build time to a copy.

   It already uses Sora, and it already ships a full light palette; it just
   defaults to dark and picks slightly different accents. So this flips the
   default and remaps its CSS variables onto the RISE palette. */
const riseLedgerTheme = html => {
  let h = html;
  // Force light. Note the ledger PERSISTS its theme in its own localStorage, so
  // flipping the attribute is not enough — a device that once ran it in dark
  // would restore dark and land in a hybrid state (light backgrounds, dark
  // text variables, white-on-white text). Pin it until RISE gains a dark mode.
  h = h.replace(/<html([^>]*)data-theme="dark"/i, '<html$1data-theme="light"');
  // Pin at the function itself rather than at each call site: the ledger reads
  // its stored theme in one place and toggles it in another, and both have to
  // agree or the CSS variables and the theme attribute end up disagreeing.
  h = h.replace(/function applyTheme\(\s*(\w+)\s*\)\s*\{/,
    (m, arg) => `function applyTheme(${arg}){ ${arg} = "light"; /* pinned by RISE build */`);
  // the host page already loads Sora; a second request inside the iframe is waste
  h = h.replace(/<link[^>]+fonts\.(googleapis|gstatic)\.com[^>]*>\s*/gi, "");
  /* Remap onto the RISE palette. This declares the COMPLETE set the ledger
     uses, not just the accents — a partial override leaves the rest on their
     dark values the moment the theme attribute disagrees. */
  const override = `<style id="rise-skin">
    :root, [data-theme="light"], [data-theme="dark"] {
      --bg:#eef1f6; --surface:#ffffff; --card:#ffffff; --card2:#f1f4f9; --card3:#e2e8f0;
      --line:#e2e8f0; --line2:#cbd5e1;
      --lime:#65a30d; --lime-dark:#4d7c0f; --teal:#0d9488; --blue:#2563eb;
      --purple:#7c3aed; --red:#e11d48; --gold:#ca8a04; --orange:#ea580c;
      --text:#0f172a; --text-heading:#0f172a; --muted:#475569; --dim:#94a3b8;
      --shadow:0 4px 20px -2px rgba(0,0,0,.06);
      --hero-bg:linear-gradient(150deg, rgba(101,163,13,.10), rgba(13,148,136,.06));
      --hero-border:rgba(101,163,13,.25);
      --badge-admin:rgba(101,163,13,.12);  --badge-admin-txt:#4d7c0f;
      --badge-op:rgba(37,99,235,.12);      --badge-op-txt:#2563eb;
      --badge-viewer:rgba(100,116,139,.12);--badge-viewer-txt:#475569;
    }
    body{font-family:'Sora',system-ui,-apple-system,sans-serif;background:var(--bg)}
  </style>`;
  return h.includes("</head>") ? h.replace("</head>", override + "</head>") : override + h;
};

try {
  const ledger = riseLedgerTheme(fs.readFileSync("court-ledger/Uploads/index.html", "utf8"));
  const slot = /(<script id="rise-ledger">)[\s\S]*?(<\/script>)/;
  if (!slot.test(out)) {
    console.warn('warning: <script id="rise-ledger"> slot missing; ledger not embedded');
  } else {
    // JSON.stringify does NOT protect a closing script tag: the HTML parser
    // ends the block at the first literal </script> regardless of JS string
    // context, so the assignment gets truncated and silently never runs.
    // Escaping the slash keeps the string identical at runtime while hiding
    // the tag from the parser. Same rule the app source lives under.
    const safe = JSON.stringify(ledger).replace(/<\/script/gi, "<\\/script");
    // Hard stop. A literal closing tag here truncates the slot mid-string, and
    // because the output IS the next build's template, that corruption becomes
    // permanent and compounds on every rebuild. It cost a manual repair once.
    if (/<\/script/i.test(safe)) {
      console.error("ERROR: ledger payload contains a literal closing script tag.");
      process.exit(1);
    }
    // Function replacement: a string replacement would expand $-sequences that
    // happen to appear in the payload.
    out = out.replace(slot, (m, a, b) => a + "window.RISE_LEDGER=" + safe + ";" + b);
    console.log(`ledger: embedded (${Math.round(ledger.length / 1024)} KB)`);
  }
} catch (e) {
  console.warn("warning: court-ledger/Uploads/index.html not found; Ledger tab will be empty");
}

// The template is also the output, so a bad splice corrupts the file it read.
// Adding a <script> AFTER the app block would make lastIndexOf pick the wrong
// one and quietly overwrite that instead — verify before writing, not after.
const headMarkers = ["<title>", "id=\"loading-screen\""];
for (const m of headMarkers) {
  if (html.includes(m) && !out.includes(m)) {
    console.error(`ERROR: splice destroyed the shell (lost ${m}).`);
    console.error("Is there a <script> block AFTER the app block in the template?");
    process.exit(1);
  }
}
// Position-independent: the app source must live inside the LAST script block.
// (Comparing against the template's index breaks as soon as anything is
// injected earlier in the document, e.g. the brand payload below.)
const srcProbe = src.slice(0, 60);
if (out.indexOf(srcProbe, out.lastIndexOf(open)) === -1) {
  console.error("ERROR: the app block is not the last <script> in the output.");
  console.error("Is there a <script> block AFTER the app block in the template?");
  process.exit(1);
}

fs.writeFileSync(outPath, out);
console.log(`built ${outPath}: ${out.length} bytes (app source: ${src.length} bytes)`);

if (COMPAT_COPY && COMPAT_COPY !== outPath) {
  fs.writeFileSync(COMPAT_COPY, out);
  console.log(`compat copy: ${COMPAT_COPY} (old filename, remove after the rebrand ships)`);
}

// index.html — what static hosts serve at "/". Vercel (and GitHub Pages, and
// tools/serve.js) all resolve the bare origin to this file, so the app has a
// clean URL with no config. Same bytes as rise-sports.html.
fs.writeFileSync("index.html", out);
console.log("index.html: root entry point for static hosting");

// --- PWA: manifest + service worker -----------------------------------------
// These two are the only files the app needs beyond the HTML, and they matter
// only when it is SERVED. Opening rise-sports.html directly off disk still
// works with no network and no service worker — that path must never regress.
//
// The cache name carries a hash of the built HTML, so every build invalidates
// the old cache. Without that a service worker will happily pin a stale build
// on someone's phone forever.
const crypto = require("crypto");
const buildHash = crypto.createHash("sha256").update(out).digest("hex").slice(0, 12);

const manifest = {
  name: "RISE Sports",
  short_name: "RISE",
  description: "Tournaments, ratings and community play across seven sports.",
  start_url: "./" + outPath,
  scope: "./",
  display: "standalone",
  orientation: "any",
  background_color: "#eef1f6",
  theme_color: "#65a30d",
  icons: [
    { src: "./icons/icon-192.png", sizes: "192x192", type: "image/png", purpose: "any" },
    { src: "./icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "any" },
    { src: "./icons/icon-512-maskable.png", sizes: "512x512", type: "image/png", purpose: "maskable" }
  ]
};
fs.writeFileSync("manifest.webmanifest", JSON.stringify(manifest, null, 2));

const sw = `/* RISE Sports service worker — GENERATED by build.js. Do not edit.
   Rebuild with: node build.js
   Cache is keyed to the build hash, so a new build always supersedes the old. */
const CACHE = "rise-sports-${buildHash}";
const ASSETS = [
  "./",
  "./${outPath}",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-512-maskable.png",
  "./icons/apple-touch-icon.png"
];

self.addEventListener("install", e => {
  /* Added one at a time: cache.addAll rejects the whole batch if a single
     entry 404s, which would leave the app with no offline copy at all. */
  e.waitUntil(caches.open(CACHE)
    .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {}))))
    .then(() => self.skipWaiting()));
});

self.addEventListener("activate", e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;

  /* The page itself is network-first: a returning user should get the new
     build when they have signal, and the cached one when they do not. */
  if (req.mode === "navigate") {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match("./${outPath}")))
    );
    return;
  }

  /* Everything else (icons, manifest) is content-addressed by build hash,
     so cache-first is safe and keeps the app instant on a bad connection. */
  e.respondWith(caches.match(req).then(r => r || fetch(req)));
});
`;
fs.writeFileSync("sw.js", sw);
console.log(`pwa: manifest.webmanifest + sw.js (cache rise-sports-${buildHash})`);
