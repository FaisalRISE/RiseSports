#!/usr/bin/env node
/**
 * serve.js — local static server for testing the PWA layer.
 *
 * Usage:  node tools/serve.js [port]      (default 8765)
 *
 * The app itself runs fine from file://, but service workers do not exist on
 * file:// and a manifest will not be honoured there either. So installability,
 * offline caching and "Add to Home Screen" can only be exercised over http.
 *
 * Deliberately HTTP/1.1 with keep-alive: Python's http.server defaults to
 * HTTP/1.0 and closes the socket per request, which makes Chrome fail the
 * service-worker script fetch with a bare "unknown error".
 *
 * Serves the project directory. Not hardened — local testing only.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const port = Number(process.argv[2]) || 8765;
const root = path.join(__dirname, "..");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".css": "text/css; charset=utf-8",
  ".md": "text/markdown; charset=utf-8"
};

const server = http.createServer((req, res) => {
  let rel;
  try {
    rel = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
  } catch {
    res.writeHead(400).end("bad request");
    return;
  }
  if (rel === "/") rel = "/rise-sports.html";

  // keep the server inside the project directory
  const file = path.join(root, rel);
  if (!file.startsWith(root)) {
    res.writeHead(403).end("forbidden");
    return;
  }

  fs.readFile(file, (err, buf) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("not found: " + rel);
      return;
    }
    res.writeHead(200, {
      "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream",
      "Content-Length": buf.length,
      // never cache during testing, or you debug yesterday's build
      "Cache-Control": "no-store",
      // the service worker needs to be allowed to control the whole origin
      "Service-Worker-Allowed": "/"
    });
    res.end(buf);
  });
});

server.keepAliveTimeout = 5000;
server.listen(port, "127.0.0.1", () => {
  console.log(`serving ${root}`);
  console.log(`  http://127.0.0.1:${port}/rise-sports.html`);
  console.log("ctrl-c to stop");
});
