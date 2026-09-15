# RISE Sports — project guide for Claude Code

A multi-sport community platform: tournaments, community games, player ratings, and venue
bookings. Ships as **one self-contained offline HTML file** (React inlined, no network needed)
hosted on GitHub Pages / Vercel.

Formerly **Pickle Rank**. Renamed to RISE Sports on 2026-08-27, at which point the app also
stopped being pickleball-only. RISE is the parent brand — the rating is **RISE Rating**, the
community-session certification is **RISE Certified**.

## Location and repo

Local working copy: `C:\Users\khanf\Tournament App\Tournament App` (moved off Google Drive on
2026-08-27 — Drive sync races with the build, which rewrites several large HTML files on every
run, and can duplicate them under a `(1)` suffix mid-write).

**Repo: <https://github.com/FaisalRISE/RiseSports>** (public, `main`).
**Host: Vercel** — live at <https://rise-sports.vercel.app>. Team `FaisalRISE` (`rise18`,
hobby), project `rise-sports`, auto-deploys on every push to `main`.

> The Vercel MCP tools cannot see this project (`list_projects` returns empty, `get_project`
> 404s) because a hobby "team" is really a personal account wearing a team id. The project was
> imported from the dashboard and works fine — verify deploys via the GitHub deployments API
> or by fetching the URL, not via the Vercel MCP tools.

### The repo is PUBLIC — what must never be committed

`.gitignore` excludes `Format/` and `Files for claude code/` because three files in them carry
live credentials:

| File | Secret |
|---|---|
| `Format/OSL-2026-tournament-app_24.html` | Supabase anon JWT — public by design, see below |
| `Format/pickleboss 9.html` | Supabase anon JWT — public by design, see below |
| `Files for claude code/claude-code-brief.md` | Supabase key in plaintext (`:63`) |

**`ADMIN_DEFAULT` is gone from both apps as of 2026-09-14.** They used to ship an organiser
password baked into the HTML — readable by anyone who opened the file, and the starting point
for every new event, so rotating it inside a running event protected that event and nothing
else. Neither app ships one now: an event with no password asks the organiser to choose one the
first time somebody signs in, and only that one works from then on. Nothing secret is left in
either file, so there is nothing to leak the next time one is shared.

- Events already running are untouched — they have a stored hash and every path prefers it.
- **The load-bearing guard is the sync pull before the door opens.** Without it, a phone that
  has never synced would see no password on an existing event and be offered the chance to set
  one. `openAccess` (pickleboss) and `askScorer` (OSL) now pull the event's real settings
  first; verified against the live backend by clearing local storage and watching the hash
  arrive from Supabase instead of the "choose a password" form appearing.
- Verified in a browser for both apps: a new event refuses a password under 6 characters and a
  mismatched confirmation, accepts a good one, then asks for *that* one afterwards — and the
  old shipped password no longer works.

They are reference material, not build inputs, so excluding them costs the build nothing, and
they still exist on local disk. **A committed secret is not removed by deleting it later** — it
stays in history and must be treated as compromised. Before any commit that adds files, check
the staged tree, not just the working tree:

    node tools/scan-staged.js

> **The check used to BE the leak.** Until 2026-09-14 this line was a pair of `git grep`
> commands with the secrets written out as the search terms — including the organiser password
> in full. CLAUDE.md is committed to a public repo, so the instruction for keeping secrets out
> of the repo was itself publishing one, in the file everyone opens first. It had been there
> since `fde7431`.
>
> Rewriting it here did not unpublish it, so it was **rotated on 2026-09-14** (see the
> `Format/` note below). The scanner now reads its patterns from
> `tools/secret-patterns.local.json`, which is gitignored — a check for secrets cannot itself
> be allowed to contain them. A never-committed file is the only safe place for the needles.
>
> **Only list a secret that could plausibly end up in a file in this repo.** Every entry is a
> plaintext copy of a secret written to disk, so it has to be guarding against something that
> can actually happen. The organiser passwords were listed and then removed the same day: once
> they no longer shipped inside the `Format/` apps there was nothing in the project to find, so
> listing them wrote two passwords to disk in the clear to prevent something that could no
> longer occur — the exact failure the file exists to stop. The Supabase DB password stays; it
> goes into `DATABASE_URL` and genuinely can be committed by accident.
>
> **There is exactly ONE patterns file and `scan-staged.js` creates it on first run.** There
> used to be a committed `secret-patterns.example.json` to copy from, and a live database
> password was typed into *that* one instead of the gitignored copy — two files one word apart,
> one tracked and one not, is a trap. Caught before any commit, but only by luck. Do not
> reintroduce a template file beside the real one.

An older copy may still sit at `G:\My Drive\Faisal\AI\Sport\Tournament App`. It is stale — do
not edit it, and do not copy it back over this one.

## Files

| File | Purpose |
|---|---|
| `app.source.js` | **The app. Edit this.** Readable pre-compiled React (uses `React.createElement`, no JSX). ~11.3k lines. |
| `rise-sports.html` | The deliverable, and the shell. React 18 + ReactDOM inlined in the first 3 `<script>` blocks; the app in the last one. The build replaces **only** the last block — `<head>`, `<style>`, favicon and loading screen live here and are edited by hand. |
| `pickle-rank-offline.html` | **Generated compat copy** under the old filename, so existing links do not 404. Delete it and `COMPAT_COPY` in `build.js` once the rename has shipped. |
| `build.js` | Rebuilds the HTML: validates `app.source.js`, splices it into the last `<script>` block, writes both outputs. `node build.js` |
| `tests/` | Node unit tests. `node tests/run.js` runs every `*.test.js`. |
| `tools/` | `serve.js` (local HTTP server — required for PWA/storage testing), `make-icons.js` (generates `icons/*.png` from code). |
| `manifest.webmanifest`, `sw.js`, `icons/` | **Generated** by `node build.js` / `node tools/make-icons.js`. Do not hand-edit. |
| `Format/` | Ten standalone prototype apps (vanilla JS) being folded into the main app. Reference, not build inputs. |
| `Files for claude code/` | Specs and roadmaps. See the conflict note below. |

Workflow: edit `app.source.js` → `node build.js` → `node tests/run.js` → open `rise-sports.html`.

## Which spec wins

`Files for claude code/CLAUDE.md` describes a **different plan** — a Next.js + Supabase rewrite,
pickleball-only, with multi-sport and the auction module listed as out of scope. That plan was
**not** adopted. **This file is authoritative.** The August specs remain useful for the feature
detail they contain (rating algorithm, matchmaking, registration, venue booking); treat their
architecture and scope sections as superseded.

Three deliberate reversals, decided 2026-08-27:
- ~~**Stay single-file**, do not rewrite to Next.js~~ — **REVERSED 2026-08-29, see below.**
- **Go multi-sport**, including the OSL board games.
- **Capacitor** for mobile, not Expo — Expo would mean rebuilding the whole UI. Still holds:
  Capacitor will wrap the Next.js app instead of the single file.

## Architecture reversal (2026-08-29): Next.js after all

The 2026-08-27 decision to stay single-file is **reversed**. The rebuild lives in `web/`
(Next.js 16 App Router + TypeScript, Supabase Postgres); see `web/README.md`.

**Do not treat this as drift.** The earlier decision was correct on the evidence it had. It
weighed exactly one thing — the multi-device gap — and concluded that Supabase sync solved it
more cheaply than a rewrite. That reasoning still stands on its own terms.

What changed is that a requirement was added on 2026-08-29 that the earlier decision never
considered:

> "easy to maintain, **hard to copy the codes**, and can handle massive traffic"

A self-contained HTML file ships its entire source — scoring engine, rating algorithm, auction
rules — to every visitor. View Source is a complete, runnable copy of the product, and
minification does not change that. Supabase sync does not address it, because it is not a data
problem. If the code is meant to be defensible, the valuable logic has to run somewhere the
browser never sees, and that means a server. Server-rendered pages with edge caching are also
the ordinary answer to heavy read traffic, and a typed modular codebase is easier to maintain
than 13.3k lines mixing minified single-letter locals with readable ones.

Consequences for anyone working in this repo:

- **`rise-sports.vercel.app` serves `web/`, deliberately, from 2026-09-13.** The 2026-08-31
  cutover was reversed on 2026-09-01 because serving `web/` took community play, venues, the
  ledger and Americano/Mexicano off the live site and Faisal had only asked for the tournament
  side to be upgraded — the consent for that was one line in a long plan document, which is
  not consent. He then chose on 2026-09-13 to have the rebuilt app live while the rest is
  ported. **Root Directory `web`, Framework Preset Next.js.**
