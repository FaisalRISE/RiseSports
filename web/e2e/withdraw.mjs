/* A pair pulls out, in a real browser (step 8b).
 *
 * Before step 8b there was no way to record a walkover — a match could only be
 * deleted, which left both pairs a match short in the table — and a pair that
 * pulled out could only be dealt with by deleting their matches one at a time,
 * which a played match could not be. Now:
 *   - a match nobody has played offers "Walkover…", and the second tap is one
 *     button per side; it counts as 11–0 "w/o" and moves nobody's rating;
 *   - a team card offers "Remove the pair…", which says what goes — their
 *     matches, how many with results, how many players' ratings — and the
 *     second tap removes them: played matches too, ratings put back, the pair
 *     marked Withdrawn and left out of the lists a match is added from;
 *   - a group of two whose other pair was removed is won by the pair left, and
 *     the event page says why; "Fill resolved slots" then puts them in the Final;
 *   - a pair already in a knockout match cannot be removed, and the card says
 *     to give the walkover there.
 *
 * Run against a production build on a FRESH database — see e2e/README.md. */

import { launch, BASE, makeOk, watchErrors, realErrors, createTournament, tap, teamsOf, stableRallyCount } from "./harness.mjs";

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
const card = (name) => p.locator(`[data-team="${name}"]`);
const said = async (loc) => ((await loc.textContent()) ?? "").replace(/\s+/g, " ").trim();
const movement = async (slug) => {
  await p.goto(`${BASE}/t/${slug}/ratings`);
  await p.waitForTimeout(1200);
  return p.$$eval("tr[data-player]", (trs) =>
    trs.map((t) => ({ name: t.dataset.player, change: Number(t.dataset.change), played: Number(t.dataset.played) })));
};

