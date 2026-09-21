/* Category rules — "who can enter" — driven end to end in a real browser.
 *
 * Faisal, 2026-09-17: each category gets limits (men, women or mixed; an age
 * range; a rating level; a DUPR range), and anyone who does not qualify is
 * turned away with the reason. He also chose: an organiser adding a player who
 * does not fit is stopped and may let them in anyway; an unrated player may
 * enter an "up to" category; changing the rules later removes nobody.
 *
 * DIFFERENTIAL, like the scheduler's and the skills suites: every refusal here
 * has an accepted twin in the same run. A check that refused everybody would
 * pass every refusal; one that refused nobody would pass every acceptance.
 * Only both together prove the rule is doing its job.
 *
 * Run against a production build: `npm run build`, then
 * `DATABASE_URL=pglite://.pgdata npm start -p 3111`, then `npm run e2e:eligibility`. */

import { launch, BASE, makeOk, watchErrors, text, realErrors, createTournament } from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const p = await b.newPage({ viewport: { width: 1000, height: 1400 } });
const errs = watchErrors(p);

/* Unique per run: phone is a UNIQUE key across the shared database. */
const stamp = String(process.hrtime.bigint()).slice(-6);
const phone = (n) => `8${stamp}${String(n).padStart(3, "0")}`;

const WD = "Womens Doubles";
const MX = "Mixed Pairs";
const VETS = "Vets";
const CAP = "Capped";

const card = (name) => p.locator(`[data-category="${name}"]`);

/* ── The manage screen ────────────────────────────────────────────────────*/

async function addCategory(name, preset) {
  const form = p.locator('form:has(select[name="preset"])');
  await form.locator('input[name="name"]').fill(name);
  await form.locator('select[name="preset"]').selectOption(preset);
  await form.locator('button:has-text("Add category")').click();
  await p.waitForTimeout(1200);
}

async function openRules(name) {
  await card(name).locator('button:has-text("change")').click();
  await p.waitForTimeout(500);
  return card(name).locator("[data-rules-form]");
}

async function saveRules(form) {
  await form.locator('button:has-text("Save")').click();
  await p.waitForTimeout(1800);
  return (await form.locator('[role="status"]').textContent().catch(() => "")) ?? "";
}

async function addTeam(name, categoryName) {
  const form = p.locator('form:has(input[placeholder="New team name"])');
  await form.locator('input[placeholder="New team name"]').fill(name);
  const picker = form.locator('select[name="divisionId"]');
  if (await picker.count()) await picker.selectOption({ label: categoryName });
  await form.locator('button:has-text("Add team")').click();
  await p.waitForTimeout(1000);
}

/* ── The public page ──────────────────────────────────────────────────────*/

async function enter(slug, categoryName, teamName, players, { tamper } = {}) {
  await p.goto(`${BASE}/e/${slug}`);
  await p.waitForTimeout(1200);
  await p.fill('input[name="teamName"]', teamName);

  /* The option text carries the category's tags after its name, so pick by
     what the label starts with. */
  const value = await p.$eval(
    'select[name="divisionId"]',
    (sel, n) => [...sel.options].find((o) => o.textContent.startsWith(n))?.value ?? "",
    categoryName,
  );
  await p.selectOption('select[name="divisionId"]', value);
  await p.waitForTimeout(400);

  for (let i = 0; i < players.length; i++) {
    const pl = players[i];
    await p.locator('input[name="playerName"]').nth(i).fill(pl.name);
    if (pl.gender) await p.locator('select[name="playerGender"]').nth(i).selectOption(pl.gender);
    if (pl.dob != null) await p.locator('input[name="playerDob"]').nth(i).fill(pl.dob);
    if (pl.dupr != null) await p.locator('input[name="playerDupr"]').nth(i).fill(pl.dupr);
    if (pl.phone != null) await p.locator('input[name="playerPhone"]').nth(i).fill(pl.phone);
  }
  /* A hostile or careless browser can remove `required`; the server must still
     refuse. */
  if (tamper) await p.$$eval(tamper, (els) => els.forEach((e) => e.removeAttribute("required")));
  await p.click('button[type="submit"]');
  await p.waitForTimeout(2500);
  return text(p);
}

