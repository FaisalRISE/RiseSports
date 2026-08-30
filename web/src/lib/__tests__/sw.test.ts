/* Drives the REAL public/sw.js against stubs.
 *
 * Following the convention used elsewhere in this project: run the file that
 * actually ships rather than a retyped copy, which drifts. Service worker
 * registration cannot be exercised from the test runner (or from an embedded
 * dev browser, which blocks `register()`), so the listeners are invoked
 * directly and their side effects inspected. Real registration and "Add to
 * Home Screen" still need a real browser. */

import { describe, it, expect, beforeEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const SRC = fs.readFileSync(path.resolve(process.cwd(), "public/sw.js"), "utf8");
const VERSION = "build123";

type Handler = (event: FakeEvent) => void;
type FakeEvent = {
  request?: FakeRequest;
  waitUntil: (p: Promise<unknown>) => void;
  respondWith: (r: Promise<Response> | Response) => void;
};
type FakeRequest = { url: string; method: string; mode?: string; clone?: () => FakeRequest };

class FakeCache {
  store = new Map<string, unknown>();
  added: string[] = [];
  failAdd = false;
  async add(url: string) {
    if (this.failAdd) throw new Error("offline");
    this.added.push(url);
    this.store.set(url, { body: url, ok: true, type: "basic" });
  }
  async put(req: FakeRequest | string, res: unknown) {
    this.store.set(typeof req === "string" ? req : req.url, res);
  }
  async match(req: FakeRequest | string) {
    return this.store.get(typeof req === "string" ? req : req.url);
  }
}

/* Rebuilt for every test so state never leaks between them. */
function harness(opts: { fetchImpl?: (r: FakeRequest) => Promise<unknown> } = {}) {
  const listeners = new Map<string, Handler>();
  const cacheStore = new Map<string, FakeCache>();
  const deleted: string[] = [];
  const fetched: string[] = [];
  let claimed = false;
  let skipped = false;

  const caches = {
    async open(name: string) {
      if (!cacheStore.has(name)) cacheStore.set(name, new FakeCache());
      return cacheStore.get(name)!;
    },
    async keys() {
      return [...cacheStore.keys()];
    },
    async delete(name: string) {
      deleted.push(name);
      return cacheStore.delete(name);
    },
    async match(req: FakeRequest | string) {
      const key = typeof req === "string" ? req : req.url;
      for (const c of cacheStore.values()) {
        const hit = await c.match(key);
        if (hit) return hit;
      }
      return undefined;
    },
  };

  const self = {
    location: { href: `https://rise.test/sw.js?v=${VERSION}`, origin: "https://rise.test" },
    addEventListener: (type: string, fn: Handler) => listeners.set(type, fn),
    skipWaiting: () => {
      skipped = true;
    },
    clients: {
      claim: async () => {
        claimed = true;
      },
    },
  };

  const fetchImpl =
    opts.fetchImpl ??
    (async (r: FakeRequest) => ({
      body: `net:${r.url}`,
      ok: true,
      type: "basic",
      clone: () => ({ body: `net:${r.url}`, ok: true, type: "basic" }),
    }));

  const fetch = async (r: FakeRequest) => {
    fetched.push(r.url);
    return fetchImpl(r);
  };

  class FakeResponse {
    body: string;
    status: number;
    ok: boolean;
    constructor(body: string, init?: { status?: number }) {
      this.body = body;
      this.status = init?.status ?? 200;
      this.ok = this.status < 400;
    }
  }

  new Function("self", "caches", "fetch", "Response", "URL", SRC)(
    self,
    caches,
    fetch,
    FakeResponse,
    URL,
  );

  /* Collects whatever the handler passed to waitUntil / respondWith so the
     test can await the worker's actual work. */
  const fire = async (type: string, request?: FakeRequest) => {
    const pending: Promise<unknown>[] = [];
    let responded: Promise<Response> | Response | undefined;
    const event: FakeEvent = {
      request,
      waitUntil: (p) => void pending.push(Promise.resolve(p)),
      respondWith: (r) => {
        responded = r;
      },
    };
    listeners.get(type)?.(event);
    await Promise.all(pending);
    const response = responded ? await responded : undefined;
    return { response, respondedAt: responded !== undefined };
  };

  return { fire, cacheStore, deleted, fetched, claimed: () => claimed, skipped: () => skipped };
}

const nav = (url: string): FakeRequest => ({ url, method: "GET", mode: "navigate" });
const sub = (url: string): FakeRequest => ({ url, method: "GET", mode: "no-cors" });

describe("service worker", () => {
  let h: ReturnType<typeof harness>;
  beforeEach(() => {
    h = harness();
  });

  it("precaches the offline page and takes over immediately", async () => {
    await h.fire("install");
    const shell = h.cacheStore.get(`rise-shell-${VERSION}`);
    expect(shell?.added).toContain("/offline.html");
    expect(h.skipped()).toBe(true);
  });

  it("still installs when the offline page cannot be fetched", async () => {
    const h2 = harness();
    await h2.fire("install");
    const shell = h2.cacheStore.get(`rise-shell-${VERSION}`)!;
    shell.failAdd = true;
    shell.store.clear();
    /* Re-firing install with a failing add must not reject or leave the worker
       stuck: a missing fallback page is a degraded experience, not a broken
       one. */
    await expect(h2.fire("install")).resolves.toBeDefined();
    expect(h2.skipped()).toBe(true);
  });

  /* The rule that matters most: a deploy must not leave an old cache serving
     an old build. This project has already lost a day to exactly that. */
  it("activate deletes every cache from another version and keeps this one", async () => {
    await h.fire("install");
    h.cacheStore.set("rise-shell-OLDBUILD", new FakeCache());
    h.cacheStore.set("rise-runtime-OLDBUILD", new FakeCache());
    await h.fire("activate");
    expect(h.deleted).toContain("rise-shell-OLDBUILD");
    expect(h.deleted).toContain("rise-runtime-OLDBUILD");
    expect(h.deleted).not.toContain(`rise-shell-${VERSION}`);
    expect(h.claimed()).toBe(true);
  });

  it("navigation goes to the network first, and caches what comes back", async () => {
    const { response } = await h.fire("fetch", nav("https://rise.test/t/x/score/m1"));
    expect(h.fetched).toEqual(["https://rise.test/t/x/score/m1"]);
    expect((response as unknown as { body: string }).body).toBe("net:https://rise.test/t/x/score/m1");
    const runtime = h.cacheStore.get(`rise-runtime-${VERSION}`);
    expect(await runtime!.match("https://rise.test/t/x/score/m1")).toBeTruthy();
  });

  it("falls back to the cached page when the network is gone", async () => {
    const url = "https://rise.test/t/x/score/m1";
    await h.fire("fetch", nav(url)); // warm the cache while online

    const offline = harness({ fetchImpl: async () => { throw new Error("offline"); } });
    const runtime = await (offline.cacheStore.get(`rise-runtime-${VERSION}`) ?? new FakeCache());
    offline.cacheStore.set(`rise-runtime-${VERSION}`, runtime as FakeCache);
    await (runtime as FakeCache).put(url, { body: "cached-page", ok: true, type: "basic" });

    const { response } = await offline.fire("fetch", nav(url));
    expect((response as unknown as { body: string }).body).toBe("cached-page");
  });

  it("serves the offline page for a route never opened before", async () => {
    const offline = harness({ fetchImpl: async () => { throw new Error("offline"); } });
    await offline.fire("install");
    const { response } = await offline.fire("fetch", nav("https://rise.test/t/never/seen"));
    expect((response as unknown as { body: string }).body).toBe("/offline.html");
  });

  it("build output is cache-first — a hit does not touch the network", async () => {
    const url = "https://rise.test/_next/static/chunks/abc.js";
    await h.fire("fetch", sub(url));
    expect(h.fetched).toEqual([url]);
    await h.fire("fetch", sub(url)); // second time
    expect(h.fetched).toEqual([url]); // still one — served from cache
  });

  /* Everything below must reach the network untouched. Serving any of these
     from a cache would show one device's score on another, or silently drop a
     rally that the referee believes was sent. */
  it("does not intercept Server Action POSTs", async () => {
    const { respondedAt } = await h.fire("fetch", {
      url: "https://rise.test/t/x/score/m1",
      method: "POST",
      mode: "navigate",
    });
    expect(respondedAt).toBe(false);
  });

  it("does not intercept RSC payload requests", async () => {
    const { respondedAt } = await h.fire("fetch", nav("https://rise.test/t/x?_rsc=1a2b"));
    expect(respondedAt).toBe(false);
  });

  it("does not intercept API routes or cross-origin requests", async () => {
    expect((await h.fire("fetch", sub("https://rise.test/api/whatever"))).respondedAt).toBe(false);
    expect((await h.fire("fetch", nav("https://elsewhere.test/page"))).respondedAt).toBe(false);
  });

  it("does not cache a failed or opaque response", async () => {
    const bad = harness({
      fetchImpl: async () => ({ body: "err", ok: false, type: "basic", clone: () => ({}) }),
    });
    await bad.fire("fetch", nav("https://rise.test/t/x"));
    const runtime = bad.cacheStore.get(`rise-runtime-${VERSION}`);
    expect(runtime?.store.size ?? 0).toBe(0);
  });
});