try {
  const slug = await createTournament(p, `Withdraw ${stamp}`, { sport: "Pickleball", format: "Standard" });
  ok(!!slug, `created the event: ${slug}`);

  const [aces, bees, chops, dinks] = ["Aces", "Bees", "Chops", "Dinks"].map((n) => `${n} ${stamp}`);
  for (const n of [aces, bees, chops, dinks]) {
    await p.fill('input[placeholder="New team name"]', n);
    await p.click('button:has-text("Add team")');
    await p.waitForTimeout(600);
  }
  for (const [i, n] of [aces, bees, chops, dinks].entries()) {
    for (const k of [0, 1]) {
      const form = p.locator(`[data-team="${n}"] form:has(input[placeholder="Player name"])`);
      await form.locator('input[placeholder="Player name"]').fill(`${n} P${k}`);
      await form.locator('input[name="phone"]').fill(`07${i}${k}${stamp}`);
      await form.locator('button:has-text("Add")').click();
      await p.waitForTimeout(700);
    }
  }
  /* Two groups of two, the winner of each into the Final. */
  await manage(slug);
  await p.fill('input[name="groups"]', "2");
  await p.click('button:has-text("Draw groups")');
  await p.waitForTimeout(2000);
  await manage(slug);
  await p.locator('input[name="qualify"]').first().fill("1");
  await p.locator('input[name="qualify"]').first().press("Enter");
  await p.waitForTimeout(2000);
  await manage(slug);
  const groupRows = await p.$$eval('li[data-round^="Group"]', (lis) =>
    lis.map((li) => ({ id: li.getAttribute("data-match"), round: li.getAttribute("data-round"), text: li.textContent })));
  const finalId = await p.$eval('li[data-round="Final"]', (li) => li.getAttribute("data-match"));
  ok(groupRows.length === 2 && !!finalId, `two group matches and a Final (${groupRows.length})`);
  const gA = groupRows.find((r) => r.round.startsWith("Group A"));
  const gB = groupRows.find((r) => r.round.startsWith("Group B"));

  console.log("\n== a walkover ==");
  ok(await row(gA.id).locator('[data-row-action="walkover"]').count() === 1, "an unplayed match offers Walkover…");
  ok(await row(gA.id).locator("button[data-choice]").count() === 0, "the two choices are not there before the first tap");
  await row(gA.id).locator('[data-row-action="walkover"]').click();
  await p.waitForTimeout(300);
  const q = await said(row(gA.id).locator('[data-row-action-open="walkover"]'));
  ok(q.includes("counts as 11–0 in the Group A table") && q.includes("nobody’s rating changes"), `it says what it counts as: "${q.slice(0, 140)}"`);
  const choices = await row(gA.id).locator("button[data-choice]").allTextContents();
  ok(choices.length === 2 && choices.every((c) => c.startsWith("Walkover to ")), `one button per side: ${JSON.stringify(choices)}`);
  const winnerName = choices[1].replace("Walkover to ", "");
  await row(gA.id).locator('button[data-choice="b"]').click();
  await p.waitForTimeout(2500);
  const done = p.locator('[data-done="walkover"]');
  ok(await done.count() === 1, "the page says it was done");
  ok((await said(done)).includes(`Walkover to ${winnerName}, 11–0. Nobody’s rating changed.`), `in words: "${await said(done)}"`);
  await manage(slug);
  ok((await said(row(gA.id))).includes("w/o"), "the row shows a walkover");
  ok(await row(gA.id).locator('[data-row-action="clear"]').count() === 1, "and offers Clear result…, the same as any result");
  ok((await movement(slug)).every((x) => x.change === 0), "nobody's rating moved");

  console.log("\n== removing a pair whose match was played ==");
  await p.goto(`${BASE}/t/${slug}/score/${gB.id}`);
  await p.waitForTimeout(1200);
  const [bWinner, bLoser] = await teamsOf(p);
  for (let i = 0; i < 11; i++) {
    await tap(p, bWinner);
    await p.waitForTimeout(350);
  }
  ok((await stableRallyCount(p)) === 11, "Group B was played to 11–0");
  await p.waitForTimeout(1500);
  ok((await movement(slug)).filter((x) => x.change !== 0).length === 4, "four players' ratings moved");

  await manage(slug);
  const leaving = card(bLoser);
  ok(await leaving.locator('[data-row-action="withdraw"]').count() === 1, "the card offers Remove the pair…");
  await leaving.locator('[data-row-action="withdraw"]').click();
  await p.waitForTimeout(300);
  const rq = await said(leaving.locator('[data-row-action-open="withdraw"]'));
  ok(rq.includes(`Remove ${bLoser}?`), `it asks about this pair: "${rq.slice(0, 60)}"`);
  ok(rq.includes("This removes their 1 match in Group B — 1 with a result — and takes back the rating changes those matches gave 4 players."),
    `and says what goes: "${rq.slice(0, 220)}"`);
  ok(rq.includes(`That leaves one pair in Group B, and the group goes to ${bWinner}.`), "and who the group goes to");
  ok(rq.includes("This can’t be undone."), "and that it is for good");
  ok((await movement(slug)).filter((x) => x.change !== 0).length === 4, "the first tap changed nothing");
  await manage(slug);
  await card(bLoser).locator('[data-row-action="withdraw"]').click();
  await p.waitForTimeout(300);
  await card(bLoser).locator(`button:has-text("Yes, remove ${bLoser}")`).click();
  await p.waitForTimeout(2500);
  ok(await p.locator('[data-done="withdrawn"]').count() === 1, "the page says it was done");
  await manage(slug);
  ok(await card(bLoser).getAttribute("data-withdrawn") !== null, "the pair stays on the list, marked Withdrawn");
  ok((await said(card(bLoser))).includes("Withdrawn"), "in words");
  ok(await row(gB.id).count() === 0, "their match is gone");
  ok(!(await p.locator('select[name="teamA"] option').allTextContents()).includes(bLoser), "and they cannot be given a new one");
  ok((await movement(slug)).every((x) => x.change === 0), "every rating that match moved went back");

  /* A referee still holding the deleted match's page reloads into words, not
     a bare 404 with no way back. */
  await p.goto(`${BASE}/t/${slug}/score/${gB.id}`);
  await p.waitForTimeout(1200);
  const gone = await said(p.locator("[data-testid=\"match-not-found\"]"));
  ok(gone.includes("This match is not here") && gone.includes("Back to the event"), `the deleted match's page says so: "${gone.slice(0, 120)}"`);

  console.log("\n== the pair left wins the group, and goes through ==");
  await p.goto(`${BASE}/t/${slug}`);
  await p.waitForTimeout(1200);
  const note = (await p.locator("[data-group-note]").allTextContents()).join(" ");
  ok(note.includes(`${bLoser} withdrew, so the pair left, ${bWinner}, wins Group B.`), `the event page says why: "${note}"`);
  await manage(slug);
  await p.click('button:has-text("Fill resolved slots")');
  await p.waitForTimeout(2000);
  await manage(slug);
  const finalText = await said(row(finalId));
  ok(finalText.includes(bWinner) && finalText.includes(winnerName), `the Final is ${winnerName} v ${bWinner}: "${finalText.slice(0, 120)}"`);

  console.log("\n== a pair in the Final cannot be removed ==");
  const finalist = card(bWinner);
  ok(await finalist.locator('[data-row-action="withdraw"]').count() === 0, "no Remove button on a finalist's card");
  const why = await said(finalist.locator("[data-row-locked]"));
  ok(why.includes("Can’t remove — this pair is in Final. If they pull out, give the walkover there."), `the card says why: "${why}"`);
  ok(await row(finalId).locator('[data-row-action="walkover"]').count() === 1, "and the Final offers the walkover it points to");

  console.log("\n== errors ==");
  const bad = realErrors(errs);
  ok(bad.length === 0, `no runtime errors: ${JSON.stringify(bad.slice(0, 3))}`);
} finally {
  await b.close();
}

ok.done("withdraw");
