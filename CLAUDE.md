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
| `Format/OSL-2026-tournament-app_24.html` | Supabase anon JWT (`:3734`), `ADMIN_DEFAULT` (`:4213`) |
| `Format/pickleboss-35split 12.html` | Supabase anon JWT (`:1596`), `ADMIN_DEFAULT` (`:472`) |
| `Files for claude code/claude-code-brief.md` | Supabase key in plaintext (`:63`) |

They are reference material, not build inputs, so excluding them costs the build nothing, and
they still exist on local disk. **A committed secret is not removed by deleting it later** — it
stays in history and must be treated as compromised. Before any commit that adds files, check
the staged tree, not just the working tree:

    git grep -c --cached "eyJhbGciOiJIUzI1NiIs" ; git grep -c --cached "Hello43556"

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
- **Stay single-file**, do not rewrite to Next.js — the Supabase sync already working in
  `Format/` solves the multi-device gap that the rewrite existed to fix.
- **Go multi-sport**, including the OSL board games.
- **Capacitor** for mobile, not Expo — Expo would mean rebuilding the whole UI.

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
`live_scores`.

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
- **`Format/` files contain live credentials.** `OSL-2026-tournament-app_24.html:3733` and
  `pickleboss-35split 12.html:1595` embed a Supabase URL + anon JWT; `pickleboss:472` ships a
  cleartext organiser password. Rotate before Wave 0.3 and confirm RLS is on `osl_live`.
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
