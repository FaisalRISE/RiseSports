# Getting started: git + Claude Code (RISE Sports)

Two short sections. Part 1 is the safety net (git). Part 2 is the tool (Claude Code).
You can skip Part 1 if you'd rather just keep manual backup copies.

---

## Part 1 — Git: the 6 commands you'll actually use

Git takes snapshots ("commits") of your folder so you can always go back.

### One-time setup (run once, in your project folder)

```bash
cd path/to/rise-sports        # go into the folder with your files
git init                      # start tracking this folder
git add .                     # stage everything for the first snapshot
git commit -m "baseline"      # take the snapshot, labelled "baseline"
```

If git asks who you are the first time, set it once:

```bash
git config --global user.name "Faisal"
git config --global user.email "you@example.com"
```

### Day-to-day (the only 4 you need)

| What you want | Command |
|---|---|
| See what changed since the last snapshot | `git status` |
| Take a new snapshot (do this whenever something works) | `git add . && git commit -m "what you changed"` |
| Throw away all changes since the last snapshot | `git restore .` |
| See your snapshot history | `git log --oneline` |

**The pattern:** get something working → commit it → try the next thing.
If the next thing breaks, `git restore .` puts you back to working in one second.

### Going back to an older snapshot

```bash
git log --oneline             # shows e.g.  a1b2c3d  added Swiss format
git checkout a1b2c3d -- .     # restore all files to how they were at that commit
```

### Worth knowing

- **`.gitignore`** — a text file listing things git should ignore. You don't need one
  for this project, but if you ever add `node_modules/`, put that in it.
- **You don't need GitHub.** Git works entirely on your own machine. GitHub is only
  needed if you want an online backup or to host the app on GitHub Pages.
- **Claude Code can run these for you.** Try: *"commit this as a checkpoint"* or
  *"undo my last change"* — it'll run the right git commands.

---

## Part 2 — Claude Code

### What you need first

- A **paid Claude plan (Pro or higher)** — Claude Code is not on the Free plan.
- A terminal. macOS: Terminal app. Windows: PowerShell (right-click → Run as
  administrator the first time). Windows also needs **Git for Windows** installed
  (`git-scm.com`) — accept all the defaults during install.

### Install

**macOS / Linux / WSL:**
```bash
curl -fsSL https://claude.ai/install.sh | bash
```

**Windows PowerShell:**
```powershell
irm https://claude.ai/install.ps1 | iex
```

*(Alternative if you already have Node.js 18+: `npm install -g @anthropic-ai/claude-code`)*

Check it worked:
```bash
claude --version
claude doctor      # deeper check: install type, auth, settings
```

### Start a session

```bash
cd path/to/rise-sports      # the folder with app.source.js, build.js, CLAUDE.md
claude
```

First run asks you to pick a theme, log in (browser opens — use your normal Claude
account), and confirm you trust the folder. Say yes to the folder.

Then just type what you want in plain English:

```
> the LIVE card should also show which court is free next
> add a Swiss format to the tournament formats
> rebuild the offline file and tell me if anything broke
```

Claude Code asks permission before changing files. Review the diffs it shows you —
especially early on, until you get a feel for it.

### Commands worth remembering

| Inside a Claude Code session | What it does |
|---|---|
| `/usage` or `/status` | How much of your limit you've used |
| `/login` | Switch or re-authenticate accounts |
| `/clear` | Start a fresh context (use between unrelated tasks) |
| `/help` | List all commands |
| `Esc` | Interrupt Claude mid-task |
| `exit` | End the session |

### ⚠️ Don't run `/init` in this project

`/init` generates a `CLAUDE.md` by analysing your code. **You already have a
hand-written one** with the architecture notes and hard-won gotchas. Running `/init`
risks replacing it with something more generic. Claude Code reads the existing
`CLAUDE.md` automatically — nothing to set up.

---

## Usage limits — the honest answer

**Claude Code does NOT have a separate quota.** On Pro/Max plans, usage is shared
across Claude chat (this app), Claude Code, and other Claude surfaces — one pool.
A long morning of chatting reduces your Claude Code capacity that afternoon.

Two limits run at once:
- **A 5-hour rolling window** — resets 5 hours after your first request in that window.
- **A weekly cap** on top of it — resets on a fixed day/time assigned to your account.

**Claude Code burns through a window faster than chatting does**, because it's an
agent: one instruction can trigger many file reads, edits, and test runs, and each
counts. Plan for that.

Tiers (as of mid-2026 — Anthropic adjusts these, so treat as a snapshot):
- **Pro** (~$20/mo, ~$17 annual) — includes Claude Code; standard capacity.
- **Max 5x** ($100/mo) — roughly 5× Pro capacity.
- **Max 20x** ($200/mo) — roughly 20× Pro.

Check your actual usage with `/usage` inside Claude Code, or Settings → Usage on
claude.ai. Current details: https://support.claude.com/en/articles/11145838

### Keeping usage efficient

- Use `/clear` between unrelated tasks — a bloated context costs more per message.
- Be specific. *"In `TourneyTab`, the LIVE card should show free courts"* is cheaper
  and more accurate than *"improve the live view."*
- Let the `CLAUDE.md` do the explaining — don't re-describe the architecture each time.
- Commit working states often, so a bad path costs one `git restore .`, not a rebuild.

---

## Your first session — suggested

```bash
cd path/to/rise-sports
git init && git add . && git commit -m "baseline"
claude
```

Then try something small to get a feel for it:

```
> read CLAUDE.md, then run node build.js and confirm the output renders
```