- **Twelve days of failed builds, and what they teach.** Every deploy from 2026-09-05 to
  2026-09-13 FAILED, so nothing pushed in that window ever reached the site and it served the
  31 August build throughout. The cause:

      No Next.js version detected. … Also check your Root Directory setting
      matches the directory of your package.json file.

  Root Directory had been emptied (which DID save) while Framework Preset stayed **Next.js**,
  so Vercel ran `next build` against a directory with no `package.json`. It failed in three
  seconds every time. **Those two settings must agree**: repo root ⇒ `Other`; `web` ⇒ `Next.js`.
  - **A 404 does not tell you what the settings are.** This note previously concluded "Root
    Directory is still `web`" from `/rise-sports.html` returning 404. That was wrong. A 404
    only proves *no newer build has succeeded* — with builds failing, the old deployment keeps
    serving whatever it was built from, so the URL says nothing about current settings.
  - **Check the build result, not the page.** The GitHub deployments API works for this repo
    even though the Vercel MCP 404s on hobby projects:

        curl -s "https://api.github.com/repos/FaisalRISE/RiseSports/deployments?per_page=5"
        curl -s "https://api.github.com/repos/FaisalRISE/RiseSports/deployments/<id>/statuses"

    A `failure` state there explains any amount of "my change did not appear". The build log
    itself needs the dashboard.
  - **`vercel.json` is only read when the build root IS the repository root**, which is why a
    fault in it can sit unnoticed for months. It is strict JSON: unknown keys are rejected
    outright (`should NOT have additional property …`), so there is no way to leave a comment
    in it. Its `source` patterns avoid unnamed capture groups — `(.*)`, `(a|b)` — which newer
    path-to-regexp rejects; every source is a literal path instead.
- **The direction is still `web/`, but as ONE app, not a replacement.** Confirmed by Faisal on
  2026-09-01: the code must stay hard to copy, this is a business, any organiser in India may
  use it, and the target is thousands of players across ~50 tournaments — none of which a
  single self-contained HTML file can serve. So `web/` absorbs community play, the social
  formats, venues and the ledger, and only then takes the address. Order of work and the
  answers behind it: `.claude/plans/i-want-to-develop-stateful-pascal.md`.
- **Ask before changing anything the user can see.** Standing agreement, 2026-09-01: the
  interface, which app the address serves, or any feature already in use — one plain question,
  wait for a yes. Not a line item inside a plan.
- **Empty commits may not trigger a Vercel build.** "Skip deployments when there are no changes
  to the root directory" is on, and an empty commit changes no files. To force a rebuild, touch
  a real file under the build root.
- The new app uses the **same Supabase project** (`utfvjsvvbifwcektzrwj`) as the legacy
  per-event `Format/` apps, on its own tables — no name collides with `osl_live`,
  `live_scores` or `app_backups`. Neon was briefly used during development and is gone; it was
  an unnecessary second vendor, and its HTTP driver could not open a transaction (see
  `web/README.md`). It connects through the **transaction pooler**, port 6543.
  - **Its tables have RLS on and no policies**, which shuts Supabase's public PostgREST API
    off entirely — `people` holds names and phone numbers, and the anon key is published in
    the old app's HTML. The app is unaffected because it connects as the table owner, and
    owners bypass RLS. The linter's "RLS enabled, no policy" notices are the intended
    state. Adding a policy would *open* those tables to the world; don't, without deciding
    what should be public.
  - **`drizzle-kit generate` does NOT emit row-level security, and a new table defaults to
    RLS off.** Supabase grants `anon` full SELECT/INSERT/UPDATE/DELETE on everything in
    `public`, so a table drizzle creates is readable *and writable* by the published anon key
    until RLS is turned on by hand. This is not hypothetical: applying `0006` created the six
    community tables wide open, and `0008` closed them.
    **Every new table needs its own `ENABLE ROW LEVEL SECURITY` line in the SAME migration
    that creates it** — a gap between CREATE and ENABLE is a window where the table is
    world-writable. Nothing breaks when it is missing: no error, no failing screen, only the
    absence of a linter notice.
  - **The migrations did not reproduce production's RLS at all until `0010`.** Every table
    from `0000`-`0005` had it in production, applied by hand in the console and never written
    down, so `pnpm db:setup` against a fresh database produced fourteen wide-open tables.
    Nothing was exposed in production; the hole was in what the repo could rebuild, which
    surfaces the day somebody stands up a second environment and assumes it matches.
  - The guard is a test in `schema.test.ts` over **every** table, not over the prefix that
    broke last time — the narrow `community%` version would never have found the fourteen.
    `osl_live` / `app_backups` / `live_scores` are excluded **by name** because they reach
    PostgREST on purpose and carry their own policies.
  - **A hand-written migration makes drizzle renumber on top of itself.** `0008_community_rls`
    was not in `meta/_journal.json`, so the next `generate` also produced an `0008`. Add every
    hand-written file to the journal.
  - **After applying a migration to production, verify by querying**, not by assuming the
    apply succeeded: `list_tables`, then `relrowsecurity` and the `anon` grants. To prove a
    table is really shut, insert a row as the owner and re-read it under `set local role anon`
    — owner sees 1, anon sees 0.
  - **`pnpm db:generate` writes the file; something still has to apply it to Supabase.** A
    deploy can go green with the code live and the tables absent — that is what a 500 on
    `/play/[slug]` with a working `/play` meant.
- Domain logic was **ported, not rewritten**. `web/src/lib/` carries the scoring engine, sports
  registry, ledger money engine and rating engine across, with the legacy engine extracted by
  text from `app.source.js` and used as a differential test oracle. Two deliberate behaviour
  changes are documented in `web/README.md`: the rating conservation fix, and `rallyStats`
  going from O(n²) to O(n).
- The OSL Rules v4.8 team format (three pairs, rotation at 7 and 14, first to 25) is now a
  format module, `web/src/lib/formats/osl.ts`, rather than a separate event app.

Also superseded: the note above that `Files for claude code/CLAUDE.md` "was not adopted". Its
**architecture** section (Next.js + Supabase) is now what was built. Its scope section still
is not — multi-sport and the auction module are in scope.

## Critical constraints

1. **Never put a literal closing script tag inside the source** (strings included) — it
   truncates the HTML. `build.js` rejects the build if found. Escape the slash in strings if
   ever needed.
2. **No JSX, no imports.** The file is plain ES2022 executed directly in a `<script>` tag.
   `React`/`ReactDOM` are globals; hooks are destructured at the top.
3. **Variable names are minified** (single letters) in older code because the source was
   recovered from a minified build. Newer features use readable names. Both styles coexist —
   match whatever the surrounding code does and be careful with scope collisions
   (prefer suffixed names like `catName4`, `res2` in new code).
4. **localStorage is the database.** Hosting a new HTML version does NOT reset users' data —
   their browsers keep old localStorage. Migrations must be defensive (`x.field || default`).
   There is no schema version field; `|| default` on read is the only resilience pattern.
5. **Self-contained — no network at load.** No CDN scripts, no external images, no icon files.
   The favicon is an inline SVG data URI. Keep it that way.

## Architecture (top → bottom of app.source.js)

- **Storage keys** — `PREFIX` + `lsKey(name)` at the top of the file. Every key goes through
  `lsKey()`. A one-time `migrateLegacyKeys()` shim copies the old `pr9_*` keys to `rs_*`; it
  never overwrites existing data and is safe to delete a release or two from now. It also
  clears a stray `"undefined"` key that builds between the rebrand and 28 Aug wrote.
  - **Never give a module-level helper a 1–2 character name.** This helper was briefly called
    `K`, which is exactly the convention this file uses for minified *locals* — `RiseSports`
    binds `K` as `setCommunityGames`, so every load and save silently broke. See Known
    gotchas. `tests/shadowing.test.js` now enforces the rule.
