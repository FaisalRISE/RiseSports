# End-to-end tests

Four scripts, all driving the real app in a real browser:

| Script | What it covers |
|---|---|
| `pnpm e2e` | smoke: seeded data, the referee console, the blocking rotation, undo, the golden point, creating a tournament |
| `pnpm e2e:event` | a whole event: create → teams → groups → score every match → knockout |
| `pnpm e2e:offline` | scoring with no network, the queue, the service worker, reconnection |
| `pnpm e2e:divergence` | two devices scoring one match, and the conflict prompt |

Playwright is a devDependency. Once per machine:

```bash
pnpm exec playwright install chromium
```

## Running them

```bash
# stop any running server first — see the PGlite note below
rm -rf .pgdata
DATABASE_URL=pglite://.pgdata pnpm db:setup
```

The offline and divergence scripts need a **production build**:

```bash
pnpm build
DATABASE_URL=pglite://.pgdata pnpm start -p 3111    # in another shell
pnpm e2e:offline
pnpm e2e:divergence
```

`pnpm e2e` and `pnpm e2e:event` are happy on `pnpm dev -p 3111` too.

`E2E_URL` points the scripts somewhere else (default `http://localhost:3111`):

```bash
E2E_URL=http://localhost:3000 node e2e/offline.mjs
```

## Things that will waste an hour if you do not know them

- **Use `localhost`, not `127.0.0.1`.** Next refuses `/_next/*` asset requests
  from an unrecognised origin, so the page HTML loads, every JS chunk 403s,
  React never hydrates, and every click silently does nothing. It looks exactly
  like a broken app.

- **The offline tests need `pnpm build && pnpm start`, not `pnpm dev`.** The
  service worker only registers when `NODE_ENV === "production"` — deliberately,
  because a worker caching a dev build makes changes appear not to take effect.
  On `pnpm dev` the "reload with no server" step would pass for the wrong
  reason: the page never left memory, and nothing about the service worker was
  actually exercised.

- **PGlite file directories are single-process.** The server holds `.pgdata`
  open, and a second process pointed at the same directory corrupts it — the
  next request dies with `RuntimeError: Aborted()` from the WASM build. Stop the
  server before `db:setup` or any script that opens the database.

- **These scripts consume their fixtures.** They add rallies, so a seeded match
  reaches its target and its tap buttons correctly become disabled.
  `firstScorableMatch` opens each candidate and checks the buttons are enabled
  rather than taking the first link, but if every match is finished, reset with
  `rm -rf .pgdata && pnpm db:setup`.

- **`E2E_NO_PROXY=1`** forces `direct://` if a system proxy swallows localhost.
  It used to be unconditional, inherited from the sandbox these were written in,
  and produced `ERR_PROXY_CONNECTION_FAILED` on Windows.

## Why the offline test looks the way it does

It covers two failure modes, and they are not the same thing:

- `context.setOffline(true)` flips `navigator.onLine`, so the app can see it
  coming.
- `page.route("**", abort)` leaves `navigator.onLine` **true** while every
  request fails.

The second is a sports hall with WiFi and no route to the server. It is the
realistic one, no `navigator.onLine` check can detect it, and it is what found
all three of the bugs fixed in `2ac0efd` — each one a way a rally could look
saved when it was not. That is the property these tests exist to protect.

The divergence script asserts the opposite failure too: a device that only
watched, or whose write was merely behind, must **never** be prompted. Prompting
without a real conflict trains referees to dismiss the prompt, and then the one
that matters gets dismissed as well.
