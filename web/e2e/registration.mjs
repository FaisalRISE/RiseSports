/* Players signing themselves up — the whole point of the registration feature.
 *
 * Before this existed, every player in RISE was typed in by an organiser, which
 * is why ratings mostly could not follow anyone: a phone number only arrived if
 * the organiser typed it. This drives the real loop:
 *
 *   1. open entries on a fresh event
 *   2. submit from the PUBLIC page, as a player would — own name, own phone
 *   3. see it land as pending, with the phone masked
 *   4. approve it and confirm a team, players and PEOPLE appear
 *   5. register the same person for a second event and confirm the rating came
 *
 * Run against a production build, same as the other suites. */

import {
  launch, BASE, makeOk, watchErrors, text, until, realErrors, createTournament,
} from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
const errs = watchErrors(p);

/* Unique per run: phone is a UNIQUE key across the shared database, so a reused
   number would match somebody from an earlier run and prove nothing. */
const stamp = String(process.hrtime.bigint()).slice(-8);
const phone = (n) => `9${stamp}${n}`.slice(0, 10);
const NAME = `Priya ${stamp}`;

/** Fill and submit the public entry form. */
async function enterEvent(slug, { teamName, players }) {
  await p.goto(`${BASE}/e/${slug}`);
  await p.waitForTimeout(1200);
  await p.fill('input[name="teamName"]', teamName);

  for (let i = 0; i < players.length; i++) {
    const names = p.locator('input[name="playerName"]');
    if ((await names.count()) <= i) {
      await p.click('button:has-text("Add player")');
      await p.waitForTimeout(300);
    }
    await p.locator('input[name="playerName"]').nth(i).fill(players[i].name);
    await p.locator('input[name="playerPhone"]').nth(i).fill(players[i].phone);
  }
  await p.click('button[type="submit"]');
  await p.waitForTimeout(2500);
}

/* ── Set up an event that takes entries ──────────────────────────────────── */
console.log("\n== open entries ==");

const slug = await createTournament(p, `Entry Cup ${stamp}`, { sport: "Pickleball", format: "Standard" });
ok(!!slug, `created ${slug}`);

await p.goto(`${BASE}/t/${slug}/manage/registration`);
await p.waitForTimeout(1200);

/* A brand-new tournament is a DRAFT, so the public page must 404 rather than
   quietly take entries for something nobody has finished setting up. */
await p.goto(`${BASE}/e/${slug}`);
await p.waitForTimeout(1200);
ok(/could not be found|404/i.test(await text(p)), "a draft is not publicly visible");

await p.goto(`${BASE}/t/${slug}/manage/registration`);
await p.waitForTimeout(1000);
await p.click('button:has-text("Open entries")');
await p.waitForTimeout(1800);
ok((await text(p)).includes("Open — the public link takes entries"), "entries opened");

/* Two players per team, and a question of the organiser's own. */
await p.fill('input[name="minTeamSize"]', "2");
await p.fill('input[name="maxTeamSize"]', "2");
await p.fill('input[name="entryFee"]', "300");
await p.click('button:has-text("Save")');
await p.waitForTimeout(1500);

/* Scoped to the form that owns `select[name=type]`. A bare
   `button:has-text("Add")` hits the DIVISION button — the page has three "Add"
   buttons — which silently added nothing. */
const fieldForm = p.locator('form:has(select[name="type"])');
await fieldForm.locator('input[name="question"]').fill("Shirt size");
await fieldForm.locator('select[name="type"]').selectOption("choice");
await fieldForm.locator('input[name="options"]').fill("S, M, L");
await fieldForm.locator('button:has-text("Add")').click();
await p.waitForTimeout(1800);
/* Asserted on the SAVED list entry, not on page text: "Shirt size" is also the
   input's placeholder, so `text().includes(...)` passed while nothing had been
   added at all. */
ok(
  (await p.locator('li:has-text("Shirt size")').count()) > 0,
  "a custom question was added",
);

/* ── Enter, as a player ──────────────────────────────────────────────────── */
console.log("\n== a player enters from the public page ==");

await p.goto(`${BASE}/e/${slug}`);
await p.waitForTimeout(1200);
const publicText = await text(p);
ok(publicText.includes("₹300"), "the fee is shown on the poster");
ok(publicText.includes("Shirt size"), "the organiser's question is asked");
ok(!publicText.includes("Manage") && !publicText.includes("Referee"), "no organiser controls leak onto the public page");

