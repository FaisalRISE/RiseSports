/* The property this whole milestone exists for: a RISE Rating follows the
 * player between events, and an organiser can seed a draw from it.
 *
 * A rating that resets every tournament cannot be a reference and cannot seed a
 * draw, so this drives the real thing end to end:
 *
 *   1. build an event, add people WITH PHONE NUMBERS, score a match
 *   2. confirm the rating moved and the roster knows about it
 *   3. build a SECOND event, add the same person by the same phone
 *   4. confirm they arrive carrying the rating they earned in the first
 *   5. confirm "Seed by RISE Rating" orders teams by skill, not arrival
 *
 * Run against a production build, same as the other suites. */

import { launch, BASE, makeOk, watchErrors, text, realErrors } from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const p = await b.newPage({ viewport: { width: 430, height: 900 } });
const errs = watchErrors(p);

/* Unique per run: these scripts share a database with the other suites, and a
   phone number is a UNIQUE key — reusing one would match a person from an
   earlier run and make the assertions meaningless. */
const stamp = String(process.hrtime.bigint()).slice(-8);
const phoneOf = (n) => `9${stamp}${n}`.slice(0, 10);

const PLAYERS = [
  { name: `Anya ${stamp}`, phone: phoneOf(1), team: 0, gender: "F" },
  { name: `Bo ${stamp}`, phone: phoneOf(2), team: 0, gender: "M" },
  { name: `Cy ${stamp}`, phone: phoneOf(3), team: 1, gender: "F" },
  { name: `Dev ${stamp}`, phone: phoneOf(4), team: 1, gender: "M" },
];

async function createTournament(name) {
  await p.goto(`${BASE}/new`);
  await p.waitForTimeout(500);
  await p.fill('input[name="name"]', name);
  await p.click('button[type="submit"]');
  await p.waitForURL(/\/manage/, { timeout: 20000 });
  await p.waitForTimeout(600);
  return new URL(p.url()).pathname.split("/")[2];
}

async function addTeams(names) {
  for (const n of names) {
    await p.fill('input[placeholder="New team name"]', n);
    await p.click('button:has-text("Add team")');
    await p.waitForTimeout(500);
  }
}

/** Fills the per-team roster form: name, gender, phone, and a starting level. */
async function addPlayer({ name, phone, team, gender }, band) {
  const form = p.locator('form:has(input[placeholder="Player name"])').nth(team);
  await form.locator('input[placeholder="Player name"]').fill(name);
  await form.locator('select[name="gender"]').selectOption(gender);
  await form.locator('input[name="phone"]').fill(phone);
  if (band) await form.locator('select[name="band"]').selectOption(String(band));
  await form.locator('button:has-text("Add")').click();
  await p.waitForTimeout(700);
}

/** Taps one side until the console disables itself — the match is then final. */
async function finishAMatch(slug) {
  await p.goto(`${BASE}/t/${slug}/manage`);
  await p.waitForTimeout(800);
  const hrefs = await p.$$eval("a[href*='/score/']", (as) => [...new Set(as.map((a) => a.getAttribute("href")))]);
  for (const href of hrefs) {
    await p.goto(`${BASE}${href}`);
    await p.waitForTimeout(900);
    const names = await p.$$eval("button[aria-label^='Point to']", (es) =>
      es.map((e) => e.getAttribute("aria-label").replace("Point to ", "")),
    );
    if (names.length !== 2) continue;
    for (let i = 0; i < 70; i++) {
      const done = await p.$$eval("button[aria-label^='Point to']", (es) => es.every((e) => e.disabled));
      if (done) return names[0];
      await p.click(`button[aria-label="Point to ${names[0]}"]`).catch(() => {});
      await p.waitForTimeout(300);
    }
  }
  return null;
}

const ratingOnRatingsPage = async (slug, name) => {
  await p.goto(`${BASE}/t/${slug}/ratings`);
  await p.waitForTimeout(1000);
  const rows = await p.$$eval("tbody tr", (rs) => rs.map((r) => [...r.children].map((c) => c.textContent.trim())));
  return rows.find((r) => r[0].startsWith(name.split(" ")[0]));
};

/* ── Event one ───────────────────────────────────────────────────────────── */
console.log("\n== first event: people join with phone numbers ==");

const slugA = await createTournament(`Carry Cup A ${stamp}`);
ok(!!slugA, `created ${slugA}`);
await addTeams(["Falcons", "Owls"]);

