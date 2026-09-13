/* Categories, and the shapes they can each be run in.
 *
 * Faisal, on what "customised tournaments" means: "every tournament is
 * different. some are team events, some have various categories." So one event
 * runs Men's Doubles as groups→knockout while Mixed runs a straight knockout,
 * and neither may touch the other's draw.
 *
 * The bug this guards is silent, which is why it needs a real browser and a
 * real database rather than a unit test alone: group keys and round names are
 * unique in a one-category event and stop being unique the moment there are
 * two. Every category has a Group A. Every category has a Semi-Final 1. Get the
 * scoping wrong and "A1" in Men's Doubles resolves to the MIXED group winner —
 * no error, no warning, just the wrong pair called onto court for a final.
 *
 * Run against a production build, same as the other suites. */

import { launch, makeOk, watchErrors, text, realErrors, createTournament } from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1000 } });
const errs = watchErrors(p);

const stamp = String(process.hrtime.bigint()).slice(-6);

/** Add a team, choosing a category when the picker is there to choose from. */
async function addTeam(name, categoryName) {
  await p.fill('input[placeholder="New team name"]', name);
  const picker = p.locator('form:has(input[placeholder="New team name"]) select[name="divisionId"]');
  if (await picker.count()) await picker.selectOption({ label: categoryName });
  await p.click('button:has-text("Add team")');
  await p.waitForTimeout(400);
}

/* The draw card for one category. The controls are identical across categories
   and differ only by a hidden division id, so the page carries a data-category
   hook rather than making this guess at a chain of utility classes. */
const card = (categoryName) => p.locator(`[data-category="${categoryName}"]`);

async function setShape(categoryName, label, { thirdPlace = false } = {}) {
  const c = card(categoryName);
  await c.locator('select[name="shape"]').selectOption({ label });
  const box = c.locator('input[name="thirdPlace"]');
  if ((await box.isChecked()) !== thirdPlace) await box.setChecked(thirdPlace);
  await c.locator('button:has-text("Save format")').click();
  await p.waitForTimeout(700);
}

/** Every round name currently on the manage page, in order. */
const rounds = async () =>
  p.$$eval("p.text-\\[10px\\]", (els) => els.map((e) => e.textContent.trim()));

try {
  console.log("\n== one event, two categories ==");

  const slug = await createTournament(p, `Two Cats ${stamp}`, { format: "Standard" });
  ok(!!slug, `created the event: ${slug}`);

  const body0 = await text(p);
  ok(body0.includes("One category"), "starts with a single implied category");
  ok(!body0.includes("Men's Doubles"), "and no second category yet");

  await p.fill('input[placeholder*="Add a category"]', "Men's Doubles");
  await p.click('button:has-text("Add category")');
  await p.waitForTimeout(800);

  const body1 = await text(p);
  ok(body1.includes("Men's Doubles"), "added a second category");
  ok(body1.includes("Main"), "the original category is still there");
  ok(
    body1.includes("Each category is drawn separately"),
    "the page now explains that categories are drawn separately",
  );

  console.log("\n== teams go to the category you choose ==");

  for (const n of ["Main A", "Main B", "Main C", "Main D"]) await addTeam(n, "Main");
  for (const n of ["MD A", "MD B"]) await addTeam(n, "Men's Doubles");

  const counts = await p.$$eval("[data-category]", (els) =>
    els.map((e) => ({
      name: e.getAttribute("data-category"),
      teams: e.textContent?.match(/(\d+)\s+teams?/)?.[1] ?? null,
    })),
  );
  const mainCount = counts.find((c) => c.name === "Main")?.teams;
  const mdCount = counts.find((c) => c.name === "Men's Doubles")?.teams;
  ok(mainCount === "4", `Main has 4 teams (got ${mainCount})`);
  ok(mdCount === "2", `Men's Doubles has 2 teams (got ${mdCount})`);

  console.log("\n== each category runs its own shape ==");

  await setShape("Men's Doubles", "Straight knockout");
  const afterShape = await text(p);
  ok(afterShape.includes("Draw the bracket"), "the knockout category offers a bracket draw");
  ok(afterShape.includes("Draw groups & fixtures"), "and the other still offers groups");

  /* Draw BOTH, groups first, then the bracket — the order that would let one
     wipe the other if the actions were not scoped. */
  await card("Main").locator('button:has-text("Draw groups & fixtures")').click();
  await p.waitForTimeout(1200);
  await card("Men's Doubles").locator('button:has-text("Draw the bracket")').click();
  await p.waitForTimeout(1200);

  const drawn = await rounds();
  const groupRounds = drawn.filter((r) => /^GROUP [A-Z]/i.test(r));
  ok(groupRounds.length > 0, `Main's group fixtures survived the second draw (${groupRounds.length})`);
  ok(drawn.some((r) => /FINAL/i.test(r)), "Men's Doubles has a final");

  console.log("\n== a bracket of two is one final, and nothing else ==");
  const mdFinals = drawn.filter((r) => /^FINAL/i.test(r));
  ok(mdFinals.length === 1, `exactly one final for a two-team bracket (${mdFinals.length})`);

  console.log("\n== league is one table, with no knockout offered ==");

  await setShape("Main", "League — everyone plays everyone");
  const leagueBody = await text(p);
  ok(leagueBody.includes("One table"), "the league category shows one table, not a group count");
  ok(leagueBody.includes("Draw league fixtures"), "and offers a league draw");

  const mainCard = await card("Main").textContent();
  ok(!mainCard.includes("Draw knockout"), "no knockout step is offered for a league");

  await card("Main").locator('button:has-text("Draw league fixtures")').click();
  await p.waitForTimeout(1400);

  const leagueRounds = await rounds();
  const groupKeys = new Set(
    leagueRounds.map((r) => r.match(/^GROUP ([A-Z])/i)?.[1]).filter(Boolean),
  );
  ok(groupKeys.size === 1, `a league drew exactly one table (groups: ${[...groupKeys].join(",") || "none"})`);

  console.log("\n== third place is offered, and costs one match ==");

  await setShape("Men's Doubles", "Straight knockout", { thirdPlace: true });
  const third = await text(p);
  ok(third.includes("Third-place playoff"), "the third-place option is on the page");

  console.log("\n== errors ==");
  const bad = realErrors(errs);
  ok(bad.length === 0, `no runtime errors: ${JSON.stringify(bad.slice(0, 3))}`);
} finally {
  await b.close();
}

ok.done("categories and shapes");
