/* Two devices scoring the same match — the case with no safe automatic answer.
 *
 * Picking a winner silently would discard real rallies from a real court, so
 * the console has to stop and ask. But the opposite failure matters just as
 * much: prompting when there is NO genuine conflict trains referees to dismiss
 * the prompt, and then the one that matters gets dismissed too. Both directions
 * are asserted here.
 *
 * Run against a production build, same as offline.mjs. */

import {
  launch, BASE, makeOk, watchErrors, text,
  rallyCount, stableRallyCount, tap, queued, clearQueue, until, firstScorableMatch, realErrors, teamsOf,
} from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const errs = [];

async function console_(url) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const p = await ctx.newPage();
  watchErrors(p, errs);
  await p.goto(url);
  await p.waitForTimeout(1000);
  await clearQueue(p);
  await p.reload();
  await p.waitForTimeout(1200);
  return { ctx, p };
}

const conflictShown = (p) => p.$("text=Another device also scored this match").then(Boolean);

/* Pick a match with no rally log yet, so both devices start from the same
   known point and the logs diverge at a position we control. */
const probe = await b.newContext();
const probePage = await probe.newPage();
const matchId = await firstScorableMatch(probePage, "club-night");
const url = `${BASE}/t/club-night/score/${matchId}`;
await probe.close();
ok(!!matchId, `found a match (${matchId})`);

/* ── Part 1: a genuine divergence must interrupt ─────────────────────────── */
console.log("\n== both devices score while offline, differently ==");

const A = await console_(url);
const B = await console_(url);

const teams = await teamsOf(A.p);
const start = await stableRallyCount(A.p);
ok((await rallyCount(B.p)) === start, `both devices agree at the start (${start} rallies)`);

await A.ctx.setOffline(true);
await B.ctx.setOffline(true);

/* Different SIDES, so neither log is a prefix of the other — length alone
   would only make one "ahead" of the other, which resolves silently. */
await tap(A.p, teams[0]);
await A.p.waitForTimeout(400);
await tap(A.p, teams[0]);

await tap(B.p, teams[1]);
await B.p.waitForTimeout(400);
await tap(B.p, teams[1]);
await B.p.waitForTimeout(400);
await tap(B.p, teams[1]);

ok(await until(async () => (await rallyCount(A.p)) === start + 2, { label: "A's local score" }),
  `device A recorded 2 rallies (${await rallyCount(A.p)})`);
ok(await until(async () => (await rallyCount(B.p)) === start + 3, { label: "B's local score" }),
  `device B recorded 3 rallies (${await rallyCount(B.p)})`);

console.log("\n-- A reconnects first and lands cleanly --");
await A.ctx.setOffline(false);
ok(await until(async () => (await queued(A.p)).length === 0, { timeout: 25000, label: "A to flush" }),
  "device A's rallies save without a prompt");
ok(!(await conflictShown(A.p)), "device A is not prompted — nothing had diverged when it wrote");

console.log("\n-- B reconnects into a changed match --");
await B.ctx.setOffline(false);

const prompted = await until(() => conflictShown(B.p), { timeout: 30000, label: "the conflict prompt on B" });
ok(prompted, "device B is TOLD it diverged rather than silently overwriting");

const bText = await text(B.p);
ok(/Keep this phone/.test(bText), "B is offered its own version");
ok(/Keep the saved score/.test(bText), "B is offered the saved version");
ok(new RegExp(`${start + 3} rallies`).test(bText), `B's own count is shown (${start + 3})`);
ok(new RegExp(`${start + 2} rallies`).test(bText), `the saved count is shown (${start + 2})`);

/* The critical property: B must NOT have overwritten A while asking. */
const serverAfterPrompt = await (async () => {
  const check = await b.newContext();
  const cp = await check.newPage();
  await cp.goto(url);
  await cp.waitForTimeout(1500);
  const n = await rallyCount(cp);
  await check.close();
  return n;
})();
ok(serverAfterPrompt === start + 2, `the server still holds A's version while B asks (${serverAfterPrompt})`);

/* Scoring is locked while the question is open — a referee tapping past the
   prompt would be appending to a log that is about to be discarded. */
const tapsLocked = await B.p.$$eval("button[aria-label^='Point to']", (els) => els.every((e) => e.disabled));
ok(tapsLocked, "scoring is disabled on B until the conflict is answered");

console.log("\n-- resolving: keep the saved score --");
await B.p.click("text=Keep the saved score");
ok(await until(async () => !(await conflictShown(B.p)), { label: "the prompt to clear" }), "prompt clears");
ok(await until(async () => (await queued(B.p)).length === 0, { label: "B's queue to clear" }),
  "B's diverged rallies are discarded");
