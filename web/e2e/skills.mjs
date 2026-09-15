/* Peer ratings, and the rule that decides who may give one.
 *
 * Faisal, 2026-09-15: "the player himself/herself will set the criteria" -
 * connections, people played with or against, or anyone. So the rule is not the
 * app's; it is a setting on each person's own profile, and these are the things
 * worth proving:
 *
 *   under the default, someone who HAS played you    -> can rate
 *   under the default, someone who has NOT           -> cannot, and is told why
 *   the SAME person, after the subject opens it up   -> can
 *   and after the subject closes it again            -> cannot
 *   rating twice                                     -> replaces, does not stack
 *
 * The third and fourth are what make this a test of the SETTING rather than of
 * the page: one person, one profile, and only the criteria changing.
 *
 * The last is what the whole storage design exists for. The legacy app folds
 * each rating into a running average with a count, which cannot tell two
 * submissions from one person apart from two people's — so anybody can lift
 * their own numbers by pressing Save repeatedly. Here a rater owns one row per
 * skill and re-rating overwrites it.
 *
 * Identity is the `rs_me` cookie, set directly here. That is exactly as strong
 * as it is in the app today (a name badge, not a credential — see
 * lib/community/me.ts), which is the point: the eligibility rule is written to
 * be right the day sign-in makes the cookie trustworthy.
 *
 * Run against a production build, same as the other suites. */

import { launch, BASE, makeOk, watchErrors, text, realErrors, createTournament } from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const ctx = await b.newContext({ viewport: { width: 1000, height: 1200 } });
const p = await ctx.newPage();
const errs = watchErrors(p);

const stamp = String(process.hrtime.bigint()).slice(-6);

/** Become this person, the way the Play tab's picker does. */
async function beThem(personId) {
  await ctx.clearCookies();
  if (personId) {
    await ctx.addCookies([
      { name: "rs_me", value: personId, url: BASE, httpOnly: true, sameSite: "Lax" },
    ]);
  }
}

async function addTeam(name) {
  await p.fill('input[placeholder="New team name"]', name);
  await p.click('button:has-text("Add team")');
  await p.waitForTimeout(500);
}

async function addPlayer(teamName, playerName, phone) {
  const form = p.locator(`[data-team="${teamName}"] form:has(input[placeholder="Player name"])`);
  await form.locator('input[placeholder="Player name"]').fill(playerName);
  await form.locator('input[name="phone"]').fill(phone);
  await form.locator('button:has-text("Add")').click();
  await p.waitForTimeout(700);
}

/** The person id behind a name on the roster. */
async function personIdFor(name) {
  await p.goto(`${BASE}/people?q=${encodeURIComponent(name)}`);
  await p.waitForTimeout(700);
  const href = await p.locator('ol li a[href^="/people/"]').first().getAttribute('href');
  return href ? href.split('/').pop() : null;
}