- **`SPORTS` registry** — everything sport-specific in one object: `playersPerCourt`,
  `formats`, `scoring`, `serveModel`, 13 `skills`, 15 `tags`, plus `court` ("court"/"table"/
  "board"). Seven sports: `pb bd tt pd tn cr ch`. `DEFAULT_SPORT = "pb"`.
  - Accessors: `sportOf(x)` (takes an id or any record with a `.sport`; defaults to
    pickleball), `skillsFor`, `tagsFor`, `formatsFor`, `fmtLabel`.
  - **Rating keys are sport-namespaced**: `"pb:md"`, built by `ratingKey(sport, format)`.
    `rtg(player, format, sport)` reads namespaced → old flat key → `bestRating`.
    `rtgIn(...)` is the strict variant: namespaced → flat → **0**, no `bestRating` fallback.
    Use `rtgIn` anywhere a `> 0` test means "plays this format" — `rtg` there would make every
    player look like they play everything.
  - `migrateRatingKeys()` rewrites flat keys to namespaced in place. Deliberately **not**
    gated behind the migration flag, because someone may import an old backup at any time;
    it is a no-op once converted.
  - `SKILLS` / `TAG_PRESETS` are now bindings to the default sport's arrays, so the ~12
    existing call sites did not change.
  - `bestRating` is `max()` across **all** sports. Fine for seeding and display today; revisit
    if a chess rating ever needs to stop flattering a pickleball draw.
- **Live scoring engine** — `replayRallies(match, rules)` is the heart of referee mode. The
  match's rally log (`m.log`, one entry per rally, `"a"`/`"b"` for whoever WON it) is the only
  stored state; score, serving side, player positions and service box are all derived by
  replaying it. Undo is therefore just "drop the last entry", the display can never disagree
  with the court, and only the log needs to travel when devices sync.
  - `resolveRules(sportId, overrides)` merges the sport's `scoring` block with per-tournament
    overrides (`pointsToWin`). Returns **null** for tennis/padel — they are scored by games and
    sets, and this console does not cover them.
  - Serve models: `sideout` (pickleball — **only the serving side scores**; the opening service
    turn has one server, so the first fault sides out immediately), `rally` (badminton),
    `alt2` (table tennis — serve every 2 points, every point at deuce), `turns` (board games).
    **The registry's value is `alt2`, not `every2`** — the engine once checked the wrong string
    and table tennis silently served to the rally winner. `tests/scoring.test.js` pins it.
  - `rallyOver` / `rallyGolden` / `rallyGamePoint` / `rallyStats` (serve-hold %, clutch splits).
- **Match timer** — `timerStart/Pause/Resume/Stop/Elapsed`, per `match-timing-spec.md` v2.0.
  Uses `performance.now()`, **never** a difference of wall-clock stamps: a device that sleeps
  or re-syncs its clock mid-match would otherwise report nonsense. One record per match, no
  aggregates, and no feed into the rating — the spec is firm about that.
- **Court Ledger** (`LedgerTab`) — shared-expense tracking, on its own nav tab.
  - The money engine is `lib/finance.ts` from the Next.js ledger, ported verbatim
    apart from the TypeScript: `ledgerShares/OwedMap/Balances/Pairs/SettleUp/For` plus
    `ledgerMoney`/`ledgerPaise`. It was portable precisely because it is pure — no Prisma,
    no React. **Amounts are integer paise, never floats**: ₹1000 split 3 ways is
    33333+33333+33334 with the odd paise to the payer, so a book sums to exactly what
    was spent. `tests/ledger.test.js` pins the invariants (balances sum to zero; applying
    the settle-up plan zeroes everyone; circular debt needs no transfers).
  - The UI is rebuilt against RISE's architecture — localStorage under `rs_ledger`,
    `React.createElement` — because the rest of that app (Next.js, Postgres, NextAuth, S3)
    cannot live in a single offline HTML file. An earlier attempt embedded the older
    standalone `Uploads/index.html` in an iframe; that is gone.
  - **No sign-in while this is a prototype.** "You" is the member flagged `me`, switchable
    from the Members tab, which is enough to see the book from any side. Payments still
    land as PENDING and need the recipient to confirm, so one side cannot clear a debt
    alone.
- **`RefConsole` + `CourtBox`** — the referee UI, laid out after
  `Format/pickleboss-35split 12.html:965-1065`, which was built for and used at real events.
  The load-bearing idea there is that **the court is the input**: a referee standing courtside
  taps the half belonging to the side that won the rally, rather than hunting for a labelled
  button. Service boxes show who stands where ("Right / even"), the ball marks the server, and
  a +/- row underneath is the fallback for corrections. "Flip my view" matters more than it
  looks — the referee may be at either end, and a court drawn the wrong way round guarantees
  mis-taps.
  - Rendered as a sibling of the two score modals in `TourneyTab`. Typed entry stays the
    default; refereeing is another route to the same number, and `onFinish` fills the *same two
    inputs* the typed path uses — so there is exactly **one** save path and no duplicated
    rating or bracket-advance logic.
- **Scoring rules per tournament** — `buildScoring(target, winBy2, goldenAt, switchAt)` turns
  the CreateTab controls into the `{winBy, golden, cap, switchAt}` override `resolveRules`
  already understood. Models the pickleboss rule set exactly: to 15, win by 2, the two-point
  rule stopping at 17, cap 18. `goldenInfo()` states it back in plain English under the
  controls so it cannot be misread.
- **Print pack** — `printPack(tourney, withData, only)` fills the hidden `#printArea` and calls
  `window.print()`; the browser's own "Save as PDF" does the rest. Deliberately **not**
  `window.open` — popups are blocked on the phones organisers carry.
  Laid out after the OSL 2026 sheets: **one page per group**, carrying fixtures, standings and
  the score-margin grid together, so a blank print-out is enough to run and settle a group by
  hand at the court.
  - Matches are **rows in one table**, not a table each, and the explanatory caption appears
    **once** under the table rather than under every match. Getting that wrong is what made the
    first attempt unusable.
  - `marginGrid` finds the diagonal by POSITION, not by the cell being null — an unplayed match
    is null too, and `indexOf(null)` would shade the wrong cell.
  - The `@media print` rules live in `rise-sports.html`, not in the palette.
- **Palette `C`** — every color flows through this object (currently a light theme).
  Re-theming = editing `C` + the two `<style>` blocks in `rise-sports.html`.
- **`ROLES`** — PLAYER(1) / ORGANIZER(2) / ADMIN(4); persisted in `rs_r`; switcher on Home.
  Note this is cosmetic — nothing stops a user setting themselves to ADMIN. PIN-gated roles
  are planned (see Roadmap 0.3).
- **Top-level helpers** (pure, unit-testable — keep them pure):
  - `checkEligibility`, `calcRtgChange` — the rating engine. **`calcRtgChange` has a known
    conservation bug** — see Known gotchas.
  - `buildTimedSchedule` — cross-category clash-free scheduler (greedy slot fill; a player in
    two categories never gets overlapping match times; respects court count).
  - `seedOrder`/`seedBracket` — standard tournament seeding with byes auto-advanced.
  - `buildLoserBracket`/`advanceDE` — **double elimination** routing (WB/LB/Grand Final).
    WB round-0 losers pair in LB0; later WB losers drop into odd LB rounds as `p2`;
    LB even-round winners keep their index, odd-round winners pair up. Requires 4/8/16 teams.
  - `genAmericanoRound`/`chunkCourts` — Americano (rotation) / Mexicano (points-sorted) rounds.
  - `leagueStandings`, `scheduleRows`, `exportScheduleCSV/PDF`, `shareWhatsApp`,
    `genHalfHourSlots`, `teamPlayerIds`, `teamName`.
- **UI primitives**: `Ic` (icon set), `Badge`, `Modal`, `Btn`, `Input`, `Select`,
  `RadarChart` (13 skills, edge-anchored labels), `PlayerSearchSelect`, `CategoryCreatorModal`.
- **Tabs**: `RegisterTab`, `CreateTab`, `TourneyTab`, `TournamentListTab`, profile/leaderboard,
  `HomeTab`, `AdminTab`, `CommunityTab` (+ `VenuesSection`), wired in the root `RiseSports`.
- **Nav**: array `D` in `RiseSports` — `{id, l, i}` per tab, with `admin` pushed conditionally.
  Adding a tab = one entry in `D` + one clause in the `e === "<id>" &&` chain. Note `tourney`
  is routable but has no nav entry; it is reached via `setTab("tourney")`.

## Data model (localStorage keys — all via `K()`)

- `rs_pl` players — ratings per format + `bestRating`, `skills` (13 keys), `medals`
  `[{type, tournament, category, year}]`, `matchHistory` (has `date` since v3),
  `partnerStats`, `duprRating`/`duprReliability`/`duprLastUpdated`.
