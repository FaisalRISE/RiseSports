/**
 * sw-behaviour.test.js — runs the real sw.js against stubs.
 *
 * A service worker cannot be registered in the embedded browser used for
 * development, and once installed on a real device a broken one is worse than
 * none: it sits between the user and every request, and can pin a stale build
 * or serve nothing at all. So the handlers get exercised here instead.
 *
 * This loads the GENERATED sw.js and drives its listeners directly.
 */
const fs = require("fs"), path = require("path");
const swSrc = fs.readFileSync(path.join(__dirname, "..", "sw.js"), "utf8");

let pass = 0, fail = 0;
const check = (name, cond, extra) => cond ? (pass++, console.log("  PASS  " + name))
                                          : (fail++, console.log("  FAIL  " + name + "  " + (extra === undefined ? "" : extra)));

/* ---------- stubs ---------- */
function makeEnv({ failUrls = [], existingCaches = [] } = {}) {
  const stores = new Map();          // cacheName -> Map(url -> response)
  existingCaches.forEach(n => stores.set(n, new Map()));
  const log = { skipWaiting: 0, claim: 0, deleted: [] };
  const keyOf = r => (typeof r === "string" ? r : r.url);

  const cacheApi = name => ({
    add: async url => {
      if (failUrls.includes(url)) throw new Error("404 " + url);
      stores.get(name).set(url, { body: "cached:" + url });
    },
    put: async (req, res) => { stores.get(name).set(keyOf(req), res); },
    match: async req => stores.get(name).get(keyOf(req))
  });

  const caches = {
    open: async name => { if (!stores.has(name)) stores.set(name, new Map()); return cacheApi(name); },
    keys: async () => [...stores.keys()],
    delete: async name => { log.deleted.push(name); return stores.delete(name); },
    match: async req => {
      for (const s of stores.values()) { const hit = s.get(keyOf(req)); if (hit) return hit; }
      return undefined;
    }
  };

  const listeners = {};
  const self = {
    addEventListener: (t, fn) => { listeners[t] = fn; },
    skipWaiting: () => { log.skipWaiting++; },
    clients: { claim: async () => { log.claim++; } },
    caches
  };
  return { self, caches, listeners, stores, log };
}

function loadSW(env, fetchImpl) {
  new Function("self", "caches", "fetch", "clients", swSrc)(env.self, env.caches, fetchImpl, env.self.clients);
  return env.listeners;
}

const evt = request => {
  const e = { request, _waits: [], _responded: undefined };
  e.waitUntil = p => e._waits.push(p);
  e.respondWith = p => { e._responded = p; };
  return e;
};
const settle = async e => { await Promise.all(e._waits); return e; };

/* prime a worker's cache by running its install handler to completion */
const primeCache = async L => settle((() => { const i = evt(); L.install(i); return i; })());

const OFFLINE = async () => { throw new Error("offline"); };

async function main() {
  console.log("install");
  {
    const env = makeEnv();
    const L = loadSW(env, async () => ({ body: "net" }));
    const e = evt();
    L.install(e);
    await settle(e);
    const cacheName = [...env.stores.keys()][0];
    check("opens a build-hashed cache", /^rise-sports-[0-9a-f]{12}$/.test(cacheName), cacheName);
    check("caches the app shell", env.stores.get(cacheName).has("./rise-sports.html"));
    check("caches the manifest and icons", env.stores.get(cacheName).has("./manifest.webmanifest")
      && env.stores.get(cacheName).has("./icons/icon-192.png"));
    check("calls skipWaiting", env.log.skipWaiting === 1);
  }
  {
    // the reason addAll is avoided: one bad entry must not lose the whole cache
    const env = makeEnv({ failUrls: ["./icons/icon-512-maskable.png"] });
    const L = loadSW(env, async () => ({ body: "net" }));
    const e = evt();
    L.install(e);
    await settle(e);
    const c = env.stores.get([...env.stores.keys()][0]);
    check("one failed asset does not lose the rest", c.has("./rise-sports.html") && c.size >= 5, "size " + c.size);
  }

  console.log("\nactivate");
  {
    const env = makeEnv({ existingCaches: ["rise-sports-oldbuild01", "unrelated-cache"] });
    const L = loadSW(env, async () => ({ body: "net" }));
    const e = evt();
    L.activate(e);
    await settle(e);
    check("deletes the previous build's cache", env.log.deleted.includes("rise-sports-oldbuild01"));
    check("claims open clients", env.log.claim === 1);
  }

  console.log("\nfetch — online");
  {
    const env = makeEnv();
    const netRes = { body: "fresh", clone: () => ({ body: "fresh-copy" }) };
    const L = loadSW(env, async () => netRes);
    const e = evt({ method: "GET", mode: "navigate", url: "./rise-sports.html" });
    L.fetch(e);
    const r = await e._responded;
    check("navigation is served from the network", r && r.body === "fresh");
  }
  {
    const env = makeEnv();
    const L = loadSW(env, async () => ({ body: "net" }));
    const e = evt({ method: "POST", mode: "cors", url: "./anything" });
    L.fetch(e);
    check("non-GET requests are not intercepted", e._responded === undefined);
  }

  console.log("\nfetch — offline");
  {
    const env = makeEnv();
    const L = loadSW(env, OFFLINE);
    await primeCache(L);
    const e = evt({ method: "GET", mode: "navigate", url: "./rise-sports.html" });
    L.fetch(e);
    const r = await e._responded;
    check("navigation falls back to cache", !!r && /rise-sports\.html/.test(r.body), JSON.stringify(r));
  }
  {
    const env = makeEnv();
    const L = loadSW(env, OFFLINE);
    await primeCache(L);
    const e = evt({ method: "GET", mode: "navigate", url: "./some/deep/route" });
    L.fetch(e);
    const r = await e._responded;
    check("unknown route falls back to the app shell", !!r && /rise-sports\.html/.test(r.body), JSON.stringify(r));
  }
  {
    const env = makeEnv();
    const L = loadSW(env, OFFLINE);
    await primeCache(L);
    const e = evt({ method: "GET", mode: "cors", url: "./icons/icon-192.png" });
    L.fetch(e);
    const r = await e._responded;
    check("assets are served cache-first", !!r && /icon-192/.test(r.body), JSON.stringify(r));
  }

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail ? 1 : 0);
}

main().catch(e => { console.error("test harness error:", e); process.exit(1); });