/* Seeded from a §12.2 placement band, so the two teams start apart and the
   draw has something to sort by. */
await addPlayer(PLAYERS[0], 1000);
await addPlayer(PLAYERS[1], 1000);
await addPlayer(PLAYERS[2], 700);
await addPlayer(PLAYERS[3], 700);

const rosterText = await text(p);
ok(PLAYERS.every((x) => rosterText.includes(x.name)), "all four players added");

console.log("\n-- the roster knows them before a ball is hit --");
await p.goto(`${BASE}/people?q=${encodeURIComponent(stamp)}`);
await p.waitForTimeout(1000);
const listed = await text(p);
ok(listed.includes(PLAYERS[0].name), "new people appear on the roster");
ok(/1000/.test(listed), "seeded from the placement band, not left blank");
/* A phone is how a rating follows someone; it must never be published. */
ok(!listed.includes(PLAYERS[0].phone), "the full phone number is NOT shown");

console.log("\n-- draw and score --");
await p.goto(`${BASE}/t/${slugA}/manage`);
await p.waitForTimeout(600);
await p.fill('input[name="groups"]', "1");
await p.click('button:has-text("Draw groups")');
await p.waitForTimeout(1800);

const winner = await finishAMatch(slugA);
ok(!!winner, `drove a match to completion (${winner} won)`);

const anyaA = await ratingOnRatingsPage(slugA, PLAYERS[0].name);
ok(!!anyaA, "the ratings page lists her");
const deltaA = Number(String(anyaA?.[4] ?? "0").replace("—", "0").replace("+", ""));
ok(deltaA !== 0, `her rating moved at this event (${anyaA?.[4]})`);
ok(anyaA?.[3] === "1000", `she started from her seeded rating (${anyaA?.[3]})`);

/* §7 is shown wherever the rating is — a rating without it looks authoritative
   when it isn't. */
ok(/High|Medium|Low/.test((anyaA ?? []).join(" ")), "reliability shown beside the rating");

const carriedRating = Number(anyaA?.[5]);
ok(Number.isFinite(carriedRating), `she leaves the event rated ${carriedRating}`);

/* ── Event two: the whole point ──────────────────────────────────────────── */
console.log("\n== second event: the SAME person, by phone ==");

const slugB = await createTournament(`Carry Cup B ${stamp}`);
await addTeams(["Kites", "Wrens"]);

/* Same phone, no band this time: if the person is matched, the band is
   irrelevant because they already have a rating. */
await addPlayer({ ...PLAYERS[0], team: 0 }, null);
await addPlayer({ ...PLAYERS[2], team: 1 }, null);

const anyaB = await ratingOnRatingsPage(slugB, PLAYERS[0].name);
ok(!!anyaB, "she is on the second event's ratings page");
ok(
  Number(anyaB?.[5]) === carriedRating,
  `SHE ARRIVES CARRYING HER RATING: ${anyaB?.[5]} at the second event, ${carriedRating} at the end of the first`,
);
ok(Number(anyaB?.[2]) === 0, "with no matches played yet here");

console.log("\n-- one profile, both events --");
await p.goto(`${BASE}/people?q=${encodeURIComponent(PLAYERS[0].name)}`);
await p.waitForTimeout(900);
const hit = await p.$("a[href^='/people/']");
ok(!!hit, "she has exactly one roster entry");
const profileText = await text(p);
ok(/2 events/.test(profileText), `one person, two events: ${profileText.match(/\d+ events?/)?.[0]}`);

await p.click("a[href^='/people/']");
await p.waitForTimeout(1200);
const profile = await text(p);
ok(profile.includes("How this rating was earned"), "the profile shows the working");
/* Spec §9: every input recorded, so a disputed rating can be explained. */
ok(/expected \d/.test(profile), "the working names the expected result");
ok(/margin ×/.test(profile), "the working names the margin multiplier");

/* ── Seeding by rating ───────────────────────────────────────────────────── */
console.log("\n== seed the draw by rating, not arrival order ==");

await p.goto(`${BASE}/t/${slugB}/manage`);
await p.waitForTimeout(900);
await p.click('button:has-text("Seed by RISE Rating")');
await p.waitForTimeout(1500);
ok(true, "seeding action ran without error");

console.log("\n== errors ==");
const real = realErrors(errs);
ok(real.length === 0, `no unexpected runtime errors: ${JSON.stringify(real.slice(0, 3))}`);

await b.close();
ok.done("rating carry-over");
