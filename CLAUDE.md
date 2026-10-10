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
  share back, so time is not lost by a retry. **One known limit**: a write whose REPLY was lost
  did land, with its time, and that time was put back and goes again — the play between two
  pushes can be counted twice. Fixing it needs an idempotency key per tick; it moves no rating.
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
- **Both sides of a knockout match drawn before its feeders have played were the SAME team, as
  far as the console was concerned.** An unfilled slot became `id: "tbd"`, and `sideOf` is
  `t.id === teamA.id ? "a" : "b"` — so side B answered as side A, and React warned that two
  children shared a key, which it may duplicate or drop. The placeholder is `tbd:a` / `tbd:b`
  now. Found on 2026-09-20 by `e2e:event` on a FRESH database: the two runs before it had both
  stopped short of playing the knockout out, for the order-sensitivity reasons below, so the
  suite had never once reached the screen.
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
  - Format needs a sport: the keys are `"pb:md"`, so "doubles" alone names nothing.
    **Superseded 2026-09-21**: the page is always one sport now, and the sport alone is a real
    view — see "A rating is a rating IN ONE SPORT" below.
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

### Endorsements stay on the profile, and the SUBJECT sets the rule (2026-09-15)

A first pass made tags searchable on the roster with a three-rater threshold and a hide flag.
Faisal reversed both halves the same day, and the replacement is better:

> "endorsement stays in profile only… we can have a setting in a player's profile to receive
> endorsement from his connected networks, players played with or vs, or from anyone. So the
> player himself/herself will set the criteria."

- **No tag surface outside the profile.** The roster filter, the row chips, the public threshold
  and `lib/skills/tags.ts` are all gone. Counts live on the profile, where the detail belongs
  and where there is no list for them to leak onto.
- **`people.endorsementPolicy`** — `network | played | anyone`, default `played`. `mayRate` reads
  it from the SUBJECT's row; a caller that could pass the policy in is a caller that could pass
  the wrong one. It governs skills and tags together, because they are given in one form by one
  person.
- **`network` is stored and implemented, and qualifies nobody**, because connections do not
  exist yet. `networkOf()` returns an empty set and is the only thing to write the day they do.
  The picker shows it greyed with the reason — a setting that can be chosen and silently means
  "nobody" reads as a bug.
- Fails **closed** on a missing subject row rather than falling through to the permissive branch.
- **`robots: noindex`** on `/people` and `/people/[id]` stays. They list real people — name,
  gender, the last four digits of a phone — and nobody on them opted in; a `people` row is
  created by an organiser. Playing a match is consent to be scored, not to be a search result.
  There was no crawl guard anywhere in the app.
- Two migrations, not one: drizzle-kit prompts for rename-vs-drop when a column goes and another
  arrives in the same table, and a prompt cannot be answered from a non-TTY shell. Splitting it
  into a pure ADD (`0016`) and a pure DROP (`0017`) keeps both auto-generated, with correct
  snapshots and journal entries — the hand-written-migration trap this file records from `0008`.

- **Two tags renamed while it was still cheap**: `Serial Lobber` → `Lob Specialist` ("serial" is
  how you describe an offender, and repeated lobbing is a standing rec-play grievance) and
  `Comeback King` → `Comeback Artist` (the only gendered noun across all seven vocabularies, in
  an app with a Women filter). Rows store the tag TEXT, so `0015` rewrites the saved ones and
  `canonicalTag` still reads an older row.
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

### A way in (2026-09-15)

Only THREE pages in the app linked to a player's profile, and the community session page — where
most play actually happens — showed every name as plain text. Meanwhile a profile had grown a
rating and how it was earned, an honours list, a partner record and a skill chart, all reachable
only by typing a URL or going the long way through the roster.

- **`<PersonLink>`**, one component, because of the null case. `players.personId` is null for
  anyone an organiser added without a phone: they exist inside that event and have no profile.
  `<Link href={`/people/${undefined}`}>` renders happily and 404s only when somebody clicks it,
  and no test would notice. A person with no id is plain text, once, in one file.
- Wired into the community session roster and the manage screen's squads.
- **The home page** gained what the legacy `HomeTab` has and this one never did: players,
  matches and events as counts, and the top five rated, linked. "Matches" counts matches that
  were PLAYED, not drawn — a fixture nobody turned up for is not a match that happened.
- Counted in the database with drizzle's `count()`, not by loading rows and measuring the array,
  and not with a hand-written `count(*)` — that returns a STRING from postgres-js and a number
  from PGlite, so it reads right locally and is wrong in production.
- The smoke suite now **follows the first link** rather than checking one exists. A profile URL
  built from an undefined id renders perfectly and only fails on click.

### The day the site hung, and it was never the database (2026-09-15)

Observed after the "a way in" deploy: every database-backed page stopped responding — no error,
no 500, just an open socket until the client gave up. Static files and the 404 page served in
300ms throughout. Intermittent: roughly one request in four came back normally in under two
seconds.

**It was not the database.** 15 of 60 connections, none stuck, the same queries instant through
Supabase's own API. The difference is the path: the app reaches Postgres through the
**transaction pooler on 6543**, and the MCP tools do not.

**Root cause: `max: 1`.** One connection cannot carry three queries. `Promise.all` over three
queries does not open three — postgres-js **pipelines** all three down the same socket, and
Supavisor in TRANSACTION mode binds a client to a backend for the length of a transaction. Three
implicit transactions interleaved on one socket wedge it: the backend waits in `ClientRead` for
the rest of an exchange that never arrives, and the driver waits for a reply that never arrives
either. `max: 8` now covers the app's widest fan-out (four, on `/t/[slug]/manage`); connections
open on demand, so it is a ceiling and not a reservation.

- `max: 1` was chosen because a serverless invocation handles one request and freezes, so one
  connection each is what a pooler is designed for. **That is true of CONNECTIONS and false of
  QUERIES**, and the whole outage lives in the gap between them.
- **A fan-out that grows with the data is the remaining hazard, and it is now guarded.** Three
  sites mapped an unbounded array into concurrent queries: the ledger's book list, the venues on
  `/play`, and registration approval. **All three were rewritten on 2026-09-17**:
  - `listBooks` made about four queries PER BOOK, all at once. Measured: 9 queries for 2 books,
    29 for 7. Three books would have wedged the site; production simply had none yet. It is
    four queries now, however many books.
  - `bookingsForVenues` loads every venue's bookings in two queries.
  - Approval looks entrants up one at a time. Its `Promise.all` asked "is this phone known?" for
    every entrant before creating any, so a pair who gave one contact number raced into
    `23505 people_phone_idx`. `findOrCreatePerson` is race-safe too now (`onConflictDoNothing`
    on the unique phone, then read back the winner). Approval also claims the entry inside its
    transaction (`status <> 'approved'`), so a double tap on Approve makes ONE team.
  - A phone repeated within one entry links only the first player. Linking both would put one
    person on a team twice. Every match would then write two `rating_history` rows for the same
    (match, person, format), the unique index would refuse them, and score save only LOGS a
    rating failure, so the team's ratings would silently stop moving.
- **`src/lib/__tests__/db-fanout.test.ts` fails the deploy on a new one.** The `build` script is
  `vitest run src/lib/__tests__/db-fanout.test.ts && next build`, and Vercel's build is that
  script. It is not a `prebuild` hook because Vercel installs with pnpm, and pnpm does not run
  pre-scripts. An adversarial review caught the first draft claiming "fails the build" while
  nothing on the way to production ran a test at all: no CI, no hook, and `build` was a bare
  `next build`. It parses with the TypeScript compiler, not a regex, and flags three things:
  - a `Promise.all/allSettled/any/race` whose argument is not a literal array of at most four;
  - an `async` callback to `map`, `flatMap` or `forEach`;
  - any combinator inside a `.transaction(`, which holds one connection by definition.

  Canaries prove it catches across line breaks and ignores comments and strings. It exists
  because **nothing else can see this hazard: every test runs on PGlite, which has no pool.** The
  health probe deliberately does NOT fire more than eight queries: a public route that can wedge
  the instance serving the site would cause the outage it exists to report.
- **Where the pipelining actually happens, read from postgres-js source.** A query goes to an
  open connection, else opens a closed one, else is written onto a BUSY one. That last branch is
  the pipeline. A connection keeps accepting while fewer than `max_pipeline` statements wait on
  it, and the default is 100. **`max_pipeline: 0` would turn pipelining off entirely**, making
  excess queries wait for a free connection instead: a structural fix, where the guard is a
  disciplinary one. It is not set, because it has not been tried against Supavisor and the only
  place to try it is production. The option is undocumented in the types but read as a plain
  option, so 0 is honoured.
- **Every property that made this hard to find follows from the mechanism**, and each one sent
  the search somewhere else:
  - It HANGS rather than erroring. No statement is executing, so no `statement_timeout` can
    cancel it; the socket is open, so `connect_timeout` cannot fire either. The session reports
    the normal `2min`.
  - The query never reaches Postgres, so **`pg_stat_activity` shows an idle, healthy database
    while a request hangs** — which reads exactly like a network fault and cost four hours in
    the pooler logs.
  - **One wedge kills the instance.** The client is a per-process singleton since the `globalThis`
    change, so every later query queues behind the wedged one forever. That is why five
    redeploys did not help, and why the site looked permanently down.
  - Intermittent per attempt, permanent once caught — a flaky network and a dead site at once.
- **`/health` and `/api/health/db` exist now, and are the first things to hit next time.** A
  static 404 proves nothing: Vercel serves its OWN static 404 for an unmatched path (the same
  behaviour that made `schedule.csv` 404 in production), so comparing it with a hanging page
  compares a file with a function. `/health` is a page that queries nothing; `/api/health/db` is
  `lib/db/probe.ts` — a LADDER whose rungs add one thing at a time (no parameters, a parameter,
  a table, both, drizzle's builder, `count()`, an order by, **three at once**, the session's own
  limits, jsonb). The concurrency rung is the regression test for this outage.
  - It runs from the deployment, so it needs no password — Vercel already holds it. `db:check`
    could not be automated for exactly that reason.
  - Both halves must be compared or neither means anything: `/health/db` runs the same ladder
    from a PAGE. Rendering worked and querying worked; only the two together failed.
