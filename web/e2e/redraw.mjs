/* Redrawing a category — never at the cost of a result — in a real browser.
 *
 * "Draw groups & fixtures" used to delete every match in the category's groups,
 * played ones included, the moment it was pressed a second time. Now:
 *   - the first draw is one tap;
 *   - a redraw that replaces fixtures asks twice, says what goes, and comes back
 *     closed afterwards (it used to stay one tap from the next redraw);
 *   - pressing Enter in a draw form cannot skip the second tap — the server
 *     refuses a redraw that was not confirmed, and says so once;
 *   - once one point is scored, the button is replaced by the reason, and the
 *     scored match is still there.
 * DIFFERENTIAL like the other suites: the same button that is refused after a
 * point is shown to work before it.
 *
 * Run against a production build on a FRESH database — see e2e/README.md. */

import { launch, BASE, makeOk, watchErrors, realErrors, createTournament, firstScorableMatch, tap, stableRallyCount } from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1100 } });
const errs = watchErrors(p);
const stamp = String(process.hrtime.bigint()).slice(-6);

const manage = async (slug) => {
  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
};
const scoreLinks = () =>
  p.$$eval("a[href*='/score/']", (as) =>
    [...new Set(as.map((a) => a.getAttribute("href")).filter((h) => /\/score\/[0-9a-f-]{36}$/.test(h)))].sort());
const groupsForm = () => p.locator('form:has(input[name="groups"])').first();
const koForm = () => p.locator('form:has(input[name="qualify"])').first();
const knockoutRounds = () =>
  p.$$eval("li", (lis) => lis.map((li) => li.textContent || "").filter((t) => /Semi-Final|Final/.test(t)).length);

try {
  const slug = await createTournament(p, `Redraw ${stamp}`, { sport: "Pickleball", format: "Standard" });
  ok(!!slug, `created the event: ${slug}`);

  for (const n of ["Aces", "Blasts", "Chops", "Dinks"]) {
    await p.fill('input[placeholder="New team name"]', `${n} ${stamp}`);
    await p.click('button:has-text("Add team")');
    await p.waitForTimeout(500);
  }

  console.log("\n== the first draw is one tap ==");
  await manage(slug);
  ok(await groupsForm().locator("[data-draw-confirm]").count() === 0, "nothing to replace yet, so no confirmation");
  await groupsForm().locator('button:has-text("Draw groups & fixtures")').click();
  await p.waitForTimeout(2000);
  await manage(slug);
  const first = await scoreLinks();
  ok(first.length === 2, `two groups of two, one fixture each (${first.length})`);

  console.log("\n== a redraw asks twice, and closes again after ==");
  const opener = groupsForm().locator("[data-draw-confirm]");
  ok(await opener.count() === 1, "the redraw is behind a second tap");
  await opener.click();
  await p.waitForTimeout(300);
  const open = groupsForm().locator("[data-draw-confirm-open]");
  const said = ((await open.textContent()) ?? "").replace(/\s+/g, " ").trim();
  ok(/Replaces .*2 matches/.test(said) && said.includes("Nothing in it has a recorded result"),
    `and says what it replaces: "${said.slice(0, 120)}"`);
  await open.locator('button:has-text("Yes, redraw")').click();
  await p.waitForTimeout(2500);
  const second = await scoreLinks();
  ok(second.length === 2 && second.every((h) => !first.includes(h)), "the fixtures were replaced");
  ok(await groupsForm().locator("[data-draw-confirm-open]").count() === 0
    && await groupsForm().locator("[data-draw-confirm]").count() === 1,
    "and the next redraw is two taps again, not one");

  console.log("\n== Enter cannot skip the second tap ==");
  /* The knockout form has a single field, so Enter submits it. The first draw
     needs no confirmation; the second one does, and Enter does not give it. */
  await koForm().locator('input[name="qualify"]').fill("2");
  await koForm().locator('input[name="qualify"]').press("Enter");
  await p.waitForTimeout(2500);
  await manage(slug);
  const koBefore = await knockoutRounds();
  ok(koBefore >= 3, `the first knockout draw went through on Enter (${koBefore} rows)`);
  await koForm().locator('input[name="qualify"]').fill("1");
  await koForm().locator('input[name="qualify"]').press("Enter");
  await p.waitForTimeout(2500);
  const notice = p.locator("[data-problem]");
  ok(await notice.count() === 1 && ((await notice.textContent()) ?? "").includes("Yes, redraw"),
    "Enter without the second tap is refused, and the page says why");
  ok(!p.url().includes("problem="), "the reason is said once: it is taken off the address");
  await manage(slug);
  ok(await knockoutRounds() === koBefore, "and the knockout is unchanged");
  ok(await p.locator("[data-problem]").count() === 0, "the reason does not come back on the next visit");

  console.log("\n== one point locks the draw ==");
  const matchId = await firstScorableMatch(p, slug);
  ok(!!matchId, "found a match to score");
  const [teamA] = await p.$$eval("button[aria-label^='Point to']", (els) =>
    els.map((e) => e.getAttribute("aria-label").replace("Point to ", "")));
  await tap(p, teamA);
  ok((await stableRallyCount(p)) === 1, "one rally recorded");
  await p.waitForTimeout(2000);

  await manage(slug);
  const locked = groupsForm().locator("[data-draw-locked]");
  ok(await locked.count() === 1, "the draw button is replaced by the reason");
  ok(((await locked.textContent()) ?? "").includes("a match here has a result"), "which names what is in the way");
  ok(await groupsForm().locator("[data-draw-confirm]").count() === 0, "and there is no way to redraw the groups from here");
  ok((await scoreLinks()).includes(`/t/${slug}/score/${matchId}`), "the scored match is still there");

  console.log("\n== errors ==");
  const bad = realErrors(errs);
  ok(bad.length === 0, `no runtime errors: ${JSON.stringify(bad.slice(0, 3))}`);
} finally {
  await b.close();
}

ok.done("redraw");
