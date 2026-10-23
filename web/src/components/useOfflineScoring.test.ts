import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* The referee's phone, end to end: the REAL `useOfflineScoring` hook driving the
 * REAL `pushLog` against a real database.
 *
 * There is no browser test environment in this project, so React is stood in
 * for by a few lines below — state and refs by call order, effects after each
 * render, a re-render a microtask after any state change — which is all the
 * hook asks of it. What it proves is what the phone DOES with each answer:
 * holds rallies for a typed result and sends nothing until the referee
 * chooses; replaces only the result the referee saw; drops rallies for a
 * deleted match and says so once; never loses a tap made while a push is on
 * the wire; sends an undo back to 0–0 from a tap, the timer or a reload alike;
 * takes a scoring change's moved rev in its stride; never writes over another
 * device's rallies it has not seen. Each of those was wrong, or untested,
 * until step 7's two reviews. */

/* ── A stand-in for React's hooks ─────────────────────────────────────────── */

type Slot = { value?: unknown; deps?: unknown[]; cleanup?: () => void };
const runtime = {
  slots: [] as Slot[],
  cursor: 0,
  effects: [] as (() => void)[],
  render: (() => {}) as () => void,
  scheduled: false,
};
const schedule = () => {
  if (runtime.scheduled) return;
  runtime.scheduled = true;
  queueMicrotask(() => {
    runtime.scheduled = false;
    runtime.render();
  });
};
const changed = (a?: unknown[], b?: unknown[]) => !a || !b || a.length !== b.length || a.some((x, i) => !Object.is(x, b[i]));

vi.mock("react", () => ({
  useState(init: unknown) {
    const k = runtime.cursor++;
    const slot = (runtime.slots[k] ??= { value: typeof init === "function" ? (init as () => unknown)() : init });
    const set = (v: unknown) => {
      slot.value = typeof v === "function" ? (v as (p: unknown) => unknown)(slot.value) : v;
      schedule();
    };
    return [slot.value, set];
  },
  useRef(init: unknown) {
    const k = runtime.cursor++;
    const slot = (runtime.slots[k] ??= { value: { current: init } });
    return slot.value;
  },
  useCallback(fn: unknown, deps: unknown[]) {
    const k = runtime.cursor++;
    const slot = runtime.slots[k];
    if (!slot || changed(slot.deps, deps)) runtime.slots[k] = { value: fn, deps };
    return runtime.slots[k].value;
  },
  useEffect(fn: () => void | (() => void), deps?: unknown[]) {
    const k = runtime.cursor++;
    const slot = runtime.slots[k];
    if (slot && !changed(slot.deps, deps)) return;
    runtime.effects.push(() => {
      slot?.cleanup?.();
      const c = fn();
      runtime.slots[k] = { deps, cleanup: typeof c === "function" ? c : undefined };
    });
  },
  useSyncExternalStore(_subscribe: unknown, get: () => unknown) {
    return get();
  },
}));

/* The browser the hook expects: online or not, the `online` event, a timer. */
const listeners: Record<string, (() => void)[]> = {};
/* Real enough to unmount: clearInterval removes the timer, as a remount's
   cleanup needs (step 8). */
const timers = new Map<number, () => void>();
let nextTimer = 0;
/* Installed only once the database is up: PGlite looks for a `window` and,
   finding one, takes itself for a browser. */
function pretendBrowser() {
  Object.defineProperty(globalThis, "navigator", { value: { onLine: true }, configurable: true, writable: true });
  Object.defineProperty(globalThis, "window", {
    value: {
      addEventListener: (t: string, f: () => void) => { (listeners[t] ??= []).push(f); },
      removeEventListener: (t: string, f: () => void) => { listeners[t] = (listeners[t] ?? []).filter((x) => x !== f); },
      setInterval: (f: () => void) => { timers.set(++nextTimer, f); return nextTimer; },
      clearInterval: (id: number) => { timers.delete(id); },
    },
    configurable: true,
    writable: true,
  });
}
const setOnline = (on: boolean) => { (globalThis.navigator as { onLine: boolean }).onLine = on; };
const fire = (t: string) => { for (const f of listeners[t] ?? []) f(); };
const tickTimers = () => { for (const f of [...timers.values()]) f(); };

/* ── The server ───────────────────────────────────────────────────────────── */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({ get: () => undefined, set: () => {}, delete: () => {} }),
}));
vi.mock("next/navigation", () => ({ redirect: () => { throw new Error("redirect"); }, notFound: () => {} }));
/* `pin`: the phone belongs to a referee holding only a scoring PIN — once
   sign-in exists, everybody who is not the organiser. */
const who = vi.hoisted(() => ({ pin: false }));
vi.mock("@/lib/auth/guard", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@/lib/auth/guard")>();
  return {
    ...orig,
    principalFor: async (...a: Parameters<typeof orig.principalFor>) =>
      who.pin ? { userId: null, role: null, hasScorerGrant: true, isOwner: false } : orig.principalFor(...a),
  };
});