await enterEvent(slug, {
  teamName: `Court Jesters ${stamp}`,
  players: [
    { name: NAME, phone: phone(1) },
    { name: `Rohit ${stamp}`, phone: phone(2) },
  ],
});
ok((await text(p)).includes("Entry received"), "the entry was accepted");
ok(/Reference [A-Z0-9]{8}/.test(await text(p)), "a reference is given to quote");

/* A second identical submission must not create a second team. */
console.log("\n-- the same number cannot enter twice --");
await enterEvent(slug, {
  teamName: `Duplicate ${stamp}`,
  players: [{ name: NAME, phone: phone(1) }, { name: `Someone ${stamp}`, phone: phone(3) }],
});
ok(/already in for this event/i.test(await text(p)), "a duplicate entry is refused");

/* ── Approve ─────────────────────────────────────────────────────────────── */
console.log("\n== the organiser approves ==");

await p.goto(`${BASE}/t/${slug}/manage/registration`);
await p.waitForTimeout(1500);
const inbox = await text(p);
ok(/1 PENDING/i.test(inbox), "one entry is waiting");
ok(inbox.includes(NAME), "the entrant's name is shown");
/* The organiser needs to know a number is on file, not to read it off a screen. */
ok(!inbox.includes(phone(1)), "the full phone number is NOT shown to the organiser");
ok(inbox.includes(`…${phone(1).slice(-4)}`), "it is masked to the last four digits");

await p.click('button:has-text("Approve")');
await p.waitForTimeout(3000);
ok(/1 APPROVED/i.test(await text(p)), "the entry is approved");

console.log("\n-- approval built a real team --");
await p.goto(`${BASE}/t/${slug}/manage`);
await p.waitForTimeout(1200);
const manage = await text(p);
ok(manage.includes(`Court Jesters ${stamp}`), "the team exists");
ok(manage.includes(NAME), "with the players on it");

/* THE PAYOFF: the registrant typed their own phone, so they are now a person
   in the roster with no organiser data entry at all. */
console.log("\n-- and put them in the roster --");
await p.goto(`${BASE}/people?q=${encodeURIComponent(NAME)}`);
await p.waitForTimeout(1500);
ok((await p.$("a[href^='/people/']")) !== null, "the registrant is now a RISE person");
ok(!(await text(p)).includes(phone(1)), "their number is not published on the roster");

/* ── A second event: the rating travels ──────────────────────────────────── */
console.log("\n== the same player enters a different event ==");

const slug2 = await createTournament(p, `Entry Cup Two ${stamp}`, { sport: "Pickleball", format: "Standard" });
await p.goto(`${BASE}/t/${slug2}/manage/registration`);
await p.waitForTimeout(1200);
await p.click('button:has-text("Open entries")');
await p.waitForTimeout(1500);
await p.fill('input[name="minTeamSize"]', "2");
await p.fill('input[name="maxTeamSize"]', "2");
await p.click('button:has-text("Save")');
await p.waitForTimeout(1500);

await enterEvent(slug2, {
  teamName: `Jesters Again ${stamp}`,
  /* Typed differently on purpose — a leading zero instead of the country code.
     Matching has to survive how people actually type their own number. */
  players: [
    { name: `Priya M ${stamp}`, phone: `0${phone(1)}` },
    { name: `Sam ${stamp}`, phone: phone(4) },
  ],
});
ok((await text(p)).includes("Entry received"), "the second entry was accepted");

await p.goto(`${BASE}/t/${slug2}/manage/registration`);
await p.waitForTimeout(1500);
await p.click('button:has-text("Approve")');
await p.waitForTimeout(3000);

/* Still ONE person, not a duplicate — which is the whole reason phone is the
   key rather than the name. */
await p.goto(`${BASE}/people?q=${encodeURIComponent(stamp)}`);
await p.waitForTimeout(1500);
const rosterRows = await p.$$eval("a[href^='/people/']", (as) => as.map((a) => a.innerText.replace(/\n/g, " | ")));
const priya = rosterRows.filter((r) => /Priya/.test(r));
ok(priya.length === 1, `one Priya, not two: ${priya.join(" || ")}`);
ok(
  await until(async () => /2 events/.test(await text(p)), { timeout: 8000, label: "her event count" }),
  `she is in both events on one profile: ${priya[0]}`,
);

console.log("\n== errors ==");
const real = realErrors(errs);
ok(real.length === 0, `no unexpected runtime errors: ${JSON.stringify(real.slice(0, 3))}`);

await b.close();
ok.done("registration");
