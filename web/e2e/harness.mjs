/* Shared setup for the end-to-end scripts.
 *
 * These used to hardcode a Linux sandbox's paths —
 *   import { chromium } from '/opt/node22/.../playwright/index.mjs'
 *   chromium.launch({ executablePath: '/opt/pw-browsers/.../chrome' })
 * — so none of them ran anywhere else. Playwright is a devDependency now and
 * resolves its own browser, which works on every machine.
 *
 * `E2E_URL` overrides the target. Keep the default on `localhost`, NOT
 * `127.0.0.1`: Next refuses `/_next/*` from an unrecognised origin, so the HTML
 * loads, every chunk 403s, React never hydrates, and every click silently does
 * nothing. It looks exactly like a broken app. See README.md. */

import { chromium } from "playwright";

export const BASE = process.env.E2E_URL ?? "http://localhost:3111";

export { chromium };

export function launch(opts = {}) {
  /* The original scripts always forced `proxy: direct://`, which was right in
     the sandbox they were written in and wrong here — on Windows it produces
     ERR_PROXY_CONNECTION_FAILED on the first navigation. Opt in with
     E2E_NO_PROXY=1 on a machine whose system proxy swallows localhost. */
  const bypass = process.env.E2E_NO_PROXY === "1"
    ? { proxy: { server: "direct://", bypass: "*" }, args: ["--no-proxy-server"] }
    : {};
  return chromium.launch({ ...bypass, ...opts });
}

/** Counts failures so the process can exit non-zero. */
export function makeOk() {
  const state = { fails: 0 };
  const ok = (cond, msg) => {
    console.log((cond ? "  ok   " : "  FAIL ") + msg);
    if (!cond) state.fails++;
  };
  ok.fails = () => state.fails;
  ok.done = (name) => {
    console.log(`\n${state.fails === 0 ? "PASS" : "FAIL"} — ${name} (${state.fails} failed)`);
    process.exit(state.fails === 0 ? 0 : 1);
  };
  return ok;
}

/** Collects page errors so a silent hydration failure cannot pass as success. */
export function watchErrors(page, sink = []) {
  page.on("pageerror", (e) => sink.push("pageerror: " + e.message));
  page.on("console", (m) => {
    if (m.type() === "error") sink.push("console: " + m.text().slice(0, 150));
  });
  return sink;
}

/* Deliberately killing the network produces console noise — failed fetches and
   Next's RSC-payload warning. Those are the EXPECTED result of the test, not a
   defect, so they are filtered out; anything else still fails the run. */
const EXPECTED_OFFLINE_NOISE = [
  /net::ERR_FAILED/,
  /net::ERR_INTERNET_DISCONNECTED/,
  /Failed to load resource/,
  /Failed to fetch RSC payload/,
  /the server responded with a status of 5\d\d/,
];

export const realErrors = (errs) =>
  errs.filter((e) => !EXPECTED_OFFLINE_NOISE.some((re) => re.test(e)));

export const text = (page, sel = "body") =>
  page.textContent(sel).then((t) => (t ?? "").replace(/\s+/g, " "));

/* ── Helpers specific to offline scoring ─────────────────────────────────── */

/** Rally count from the console's own footer.
 *
 * Addressed by test id, not by scanning the page: the connection banner also
 * says "N rallies", and a body-wide regex matched THAT first — reporting 3
 * when the console showed 22. Every offline assertion silently measured the
 * wrong number until this was pinned down. */
export async function rallyCount(page) {
  return retryOnNavigation(page, async () => {
    const el = await page.$("[data-testid='rally-count']");
    if (!el) return null;
    const m = (await el.textContent()).match(/(\d+)\s+rallies/);
    return m ? Number(m[1]) : null;
  });
}

/**
 * Re-read once if the page navigated mid-read.
 *
 * Scoring triggers a router refresh, so a DOM read started just before one
 * lands dies with "Execution context was destroyed". That is the test racing
 * the app, not a defect in it — retrying once is the honest fix, and anything
 * still failing afterwards is real.
 */
/* Playwright reports the same race in several wordings depending on exactly
   where the navigation landed, so match on all of them rather than the one that
   happened to show up first. */
const NAVIGATION_RACE =
  /Execution context was destroyed|Target closed|Unable to adopt element handle|detached|Frame was detached/i;

async function retryOnNavigation(page, read) {
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await read();
    } catch (e) {
      if (!NAVIGATION_RACE.test(String(e)) || attempt === 2) throw e;
      await page.waitForTimeout(400);
    }
  }
}

/**
 * A rally count that has stopped moving.
 *
 * Scoring triggers a server round trip and a router refresh, so a plain read
 * taken straight afterwards can still show the PREVIOUS value. Sampling a
 * mid-flight number as the baseline made a later "+3" assertion look like "+4"
 * and failed a working feature. Two agreeing reads mean the UI has settled.
 */