ok(await until(async () => (await rallyCount(B.p)) === start + 2, { timeout: 15000, label: "B to show A's score" }),
  `B now shows the saved score (${await rallyCount(B.p)})`);

await A.ctx.close();
await B.ctx.close();

/* ── Part 1b: the other resolution ─ keep THIS phone's rallies ──────────── */
console.log("\n== the same conflict, resolved the other way ==");

/* Ask for a scorable match again rather than reusing `url` blindly: Part 1 has
   added rallies, and if that match has since reached its target every tap is
   correctly disabled — which would fail here looking like a bug rather than a
   used-up fixture. Getting the SAME match back is fine and usual; it only
   matters that whatever comes back can still be scored. */
const probe2 = await b.newContext();
const pp2 = await probe2.newPage();
const matchId2 = await firstScorableMatch(pp2, "club-night");
await probe2.close();
const url2 = `${BASE}/t/club-night/score/${matchId2}`;
ok(!!matchId2, `a scorable match for the second conflict (${matchId2})`);

const E = await console_(url2);
const F = await console_(url2);
const start2 = await stableRallyCount(E.p);
const teams2 = await teamsOf(E.p);   // this match may be a different pairing

await E.ctx.setOffline(true);
await F.ctx.setOffline(true);
await tap(E.p, teams2[0]);
await F.p.waitForTimeout(200);
await tap(F.p, teams2[1]);
await F.p.waitForTimeout(400);
await tap(F.p, teams2[1]);

await E.ctx.setOffline(false);
ok(await until(async () => (await queued(E.p)).length === 0, { timeout: 25000, label: "E to flush" }),
  "device E saves first");

await F.ctx.setOffline(false);
ok(await until(() => conflictShown(F.p), { timeout: 30000, label: "the prompt on F" }),
  "device F is told it diverged");

console.log("\n-- resolving: keep this phone's score --");
await F.p.click("text=Keep this phone");
ok(await until(async () => !(await conflictShown(F.p)), { label: "the prompt to clear" }), "prompt clears");
ok(await until(async () => (await queued(F.p)).length === 0, { timeout: 20000, label: "F's queue to clear" }),
  "F's rallies are accepted");

/* F's version must now be what the SERVER holds — keeping "mine" has to
   actually overwrite, at the server's current rev, or the referee has been
   told something untrue. */
const serverAfterMine = await (async () => {
  const check = await b.newContext();
  const cp = await check.newPage();
  await cp.goto(url2);
  await cp.waitForTimeout(1500);
  const n = await rallyCount(cp);
  await check.close();
  return n;
})();
ok(serverAfterMine === start2 + 2, `the server now holds F's version (${serverAfterMine}, expected ${start2 + 2})`);

await E.ctx.close();
await F.ctx.close();

/* ── Part 2: a device that did not score must never be interrupted ───────── */
console.log("\n== one device scores, the other is only watching ==");

const probe3 = await b.newContext();
const pp3 = await probe3.newPage();
const matchId3 = await firstScorableMatch(pp3, "club-night");
await probe3.close();
const url3 = `${BASE}/t/club-night/score/${matchId3}`;

const C = await console_(url3);
const D = await console_(url3);
const base = await stableRallyCount(C.p);
const teams3 = await teamsOf(C.p);

await tap(C.p, teams3[0]);
ok(await until(async () => (await rallyCount(C.p)) === base + 1, { label: "C's tap" }), "device C scores");
ok(!(await conflictShown(C.p)), "device C is not prompted");

/* D is behind the server now. Reloading picks up the newer state; it must not
   claim a conflict, because D contributed nothing to argue about. */
await D.p.reload();
await D.p.waitForTimeout(2500);
ok(!(await conflictShown(D.p)), "the watching device is never prompted");
/* Waited for rather than sampled once: a reload is a round trip, and reading
   mid-flight showed the pre-reload number and failed a working feature. */
ok(
  await until(async () => (await rallyCount(D.p)) === base + 1, { label: "the watcher to catch up" }),
  `the watching device just shows the new score (${await rallyCount(D.p)})`,
);
ok((await queued(D.p)).length === 0, "the watching device has nothing queued");

await C.ctx.close();
await D.ctx.close();

console.log("\n== errors ==");
const real = realErrors(errs);
ok(real.length === 0, `no unexpected runtime errors: ${JSON.stringify(real.slice(0, 3))}`);

await b.close();
ok.done("two-device divergence");