- `rs_t` tournaments — `tourFormat`: `group_ko | league | single_elim | double_elim |
  americano_t | mexicano_t`. **`knockoutBrackets`, `champions`, `loserBrackets`,
  `grandFinals`, `thirdPlace` are keyed by CATEGORY INDEX (0,1,…), not category id.**
  Groups link to categories via `catId`/`catName`. Elim + americano formats store
  `groups: []` (a stub group is synthesized in `TourneyTab` so the view renders).
  Americano state lives in `t.americano = {players, points, games, rounds}`.
- `rs_cg` community games — `accessType` open/restricted (+`members`/`joinRequests`/
  `invites`), `rotation`: `fixed | rotate | slots | kotc | ladder`.
  Sessions keyed by ISO date; `sess.slotData` (30-min reservations), `sess.kotc`
  (`{courts,bench,crowns,round}`); ladder lives on the game (`ladderOrder`, `ladderLog`).
- `rs_venues` — venue listings + booking requests (payments handled off-app by design).
- `rs_u` current user, `rs_r` role, `rs_migrated` migration flag.

## Supabase backend

Project `utfvjsvvbifwcektzrwj` ("Rise Sports", ap-south-1). Shared by the legacy `Format/`
apps and, from Wave 0.3, by RISE Sports itself. Rows are namespaced by an event code:
`<event>:<kind>:<id>`.

**Tables:** `osl_live` (live state, one row per match/nomination/config), `app_backups`,
`live_scores` — all three belong to the legacy apps and everything below describes them.

The Next.js app added **14 tables of its own** here on 2026-08-31 (`tournaments`, `people`,
`players`, `teams`, `matches`, `registrations`, `rating_history`, …). They share nothing but
the project: different access path (a pooled Postgres connection as the owner, not PostgREST),
different lock (RLS on with no policies, so the anon key cannot reach them at all), and no
`osl_put`. Schema is `web/src/lib/db/schema.ts`; migrations are `web/drizzle/*.sql`.

**Write path — locked down 2026-08-28.** All writes go through the `osl_put` RPC, which
enforces the Lamport counter the clients keep (`where excluded.rev >= l.rev`) so a stale
device can never roll a row backwards. The table's blanket `anon` INSERT/UPDATE policies were
dropped, because a direct `PATCH /rest/v1/osl_live` bypassed that guard completely — including
on the `:cfg` rows that hold the organiser password hash. `osl_put` is `SECURITY DEFINER`
(with `search_path` pinned to `''`) so it still works with the policies gone.

- **Reads stay open** (`osl_live_select`, `anon`) — devices and spectators read the table
  directly. Only writes are funnelled.
- Verified as an anonymous client: read 200, direct PATCH affects 0 rows and leaves the row
  untouched, direct INSERT 401, `rpc/osl_put` 200.
- Supabase's linter warns that `osl_put` is an anon-callable `SECURITY DEFINER` function.
  **That is the intended design**, not a defect — the whole point is that the table is closed
  and one narrow, rev-guarded RPC is the only way in. Do not "fix" it by reverting to
  `SECURITY INVOKER`; that would require reopening the table.

**The anon key is public by design** and appears in the shipped HTML. It identifies the
project, it does not authenticate anyone — all of its power comes from the policies above.
Rotating it therefore buys nothing on its own and breaks every deployed copy; tighten policies
instead. The real secret was the organiser password (`ADMIN_DEFAULT`), which is why those
files stay out of the public repo.

## Community play in `web/` (started 2026-09-14)

The legacy `CommunityTab` (`app.source.js:9221-11651`) is being ported. Full feature-by-feature
inventory of the whole app — 287 legacy features, each with a line number and a port verdict —
is the artifact published on 2026-09-14; 209 remain, of which 5 are large.

**It has its own tables, and that is deliberate.** `community_games`, `community_sessions`,
`community_attendance`, `community_members`, `community_matches`, `community_byes`. A
tournament has teams, groups, a draw and one date; a community game has none of those and has
instead a repeating schedule, a roster where a person sits in one of five states, per-person
payment, and four ways of deciding who plays whom. Reusing `tournaments` would mean nullable
`divisionId`/`teamId` everywhere plus a kind check in front of every query — undoing the guard
migration 0005 exists to add.

- **Community play is where ratings actually move.** The legacy app applies a rating change on
  every community score (`app.source.js:9254`), so it is the main source of rating movement,
  not tournaments. `rating_history.match_id` therefore lost NOT NULL and gained
  `community_match_id` beside it, with a **hand-written CHECK** (not generated by drizzle) that
  exactly one is set — the loosening would otherwise admit a row referencing nothing, which is
  a rating that moved with no record of what moved it.
  - Repeat-opponent damping (§8) counts community meetings too. The same four friends at the
    same court every Thursday is precisely the farming that rule exists to damp.
- **`genSessionDates` has a timezone bug that is NOT ported.** It walks local midnights, tests
  `getDay()` against the chosen weekdays, then stores `toISOString().slice(0,10)`. Those
  disagree east of UTC: at local midnight in India the UTC instant is still 18:30 the previous
  day, so a Monday game matches Monday and stores Sunday. Every Indian user sees the date strip
  a day back. `lib/community/localISO` formats the local Y-M-D directly; tests pin it, and fail
  only under `TZ=Asia/Kolkata` — which is why nobody working in UTC would ever have caught it.
- **`people.dob`** was added because an age restriction cannot be evaluated without it. An age
  rule on a player with no date of birth **fails closed** — failing open would quietly admit
  exactly the people the rule exists to exclude.
- **`lib/community/me.ts` is the first "who is holding the phone" in the app.** The tournament
  side is organiser-facing and never needed one. It is a cookie plus a picker: it **identifies,
  it never authorises**. Host-only actions check `communityGames.hostPersonId` via
  `lib/community/guard.ts`, never the cookie's claim about itself.
  - The Server Actions are split by **who the action is about**, not by a role flag. A player
    action reads the person id from the COOKIE and never from the form (a form field would let
    anyone withdraw anyone else); a host action takes the id from the form and goes through
    `hostGuard`. A flag is a thing every caller can get wrong.
- **`applyMatchRatings` was split, and the tournament path did not change.** `applyResult`
  (`lib/rating/apply.ts`) is the engine — carry guard, daily cap, repeat damping, imbalance
  ledger — and both tournaments and community play call it. Everything above the split is
  working out *who won*, which is genuinely different for a draw and for four names on a court.
  **Do not write a second applier**; a second copy of those rules drifts within a release.
- **One row per person per session, not four arrays.** The legacy roster keeps `interested` /
  `requested` / `confirmed` / `waitlist` as four arrays and resolves an overlap by priority
  (`ie` at `:10015`). A unique index makes overlap impossible here, so there is no priority
  rule to get wrong. Likewise `openSlots` — a mutable counter there (`:10019`) — is **derived**
  here as `min(withdrawn, capacity − confirmed)`; both terms are load-bearing, and breaking
  either fails a test.

### Two more legacy bugs found while porting, and deliberately not carried over

- **`buildCourts` benches people beside an empty court** (`:8883`). It counts only courts it
  can fill completely, so six players on two booked courts of four use ONE court and two people
  sit out all evening; seven bench three. The replacement uses as many courts as the players can
  cover, never leaving anyone alone on one: 6 → 3+3, 7 → 4+3, and 8 on four booked courts is
  still 4+4 rather than four thin courts of two.
- **Balanced and mexicano are opposites and easy to swap.** Both sort by rating; balanced
  snake-drafts so court totals match (close games), mexicano deals consecutively so the
  strongest four share a court (level-matched). Swapping them is invisible in the output shape.
  Pinned by tests that assert what each mode is *for*.

### The rotation modes (`slots`, `kotc`, `ladder`)

`lib/community/rotations.ts` holds all three as pure functions; `rotationsStore.ts` reads the
state, hands it to the engine and writes the result back in a transaction. Slots and KotC live
on the session (`slotData`, `kotc`); the **ladder lives on the GAME** (`ladderOrder`,
`ladderLog`) because it persists across dates, which is the whole point of a ladder.

- **A slot holds the whole venue**, not one court — it is a window of time across every booked
  court (`W` at `:10114`).