- **Four theories died on the way, each reasoned from the outside and each looking airtight**:
  the pooler running out of backends (clients exceed backends every hour, including hours the
  site worked); parameter binding over the pooler (a real table read with a real parameter passes
  in 373ms); a stalled module import (there is none outside the tests); and Vercel's build cache
  (the home page's own component, rendered from a route added that day, hung identically).
- **The lesson about sampling.** The correlation that was right — all six hanging pages run
  concurrent queries, and `/new`, the only page that runs none, never stopped answering — was
  found, then WITHDRAWN because the concurrency rung passed once. One passing sample of an
  intermittent fault is not a refutation. Prove a negative against an intermittent fault by
  repeating it, or not at all.
- A caught database error here is almost never the error: drizzle rethrows a driver failure
  wrapped in its own, whose message is always `Failed query: <sql>` — the SQL you already knew.
  The code that names the fault is on `cause`. `describeDbError` walks that chain; anything new
  reading `e.message` directly gets a sentence it already had.

Also fixed on the way, because it is wrong either way: **postgres-js waits forever by default.** With no
`connect_timeout`, a connection the pooler has quietly dropped never errors and never gets
replaced — and every page that could have reported the problem was a page that hung. The home
page already renders a "database is not reachable" panel carrying the real message; it had no way
to fire. Now `connect_timeout: 10` turns an unreachable pooler into an error, and
`max_lifetime: 900` retires a connection rather than holding one open indefinitely on a warm
instance. A long-lived client against a TRANSACTION pooler is exactly what goes stale, and since
the `globalThis` change that client is one per process by design.

Next areas by size: engines & draws (~30 left), foundations (~27), the UI kit (~16).

### Category rules — who can enter (2026-09-17)

`lib/eligibility/` (engine + `store.ts`), migration `0018`, `e2e/eligibility.mjs`. Until this a
category was a NAME: nothing stopped a man entering Women's Doubles or a 40-year-old entering
Under-17. The legacy app checked all of it (`checkEligibility`, `app.source.js:573`).

Faisal approved a picture of the screens before any were built (the "Who Can Enter" artifact,
2026-09-17), and chose:

| Question | Answer |
|---|---|
| Organiser adds a player who does not fit | **Stopped with the reason; "Add anyway" lets them in**, the waived reasons go on `teams.rules_waived`, the card says "Let in by organiser" |
| A player with no rating vs a rating limit | **Allowed under an "up to" limit with an organiser-only note; refused by an "at least" limit.** A phone is REQUIRED when a category has a rating limit, so a blank one cannot be used to look unrated |
| Rules edited after teams entered | **Nobody removed; misfits marked red; the draw still works** |

Defaults, not asked: Mixed = at least one man and one woman; no DUPR fails a DUPR limit.

- **NULL means "no limit" on every new column**, which is what keeps every existing category,
  and every one created without touching the rules, behaving and looking exactly as before.
  The e2e proves it (an entry to Main with no phone and the untouched M default is accepted).
- **Missing evidence mostly FAILS**: no date of birth fails an age bound, no DUPR fails both DUPR
  bounds, no gender fails a gender rule, unrated fails "at least". The ONE exception is unrated
  under "up to" (Faisal's call) — a newcomer belongs in the beginners' category.
- **Ages are integer Y-M-D arithmetic on strings, never a `Date`**, counted on the category's own
  `age_on` (a real `date` column; the database rejects 30 February). The birthday counts;
  29 February falls on 1 March. An event with no date yet counts on today in India and the panel
  says so prominently — that date does not follow the event if one is set later.
- **`sportRating` is NOT `riseBest`.** Only keys for THIS sport, and only ones with matches or a
  deliberate seed (`seedSource` dupr/organiser — `createPerson` writes only that one key). A
  default seed nobody has played on is unrated. `riseBest` would let a strong badminton player
  read as strong at pickleball.
- **One evidence rule everywhere: declared for this team, then the person's record.** Approval
  copies the declared `dob`/`dupr` onto the `players` row, and the red flags read that row first,
  so approval and the flags cannot disagree — tested with a stored date of birth that says 30 and
  a declaration that says 36. Players are never matched back to the entry by name.
  - The PUBLIC form uses `useStored: false`: no sign-in, so typing someone else's phone must not
    borrow their stored date of birth. The rating still comes from the person.
  - `people.dob` is filled from a declaration only WHERE NULL, never overwritten.
- **Checked on every way in**: `submitEntry`, `approveRegistration` (again, before creating anyone —
  the category may have tightened since), `addPlayer` (before creating anyone). A team never
  moves between categories today; `teams.divisionId` carries a comment that any future path must
  run `entryFailures`. The database refuses rules that cannot mean anything (9 CHECKs in `0018`);
  whether a PERSON fits spans tables and cannot be a CHECK.
- **A waiver is a KEY, not the sentence the organiser read** — `waiverLine` writes
  `<rule code>\t<player row id>` on `teams.rules_waived`, one per line, and `divisionMisfits`
  matches on that. A rule tightened later is a different bound, so a different code, so still
  red — which is the behaviour Faisal asked for. Keying it on the sentence looked equivalent and
  was not: the sentence moves with the EVIDENCE. A player refused by "Rating 1200+ only
  (unrated)" was waived under exactly those words, and the moment they had a number — a seed
  placed by the same form, or one match played — the flags produced "Rating 1200+ only", which
  the stored line no longer matched. The team went red again with nobody having changed
  anything, and the organiser's decision was silently undone. The code carries no evidence, and
  `:unrated`/`:missing` is stripped from it, because a waiver is about the rule that was broken
  and not about which fact happened to be missing when it was given. The player row rather than
  the name, so two people called Rahul on one team are waived separately.
- **The organiser's add is judged on the level it is ABOUT to give the player.** `addPlayer`
  looks the candidate up without creating them — a refusal must leave no orphan behind — so for
  somebody new there is no person to read a rating off, and `sportRating(null)` is null. Null
  under an "up to" limit is a NOTE, so a player the organiser placed at the top of the local
  scene walked into a beginners' category without a word, and `divisionMisfits` then marked the
  team red for a rating the same form had just placed, with no waiver possible because nobody
  had been asked. `playerEvidence` now takes a declared `rating`, used only when there is no
  person yet: `seedFromDupr(dupr)` else the starting-level band, mirroring `newPersonRow`
  exactly. A default seed stays null — it is not evidence — and an existing person is judged on
  their own record, because the write does not re-seed them.
- **ONE definition of "the team is complete": `squadIsComplete(size, minTeamSize)`**, which is
  `size >= max(2, minTeamSize)`. There were two, and they disagreed wherever min < max: the add
  check waited for `maxTeamSize` while the flags judged at the minimum, so on a min-2/max-6
  event a second man joined a Mixed team unchallenged and the card went red on the very next
  render — again with no waiver to be had. A team shown in red is a team the organiser was asked
  about first.
- **Community play now calls the same engine** (`eligibilityFailures` and `ageOn` are thin
  wrappers), with ages on the day of play. It first kept its own evidence — `riseBest ?? 0`,
  `dupr ?? 0` — and **since 2026-09-21 uses the tournaments' evidence** (`communityVerdict`,
  below). Two behaviours changed deliberately, both tested: an invalid date of
  birth used to roll over via `fromISO` and now fails an age rule; a date of birth after the day
  used to give a negative age, which passed "N and under", and now fails.
- **Fixed on the way, all the same class of hole**: `approveEntry`, decline, payment,
  `removePlayer` and `removeDivision` acted on an id with no tournament check, so a manager of one
  event could act on another's rows; `addTeam` silently swapped a foreign category id for the
  default; approval silently filed an entry whose category had been deleted into the first one.
- **Team size 1 is refused while a Mixed category exists.** The registration settings redirect
  with a CODE (`?problem=mixed-team-size`) and the page builds the sentence from the database —
  never a message carried in the URL, which anyone could craft.
- **The entry form and the add-player form submit with `onSubmit`, not a function `action`.**
  React resets every field when a function action returns, which after a refusal wiped out what
  the entrant typed at the exact moment they were told what to fix.
  - The add-player form ALSO keeps the Server Action on `action`, for the seconds before React
    hydrates. It was a plain server form, and a tap in that window used to add the player; with
    only `onSubmit` the browser did a GET of the manage page with the fields in the query
    string, so nothing was added and nothing was said. React checks `defaultPrevented` before
    running a form action (read in `react-dom-client.development.js`), so once hydrated the
    `preventDefault` is what stops it and there is never a double add.
  - **Nothing the rules judge may be `required` in the browser.** The DUPR box was, in a
    DUPR-limited category, so an organiser who did not know the number could not submit at all:
    no reason, and no "add anyway" tick — the one path Faisal's decision provides. The server
    refuses it instead, with both. The same argument applies to every future field the server
    is meant to answer for.
- **A date of birth is bounded where it is JUDGED, at the same 1900 floor the database keeps**
  (`parseDobISO`). `parseISODate` calls "1089-05-17" a real date, so a mistyped year passed
  every "at least" rule with an age in the hundreds and then violated
  `registration_players_dob_sane` inside the insert — which threw out of the transaction and
  left the entrant with no entry and no message, the exact failure the switch to `onSubmit` was
  made to avoid. A browser's date field produces "0019-05-17" from two typed digits, so this is
  not a crafted-post problem. Both date inputs carry `min="1900-01-01"` as well.
- **Declared beats stored, and where they disagree the organiser is TOLD.** Neither is proof —
  `people.dob` is itself filled from an earlier declaration — so the later one wins, which is
  what lets a player correct a date a stranger got wrong. But the app was holding a
  contradiction and quietly picking a side: an Under-17 entry typed by someone whose own record
  says forty was approved without a murmur. `playerEvidence` carries `storedDob`/`storedDupr`
  out whenever the record counted and differs, and `personFailures` turns that into a NOTE —
  never a block, and only where a rule actually reads that field. Never on the public form
  (`useStored: false`), because what is on file for a number somebody typed is not theirs to be
  told.
- **One phone number stands for one player.** Where a category has a rating limit the phone IS
  the evidence, so two rows carrying one number both read as that person and both cleared the
  limit — while the write path deliberately leaves the second unlinked, since one person cannot
  be on a team twice. The team was created with a player the rule had never really been applied
  to, and the manage screen then flagged it red for a reason the entrant was never given a
  chance to fix. The public form now refuses the repeat outright, and `entrantEvidence` — used
  by approval AND by the approvals list, so they cannot drift — judges the entry the way it will
  be STORED, one person per number.
- **`describeDivisionRules` authorises like every other action in its file.** It reads the
  database, and a Server Action is a public endpoint; the precedent it was written from
  (`describeScoring`) is pure and touches nothing. It is `requireManager` now, and the form asks
  once the typing stops rather than once per keystroke.
- The flags are one fixed set of five sequential queries (`divisionMisfits`), loaded AFTER the
  manage page's `Promise.all`, never inside it; the approvals list finds every waiting entrant's
  person in one `peopleByPhones` query. Query count is tested flat for 2 teams and 10.
- **The entry form's player rows are OBJECTS WITH IDS, not a count.** They were a count
  rendered `key={i}`, with name, phone, date of birth and DUPR left uncontrolled in the DOM —
  so "remove" on player 2 of 3 dropped the count, React unmounted the LAST child, and what
  disappeared was player THREE's typing while player 2's sat exactly where it was. The entrant
  deletes the wrong person and need not even notice, because a name is still in the row they
  clicked. A stable id as the key makes React move each surviving row's own node instead of
  renumbering them. `data-player` and the error keys stay POSITIONAL, because the server numbers
  players by their position in the submitted form.
  - Man/woman moved onto the row for the same reason: as a parallel array of twelve it came
    apart from the rows it described, so a row set to F, removed and added back came back
    showing F and still marked as chosen — which meant changing category could not reset it
    either. They type a man's name under a dropdown they never look at, and Mixed is satisfied
    by a woman who is not on the team.
  - `e2e:registration` removes the MIDDLE of three rows and checks the first and third are what
    is left. Verified by putting `key={i}` back: it fails with "First, Second". A test that
    removes the last row passes either way and proves nothing.
- `npm run test:tz` runs the unit suite under UTC and Asia/Kolkata (a script, because
  `TZ=… vitest` is not valid in Windows' shell).
- Not done, by decision: `playingSince`, `duprUpdatedAfter`, `duprId`, equal-numbers Mixed,
  blocking draws, a gender CHECK on people/players (needs a data audit first), moving teams
  between categories, proving a phone belongs to the person (impossible without sign-in — hence
  the "unrated" note).

### Entry fixes, a rating per sport, and the "No DUPR" switch (2026-09-21)

Faisal asked for "small fixes first". Two of them changed a feature in use, so he was asked, and
his answers widened the work into a principle: *"RiseR rating is specific to each sport… A player
can join without DUPR based on organiser's discretion."* Migration `0019` carries the whole
schema side.

**Two entries from one phone at the same moment.** `submitEntry` asked "does this phone have a
live entry?" and then inserted — two statements, so two submits in the same moment both got
"no". The partial unique index `registrations_one_live_per_phone` (`tournament_id,
contact_phone` where the status is pending or approved) is the arbiter now; a declined entry
drops out, so that phone may enter again.

- **It is consulted through `onConflictDoNothing()`, never by catching the error.** The two
  drivers name the violated constraint DIFFERENTLY: PGlite puts it on `constraint`,
  postgres-js on `constraint_name` (`postgres/src/connection.js:46`). A catch matching the name
  passes every local test — `schema.test.ts`'s `refusedBy` reads `constraint` — and in
  production would have shown the entrant a raw database error. Found by an adversarial review
  of the plan, before a line was written. `findOrCreatePerson` settles its race the same way;
  **anything new that must tell one unique violation from another has to read both fields, or
  better, avoid needing to.** `lib/registration/store.ts` `writeEntry` holds it.
- The partial index's predicate is LITERAL SQL in `schema.ts`, because drizzle-kit writes it into
  the migration as text.
- **Approval claims only a PENDING entry** (`= 'pending'`, it was `<> 'approved'`). The screen
  only offers Approve on one, but a stale page could approve a declined entry — which, once the
  same phone had entered again, collided with the new index inside the transaction and threw.

**Entry open/close times ran five and a half hours late on the live site.** `dateOrNull` did
`new Date("2026-10-12T09:00")`, which reads the time in the SERVER's timezone — UTC on Vercel —
so 09:00 typed in India was stored as 14:30 India time, and `entryWindow` compares it with the
real clock. Nothing looked wrong because the form (`getTimezoneOffset`) and the page (no
`timeZone`) converted back through the same wrong offset. **On a laptop in India every step was
right**, which is where it had been tested: installing the old code and running the tests
proves it — three fail under `TZ=UTC`, and the time tests pass under `TZ=Asia/Kolkata`.

- Entry windows are TRUE instants, unlike match times, which are floating. They are India time
  (`parseIndiaLocal`, `indiaLocalInput`, `indiaTimeLabel` in `lib/registration`), and the form
  and the page both say "India time".
- **Fixed-offset arithmetic, not `Intl`, builds the input's value.** India keeps no daylight
  saving, so +05:30 is exact. `Intl` formats can return "09:00 a.m." or "24:00"; a
  `datetime-local` box then renders EMPTY, and the next Save of any setting on that form posts
  it empty and silently erases the window.
- The same class, fixed alongside: the print pack's printed-at time and the approvals list's
  entry date (true instants, now India time), and the public page's event date (floating, now
  `timeZone: "UTC"` like every other schedule render).
- **Community "today" is India's today — fixed 2026-09-21.** It
  used the server's date (`localISO(new Date())`), so from 00:00 to 05:30 in India the session
  strip opened on a day that was over, a Monday game offered Monday after Monday had ended, ages
  were counted a day early, and a new game defaulted to yesterday's weekday.
  - **ONE definition: `indiaDateISO(instant)` / `todayInIndia()` in `lib/eligibility`**, fixed
    +05:30 arithmetic (no longer `Intl` en-CA — a locale's format is not a contract).
    `todayWeekday()` in `lib/community` is its weekday. **`localISO(new Date())` is never
    "today"** — `localISO`/`fromISO` stay as the pair that walks and names calendar days once
    the first one is known, which is why `sessionDates` only had its START changed.
  - Covered: `sessionDates` (the strip, `/play`'s next date), ages in `communityVerdict`/`ageOn`,
    the ladder challenge date, the venue picker's earliest date, and a new game's default day.
  - **The Court Ledger had the same bug** — an expense's default date and a payment's date —
    and uses `todayInIndia()` too, in a SEPARATE commit so it can be kept or dropped on its own.
    After it, nothing in the app calls `localISO(new Date())`.
  - The host form's default day is computed on the SERVER and passed down as `defaultDay`. Read
    in the form with `new Date()`, it was the server's day while rendering and the phone's once
    hydrated — two different days after midnight in India.
  - Tests pin 20:00 UTC on Mon 21 Sep (01:30 Tue 22nd in India). Installing the old code: five
    fail under `TZ=UTC` and all pass under `TZ=Asia/Kolkata` — the live site runs in UTC and
    the app was tested in India, which is exactly why it went unseen. Also checked in a browser
    against a dev server in UTC with its clock moved to that instant: the old code offered
    "Mon 21 Sep", the fix offers "Mon 28 Sep".
  - **Ages count on the HOST's cut-off date.** Asked whether ages should be judged on today or
    on the day of play, Faisal answered (2026-09-21): *"Cut off date to be set by the
    organiser."* So a community game with an age limit carries `restrictions.ageOn`, exactly as
    a tournament category carries `age_on`:
    - **Required beside an age limit** — the host form shows "Age counted on" the moment an
      age is typed and the browser will not submit without it; `createCommunityGame` refuses
      it too ("Choose the date ages are counted on."), because a Server Action can be called
      without the form. `required` is fine here: it is the host's own setting, not evidence
      about a player (see "Nothing the rules judge may be `required`" above).
    - The chip reads "Age 18+ on 1 Jan 2026" and a refusal "Age 18+ only (on 1 Jan 2026)" —
      a player who is 18 today but was 17 on the cut-off is otherwise told a rule they seem
      to meet.
    - **Optional in the jsonb**, like `duprStrict`: no migration, `NO_RESTRICTIONS` unchanged.
      A game saved without one counts on today in India. There were NO community games in
      production when this shipped (checked by query), so none is in that state.
    - **Set at creation only** — there is still no edit-game screen, so a host who wants next
      season's cut-off creates a new game.

**No DUPR: the organiser decides.** Faisal: *"A player can join without DUPR based on
organiser's discretion. we can highlight the same."* A player with no DUPR, against any DUPR
limit, is LET IN with a `dupr:none` note ("No DUPR") by default; the organiser can make the
category or game **Strict**, which refuses them exactly as before. Tournaments and community
games both (`divisions.dupr_strict`; community `Restrictions.duprStrict`).

- **The default covers "at least" limits too** — deliberately different from an unrated
  RATING, which "at least" refuses. Two answers to two questions; say so when it comes up.
- ONE note per player, not one per bound. A DUPR that IS there is judged either way.
- `needsFrom` says `dupr` (show the box) and `duprRequired` (strict). The public box is
  `required` only when strict; the organiser's box never is (the waiver rule above).
- **A blank box is not a way round a DUPR the app KNOWS.** Approval reads the stored record
  (`useStored: true`), so an entrant whose DUPR on file is below the floor is refused at
  approval and shown red on the list beforehand. A blank from someone the app has never seen a
  DUPR for is exactly Faisal's discretion case: in, flagged, and Strict closes it.
- A malformed DUPR ("35") is refused on the organiser's add rather than quietly becoming "No
  DUPR" — dropped, the flag would misstate what was typed.
- `Restrictions.duprStrict` is OPTIONAL and `NO_RESTRICTIONS` did not change. Changing the
  constant would have changed the jsonb column's stored default, and drizzle-kit would have
  generated a second migration for nothing. A game saved before the switch existed reads as
  the default.
- An old waiver line `dupr:min:350\t<id>` now matches nothing — the player has a note, not a
  block — which is harmless: there were none in production.

**Community games judge a player in THAT GAME'S SPORT.** `communityVerdict(person, r,
{ sport, on })` returns `blocks` and `notes` from one call, so the host's "No DUPR" flag and
the join check cannot read the same person two ways (`eligibilityFailures` is its blocks). The
rating is `sportRating(person, game.sport)`, no longer `riseBest ?? 0`:

- another sport's rating no longer counts — a strong badminton player was kept out of a
  beginners' pickleball game, and let into an advanced one;
- **a newcomer on the default 750 is UNRATED** (Faisal: a starting number is not a level). They
  used to pass "Rating 600+" and fail "up to 700"; now it is the other way round, which is how
  tournaments always treated them. Every entrant approval creates starts this way, so this is
  most newcomers.
- The host roster shows the notes (`[data-host-note]`). It is the first host-facing note on
  community: the player sees nothing extra, and joining still blocks on blocks only.

**A rating is a rating IN ONE SPORT — everywhere.** Faisal: *"if a player is playing
pickleball, his RiseR rating should only show pickleball. For badminton, it should show based on
badminton matches played."* `people.riseBest` (a max() across every sport and format) is still
written by the engine and is **no longer shown, judged, seeded or paired on anywhere**. Three
definitions in `lib/rating`, and nothing else decides what a rating is:

- `sportRating(person, sport)` — the best COUNTING key in that sport. A key counts if it has
  matches behind it or was placed deliberately (DUPR or an organiser's band); a newcomer's
  default 750 counts for nothing (Faisal: newcomers are unrated).
- `formatRating(person, key)` — the same rule for one key, so the list filtered by a format
  cannot show a newcomer's unplayed 750 that the sport view shows as "—".
- `startingRating(person, sport, format)` — what a player brings INTO an event: that format's
  own number, else their level in the same sport, else the default. **A new sport starts
  fresh** (Faisal); another format of the same sport carries over. It replaced the `riseBest`
  fallback in `ratingOf` (the engine) and `carriedRating`, which started a strong pickleball
  player's first badminton event at their pickleball number and seeded them top of it.

**Their SQL twins** (`sportRatingSql`, `formatRatingSql` in `lib/people`) sort and filter the
lists, and `people/sportRating.test.ts` holds the two languages to the same answer over ten
fixtures in the SELECT, WHERE and ORDER BY positions. Breaking the SQL's counting rule fails it —
checked. Rules of use:

- **SQL sorts and filters; the number SHOWN always comes from the TypeScript** on the loaded
  row. A computed numeric can arrive as a string from postgres-js and a number from PGlite.
- Keys are matched by PREFIX with `starts_with`, the sport is a BOUND parameter (it comes from
  the URL) and is checked against the registry first; `jsonb_each_text`, never the `?` operator.

Where it shows:

- **Home "Top rated"**: one sport at a time, pickleball first, with sport links and "Nobody is
  rated in Badminton yet." (it used to hide itself when empty).
- **`/people`**: always one sport — "Every sport" is gone, and so is the "pick a format too"
  message: the sport on its own is a real view, each player's best format in it, the same
  number a category limit judges them on. A format is still a competition (only people rated
  in it); the sport view lists everybody, because the page is also the directory.
- **Profile**: one line per sport played (`[data-sport-rating]`), or "Unrated".
- **In context, the event's or game's sport**: the community host roster and member lists,
  balanced pairings, the tournament ratings page, "Seed by RISE Rating", the organiser's
  player picker (`searchRoster.bind(null, t.sport)`) and the host's walk-in search. The "who
  are you" bar has no game in view, so it shows the pickleball rating WITH the sport's name —
  never an unlabelled number (🏓 alone is both pickleball and table tennis).
- **Not changed**: `detectSandbagging(…, riseBest)` — a Wave 3 heuristic.

`e2e/carryover.mjs` passed for the wrong reason before this: its second and third events had one
player a side (singles) while the first moved a MIXED rating, and the ratings page showed
`riseBest`, which hid the difference. Both are mixed pairs now, so the number compared is the
one the event carries in.

### DUPR exists only in pickleball (2026-09-21)

Faisal: *"DUPR should not appear for non pickleball sports."* DUPR is a pickleball rating. In a
badminton event the add-player box took one and **seeded the badminton rating from it**, starting
a player at their pickleball level; a DUPR limit on a badminton category judged badminton players
on pickleball.

- **One switch: `Sport.dupr` in the registry, read through `usesDupr(x)`.** Only `pb` has it. A
  new sport that genuinely has a DUPR-like rating gets the flag; nothing else changes.
- **Hidden on screen**: the add-player box, the category rules' DUPR limit and its "Players
  without a DUPR" switch, the host form's DUPR limit (its sport select is controlled now, so the
  limit comes and goes with the sport), the ratings page's DUPR column, and the profile's DUPR
  card — which stays for anyone who plays a DUPR sport or already has a DUPR on file. The
  registry is `server-only`, so client forms get a boolean prop (`showDupr`, `allowDupr`, a
  `dupr` field on each host-form sport).
- **Dropped on the server, because a Server Action is a public endpoint**: `addPlayer` ignores
  the field, `parseRules(…, { dupr: false })` ignores every DUPR field (IGNORED, not refused —
  there is nothing on screen for the organiser to fix), `createCommunityGame` stores no DUPR
  limit, and — the last line — `newPersonRow` will not seed a non-DUPR sport's key from a DUPR
  or store one. The e2e proves it by smuggling a DUPR into a badminton add.
- No migration and no data change: production had no DUPR in any non-pickleball category,
  game or player.

### A seed is filed under the format the event is RATED in (2026-09-21)

The first player added to an empty event is a team of one, so `ratingFormatFor` read the event
as singles and their seed went under `pb:ws` while every match moved `pb:mx`. The first match
hid it — `startingRating` falls back to the level in the sport, and a DUPR or band seed counts —
so what was left was an unplayed seed that **counts in `sportRating` for ever**: a player placed
at 1000 who drops to 950 still showed, listed and was judged by limits at 1000. `e2e/carryover`
filed Anya exactly there and nothing it checked could see it; it now asserts she is not on the
women's-singles list (verified failing on the old code).

- **Neither obvious fix works alone.** The team size helps only when the organiser set a minimum
  of 2, and a wizard event starts at "one or two" — the first player really is indistinguishable
  from a singles entrant. The team they join is just as small.
- So: **predict, then correct.** `ratingFormatFor(players, minTeamSize)` counts every team as at
  least the event's minimum (the maximum permits, it does not promise), and every tournament
  caller passes it, the engine included, so filing and rating are one decision. Then
  `refileSeeds` moves what an earlier guess filed, **after each organiser add** and **just before
  a match is rated** — the latter covers approvals and removals without a call in each.
- **Only a seed nobody has played on moves**, only for someone with no match in the sport
  (`seedToRefile`), and **only one THIS event placed**. Moving another event's unplayed seed
  would make whichever event is played second start from the original placement. The move is
  conditional SQL, so a match rated at the same moment is never overwritten by the seed.
- **"This event placed it" takes two tests; the first shipped alone and was fooled.** (1) This
  row is filed under the very key the seed sits in, and (2) **no other event's `players` row is
  filed under that key** — asked inside the same UPDATE as a `not exists`. Test 1 alone was
  found wanting by an adversarial review of the merge, not by a test: a player seeded in an
  unplayed women's-singles event, then picked as the FIRST entrant of a "one or two" event,
  is filed "ws" there too on that event's own first guess — so when her partner arrived, the
  singles event's seed moved to mixed and would have counted in her level for ever. Where two
  unplayed events both hold a seed it now stays put; that player gets the old behaviour, and
  nobody's seed moves from under another event. `addPlayer.test.ts` pins it, and fails with
  test 2 removed.
- Seeds already misfiled in production are **not** cleaned up: anyone who has since played is
  left alone by design. There is only test data there today.

### Fixing the live formats (from 2026-09-22)

Faisal chose to fix the formats already live before building new ones (Cup/Plate next). The
full plan — 14 steps, studied by six readers, attacked by two critics, with his answers — is
`C:\Users\khanf\.claude\plans\fix-live-formats.md`. Decisions: typing the final score is the
default; organisers build an uneven knockout BY HAND (no automatic byes, no "best runners-up");
walkovers count in the table and move no rating; a correction that would change who is in a
match already under way is refused; an open category of mixed-up pairs gets its own rating.

**Step 1 — one definition of a result** (`lib/results`). `matchResult` (typed pair when both
boxes are filled, else the replayed score once over), `hasPlay` (the single "started" test —
EITHER typed box counts; the old three checks looked at box A only) and `matchLine`. Seven
copies used it by hand; the manage list got it wrong and showed a typed 11–7 as 0–0.

**Step 2 — each CATEGORY moves its own rating.** The type was decided once per EVENT from
everybody on it, so Men's Doubles beside Women's Doubles moved everybody's MIXED, and the seed
refile moved their starting levels to mixed too. `categoryFormat(players, event, genderRule)`
in `lib/rating/tournament` decides per category, and every caller hands it ONE category
(`categoryRoster(divisionId)`): the engine, `insertPlayer`, `seedByRating`, approval, and the
ratings page, which is now one table per category (`[data-category]`).

- Order: OSL → `gn`; teams bigger than a pair → `gn` whatever the rule; the RULE (M → ms/md,
  F → ws/wd, MX → mx; a woman let into Men's Doubles is rated men's doubles there); no rule →
  singles by who entered, pairs by **`pairsFormat`** in `lib/rating`.
- **`pairsFormat` reads what the PAIRS are**: all men's md, all women's wd, all mixed mx, a
  MIXTURE `od` — **Open doubles**, a new key in every doubles sport's `formats`. Faisal was
  asked about "an open category where some pairs are two men and some are mixed". The first
  version rated ANY no-rule category with men and women as `od` — which would have moved every
  wizard-made mixed event (its "Main" category has no rule) off the mixed rating. An
  adversarial review caught it; two e2e suites failed on it too. **All-mixed pairs are mixed.**
- Community courts use the same `pairsFormat`: a men's pair against a mixed pair is `od`, not
  mixed. Tournament and community rate the same four people the same way.
- The refile guard's "somebody else holds this seed" is now ANY other players row — another
  event OR another category of this one (`other.id <> row.id`).
- A person on both sides of a match is skipped with a reason; it used to throw on the unique
  index inside a swallowed catch.
- The ratings page's Start is the rating BEFORE the first match in that category, counting
  only history under the category's own key. Worked backwards from today's number it was wrong
  whenever two categories share a key (Men's Doubles and Men's Doubles 40+).
- Production had 24 events, one category each, and no rated matches (checked by query), so
  nothing was ever rated under the wrong key and nothing needed repairing.

**Step 3 — a redraw never destroys a result** (migration `0020`, `lib/draw/guard`).

- The three draws used to check, then delete, outside any transaction: "Draw groups &
  fixtures" deleted PLAYED group matches (their `rating_history` cascaded away, the players'
  ratings stayed moved); "Draw knockout" kept a played row and inserted a whole new set beside
  it, so two "Final" rows existed and the resolver and the podium each believed a different
  one; a straight-knockout draw left the old groups behind and deleted hand-added matches.
- **`matches.bracket`**: NULL for a group fixture or a hand-added match, `"main"` for the drawn
  knockout (Cup/Plate will add `"plate"`). A partial unique index on (category, round) WHERE
  bracket IS NOT NULL — on the ROUND, not (bracket, round), because `W:`/`L:` refs and the
  resolver find a match by its label within the category, so a Plate bracket must prefix its
  labels ("Plate Final") rather than reuse them. A hand-written CHECK keeps group fixtures out
  of every bracket. Group fixtures legitimately share labels and are outside the index.
- `0020` backfills existing drawn rows to `"main"` BEFORE building the index. Where a label is
  duplicated: the PLAYED copy wins, then the one with seed slots (the draw's, not a match an
  organiser typed "Final" into), then the newest. Only SLOTTED unplayed losers with no rating
  history are deleted; a row without slots may be hand-added and is left alone. **Never re-run
  it once the new code is live** — hand-added matches keep `bracket` NULL, and a re-run would
  pull them into the bracket or delete them. `migration-0020.test.ts` builds the mess at 0019
  and upgrades it. Production had no matches at all when it was written.
- Every draw goes through `runDraw`: ONE transaction that locks the category row `FOR UPDATE`
  (a double tap waits), `requireDivision` REFUSES an unknown or foreign category (the old path
  quietly redrew the first one), `lockedIds` refuses while anything the draw would replace has
  play or rating history, and `deleteUnplayed` re-checks every row INSIDE the DELETE and throws
  `DrawChanged` — rolling the draw back — if one gained a result after it was read.
- A refusal is a code (`?problem=draw-locked|draw-changed|draw-stale|unknown-category|
  confirm-needed&category=…`); the manage page builds the sentence, and `ProblemNotice` says it
  ONCE — it takes the code off the address, or it stayed on screen through every later action,
  including a redraw of the same category that worked.
- The page shows the reason in place of a draw button the server would refuse
  (`[data-draw-locked]`), counting a match with rating history as played exactly as the server
  does. A redraw is two taps (`DrawButton`): **the confirming submit button does not exist
  until the first tap.** A button hidden inside a closed `<details>` is still the form's default
  button, so the first version let Enter in "Qualify per group" redraw with no second tap. The
  button is keyed on the rows it would replace, so after a redraw it comes back closed rather
  than one tap from the next.
- **The confirmation is a FINGERPRINT of what the page saw, not a flag.** The confirming button
  submits `confirm=<drawSignature of the rows it would replace>` (`lib/draw/guard`, FNV-1a over
  the sorted ids), and `seenBy` in `runDraw` compares it with the rows in the database: nothing
  to replace → no confirmation needed; no token → `confirm-needed`; a different one →
  `draw-stale`. The first version accepted a fixed `confirm=replace`, so a phone left open on
  the manage page from BEFORE the first draw, or before a colleague's redraw, replaced a draw
  its owner had never seen with one tap — the two-tap rule protected only the page that was
  up to date.
- The podium and honours pick the same Final: honours' one query applies "earliest hand-added
  only" too (created_at, then id `collate "C"`, matching the podium's sort). Two hand-added
  Finals used to give two golds on profiles against one champion on the event page.
- Step 3 was reviewed adversarially: 8 findings, 6 confirmed and fixed above, 1 refuted (a
  match being scored with no signal cannot be protected server-side — the page says "nothing
  in it has a recorded result" rather than "has been played" for that reason). What became of
  the eighth was not written down, and a search of the session history did not find it.
- What each draw replaces: groups → the category's groups, fixtures AND the knockout drawn from
  them; straight knockout → the same; knockout → its bracket rows only. A hand-added match is
  never touched. `removeMatch` and `setLineup` are scoped to their event.
- `manage/actions.ts` now imports `redirect`, so any test loading it must mock
  `next/navigation` — the real module fails outside a request (`createContext is not a
  function`).
- Tests: `draws.test.ts` (through the real actions, each against its old behaviour),
  `migration-0020.test.ts`, `e2e/redraw.mjs`. Three of the rules were checked by putting the
  old code back; each fails its test.

**Step 4 — the knockout is read from the drawn bracket, not from names.**

- **ONE rule for what a knockout label means: `rowsByLabel`** (`lib/brackets`). Within a
  category, the DRAWN row with that label; only where there is none, the EARLIEST hand-added
  row (bracket null, group null; `createdAt`, then id). Four readers use it and nothing else
  decides: `W:`/`L:` resolution (`refResolver`), the scheduler's tie keys, the podium's
  `decider`, and — in SQL, with `collate "C"` on the id so it sorts the same — `honours.ts`.
  - The drawn half stops a hand-added match typed "Semi-Final 1" taking over
    `W:Semi-Final 1` — the Map kept whichever row came last.
  - The hand-added half is load-bearing too, and the first version of step 4 left it out of
    the resolver and the scheduler: deleting a drawn semi-final and adding it back by hand is
    today the only way to change who plays it, and without the fallback the Final waited on
    the deleted row for ever while the scheduler timed it alongside the semi feeding it.
  - **A hand-added "Final" still decides a category with no drawn one**: until step 11 builds
    complete brackets, it is the only way to finish a category whose draw stopped at
    quarter-finals. Rating weight (`phaseOf`) still reads the label, deliberately unchanged.
- **`bracketRounds`** (`lib/brackets`) groups rows by depth in the `W:` feeder graph and names
  each round by its WIDTH: the top round's row count rounded up to a power of two, doubling per
  round down — 1 is the Final, 2 Semi-finals, 4 Quarter-finals, then "Round of N". Third Place
  (fed only by `L:`) sits with the top round, listed last. Naming by depth alone called the top
  round "Final" whatever it was, so a quarter-final-only draw (4 groups × 2, possible until
  step 11) or a category whose drawn Final was deleted printed its quarter- or semi-finals
  under "Final". The print pack used to name distinct labels counting back from the end across
  ALL categories, so "Semi-Final 1" printed under "Quarter-finals" and two categories' finals
  shared a section. It prints per category, per bracket, per round now, with hand-added
  matches under "Other matches".
- A second adversarial review, of steps 3 and 4 together: 4 findings, all confirmed, all fixed
  — the stale-page redraw (the fingerprint above), the round naming, and the missing hand-added
  fallback in the resolver and in the scheduler. Each fix was checked by putting the old code
  back and watching its test fail.
- `e2e/event.mjs` asserts the exact headings. Its first run happened to be against the OLD
  print code (the build predated the change; the test file did not) and failed with
  `["Quarter-finals","Semi-finals","Final"]` — the bug, on record.
- Test fixtures that build `Match` objects without `bracket` get `undefined`, not null: the
  podium's rule compares loosely (`== null`) so a fixture and a database row read the same.

**Step 5 — taking a rating back is exact and safe** (`lib/rating/apply.ts`; no migration, no
visible change).

- **The old faults, each now a failing test on the old code.** `rating/revert.test.ts` uses only
  calls the old code also had, and 22 of its 26 tests fail there, each for its own reason:
  - two reverts of one match both subtracted it (rows read BEFORE the transaction, subtracted
    inside it);
  - two results for one player landing together kept only the second (people read before the
    transaction and written back as absolute values — the match count came out one short);
  - a revert left the partner record, "last played" and the reliability snapshot where the
    match had put them, and left behind any rating the match had CREATED (below);
  - a result corrected between the apply's read and its write was applied with the OLD score;
  - a second community save could land its score after the first save's rating, and a
    regenerated evening could delete a fresh score's history while its ratings stayed moved.

  The other four pass there by design: they guard what the old code already did right —
  applying when only the serve moved (the choice of result over `rev`, below), taking back an
  older match without touching a newer one, keeping a seed whose only match predates the seed
  flag, and a reliability snapshot of the whole record.
- **ONE lock order for every rating writer: the match row, then the people — all of them in one
  `ORDER BY id … FOR NO KEY UPDATE` statement.** `lockMatch` and `lockPeople` are the only two
  places either lock is taken. Postgres locks rows in the order the sort returns them, so two
  writers queue rather than circle. A deadlock here would not be an error anybody saw: the
  score save swallows a rating failure and ratings move only on the finish-line transition, so
  nothing would retry it.
  - **NO KEY UPDATE, never FOR UPDATE.** FOR UPDATE is the one row lock that conflicts with the
    FOR KEY SHARE a foreign-key check takes on the row an INSERT points at — so every skill
    rating, game join or event entry naming one of the players waited behind a rating, and a
    skill rating (which checks its subject before its rater, in whatever order they are) could
    close a circle with it. NO KEY UPDATE is what the plain UPDATEs the old code ran took
    anyway: it conflicts with every rating writer and with nothing that merely refers to a row.
    Caught by a reviewer from the Postgres lock table; PGlite runs one transaction at a time and
    cannot show it.
  - **Any OTHER transaction that writes more than one person takes them through `lockPeople`
    too.** Approving an entry fills in dates of birth, and did it one by one in ENTRY order, so it
    could hold one player while a rating held the other — and the database often kills the
    rating, which nothing retries. It locks them all first now (`registration/approve.ts`).
  - Writers that hold one row per statement outside a transaction (`refileSeeds`, a score
    write) cannot close a circle. Regenerating a community evening locks its match rows
    (`FOR UPDATE`, because it deletes them) and never a person.
- **What the tests can and cannot see.** PGlite serialises transactions, so a read taken BEFORE
  a lock is invisible to every behavioural test — a reviewer showed a revert that read the
  history before locking passed all 22 of the first tests. So `rating/locks.test.ts` records
  the SQL each transaction sends (and its parameters) and pins the order itself: the first
  statement locks the match; the first statement to touch a person is the one sorted lock, and
  it covers everybody the transaction then writes; no player's history is read before it;
  nothing takes FOR UPDATE; nothing about a player is written outside the rating's transaction.
  Regenerate and approval have lock-order tests of their own. **34 plausible wrong versions**
  were applied to the real files (a scratch runner, restoring each) and every one is caught by
  the test aimed at it — reading before either lock, locking some players or in the wrong
  mode or order, each field of the result check, the replay order and its tie-break, every
  branch of the created-format rule, the timestamp, both community guards, the approval.
- **Everything is computed INSIDE the transaction, after the locks** — ratings, match counts,
  today's movement for the ±60 cap, recent meetings for the damping, and now the under-rated
  flag and reliability snapshot too (`derivedFor`). Those were refreshed after the commit from
  an unlocked read, so an apply and a revert crossing each other could leave the older answer;
  a player with matches on record was shown with none. They are advisory, so a slip in that
  arithmetic returns null and the rating is written without them rather than rolled back.
  Doing it in the same write is also FEWER round trips than refreshing after — the health probe
  measures ~185ms per query from the live site, and the referee's final tap waits on this.
- **Revert: `DELETE … RETURNING`, so only the transaction that deleted a row subtracts it**, and
  the match row is locked before that, so a second revert waits and then finds nothing.
  `revertResultIn(tx, ref)` takes the caller's transaction (step 7 will fold it into the write
  that changes the match); `revertMatchRatings` / `revertCommunityResult` wrap it.
  - **A format the matches CREATED goes when its last match does.** The subtraction left the
    key at its old value with a count of nought, and for a player seeded by DUPR or an
    organiser every key counts (`sportRating`) — a first mixed game typed and cleared left a
    mixed rating nothing stood behind, counting toward their level for ever. Every history row
    carries `notes.seeded` for its whole CHAIN: did the format's number exist before the chain's
    first match? A chain with rows passes its answer on (`seededChains`, one grouped query), so
    it holds however the matches are later taken back — oldest first, or an old one corrected
    and re-applied under newer ones. A row older than the flag counts as seeded: never delete.
    Safe because nothing places a seed on a key history created (seeds are written only by
    `newPersonRow` and moved by `refileSeeds` into an EMPTY key — checked).
  - **The partner record is REPLAYED from what is left** (`partnerStatsFromHistory`), not
    un-merged. It stores rounded averages, so taking one match back out by arithmetic is a
    point out and a second undo builds on the first's error — three in a row drifted by two.
    Replay skips the engine's first rows (before be4bff2), which name partners but record no
    ratings and were never merged.
  - **History is stamped with `clock_timestamp()`, not the column's `now()` default** — `now()`
    is when the TRANSACTION began, so two applies that begin in one order and lock in the other
    were stamped the wrong way round, and the replay (which follows the stamps) disagreed with
    the merges by a point.
  - "Last played" becomes the latest remaining history row, or never; a player left with no
    history loses the under-rated flag and the reliability snapshot (null, as a new person has).
- **The check under the lock asks about the RESULT, not the `rev`** (a deliberate departure
  from the plan). `applyResult` takes an `unchanged(locked)` predicate; the tournament one
  re-settles the locked match row and compares winner, loser, both scores and the stage — each
  field has its own test. A rev check looks equivalent and is not: `rev` also moves when the
  serve is set on a typed-score match (`setMatchSetup` is allowed whenever the log is empty)
  and when a side switch is confirmed, and neither re-applies anything — so the rating would
  silently never land.
  - A change to the result makes the apply skip with `changed`, and the write that changed it
    is the one that rates it: a correction reverts and re-applies (`writeResult` since step 7), and an undo that takes
    the match off the finish line reverts.
  - "Already applied" is asked again under the lock, so a second apply of one match returns
    `already` instead of throwing on the unique index inside a swallowed catch.
- **Community**:
  - `saveScore` asks "already counted?" and writes the score in ONE transaction under the
    game's lock. They were two statements holding nothing, so a second phone could pass the
    check before the first rating committed and write its score AFTER it: the game showing one
    winner, the ratings moved for the other, and the second phone told it had saved. Between
    that write and its own rating, the apply's `unchanged` check (the stored score must still
    be this save's) covers another save or a clear landing in between.
  - `clearScore` reverts and nulls the score in ONE transaction.
  - `generateSchedule` asks "any game scored?" again under the lock before it deletes. Its check
    held nothing, and ON DELETE CASCADE took a just-saved score's history with the game while
    the players kept the movement — which nothing could ever take back. **"Scored" is the
    SCORE**, read off the rows it has just locked: a save writes the score and rates it in two
    transactions, and a regenerate between them found no rating yet and deleted the game, score
    and all. The rating check stays as a backstop (history without a score is not reachable
    today: save writes the score first, clear removes both at once).
- **Reviewed adversarially, twice.** Round one (four reviewers, each proving or refuting its
  own findings) on the first version: 14 distinct findings, all confirmed; 12 fixed above.
  Round two (three reviewers) on those fixes confirmed the core — NO KEY UPDATE still
  serialises every rating writer, every ordering of the seed chain holds, the in-transaction
  signals equal the old refresh exactly — and found the approval's lock order, the
  score-versus-rating gap in regenerate, and seven test gaps; all fixed. Round one's other 2
  findings are older than step 5 and belong to step 7,
  which rebuilds exactly that code, and are recorded in its plan: `syncRatings` decides
  "finished" from the rally LOG alone, so an offline log overwriting a typed score leaves the
  old rating in place; and a revert queued behind an undo can delete the rating of a match that
  has since been finished again.
- **Still not exact, by design** (the plan's accepted limits): later matches keep the deltas
  they were computed with against the reverted rating, and a player can end a day up to one
  reverted delta outside the ±60 cap. Recomputing would ripple through every opponent.

**Step 6 — the rules decide which final scores are possible** (`lib/scoring/final.ts`; no
migration, no visible change yet — step 7 puts it in front of the organiser).

- **`finalScoreProblem(ending, a, b, sets?)` is the ONE answer to "could this final happen?"**,
  returning null or `{code, sentence, suggestion}`. The rating engine's `validScore` is now
  `w > l && finalScoreProblem(...) === null`, so the table and the ratings can never disagree.
  The old check asked only "did the winner reach the target by the margin", which accepted
  15–4 in a game to 11 and 23–20 in badminton (over at 22–20), and — with no rules — any result
  where the winner scored more, so a best-of-3 tennis match "won" 3–0.
- **An ENDING says what kind of match it is** (`endingFor(sport, rules, {bestOf, carromBoards})`),
  shaped by Faisal's answers of 2026-09-29:
  - `points` — one game, a point a rally (pickleball, badminton, table tennis). Judged by walking
    the one path that stays level longest (alternate to the loser's score, then the winner runs
    on) with the engine's own `rallyOver`. The engine's "over" is monotone in the lead and the
    score, so every other path passes states at least as over; `final.test.ts` does not take that
    on trust — it enumerates every reachable final by brute force for twelve rule sets (each
    sport, OSL on two sports, Pickleboss, and `buildScoring` variants) and requires agreement on
    every score to 40–40, and that nothing is accepted that the old check refused.
    - **A golden point BELOW the target ends the game below it** ("to 21, golden at 19" is over at
      20), and there the old check was wrong the other way: it refused 20–0 and 20–19, finals the
      console really ends on. Two of the twelve rule sets are this shape; the "never accepts what
      the old check refused" property is scoped to a cap at or above the target, with a test
      pinning the old check's refusal. The sentences name the score the game really ends at
      ("a game to 20 ends…"), not the target.
    - **A score is 0 to 999** (`MAX_SCORE`). The walk is linear in the score, so without a
      ceiling a crafted score in the millions made the server walk that many rallies.
  - `games` — games won in a best-of-N match. Faisal: best of 3 happens, typed as games won
    (2–1), and is chosen **per stage** (e.g. groups one game, knockout best of 3). No stage setting
    exists yet, so every caller gets one game until step 10 adds it with the typing screen.
  - `boards` — carrom, **both endings** (Faisal: "can be both"): first to 25, where the last board
    can carry the winner past 25 and it never ends level; or a fixed number of boards, most points
    wins, level allowed. A level carrom result is a result for the table and moves no rating.
    Today every carrom event is first to its target; the fixed-boards setting comes later.
    - **`boards` is carrom's OWN scoring only** — one point decides (`winBy` 1, and a cap that is
      absent or equal to the target). A carrom event the organiser set to win by two, or to the
      Pickleboss preset, is played point by point on the console, which ends it at 27–25 or
      17–15; judged as boards those were refused and the match lost its rating. Such an event
      is judged as `points`, exactly as the console plays it. `final.test.ts` brute-forces seven
      carrom setups: the point-by-point ones must agree EXACTLY with what the console reaches,
      carrom's own must accept at least all of it (plus a last board past the target).
    - The cap that comes with carrom's own scoring is IGNORED: saving the scoring form with "win
      by two" unticked stores cap = target, and OSL does the same, and read as a ceiling that
      refused a real 29–18. The console still stops at the cap when it scores a carrom game
      point by point — that was true before step 6 and is not changed here.
  - `sets` — tennis and padel: sets won, and when given the games in each set (Faisal: record
    them, 6–4 3–6 10–8). A set is 6–0 to 6–4, 7–5 or 7–6; a match tie-break to 10 won by 2 only as
    the deciding set; nothing after the match is won; the sets won must agree with the games.
  - `result` — chess, until step 10 gives it result buttons and rated draws (Faisal: draws move
    ratings). It keeps exactly the old check meanwhile.
- **A result recorded as games or sets won carries a NEUTRAL margin** (`marginFor`, the
  `margin` option of `calcRtgChange` and `ApplyInput`, 1000 in the history row). 2–1 in games is
  as close as 21–19 21–19 or as wide as 21–2 21–3; read as a points margin, both scored the same
  and a straight-sets win weighed like a rout. Points results are rated exactly as before.
- **In a game won by two, the loser's score fixes the winner's**, so no correction between two
  POSSIBLE finals moves the winner's score alone. The step-5 test of that check moved to
  first-to-25 carrom (29–18 corrected to 27–18), the one ending where it can happen.
- **A rally log is cut at the rally that ended the game** (`finishedAt` in `replay.ts`, used by
  `pushLog`). A phone scoring offline could queue a tap after the winning rally — the court was
  still tappable while the server had not seen the finish — and 11–4 landed as 12–4: a final
  that cannot happen, so no rating, and an undo back to 11–4 never re-applied it. Before step 6
  the old check accepted 12–4, so this only became a loss when the check got stricter. Three
  guards, one per place the extra tap could come from:
  - the server keeps the log up to `finishedAt` and drops the rest (`pushLog.test.ts`: an
    exact 11–4, a 12–4 cut to 11–4 and rated, an undo then re-push still rated, an unfinished
    log stored whole — the middle two fail on the old `pushLog`);
  - `useOfflineScoring` refuses a tap once the replayed local log is over;
  - `RefConsole` locks the court once the LOCAL log is over or an OSL rotation (7, 14) is
    waiting — the same test as the server's `locked` in `matchState.ts`, which offline could
    not see.
    `e2e/offline.mjs` scenario 3 plays a game to the end with the network off, checks both
    halves are locked, reconnects and reloads, and checks the server holds exactly the
    finishing rally count.
- Not yet judged: community scores. A community game has no target setting, and judging it
  by the sport's default would refuse a real game played to 15. They are rated as before.
- **Reviewed adversarially** (ultracode). Two real faults: the extra offline
  tap, and win-by-two/Pickleboss carrom — both fixed above. Smaller: the carrom form cap, the
  missing ceiling, the wrong ending named when a golden point sits below the target, and about
  ten test gaps (the tennis neutral margin was checked in the history row but not in the
  rating that actually moves, among them) — all fixed.
- **Two questions the review raised, answered by Faisal on 2026-09-30.** Both confirm the model
  as built:
  - carrom — **the organiser picks one** per event: first to the target, or a fixed number of
    boards. Never "25 or 8 boards, whichever comes first". Step 7 adds that setting;
  - tennis/padel — **best of 3 sets only** (sets of 6, with a match tie-break to 10 as the
    decider). A one-set match, a pro set or short sets are not needed, so there is no set-format
    setting.
- Proof: `final.test.ts` (65, the brute forces among them), `rating/final.rating.test.ts` (8)
  through the real engine — 4 of the first 5 fail on the old code: 15–4 and a 3–0 best-of-3
  were rated, and 2–1 in sets was read as a points margin; the carrom ones pin 29–18 rated and
  26–25 refused under carrom's own scoring, and 27–25 rated and 29–18 refused under win by
  two — `replay.test.ts` (`finishedAt` against the full replay on random logs),
  `pushLog.test.ts`, and **44 plausible wrong versions** of the walk, the endings, the carrom
  shape, the trim, the ceiling, the wording and the wiring, each caught.

**Step 7 — one way to save a result, and the referee's phone respects it** (migration `0021`).
Faisal approved a picture of the screens first (the "Saving Results" artifact, 2026-09-30).

- **ONE writer: `writeResult`** (`app/t/[slug]/actions.ts`). Every rally, undo, correction and
  typed result goes through it, and it asks one question — did the RESULT change
  (`matchResult` before and after, outcome included)? Unchanged (every mid-game rally): one
  rev-guarded UPDATE, nothing else — unless the result is a FINISHED one, when the engine is
  asked again (two queries when it is already rated; a repair when it is not). Changed: the UPDATE
  and `revertMatchRatingsIn` in ONE
  transaction — the UPDATE is the transaction's first statement and takes the match row's lock,
  so the rating engine's order (match, then people) holds; the revert runs EVERY time, which
  also repairs a match an old bug left with history and no result. The new rating is applied
  after the commit, and `applyMatchRatings` re-checks the result under its own lock. Fixes, each
  a test in `results.test.ts`:
  - rallies from a phone nulled a TYPED result on every write, and its rating stayed;
  - ratings moved only on the finish-line transition, so 11–7 corrected to 11–9 never re-rated;
  - "finished" was read off the rally log alone, so a match with a rating and no result
    answered "already" when it finally finished, keeping the wrong movement;
  - the revert ran in its own transaction after the write, so one queued behind an undo could
    delete the rating of a match finished again since (step 5's second carried finding).
  - `locks.test.ts` pins the shape: the correcting transaction starts with `update "matches"`,
    locks people in one sorted statement, and nothing reverts outside a transaction.
- **`recordResult`** replaces `setTypedScore` (which had no caller, no rev guard, wiped the log
  and refused every level score). Organisers and PIN referees alike (Faisal: "either, freely").
  The rules for typing live in `lib/results/record.ts`, pure: both teams known; a level score
  only where the sport has draws AND in a group ("A knockout match needs a winner"); the final
  judged by `finalScoreProblem` against the MATCH's ending; a result with an `outcome` may stop
  SHORT of the end (9–7) but never pass it and never be level. Replacing live rallies is a
  choice (`replaceLive`), never a side effect — without it the reply is code `live` naming what
  would go. **Idempotent**: the same result again is ok at the current rev, so a retry after a
  lost reply is not an error. The screen that calls it is step 10.
- **`matches.outcome`** (`walkover | retired | unrated`, CHECK in 0021, only on a typed result):
  counts in the table, moves no rating — `writeResult` never applies one and the engine skips it
  whoever asks. A walkover is stored at the winning score (`walkoverScore`: 11 in a game to 11,
  2 in a best of 3, 25 in carrom to 25, 1 over a set number of boards). `matchResult` carries it
  and prints "11–0 w/o" / "9–7 ret." everywhere.
- **`matches.sets`** holds tennis/padel games per set; sets WON stay in typed_score_a/b and must
  agree with them for a rated result, and for a match the sets show DECIDED. A match stopped
  before it was decided (a retirement) may be awarded either way; the deciding set is a match
  tie-break, so a decider short of 10 is a tie-break being played, not a set won. The rating
  engine checks the sets too.
- **The rules stay with a FINISHED match** (`matches.rules`, `MatchRules = {rules, boards}`).
  Faisal: a change applies to every match not yet finished, including one being played, and
  finished results stand. `matchRules(t, m)` = the frozen scoring, else the event's today;
  `rulesFor(t, m)`, `endingOf(t, m)` and `viewMatch` all read it, so the table, the rating, the
  console and a typed correction judge one match one way. `writeResult` freezes a match the
  moment it first has a result and KEEPS the freeze while it has any play — an undo that reopens
  a finished game corrects it under the rules it was played to (and the phone's log is cut at the
  end of THAT game). Dropped only when the match has no play at all.
- **Changing the scoring** (`lib/scoring/change.ts`, used by Save and by "Back to the sport's
  defaults"), ONE transaction: the EVENT row locked and re-read, then every match of the event
  in id order (event and match rows only, so it cannot circle with a rating): finished matches
  not yet frozen (from before step 7) are
  frozen under the OLD scoring; a match being played plays on under the new one — or, if the new
  rules end it where it stands, it is finished, frozen, its clock stopped and rated after the
  commit; or, if they would already have ended it (14–4 moving to 11), NOTHING is saved and the
  organiser is told which match — and likewise when the new rules would re-count a live game's
  rallies. EVERY match's `rev` moves. The save returns plain lines the
  card shows ("Saved. This event now plays to 15." / "1 finished match keeps its result." / "Aces
  v Bees is being played now, 7–1. It plays on to 15.").
- **Carrom over a set number of boards** (Faisal: the organiser picks one per event): the card
  offers "A set number of boards" or "First to a score", stored as `scoring: { boards: 8 }`
  (no migration; `boardsOf`). Choosing boards hides the point settings.
  - **HELD BACK until results can be typed in** (`RESULT_ENTRY_ON_SCREEN = false` in
    lib/results/record; step 10 turns it on). A match over a set number of boards has no live
    court, so its result can only be typed — and no screen types one yet. Chosen, it left every
    match of the event with no way to record a result, and a game being played lost its court
    mid-game. The card does not offer it and `setScoring` refuses it; the engine underneath
    (`changeScoring`, the freeze, `noLiveCourt`) is built and tested through `changeScoring`.
- **No live court** (`noLiveCourt`) for tennis, padel and carrom over boards — the court counts
  points and cannot finish them. The score page shows the note instead of a court, saying the
  result is typed in and that typing is NOT on the manage screen yet (it said "on the manage
  screen", promising a control that does not exist), with "Back to the event"; `scorePoint`
  and friends refuse; `pushLog` refuses. And **rallies finish a match only where the court can**
  (`matchResult`): a carrom event moved to boards still replays its rallies against carrom's
  default target, and a live 26–10 read as a finished game, frozen and rated. A match FROZEN under
  first-to-25 keeps the result it finished with.
- **A knockout match whose slots are not filled has no court either** (`teamsNotIn` in
  lib/matchState — one sentence for the page and every refusal of a rally; `recordResult` has its
  own). Its page says what unlocks it: the
  organiser's "Fill resolved slots" on the manage screen, NOT the feeders finishing — the first
  wording told a referee to wait for semi-finals already over. Filling is manual until step 9.
- **The phone** (lib/offline/queue + `useOfflineScoring` + `RefConsole`):
  - `PushResult` is declared ONCE, in `lib/offline/queue.ts` (already client-safe), and gained
    `typed` and `refused`. A reply the phone did not know used to fall into its retry path.
  - **`typed`** is asked BEFORE the rev guard, so a stale push cannot slip past it by being
    retried at the new rev — which is exactly how a reconnecting phone used to wipe a typed
    result (stale → the typed match's empty log read as "ahead" → retried → overwrote it). The
    record is kept `held`; nothing sends a held record on its own (the retry timer; `flushAll`,
    which nothing in production calls, skips them too);
    the console shows "Typed in: X win 11–7" with "Keep 11–7" and "Use this phone's score
    instead" (a push with `replaceTyped` at the rev the refusal named — typed again since, and
    the server answers `typed` with the new result, so nothing unseen is replaced).
  - **`refused`** (the match was deleted, or has no live court) drops the rallies and says why,
    once, with "Back to the event". A deleted match used to answer `error`, retried every
    fifteen seconds for ever.
  - `settleReply` maps every reply to an outcome for `flushMatch` and the card choices alike —
    except "stale", which each caller judges (`flushMatch` by the rules below; the conflict
    dialog and the typed card by "did only the rev move?").
  - Queued records carry `sides` (the two team ids shown) for step 9.
  - **What the phone KNOWS the server holds** (`baseLog` + `sent` on the record, `knownToPhone`):
    the log at its base rev, and every log it has sent since, any of which may have landed with
    the reply lost. A server holding one of them holds nothing this phone has not seen, so the
    phone's newest log is its own next step and is retried at the new rev, WHATEVER `classify`
    makes of the two. Without it the rev was the only signal, and two things move the rev without
    a rally: a scoring change (every match of the event) and a write whose reply was lost. An
    undo after either is SHORTER than the server's log — "behind" — and was dropped as redundant,
    so the point the referee took off came back (a mis-tapped winning rally stayed won and rated).
    A log the phone has not seen is another device's, and is judged by `classify` as before —
    except one SHORTER than the log the phone knew the server held: another device took rallies
    off, and pushing ours ("ahead" of it) put them back with nobody asked, so it is a conflict.
  - **A pause with nothing queued is CLOCK-ONLY** (`clockOnly` in `flushMatch`): it sends the log
    the server was known to hold, and on a stale reply sends the server's own log back instead —
    never judged as rallies. Judged, it wrote a removed rally back, or asked the referee about
    rallies they never scored.
  - **The server says what it STORED** (`log` on an ok reply) when it cut a log at the finish.
    The phone took the uncut log as the server's and built its next undos on taps the server had
    thrown away; each was cut back to the same finish and changed nothing.
  - **"flushed" says whether THIS write `landed`.** A log the server already held, or more,
    wrote nothing: its time goes back to the clock. A tap made meanwhile goes at the server's rev
    only when the server holds exactly what this phone sent — landed now, or by an earlier attempt
    whose reply was lost (an undo during that retry used to be dropped as "behind"). Anything
    else is judged by `flushMatch`'s rules, sent from the base the tap was built on — sent at the
    server's rev unjudged, it wrote over another device's rallies with no dialog. A conflict offers the NEWEST log, the one the court
    shows. A pause tapped while a push was out goes when it lands (`hasPending` on the clock).
  - **ONE decision for rallies found on the phone** (`resume`): after a reload, when a hold is
    released, and when a replace finds the typed result gone — send them (ahead, or known), ask
    (diverged), or let them go (the server already has them). A reload used to adopt only a log
    strictly AHEAD, so an undo made offline was thrown away, and so was a genuine disagreement,
    silently, with the referee's rallies in it.
  - **A tap builds on what the server is KNOWN to hold, never on the last render** — for a moment
    after every write that lands, the render is a write behind; and a render never moves the
    base BACK (one older than the write that just landed is ignored). A render at the SAME rev is
    taken: one rev is one row, so it is the truth about that rev.
  - **A hold follows the match** (an effect on the rev and the typed result): typed again → the
    card shows the new result; rev moved by a scoring change → same result, new rev, and "Use
    this phone's score" lands rather than claiming a re-type; typed result replaced by another
    phone → the hold is released and the difference is put to the referee as a conflict.
  - **Only QUEUED rallies are held** (`kept` on a "typed" outcome). A pause sent with nothing
    queued carries the server's own log; filed as held, a reload offered to "put back" rallies
    the organiser had replaced on purpose.
  - Record rewrites after a push are ONE IndexedDB readwrite transaction (`rewrite` in the
    queue): a read and a separate delete let a tap's save fall between them and be deleted. The
    tests run with no IndexedDB, so this one is argued from IDB's creation-order rule, not tested.
    The reload's own read-then-save is two transactions, made safe differently: **the court takes
    no tap until the stored queue has been read** (`ready`) — a tap in that first moment built on
    the render's log, and one of the two was lost.
  - **A choice whose reply never came may have landed** (`uncertainRef`). "Use this phone's
    score" or "Keep this phone's score" that got no answer says so ("may or may not have been
    saved") rather than "not replaced", and the OTHER choice made next first asks the server: Keep
    the typed result probes without `replaceTyped` (answered "typed" while it stands, writing
    nothing); "Keep the saved score" writes the other device's log back if ours had landed.
  - A typed match's court is locked and shows the typed score; the pre-match panel is hidden.
- **Test fixtures and the bundle-leak cap.** A separate `pushResult.ts` failed
  `bundle-leak.test.ts`'s ceiling of four client-safe modules; the type moved into `queue.ts`
  rather than raising the cap.
- Proof: `app/t/[slug]/results.test.ts` (53, through the real actions and the real manage
  action), `record.test.ts` (13, pure), `queue.test.ts` (+14), `useOfflineScoring.test.ts` (40),
  `RefConsole.test.ts` (7: the typed card's heading, `sendTap`), lock-order tests,
  `schema.test.ts` (the three 0021 CHECKs, each by name), `e2e/scoring.mjs` (a
  finished 11–0 still FINAL after the event moves to 15 — it read as live before; carrom's card
  not offering boards yet, and following what is stored after a reset; tennis with no court and
  no promise of a control that is not there). **36 plausible wrong versions** of the
  writer, the typing rules, the freeze, the scoring change, the queue and the display, each
  caught (one survivor, the "never malformed" guard unreachable through the action, now pinned
  in `record.test.ts`).
- **Reviewed adversarially** (four reviewers, every finding proved by a scratch test or a traced
  interleaving). Five majors, all fixed:
  - **A rally read before a scoring change and written after it was judged by the old rules**
    (three reviewers found it): a game the organiser had just been told "plays on to 15"
    finished at 11; one that counted as won under 11 had no rating and no freeze. The row locks
    only queued the write — it had already READ the scoring. `changeScoring` now moves the `rev`
    of EVERY match of the event, so the write goes stale and is worked out again on a fresh
    read, and it reads the event row under its own lock rather than trusting the caller's copy.
    `results.test.ts` lands the save in exactly that gap through a seam in `principalFor`
    (called between a scoring action's read and its write).
  - **Changing how points are scored re-counted rallies already played**: service → rally turned
    a live 5–3 into a finished 11–9 and rated it. "Apply to matches being played" is about how
    they END. A change that would count a live game's rallies differently is now refused,
    naming the match — a product call made conservatively; Faisal may prefer "keep that match on
    its old rules".
  - **A knockout match scored before its slots were filled could never be rated** — no teams,
    so the apply skipped it, and filling the slots later took the cheap path. Rallies are now
    refused until both teams are known (`courtRefusal`, `pushLog` → `refused`), the same rule
    `recordResult` keeps. Step 9 was to add this; it moved forward.
  - **"Use this phone's score" could never land after the result was typed AGAIN** — the replace
    went out at the old rev and got "stale", which left the card on the old score for ever.
    `pushLog` with `replaceTyped` on a re-typed match now answers `typed` with the current
    result, so the card shows it and asks again.
  - **Two older phone bugs** (pre-step 7): a rally tapped while the previous push was on the
    wire was deleted when that push landed (`settleReply` cleared the queue unconditionally),
    and an undo back to an empty log was never sent (`flush` dropped empty logs). The hook now
    keeps its newest log in a ref and LOOPS until what landed is the newest; the queue clears
    only when the stored log is exactly what landed (`clearIfLanded`). (The empty-log half was
    only half fixed — see round two.)
  Smaller, all fixed: a result recorded WITHOUT a rating now stops short of the end, never past
  it (111–4 "retired" was stored; tennis waives only the set it stopped in —
  `stoppedSetsProblem`); a "typed" reply holds the phone's NEWEST log, not the in-flight
  snapshot; a refused phone sends nothing more, not even a pause, and keeps its "N rallies"
  line; the typed card says "walkover to X" / "— the other side retired"; the no-court page
  names the winner; `expectedRev` is validated on every action that takes one (a fraction threw
  a raw 22P02, a string wrote rev "51"); setting the serve on a typed match is refused (it moved
  the rev under a held phone); a write of the same FINISHED result asks the engine again, mending a
  match left unrated (two queries when it is rated — a mid-game rally still does nothing extra); the scoring
  change takes back a stale rating before rating a game it ends, names a reopened game ("still
  finishes to 11"), and says when a live game loses its court to a set number of boards; the
  Scoring card follows the stored settings after a save (adjusted during render, so the status
  box stays); the print pack and the event poster say "8 boards"; and the event row is taken
  FIRST by the scoring change, the order of play and every draw, so they queue instead of
  deadlocking (the draw deleted, and the schedule updated, matches in their own order).
- **Reviewed adversarially again** (three reviewers on the fixes above; 29 findings, 37 refuted).
  The phone fixes had a hole each, and moving every match's rev had costs nobody had traced:
  - **An undo or a point off after a scoring save was dropped** (major) — the moved rev read as
    "the server is ahead". Fixed by what the phone KNOWS the server holds (above).
  - **An undo back to 0–0 that could not go at once was never sent** (major): the retry timer and
    the online event read an empty log as "nothing queued", and a reload threw it away.
  - **A knockout match whose slots resolve but were not FILLED refused every rally, said to wait
    for matches already over, and dropped a game scored offline** (major). Its page now has no
    court and says what unlocks it (above); step 9 fills slots automatically.
  - **After a "behind" reply the loop sent a newer tap at the server's rev**, over another device's
    rally; the conflict offered one rally fewer than the court; time for a write that did not land
    was dropped; a pause tapped during a push waited for the next point; a hold never followed the
    match; "Keep this phone's score" was wedged on a moved rev; a pause on a typed match filed the
    server's log as held; a read-then-delete in IndexedDB could delete a tap — all fixed above.
  - **Single-rally actions answer `stale: true` and the console reloads.** It said "reloading" and
    did not: a console that cannot score offline (carrom, chess, OSL) failed every tap after one
    scoring save, on every live court of the event at once.
  - **A stale `pushLog` names the match AS IT IS NOW** — it named the rev the push was judged
    against, so the phone's retry was stale again and settled only on its last attempt.
  - **`setMatchSetup` is guarded on the rev AND an empty log** — it checked "not started" on its
    read and wrote unguarded, so rallies landing in between had the serve changed under them at
    the very rev the push had written.
  - **A retirement in tennis/padel**: the set it stopped in must be a score that set passes
    through (no set stands at 9–2; a match tie-break short of its end only as the decider), and a
    match the sets show already WON is not awarded to the other side (`stoppedSetsProblem`).
  - **`clearSchedule` and `removeDivision` take the event row first**, like every other writer of
    many of an event's matches; `locks.test.ts` pins all of them.
  - Tests: the three 0021 CHECKs by name (`refusedBy` reads `constraint` AND `constraint_name`),
    `typedHeading` and `resultSentence` pure, and the phone harness gained a counting clock, a
    reload and gated pushes, with a test per finding. `e2e/scoring.mjs` opens entries before
    reading the poster (a draft's poster 404s) and its `/s+/g` was the letter s; `e2e/event.mjs`
    counts a match only when it FINISHES and checks the unfilled final says so.
- **Reviewed a third time** (three reviewers on the round-two fixes; 18 findings, 31 refuted).
  Each fix is above; the shape of what was found:
  - **The phone still lost work at two edges** (major): an undo made while a retry of an
    unheard write was out read as "behind" and was dropped; and another device's correction was
    undone by this phone's next tap — or by a PAUSE with nothing queued — because "ahead" was
    trusted. Both follow from judging a reply without asking whether the phone wrote what the
    server holds; the loop now asks, and `flushMatch` refuses to push over removed rallies.
  - **"A set number of boards" was a dead end** (major) while nothing can type a result: held
    back, and the no-court notes stopped promising a manage-screen control.
  - Smaller, all fixed: a retirement during the deciding tie-break at 6–4 was refused as "the
    match already won"; a decided match could be recorded at a count the sets contradict; the
    server's cut at the finish was invisible to the phone; "Keep" after a choice whose reply never
    came cleared blind; a tap in the first moment after a reload was lost; a console that cannot
    score offline dropped the claimed clock time on every stale tap (`sendTap` puts it back) and
    said "reloading" after it had reloaded (it now says the tap was not recorded, and why); the
    public page called a match with rallies and no result "not started" (live is now "rallies and
    no result"); the fraction half of the revision test passed on the database's own error
    (now `ZodError`); and the notes' "one query", "the base only ever moves forward" and
    "ONE reading of a reply" were each a little more than true.
  - Accepted, not fixed: play time can be counted twice after a write whose reply was lost (see
    the match clock section) — it needs an idempotency key per tick and moves no rating.
- **Shipped as `11e2052` on 2026-10-04.** Migration 0021 was applied to production BEFORE the
  push and verified by query: `matches.sets`, `outcome` and `rules` exist, the three CHECKs
  are in place, `matches` still has RLS on with no policies, and the security advisors were
  unchanged. All twelve e2e suites passed on a fresh database against the final build, and
  the live site's pages and `/api/health/db` answered after the deploy.
- **The phone is tested end to end now** — `components/useOfflineScoring.test.ts` runs the REAL
  hook against the REAL `pushLog` on PGlite, with a few lines standing in for React's hooks
  (state and refs by call order, effects after each render, a re-render a microtask after a
  state change) and a pretend `window`/`navigator`. **Install the pretend `window` only after
  the database is up**: PGlite sees a `window`, takes itself for a browser, and fails to start
  ("Cannot read properties of undefined (reading 'pathname')").
- **A shutdown mid-session zero-filled files being written** — `package.json`, `e2e/README.md`,
  and earlier `.next/types/validator.ts` — all NUL bytes, same size as intended. `tsc` reported
  "Invalid character" on the build file; the two source files showed as "Binary files differ".
  After an abrupt stop, scan the working tree for NUL-filled files before trusting it; restore
  from git and redo the edit.

### Cleared before step 8 (2026-10-07)

An audit of everything steps 1-7 left open — the plan, these notes, the code, every review
finding and the repo — found about thirty items once duplicates were merged. Faisal asked for
the work among them to be cleared before step 8; the decisions are his and are listed in the
plan file, and the rest belong to later steps by design.

- **A reload put back a point another device had taken off.** Round three taught the send loop
  to refuse it, but `resume` — the reload's decision — still trusted "ahead", learnt the
  server's shorter log as its base and pushed straight over the correction. ONE rule now,
  `removedElsewhere` in lib/offline/queue, asked by `flushMatch` and `resume` alike: the
  server's log is shorter than the log the phone KNEW it held, a prefix of it, not a log the
  phone sent — **and our log still continues the base past the server's end**. Without that
  last clause, two devices that took the SAME rally off were asked about it the moment this one
  tapped a new rally, though pushing it restores nothing. Rallies have no identity, so
  "continues" is judged by sequence. Step 8 must keep it in mind: a reset_rev guard that only
  refuses pushes at an OLD rev does not stop a reloaded phone, which pushes at the new one.
- **Its mirror: the server still has a rally THIS phone took off** (older than this round, both
  paths). Ours is a prefix of theirs — "behind" — and was dropped as already there, so the point
  the referee removed came back. `removedHere` turns that "behind" into a question, in the send
  loop and on reload: some log this phone built on or sent — its base, or a write it never heard
  back about — went on past ours, and the server's NEXT rally is that log's next rally. If the
  server's next rally is a different one, it took that rally off too and another device scored
  after, and ours goes without a question — the mirror of removedElsewhere's last clause; the
  first version asked about it. The sent half also catches this phone's own write CUT at the
  finish by the server with its reply lost, then undone below the finish: a log the phone never
  sent whole, so it read as another device's, and the undo was dropped with no word.
- **Nothing is sent while the referee is being asked.** A conflict found on RELOAD had already
  learnt the server's rev, so the fifteen-second retry timer — or the online event — pushed the
  phone's log over the server's with the question still on screen. The hook keeps the conflict
  in a ref as well as state (`conflictRef`, like `heldRef`), and `flush` returns while it is
  set.
- **A log this phone sent and never heard back about is never forgotten.** `sent` kept the last
  eight, so eight failed taps after a write whose reply was lost — the hall's ordinary
  dead spell — pushed it out, and when the signal came back the server holding it read as
  another device's work: the referee was asked about their own write, and "Keep the saved score"
  would have thrown away everything since. `withSent` keeps every log until a reply says what
  the server holds (`learn` empties the list); the list is bounded by the taps between two
  replies, a log by 500 rallies. (The first fix kept only undos, and missed exactly this.)
- **The conflict dialog says what was found** (`conflictWords` in RefConsole): "The saved score
  has a rally this phone took off", "Another device took rallies off" — "keeping this phone's
  score puts them back" — or, only when each has rallies the other lacks, the old "Another
  device also scored this match". One sentence for all three misdescribed two of them, while one
  of the choices overwrites real rallies.
- **A reload of a match typed in over this phone's queued rallies offers the typed result's
  choice** ("Keep 11–7" / "Use this phone's score"), as the signal coming back does. Judged as
  rallies, the typed match's empty log read as another device taking every rally off.
- **Removing a category never destroys a result** — the hole a redraw had, on a different
  button. `removeDivision` (manage/registration/actions.ts) is refused while any match in the
  category has play or rating history (`lockedIds`), deletes its matches through
  `deleteUnplayed` (re-checked inside the DELETE; `DrawChanged` rolls everything back), and
  takes the event row, then the category `FOR UPDATE`, so nothing is filed under it between
  the check and the delete. A category with teams or fixtures takes two taps
  (`RemoveCategoryButton`), and the second carries `categorySignature` — a fingerprint of the
  teams, matches and waiting entries the page SAW — so a page opened while it was empty cannot
  remove what arrived since. Refusals are codes (`category-played`, `category-changed`,
  `confirm-needed`, `category-stale`) shown once by `ProblemNotice`. In place of a button
  the server would refuse, the page names what is in the way: "Can’t remove — Group A · R1 has
  been played or started, and removing the category would delete it." (a live match counts —
  `lockedIds` is any play, not a result). Written by a separate session that never saved it,
  then moved onto main.
- **What goes with a category, and what waits for it.** The cascade left its APPROVED entries
  "approved" with no team and no category: impossible to decline, still counted by the
  one-live-entry-per-phone index (so the pair could not enter another category), and its
  `players` rows stayed in the event with no team, where the refile guard counts them as
  another holder of a seed and pinned a misfiled one for ever. Entries still WAITING in it went
  on one tap, pending with no category and no record of which they chose, their phone still
  counted as entered. The removal now withdraws both kinds with a note ("Its category, Mixed,
  was removed."), deletes the players (nothing is played, so no history points at them), and
  the confirmation says what it takes: "Removes 4 teams and 6 unplayed matches, and withdraws 1
  approved entry and 1 entry waiting for approval." A category with only waiting entries asks
  twice, and its fingerprint covers them.
  - **Postgres re-checks a foreign key on a row updated earlier in the same transaction**, so
    the withdrawn entries must have `team_id` and `division_id` cleared IN that update — left
    for the cascade's SET NULL, the delete failed on `registrations_team_id_teams_id_fk`.
  - **Every writer that files something under a category takes it `FOR KEY SHARE` as its
    transaction's first statement** — approval, a public entry (`writeEntry`), and the
    organiser's `addTeam`, `addPlayer` and `addMatch` — and answers in words when it is gone
    ("category-gone", "This team's category has just been removed, so the player was not
    added."), not with a raw foreign-key error. KEY SHARE waits for a removal's (or a draw's) FOR
    UPDATE on the category and for nothing else; the foreign-key checks always took it, only
    later. Later was the trouble: approval took it at its SECOND statement, after claiming the
    entry, and a removal holding the category while waiting for that entry closed a circle;
    `addMatch`'s insert checks its two TEAMS before the category, and a removal deleting those
    teams closed another; and a player inserted between the removal's delete of the players and
    its delete of the teams was left with no team. Taken first, each simply queues.
  - **A category removed before a writer resolved it is not swapped for another.** Resolving an
    id that no longer exists falls back to the event's first category, so approval filed the pair
    there and `addTeam` the team. Approval refuses when the category it resolves is not the one
    the entry named; `addTeam` uses the category chosen and never re-resolves it.
- **`tournamentState.test.ts` gave its setup 60 seconds**, so under the full parallel run the
  migrations once outran it and the file failed to load with its tests skipped — the one
  unexplained failure of step 7. Every database test that runs the migrations now gives 120
  (the in-memory `schema.test` and `migration-0005` were at 60 too). It also never removed its
  database: 156 copies, 1.5 GB, had piled up in the temp folder.
- **Tests that were promised or only ever lived in a scratch folder**: one person in Men's
  Doubles and Mixed moves each category's own rating of them; a person on both sides is skipped
  with a reason and records nothing; an entry approved into Women's Doubles is filed under it
  (in an event that already has men, so the old whole-event reading would file it mixed); a
  correction that moves the score of a loser named FIRST (side A — the existing 11–7 → 11–9
  test has the loser on side B) is re-rated; a sets result won by the second-named side is
  rated; the conflict dialog meeting a match typed in or deleted meanwhile; a hold that came
  back after a reload, with a choice whose reply never came; a released hold carrying an undo;
  each phone rule above, by the send loop and on reload where both decide it; each writer's
  KEY SHARE, as the first statement of its transaction, with the category removed at exactly
  that moment; the registration page rendered and its OWN token posted; and `e2e/redraw.mjs`
  now removes categories in a browser — refused when played, one tap when empty, two with
  teams, and a page opened before a team was added is refused with the reason.
- Step 2's promised browser check of `/people?format=md` was not added. The per-category
  filing is pinned in the database tests above, and the SQL fragments the list is built from
  are pinned by `people/sportRating.test.ts` — but the page's own query (and how `?format=md`
  becomes a key) is not tested. The browser half would have meant playing matches in a suite
  that plays none.
- **Reviewed adversarially twice** (three reviewers each, every finding proved by a scratch
  test). Round one: 20 findings, 37 refuted. Round two, on round one's fixes: 16 findings, 39
  refuted, no majors — the waiting entries, the writers resolved or locked too late, the
  undo's same-rally mirror, the eight-log cap, the typed reload, the dialog's one sentence, and
  tests that could not fail. All fixed above, plus wording: notes and comments that said a
  little more than was true.
- **43 plausible wrong versions** of the new rules — each phone rule and its clauses, the
  dialog's wording, every guard and lock of the removal, the page's token and words, and each
  writer's KEY SHARE and its "gone" answer — were applied to the real files one at a time, and
  every one is caught by the test aimed at it. One first survived: `removedElsewhere` forgetting
  what the phone sent, which both callers check before asking, so nothing could reach it; both
  rules now have direct tests of their whole contract.
- **Accepted, not fixed**: rallies have no identity, so "the same rally" is judged by sequence.
  When two devices each take a rally off and one taps a new rally on the SAME side, the two can
  look like one log, and a removal can be undone or asked about wrongly. Telling them apart needs
  an id per rally.

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
