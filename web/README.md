# RISE Sports — web platform

Next.js 16 (App Router) + TypeScript on Vercel, with Neon Postgres. This is the
rebuild described in `../CLAUDE.md` under "Architecture reversal (2026-08-29)".

The single-file app at the repository root still serves production while this
reaches parity. Nothing here touches it.

## Why this exists

Three requirements the single-file architecture could not meet:

- **Hard to copy.** A self-contained HTML file ships its whole source to every
  visitor — View Source is a runnable copy. Here the scoring engine, rating
  maths, championship points and PIN hashing execute in Server Components and
  Server Actions and are never sent to the browser.
  `src/lib/__tests__/bundle-leak.test.ts` fails the build if that ever stops
  being true.
- **Massive traffic.** Spectator pages are Server Components cached at the edge
  and revalidated on write. Scoring pages are dynamic.
- **Easy to maintain.** TypeScript, one module per domain, 114 unit tests.

## Quick start

```bash
pnpm install
vercel install neon          # provisions Postgres, sets DATABASE_URL
vercel env pull .env.local
pnpm drizzle-kit push        # apply the schema
pnpm dev
```

```bash
pnpm test                    # unit tests
pnpm build && pnpm test      # also runs the client-bundle leak guard
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
