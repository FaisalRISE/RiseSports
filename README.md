# RISE Sports

A multi-sport community platform — tournaments, community play, player ratings and venue
bookings — across pickleball, badminton, table tennis, padel, tennis, carrom and chess.

It ships as **one self-contained offline HTML file**. React is inlined, there is no bundler,
no server and no network request at load. Open it and it runs.

## Quick start

```bash
node build.js          # rebuild the HTML from app.source.js
node tests/run.js      # run the test suite
node tools/serve.js    # serve at http://127.0.0.1:8765
```

Then open <http://127.0.0.1:8765>.

> Open it over **http**, not by double-clicking the file. `file://` and `data:` URLs disable
> `localStorage` *and* service workers, so anything touching saved data or the PWA will look
> broken (or worse, look fine while being broken).

## Layout

| Path | What it is |
|---|---|
| `app.source.js` | **The app. Edit this.** Pre-compiled React — `React.createElement`, no JSX. |
| `build.js` | Splices `app.source.js` into the HTML shell and emits the deliverables. |
| `rise-sports.html` | The built app. Also written as `index.html` for static hosting. |
| `tests/` | Node test suite — no framework, no dependencies. |
| `tools/` | `serve.js` (local HTTP server), `make-icons.js` (generates the PWA icons from code). |
| `CLAUDE.md` | Architecture, data model, roadmap and the traps worth knowing. Read it first. |

`manifest.webmanifest`, `sw.js`, `icons/` and `index.html` are **generated** — don't hand-edit
them.

## Editing

1. Edit `app.source.js`
2. `node build.js`
3. `node tests/run.js`
4. Reload the served page

Never hand-edit the generated HTML; the next build overwrites it.

## Notes

- **`localStorage` is the database.** Publishing a new build does not reset anyone's data, so
  every migration has to be defensive.
- **Names matter here.** The file was recovered from a minified build, so its local variables
  are single letters. A short module-level helper name will be shadowed — that has already
  cost one silent, complete persistence outage. `tests/shadowing.test.js` enforces the rule.
- The reference prototypes and product specs are kept out of this repo: some of them contain
  live credentials, and this repo is public.

## Licence

All rights reserved. Built by RISE.
