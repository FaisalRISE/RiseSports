/* Offline rally queue.
 *
 * A sports hall is exactly where Wi-Fi drops, and the referee console is the
 * one screen that cannot wait for a reconnect. Rallies tapped with no signal
 * are held here and replayed when the network returns.
 *
 * ── Why this is tractable at all ──────────────────────────────────────────
 * `commitLog` writes the ENTIRE log array guarded by `rev`, rather than
 * appending one rally at a time. So a device coming back online sends its whole
 * log with the rev it started from and the database settles it atomically —
 * there is no partial-append state to reason about.
 *
 * ── Why IndexedDB and not localStorage ────────────────────────────────────
 * localStorage is synchronous, so every write janks the tap it came from, and
 * it is capped at a few MB shared with everything else on the origin. A
 * referee's phone is also going to get backgrounded mid-match. IndexedDB is
 * asynchronous and durable, which is what this needs.
 *
 * ── The part that must not be clever ──────────────────────────────────────
 * When the server has moved on too — a second device scored the same match —
 * there is no safe automatic answer. `classify` names the situation and the
 * console asks the referee. Silently picking a winner would show a score that
 * looks saved and is wrong, which is the worst outcome available here.
 */

import type { Side } from "@/lib/scoring/replayLite";

export type QueuedMatch = {
  matchId: string;
  /** The device's full log, including rallies the server has not seen. */
  log: Side[];
  /** The `rev` the device last successfully read or wrote. */
  baseRev: number;
  queuedAt: number;
};

/** How a device's log relates to the server's. */
export type Relation =
  /** Identical — the write already landed, or nothing was added. */
  | "same"
  /** Server's log is a prefix of ours: we have rallies it has not seen. Safe to push. */
  | "ahead"
  /** Ours is a prefix of the server's: it has rallies we have not seen. Adopt it. */
  | "behind"
  /** Both added different rallies. Needs a human. */
  | "diverged";

const isPrefix = (short: readonly Side[], long: readonly Side[]): boolean =>
  short.length <= long.length && short.every((v, i) => v === long[i]);

/**
 * Compare a device's log against the server's.
 *
 * Deliberately compares CONTENT, not just length: two devices that each scored
 * one rally produce logs of equal length that disagree, and calling that "same"
 * would silently drop a point.
 */
export function classify(serverLog: readonly Side[], localLog: readonly Side[]): Relation {
  if (serverLog.length === localLog.length) {
    return isPrefix(serverLog, localLog) ? "same" : "diverged";
  }
  if (isPrefix(serverLog, localLog)) return "ahead";
  if (isPrefix(localLog, serverLog)) return "behind";
  return "diverged";
}

/* ---------- storage ---------- */

const DB_NAME = "rise-offline";
const DB_VERSION = 1;
const STORE = "queued-matches";

/** In-memory fallback. Used in tests and anywhere IndexedDB is unavailable
 *  (private windows on some browsers, storage disabled). The queue then lasts
 *  only as long as the tab — degraded, but never a crash on load. */
const memory = new Map<string, QueuedMatch>();

let dbPromise: Promise<IDBDatabase | null> | null = null;

function openDb(): Promise<IDBDatabase | null> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    if (typeof indexedDB === "undefined") return resolve(null);
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "matchId" });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      /* A blocked upgrade would otherwise hang the console forever. */
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T | null> {
  return openDb().then(
    (db) =>
      new Promise<T | null>((resolve) => {
        if (!db) return resolve(null);
        try {
          const req = fn(db.transaction(STORE, mode).objectStore(STORE));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => resolve(null);
        } catch {
          resolve(null);
        }
      }),
  );
}

export async function saveQueued(rec: QueuedMatch): Promise<void> {
  memory.set(rec.matchId, rec);
  await tx("readwrite", (s) => s.put(rec) as IDBRequest<IDBValidKey>);
}

export async function loadQueued(matchId: string): Promise<QueuedMatch | null> {
  const stored = await tx<QueuedMatch>("readonly", (s) => s.get(matchId) as IDBRequest<QueuedMatch>);
  return stored ?? memory.get(matchId) ?? null;
}

export async function clearQueued(matchId: string): Promise<void> {
  memory.delete(matchId);
  await tx("readwrite", (s) => s.delete(matchId) as unknown as IDBRequest<undefined>);
}

export async function allQueued(): Promise<QueuedMatch[]> {
  const stored = await tx<QueuedMatch[]>("readonly", (s) => s.getAll() as IDBRequest<QueuedMatch[]>);
  return stored ?? [...memory.values()];
}

/** Test seam — resets both layers. */
export function __resetQueue(): void {
  memory.clear();
  dbPromise = null;
}

/* ---------- replay ---------- */

/** What the server action reports back after a push attempt. */
export type PushResult =
  | { ok: true; rev: number }
  | { ok: false; reason: "stale"; serverLog: Side[]; rev: number }
  | { ok: false; reason: "error"; error: string };

export type FlushOutcome =
  | { status: "flushed"; matchId: string; rev: number }
  | { status: "nothing" }
  | { status: "conflict"; matchId: string; serverLog: Side[]; localLog: Side[]; rev: number }
  | { status: "failed"; matchId: string; error: string };

/**
 * Push one queued match, resolving a stale rev where it is safe to do so.
 *
 * A stale rev is not automatically a conflict. If the server's log is a prefix
 * of ours, nobody else added anything — we simply read an older rev — so it
 * retries at the new one. Only genuinely divergent logs stop and ask.
 *
 * `attempts` bounds the retry: two devices scoring at once could otherwise keep
 * invalidating each other's rev indefinitely.
 */
export async function flushMatch(
  rec: QueuedMatch,
  push: (matchId: string, log: Side[], baseRev: number) => Promise<PushResult>,
  attempts = 3,
): Promise<FlushOutcome> {
  let base = rec.baseRev;

  for (let i = 0; i < attempts; i++) {
    const res = await push(rec.matchId, rec.log, base);

    if (res.ok) {
      await clearQueued(rec.matchId);
      return { status: "flushed", matchId: rec.matchId, rev: res.rev };
    }
    if (res.reason === "error") {
      return { status: "failed", matchId: rec.matchId, error: res.error };
    }

    switch (classify(res.serverLog, rec.log)) {
      case "same":
        /* Our write already landed — a response was lost, not a conflict. */
        await clearQueued(rec.matchId);
        return { status: "flushed", matchId: rec.matchId, rev: res.rev };
      case "ahead":
        base = res.rev;   // stale read only; retry at the current rev
        continue;
      case "behind":
        /* The server has everything we have and more. Ours is redundant. */
        await clearQueued(rec.matchId);
        return { status: "flushed", matchId: rec.matchId, rev: res.rev };
      case "diverged":
        return {
          status: "conflict",
          matchId: rec.matchId,
          serverLog: res.serverLog,
          localLog: rec.log,
          rev: res.rev,
        };
    }
  }

  return { status: "failed", matchId: rec.matchId, error: "Could not settle after several attempts" };
}

/** Push everything queued. Returns one outcome per match. */
export async function flushAll(
  push: (matchId: string, log: Side[], baseRev: number) => Promise<PushResult>,
): Promise<FlushOutcome[]> {
  const queued = await allQueued();
  const out: FlushOutcome[] = [];
  for (const rec of queued) out.push(await flushMatch(rec, push));
  return out;
}
