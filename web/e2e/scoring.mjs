/* Step 7 in a real browser: changing an event's scoring once matches have
 * been played, and the matches the referee's court cannot finish.
 *
 *   - An 11–0 played to 11 is still FINAL after the event moves to 15, and the
 *     save says so, and names the match being played that follows the new
 *     rules. DIFFERENTIAL: before step 7 the same match read as live again —
 *     not over at 15 — and dropped out of the table.
 *   - Carrom can be set to a number of boards; the save says so, and that
 *     event's match page offers no court (it counts points, not boards).
 *   - A tennis match page offers no court either, and points to the manage
 *     screen where tennis results are typed.
 *
 * Run against a production build on a FRESH database — see e2e/README.md. */

import { launch, BASE, makeOk, watchErrors, realErrors, tap, stableRallyCount } from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1100 } });
const errs = watchErrors(p);
const stamp = String(process.hrtime.bigint()).slice(-6);

/* The wizard's sport cards, by EXACT name: "Tennis" is also inside
   "Table Tennis", which comes first. */
async function create(name, sport) {
  await p.goto(`${BASE}/new`);
  await p.waitForTimeout(600);
  await p.getByRole("button", { name: sport, exact: true }).click();
  await p.waitForTimeout(400);
  await p.locator('button:has-text("Standard")').first().click();
  await p.waitForTimeout(400);
  await p.fill('input[name="name"]', name);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/manage/, { timeout: 20000 });
  await p.waitForTimeout(600);
  return new URL(p.url()).pathname.split("/")[2];
}

async function teamsAndMatches(slug, names, matches) {
  for (const n of names) {
    await p.fill('input[placeholder="New team name"]', n);
    await p.click('button:has-text("Add team")');
    await p.waitForTimeout(500);
  }
  for (const [round, a, bb] of matches) {
    await p.goto(`${BASE}/t/${slug}/manage`);
    await p.waitForTimeout(800);
    const form = p.locator('form:has(select[name="teamA"])');
    await form.locator('input[name="round"]').fill(round);
    await form.locator('select[name="teamA"]').selectOption({ label: a });
    await form.locator('select[name="teamB"]').selectOption({ label: bb });
    await form.locator('button:has-text("Add match")').click();
    await p.waitForTimeout(1000);
  }
}

const manage = async (slug) => {
  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
};
const matchLink = (round) =>
  p.locator(`li:has-text("${round}") a[href*='/score/']`).first().getAttribute("href");
const lineOf = async (round) =>
  ((await p.locator(`li:has-text("${round}")`).first().textContent()) ?? "").replace(/\s+/g, " ").trim();
const scoringCard = () => p.locator("form:has(button:has-text('Save scoring'))");
const said = async () =>
  ((await p.locator("[data-testid='scoring-saved']").textContent()) ?? "").replace(/\s+/g, " ").trim();

