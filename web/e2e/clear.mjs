/* Clearing a result and resetting a match, in a real browser (step 8).
 *
 * Before step 8 a played match could be deleted with one tap and the rating
 * changes it made stayed on the players with no record behind them; nothing
 * could clear a result or reset a match; and a referee's phone holding points
 * for a match the organiser had cleared wrote them straight back. Now:
 *   - a finished match offers "Clear result…", which says how many players'
 *     ratings it takes back, and the first tap changes nothing;
 *   - the second tap clears it, and the ratings page shows nobody moved;
 *   - a match being played offers "Reset to 0–0…";
 *   - a referee's phone that held rallies with no signal is told the match was
 *     reset — "This phone's 3 rallies were not kept." — and the next rally it
 *     scores lands from 0–0;
 *   - and the same after the phone reloads, ONLINE, with rallies it took while
 *     the network was down;
 *   - and on a Final whose side a clear has emptied: its page has no court, and
 *     says the phone's points were not kept (ResetDrop).
 *
 * Run against a production build on a FRESH database — see e2e/README.md. */

import {
  launch, BASE, makeOk, watchErrors, realErrors, createTournament, tap, teamsOf,
  stableRallyCount, scores, clearQueue, until, killNetwork, restoreNetwork,
} from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const org = await b.newContext({ viewport: { width: 1100, height: 1100 } });
const p = await org.newPage();
const errs = watchErrors(p);
const stamp = String(process.hrtime.bigint()).slice(-6);

const manage = async (slug) => {
  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
};
const row = (id) => p.locator(`li[data-match="${id}"]`);
const said = async (loc) => ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();
/** Every player's movement at this event, read off the ratings page's hooks. */
const movement = async (slug) => {
  await p.goto(`${BASE}/t/${slug}/ratings`);
  await p.waitForTimeout(1200);
  return p.$$eval("tr[data-player]", (trs) =>
    trs.map((t) => ({ name: t.dataset.player, change: Number(t.dataset.change), played: Number(t.dataset.played) })));
};