- **`kotcNextRound` returns its input unchanged** when a court has no winner yet. The store
  turns that into a refusal with a reason, because a silent no-op looks like success to
  whoever tapped the button.
- **"You may only challenge someone above you" lives in the engine, not the screen.** The
  legacy version swaps whatever two positions it is handed (`:10211`) and relies on the UI to
  prevent it, so any other path inverts the ladder silently.

### Invite-only games

`lib/community/membership.ts`. One row per person per game (`member` / `requested` / `invited`),
exclusive by unique index, mirroring the session roster. **An open game has no rows at all.**

- **The host is a member without a row** (`standingOf` short-circuits on `hostPersonId`), so
  removing the last member cannot lock the organiser out of their own game.
- **Membership is what gates signing up**, via `canJoinSessions` — and *asking* is not
  belonging: a pending request and an un-accepted invitation both stay out. Tested directly.
- **Removing a member does not delete their attendance.** A session they played is a record,
  and the ratings it moved point at it. Removal is about future dates.
- Two deliberate shortcuts: someone holding an invitation is told to accept rather than file a
  request, and inviting someone who already asked lets them straight in.

**Community play is complete** — all five stages shipped 2026-09-14. What is NOT ported from
the legacy Play tab, by decision: `Simulate interest` (demo seeding, obsolete) and the
player/organiser view toggle (real host detection replaces it). There is also **no edit-game
screen** — `accessType`, courts, days and price are set at creation only, which matches the
legacy app.

### Venues

`lib/venues/`, rendered on `/play` under the games — which is where `VenuesSection` sits in the
original (`app.source.js:11698`). Shipped 2026-09-14.

- **Payments are settled off-app by design.** The price is shown; nothing takes money.
- **Requests are unlimited; confirmations are capped at the court count**, counted inside a
  transaction. The legacy version checks neither and will confirm fifty bookings onto two
  courts (`:9155`).
- Only a booking with a linked person can be cancelled by the person who made it — a guest
  booking has nobody to prove ownership, so the venue host handles those.

### Court Ledger

`lib/ledger/store.ts` + `/ledger`, shipped 2026-09-14. Its own nav tab.

**Not a line of money arithmetic was written for it.** `lib/finance` already carried the engine
across from the standalone ledger app; the store's only job is to load a book into the exact
`LedgerBook` shape that engine takes. Every figure is a call into it, computed server-side and
handed down as formatted strings. **Do not recompute a balance anywhere else** — one engine,
one set of invariants.

- **`ledgerNet(m, a, b)` is how much A OWES B** (`ledgerOwedMap` keys as `m[debtor][creditor]`),
  so a POSITIVE net makes **a** the debtor. Taking it the other way rendered "You owes Nadeem"
  directly above "Nadeem pays You" — every amount correct, the direction inverted. Pinned by
  tests that assert the pair list and the settle-up plan agree about direction.
- **Payments land PENDING; only the recipient confirming moves a balance.** That is what stops
  one side clearing a debt by asserting they paid, and why `ledgerOwedMap` counts only
  CONFIRMED.
- Members are **not** rows in `people`: a book often includes a flatmate or a driver who settles
  up but never plays. `personId` links the ones who are players and is null for the rest.
- The category emoji and labels come from `LEDGER_TYPES` in one place — the picker briefly had
  its own copy and disagreed with the entries list.

### Scoring controls (2026-09-14)

`ScoringControls.tsx` + `setScoring` on the manage screen. Closes Stage 1 item 4: the engine and
the `tournaments.scoring` column had existed since the port, and nothing wrote the column.

- **`buildScoring` does NOT return `target`.** It uses the target to derive the golden point and
  cap, but in the legacy app the target travelled separately as `pointsToWin`. **Anything saving
  its output must add `target` back**, or `resolveRules` falls back to the sport default —
  an event set "to 15" silently plays to 11. `picklebossRuleOverrides` carries the same note.
  - Both functions were well tested alone; the bug lived in the seam, which nothing exercised.
    `organiserRules.test.ts` composes them, and pins the wrong behaviour too so the reason stays
    visible. Found by *playing a match*, not by a test.
- `goldenInfo` restates the rules in one sentence under the controls, computed **server-side**
  via an action — it lives behind `import "server-only"` and the rules must not ship.
- `rulesFor` prefers a FORMAT PRESET over these overrides, so OSL and Pickleboss events say so
  rather than offering controls that cannot apply.

### The match clock (2026-09-14)

`lib/scoring/timing.ts`, stored in `matches.timing`. Spec: `match-timing-spec.md` v2.0.

- **Only accumulated milliseconds are stored**, plus a wall-clock `startedAt` used for ordering
  and never subtracted. The legacy record keeps `mono` — a raw `performance.now()` reading —
  and that cannot be ported: it is measured from one page load, so it means nothing once it has
  reached Postgres or been read on a second device. **Never persist a clock reading.**
- Every function takes its elapsed delta as an argument instead of reading a clock, so the
  arithmetic is pure and the only thing that becomes a duration is a difference between two
  `performance.now()` readings in one page session — which is what the spec demands.
- Server timestamps are the wrong answer here: a match scored offline would have its start
  stamped at reconnect.
- **The measurement belongs in `useOfflineScoring`, not in `scorePoint`.** For any sport the
  browser can score offline — pickleball, badminton, table tennis — the console NEVER calls
  `scorePoint`; every tap goes through the offline queue and `pushLog`. Wiring the timer to
  `scorePoint` alone records nothing, and nothing fails: the record exists with `playingMs: 0`.
  Found by reading the database after playing, not by a test.
- Deltas accumulate across taps and travel with the push that lands; a failed push puts its
  share back, so time is neither lost nor double-counted by a retry.
- The clock read sits at **module level** in both files — inside a component body React's purity
  rule cannot tell it is only called from an event handler.

### The referee console the clock unlocked (2026-09-14)

The live clock, pause/resume with reasons, the game-point warning, the +/− correction rows, the
pre-match setup panel, keep-screen-awake and the "reading the court" explainer. Closes the
console; the remaining port is engines, foundations and the UI kit.

- **The DEVICE splits the milliseconds, the record just adds them.** `Tick` carries `playMs`
  and `pausedMs` separately, and `addMeasured` is the only function in `timing.ts` that folds
  time in at all. The reason is the hall: a referee who pauses for an injury with no signal has
  a phone that knows the clock is stopped and a stored record that still says `running: true`,
  so routing by the record would bill the break as play. Pinned by a test named after exactly
  that.
  - `applyTick` is one call — fold, then flip — because the two correct calls written in the
    wrong order file the play BEFORE an injury as part of the injury. That mistake is tested
    too, so the reason stays visible.
  - So pause never fails: it takes effect on the device the instant it is tapped and the record
    catches up with the next write. A pause button that has to reach a server before the clock
    stops is a button that fails during an injury.
  - `pauseCount` moves on the TRANSITION, never on the reason — a referee reaching for
    "Injury" after "Timeout" is relabelling one break, not starting a second.
- **A once-a-second render killed the fifteen-second retry timer.** `useEffect(..., [flush])`
  tore the interval down and rebuilt it on every render, and the clock now renders every
  second, so it never reached fifteen. The queue then sat unsent until the referee happened to
  tap again. `e2e:offline` caught it — "the queue flushes with no user action" failed while the
  rallies were provably on the server. **Anything periodic in a client component must be pinned
  behind a ref**, as `flushRef` now is; and `useOfflineScoring` takes `claim`/`restore` out of
  the clock object rather than depending on the object, which is rebuilt every second.
- `lib/scoring/clock.ts` is the client-safe half — the record's shape, the pause reasons and
  `fmtClock`. The arithmetic stays in `timing.ts` behind `import "server-only"`. A clock that
  cannot tick in the browser is not a clock, and nothing in "12:05" is worth protecting.
- **`lib/scoring/rewind.ts` exists once and takes the score function as an argument.** "Take a
  point off them" is not "undo": under side-out several rallies pass without anybody scoring,
  so it rewinds to just before the rally that scored, discarding the side-outs after it. The
  server drives it with `replayRallies` and the browser with `replayLite`; written twice, the
  two would disagree within a release.
- **The pre-match panel is keyed on the LOG, not on whether the clock has started**, so the
  screen and `setMatchSetup` agree. The service sequence is DERIVED by replaying the log
  against "who served first", so changing that at 8–6 rewrites who was serving all game — but
  at 0–0 there is nothing to rewrite, including after a correction walks a match back, which is
  exactly when a referee notices the wrong side was marked.