try {
  console.log("\n== a finished match keeps its result when the scoring changes ==");
  const pb = await create(`Rules ${stamp}`, "Pickleball");
  const [aces, bees] = [`Aces ${stamp}`, `Bees ${stamp}`];
  await teamsAndMatches(pb, [aces, bees], [["Round 1", aces, bees], ["Round 2", aces, bees]]);

  await manage(pb);
  /* Round 1 played out to 11–0 (A serves first and holds), Round 2 half way. */
  for (const [round, taps] of [["Round 1", 11], ["Round 2", 5]]) {
    await manage(pb);
    await p.goto(`${BASE}${await matchLink(round)}`);
    await p.waitForTimeout(1200);
    for (let i = 0; i < taps; i++) {
      await tap(p, aces);
      await p.waitForTimeout(250);
    }
    const n = await stableRallyCount(p);
    ok(n === taps, `${round}: ${taps} rallies recorded (${n})`);
  }

  await manage(pb);
  ok((await lineOf("Round 1")).includes("11–0"), `Round 1 is 11–0 before the change: "${(await lineOf("Round 1")).slice(0, 60)}"`);
  await scoringCard().locator('input[name="target"]').fill("15");
  await scoringCard().locator('button:has-text("Save scoring")').click();
  await p.waitForTimeout(2500);
  const saved = await said();
  ok(saved.includes("Saved. This event now plays to 15."), `the save says what it did: "${saved.slice(0, 160)}"`);
  ok(saved.includes("1 finished match keeps its result."), "and that the finished match keeps its result");
  ok(saved.includes(`${aces} v ${bees} is being played now, 5–0. It plays on to 15.`), "and names the match being played");

  await manage(pb);
  const r1 = await lineOf("Round 1");
  ok(/11–0/.test(r1) && /final/i.test(r1) && !/live/i.test(r1), `Round 1 is still final at 11–0 (it read as live before step 7): "${r1.slice(0, 80)}"`);
  const r2 = await lineOf("Round 2");
  ok(/live/i.test(r2), `Round 2 is still live, now to 15: "${r2.slice(0, 80)}"`);

  console.log("\n== carrom: a set number of boards waits for result typing ==");
  const cr = await create(`Boards ${stamp}`, "Carrom");
  const [kings, queens] = [`Kings ${stamp}`, `Queens ${stamp}`];
  await teamsAndMatches(cr, [kings, queens], [["Board Match", kings, queens]]);
  await manage(cr);
  /* Held back until results can be typed in (RESULT_ENTRY_ON_SCREEN): chosen,
     it left every match of the event with no way to record a result. */
  ok(await p.locator("[data-testid='carrom-ending']").count() === 0, "the card does not offer a set number of boards yet");
  await scoringCard().locator('input[name="target"]').fill("29");
  await scoringCard().locator('button:has-text("Save scoring")').click();
  await p.waitForTimeout(2500);
  const crSaved = await said();
  ok(crSaved.includes("Saved. This event now plays to 29."), `the save says to 29: "${crSaved.slice(0, 120)}"`);
  /* The public poster says how the event is played. A new event is a draft,
     and a draft's poster is not public — open entries first. */
  await p.goto(`${BASE}/t/${cr}/manage/registration`);
  await p.waitForTimeout(1000);
  await p.click('button:has-text("Open entries")');
  await p.waitForTimeout(1800);
  await p.goto(`${BASE}/e/${cr}`);
  await p.waitForTimeout(1000);
  const poster = ((await p.textContent("body")) ?? "").replace(/\s+/g, " ");
  ok(poster.includes("To 29") && !poster.includes("To 25"), "the event's poster says To 29");

  /* Back to the defaults: the card must show what is now stored, without a
     reload. It used to keep the old choice on screen under "now plays to 25". */
  await manage(cr);
  await scoringCard().locator('button:has-text("Back to the sport")').click();
  await p.waitForTimeout(2500);
  const reset = await said();
  ok(reset.includes("Saved. This event now plays to 25."), `the reset says what it did: "${reset.slice(0, 80)}"`);
  ok(await scoringCard().locator('input[name="target"]').inputValue() === "25", "and the card now shows 25, without a reload");

  console.log("\n== tennis has no live court ==");
  const tn = await create(`Sets ${stamp}`, "Tennis");
  const [arjun, kiran] = [`Arjun ${stamp}`, `Kiran ${stamp}`];
  await teamsAndMatches(tn, [arjun, kiran], [["Semi-Final 1", arjun, kiran]]);
  await manage(tn);
  await p.goto(`${BASE}${await matchLink("Semi-Final 1")}`);
  await p.waitForTimeout(1200);
  const tnNote = ((await p.locator("[data-testid='no-live-court']").textContent()) ?? "").replace(/\s+/g, " ");
  ok(tnNote.includes("No live court for tennis") && tnNote.includes("6–4 3–6 10–8"), `the page says how tennis is recorded: "${tnNote.slice(0, 120)}"`);
  ok(tnNote.includes("Typing a result in is not on the manage screen yet"), "and does not promise a control that is not there yet");
  ok(await p.locator("[data-testid='no-live-court'] a:has-text('Back to the event')").count() === 1, "and leads back to the event");

  const bad = realErrors(errs);
  ok(bad.length === 0, `no page errors${bad.length ? `: ${bad.slice(0, 3).join(" | ")}` : ""}`);
} catch (e) {
  ok(false, `crashed: ${e.message}`);
} finally {
  await b.close();
}
ok.done("scoring");