const dir = path.join(os.tmpdir(), `rise-phone-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let actions: typeof import("@/app/t/[slug]/actions");
let manage: typeof import("@/app/t/[slug]/manage/actions");
let hook: typeof import("./useOfflineScoring");
let queue: typeof import("@/lib/offline/queue");
let change: typeof import("@/lib/scoring/change");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;
const owner = randomUUID();
type Side = "a" | "b";

async function match(log: Side[] = []): Promise<string> {
  const [tournamentId, divisionId, teamA, teamB, matchId] =
    [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
  await db.insert(schema.tournaments).values({
    id: tournamentId, slug: `ph-${tournamentId.slice(0, 8)}`, name: "Phone", sport: "pb",
    format: "standard", ownerId: owner, status: "live",
  });
  await db.insert(schema.divisions).values({ id: divisionId, tournamentId, name: "Main" });
  await db.insert(schema.teams).values([
    { id: teamA, tournamentId, divisionId, name: "Aces", seed: 1 },
    { id: teamB, tournamentId, divisionId, name: "Bees", seed: 2 },
  ]);
  await db.insert(schema.matches).values({
    id: matchId, tournamentId, divisionId, round: "Round 1", teamAId: teamA, teamBId: teamB,
    log, lineupA: [], lineupB: [], ackedGates: [], server: "a", rev: 0,
  });
  return matchId;
}
const stored = async (id: string) => (await db.select().from(schema.matches).where(eq(schema.matches.id, id)))[0];

/** A clock that counts: every claim takes the next second, and a pause waits
 *  to be written until a claim carries it — as useMatchClock's does. */
function countingClock() {
  const c = {
    pending: 0,
    pause: undefined as string | null | undefined,
    claims: 0,
    restores: 0,
    claim: () => {
      c.claims++;
      const t: Record<string, unknown> = { playMs: c.pending + 1000, pausedMs: 0 };
      if (c.pause !== undefined) t.pause = c.pause;
      c.pending = 0;
      c.pause = undefined;
      return t;
    },
    restore: (t: { playMs: number; pause?: string | null }) => {
      c.restores++;
      c.pending += t.playMs;
      if (t.pause !== undefined && c.pause === undefined) c.pause = t.pause;
    },
    hasPending: () => c.pause !== undefined,
  };
  return c;
}

/** Mount the console's hook for a match, as the score page would after a
 *  render from the server. `refresh()` is the page re-rendering after
 *  `onSynced` (router.refresh): it reads the match again. With
 *  `autoRefresh: false` the page does not re-render until the test says so —
 *  the moment after a write lands, before the new render arrives. */
async function mount(
  matchId: string,
  push = actions.pushLog,
  opts: {
    clock?: ReturnType<typeof countingClock>;
    autoRefresh?: boolean;
    /** Runs straight after the first render, before the stored queue is read. */
    beforeLoad?: (now: ReturnType<typeof hook.useOfflineScoring>) => void;
    /** The FIRST render is this one, not the match as it is: a cold load with
        no signal, answered by the service worker from its cache (step 8, A1). */
    cached?: { serverLog: Side[]; serverRev: number; resetRev: number };
  } = {},
) {
  runtime.slots = [];
  runtime.effects = [];
  const pushes: Side[][] = [];
  let args: Parameters<typeof hook.useOfflineScoring>[0];
  const fromServer = async () => {
    const m = await stored(matchId);
    const typed = m && m.typedScoreA != null && m.typedScoreB != null
      ? { a: m.typedScoreA, b: m.typedScoreB, outcome: m.outcome ?? null } : null;
    return { serverLog: (m?.log ?? []) as Side[], serverRev: m?.rev ?? 0, resetRev: m?.resetRev ?? 0, typed };
  };
  const freshClock = () =>
    (opts.clock ? countingClock() : { claim: () => ({ playMs: 0, pausedMs: 0 }), restore: () => {}, hasPending: () => false }) as never;
  let clock = (opts.clock ?? freshClock()) as never;
  let mounts = 1;
  /* How many times the console asked for the page again (router.refresh). */
  let syncs = 0;
  let out = {} as ReturnType<typeof hook.useOfflineScoring>;
  args = {
    matchId,
    rules: { target: 11, winBy: 2, cap: null, golden: null, sideOut: false, serve: "rally", perCourt: 4 },
    format: "standard",
    server: "a", posA: 0, posB: 0,
    sides: ["A", "B"],
    push: (async (...p: Parameters<typeof actions.pushLog>) => { pushes.push([...p[1]]); return push(...p); }) as typeof actions.pushLog,
    onSynced: () => { syncs++; if (opts.autoRefresh !== false) void refresh(); },
    clock,
    ...(await fromServer()),
    ...(opts.cached ? { ...opts.cached, typed: null } : {}),
  };
  runtime.render = () => {
    runtime.cursor = 0;
    out = hook.useOfflineScoring(args);
    const run = runtime.effects;
    runtime.effects = [];
    for (const e of run) e();
  };
  /* The page re-rendering. A changed reset_rev REMOUNTS the console, as the
     score page's key on it does (RefConsole): every effect's cleanup runs, the
     hook starts from nothing, and the clock is a fresh one. */
  async function refresh() {
    const next = await fromServer();
    if (next.resetRev !== args.resetRev) {
      for (const s of runtime.slots) s?.cleanup?.();
      runtime.slots = [];
      runtime.effects = [];
      clock = freshClock();
      mounts++;
      args = { ...args, ...next, clock };
    } else {
      args = { ...args, ...next };
    }
    runtime.render();
  }
  runtime.render();
  opts.beforeLoad?.(out);
  await settle();
  return { get now() { return out; }, pushes, refresh, get clock() { return clock as unknown as ReturnType<typeof countingClock>; }, get mounts() { return mounts; }, get syncs() { return syncs; } };
}

/** A page reload: the open console's listeners and timers go with the page. */
async function reload(matchId: string, push = actions.pushLog, cached?: NonNullable<Parameters<typeof mount>[2]>["cached"]) {
  timers.clear();
  for (const k of Object.keys(listeners)) delete listeners[k];
  return mount(matchId, push, { cached });
}

/** The organiser presses "Clear result…" / "Reset to 0–0…" on the manage
    page. Returns the match's new rev, which is its reset_rev. */
async function organiserClears(id: string) {
  const m = await stored(id);
  const f = new FormData();
  f.set("confirm", String(m.rev));
  await expect(manage.clearResult(m.tournamentId, id, f)).rejects.toThrow("redirect");
  expect((await stored(id)).resetRev).toBe(m.rev + 1);
  return m.rev + 1;
}

/** A push held open until `release()`, one gate per call while `hold` says. */
function gated(hold: (n: number) => boolean = () => true) {
  const gates: (() => void)[] = [];
  let n = 0;
  const push: typeof actions.pushLog = async (...p) => {
    if (hold(n++)) await new Promise<void>((r) => gates.push(r));
    return actions.pushLog(...p);
  };
  return { push, release: () => gates.shift()!() };
}

/** Let every queued promise, microtask and re-render run. */
const settle = async () => { for (let i = 0; i < 40; i++) await new Promise((r) => setTimeout(r, 2)); };

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  actions = await import("@/app/t/[slug]/actions");
  manage = await import("@/app/t/[slug]/manage/actions");
  change = await import("@/lib/scoring/change");
  hook = await import("./useOfflineScoring");
  queue = await import("@/lib/offline/queue");
  ({ eq } = await import("drizzle-orm"));
  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    for (const stmt of fs.readFileSync(path.join(migrations, f), "utf8").split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }
  await db.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });
  pretendBrowser();
}, 120_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

beforeEach(() => {
  queue.__resetQueue();
  timers.clear();
  for (const k of Object.keys(listeners)) delete listeners[k];
  setOnline(true);
});

/** Two rallies recorded with no signal, then a result typed in on another phone. */
async function heldAfterTyping() {
  const id = await match();
  const phone = await mount(id);
  setOnline(false);
  phone.now.scoreOffline("a");
  await settle();
  phone.now.scoreOffline("a");
  await settle();
  expect(phone.now.queued).toBe(2);
  expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0 })).toEqual({ ok: true, rev: 1 });
  setOnline(true);
  fire("online");
  await settle();
  return { id, phone };
}

describe("a result typed in while the phone held rallies", () => {
  it("holds them, shows the typed result, and sends nothing until the referee chooses", async () => {
    const { id, phone } = await heldAfterTyping();
    expect(phone.now.held).toEqual({ a: 11, b: 7, rev: 1, outcome: null });
    expect(phone.now.queued).toBe(2);
    const sent = phone.pushes.length;
    tickTimers();
    fire("online");
    await settle();
    expect(phone.pushes.length, "neither the timer nor the online event sends a held record").toBe(sent);
    expect((await queue.loadQueued(id))?.held).toBe(true);
  });

  it("Keep: the typed result stands and the phone's rallies go", async () => {
    const { id, phone } = await heldAfterTyping();
    await phone.now.keepTyped();
    await settle();
    expect(phone.now.held).toBeNull();
    expect(phone.now.queued).toBe(0);
    expect(await queue.loadQueued(id)).toBeNull();
    const m = await stored(id);
    expect([m.typedScoreA, m.typedScoreB, m.log]).toEqual([11, 7, []]);
  });

  it("Use this phone's score: the rallies replace the typed result", async () => {
    const { id, phone } = await heldAfterTyping();
    expect(await phone.now.replaceTyped()).toBeNull();
    await settle();
    const m = await stored(id);
    expect([m.typedScoreA, m.log]).toEqual([null, ["a", "a"]]);
    expect(phone.now.held).toBeNull();
  });

  /* Faisal, 2026-10-23: replacing a typed result is the organiser's. A
     referee's phone is told so, and keeps holding its rallies — Keep is still
     theirs to press. */
  it("Use this phone's score from a referee's PIN: refused, said, and the hold stays", async () => {
    const { id, phone } = await heldAfterTyping();
    who.pin = true;
    try {
      expect(await phone.now.replaceTyped()).toBe(
        "Only the organiser can put this phone's score in place of the typed result — keep it, and tell the organiser if the phone's score is the right one.",
      );
      await settle();
      expect(phone.now.held).toEqual({ a: 11, b: 7, rev: 1, outcome: null });
      expect((await queue.loadQueued(id))?.held).toBe(true);
      const m = await stored(id);
      expect([m.typedScoreA, m.typedScoreB, m.log]).toEqual([11, 7, []]);
      await phone.now.keepTyped();
      await settle();
      expect(phone.now.held).toBeNull();
    } finally {
      who.pin = false;
    }
  });

  /* The result was typed AGAIN before the referee chose. The phone must show
     the new one and ask again — it used to keep showing 11–7, and every
     replace went out at the old rev and failed for ever. */
  it("typed again before the choice: the card shows the new result, and the next replace lands", async () => {
    const { id, phone } = await heldAfterTyping();
    expect(await actions.recordResult(id, { a: 11, b: 9, expectedRev: 1 })).toEqual({ ok: true, rev: 2 });
    expect(await phone.now.replaceTyped()).toBe("The result was typed in again, as 11–9 — look at it before replacing it.");
    await settle();
    expect(phone.now.held).toEqual({ a: 11, b: 9, rev: 2, outcome: null });
    expect((await stored(id)).typedScoreB).toBe(9);

    expect(await phone.now.replaceTyped()).toBeNull();
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a"]);
  });

  /* A tap made while the push that brought back "typed" was on the wire must
     be in what the phone holds — after a reload too. */
  it("holds the NEWEST log, including a tap made while the push was on the wire", async () => {
    const id = await match();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    let first = true;
    const slow: typeof actions.pushLog = async (...p) => {
      if (first) { first = false; await gate; }
      return actions.pushLog(...p);
    };
    const phone = await mount(id, slow);
    phone.now.scoreOffline("a");      // on the wire, held open
    await settle();
    await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0 });
    phone.now.scoreOffline("b");      // tapped meanwhile
    await settle();
    release();
    await settle();
    expect(phone.now.held).toMatchObject({ a: 11, b: 7 });
    expect(await queue.loadQueued(id)).toMatchObject({ log: ["a", "b"], held: true });
  });
});

describe("a match deleted under the phone", () => {
  it("drops the rallies, says how many once, and sends nothing more — not even a pause", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    await db.delete(schema.matches).where(eq(schema.matches.id, id));
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.refused).toEqual({ title: "This match was deleted", error: "It was removed on the manage screen.", rallies: 2 });
    const sent = phone.pushes.length;
    phone.now.syncClock();
    tickTimers();
    await settle();
    expect(phone.pushes.length).toBe(sent);
    expect(phone.now.refused?.rallies).toBe(2);
    expect(await queue.loadQueued(id)).toBeNull();
  });
});

describe("taps and undos always reach the server", () => {
  /* Tap 1 on the wire, tap 2 made before it returns. When tap 1 landed, the
     queue was cleared — tap 2 with it — and the phone showed what the server
     had. On one bar of signal in a hall that window is real. */
  it("a rally tapped while the previous push is on the wire is sent once it lands", async () => {
    const id = await match();
    const gates: (() => void)[] = [];
    let calls = 0;
    const slow: typeof actions.pushLog = async (...p) => {
      if (calls++ < 2) await new Promise<void>((r) => gates.push(r));
      return actions.pushLog(...p);
    };
    const phone = await mount(id, slow);
    phone.now.scoreOffline("a");
    await settle();
    phone.now.scoreOffline("a");
    await settle();
    expect(phone.now.queued).toBe(2);
    gates.shift()!();   // the first push lands…
    await settle();
    /* …and while the second is on the wire, the newer rally is still queued:
       a reload here must not lose it. */
    expect((await stored(id)).log).toEqual(["a"]);
    expect((await queue.loadQueued(id))?.log).toEqual(["a", "a"]);
    gates.shift()!();
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a"]);
    expect(await queue.loadQueued(id)).toBeNull();
    expect(phone.now.queued).toBe(0);
  });

  /* An undo back to an empty log used to be dropped before it was sent: the
     phone showed 0–0 and the server kept a rally nobody played — the match
     then read as live, locked its redraw, and refused a typed result as
     "being refereed live". */
  it("an undo back to 0–0 is sent", async () => {
    const id = await match();
    const phone = await mount(id);
    phone.now.scoreOffline("a");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    phone.now.undoOffline();
    await settle();
    expect((await stored(id)).log).toEqual([]);
  });
});

/* A scoring change moves EVERY match's rev, so a phone's next write after one
   is stale whatever it was. A new rally reads as "ahead" and is retried; an
   undo is shorter than the server's log, read as "behind", and was dropped as
   redundant — the point the referee took off came back, and if it was a
   mis-tapped winning rally, the match stayed won and rated. */
describe("after a scoring change on the manage screen", () => {
  const resave = async (id: string) => change.changeScoring({ id: (await stored(id)).tournamentId }, null);

  it("an undo lands", async () => {
    const id = await match();
    const phone = await mount(id);
    for (const s of ["a", "a", "b"] as Side[]) { phone.now.scoreOffline(s); await settle(); }
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
    expect((await resave(id)).ok).toBe(true);
    phone.now.undoOffline();
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a"]);
    expect(phone.now.conflict).toBeNull();
  });

  it("taking a point off lands", async () => {
    const id = await match();
    const phone = await mount(id);
    for (const s of ["a", "a", "b", "a"] as Side[]) { phone.now.scoreOffline(s); await settle(); }
    expect((await resave(id)).ok).toBe(true);
    phone.now.minusOffline("a");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
  });

  /* The rev moved, the result did not: nobody typed anything. */
  it("'Use this phone's score' lands, and does not claim the result was typed again", async () => {
    const { id, phone } = await heldAfterTyping();
    expect((await resave(id)).ok).toBe(true);
    expect(await phone.now.replaceTyped()).toBeNull();
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a"]);
    expect(phone.now.held).toBeNull();
  });

  it("'Keep this phone's score' in the conflict dialog lands", async () => {
    const id = await match();
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.pushLog(id, ["b"], 0)).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.conflict).toMatchObject({ serverLog: ["b"], localLog: ["a"], rev: 1 });
    expect((await resave(id)).ok).toBe(true);
    await phone.now.resolveConflict("mine");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    expect(phone.now.conflict).toBeNull();
  });
});

/* A write can land and its reply be lost on the way back. The phone then holds
   an old rev, and the server holds a log the phone wrote itself. */
describe("a reply lost on the way back", () => {
  it("an undo made after it still lands", async () => {
    const id = await match();
    let lose = true;
    const lossy: typeof actions.pushLog = async (...p) => {
      const r = await actions.pushLog(...p);
      if (lose) { lose = false; throw new Error("reply lost"); }
      return r;
    };
    const phone = await mount(id, lossy);
    phone.now.scoreOffline("a");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    expect(phone.now.stalled).toBe(true);
    phone.now.undoOffline();
    await settle();
    expect((await stored(id)).log).toEqual([]);
    expect(phone.now.stalled).toBe(false);
  });
});

/* Round one sent an undo back to 0–0 only from the tap itself. The timer and
   the online event treated an empty log as "nothing queued", and a reload
   classified it "behind" and threw it away — the phone showing 0–0, the server
   keeping a rally nobody played. */
describe("an undo back to 0–0 that could not go straight away", () => {
  async function scoredOnce() {
    const id = await match();
    const phone = await mount(id);
    phone.now.scoreOffline("a");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    return { id, phone };
  }

  it("goes when the signal comes back", async () => {
    const { id, phone } = await scoredOnce();
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual([]);
  });

  it("goes on the retry timer after a failed send", async () => {
    const id = await match();
    let fail = false;
    const flaky: typeof actions.pushLog = async (...p) => {
      if (fail) throw new Error("no route");
      return actions.pushLog(...p);
    };
    const phone = await mount(id, flaky);
    phone.now.scoreOffline("a");
    await settle();
    fail = true;
    phone.now.undoOffline();
    await settle();
    expect(phone.now.stalled).toBe(true);
    fail = false;
    tickTimers();
    await settle();
    expect((await stored(id)).log).toEqual([]);
    expect(phone.now.stalled).toBe(false);
  });

  it("goes after a reload", async () => {
    const { id, phone } = await scoredOnce();
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    setOnline(true);
    await reload(id);
    await settle();
    expect((await stored(id)).log).toEqual([]);
    expect(await queue.loadQueued(id)).toBeNull();
  });

  /* Not only to 0–0: any undo queued with no signal was lost on reload. */
  it("and any other undo made offline goes after a reload", async () => {
    const id = await match(["a", "b", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    setOnline(true);
    await reload(id);
    await settle();
    expect((await stored(id)).log).toEqual(["a", "b"]);
  });
});

describe("a tap made while a push is on the wire", () => {
  /* The push came back "behind" — another device had written MORE — and the
     loop sent the newer tap at the server's rev as if its own write had
     landed, over the other device's rally, with no dialog. */
  it("is not sent over another device's rallies it has never seen", async () => {
    const id = await match(["a"]);
    const g = gated((n) => n === 0);
    const phone = await mount(id, g.push);
    phone.now.scoreOffline("a");          // ["a","a"] on the wire, held open
    await settle();
    expect(await actions.pushLog(id, ["a", "a"], 0)).toEqual({ ok: true, rev: 1 });
    expect(await actions.pushLog(id, ["a", "a", "b"], 1)).toEqual({ ok: true, rev: 2 });
    phone.now.scoreOffline("a");          // ["a","a","a"] queued meanwhile
    await settle();
    g.release();
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
    expect(phone.now.conflict).toMatchObject({ serverLog: ["a", "a", "b"], localLog: ["a", "a", "a"] });
  });

  /* The dialog offered the attempt's log, one rally short of the court. */
  it("is in the conflict the referee is asked about", async () => {
    const id = await match(["a"]);
    const g = gated((n) => n === 0);
    const phone = await mount(id, g.push);
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.pushLog(id, ["a", "b"], 0)).toEqual({ ok: true, rev: 1 });
    phone.now.scoreOffline("b");
    await settle();
    g.release();
    await settle();
    expect(phone.now.conflict).toMatchObject({ serverLog: ["a", "b"], localLog: ["a", "a", "b"] });
    await phone.now.resolveConflict("mine");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
    expect(await queue.loadQueued(id)).toBeNull();
  });

  it("builds on the write that just landed, before the page has re-rendered", async () => {
    const id = await match();
    const phone = await mount(id, actions.pushLog, { autoRefresh: false });
    phone.now.scoreOffline("a");
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "b"]);
    expect(phone.now.conflict).toBeNull();
  });
});

describe("the clock rides with what lands", () => {
  /* A pause tapped while a push was out was carried by nothing until the next
     point; the record said "running" through the whole injury. */
  it("a pause tapped during a push is written once it lands", async () => {
    const id = await match();
    const clock = countingClock();
    const g = gated((n) => n === 0);
    const phone = await mount(id, g.push, { clock });
    phone.now.scoreOffline("a");
    await settle();
    clock.pause = "injury";
    phone.now.syncClock();               // turned away: a push is on the wire
    g.release();
    await settle();
    expect((await stored(id)).timing).toMatchObject({ running: false, pauseReason: "injury" });
    expect(clock.hasPending()).toBe(false);
  });

  /* A push answered "behind" wrote nothing, so the time it carried goes back
     and rides on the next write — it was dropped. */
  it("time claimed for a write that did not land is put back", async () => {
    const id = await match(["a"]);
    const clock = countingClock();
    const g = gated((n) => n === 0);
    const phone = await mount(id, g.push, { clock });
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.pushLog(id, ["a", "a", "b"], 0)).toEqual({ ok: true, rev: 1 });
    g.release();
    await settle();
    expect(clock.restores).toBe(1);
    expect(clock.pending).toBe(1000);
  });
});

describe("a hold kept up to date", () => {
  /* Two phones held on one typed result; the first replaced it. The second's
     card went on showing a typed 11–7 the match no longer had, and every
     replace failed for ever. */
  it("is released when another phone replaces the typed result, and the difference is put to the referee", async () => {
    const { id, phone } = await heldAfterTyping();
    expect(await actions.pushLog(id, ["b", "b"], 1, undefined, { replaceTyped: true })).toEqual({ ok: true, rev: 2 });
    await phone.refresh();
    await settle();
    expect(phone.now.held).toBeNull();
    expect(phone.now.conflict).toMatchObject({ serverLog: ["b", "b"], localLog: ["a", "a"] });
    /* Released for good: the stored record is an ordinary queue again. */
    expect((await queue.loadQueued(id))?.held).toBe(false);
  });

  /* The same, found by pressing the button before the page has re-rendered:
     there is no typed result left to replace, so the phone says nothing went
     wrong and puts the two scores to the referee. */
  it("'Use this phone's score' after another phone replaced the result asks about the difference", async () => {
    const { id, phone } = await heldAfterTyping();
    expect(await actions.pushLog(id, ["b", "b"], 1, undefined, { replaceTyped: true })).toEqual({ ok: true, rev: 2 });
    expect(await phone.now.replaceTyped()).toBeNull();
    await settle();
    expect(phone.now.held).toBeNull();
    expect(phone.now.conflict).toMatchObject({ serverLog: ["b", "b"], localLog: ["a", "a"] });
    expect((await stored(id)).log).toEqual(["b", "b"]);
  });

  it("follows the result when it is typed again", async () => {
    const { id, phone } = await heldAfterTyping();
    expect(await actions.recordResult(id, { a: 11, b: 9, expectedRev: 1 })).toEqual({ ok: true, rev: 2 });
    await phone.refresh();
    await settle();
    expect(phone.now.held).toEqual({ a: 11, b: 9, rev: 2, outcome: null });
  });

  it("comes back after a reload while the match is still typed in, and sends nothing", async () => {
    const { id } = await heldAfterTyping();
    const again = await reload(id);
    await settle();
    expect(again.now.held).toEqual({ a: 11, b: 7, rev: 1, outcome: null });
    expect(again.now.queued).toBe(2);
    expect(again.pushes.length).toBe(0);
  });

  /* The typed result went because the ORGANISER cleared it: the held rallies
     are from before that, and are not put back (step 8). The test this
     replaces faked the clear with a raw UPDATE and expected them SENT — which
     is the bug. */
  it("is dropped after a reload once the organiser has cleared the result, and the phone says so", async () => {
    const { id } = await heldAfterTyping();
    await organiserClears(id);
    const again = await reload(id);
    await settle();
    expect(again.now.held).toBeNull();
    expect(again.now.conflict).toBeNull();
    expect(again.now.dropped).toEqual({ rallies: 2 });
    expect(again.pushes).toEqual([]);
    expect((await stored(id)).log).toEqual([]);
    expect((await queue.loadQueued(id))?.tombstone).toBe(true);
  });
});

/* A pause sent with nothing queued, answered "typed": there are no rallies on
   this phone to hold. It used to file the server's own log as held, and a
   reload then offered to "put back" rallies the organiser had replaced. */
describe("a pause on a match typed in over its rallies", () => {
  it("holds nothing, before or after a reload", async () => {
    const id = await match(["a", "a", "b"]);
    const phone = await mount(id);
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0, replaceLive: true })).toMatchObject({ ok: true });
    phone.now.syncClock();
    await settle();
    expect(phone.now.held).toBeNull();
    expect(await queue.loadQueued(id)).toBeNull();
    const again = await reload(id);
    await settle();
    expect(again.now.held).toBeNull();
    expect(again.now.queued).toBe(0);
  });
});

/* A write lands and its reply is lost; the timer sends the same log again, and
   the server answers "already there". The phone's next step — an undo made
   while that retry was out — used to be judged as "behind" the server and
   dropped, because only a write that LANDED counted as the phone's own. */
describe("a retry of a write that had landed unheard", () => {
  async function landedUnheard() {
    const id = await match();
    let call = 0;
    const gates: (() => void)[] = [];
    const flaky: typeof actions.pushLog = async (...p) => {
      call++;
      if (call === 1) { await actions.pushLog(...p); throw new Error("reply lost"); }
      if (call === 2) await new Promise<void>((r) => gates.push(r));
      return actions.pushLog(...p);
    };
    const phone = await mount(id, flaky);
    phone.now.scoreOffline("a");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    tickTimers();                         // the retry of ["a"], held open
    await settle();
    return { id, phone, release: () => gates.shift()!() };
  }

  it("an undo made while it is out still lands — straight away, at the rev just found", async () => {
    const { id, phone, release } = await landedUnheard();
    phone.now.undoOffline();
    await settle();
    release();
    await settle();
    expect((await stored(id)).log).toEqual([]);
    expect(phone.now.queued).toBe(0);
    /* The lost write, its retry, and the undo — not a fourth push sent at the
       old rev only to be told the server holds this phone's own log. On one
       bar of signal every round trip is seconds. */
    expect(phone.pushes).toEqual([["a"], ["a"], []]);
  });

  it("an undo and a tap made while it is out are this phone's own, not another device's", async () => {
    const { id, phone, release } = await landedUnheard();
    phone.now.undoOffline();
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    release();
    await settle();
    expect(phone.now.conflict).toBeNull();
    expect((await stored(id)).log).toEqual(["b"]);
  });
});

/* Another device takes a rally off. This phone has not seen it — the page
   does not poll — and its log is "ahead" of the server's, which was trusted as
   "rallies the server has not seen": the next tap, or even a pause with
   nothing queued, put the removed rally straight back. */
describe("another device's correction", () => {
  it("is not undone by a pause with nothing queued", async () => {
    const id = await match(["a", "a", "a"]);
    const clock = countingClock();
    const phone = await mount(id, actions.pushLog, { clock });
    expect(await actions.pushLog(id, ["a", "a"], 0)).toEqual({ ok: true, rev: 1 });
    clock.pause = "injury";
    phone.now.syncClock();
    await settle();
    const m = await stored(id);
    expect(m.log).toEqual(["a", "a"]);
    expect(m.timing).toMatchObject({ running: false, pauseReason: "injury" });
    expect(phone.now.conflict).toBeNull();
  });

  it("is not put to the referee as a conflict about rallies they never scored", async () => {
    const id = await match(["a", "a", "a"]);
    const clock = countingClock();
    const phone = await mount(id, actions.pushLog, { clock });
    expect(await actions.pushLog(id, ["a", "a", "b"], 0)).toEqual({ ok: true, rev: 1 });
    clock.pause = "timeout";
    phone.now.syncClock();
    await settle();
    expect(phone.now.conflict).toBeNull();
    expect(phone.now.queued).toBe(0);
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
  });

  it("is put to the referee, not written over, when this phone taps after it", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    expect(await actions.pushLog(id, ["a", "a"], 0)).toEqual({ ok: true, rev: 1 });
    phone.now.scoreOffline("b");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a"]);
    expect(phone.now.conflict).toMatchObject({ serverLog: ["a", "a"], localLog: ["a", "a", "a", "b"] });
  });
});

/* The server cuts a log at the rally that ended the game. It answered only
   "ok", so the phone took the UNCUT log as what the server held, and built
   its next undos on rallies the server had thrown away: each was cut back to
   the same finish and changed nothing. */
describe("a log the server cut at the finish", () => {
  /* The page's render at the same rev is the truth about that rev, and puts
     right a base learnt from a reply that said less than the row does. */
  it("is learnt from the page's render when the reply did not say", async () => {
    const id = await match();
    await db.update(schema.tournaments).set({ scoring: { target: 7 } })
      .where(eq(schema.tournaments.id, (await stored(id)).tournamentId));
    const terse: typeof actions.pushLog = async (...p) => {
      const r = await actions.pushLog(...p);
      return r.ok ? { ok: true, rev: r.rev } : r;
    };
    const phone = await mount(id, terse);
    setOnline(false);
    for (let i = 0; i < 9; i++) phone.now.scoreOffline("a");
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toHaveLength(7);
    phone.now.undoOffline();
    await settle();
    expect((await stored(id)).log).toHaveLength(6);
  });

  it("is what the phone's next undo builds on", async () => {
    const id = await match();
    await db.update(schema.tournaments).set({ scoring: { target: 7 } })
      .where(eq(schema.tournaments.id, (await stored(id)).tournamentId));
    const phone = await mount(id);       // the phone still plays to 11
    setOnline(false);
    /* Queued taps build on the newest log at once, so no wait is needed between
       them — and nine waits outlast the test on a coarse timer. */
    for (let i = 0; i < 9; i++) phone.now.scoreOffline("a");
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toHaveLength(7);
    phone.now.undoOffline();
    await settle();
    expect((await stored(id)).log).toHaveLength(6);
  });
});

/* "Use this phone's score", or "Keep this phone's score", whose reply never
   came, may have landed. The OTHER choice, made next, used to clear the phone
   and walk away — leaving the referee told one thing while the server held
   the other. */
describe("a choice whose reply never came", () => {
  async function heldWithLossyPush() {
    const id = await match();
    const ctl = { mode: "ok" as "ok" | "lose-after" | "lose-before" };
    const lossy: typeof actions.pushLog = async (...p) => {
      if (ctl.mode === "lose-before") { ctl.mode = "ok"; throw new Error("no route"); }
      const r = await actions.pushLog(...p);
      if (ctl.mode === "lose-after") { ctl.mode = "ok"; throw new Error("reply lost"); }
      return r;
    };
    const phone = await mount(id, lossy);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0 })).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.held).toMatchObject({ a: 11, b: 7 });
    return { id, phone, ctl };
  }
  const NO_SIGNAL = "The signal dropped before the server answered, so this may or may not have been saved. Try again when the signal is back.";

  it("Keep after a replace that landed unheard says the phone's score stands", async () => {
    const { id, phone, ctl } = await heldWithLossyPush();
    ctl.mode = "lose-after";
    expect(await phone.now.replaceTyped()).toBe(NO_SIGNAL);
    expect((await stored(id)).log).toEqual(["a", "a"]);
    expect(await phone.now.keepTyped()).toBe("This phone's score had already reached the server, so it replaced the typed result.");
    await settle();
    expect(phone.now.held).toBeNull();
    const m = await stored(id);
    expect([m.typedScoreA, m.log]).toEqual([null, ["a", "a"]]);
  });

  it("Keep after a replace that never arrived keeps the typed result", async () => {
    const { id, phone, ctl } = await heldWithLossyPush();
    ctl.mode = "lose-before";
    expect(await phone.now.replaceTyped()).toBe(NO_SIGNAL);
    expect(await phone.now.keepTyped()).toBeNull();
    await settle();
    expect(phone.now.held).toBeNull();
    const m = await stored(id);
    expect([m.typedScoreA, m.typedScoreB, m.log]).toEqual([11, 7, []]);
  });

  it("'Keep the saved score' after a 'Keep this phone's score' that landed unheard puts the saved score back", async () => {
    const id = await match();
    let lose = false;
    const lossy: typeof actions.pushLog = async (...p) => {
      const r = await actions.pushLog(...p);
      if (lose) { lose = false; throw new Error("reply lost"); }
      return r;
    };
    const phone = await mount(id, lossy);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.pushLog(id, ["b"], 0)).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.conflict).toMatchObject({ serverLog: ["b"], localLog: ["a"] });
    lose = true;
    expect(await phone.now.resolveConflict("mine")).toBe(NO_SIGNAL);
    expect((await stored(id)).log).toEqual(["a"]);
    expect(await phone.now.resolveConflict("theirs")).toBeNull();
    await settle();
    expect((await stored(id)).log).toEqual(["b"]);
    expect(phone.now.conflict).toBeNull();
  });
});

describe("a reload", () => {
  /* Until the queue an earlier session left has been read, a tap built on the
     render's log — and then one of the two was lost. The court waits. */
  it("takes no tap before the stored queue has been read", async () => {
    const id = await match();
    await queue.saveQueued({ matchId: id, log: ["a", "a"], baseRev: 0, baseLog: [], queuedAt: 0 });
    const phone = await mount(id, actions.pushLog, {
      beforeLoad: (now) => {
        expect(now.ready).toBe(false);
        now.scoreOffline("b");
      },
    });
    await settle();
    expect(phone.now.ready).toBe(true);
    expect((await stored(id)).log).toEqual(["a", "a"]);
  });

  /* A record queued before the phone kept what the server held knows only
     its rev. Nobody has written since that rev, so it is the phone's own work
     — an undo made offline included. */
  it("sends an undo from a record that knows only its rev", async () => {
    const id = await match(["a", "b", "a"]);
    await queue.saveQueued({ matchId: id, log: ["a", "b"], baseRev: 0, queuedAt: 0 });
    await reload(id);
    await settle();
    expect((await stored(id)).log).toEqual(["a", "b"]);
  });
});

/* A reload asks the same question the send loop asks. The send loop refused to
   push over a point another device had taken off; a RELOAD did not, and a
   refreshed phone quietly put the point back. */
describe("a reload after another device took a point off", () => {
  it("puts the difference to the referee instead of writing the point back", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    expect(await actions.pushLog(id, ["a", "a"], 0)).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a"]);
    expect(again.now.conflict).toMatchObject({ serverLog: ["a", "a"], localLog: ["a", "a", "a", "b"] });
    /* And nothing is sent while the referee is being asked: the retry timer
       wrote it over fifteen seconds later, the question still on screen. */
    tickTimers();
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a"]);
    expect(again.now.conflict).not.toBeNull();
  });

  it("a disagreement found on reload is not sent by the timer either", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    expect(await actions.pushLog(id, ["a", "a", "a", "a"], 0)).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect(again.now.conflict).toMatchObject({ serverLog: ["a", "a", "a", "a"], localLog: ["a", "a", "a", "b"] });
    tickTimers();
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a", "a", "a"]);
  });

  /* A hold released with an undo in it: the organiser typed over the rallies
     (the log went to nothing), then the typed result went. The phone's log is
     shorter than its base and the server holds less still — not this phone's
     work to overwrite without asking. */
  it("a released hold carrying an undo is put to the referee too", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0, replaceLive: true })).toMatchObject({ ok: true });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.held).toMatchObject({ a: 11, b: 7 });
    /* Another phone replaces the typed result, then takes its own rally off:
       no reset, and nothing this phone has seen. */
    expect(await actions.pushLog(id, ["b"], 1, undefined, { replaceTyped: true })).toEqual({ ok: true, rev: 2 });
    expect(await actions.pushLog(id, [], 2)).toEqual({ ok: true, rev: 3 });
    await phone.refresh();
    await settle();
    expect(phone.now.held).toBeNull();
    expect(phone.now.conflict).toMatchObject({ serverLog: [], localLog: ["a", "a"] });
    expect((await stored(id)).log).toEqual([]);
  });

  /* The same hold, with the typed result cleared by the organiser: nothing to
     ask — the rallies are from before the reset and are not put back. */
  it("a released hold is dropped, not asked about, when the organiser cleared the result", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0, replaceLive: true })).toMatchObject({ ok: true });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.held).toMatchObject({ a: 11, b: 7 });
    const sent = phone.pushes.length;
    await organiserClears(id);
    await phone.refresh();
    await settle();
    expect(phone.mounts).toBe(2);
    expect(phone.now.held).toBeNull();
    expect(phone.now.conflict).toBeNull();
    expect(phone.pushes.length).toBe(sent);
    expect((await stored(id)).log).toEqual([]);
  });
});

describe("the conflict dialog meeting a match that changed in other ways", () => {
  async function inConflict() {
    const id = await match();
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.pushLog(id, ["b"], 0)).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.conflict).toMatchObject({ serverLog: ["b"], localLog: ["a"] });
    return { id, phone };
  }

  it("'Keep this phone's score' on a match typed in meanwhile holds the rallies for that choice", async () => {
    const { id, phone } = await inConflict();
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 1, replaceLive: true })).toMatchObject({ ok: true });
    expect(await phone.now.resolveConflict("mine")).toBeNull();
    await settle();
    expect(phone.now.conflict).toBeNull();
    expect(phone.now.held).toMatchObject({ a: 11, b: 7 });
    const m = await stored(id);
    expect([m.typedScoreA, m.typedScoreB]).toEqual([11, 7]);
  });

  it("'Keep this phone's score' on a match deleted meanwhile says so and keeps nothing", async () => {
    const { id, phone } = await inConflict();
    await db.delete(schema.matches).where(eq(schema.matches.id, id));
    expect(await phone.now.resolveConflict("mine")).toBeNull();
    await settle();
    expect(phone.now.conflict).toBeNull();
    expect(phone.now.refused).toMatchObject({ title: "This match was deleted" });
    expect(await queue.loadQueued(id)).toBeNull();
  });
});

/* After a reload, a hold comes back — and a choice made on it whose reply never
   came is checked before the other choice clears anything. */
describe("a choice on a hold that came back after a reload", () => {
  it("'Use this phone's score' lost on the way back, then Keep, says the phone's score stands", async () => {
    const id = await match();
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0 })).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.held).toMatchObject({ a: 11, b: 7 });

    let lose = true;
    const lossy: typeof actions.pushLog = async (...p) => {
      const r = await actions.pushLog(...p);
      if (lose) { lose = false; throw new Error("reply lost"); }
      return r;
    };
    const again = await reload(id, lossy);
    await settle();
    expect(again.now.held).toMatchObject({ a: 11, b: 7 });
    expect(await again.now.replaceTyped()).toBe(
      "The signal dropped before the server answered, so this may or may not have been saved. Try again when the signal is back.",
    );
    expect(await again.now.keepTyped()).toBe("This phone's score had already reached the server, so it replaced the typed result.");
    await settle();
    const m = await stored(id);
    expect([m.typedScoreA, m.log]).toEqual([null, ["a", "a"]]);
  });
});

/* This phone took a rally off while another device scored on top. Ours is a
   prefix of theirs, "behind", and was dropped as already there: the point the
   referee removed came back. It is a question, by the send loop and on reload. */
describe("this phone's undo against another device's rally", () => {
  async function undoneBeneath() {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    expect(await actions.pushLog(id, ["a", "a", "a", "b"], 0)).toEqual({ ok: true, rev: 1 });
    return { id, phone };
  }

  it("is put to the referee by the send loop", async () => {
    const { id, phone } = await undoneBeneath();
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.conflict).toMatchObject({ serverLog: ["a", "a", "a", "b"], localLog: ["a", "a"] });
    expect((await stored(id)).log).toEqual(["a", "a", "a", "b"]);
  });

  it("is put to the referee on reload", async () => {
    const { id } = await undoneBeneath();
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect(again.now.conflict).toMatchObject({ serverLog: ["a", "a", "a", "b"], localLog: ["a", "a"] });
    expect(await queue.loadQueued(id)).not.toBeNull();
  });
});

/* Round two of the review, each by the send loop and on reload where both
   decide it. */
describe("both devices took the same rally off, and the other then scored", () => {
  async function bothUndid() {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    expect(await actions.pushLog(id, ["a", "a"], 0)).toEqual({ ok: true, rev: 1 });
    expect(await actions.pushLog(id, ["a", "a", "b"], 1)).toEqual({ ok: true, rev: 2 });
    return { id, phone };
  }

  it("asks nothing in the send loop: the server has what this phone has, and not what it removed", async () => {
    const { id, phone } = await bothUndid();
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.conflict).toBeNull();
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
    expect(await queue.loadQueued(id)).toBeNull();
  });

  it("asks nothing on reload either", async () => {
    const { id } = await bothUndid();
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect(again.now.conflict).toBeNull();
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
    expect(await queue.loadQueued(id)).toBeNull();
  });
});

/* The reload's half of removedElsewhere's last clause: another device took a
   rally off, and this phone took the SAME one off and tapped the other side.
   Pushing ours restores nothing, so it goes without a question. */
describe("a reload after both devices took the same rally off and this one tapped anew", () => {
  it("sends this phone's rallies with no question", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    expect(await actions.pushLog(id, ["a", "a"], 0)).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect(again.now.conflict).toBeNull();
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
  });
});

/* A write lands and its reply is lost; the signal then dies, and the referee
   takes that rally off and scores on, every push failing. Eight failed pushes
   used to push the landed write out of the phone's list, and when the signal
   came back the referee was asked about their own write as if another device
   had made it — "Keep the saved score" would have thrown away eight rallies. */
describe("a landed write followed by a long dead spell", () => {
  it("is still recognised as this phone's own", async () => {
    const id = await match();
    let call = 0;
    let dead = false;
    const flaky: typeof actions.pushLog = async (...p) => {
      call++;
      if (call === 1) { await actions.pushLog(...p); throw new Error("reply lost"); }
      if (dead) throw new Error("no route");
      return actions.pushLog(...p);
    };
    const phone = await mount(id, flaky);
    phone.now.scoreOffline("a");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    dead = true;
    phone.now.undoOffline();
    await settle();
    for (let i = 0; i < 8; i++) {
      phone.now.scoreOffline("b");
      await settle();
    }
    expect(phone.now.queued).toBe(8);
    dead = false;
    tickTimers();
    await settle();
    expect(phone.now.conflict).toBeNull();
    expect((await stored(id)).log).toEqual(Array(8).fill("b"));
    /* Ten settles: Windows timers make each one slow. */
  }, 30_000);
});

/* The organiser typed a result over rallies this phone queued with no signal,
   and the phone reloaded before any push came back "typed". Judged as
   rallies, the typed match's empty log read as another device taking every
   rally off: a two-device question beside a locked court. It is the typed
   result's choice, as the signal coming back gives. */
describe("a reload of a match typed in over this phone's queued rallies", () => {
  it("offers the typed result's choice, not a two-device conflict", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0, replaceLive: true })).toMatchObject({ ok: true, rev: 1 });
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect(again.now.conflict).toBeNull();
    expect(again.now.held).toEqual({ a: 11, b: 7, rev: 1, outcome: null });
    expect((await queue.loadQueued(id))?.held).toBe(true);
    expect((await stored(id)).typedScoreA).toBe(11);
  });
});

/* ── The organiser resets the match (step 8) ─────────────────────────────────
 * A clear or a reset on the manage screen moves the match's reset_rev. Rallies
 * this phone built before it are never put back — not sent, held or asked
 * about — wherever they are found: on a reload, in the send loop, behind a
 * hold, behind a conflict. The phone says how many it let go, and the court
 * starts again at 0–0. Each test here fails on the code before step 8, where a
 * cleared match looked like one never started and the phone wrote its rallies
 * back. */

/** A phone that scored two rallies on top of a 1–0 with no signal, before the
    organiser reset the match. */
async function queuedBeforeReset() {
  const id = await match(["a"]);
  const phone = await mount(id);
  setOnline(false);
  phone.now.scoreOffline("b");
  await settle();
  phone.now.scoreOffline("b");
  await settle();
  expect((await queue.loadQueued(id))?.log).toEqual(["a", "b", "b"]);
  const reset = await organiserClears(id);
  return { id, phone, reset };
}

describe("rallies from before a reset, found on a reload", { timeout: 30_000 }, () => {
  it("are dropped, never sent, and the phone says how many", async () => {
    const { id } = await queuedBeforeReset();
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect(again.pushes).toEqual([]);
    expect(again.now.dropped).toEqual({ rallies: 2 });
    expect(again.now.conflict).toBeNull();
    expect(again.now.held).toBeNull();
    expect((await stored(id)).log).toEqual([]);
    /* Nothing is sent later either. */
    tickTimers();
    fire("online");
    await settle();
    expect(again.pushes).toEqual([]);
  });

  it("are dropped when the queue was an undo made past the reset", async () => {
    const id = await match(["a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    await organiserClears(id);
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect(again.pushes).toEqual([]);
    expect(again.now.conflict).toBeNull();
    expect((await stored(id)).log).toEqual([]);
  });

  it("leave a court that takes the next rally from 0–0", async () => {
    const { id } = await queuedBeforeReset();
    setOnline(true);
    const again = await reload(id);
    await settle();
    again.now.scoreOffline("a");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
  });
});

describe("rallies from before a reset, in the send loop", { timeout: 30_000 }, () => {
  it("are sent once, answered 'reset', and the page is fetched again at 0–0", async () => {
    const { id, phone, reset } = await queuedBeforeReset();
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.pushes).toEqual([["a", "b", "b"]]);
    /* The page came back with the new reset_rev and the console remounted: the
       remounted console found the old record and let it go. */
    expect(phone.mounts).toBe(2);
    expect(phone.now.dropped).toEqual({ rallies: 2 });
    expect(phone.now.conflict).toBeNull();
    const m = await stored(id);
    expect([m.log, m.rev]).toEqual([[], reset]);
    /* A tap after the remount lands. */
    phone.now.scoreOffline("b");
    await settle();
    expect((await stored(id)).log).toEqual(["b"]);
  });

  /* Answered "reset" with no page coming back (the signal dropped between the
     reply and the render): the old console takes no tap and sends nothing,
     at any rev — the timer and the online event fetch the page instead. */
  it("stop everything on the old console until the page comes back", async () => {
    const id = await match(["a"]);
    const phone = await mount(id, actions.pushLog, { autoRefresh: false });
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    await organiserClears(id);
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.resetting).toEqual({ rallies: 1 });
    phone.now.scoreOffline("a");
    await settle();
    expect((await queue.loadQueued(id))?.log, "the tap was not taken").toEqual(["a", "b"]);
    tickTimers();
    fire("online");
    await settle();
    expect(phone.pushes).toEqual([["a", "b"]]);
    expect((await stored(id)).log).toEqual([]);
  });

  /* A pause with nothing queued carries the log the phone last knew. From
     before the reset it is answered "reset" and moves nothing; the page comes
     back, and play goes on. */
  it("a pause from before the reset moves nothing, and the next tap lands", async () => {
    const id = await match(["a", "a"]);
    const phone = await mount(id, actions.pushLog, { clock: countingClock() });
    const reset = await organiserClears(id);
    phone.clock.pause = "injury";
    phone.now.syncClock();
    await settle();
    const m = await stored(id);
    expect([m.rev, m.timing, m.log]).toEqual([reset, null, []]);
    expect(phone.mounts).toBe(2);
    expect(phone.now.dropped).toBeNull();
    phone.now.scoreOffline("b");
    await settle();
    expect((await stored(id)).log).toEqual(["b"]);
  });
});

describe("rallies from before a reset, behind a choice", { timeout: 30_000 }, () => {
  it("held for a typed result, are dropped when the organiser clears it — on the next render and on a reload", async () => {
    const { id, phone } = await heldAfterTyping();
    const sent = phone.pushes.length;
    await organiserClears(id);
    await phone.refresh();
    await settle();
    expect(phone.mounts).toBe(2);
    expect(phone.now.held).toBeNull();
    expect(phone.now.dropped).toEqual({ rallies: 2 });
    expect(phone.pushes.length).toBe(sent);
    const again = await reload(id);
    await settle();
    expect(again.now.held).toBeNull();
    expect(again.now.dropped).toBeNull(); // already let go, and said once
    expect(again.pushes).toEqual([]);
    expect((await stored(id)).log).toEqual([]);
  });

  it("held, then cleared and typed in again: the new result stands and nothing is held", async () => {
    const { id } = await heldAfterTyping();
    const reset = await organiserClears(id);
    expect(await actions.recordResult(id, { a: 11, b: 3, expectedRev: reset })).toMatchObject({ ok: true });
    const again = await reload(id);
    await settle();
    expect(again.now.held).toBeNull();
    expect(again.now.dropped).toEqual({ rallies: 2 });
    expect(again.pushes).toEqual([]);
    const m = await stored(id);
    expect([m.typedScoreA, m.typedScoreB, m.log]).toEqual([11, 3, []]);
  });

  it("'Use this phone's score' after the organiser cleared the result is answered 'reset' and lands nothing", async () => {
    const { id, phone } = await heldAfterTyping();
    const reset = await organiserClears(id);
    expect(await actions.recordResult(id, { a: 11, b: 3, expectedRev: reset })).toMatchObject({ ok: true });
    await phone.now.replaceTyped();
    await settle();
    const m = await stored(id);
    expect([m.typedScoreA, m.typedScoreB, m.log]).toEqual([11, 3, []]);
    expect(phone.mounts).toBe(2);
    expect(phone.now.held).toBeNull();
    expect(phone.now.dropped).toEqual({ rallies: 2 });
  });

  it("'Keep this phone's score' after the organiser reset the match is answered 'reset' and lands nothing", async () => {
    const id = await match(["a", "a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    expect(await actions.pushLog(id, ["a", "a", "a", "a"], 0)).toEqual({ ok: true, rev: 1 });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.conflict).not.toBeNull();
    await organiserClears(id);
    await phone.now.resolveConflict("mine");
    await settle();
    expect((await stored(id)).log).toEqual([]);
    expect(phone.mounts).toBe(2);
    expect(phone.now.conflict).toBeNull();
  });
});

describe("a push that landed before the reset, answered after the console remounted", { timeout: 30_000 }, () => {
  it("does not delete the record the new console made", async () => {
    const id = await match([]);
    const gates: (() => void)[] = [];
    let n = 0;
    /* The request lands at once; its REPLY is held back. */
    const push: typeof actions.pushLog = async (...p) => {
      const r = await actions.pushLog(...p);
      if (n++ === 0) await new Promise<void>((res) => gates.push(res));
      return r;
    };
    const phone = await mount(id, push);
    phone.now.scoreOffline("a");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    const reset = await organiserClears(id);
    await phone.refresh();
    await settle();
    expect(phone.mounts).toBe(2);
    setOnline(false);
    /* The SAME rally the old push carried: by its log alone the new record
       looks like the one that landed, and "clear it if it landed" deleted it. */
    phone.now.scoreOffline("a");
    await settle();
    expect(await queue.loadQueued(id)).toMatchObject({ log: ["a"], resetRev: reset });

    gates.shift()!(); // the old push's reply arrives
    await settle();
    expect(await queue.loadQueued(id)).toMatchObject({ log: ["a"], resetRev: reset });
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
  });
});

/* A cold load with no signal is answered by the service worker from its cache:
   the referee's last FULL page load, often from before a reset or before a
   write this phone made since. Nothing is judged against a page OLDER than
   the record on the phone (amendment A1). */
describe("a cold load from a cached page older than the phone's record", { timeout: 30_000 }, () => {
  it("does not take this phone's own writes for another device's correction", async () => {
    const id = await match([]);
    const phone = await mount(id);
    phone.now.scoreOffline("a");
    await settle();
    phone.now.scoreOffline("a");
    await settle();
    expect((await stored(id)).rev).toBe(2);
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    /* The cached page is from the first rally. */
    const again = await reload(id, actions.pushLog, { serverLog: ["a"], serverRev: 1, resetRev: 0 });
    await settle();
    expect(again.now.conflict).toBeNull();
    expect((await queue.loadQueued(id))?.log).toEqual(["a", "a", "b"]);
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "a", "b"]);
  });

  it("does not judge rallies scored after a reset against the score before it", async () => {
    const id = await match(["a", "a"]);
    const reset = await organiserClears(id);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    expect(await queue.loadQueued(id)).toMatchObject({ log: ["a"], resetRev: reset });
    /* The cached page still shows 2–0 from before the reset; judged against it,
       the new 1–0 read as "behind" and was deleted with no question. */
    const again = await reload(id, actions.pushLog, { serverLog: ["a", "a"], serverRev: 0, resetRev: 0 });
    await settle();
    expect(again.now.conflict).toBeNull();
    expect((await queue.loadQueued(id))?.log).toEqual(["a"]);
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
  });

  /* The record was let go on a load that knew about the reset. A later cold
     load of the pre-reset page finds the tombstone and starts from 0–0, not
     from the old score. */
  it("starts from 0–0 when the phone already let the old rallies go", async () => {
    const { id } = await queuedBeforeReset();
    setOnline(true);
    await reload(id);
    await settle();
    expect((await queue.loadQueued(id))?.tombstone).toBe(true);
    setOnline(false);
    const cold = await reload(id, actions.pushLog, { serverLog: ["a"], serverRev: 0, resetRev: 0 });
    await settle();
    expect(cold.now.local).toMatchObject({ a: 0, b: 0 });
    cold.now.scoreOffline("b");
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect(cold.pushes).toEqual([["b"]]);
    expect((await stored(id)).log).toEqual(["b"]);
  });
});

/* ── Round one of step 8's review ───────────────────────────────────────────
 * A page served from the cache with no signal can be OLDER than a reset the
 * phone already knows of — its stored record was built after the reset. The
 * page used to stamp everything it wrote with ITS older reset, and the queue
 * refused every one of those writes as "from before the reset": taps shown on
 * the court and never kept, lost on the next cold load; and the record from
 * before the cold load never cleared, so it came back and was resumed as this
 * phone's next step. */

/** The phone starts again with no signal, and the service worker serves the
    last full page load — from before the organiser's reset. */
const coldFromCache = (id: string, cached: { serverLog: Side[]; serverRev: number; resetRev: number }) => {
  setOnline(false);
  return reload(id, actions.pushLog, cached);
};
const PRE_RESET = (log: Side[]) => ({ serverLog: log, serverRev: 0, resetRev: 0 });

describe("a page from the cache, older than a reset the phone knows of", { timeout: 30_000 }, () => {
  it("keeps every tap made on it, through a second cold load, and sends them", async () => {
    const id = await match(["a", "a"]);
    const reset = await organiserClears(id);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    const cold = await coldFromCache(id, PRE_RESET(["a", "a"]));
    await settle();
    expect(cold.now.knownReset).toBe(reset);
    cold.now.scoreOffline("b");
    await settle();
    expect(await queue.loadQueued(id)).toMatchObject({ log: ["a", "b"], resetRev: reset });
    const again = await coldFromCache(id, PRE_RESET(["a", "a"]));
    await settle();
    expect(again.now.local).toMatchObject({ a: 1, b: 1 });
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "b"]);
  });

  it("keeps taps made over a tombstone, too", async () => {
    const { id } = await queuedBeforeReset();
    setOnline(true);
    await reload(id);
    await settle();
    expect((await queue.loadQueued(id))?.tombstone).toBe(true);
    const cold = await coldFromCache(id, PRE_RESET(["a"]));
    await settle();
    cold.now.scoreOffline("b");
    await settle();
    cold.now.scoreOffline("b");
    await settle();
    expect((await queue.loadQueued(id))?.log).toEqual(["b", "b"]);
    const again = await coldFromCache(id, PRE_RESET(["a"]));
    await settle();
    expect(again.now.local).toMatchObject({ a: 0, b: 2 });
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["b", "b"]);
  });

  /* The record from before the cold load used to survive the page's landed
     write and be resumed after the refresh: a saved rally taken off again with
     no question, or the phone's own undo put to the referee as another
     device's. */
  it("leaves nothing behind to be resumed once its write lands", async () => {
    const id = await match(["a", "a"]);
    const reset = await organiserClears(id);
    const phone = await mount(id);
    phone.now.scoreOffline("a");
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "b"]);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    const cold = await coldFromCache(id, PRE_RESET(["a", "a"]));
    await settle();
    cold.now.scoreOffline("b");
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "b"]);
    expect(cold.now.conflict).toBeNull();
    expect((await stored(id)).resetRev).toBe(reset);
    expect(await queue.loadQueued(id)).toBeNull();
  });

  it("an undo of everything on it lands, and is not asked about afterwards", async () => {
    const id = await match(["a", "a"]);
    await organiserClears(id);
    const phone = await mount(id);
    phone.now.scoreOffline("a");
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    const cold = await coldFromCache(id, PRE_RESET(["a", "a"]));
    await settle();
    cold.now.undoOffline();
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual([]);
    expect(cold.now.conflict).toBeNull();
  });

  it("'Keep the saved score' in a conflict found on it is not asked again after the refresh", async () => {
    const id = await match(["a", "a"]);
    const reset = await organiserClears(id);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.pushLog(id, ["b", "b"], reset)).toEqual({ ok: true, rev: reset + 1 });
    const cold = await coldFromCache(id, PRE_RESET(["a", "a"]));
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect(cold.now.conflict).toMatchObject({ serverLog: ["b", "b"], localLog: ["a"] });
    await cold.now.resolveConflict("theirs");
    await settle();
    expect(cold.now.conflict).toBeNull();
    expect(await queue.loadQueued(id)).toBeNull();
    expect((await stored(id)).log).toEqual(["b", "b"]);
  });

  it("counts what is not yet saved against what the server holds, not the cached page", async () => {
    const id = await match(["a", "a"]);
    await organiserClears(id);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    const cold = await coldFromCache(id, PRE_RESET(["a", "a"]));
    await settle();
    expect(cold.now.queued).toBe(1);
    expect(cold.now.stalled).toBe(true);
  });

  /* Once the write lands, the court used to fall back to the cached page —
     the score from before the reset — until a refresh happened to succeed. */
  it("shows what the server holds once its write lands, not the cached score", async () => {
    const id = await match(["a", "a"]);
    await organiserClears(id);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    timers.clear();
    for (const k of Object.keys(listeners)) delete listeners[k];
    const cold = await mount(id, actions.pushLog, { cached: PRE_RESET(["a", "a"]), autoRefresh: false });
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["b"]);
    expect(cold.now.local).toMatchObject({ a: 0, b: 1 });
    /* The page has not come back (a refresh that failed): the timer keeps
       asking for it, with nothing to send. */
    const asked = cold.syncs;
    tickTimers();
    await settle();
    expect(cold.syncs).toBeGreaterThan(asked);
    expect(cold.pushes.length).toBe(1);
  });
});

describe("after a 'reset' reply, before the page comes back", { timeout: 30_000 }, () => {
  it("says nothing is waiting to be saved, and shows no score of its own", async () => {
    const id = await match(["a"]);
    const phone = await mount(id, actions.pushLog, { autoRefresh: false });
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    await organiserClears(id);
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.resetting).toEqual({ rallies: 1 });
    expect(phone.now.queued).toBe(0);
    expect(phone.now.local).toBeNull();
  });
});

describe("what the phone says it let go", { timeout: 30_000 }, () => {
  /* An undo, then two new rallies: two rallies the referee tapped. A net count
     (log − base) called it one. */
  it("counts every rally tapped past where it parted from the server", async () => {
    const id = await match(["a", "a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    expect((await queue.loadQueued(id))?.log).toEqual(["a", "b", "b"]);
    await organiserClears(id);
    setOnline(true);
    const again = await reload(id);
    await settle();
    expect(again.now.dropped).toEqual({ rallies: 2 });
  });
});

describe("a typed result over an undo back to 0–0", { timeout: 30_000 }, () => {
  /* Replacing a typed result with no rallies would CLEAR it — the organiser's
     alone. The phone says so instead of blaming another device. */
  it("offers nothing to replace it with, and sends nothing", async () => {
    const id = await match(["a"]);
    const phone = await mount(id);
    setOnline(false);
    phone.now.undoOffline();
    await settle();
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: 0, replaceLive: true })).toMatchObject({ ok: true });
    setOnline(true);
    fire("online");
    await settle();
    expect(phone.now.held).toMatchObject({ a: 11, b: 7 });
    const sent = phone.pushes.length;
    expect(await phone.now.replaceTyped()).toBe(
      "This phone has no rallies to put in place of the typed result — keep it, or ask the organiser to clear it.",
    );
    expect(phone.pushes.length).toBe(sent);
    const m = await stored(id);
    expect([m.typedScoreA, m.typedScoreB]).toEqual([11, 7]);
  });
});

/* ── Round two of step 8's review ───────────────────────────────────────── */

/** A push whose first request LANDS at once and whose reply is held back
    until `release()`; every later push goes straight through. */
function slowFirstReply() {
  let open: (() => void) | null = null;
  let n = 0;
  const push: typeof actions.pushLog = async (...p) => {
    const res = await actions.pushLog(...p);
    if (n++ === 0) await new Promise<void>((r) => { open = r; });
    return res;
  };
  return { push, release: () => open?.() };
}

/** After a reset, a cold load from the cache with the post-reset rally ["a"]
    queued; the signal returns, the cached console sends ["a"] (it lands, the
    reply is slow), the referee taps "b" on it, and then the fresh page arrives
    and the console is replaced. */
async function replacedWhileItsReplyIsOut() {
  const id = await match(["a", "a"]);
  await organiserClears(id);
  const phone = await mount(id);
  setOnline(false);
  phone.now.scoreOffline("a");
  await settle();
  const slow = slowFirstReply();
  timers.clear();
  for (const k of Object.keys(listeners)) delete listeners[k];
  const cached = await mount(id, slow.push, { cached: PRE_RESET(["a", "a"]), autoRefresh: false });
  await settle();
  setOnline(true);
  fire("online");
  await settle();
  expect((await stored(id)).log).toEqual(["a"]);
  cached.now.scoreOffline("b");
  await settle();
  await cached.refresh();
  await settle();
  expect(cached.mounts).toBe(2);
  expect((await stored(id)).log).toEqual(["a", "b"]);
  return { id, phone: cached, release: slow.release };
}

describe("a console that has been replaced", { timeout: 30_000 }, () => {
  /* The old console's slow reply arrived after the new one had a tap queued:
     it saved its own older log over the new record, sent it, and deleted it as
     landed — the tap was gone on the next reload. */
  it("does nothing with a reply that arrives after it was replaced", async () => {
    const { id, phone, release } = await replacedWhileItsReplyIsOut();
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    expect((await queue.loadQueued(id))?.log).toEqual(["a", "b", "b"]);
    release();
    await settle();
    expect((await queue.loadQueued(id))?.log).toEqual(["a", "b", "b"]);
    setOnline(true);
    fire("online");
    await settle();
    expect((await stored(id)).log).toEqual(["a", "b", "b"]);
  });

  /* …or wrote its older log back over an undo the new console had landed. */
  it("never writes over what the console that replaced it has done", async () => {
    const { id, phone, release } = await replacedWhileItsReplyIsOut();
    phone.now.undoOffline();
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    release();
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
  });
});

describe("a tombstone on a page from the cache", { timeout: 30_000 }, () => {
  /* Nothing to send, so nothing is sent — it used to go as a no-op write and,
     on a match typed in since, came back filed as held rallies. */
  it("is not sent, and never held over a result typed in since", async () => {
    const { id } = await queuedBeforeReset();
    setOnline(true);
    await reload(id);
    await settle();
    expect((await queue.loadQueued(id))?.tombstone).toBe(true);
    const reset = (await stored(id)).rev;
    expect(await actions.recordResult(id, { a: 11, b: 7, expectedRev: reset })).toMatchObject({ ok: true });
    const cold = await coldFromCache(id, PRE_RESET(["a"]));
    await settle();
    setOnline(true);
    fire("online");
    tickTimers();
    await settle();
    expect(cold.pushes).toEqual([]);
    const fresh = await reload(id);
    await settle();
    expect(fresh.now.held).toBeNull();
    expect((await queue.loadQueued(id))?.held).toBeFalsy();
  });
});

describe("what a page from the cache shows after a choice", { timeout: 30_000 }, () => {
  async function conflictOnACachedPage() {
    const id = await match(["a", "a"]);
    const reset = await organiserClears(id);
    const phone = await mount(id);
    setOnline(false);
    phone.now.scoreOffline("a");
    await settle();
    expect(await actions.pushLog(id, ["b", "b"], reset)).toEqual({ ok: true, rev: reset + 1 });
    timers.clear();
    for (const k of Object.keys(listeners)) delete listeners[k];
    const cold = await mount(id, actions.pushLog, { cached: PRE_RESET(["a", "a"]), autoRefresh: false });
    await settle();
    setOnline(true);
    fire("online");
    await settle();
    expect(cold.now.conflict).toMatchObject({ serverLog: ["b", "b"], localLog: ["a"] });
    return { id, cold };
  }

  it("'Keep the saved score' shows the saved score, and counts one new tap as one", async () => {
    const { id, cold } = await conflictOnACachedPage();
    await cold.now.resolveConflict("theirs");
    await settle();
    expect((await stored(id)).log).toEqual(["b", "b"]);
    expect(cold.now.local).toMatchObject({ a: 0, b: 2 });
    setOnline(false);
    cold.now.scoreOffline("a");
    await settle();
    expect(cold.now.queued).toBe(1);
  });

  it("'Keep this phone's score' shows this phone's score", async () => {
    const { id, cold } = await conflictOnACachedPage();
    await cold.now.resolveConflict("mine");
    await settle();
    expect((await stored(id)).log).toEqual(["a"]);
    expect(cold.now.local).toMatchObject({ a: 1, b: 0 });
  });
});

describe("the rallies a 'reset' reply lets go", { timeout: 30_000 }, () => {
  /* Counted from the newest log on the phone: a tap made while the push was on
     the wire was let go too. */
  it("include a tap made while the push was out", async () => {
    const id = await match(["a"]);
    const g = gated((n) => n === 0);
    const phone = await mount(id, g.push, { autoRefresh: false });
    setOnline(false);
    phone.now.scoreOffline("b");
    await settle();
    await organiserClears(id);
    setOnline(true);
    fire("online");
    await settle();
    phone.now.scoreOffline("b");
    await settle();
    expect((await queue.loadQueued(id))?.log).toEqual(["a", "b", "b"]);
    g.release();
    await settle();
    expect(phone.now.resetting).toEqual({ rallies: 2 });
  });
});