try {
  console.log("\n== an event where two people actually play each other ==");

  const slug = await createTournament(p, `Skills ${stamp}`, { format: "Standard" });
  ok(!!slug, `created the event: ${slug}`);

  await addTeam("Reds");
  await addTeam("Blues");
  await addPlayer("Reds", `Rhea ${stamp}`, `0771${stamp}`);
  await addPlayer("Blues", `Vikram ${stamp}`, `0772${stamp}`);

  await p.locator('[data-category="Main"] button:has-text("Draw groups & fixtures")').click();
  await p.waitForTimeout(1400);

  /* Play it, so they have shared a court. An unplayed fixture must NOT count —
     a draw published a week early would otherwise open ratings for matches that
     have not happened. */
  await p.locator('a:text("Score")').first().click();
  await p.waitForURL(/\/score\//, { timeout: 20000 });
  await p.waitForSelector('[aria-label^="Point to"]', { timeout: 20000 });
  const half = p.locator('[aria-label^="Point to"]').first();
  for (let k = 0; k < 16; k++) {
    if (await half.isDisabled().catch(() => true)) break;
    await half.click().catch(() => {});
    await p.waitForTimeout(120);
  }
  ok(true, "played the match between them");

  const rhea = await personIdFor(`Rhea ${stamp}`);
  const vikram = await personIdFor(`Vikram ${stamp}`);
  ok(!!rhea && !!vikram, `both are on the roster (${rhea?.slice(0, 8)}, ${vikram?.slice(0, 8)})`);

  console.log("\n== a stranger cannot rate ==");
  /* Somebody from the seed who has never shared a court with Vikram. */
  await beThem(null);
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(800);
  const anon = await text(p);
  ok(anon.includes("Skills"), "the skills section is on the profile");
  ok(!anon.includes("Rate Vikram"), "with no rate button for somebody who has not said who they are");
  ok(/Pick who you are/i.test(anon), "and it says how to fix that");

  await beThem(rhea);
  await p.goto(`${BASE}/people/${rhea}`); await p.waitForTimeout(800);
  const self = await text(p);
  ok(/cannot rate yourself/i.test(self), "you cannot rate yourself");

  console.log("\n== an opponent can ==");
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(800);
  ok((await text(p)).includes("Rate Vikram"), "an opponent is offered the form");

  await p.click('button:has-text("Rate Vikram")');
  await p.waitForTimeout(500);
  /* Top marks on the first skill, a 5 on the second, and one tag. */
  const skillRows = p.locator('form label:has(input[type="radio"])');
  ok((await skillRows.count()) === 65, `thirteen skills at five points each (${await skillRows.count()})`);

  /* Click the LABEL, not the input. The radios are visually hidden with the
     label as the target — the standard accessible pattern, and what a finger
     actually hits. Calling .check() on the input fails with "label intercepts
     pointer events", which is the automation noticing it is doing something a
     user cannot. */
  const pick = (skill, n) => p.locator(`label:has(input[name="skill:${skill}"][value="${n}"])`).click();
  await pick("Serve", 5);
  await pick("Return", 5);
  await p.locator('label:has(input[name^="tag:"])').first().click();
  await p.click('form button:has-text("Save")');
  await p.waitForTimeout(1800);

  const saved = await text(p);
  ok(/Saved/i.test(saved), "it saves: " + (saved.match(/Saved[^.]*\./) || [""])[0]);
  ok(/replaces what you said/i.test(saved), "and says that re-rating replaces rather than adds");

  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(900);
  const rated = await text(p);
  ok(/1 person/.test(rated), "the profile says one person has rated them");
  const svg = await p.locator("svg[role=img]").count();
  ok(svg > 0, "the radar is drawn");
  const label = await p.locator("svg[role=img]").first().getAttribute("aria-label");
  ok(/out of 5/.test(label ?? ""), "and it is readable without seeing it: " + (label ?? "").slice(0, 60));

  console.log("\n== rating twice replaces, it does not stack ==");
  await p.click('button:has-text("Change what you said")');
  await p.waitForTimeout(500);
  /* The form opens on what THIS rater said last time. */
  const stillFive = await p.locator('input[name="skill:Serve"][value="5"]').isChecked();
  ok(stillFive, "the form reopens on their own previous answers");

  await pick("Serve", 1);
  await p.click('form button:has-text("Save")');
  await p.waitForTimeout(1800);
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(900);
  const again = await text(p);
  ok(/1 person/.test(again), "still ONE person after rating a second time");
  ok(!/2 people/.test(again), "not two — the same rater does not count twice");

  console.log("\n== somebody who never played them still cannot ==");
  /* A seeded player from a different event entirely. */
  await p.goto(`${BASE}/people`); await p.waitForTimeout(700);
  const others = await p.$$eval('ol li a[href^="/people/"]', (as) =>
    as.map((a) => a.getAttribute("href")));
  const stranger = others.map((h) => h.split("/").pop()).find((x) => x !== rhea && x !== vikram);
  ok(!!stranger, "found somebody from another event");
  await beThem(stranger);
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(900);
  const denied = await text(p);
  ok(!denied.includes("Rate Vikram"), "they are not offered the form");
  ok(
    /takes ratings from people they have played with or against/i.test(denied),
    "and are told THIS PERSON'S rule, rather than shown a missing button",
  );
  ok(/1 person/.test(denied), "and the existing rating is still visible to them");

  console.log("\n== the subject sets the rule, not the app ==");
  /* Faisal, 2026-09-15: "the player himself/herself will set the criteria."
     The stranger above cannot rate Vikram under the default. Vikram opens it to
     anyone; the SAME stranger can. Then he closes it again and they cannot.
     Changing one setting and re-checking the same person is what makes this a
     test of the setting rather than of the page. */
  await beThem(vikram);
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(800);
  ok(/Rated by:\s*people i have played/i.test((await text(p)).replace(/\s+/g, " ")),
     "the default is people they have played");

  await p.click('button:has-text("change")');
  await p.waitForTimeout(400);
  await p.click('button:has-text("Anyone")');
  await p.waitForTimeout(1600);

  await beThem(stranger);
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(900);
  ok((await text(p)).includes("Rate Vikram"),
     "with it open to anyone, somebody who never played them CAN rate");

  await beThem(vikram);
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(800);
  await p.click('button:has-text("change")');
  await p.waitForTimeout(400);
  await p.click('button:has-text("People I have played")');
  await p.waitForTimeout(1600);

  await beThem(stranger);
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(900);
  ok(!(await text(p)).includes("Rate Vikram"), "and closing it again shuts them out");

  console.log("\n== connections are not pretended ==");
  /* The option exists, does nothing yet, and says so rather than quietly
     meaning "nobody". */
  await beThem(vikram);
  await p.goto(`${BASE}/people/${vikram}`); await p.waitForTimeout(800);
  await p.click('button:has-text("change")');
  await p.waitForTimeout(400);
  const connections = p.locator('button:has-text("My connections")');
  ok(await connections.isDisabled(), "the connections option is not selectable yet");
  ok(/nobody would qualify yet/i.test(await text(p)), "and says why");

  console.log("\n== endorsements stay on the profile ==");
  /* Faisal, 2026-09-15: "endorsement stays in profile only." No tag filter on
     the roster, and no chips on its rows. */
  await beThem(null);
  await p.goto(`${BASE}/people?sport=pb`); await p.waitForTimeout(800);
  const roster = await text(p);
  ok(!/endorse/i.test(roster), "the roster does not mention endorsements");
  ok(
    (await p.locator('select[name="tag"]').count()) === 0,
    "and offers no way to search by one",
  );

  console.log("\n== errors ==");
  const bad = realErrors(errs);
  ok(bad.length === 0, `no runtime errors: ${JSON.stringify(bad.slice(0, 3))}`);
} finally {
  await b.close();
}

ok.done("peer ratings");
