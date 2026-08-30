/* Service worker — offline shell for the referee console.
 *
 * Why this exists: `useOfflineScoring` keeps scoring with no signal, but only
 * once the page is already open. A referee who reloads, or who arrives at a
 * hall with no coverage, gets nothing without this. Offline scoring is not
 * finished until the page itself loads cold.
 *
 * ── Two rules this follows ────────────────────────────────────────────────
 *
 * 1. NAVIGATION IS NETWORK-FIRST. Cache-first would pin a stale build, which
 *    has already happened once on this project: a service worker served an old
 *    build during development and the app appeared not to change no matter what
 *    was deployed. The cache is a fallback for when the network fails, never
 *    the preferred answer.
 *
 * 2. THE CACHE NAME CARRIES THE BUILD ID, supplied as `?v=` on the registration
 *    URL. A new build changes that URL, so the browser fetches a new worker,
 *    and `activate` deletes every cache that does not belong to this version.
 *    Nothing survives a deploy.
 *
 * Deliberately NOT cached: Server Actions (POST), RSC payloads (`?_rsc=`) and
 * anything cross-origin. Scores must come from the server or from the local
 * queue — never from a stale GET that merely looks current. */

const VERSION = new URL(self.location.href).searchParams.get("v") || "dev";
const SHELL = `rise-shell-${VERSION}`;
const RUNTIME = `rise-runtime-${VERSION}`;
const OFFLINE_URL = "/offline.html";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((c) => c.add(OFFLINE_URL))
      /* A missing fallback page must not wedge the worker in "installing"
         forever — the runtime cache is still worth having without it. */
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) =>
        Promise.all(names.filter((n) => !n.endsWith(`-${VERSION}`)).map((n) => caches.delete(n))),
      )
      .then(() => self.clients.claim()),
  );
});

/** Requests that must always hit the network, never a cache. */
function isUncacheable(request, url) {
  return (
    request.method !== "GET" ||
    url.origin !== self.location.origin ||
    url.pathname.startsWith("/api/") ||
    /* RSC payloads carry per-request state; a cached one shows another
       device's score as if it were this one's. */
    url.searchParams.has("_rsc")
  );
}

async function networkFirst(request) {
  try {
    const fresh = await fetch(request);
    /* Only stash complete, successful responses. A 206 or an opaque redirect
       replayed from cache renders as a broken page. */
    if (fresh && fresh.ok && fresh.type === "basic") {
      const copy = fresh.clone();
      const cache = await caches.open(RUNTIME);
      await cache.put(request, copy);
    }
    return fresh;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    const fallback = await caches.match(OFFLINE_URL);
    if (fallback) return fallback;
    return new Response("Offline, and this page has not been opened before.", {
      status: 503,
      headers: { "Content-Type": "text/plain; charset=utf-8" },
    });
  }
}

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const fresh = await fetch(request);
  if (fresh && fresh.ok && fresh.type === "basic") {
    const cache = await caches.open(RUNTIME);
    await cache.put(request, fresh.clone());
  }
  return fresh;
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (isUncacheable(request, url)) return; // fall through to the network

  /* Build output is content-hashed and immutable, so cache-first is safe here
     and is what makes a cold offline load fast. */
  if (url.pathname.startsWith("/_next/static/")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkFirst(request));
  }
});