try {
  const slug = await createTournament(p, `Clear ${stamp}`, { sport: "Pickleball", format: "Standard" });
  ok(!!slug, `created the event: ${slug}`);

  /* Three pairs, every player with a phone, so a result moves real ratings. */
  const teams = ["Aces", "Blasts", "Chops"].map((n) => `${n} ${stamp}`);
  for (const n of teams) {
    await p.fill('input[placeholder="New team name"]', n);
    await p.click('button:has-text("Add team")');
    await p.waitForTimeout(600);
  }
  for (const [i, n] of teams.entries()) {
    for (const k of [0, 1]) {
      const form = p.locator(`[data-team="${n}"] form:has(input[placeholder="Player name"])`);
      await form.locator('input[placeholder="Player name"]').fill(`${n} P${k}`);
      await form.locator('input[name="phone"]').fill(`08${i}${k}${stamp}`);
      await form.locator('button:has-text("Add")').click();
      await p.waitForTimeout(700);
    }
  }
  await manage(slug);
  await p.fill('input[name="groups"]', "1");
  await p.click('button:has-text("Draw groups")');
  await p.waitForTimeout(2000);
  await manage(slug);
  const ids = await p.$$eval("li[data-match]", (lis) => lis.map((li) => li.getAttribute("data-match")));
  ok(ids.length === 3, `one group of three: three fixtures (${ids.length})`);
  const [first, second] = ids;

  console.log("\n== a finished match is cleared, and its ratings go back ==");
  await p.goto(`${BASE}/t/${slug}/score/${first}`);
  await p.waitForTimeout(1200);
  const [teamA] = await teamsOf(p);
  for (let i = 0; i < 11; i++) {
    await tap(p, teamA);
    await p.waitForTimeout(350);
  }
  ok((await stableRallyCount(p)) === 11, "the match was played to 11–0");
  await p.waitForTimeout(1500);
  const played = await movement(slug);
  const moved = played.filter((x) => x.played === 1 && x.change !== 0);
  ok(moved.length === 4, `four players' ratings moved (${JSON.stringify(played)})`);

  await manage(slug);
  ok(await row(first).locator('[data-row-action="clear"]').count() === 1, "the finished match offers Clear result…");
  ok(await row(first).locator('button:has-text("Yes, clear the result")').count() === 0, "the confirming button is not there before the first tap");
  await row(first).locator('[data-row-action="clear"]').click();
  await p.waitForTimeout(300);
  const question = await said(row(first).locator('[data-row-action-open="clear"]'));
  ok(question.includes("will be taken back") && question.includes("4 players"),
    `and says what it takes back: "${question.slice(0, 140)}"`);
  ok((await movement(slug)).filter((x) => x.change !== 0).length === 4, "the first tap changed nothing");

  await manage(slug);
  await row(first).locator('[data-row-action="clear"]').click();
  await p.waitForTimeout(300);
  await row(first).locator('button:has-text("Yes, clear the result")').click();
  await p.waitForTimeout(2500);
  ok(await p.locator('[data-done="cleared"]').count() === 1, "the page says it was done");
  ok(!p.url().includes("done="), "once: the code is taken off the address");
  await manage(slug);
  ok(await row(first).locator('[data-row-action="delete"]').count() === 1, "the cleared match is unplayed again, so it may be deleted");
  const after = await movement(slug);
  ok(after.length > 0 && after.every((x) => x.change === 0 && x.played === 0),
    `nobody's rating moved at this event any more (${JSON.stringify(after)})`);

  console.log("\n== a referee's phone holding rallies when the match is reset ==");
  const phoneCtx = await b.newContext({ viewport: { width: 390, height: 844 } });
  const ph = await phoneCtx.newPage();
  const phoneErrs = watchErrors(ph);
  const scoreUrl = `${BASE}/t/${slug}/score/${second}`;
  await ph.goto(scoreUrl);
  await ph.waitForTimeout(1000);
  await clearQueue(ph);
  await ph.reload();
  await ph.waitForTimeout(1500);
  const [a2] = await teamsOf(ph);
  await tap(ph, a2);
  await ph.waitForTimeout(500);
  await tap(ph, a2);
  ok((await stableRallyCount(ph)) === 2, "two rallies saved while the signal was good");

  await phoneCtx.setOffline(true);
  for (let i = 0; i < 3; i++) {
    await tap(ph, a2);
    await ph.waitForTimeout(400);
  }

  await manage(slug);
  ok(await row(second).locator('[data-row-action="reset"]').count() === 1, "the match being played offers Reset to 0–0…");
  await row(second).locator('[data-row-action="reset"]').click();
  await p.waitForTimeout(300);
  const resetQ = await said(row(second).locator('[data-row-action-open="reset"]'));
  ok(resetQ.includes("2 rallies") && resetQ.includes("phone is told"), `and says what it removes: "${resetQ.slice(0, 160)}"`);
  await row(second).locator('button:has-text("Yes, reset to 0–0")').click();
  await p.waitForTimeout(2500);
  ok(await p.locator('[data-done="cleared"]').count() === 1, "the reset went through");

  await phoneCtx.setOffline(false);
  const card = ph.locator('[data-testid="reset-notice"]');
  ok(await until(async () => (await card.count()) === 1, { label: "the reset card" }), "the phone is told the match was reset");
  const cardText = await said(card);
  ok(cardText.includes("The organiser reset this match") && cardText.includes("3 rallies were not kept"),
    `in words: "${cardText}"`);
  await card.locator('button:has-text("Start from 0–0")').click();
  await ph.waitForTimeout(1500);
  ok(JSON.stringify(await scores(ph)) === "[0,0]", "the court starts again at 0–0");
  await tap(ph, a2);
  await ph.waitForTimeout(1500);
  await ph.reload();
  await ph.waitForTimeout(1500);
  ok((await stableRallyCount(ph)) === 1, "the rally scored after the reset landed, and none from before it");
  ok(await ph.locator('[data-testid="reset-notice"]').count() === 0, "and the card does not come back");

  console.log("\n== the same, found by a reload once the signal is back ==");
  /* The network is cut by refusing every request, so the phone believes it is
     online and fires no "online" event when it returns — the reload is what
     finds the rallies. */
  await killNetwork(ph);
  for (let i = 0; i < 2; i++) {
    await tap(ph, a2);
    await ph.waitForTimeout(400);
  }
  await manage(slug);
  await row(second).locator('[data-row-action="reset"]').click();
  await p.waitForTimeout(300);
  await row(second).locator('button:has-text("Yes, reset to 0–0")').click();
  await p.waitForTimeout(2500);
  await restoreNetwork(ph);
  await ph.reload();
  const again = ph.locator('[data-testid="reset-notice"]');
  ok(await until(async () => (await again.count()) === 1, { label: "the reset card after a reload" }), "the reloaded phone says so");
  ok((await said(again)).includes("2 rallies were not kept"), `in words: "${await said(again)}"`);
  await again.locator('button:has-text("Start from 0–0")').click();
  await ph.waitForTimeout(1500);
  await tap(ph, a2);
  await ph.waitForTimeout(1500);
  await ph.reload();
  await ph.waitForTimeout(1500);
  ok((await stableRallyCount(ph)) === 1, "the rally after it landed, from 0–0");

  console.log("\n== a phone on a Final whose side a clear has emptied ==");
  /* The Final's page shows "waiting for the teams" once a clear empties a side
     the result had filled — no court, so the console's own drop never runs
     there. The small part of the page that does (ResetDrop) lets the phone's
     points go and says so. */
  const ko = await createTournament(p, `Final ${stamp}`, { sport: "Pickleball", format: "Standard" });
  for (const n of [`Kites ${stamp}`, `Larks ${stamp}`]) {
    await p.fill('input[placeholder="New team name"]', n);
    await p.click('button:has-text("Add team")');
    await p.waitForTimeout(600);
  }
  await manage(ko);
  await p.click('button:has-text("Draw groups")');
  await p.waitForTimeout(2000);
  await manage(ko);
  await p.locator('form:has(input[name="qualify"])').first().locator('input[name="qualify"]').fill("2");
  await p.locator('form:has(input[name="qualify"])').first().locator('input[name="qualify"]').press('Enter');
  await p.waitForTimeout(2000);
  await manage(ko);
  const fixture = await p.$eval('li[data-round^="Group"]', (li) => li.getAttribute("data-match"));
  const finalId = await p.$eval('li[data-round="Final"]', (li) => li.getAttribute("data-match"));
  ok(!!fixture && !!finalId, "one group of two, and a Final fed by it");
  await p.goto(`${BASE}/t/${ko}/score/${fixture}`);
  await p.waitForTimeout(1200);
  const [k1] = await teamsOf(p);
  for (let i = 0; i < 11; i++) {
    await tap(p, k1);
    await p.waitForTimeout(350);
  }
  ok((await stableRallyCount(p)) === 11, "the group match was played out");
  await manage(ko);
  await p.click('button:has-text("Fill resolved slots")');
  await p.waitForTimeout(2000);

  const finalUrl = `${BASE}/t/${ko}/score/${finalId}`;
  await ph.goto(finalUrl);
  await ph.waitForTimeout(1500);
  const finalTeams = await teamsOf(ph);
  ok(finalTeams.length === 2, "the Final has its two teams and a court");
  await phoneCtx.setOffline(true);
  await tap(ph, finalTeams[0]);
  await ph.waitForTimeout(400);
  await tap(ph, finalTeams[0]);
  await ph.waitForTimeout(400);

  await manage(ko);
  await row(fixture).locator('[data-row-action="clear"]').click();
  await p.waitForTimeout(300);
  const emptiedQ = await said(row(fixture).locator('[data-row-action-open="clear"]'));
  ok(emptiedQ.includes("Final will wait for this match’s result again"), `the clear says what it empties: "${emptiedQ.slice(0, 160)}"`);
  await row(fixture).locator('button:has-text("Yes, clear the result")').click();
  await p.waitForTimeout(2500);

  /* Off the Final's page before the signal returns: its own send would be
     answered "teams not known" and let the points go first, and this is about
     the page that has no court. */
  await ph.goto("about:blank");
  await phoneCtx.setOffline(false);
  await ph.goto(finalUrl);
  const waitingCard = ph.locator('[data-testid="reset-notice"]');
  ok(await until(async () => (await waitingCard.count()) === 1, { label: "the card on the waiting page" }),
    "the waiting page says the phone's points went");
  ok((await said(waitingCard)).includes("2 rallies were not kept"), `in words: "${await said(waitingCard)}"`);
  ok(await ph.locator("button[aria-label^='Point to']").count() === 0, "and there is no court to tap");
  const leftOnPhone = await ph.evaluate(() => new Promise((res) => {
    const r = indexedDB.open("rise-offline");
    r.onsuccess = () => {
      const q = r.result.transaction("queued-matches", "readonly").objectStore("queued-matches").getAll();
      q.onsuccess = () => res(q.result.filter((x) => x.log.length > 0).length);
      q.onerror = () => res(-1);
    };
    r.onerror = () => res(-1);
  }));
  ok(leftOnPhone === 0, `nothing is left queued on the phone (${leftOnPhone})`);

  console.log("\n== errors ==");
  const bad = [...realErrors(errs), ...realErrors(phoneErrs)];
  ok(bad.length === 0, `no runtime errors: ${JSON.stringify(bad.slice(0, 3))}`);
  await phoneCtx.close();
} finally {
  await b.close();
}

ok.done("clear");
