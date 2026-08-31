/* Offline scoring, end to end.
 *
 * This exists because the offline path was verified by hand and three real bugs
 * came out of that session — each one a way a rally could LOOK SAVED WHEN IT WAS
 * NOT, which is the single thing this feature must never do. Nothing but this
 * script stops those coming back.
 *
 * Two failure modes are covered, and they are genuinely different:
 *
 *   setOffline(true)  — flips navigator.onLine. The app can see it coming.
 *   route → abort     — navigator.onLine stays TRUE while every request fails.
 *
 * The second is a sports hall with WiFi and no route to the server. It is the
 * realistic one, it is what found all three bugs, and no navigator.onLine check
 * can detect it. Both are tested; the abort case is tested first because it is
 * the one that breaks.
 *
 * MUST run against a production build (`pnpm build && pnpm start`). The service
 * worker deliberately does not register in development, so on `pnpm dev` step 3
 * would pass for the wrong reason — the page would still be in memory. */

import {
  launch, BASE, makeOk, watchErrors, text,
  rallyCount, stableRallyCount, scores, tap, banner, queued, clearQueue,
  killNetwork, restoreNetwork, until, firstScorableMatch, realErrors,
} from "./harness.mjs";

const ok = makeOk();
const b = await launch();

async function freshPage() {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  return { ctx, p };
}

/* ── Scenario 1: WiFi up, server unreachable ─────────────────────────────── */
console.log("\n== the hall case: navigator.onLine true, every request failing ==");

const { ctx, p } = await freshPage();
const errs = watchErrors(p);

const matchId = await firstScorableMatch(p, "club-night");
ok(!!matchId, `found a match to score (${matchId})`);
const url = `${BASE}/t/club-night/score/${matchId}`;

await p.goto(url);
await p.waitForTimeout(800);
await clearQueue(p);
await p.reload();
await p.waitForTimeout(1200);

/* The service worker must be in charge before step 3 means anything. */
const swReady = await until(
  () => p.evaluate(() => !!navigator.serviceWorker?.controller),
  { label: "the service worker to take control" },
);
ok(swReady, "service worker registered and controlling the page");

const teams = await p.$$eval("button[aria-label^='Point to']", (els) =>
  els.map((e) => e.getAttribute("aria-label").replace("Point to ", "")),
);
ok(teams.length === 2, `two tap targets: ${teams.join(" / ")}`);

const startRallies = await stableRallyCount(p);
ok(typeof startRallies === "number", `starting rally count ${startRallies}`);

console.log("\n-- online, a healthy match --");
await tap(p, teams[0]);
await until(async () => (await rallyCount(p)) === startRallies + 1, { label: "the online tap to land" });
ok((await rallyCount(p)) === startRallies + 1, "an online tap is accepted");

/* Every tap queues now, so a regression to warning on `queued > 0` would flash
   on every point of a normal match and train the referee to ignore the one
   banner that matters. */
ok((await banner(p)) === null, "no connection banner during a healthy match");

console.log("\n-- kill the route to the server --");
await killNetwork(p);
ok(await p.evaluate(() => navigator.onLine), "navigator.onLine is still TRUE (the hard case)");

const before = await stableRallyCount(p);
await tap(p, teams[0]);
await p.waitForTimeout(700);
await tap(p, teams[1]);
await p.waitForTimeout(700);
await tap(p, teams[0]);

const advanced = await until(async () => (await rallyCount(p)) === before + 3, {
  label: "the local scorer to advance three rallies",
});
ok(advanced, `score keeps advancing with no server (${before} -> ${await rallyCount(p)})`);
ok((await scores(p)).some((n) => n >= 0), `scores render: ${(await scores(p)).join("-")}`);

