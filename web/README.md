# RISE Sports — web platform

Next.js 16 (App Router) + TypeScript on Vercel, with Postgres. This is the
rebuild described in `../CLAUDE.md` under "Architecture reversal (2026-08-29)".

The single-file app at the repository root still serves production while this
reaches parity. Nothing here touches it.

## Why this exists

Three requirements the single-file architecture could not meet:

- **Hard to copy.** A self-contained HTML file ships its whole source to every
  visitor — View Source is a runnable copy. Here the scoring engine, rating
  maths, championship points and PIN hashing execute in Server Components and
  Server Actions and are never sent to the browser.

  The guarantee is `import "server-only"` at the top of every engine module,
  which makes the **build fail**, with an import trace, if a Client Component
  imports one. **A new module under `lib/` needs that line**, and
  `src/lib/__tests__/bundle-leak.test.ts` fails if it is missing.

  This used to work by grepping the built bundles for engine identifiers, and
  that does not work: the minifier renames imported bindings, so importing
  `calcRtgChange` into a client component shipped the whole rating algorithm to
  the browser while all twenty name checks passed. Only string literals and
  object-property names survive minification, which is all that scan is still
  good for.
- **Massive traffic.** Spectator pages are Server Components cached at the edge
  and revalidated on write. Scoring pages are dynamic.
- **Easy to maintain.** TypeScript, one module per domain, 362 unit tests plus
  six end-to-end suites (`e2e/README.md`).

## The database

**Production is the Supabase project `utfvjsvvbifwcektzrwj`** — the same project
the legacy `Format/` apps use, on its own set of tables. It is reached through
the **transaction pooler** (port 6543), which is why `src/lib/db/index.ts` sets
`prepare: false`; pgBouncer in transaction mode has no prepared statements.

`DATABASE_URL` is the only setting. Point it at:

| Value | What runs |
|---|---|
| `pglite://.pgdata` | Postgres compiled to WASM, in that directory. No server, no account. This is what local dev, all unit tests and all six e2e suites use. |
| a `postgresql://…:6543/…` string | The real thing. |

**Both are Postgres and both support transactions, and that is the point.** This
was previously `drizzle-orm/neon-http`, whose `transaction()` method is a single
`throw`. The app opens transactions in four places — submitting a registration,
approving one into a team, applying ratings, reverting them — so all four would
have failed on the first deploy, two of them silently inside a `try/catch`. It
survived three milestones undetected because every test ran on PGlite and
nothing had ever run against the production driver. Do not swap this back for an
HTTP driver.

RLS is enabled on every table with **no policies**, which closes Supabase's
public PostgREST API completely — `people` holds names and phone numbers, and
the anon key is published in the old app's HTML. The app is unaffected: it
connects as the table owner, and owners bypass RLS. Supabase's linter reports
"RLS enabled, no policy" on all 14 tables; that is the intended state, not a
finding.

## Quick start

```bash
pnpm install
echo 'DATABASE_URL=pglite://.pgdata' > .env.local
pnpm db:setup                # create the tables (and seed demo data)
pnpm dev
```

PGlite is **single-process**: stop the dev server before running `db:setup`,
`seed` or any script that opens `.pgdata`, or it corrupts.

```bash
pnpm test                    # unit tests
pnpm build && pnpm test      # also scans the built bundles for leaked secrets

# end to end, in a real browser — see e2e/README.md
pnpm exec playwright install chromium     # once per machine
pnpm e2e            # smoke
pnpm e2e:event      # a whole event, groups to knockout
pnpm e2e:offline    # scoring with no network, the queue, the service worker
pnpm e2e:divergence # two devices on one match, and the conflict prompt
pnpm e2e:carryover  # a rating that follows a player between tournaments
pnpm e2e:registration # a stranger enters from the public page; an organiser approves
```

## Access control is OFF for now

`RISE_OPEN_ACCESS` is unset, which means **open access**: no PIN, no sign-in,
every visitor can score and manage every tournament, and draft tournaments are
publicly visible. That is deliberate while the product is being tested — the
point right now is to exercise the features, not the gate. Every page carries an
"open access" banner so an unlocked deployment cannot be mistaken for a locked
one.

**This is a switch, not a deletion.** The authorization system is fully built
and unit-tested and simply is not consulted while the switch is on:

| Still there | Where |
|---|---|
| Role hierarchy and permission rules | `src/lib/auth/policy.ts` (20 tests) |
| scrypt-hashed scorer PINs | `src/lib/auth/pin.ts` (11 tests) |
| Per-tournament grants, revocable | `src/lib/db/schema.ts` → `scorer_grants` |
| Checks inside every mutation | `src/app/t/[slug]/actions.ts` |

To lock it down later, set one environment variable on the Vercel project:

```bash
RISE_OPEN_ACCESS=0
```

No code changes. The PIN page, the grant cookies and the role checks all come
back on, and `src/lib/auth/access.test.ts` pins the behaviour of the switch in
both positions.

## Layout

| Path | What |
|---|---|
| `src/lib/scoring/` | Rally replay engine and rule resolution. The rally log is the only stored state; score, serve, positions and service box are all derived from it. |
| `src/lib/sports/registry.ts` | Seven sports, sport-namespaced rating keys (`pb:md`). |
| `src/lib/formats/osl.ts` | OSL Rules v4.8 team format — three-pair rotation, championship points, 5th–8th placement. |
| `src/lib/finance/` | Court Ledger money engine. Integer paise, never floats. |
| `src/lib/rating/` | RISE Rating. Conservation-correct — see below. |
| `src/lib/auth/` | `policy.ts` is pure authorization logic (exhaustively tested); `guard.ts` does the I/O; `pin.ts` hashes scorer PINs with scrypt. |
| `src/lib/db/schema.ts` | Drizzle schema. |
| `src/app/t/[slug]/actions.ts` | Every mutation. Loads the row, builds the principal server-side, asserts the permission, writes behind a revision guard. |

## Two behaviour changes from the legacy app

Both are deliberate, and both are pinned by tests.

1. **The rating engine no longer mints points.** The legacy `calcRtgChange`
   computed the winner's gain and the loser's loss from two independent
   multipliers, so evenly matched games inflated the pool and heavy favourites
   deflated it. Both sides now move by one shared delta.
   `src/lib/rating/rating.test.ts` includes a 5,000-match season asserting the
   pool total is unchanged, and keeps the legacy formula alongside to show the
   regression it caused. **The tuning constants are a reconstruction** — the
   repo's `Files for claude code/rise-rating-spec 4.md` §11 is not in the
   repository, so check the numbers against it. The conservation property is not
   in doubt; the constants may be.
2. **`rallyStats` is O(n) instead of O(n²).** It used to re-run the whole replay
   once per rally. It now shares one `step` function with `replayRallies`.
   `src/lib/scoring/replay.test.ts` proves equivalence differentially against
   the original engine, extracted by text from `../app.source.js`.

## Not done yet

Brackets, scheduler, Americano/Mexicano, auction, marketplace, Auth.js account
sign-in (only PIN grants work today), offline queue, Capacitor packaging.