- **Two taps in the same JavaScript tick collapse into one** — both handlers read the same
  `localLog`. Measured: 30ms apart both register, 0ms apart one does. Touch input cannot
  produce two events in one tick, so this is a property of scripted clicks, not a lost rally.
  Checked rather than assumed, because "a rally that looks saved and is not" is the one thing
  this console must never do.
- Verified end to end against the database: 11 rallies with one injury pause recorded
  `playingMs` 136,570 and `pausedMs` 26,782 — summing to the wall-clock span between
  `startedAt` and `endedAt` to the millisecond, with `pauseCount: 1` despite the relabel.

### The order of play (2026-09-15)

`lib/schedule/` + the manage screen, the public page and the print pack. This is item 5 of the
Stage 1 plan and the last of it to land: times and courts for every match still to be played.

- **The clash key is a PERSON, not a `players` row.** A human entered in Men's Doubles and Mixed
  is two teams and two player rows (`teams.divisionId` — "one person, two teams"). Keyed on the
  row, the scheduler puts them on two courts at 10:30 and every check passes. `busyKey` uses
  `personId`, and falls back to the **normalised name** when nobody linked a profile — chosen
  deliberately: two different Rahuls merged costs a slightly longer day, one Rahul missed puts a
  real person on two courts and is discovered by him standing there.
- **Dependencies are a constraint, not a tiebreak.** The legacy `buildTimedSchedule`
  (`app.source.js:666`) sorted by an integer round and used it as a preference, so a knockout
  could be placed before the group feeding it whenever the group matches happened to clash. Here
  the wait is already written down — a knockout slot is a seed reference — so `dependsOn` carries
  real match ids and a match is not eligible until every one of them sits in an EARLIER slot.
  `lib/schedule/store` reuses **`resolveRef`** with a resolver that answers in dependency keys,
  rather than parsing the reference grammar a second time.
- **Termination is argued, not hoped for**: within a slot the first candidate cannot clash
  (nobody is on court yet), and an acyclic graph with anything left always has a match whose
  dependencies are placed — so every slot places at least one. `MAX_SLOTS` is a backstop against
  a future edit breaking that reasoning. A circular wait is reported in `skipped`, never spun on.
- **Times are WALL CLOCK at the venue, stored as "floating" UTC.** The organiser types 09:00 and
  everybody reads 09:00; nobody converts, because everybody is in the same building. So the
  `datetime-local` value is read AS IF UTC and every render passes `timeZone: "UTC"` back. What
  goes in comes out, on any server. **Do not treat `matches.scheduled_at` as a true instant** —
  a calendar export or a "starts in 20 minutes" would be wrong by the venue's offset. Pinned by
  tests that pass under `TZ=UTC` and fail under `TZ=Asia/Kolkata` if anything starts converting:
  verified by installing the naive version, exactly as `genSessionDates` was.
- A match that has STARTED keeps the time it has. A match that cannot be placed has its old time
  **removed** — a stale 10:30 on a match no longer in the plan is worse than a blank, because
  somebody turns up for it.
- Deliberately not done: **pinned courts.** `groups.court` is a free-text name, so mapping it to
  a court number is guesswork, and cross-category scheduling is what fills courts in the first
  place. Adding `preferredCourt` to `ScheduleMatch` later is additive.
- **`e2e/schedule.mjs` is differential, and has to be.** Same phone in both categories → the two
  matches must not share a time; four different phones → they should. Either half alone proves
  nothing: a scheduler that gave everything its own slot passes the first, one that ignored
  people entirely passes the second.

### Two things found while building it

- **`Draw groups & fixtures` used to do nothing when the group count exceeded the field, and
  said nothing about it.** The control defaults to 2 groups; two teams split across two groups
  left one entrant in each and `generateGroups` skipped both (`plan.entrants.length < 2`). No
  matches, no message. **Fixed 2026-09-15**: `maxGroupsFor(n) = max(1, floor(n / 2))` — a group
  of one has nobody to play — and `planGroups` clamps to it.
  - Clamped in `planGroups`, not in the form handler, so the rule lives with the algorithm and
    every caller gets it. The form shows the same ceiling (`max`, and "max N for M teams") so
    the constraint is visible before the click rather than applied silently after it.
  - `e2e/schedule.mjs` deliberately does NOT set the group count, which is what makes it a guard
    against the regression. Found only because the two teams never appeared on the order of
    play — the draw itself looked like it had worked.
- **The e2e suites are order-sensitive**, because they use fixed `waitForTimeout` waits and a
  PGlite database carrying ten tournaments answers more slowly than a two-second wait allows.
  Measured: `event` and `carryover` fail after the other six plus `schedule`, and pass alone, or
  first, or with `schedule` moved last. Reset `.pgdata` between runs — see `web/e2e/README.md`.

### Getting the schedule out (2026-09-15)

`lib/schedule/share.ts`, `/t/[slug]/schedule.csv`, and a WhatsApp link on the manage screen.

- **One definition of "the schedule as a table".** `scheduleRows` feeds the manage screen, the
  print pack, the CSV and the message. Written four times they drift — the pack gains a column
  the CSV lacks, the message shows a score the table does not.
- **A route segment must not contain a dot.** The CSV first lived at
  `/t/[slug]/schedule.csv`, which served perfectly under `next start` and returned **Vercel's
  own static 404** in production — a path with a file extension is routed as a static asset and
  never reaches the function. The tell was the response: 11KB of HTML,
  `content-disposition: inline; filename="404"`, and none of Next's headers. It is
  `/t/[slug]/schedule` now; `content-disposition` is what names the downloaded file anyway, so
  the extension was never doing any work in the URL.
- **`exportSchedulePDF` is deliberately NOT ported.** It `window.open`s a blank window and
  writes a document into it; `/t/[slug]/print` already does that job, and popups are blocked on
  the phones organisers carry — the same reason `printPack` avoids `window.open`. Likewise the
  CSV is a normal link to a route, not a `blob:` download, which phone browsers also block.
- **The WhatsApp message is CAPPED and says so.** The legacy version pasted the whole schedule
  into a `wa.me` URL; a fifty-match event then makes a URL long enough that clients silently
  truncate it, and the organiser sends half a message without knowing. Here it stops on a whole
  match, adds "…and N more", and always ends with the event's own link.
- The CSV carries a **UTF-8 BOM** (Excel on Windows otherwise reads it as the system codepage
  and mangles every "–" and every diacritic) and **guards formula injection**: a team called
  `=1+1` is prefixed with `'`. The legacy exporter escaped quotes and neither of these.
- The public URL in the message is built from the request's `host` header, so it is right on
  localhost, on a preview deploy and in production with nothing to configure.

### The database client was one per MODULE COPY, not one per process

Found while the CSV route 404'd for tournaments every page could see. `lib/db/index.ts` held
its client in a module-level `let`, and **Next gives a Route Handler its own copy of the module
graph** — so the pages and the route each built their own.

- On PGlite, which is a single-process embedded database, that meant **two clients on one
  directory**: the handler read an older snapshot (hence "tournament not found" for a row the
  pages rendered), and the two writers then collided into `RuntimeError: Aborted()`, which looks
  exactly like a corrupt database.
- It was **not** only a local problem. In production each copy opens its own `postgres()` pool,
  multiplying connections against the transaction pooler — the very thing `max: 1` is there to
  avoid.
- Fixed by holding the client on `globalThis` under `Symbol.for("rise.db")`, which is one per
  process. It also stops `next dev` leaking a pool per hot reload.
- **Related, and it cost an hour twice: never run `next build` while a PGlite-backed server is
  up.** The build collects page data, which opens the database, and two processes on `.pgdata`
  corrupt it. Stop the server, build, seed, then start.

### Who won (2026-09-15)

`lib/placings/`. Nothing in the app answered that: a final could be played and the event page
showed a score and moved on. There is now a podium on the event page and an honours list on
each player's profile.

- **Derived, never stored.** The legacy app writes a `medals` array onto each player when an
  event ends — a second copy of what the matches already say, which then goes wrong in the
  ordinary ways: a score corrected later, a final undone and replayed, a medal written twice by
  a double tap. Computing it on read cannot disagree with the scoreboard and needs no backfill.
- **A placing is real only once the deciding match has FINISHED.** A live final has no winner
  and an incomplete table has no champion; both return nothing rather than a guess.