const warned = await until(async () => (await banner(p)) !== null, { label: "the unsaved warning" });
const bannerText = await banner(p);
ok(warned, "a banner appears once a send has actually failed");
ok(/not yet saved/i.test(bannerText ?? ""), `banner says the rallies are unsaved: "${(bannerText ?? "").slice(0, 80)}…"`);
ok(/3 rallies/.test(bannerText ?? ""), "banner names the exact count (3 rallies)");
ok(
  !/\bsaved\b(?!.*not)/i.test((bannerText ?? "").replace(/not yet saved/i, "")),
  "banner never claims the rallies are saved",
);

const q = await queued(p);
ok(q.length === 1 && q[0].rallies === before + 3, `queue holds the whole log on disk (${JSON.stringify(q)})`);

console.log("\n-- reload with the server still unreachable --");
/* The reload itself must be served by the service worker: the route is still
   aborted, so nothing can come from the network. */
await p.reload().catch(() => {});
await p.waitForTimeout(2000);

const loadedCold = (await text(p)).includes("Club Night");
ok(loadedCold, "the console loads at all with no server (service worker)");

const restored = await until(async () => (await rallyCount(p)) === before + 3, {
  label: "the queue to be restored from IndexedDB",
});
ok(restored, `queued rallies survive a reload (${await rallyCount(p)})`);

/* The warning must be immediate. It used to reset on mount and stay silent
   until the 15s retry timer noticed, so a recovered console showed unsaved
   rallies as saved for up to fifteen seconds. */
const warnedFast = await until(async () => (await banner(p)) !== null, {
  timeout: 6000,
  label: "the warning to reappear WITHOUT waiting for the 15s retry timer",
});
ok(warnedFast, "a restored queue warns immediately, not after the retry timer");

console.log("\n-- restore the network --");
await restoreNetwork(p);

const drained = await until(async () => (await queued(p)).length === 0, {
  timeout: 30000,
  label: "the queue to drain on its own",
});
ok(drained, "the queue flushes with no user action");
ok(await until(async () => (await banner(p)) === null, { label: "the banner to clear" }), "banner clears once saved");

/* Prove it reached the SERVER, not just that the local copy looks tidy: with an
   empty queue, a fresh load can only render what the server holds. */
const expected = await rallyCount(p);
await p.goto(url);
await p.waitForTimeout(1500);
ok(
  (await rallyCount(p)) === expected,
  `the server holds every offline rally (${await rallyCount(p)} of ${expected})`,
);

await ctx.close();

/* ── Scenario 2: the browser knows it is offline ─────────────────────────── */
console.log("\n== the ordinary case: navigator.onLine false ==");

const { ctx: ctx2, p: p2 } = await freshPage();
watchErrors(p2, errs);
await p2.goto(url);
await p2.waitForTimeout(1200);
await clearQueue(p2);
await p2.reload();
await p2.waitForTimeout(1200);

const base2 = await stableRallyCount(p2);
await ctx2.setOffline(true);
ok(!(await p2.evaluate(() => navigator.onLine)), "navigator.onLine is false");

await tap(p2, teams[0]);
await p2.waitForTimeout(700);
await tap(p2, teams[0]);

ok(
  await until(async () => (await rallyCount(p2)) === base2 + 2, { label: "offline taps" }),
  `scoring works while the browser reports offline (${base2} -> ${await rallyCount(p2)})`,
);
const b2 = await banner(p2);
ok(b2 !== null && /offline/i.test(b2), `banner uses the offline wording: "${(b2 ?? "").slice(0, 60)}…"`);

/* Going back online fires the `online` event, which must flush without waiting
   for the retry timer. */
await ctx2.setOffline(false);
ok(
  await until(async () => (await queued(p2)).length === 0, { timeout: 20000, label: "flush on the online event" }),
  "reconnecting flushes the queue",
);

await ctx2.close();

console.log("\n== errors ==");
const real = realErrors(errs);
ok(real.length === 0, `no unexpected runtime errors: ${JSON.stringify(real.slice(0, 3))}`);
console.log(`  (${errs.length - real.length} expected offline fetch failures filtered)`);

await b.close();
ok.done("offline scoring");