export async function stableRallyCount(page, { tries = 12, gap = 400 } = {}) {
  let last = await rallyCount(page);
  for (let i = 0; i < tries; i++) {
    await page.waitForTimeout(gap);
    const next = await rallyCount(page);
    if (next === last) return next;
    last = next;
  }
  return last;
}

/** The two scores, left to right as rendered. */
export async function scores(page) {
  return page.$$eval("button[aria-label^='Point to'] .font-mono", (els) =>
    els.map((e) => Number(e.textContent.trim())),
  );
}

/** The two team names, read from THIS page.
 *
 * Always re-read per match. Reusing names captured from an earlier match is a
 * thirty-second click timeout waiting for a button that was never on the page:
 * these scripts hop between fixtures as matches get used up, and the pairings
 * differ. */
export const teamsOf = (page) =>
  page.$$eval("button[aria-label^='Point to']", (els) =>
    els.map((e) => e.getAttribute("aria-label").replace("Point to ", "")),
  );

export const tap = (page, teamName) =>
  page.click(`button[aria-label="Point to ${teamName}"]`);

/** The connection banner's text, or null when no banner is shown. */
export async function banner(page) {
  return retryOnNavigation(page, async () => {
    const el = await page.$("p[role='status']");
    return el ? (await el.textContent()).replace(/\s+/g, " ").trim() : null;
  });
}

/** What is actually sitting in the offline queue, read from the page. */
export function queued(page) {
  return page.evaluate(
    () =>
      new Promise((res) => {
        const r = indexedDB.open("rise-offline");
        r.onsuccess = () => {
          const db = r.result;
          if (!db.objectStoreNames.contains("queued-matches")) return res([]);
          const q = db.transaction("queued-matches", "readonly").objectStore("queued-matches").getAll();
          q.onsuccess = () => res(q.result.map((x) => ({ matchId: x.matchId, rallies: x.log.length })));
          q.onerror = () => res([]);
        };
        r.onerror = () => res([]);
      }),
  );
}

export function clearQueue(page) {
  return page.evaluate(
    () =>
      new Promise((res) => {
        const d = indexedDB.deleteDatabase("rise-offline");
        d.onsuccess = d.onerror = d.onblocked = () => res();
      }),
  );
}

/**
 * Simulate a hall with WiFi but no route to the server.
 *
 * This is NOT the same as context.setOffline(true), and the difference is the
 * whole point: setOffline flips navigator.onLine, so the app can see it coming.
 * Aborting requests leaves navigator.onLine TRUE while everything fails, which
 * is the case that produced every offline bug found so far.
 */
export async function killNetwork(page) {
  await page.route("**", (route) => route.abort());
}

export async function restoreNetwork(page) {
  await page.unroute("**");
}

/** Wait for a condition, polling — better failure messages than a bare timeout. */
export async function until(fn, { timeout = 25000, interval = 500, label = "condition" } = {}) {
  const started = Date.now();
  for (;;) {
    if (await fn()) return true;
    if (Date.now() - started > timeout) {
      console.log(`  (timed out after ${timeout}ms waiting for ${label})`);
      return false;
    }
    await new Promise((r) => setTimeout(r, interval));
  }
}

/**
 * Finds a match that can actually still be scored.
 *
 * Two traps here, both hit while writing these tests:
 *
 * - The MANAGE page is where per-match Score links live. The public tournament
 *   page only links the PIN entry route (`/t/<slug>/score`), which redirects
 *   straight back while open access is on.
 *
 * - Taking the FIRST link is not enough. These scripts add rallies, so a match
 *   reaches its target and every tap button correctly becomes disabled — after
 *   which the next run fails on a thirty-second click timeout that looks like a
 *   broken app rather than a used-up fixture. So each candidate is opened and
 *   the tap buttons checked; the first genuinely scoreable one wins.
 */
export async function firstScorableMatch(page, slug) {
  await page.goto(`${BASE}/t/${slug}/manage`);
  await page.waitForTimeout(800);
  const hrefs = await page.$$eval("a[href*='/score/']", (as) =>
    as.map((a) => a.getAttribute("href")).filter((h) => /\/score\/[0-9a-f-]{36}$/.test(h)),
  );
  for (const href of [...new Set(hrefs)]) {
    await page.goto(`${BASE}${href}`);
    await page.waitForTimeout(900);
    const usable = await page.$$eval(
      "button[aria-label^='Point to']",
      (els) => els.length === 2 && els.every((e) => !e.disabled),
    ).catch(() => false);
    if (usable) return href.split("/score/")[1];
  }
  return null;
}