- **No bronze without a third-place playoff.** Two losing semi-finalists are joint third, and
  handing it to one of them invents a result. The event page says so in as many words, and the
  organiser who wants a bronze turns the playoff on.
- `FINAL` and `THIRD` are matched **exactly**, not by a regex over "final" — "Semi-Final 1"
  contains it. Tested: switching to `/final/i` fails two tests.
- **`honours.ts` is a separate, narrower query on purpose.** Running `podiums()` per event would
  load every match, team and group of each tournament to read one line off the end. It asks for
  the `Final` / `Third Place` rows the person's teams appear in instead. A league title decided
  by a table is therefore NOT on the profile — checking a table is complete needs the whole
  load — and is shown on the event's own page.
- **`e2e/event.mjs` now plays the knockout out**, which it never did: it drew the bracket and
  stopped, so nothing ever exercised an event ENDING. It also gives each team a player with a
  phone — without one, a team is just a name, it can win the final, and there is no profile for
  the win to land on. That is what the honours check caught on its first run.

### The player pages (2026-09-15)

- **`people.partnerStats` had been written on every rated match since the engine was ported and
  shown nowhere.** Spec §6.2 keeps it so a disputed carry guard can point at a specific person;
  it also answers the question a player actually asks. `lib/rating/partners.ts` reads it.
  - **A win rate is withheld below four matches together.** Two matches is 0%, 50% or 100% and
    every one of those reads as a verdict. The counts always show; the rate waits. The threshold
    is a judgement, and it is stated on screen rather than hidden.
- **The roster filters by sport + format, and that changes which rating it shows.** Singles and
  doubles are rated separately (§2), so one list of both ranks numbers that were never on the
  same scale. Choosing a format switches the page off `riseBest` — a max() across everything —
  and onto that format's own rating, including the tier.
  - Format needs a sport: the keys are `"pb:md"`, so "doubles" alone names nothing. The page
    says so when only a sport is picked.
  - The query reads the JSONB by key (`riseRatings ->> 'pb:md'`, cast to int so 9 does not sort
    after 1000) and filters on `riseRatings -> 'pb:md' is not null`. **Not the `?` existence
    operator**: `?` is also a parameter placeholder in several Postgres drivers, and this app
    runs on two — PGlite locally, postgres-js against Supabase. It is not worth a difference
    that could only ever appear in production, on a page that shows an empty list either way
    when nobody is rated, so the ambiguity is removed rather than tested.
  - **Verified by counting, not by a 200**:
    a filter that does nothing returns everybody and a broken one returns nobody, and both look
    fine from the status code. Measured 6 in `pb:ms`, 8 in `pb:mx`, 0 in `pb:wd`, 14 unfiltered.
  - `formatLabel` moved from a private helper in the tournament ratings page into the registry
    — the moment a second caller wanted the same six strings.

### Peer ratings and endorsements (2026-09-15)

`lib/skills/`, the radar on a profile, `e2e/skills.mjs`. What other players say you are good
at — thirteen skills and fifteen tags per sport, from the registry. **It never touches the RISE
Rating**, which is measured from results; this is opinion and is labelled as such on screen.

- **Who may rate.** Faisal, 2026-09-15: *"only people who have played against you and or with
  you or in your network (a feature to be added later) will be able to rate you and endorse
  your skills."* So the rule is SHARED A COURT, either side of the net — partners included,
  which is the "with you" half. The network is not built and is not faked; when it lands it
  becomes a second way to qualify, not a replacement.
  - "Played" means a match that has been **scored**. A fixture on the order of play is two
    names on a sheet, and a draw published a week early would otherwise open up ratings for
    matches nobody has played.
  - **Both halves of the app count.** Tournament matches go through teams (`players.teamId`);
    community line-ups are person ids already. Leaving community out would have made the
    feature look broken for the people using the app most.
- **One row per rater, not a running average.** The legacy app folds each rating into
  `skills` + `skillRatingsCount`, which cannot tell two submissions from one person apart from
  two people's — so anyone can lift their own numbers by pressing Save repeatedly. A UNIQUE
  index on (subject, rater, sport, skill) makes a second rating REPLACE the first. The
  averages are computed on read, so a removed rater simply stops counting.
  - Tags are a set: saving replaces that rater's selection, scoped to them, so un-ticking means
    something.
- **The database enforces the rules too**, because a Server Action is a public endpoint: CHECKs
  for `score BETWEEN 1 AND 5` and `rater <> subject` on both tables, hand-written into the
  migration next to the RLS (drizzle-kit generates none of them). `schema.test.ts` proves each
  one by trying to insert a row that breaks it.
- **The radar is hand-drawn SVG on the server** — no library, no client bundle, no hydration
  boundary for thirteen points of trigonometry. Labels are **anchored by position** (start on
  the right, end on the left, middle top and bottom) or they collide with the shape; an unrated
  axis is drawn at zero rather than dropped, because twelve points make a different shape and a
  reader cannot tell a missing axis from a weak one.
- **The refusal is stated, not hidden.** A control that is simply absent reads as a bug; a
  reason reads as a rule. Three different messages for "who are you", "that is you" and "play
  them first".
- **The honest limit**: this answers *may this person rate that one*. Whether the browser is
  really that person is the `rs_me` cookie's problem, and it is a name badge until sign-in
  lands. The guard is written to be right the day the cookie can be trusted.
- The e2e is differential for the same reason the scheduler's is: an opponent CAN, a stranger
  CANNOT and is told why, and rating twice still reads "1 person".
- **Radio inputs are `sr-only` behind their labels** — the accessible pattern, and what a
  finger hits. Playwright's `.check()` on the input fails with "label intercepts pointer
  events"; click the label, which is what a user does.

### Making endorsements visible, and what had to come with it (2026-09-15)

Tags are now searchable on the roster and shown as chips on a row. Three guards went in at the
same time, because every part of the original plan removed obscurity while adding no control.

- **THREE distinct raters before a tag leaves the profile** (`PUBLIC_TAG_THRESHOLD`). One tick
  is close to attributable — only court-mates may endorse, and a subject's court-mates are on
  the same page — and one tick is also all it takes to farm, since identity is a cookie anyone
  can set (`chooseIdentity` accepts any person id). Counts appear on the profile and **nowhere
  else**: a number on a list invites a leaderboard of adjectives.
- **`people.hideTags`** — the only control anybody had over a label another player chose for
  them was the rater un-ticking it. Honoured inside `lib/skills/tags.ts` so no surface can
  forget, including the filter predicate (or the filter would find someone whose chips the list
  then refuses to draw).
- **`robots: noindex`** on `/people` and `/people/[id]`. These list real people — name, gender,
  the last four digits of a phone, and now other people's labels — and nobody on them opted in;
  a `people` row is created by an organiser. Playing a match is consent to be scored, not to be
  a search result. There was no crawl guard anywhere in the app.

- **Two tags renamed while it was still cheap**: `Serial Lobber` → `Lob Specialist` ("serial" is
  how you describe an offender, and repeated lobbing is a standing rec-play grievance) and
  `Comeback King` → `Comeback Artist` (the only gendered noun across all seven vocabularies, in
  an app with a Women filter). Rows store the tag TEXT, so `0015` rewrites the saved ones and
  `canonicalTag` still reads an older row.
- **A tag needs a SPORT with it.** Four of the fifteen strings appear in all seven sports and
  the rest mean different things in each, so a chip with no sport is ambiguous by construction.
  Chips render only once a sport is chosen; the filter refuses without one.
- **The predicate is a correlated EXISTS in the WHERE, before the LIMIT.** A join multiplies the
  person row by their endorsements; filtering in JavaScript afterwards searches only the hundred
  highest-rated people and silently drops anyone below — no error, and a plausible-looking list.
- An absent tag and an *unusable* one take different paths: absent → no predicate, invalid →
  `sql\`false\``. The `.filter(Boolean)` idiom makes "silently everybody" the default outcome of
  a dropped predicate, which is the trap this file records twice already.

Two bugs found in passing and fixed, both pre-existing:
- `ratedSports` had **no ORDER BY**, so the profile's default sport could change between two
  loads of the same page; and it read `skillRatings` only, making a tags-only sport unreachable.
- The roster's `ORDER BY riseBest DESC` had **no `nulls last`** — Postgres sorts DESC as NULLS
  FIRST and `rise_best` is nullable, so an unrated person headed the leaderboard showing a dash
  — and no tie-break, so the hundred-row cut was whatever the planner felt like.

