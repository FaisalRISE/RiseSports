/* The order of play, and the one thing it must never do.
 *
 * A player entered in two categories is ONE person with two `players` rows,
 * two teams and two draws. Put both their matches at 10:30 and they cannot play
 * either — and nothing about the data looks wrong afterwards, which is why this
 * needs a real browser and a real database rather than a unit test alone: the
 * unit tests check the engine against ids it is handed, and this checks that
 * the ids handed to it are the right ones.
 *
 * The test is differential on purpose. Two categories, one match each, enough
 * courts for both:
 *
 *   same phone in both      -> one person -> the two matches must NOT share a time
 *   different phones        -> two people -> they SHOULD share a time
 *
 * Either half alone proves nothing. A scheduler that put everything in its own
 * slot would pass the first; one that ignored people entirely would pass the
 * second.
 *
 * Run against a production build, same as the other suites. */

import { launch, BASE, makeOk, watchErrors, text, realErrors, createTournament } from "./harness.mjs";

const ok = makeOk();
const b = await launch();
const p = await b.newPage({ viewport: { width: 1100, height: 1200 } });
const errs = watchErrors(p);

const stamp = String(process.hrtime.bigint()).slice(-6);

async function addCategory(name) {
  await p.fill('input[placeholder*="Add a category"]', name);
  await p.click('button:has-text("Add category")');
  await p.waitForTimeout(700);
}

async function addTeam(name, categoryName) {
  await p.fill('input[placeholder="New team name"]', name);
  const picker = p.locator('form:has(input[placeholder="New team name"]) select[name="divisionId"]');
  if (await picker.count()) await picker.selectOption({ label: categoryName });
  await p.click('button:has-text("Add team")');
  await p.waitForTimeout(500);
}

/** One team's roster form, addressed by the card's `data-team` hook. */
async function addPlayer(teamName, playerName, phone) {
  const form = p.locator(`[data-team="${teamName}"] form:has(input[placeholder="Player name"])`);
  await form.locator('input[placeholder="Player name"]').fill(playerName);
  await form.locator('input[name="phone"]').fill(phone);
  await form.locator('button:has-text("Add")').click();
  await p.waitForTimeout(700);
}

const drawCard = (categoryName) => p.locator(`[data-category="${categoryName}"]`);

/* Deliberately does NOT set the group count. Two teams used to be split across
   the control's default of two groups, leaving one entrant in each and drawing
   no fixtures at all — the organiser pressed Draw and nothing happened. The
   count is now clamped to what the field can fill, so the default works, and
   leaving it alone here is what makes this a guard against that coming back. */
async function drawGroups(categoryName) {
  const c = drawCard(categoryName);
  await c.locator('button:has-text("Draw groups & fixtures")').click();
  await p.waitForTimeout(1200);
}

/** Every row of the order-of-play table: [time, court, category, match]. */
const orderRows = () =>
  p.$$eval("[data-testid=order-of-play] tbody tr", (rows) =>
    rows.map((r) => [...r.children].map((c) => c.textContent.trim())),
  );

async function drawTimes({ courts = 4, minutes = 20, at = "2026-09-20T09:00" } = {}) {
  const form = p.locator('form:has(input[name="startsAt"])');
  await form.locator('input[name="startsAt"]').fill(at);
  await form.locator('input[name="courts"]').fill(String(courts));
  await form.locator('input[name="matchMinutes"]').fill(String(minutes));
  await form.locator('button:has-text("Draw up the times")').click();
  await p.waitForTimeout(1600);
}

/** The times given to matches of one category, as written on the sheet. */
async function timesFor(categoryName) {
  const rows = await orderRows();
  return rows.filter((r) => r[2] === categoryName).map((r) => r[0]);
}

