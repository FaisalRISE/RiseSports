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
 * Removing a category is held to the same rules, on the registration page:
 *   - the category with the scored match cannot be removed, and says why;
 *   - an empty category goes with one tap;
 *   - one with teams asks twice, and the second tap goes through;
 *   - a page opened before a team was added is refused, and says so — the
 *     second tap carries a fingerprint of what that page saw.
 * DIFFERENTIAL like the other suites: the same button that is refused after a
 * point is shown to work before it, and the stale page's refusal is followed
 * by the same removal working from an up-to-date page.
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
  ok(((await locked.textContent()) ?? "").includes("a match here has been played or started"), "which names what is in the way");
  ok(await groupsForm().locator("[data-draw-confirm]").count() === 0, "and there is no way to redraw the groups from here");
  ok((await scoreLinks()).includes(`/t/${slug}/score/${matchId}`), "the scored match is still there");

  console.log("\n== removing a category ==");
  const registration = async (page = p) => {
    await page.goto(`${BASE}/t/${slug}/manage/registration`);
    await page.waitForTimeout(1200);
  };
  const row = (name, page = p) => page.locator("li", { hasText: name });
  const addCategory = async (name) => {
    await p.fill('input[placeholder="Advanced"]', name);
    await p.locator('form:has(input[placeholder="Advanced"]) button:has-text("Add")').click();
    await p.waitForTimeout(1500);
    await registration();
  };
  const addTeamTo = async (team, category) => {
    await manage(slug);
    await p.fill('input[placeholder="New team name"]', team);
    await p.locator('form:has(input[placeholder="New team name"]) select[name="divisionId"]').selectOption({ label: category });
    await p.click('button:has-text("Add team")');
    await p.waitForTimeout(1500);
  };

  await registration();
  const played = p.locator("li:has([data-category-locked])");
  ok(await played.count() === 1, "the category with the scored match cannot be removed");
  ok(((await played.textContent()) ?? "").includes("been played or started"), "and says why");
  ok(await played.locator("button").count() === 0, "with no button the server would refuse");

  const spare = `Spare ${stamp}`;
  await addCategory(spare);
  ok(await row(spare).count() === 1, "added an empty category");
  ok(await row(spare).locator("[data-remove-category]").count() === 0, "an empty category does not ask twice");
  await row(spare).locator("button").click();
  await p.waitForTimeout(2000);
  await registration();
  ok(await row(spare).count() === 0, "and goes with one tap");

  const busy = `Second ${stamp}`;
  await addCategory(busy);
  await addTeamTo(`Echo ${stamp}`, busy);
  await registration();
  ok(await row(busy).locator("[data-remove-category]").count() === 1, "a category with a team asks twice");
  ok(await row(busy).locator('button:has-text("Yes, remove")').count() === 0, "the confirming button is not there before the first tap");

  /* A page opened now, then a team added from another: its second tap
     carries the fingerprint of ONE team, and the server finds two. */
  const stale = await b.newPage({ viewport: { width: 1100, height: 1100 } });
  await registration(stale);
  await addTeamTo(`Foxtrot ${stamp}`, busy);
  await row(busy, stale).locator("[data-remove-category]").click();
  await stale.waitForTimeout(300);
  ok(((await row(busy, stale).textContent()) ?? "").includes("Removes 1 team"), "the old page still says one team");
  await row(busy, stale).locator('button:has-text("Yes, remove")').click();
  await stale.waitForTimeout(2500);
  const staleNotice = stale.locator("[data-problem]");
  ok(await staleNotice.count() === 1 && ((await staleNotice.textContent()) ?? "").includes("changed since this page was opened"),
    "the old page's removal is refused, and says why");
  await stale.close();
  await registration();
  ok(await row(busy).count() === 1, "and the category is still there");

  await row(busy).locator("[data-remove-category]").click();
  await p.waitForTimeout(300);
  const asked = ((await row(busy).locator("[data-remove-category-open]").textContent()) ?? "").replace(/\s+/g, " ");
  ok(asked.includes("Removes 2 teams"), `the up-to-date page says what goes: "${asked.slice(0, 100)}"`);
  await row(busy).locator('button:has-text("Yes, remove")').click();
  await p.waitForTimeout(2500);
  await registration();
  ok(await row(busy).count() === 0, "and the second tap removes it");
  ok(await p.locator("[data-problem]").count() === 0, "with nothing to complain about");
  await manage(slug);
  const teamsLeft = (await p.textContent("body")) ?? "";
  ok(!teamsLeft.includes(`Echo ${stamp}`) && !teamsLeft.includes(`Foxtrot ${stamp}`), "its teams went with it");
  ok((await scoreLinks()).includes(`/t/${slug}/score/${matchId}`), "and the scored match in the other category is untouched");

  console.log("\n== errors ==");
  const bad = realErrors(errs);
  ok(bad.length === 0, `no runtime errors: ${JSON.stringify(bad.slice(0, 3))}`);
} finally {
  await b.close();
}

ok.done("redraw");