Found by a five-agent survey of the legacy behaviour and an adversarial review of the plan; the
abuse pass is what produced the three guards above. Two things it turned up about the legacy app
worth recording: its "played against" gate (`ne`, app.source.js:6718) is **never called**, and
its "Play vs to rate" hint sits behind a logically contradictory condition, so the rule Faisal
asked for has no working implementation there. And the legacy picker accepts **free-text tags**
which then leak into every other player's suggestions — deliberately not ported.

Next areas by size: engines & draws (~30 left), foundations (29), the UI kit (~18).

## Access: the site is deliberately open, and the switch is a trap

`rise-sports.vercel.app` lets any visitor create events, manage them and enter scores that move
ratings. **This is a decision, not an oversight** — Faisal, 2026-09-14: he is the only one
testing, the product is not public, and access features come later. Every page carries a banner
saying so.

**Do not set `RISE_OPEN_ACCESS=0` to "fix" it.** It would lock everyone out, the owner
included, and would not secure the community side. `next-auth` is in `package.json` but was
never wired up: no `api/auth/[...nextauth]` route, `NextAuth()` called nowhere, and
`currentUserId()` in `lib/auth/guard.ts` is a placeholder returning `null`. So with the flag
off, every visitor is `anonymous()` and `atLeast()` is false forever — `canManage()` false for
everybody, draft tournaments invisible to everybody, and no way back except flipping the flag
again. Meanwhile Play/venues authorise against the `rs_me` cookie, which is a name badge the
viewer picks, not a credential.

**The prerequisite is real sign-in.** Wire `currentUserId()` to something that can answer the
question; then the flag becomes the one-move switch it claims to be. The open question for that
work is *how* people sign in — phone + SMS code is the likely answer for Indian players, but it
has not been decided. Full reasoning in the header of `web/src/lib/auth/access.ts`.

## Roadmap

Full plan: `C:\Users\khanf\.claude\plans\i-want-to-develop-stateful-pascal.md`

| Wave | Scope | Status |
|---|---|---|
| 0.1 | Rebrand to RISE Sports, `rs_` prefix + migration, favicon, test harness | **done** |
| 0.2 | Multi-sport spine — `SPORTS` registry, sport-keyed skills/tags, `pb:md` rating keys | **done** |
| 0.3 | Supabase sync + PIN roles, ported from `Format/pickleboss-35split 12.html` | next |
| 0.4 | Mobile hardening + PWA manifest/service worker | **done** — SW verified live: registered, activated, controlling, 7 assets cached |
| 1 | Live scoring / referee mode + match timer | **done** — engine, court diagram, timer, wired into both score modals |
| 2 | Cup/Plate, tiered finals, Davis-Cup rubber ties, rolling substitutions | not started |
| 3 | RISE Rating rebuild (fixes the conservation bug) + GSR→RISE rename | not started |
| 4 | Capacitor packaging for Play Store / App Store | not started |

Deferred: OSL championship ledger, auction + owner planner, draw wheel, expense ledger,
UPI registration, venue booking.

## Known gotchas / open items

- **The rating engine leaks points.** `calcRtgChange` computes the winner's gain and the
  loser's loss from two independent multipliers, so every match mints rating. Every rating in
  the app today is inflated. Fixed in Wave 3 per `Files for claude code/rise-rating-spec 4.md`;
  the conservation test in its §11 must pass before that ships.
- **`Format/` files embed a Supabase URL + anon JWT.** That key is public by design — it
  identifies the project and authenticates nobody; all of its power comes from the policies on
  `osl_live` (writes funnelled through `osl_put`, reads open). Rotating it breaks every
  deployed copy and buys nothing; tighten policies instead.
  - The **cleartext organiser password those files used to ship was removed on 2026-09-14** —
    see "The repo is PUBLIC" above. Do not reintroduce a hard-coded one.
  - **Rotated on 2026-09-14, and verified.** It had sat in the public repo's `CLAUDE.md` from
    `fde7431` until `6b3d124` and is still reachable in history, so it was treated as
    compromised. Both live events were changed by Faisal:
    - `pboss35` — the stored hash WAS the leaked password's (checked before rotating, so this
      was live exposure, not a theoretical one). Changed.
    - `osl2026` — had **no** stored password and was relying on the shipped default, i.e. it
      was unclaimed the moment that default was removed. Now set.
    - Verified from a device with its storage cleared, so it pulled the real settings from
      Supabase rather than trusting anything local: the leaked password is refused by both
      apps, and OSL no longer offers to set one. The two apps key their config row
      differently — `<event>:cfg` for pickleboss, **`<event>:cfg:access` for OSL** — which is
      easy to miss when checking.
- The UI still says **"GSR"**; it becomes RISE Rating in Wave 3. `gsrMin`/`gsrMax` are
  persisted inside `rs_cg`, so that rename touches stored data, not just labels.
- **Demo player names do not match their gender.** `genPlayers` picks the first name from one
  mixed pool (`:1028`) and the gender independently (`:1032`), so "Rekha" can be male and show
  up in Men's Doubles. Cosmetic, seed data only — the leaderboard filter itself is correct.
- **Scope collisions are the top hazard in this file.** It mixes readable module scope with
  minified single-letter locals, so a short global name is a loaded gun. A helper named `K`
  shipped on 27 Aug and was shadowed by `setCommunityGames` in `RiseSports`: reads hit the
  temporal dead zone and fell back to seed data, writes went to a key named `"undefined"`, and
  `communityGames` became a string that crashed the Play tab — all silently. Fixed 28 Aug
  (`K`→`lsKey`, `RK`→`ratingKey`) and guarded by `tests/shadowing.test.js`. `buildTimedSchedule`
  also bound a local `C` over the palette; renamed to `courtCount`.
- **The rally log is session-local.** `RefConsole` keeps it in `TourneyTab` state, not on the
  tournament record, so reloading mid-match loses the log (the score can still be typed in).
  Wave 0.3 moves it into the synced match record, which is where it belongs.
- In `TourneyTab`, organiser controls use `(q || z)`: `q` = real organiser, `z` = the
  demo-able "Organiser View" toggle. Keep that pattern for new organiser features.
- The `T[q] !== void 0` trap in the rating applier `Y()` (a player with no entry for that
  format silently got no rating change) was **fixed in Wave 0.2** — it had to be, because
  namespacing the key would otherwise have made that guard fire for every player and silently
  stopped all rating updates.
- The score modals auto-focus via a `setTimeout` ref — automated keyboard input into them
  is flaky (real users unaffected). Americano uses inline inputs, which automate fine.
- Schedule export covers group matches + winners brackets; LB/GF matches are not in the
  CSV/PDF yet.
- Grand final is the single-game club version (no bracket reset).
- Rating updates apply to team formats, not Americano/Mexicano points (intentional).

## Testing patterns that work

- Syntax: `build.js` does it. Unit tests: `node tests/run.js`.
- The test convention is to **extract the real function out of `app.source.js` by text** and
  run it against a stub (see `tests/migration.test.js`). Testing what ships beats testing a
  retyped copy that can drift.
- Deeper: extract pure helpers by brace-matching and unit-test in Node (done for the
  scheduler, `advanceDE` full 8-team sim, americano rotation).
- **Serve it. Never verify storage, PWA or sync from `file://` or a `data:` URL.** Both
  disable `localStorage` *and* service workers. This is not a footnote: a completely broken
  persistence layer once passed 76 green tests and a browser check purely because every
  browser check ran on a `data:` URL, where the subsystem under test was switched off. The
  crash appeared within seconds of serving the same build over HTTP.

      node tools/serve.js        # then http://127.0.0.1:8765/rise-sports.html

  `python -m http.server` is not a substitute — it speaks HTTP/1.0 and closes the socket per
  request, which makes the service-worker script fetch fail with a bare "unknown error".
- UI: drive React inputs with the **native value setter** + `input` event, or real
  `keyboard.type`. Seed state by writing the `rs_*` localStorage keys and reloading.
- Service worker registration cannot be exercised in the embedded dev browser (it blocks
  `register()` even though a plain `fetch()` of the same URL returns 200). `tests/
  sw-behaviour.test.js` drives the generated `sw.js` against stubs instead; real registration
  and "Add to Home Screen" still need a real browser.