try {
  /* ── one human in two categories ─────────────────────────────────────── */
  console.log("\n== the same person, entered twice ==");

  const slug = await createTournament(p, `Clash Test ${stamp}`, { format: "Standard" });
  ok(!!slug, `created the event: ${slug}`);

  await addCategory("Mixed");
  await addTeam("MainA", "Main");
  await addTeam("MainB", "Main");
  await addTeam("MixA", "Mixed");
  await addTeam("MixB", "Mixed");

  const shared = `0999${stamp}`;
  await addPlayer("MainA", `Priya ${stamp}`, shared);
  await addPlayer("MixA", `Priya ${stamp}`, shared);
  await addPlayer("MainB", `Arjun ${stamp}`, `0111${stamp}`);
  await addPlayer("MixB", `Kiran ${stamp}`, `0222${stamp}`);

  const rostered = await text(p);
  ok(rostered.includes(`Priya ${stamp}`), "the shared player is on the sheet");

  await drawGroups("Main");
  await drawGroups("Mixed");

  /* Before anything about times: the draw has to have produced fixtures at all.
     With two teams per category and the group count left at its default, it
     used to produce none. */
  const drawn = await text(p);
  ok(!drawn.includes("No matches yet."), "the default group count drew fixtures for a field of two");
  ok(drawn.includes("MainA"), "and both teams are in them");

  await drawTimes({ courts: 4 });

  const rows = await orderRows();
  ok(rows.length === 2, `two matches to play, one per category (got ${rows.length})`);

  const mainTimes = await timesFor("Main");
  const mixTimes = await timesFor("Mixed");
  ok(mainTimes.length === 1 && mixTimes.length === 1,
     `each category got one time (${mainTimes.length} / ${mixTimes.length})`);
  ok(
    mainTimes[0] !== mixTimes[0],
    `the shared player is not drawn twice at once (${mainTimes[0]} vs ${mixTimes[0]})`,
  );
  ok(
    mainTimes[0] === "09:00",
    `and the day still starts when the organiser said (${mainTimes[0]})`,
  );

  /* ── the control: two different people ───────────────────────────────── */
  console.log("\n== the control: two different people, same two categories ==");

  const slug2 = await createTournament(p, `No Clash ${stamp}`, { format: "Standard" });
  await addCategory("Mixed");
  await addTeam("MainA", "Main");
  await addTeam("MainB", "Main");
  await addTeam("MixA", "Mixed");
  await addTeam("MixB", "Mixed");

  await addPlayer("MainA", `Asha ${stamp}`, `0333${stamp}`);
  await addPlayer("MixA", `Bilal ${stamp}`, `0444${stamp}`);
  await addPlayer("MainB", `Chand ${stamp}`, `0555${stamp}`);
  await addPlayer("MixB", `Devi ${stamp}`, `0666${stamp}`);

  await drawGroups("Main");
  await drawGroups("Mixed");
  await drawTimes({ courts: 4 });

  const mainTimes2 = await timesFor("Main");
  const mixTimes2 = await timesFor("Mixed");
  ok(
    !!mainTimes2[0] && mainTimes2[0] === mixTimes2[0],
    `four different people play at once on four courts (${mainTimes2[0]} vs ${mixTimes2[0]})`,
  );

  /* ── a knockout is never drawn before the group it comes from ────────── */
  console.log("\n== a final cannot be scheduled before its group ==");

  await p.goto(`${BASE}/t/${slug2}/manage`);
  await p.waitForTimeout(700);
  await drawCard("Main").locator('button:has-text("Draw knockout")').click();
  await p.waitForTimeout(1400);
  await drawTimes({ courts: 4 });

  const withKo = await orderRows();
  const groupRow = withKo.find((r) => /Group/i.test(r[3]) && r[2] === "Main");
  const koRow = withKo.find((r) => /Final/i.test(r[3]) && r[2] === "Main");
  ok(!!groupRow && !!koRow, `both a group match and a knockout are on the sheet (${withKo.length} rows)`);
  if (groupRow && koRow) {
    ok(koRow[0] > groupRow[0], `the final is after its group (${groupRow[0]} then ${koRow[0]})`);
  }

  /* ── what the players actually see ───────────────────────────────────── */
  console.log("\n== the times reach the pages people read ==");

  await p.goto(`${BASE}/t/${slug2}`);
  await p.waitForTimeout(800);
  const publicBody = await text(p);
  ok(/\b09:00\b/.test(publicBody), "the public page shows the start time");
  ok(/Ct\s*\d/.test(publicBody), "and which court");

  await p.goto(`${BASE}/t/${slug2}/print?blank=1`);
  await p.waitForTimeout(900);
  const printBody = await text(p);
  ok(printBody.includes("Order of play"), "the print pack leads with the order of play");
  ok(/\b09:00\b/.test(printBody), "with the times on it");
  ok(
    printBody.includes("Times are when a match is due to START"),
    "and says what the times mean",
  );

  /* ── getting it to the players ───────────────────────────────────────── */
  console.log("\n== sharing ==");

  await p.goto(`${BASE}/t/${slug2}/manage`);
  await p.waitForTimeout(800);

  const share = await p.getAttribute('a:has-text("Send on WhatsApp")', "href");
  ok(share?.startsWith("https://wa.me/?text="), "there is a WhatsApp link");
  const message = decodeURIComponent((share ?? "").split("text=")[1] ?? "");
  ok(message.includes("09:00"), "the message carries the order of play");
  ok(message.includes(`/t/${slug2}`), "and a link back to the event page");

  /* Fetched rather than clicked: a download in a headless browser is a fight,
     and what matters is that the route returns a real CSV. */
  const csv = await p.request.get(`${BASE}/t/${slug2}/schedule.csv`);
  ok(csv.ok(), `the CSV route answers (${csv.status()})`);
  ok(
    (csv.headers()["content-disposition"] ?? "").includes(".csv"),
    "and offers it as a file rather than a page",
  );
  const body = await csv.text();
  ok(body.includes('"Time","Court","Category"'), "with a header row");
  ok(body.includes("\r\n"), "and CRLF line endings, for Excel");
  ok(body.charCodeAt(0) === 0xfeff, "and a BOM, so Excel does not mangle the names");

  /* ── taking the times back off ───────────────────────────────────────── */
  console.log("\n== clearing ==");

  await p.goto(`${BASE}/t/${slug2}/manage`);
  await p.waitForTimeout(700);
  await p.click('button:has-text("clear the times")');
  await p.waitForTimeout(2200);
  /* Asserted on the table rather than on a regex over the whole page: the start
     time stays in the form's own input, as it should, and searching the body
     text for "09:00" was reading that back as a leftover. */
  const clearedRows = await orderRows();
  ok(clearedRows.length === 0, `the times are gone (${clearedRows.length} rows left)`);
  const cleared = await text(p);
  ok(cleared.includes("Draw up the times"), "and the control is still there to redo it");

  console.log("\n== errors ==");
  const bad = realErrors(errs);
  ok(bad.length === 0, `no runtime errors: ${JSON.stringify(bad.slice(0, 3))}`);
} finally {
  await b.close();
}

ok.done("order of play");