const accepted = (t) => t.includes("Entry received");
const underPlayer = async (i) => text(p, `[data-player="${i}"]`);

try {
  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n== setting the rules ==");

  const slug = await createTournament(p, `Rules Cup ${stamp}`, { sport: "Pickleball", format: "Standard" });
  ok(!!slug, `created ${slug}`);

  await p.goto(`${BASE}/t/${slug}/manage/registration`);
  await p.waitForTimeout(1000);
  await p.click('button:has-text("Open entries")');
  await p.waitForTimeout(1500);
  await p.fill('input[name="minTeamSize"]', "2");
  await p.fill('input[name="maxTeamSize"]', "2");
  await p.click('button:has-text("Save")');
  await p.waitForTimeout(1500);

  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
  await addCategory(WD, "womens");
  await addCategory(MX, "mixed");
  await addCategory(VETS, "age35");
  await addCategory(CAP, "open");

  ok(/Who can enter:\s*Women only/.test(await text(p, `[data-category="${WD}"]`)), "the Women's starting point filled in the rule");
  ok(/Who can enter:\s*Anyone/.test(await text(p, '[data-category="Main"]')), "the original category still takes anyone");

  /* Vets: the event has no date yet, so the panel must say ages are counted on
     a stand-in day — then the organiser sets the real one. */
  let form = await openRules(VETS);
  ok(/no date yet/i.test(await text(p, `[data-category="${VETS}"]`)), "an event with no date says so, prominently");
  await form.locator('input[name="ageMax"]').fill("30");
  await form.locator('input[name="ageMin"]').fill("40");
  await p.waitForTimeout(1200);
  ok((await text(p, `[data-category="${VETS}"]`)).includes("Youngest age is above oldest age."),
    "a youngest age above the oldest is refused before saving");
  await form.locator('input[name="ageMin"]').fill("35");
  await form.locator('input[name="ageMax"]').fill("");
  await form.locator('input[name="ageOn"]').fill("2026-10-12");
  await p.waitForTimeout(1200);
  ok((await form.locator("[data-rules-sentence]").textContent()) === "Age 35 or older on 12 Oct 2026.",
    "the rules are said back in plain words as they change");
  ok((await saveRules(form)).startsWith("Saved."), "the rules save");

  form = await openRules(CAP);
  await form.locator('select[name="ratingMax"]').selectOption("1049");
  await form.locator('input[name="duprMin"]').fill("3.50");
  await p.waitForTimeout(1000);
  ok((await form.locator("[data-rules-sentence]").textContent()).includes("Rating 1049 or lower (up to Intermediate+)."),
    "a rating limit is named by its tier");
  await saveRules(form);

  /* A player an organiser placed high, with a phone, for the capped category
     to recognise later. Main has no rules, so nothing stops this. */
  const STRONG = phone(900);
  await addTeam(`Main Squad ${stamp}`, "Main");
  const mainTeam = p.locator(`[data-team="Main Squad ${stamp}"]`);
  ok((await mainTeam.locator('select[name="gender"]').inputValue()) === "M",
    "a category with no gender rule still starts on M when adding a player");
  await mainTeam.locator('input[placeholder="Player name"]').fill(`Strong ${stamp}`);
  await mainTeam.locator('input[name="phone"]').fill(STRONG);
  await mainTeam.locator('select[name="band"]').selectOption("1300");
  await mainTeam.locator('button:has-text("Add")').first().click();
  await p.waitForTimeout(1500);

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n== the public page ==");

  await p.goto(`${BASE}/e/${slug}`);
  await p.waitForTimeout(1200);
  const mainValue = await p.$eval('select[name="divisionId"]',
    (sel) => [...sel.options].find((o) => o.textContent.startsWith("Main"))?.value ?? "");
  await p.selectOption('select[name="divisionId"]', mainValue);
  await p.waitForTimeout(300);
  ok((await p.locator('input[name="playerDob"]').count()) === 0 && (await p.locator('input[name="playerDupr"]').count()) === 0,
    "a category with no rules asks for nothing new");
  ok((await p.locator("[data-rules]").count()) === 0, "and shows no rules");

  console.log("\n-- Women's Doubles --");
  let t = await enter(slug, WD, `WD Pair ${stamp}`, [
    { name: `Priya ${stamp}`, gender: "F", phone: phone(1) },
    { name: `Asha ${stamp}`, gender: "F", phone: phone(2) },
  ]);
  ok(accepted(t), "two women are accepted");

  t = await enter(slug, WD, `WD Wrong ${stamp}`, [
    { name: `Meera ${stamp}`, gender: "F", phone: phone(3) },
    { name: `Ravi ${stamp}`, gender: "M", phone: phone(4) },
  ]);
  ok(!accepted(t), "a woman and a man are refused");
  ok(t.includes(`Not everyone on this entry can play in ${WD}.`), "the form says why at the top");
  ok((await underPlayer(1)).includes("Women only"), "and under the player who does not fit");
  ok(!(await underPlayer(0)).includes("Women only"), "and not under the one who does");
  ok((await p.locator('input[name="playerName"]').nth(1).inputValue()) === `Ravi ${stamp}`,
    "and nothing typed is lost");

  console.log("\n-- Mixed --");
  t = await enter(slug, MX, `MX Pair ${stamp}`, [
    { name: `Kiran ${stamp}`, gender: "M", phone: phone(5) },
    { name: `Divya ${stamp}`, gender: "F", phone: phone(6) },
  ]);
  ok(accepted(t), "a man and a woman are accepted");
  t = await enter(slug, MX, `MX Wrong ${stamp}`, [
    { name: `Arjun ${stamp}`, gender: "M", phone: phone(7) },
    { name: `Dev ${stamp}`, gender: "M", phone: phone(8) },
  ]);
  ok(!accepted(t) && t.includes("Mixed needs at least one man and one woman."), "two men are refused, with the reason");

  console.log("\n-- 35+ --");
  t = await enter(slug, VETS, `Vets Pair ${stamp}`, [
    { name: `Sanjay ${stamp}`, gender: "M", dob: "1991-10-12", phone: phone(9) },
    { name: `Imran ${stamp}`, gender: "M", dob: "1980-01-01", phone: phone(10) },
  ]);
  ok(accepted(t), "35 on the day exactly is accepted — the birthday counts");
  t = await enter(slug, VETS, `Vets Young ${stamp}`, [
    { name: `Nikhil ${stamp}`, gender: "M", dob: "1991-10-13", phone: phone(11) },
    { name: `Om ${stamp}`, gender: "M", dob: "1980-01-01", phone: phone(12) },
  ]);
  ok(!accepted(t) && (await underPlayer(0)).includes("Age 35+ only (on 12 Oct 2026)"), "one day short is refused, and told the date");
  t = await enter(slug, VETS, `Vets Blank ${stamp}`, [
    { name: `Paul ${stamp}`, gender: "M", phone: phone(13) },
    { name: `Quinn ${stamp}`, gender: "M", dob: "1980-01-01", phone: phone(14) },
  ], { tamper: 'input[name="playerDob"]' });
  ok(!accepted(t) && (await underPlayer(0)).includes("Enter date of birth"), "a blank date of birth is refused even with `required` removed");

  console.log("\n-- rating and DUPR --");
  t = await enter(slug, CAP, `Cap Pair ${stamp}`, [
    { name: `New ${stamp}`, dupr: "3.75", phone: phone(15) },
    { name: `Newer ${stamp}`, dupr: "4.00", phone: phone(16) },
  ]);
  ok(accepted(t), "two newcomers with DUPR 3.75 and 4.00 are accepted — unrated is allowed under an 'up to' limit");
  t = await enter(slug, CAP, `Cap Low ${stamp}`, [
    { name: `Low ${stamp}`, dupr: "3.00", phone: phone(17) },
    { name: `Fine ${stamp}`, dupr: "4.00", phone: phone(18) },
  ]);
  ok(!accepted(t) && (await underPlayer(0)).includes("DUPR 3.50+ only"), "DUPR 3.00 is refused");
  t = await enter(slug, CAP, `Cap Strong ${stamp}`, [
    { name: `Strong ${stamp}`, dupr: "4.00", phone: STRONG },
    { name: `Mate ${stamp}`, dupr: "4.00", phone: phone(19) },
  ]);
  ok(!accepted(t) && (await underPlayer(0)).includes("Rating 1049 and under only"),
    "a known player placed above the cap is refused by their phone number");
  t = await enter(slug, CAP, `Cap Nophone ${stamp}`, [
    { name: `Hidden ${stamp}`, dupr: "4.00", phone: "" },
    { name: `Mate2 ${stamp}`, dupr: "4.00", phone: phone(20) },
  ], { tamper: 'input[name="playerPhone"]' });
  ok(!accepted(t) && (await underPlayer(0)).includes("Enter a mobile number"),
    "leaving the phone blank cannot be used to look unrated");

  /* Faisal, 2026-09-21: "A player can join without DUPR based on organiser's
     discretion." Let in and flagged by default; Strict keeps them out. The
     twin runs the SAME blank entry against the same category made strict. */
  ok((await p.locator('input[name="playerDupr"]').first().getAttribute("required")) === null,
    "the DUPR box is not compulsory in a category that is not strict");
  t = await enter(slug, CAP, `Cap Blank ${stamp}`, [
    { name: `Nodupr ${stamp}`, phone: phone(21) },
    { name: `Nodupr2 ${stamp}`, phone: phone(22) },
  ]);
  ok(accepted(t), "a player with no DUPR is let in by default");

  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
  form = await openRules(CAP);
  await form.locator('select[name="duprStrict"]').selectOption("on");
  await p.waitForTimeout(800);
  ok((await form.locator("[data-rules-sentence]").textContent()).includes("A DUPR is required."),
    "strict is said back in plain words");
  await saveRules(form);
  t = await enter(slug, CAP, `Cap Strict ${stamp}`, [
    { name: `Nodupr3 ${stamp}`, phone: phone(23) },
    { name: `Nodupr4 ${stamp}`, phone: phone(24) },
  ], { tamper: 'input[name="playerDupr"]' });
  ok(!accepted(t) && (await underPlayer(0)).includes("Enter your DUPR"),
    "made strict, the same blank DUPR is refused — even with `required` removed");

  /* Back to the default, which the organiser checks further down rely on. */
  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
  form = await openRules(CAP);
  await form.locator('select[name="duprStrict"]').selectOption("");
  await saveRules(form);

  console.log("\n-- a category with no rules is untouched --");
  t = await enter(slug, "Main", `Main Pair ${stamp}`, [
    { name: `Plain ${stamp}` },
    { name: `Simple ${stamp}` },
  ]);
  ok(accepted(t), "an entry with no phone and the untouched gender default is accepted, as always");

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n== approval checks again ==");

  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
  form = await openRules(WD);
  await form.locator('input[name="ageMin"]').fill("40");
  await form.locator('input[name="ageOn"]').fill("2026-10-12");
  await saveRules(form);

  await p.goto(`${BASE}/t/${slug}/manage/registration`);
  await p.waitForTimeout(1500);
  const wdEntry = p.locator(`li:has-text("WD Pair ${stamp}")`);
  ok((await text(p, `li:has-text("WD Pair ${stamp}")`)).includes("Doesn’t fit current rules"),
    "the approvals list warns before Approve is pressed");
  const blankEntry = await text(p, `li:has-text("Cap Blank ${stamp}")`);
  ok(blankEntry.includes(`Nodupr ${stamp} has no DUPR.`) && !blankEntry.includes("Doesn’t fit"),
    "a player let in without a DUPR is flagged for the organiser, not marked as a misfit");
  ok((await text(p, `li:has-text("WD Pair ${stamp}")`)).includes(WD), "and shows the entry's category");
  await wdEntry.locator('button:has-text("Approve")').click();
  await p.waitForTimeout(2000);
  ok((await text(p, `li:has-text("WD Pair ${stamp}")`)).includes(`Can't approve into ${WD}`),
    "approving an entry the category has since outgrown is refused");

  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
  ok((await p.locator(`[data-team="WD Pair ${stamp}"]`).count()) === 0, "and no team was made");
  form = await openRules(WD);
  await form.locator('input[name="ageMin"]').fill("");
  await saveRules(form);

  await p.goto(`${BASE}/t/${slug}/manage/registration`);
  await p.waitForTimeout(1500);
  for (const name of [`WD Pair ${stamp}`, `MX Pair ${stamp}`, `Cap Pair ${stamp}`]) {
    await p.locator(`li:has-text("${name}")`).locator('button:has-text("Approve")').click();
    await p.waitForTimeout(2200);
  }
  ok((await text(p, `li:has-text("WD Pair ${stamp}")`)).includes("approved"), "with the rule relaxed it approves");

  console.log("\n-- team size and Mixed --");
  await p.fill('input[name="maxTeamSize"]', "1");
  await p.fill('input[name="minTeamSize"]', "1");
  await p.click('button:has-text("Save")');
  await p.waitForTimeout(1800);
  ok((await text(p)).includes(`Not saved. ${MX} is Mixed and needs teams of at least two.`),
    "team size 1 is refused while a Mixed category exists");
  ok((await p.locator('input[name="maxTeamSize"]').inputValue()) === "2", "and the saved size is unchanged");

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n== the organiser adding a player ==");

  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1200);
  await addTeam(`WD Organiser ${stamp}`, WD);
  const wdTeam = p.locator(`[data-team="WD Organiser ${stamp}"]`);
  ok((await wdTeam.locator('select[name="gender"]').inputValue()) === "", "a gender-ruled category makes the organiser choose");
  await wdTeam.locator('input[placeholder="Player name"]').fill(`Vikram ${stamp}`);
  await wdTeam.locator('select[name="gender"]').selectOption("M");
  await wdTeam.locator('button:has-text("Add")').first().click();
  await p.waitForTimeout(1800);
  ok((await text(p, `[data-team="WD Organiser ${stamp}"]`)).includes(`Doesn’t fit this category: Vikram ${stamp} (Women only)`),
    "adding a man to Women's Doubles stops with the reason");
  ok((await wdTeam.locator('input[type="checkbox"][name="waive"]').count()) === 1, "and offers to add him anyway");
  await wdTeam.locator('input[name="waive"]').check();
  await wdTeam.locator('button:has-text("Add")').first().click();
  await p.waitForTimeout(2000);
  const letIn = await text(p, `[data-team="WD Organiser ${stamp}"]`);
  ok(letIn.includes(`Vikram ${stamp}`) && /Let in by organiser/i.test(letIn), "ticked, he is added and the team shows it");

  await wdTeam.locator('input[placeholder="Player name"]').fill(`Tara ${stamp}`);
  await wdTeam.locator('select[name="gender"]').selectOption("F");
  await wdTeam.locator('button:has-text("Add")').first().click();
  await p.waitForTimeout(1800);
  ok((await text(p, `[data-team="WD Organiser ${stamp}"]`)).includes(`Tara ${stamp}`), "a woman is added with no fuss");

  /* The level the organiser picks on THIS form is the level the player is
     about to be given, so the cap is judged on it. Judged on "nobody by that
     number yet" the answer was "unrated", which let them straight in — and the
     card went red the moment the page re-rendered, with no waiver to clear it
     because nobody had been asked. */
  await addTeam(`Cap Organiser ${stamp}`, CAP);
  const capTeam = p.locator(`[data-team="Cap Organiser ${stamp}"]`);
  ok((await capTeam.locator('input[name="dupr"]').getAttribute("required")) === null,
    "the DUPR box is not browser-required, or the reason and the tick could never be reached");
  await capTeam.locator('input[placeholder="Player name"]').fill(`Ace ${stamp}`);
  await capTeam.locator('input[name="phone"]').fill(phone(30));
  await capTeam.locator('select[name="band"]').selectOption("1300");
  await capTeam.locator('button:has-text("Add")').first().click();
  await p.waitForTimeout(1800);
  const capStop = await text(p, `[data-team="Cap Organiser ${stamp}"]`);
  ok(capStop.includes("Rating 1049 and under only"),
    "a player placed above the cap is stopped, on the level being given to them");
  ok(!capStop.includes("DUPR 3.50+ only"),
    "but NOT on the DUPR left blank — this category lets players without one in");
  await capTeam.locator('input[name="waive"]').check();
  await capTeam.locator('button:has-text("Add")').first().click();
  await p.waitForTimeout(2000);
  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1500);
  const capLetIn = await text(p, `[data-team="Cap Organiser ${stamp}"]`);
  ok(/Let in by organiser/i.test(capLetIn), "ticked, he is in and the card says the organiser let him in");
  ok(!capLetIn.includes("Doesn’t meet"),
    "and it stays that way once he exists and has the rating that was refused");
  ok(capLetIn.includes(`Ace ${stamp}: No DUPR`), "and the card flags that he has no DUPR");

  /* A typo is not "no DUPR". Dropped quietly, "35" would have become a player
     let in with a flag that misstates what the organiser typed. */
  await capTeam.locator('input[placeholder="Player name"]').fill(`Typo ${stamp}`);
  await capTeam.locator('input[name="dupr"]').fill("35");
  await capTeam.locator('button:has-text("Add")').first().click();
  await p.waitForTimeout(1800);
  ok((await text(p, `[data-team="Cap Organiser ${stamp}"]`)).includes("DUPR must be a number between 1.00 and 8.00."),
    "a DUPR that is not a DUPR is refused, not dropped");

  /* ══════════════════════════════════════════════════════════════════════ */
  console.log("\n== changing the rules later removes nobody ==");

  form = await openRules(MX);
  await form.locator('button[aria-pressed]:text-is("Men")').click();
  await p.waitForTimeout(600);
  const said = await saveRules(form);
  ok(/1 team already entered doesn’t meet these rules/.test(said) && said.includes("Nobody was removed"),
    "saving says how many teams no longer fit, and that nobody was removed");
  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(1500);
  const mxCard = await text(p, `[data-team="MX Pair ${stamp}"]`);
  ok(mxCard.includes(`Doesn’t meet ${MX} rules: Divya ${stamp} (Men only)`), "the team is marked with the reason");
  ok(mxCard.includes(`Kiran ${stamp}`) && mxCard.includes(`Divya ${stamp}`), "and both players are still on it");
  ok((await text(p, `[data-category="${MX}"]`)).includes("1 doesn’t fit"), "the category says one team doesn't fit");

  const capCard = await text(p, `[data-team="Cap Pair ${stamp}"]`);
  ok(/unrated/i.test(capCard) && !capCard.includes("Doesn’t meet"), "unrated players under a cap are a grey note, not red");

  console.log("\n== errors ==");
  const bad = realErrors(errs);
  ok(bad.length === 0, `no runtime errors: ${JSON.stringify(bad.slice(0, 3))}`);
} finally {
  await b.close();
}

ok.done("category rules");
