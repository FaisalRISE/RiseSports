# End-to-end smoke test

Drives the real app in a browser: seeded data, the referee console, the blocking
rotation, undo, the golden point, and creating a tournament from scratch.

```bash
rm -rf .pgdata
DATABASE_URL=pglite://.pgdata pnpm db:setup     # migrate + seed a local Postgres
DATABASE_URL=pglite://.pgdata pnpm dev -p 3111  # in another shell
node e2e/smoke.mjs
```

Two things will waste an hour if you do not know them:

- **Use `localhost`, not `127.0.0.1`.** Next's dev server refuses `/_next/*`
  asset requests from an unrecognised origin, so on `127.0.0.1` the page HTML
  loads, every JS chunk 403s, React never hydrates, and every click silently
  does nothing. It looks exactly like a broken app.
- **PGlite file directories are single-process.** The dev server holds `.pgdata`
  open; a second process pointed at the same directory blocks rather than
  erroring. Stop the server before running a script against it.
