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

/**
 * What the server answers a phone that sends it a rally log.
 *
 * Declared ONCE, here, and imported by both ends — `pushLog` in
 * app/t/[slug]/actions.ts and this queue. It used to be written out in both,
 * and a reply the phone does not know falls into its retry path: a phone told
 * "this match was typed in" would have re-sent its rallies every fifteen
 * seconds until one overwrote the typed result. Here because this file is
 * already client-safe; a type costs the browser nothing.
 */
/** Why a typed result moves no rating — said on the phone as everywhere else. */
export type TypedOutcome = "walkover" | "retired" | "unrated";

export type PushResult =
  /** Saved. `log` is the log as STORED when the server cut it at the rally
   *  that ended the game — the phone sent taps after the finish. Absent when
   *  what was sent is what was stored. */
  | { ok: true; rev: number; log?: Side[] }
  /** Somebody else wrote first. The server's log decides what happens next —
   *  see `classify`. */
  | { ok: false; reason: "stale"; serverLog: Side[]; rev: number }
  /** The match holds a TYPED result, which rallies never replace silently.
   *  The phone keeps its rallies and asks: keep the typed score, or replace it
   *  (a push with `replaceTyped` at this rev). `organiserOnly`: a replace was
   *  asked for by somebody who may score but is not the organiser — only the
   *  organiser may put rallies in place of a typed result (Faisal, 2026-10-23). */
  | { ok: false; reason: "typed"; a: number; b: number; rev: number; outcome?: TypedOutcome | null; organiserOnly?: true }
  /** The server will never take this log — the match was deleted, or it has no
   *  live court. The phone drops the rallies and says why; it must not retry. */
  | { ok: false; reason: "refused"; title: string; error: string }
  /** The organiser cleared or reset this match AFTER the rev this push was
   *  built on (step 8). Its rallies are from before the reset and are never
   *  put back. Deliberately carries NO rev: a phone that adopted the current
   *  rev from this reply could push its pre-reset log at it and land. The
   *  phone learns the match as it is now only from a fresh render. */
  | { ok: false; reason: "reset" }
  /** Anything else: not allowed, or a fault. Kept and retried. */
  | { ok: false; reason: "error"; error: string };

export type QueuedMatch = {
  matchId: string;
  /** The device's full log, including rallies the server has not seen. */
  log: Side[];
  /** The `rev` the device last successfully read or wrote. */
  baseRev: number;
  queuedAt: number;
  /** The match holds a TYPED result and these rallies wait for the referee to
   *  choose — keep the typed score, or replace it with them. Nothing sends a
   *  held record on its own: not the retry timer, not the `online` event. */
  held?: boolean;
  /** The two team ids the console showed when the batch's first rally was
   *  queued. Stored so a later check can refuse rallies recorded for teams the
   *  match no longer has. Absent on records queued before it existed. */
  sides?: [string, string];
  /** The server's log at `baseRev`: what this phone last KNEW it held. */
  baseLog?: Side[];
  /** Logs this phone has sent since `baseRev`. Any of them may have landed
   *  with the reply lost on the way back. */
  sent?: Side[][];
  /** The match's reset_rev on the page that wrote this record (step 8): the
   *  last clear or reset this phone knew of. A page that knows of an EARLIER
   *  one is older than this record — a cold load served from the cache with no
   *  signal — and must not judge, overwrite or delete it. Absent: 0. */
  resetRev?: number;
  /** Left where a record was dropped because the organiser reset the match:
   *  no rallies, based on the reset (log [] at reset_rev). A later cold load of
   *  an older cached page then starts from 0–0 instead of the old score. */
  tombstone?: boolean;
};

/** A record written under an EARLIER reset than the stored one is from a page
 *  that has not seen that reset: it may not replace or remove the stored one. */
const olderThan = (writer: { resetRev?: number }, stored: QueuedMatch | null) =>
  !!stored && (stored.resetRev ?? 0) > (writer.resetRev ?? 0);

/**
 * Does the server's log hold nothing this phone has not seen?
 *
 * True when it is the log the phone was based on, or one the phone sent
 * itself. Then the phone's newest log is simply its own next step, whatever
 * `classify` makes of the two — an undo is SHORTER than the server's log and
 * reads as "behind", and an undo followed by a tap reads as "diverged", yet
 * nobody else touched the match. Two things move the rev without adding a
 * rally: a scoring change (it moves every match's rev in the event) and a
 * write whose reply was lost. Read as "behind", the undo after either was
 * cleared as redundant, and the point the referee took off came back.
 *
 * A record from before these fields existed knows nothing, and is judged by
 * `classify` alone, as it always was.
 */
export function knownToPhone(rec: Pick<QueuedMatch, "baseLog" | "sent">, serverLog: readonly Side[]): boolean {
  if (rec.baseLog && sameLog(rec.baseLog, serverLog)) return true;
  return (rec.sent ?? []).some((s) => sameLog(s, serverLog));
}

/** Add a log to the ones sent, once. NONE is forgotten until a reply says
 *  what the server holds (`learn` empties the list): any push whose reply was
 *  lost may have landed, whichever it was. A cap of eight pushed out a log that
 *  HAD landed after eight more failed taps, and the referee was then asked
 *  about their own write — or their own undo — as if another device had made
 *  it. The list is bounded by the taps between two replies, a log by 500. */
export function withSent(sent: readonly Side[][] | undefined, log: readonly Side[]): Side[][] {
  return [...(sent ?? []).filter((s) => !sameLog(s, log)), [...log]];
}

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

export const sameLog = (x: readonly Side[], y: readonly Side[]) => x.length === y.length && x.every((v, i) => v === y[i]);

const isPrefix = (short: readonly Side[], long: readonly Side[]): boolean =>
  short.length <= long.length && short.every((v, i) => v === long[i]);

/**
 * Did ANOTHER device take rallies off that OUR log would put back? The server's
 * log is shorter than the log this phone knew it held, a prefix of it, not a
 * log this phone sent — and our log still continues the base past the server's
 * end.
 *
 * Our log reads as "ahead" of such a log, and pushing it put the removed rallies
 * back with nobody asked — a winning rally taken off by mistake won the game
 * again. ONE rule, asked by the send loop (`flushMatch`) and by the reload
 * decision (`resume` in useOfflineScoring) alike: the reload path once lacked
 * it, so a refreshed phone quietly undid the correction the send loop refused.
 * The last clause keeps it from asking when both devices took the same rally
 * off and this one then tapped a new one: pushing that restores nothing.
 * Rallies have no identity, so "continues the base" is judged by sequence.
 */
export function removedElsewhere(
  rec: Pick<QueuedMatch, "baseLog" | "sent">, serverLog: readonly Side[], local: readonly Side[],
): boolean {
  const base = rec.baseLog;
  if (!base || knownToPhone(rec, serverLog)) return false;
  if (!(serverLog.length < base.length && isPrefix(serverLog, base))) return false;
  return local.length > serverLog.length && local[serverLog.length] === base[serverLog.length];
}

/**
 * Does the server still hold a rally THIS phone took off? Asked when the
 * server's log is longer than ours and ours a prefix of it ("behind"), which
 * otherwise reads as "ours adds nothing" and is dropped. If a log this phone
 * built on or sent — its base, or a write it never heard back about, perhaps
 * cut at the finish by the server — went on past ours, and the server's next
 * rally is THAT log's next rally, the server has the rally the referee removed,
 * and dropping ours brought it back. If the server's next rally is a different
 * one, the server took it off too and another device scored after; ours adds
 * nothing, and goes without a question. The mirror of `removedElsewhere`,
 * asked in the same two places. Rallies have no identity, so "the same rally"
 * is judged by sequence.
 */
export function removedHere(
  rec: Pick<QueuedMatch, "baseLog" | "sent">, serverLog: readonly Side[], local: readonly Side[],
): boolean {
  if (serverLog.length <= local.length) return false;
  const next = serverLog[local.length];
  return [rec.baseLog, ...(rec.sent ?? [])].some(
    (l) => !!l && l.length > local.length && isPrefix(local, l) && l[local.length] === next,
  );
}

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

/** Save a record — unless the stored one was written under a LATER reset (see
 *  `olderThan`): a page from before the reset, finishing a send it started
 *  then, must not write its pre-reset rallies over what the phone has done
 *  since. Read and written in one transaction (`rewrite`). */
export async function saveQueued(rec: QueuedMatch): Promise<void> {
  await rewrite(rec.matchId, (stored) => (olderThan(rec, stored) ? null : { put: rec }));
}

export async function loadQueued(matchId: string): Promise<QueuedMatch | null> {
  const stored = await tx<QueuedMatch>("readonly", (s) => s.get(matchId) as IDBRequest<QueuedMatch>);
  return stored ?? memory.get(matchId) ?? null;
}

/** Remove a record — from a page under reset `resetRev`; a record written
 *  under a later reset is left alone (`olderThan`). */
export async function clearQueued(matchId: string, resetRev?: number): Promise<void> {
  if (resetRev === undefined) {
    memory.delete(matchId);
    await tx("readwrite", (s) => s.delete(matchId) as unknown as IDBRequest<undefined>);
    return;
  }
  await rewrite(matchId, (stored) => (olderThan({ resetRev }, stored) ? null : "delete"));
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

/**
 * Read a record and decide what to write in its place, as ONE transaction.
 *
 * A read followed by a separate write lets a tap's save fall between them:
 * IndexedDB runs overlapping transactions in the order they were CREATED, so
 * the read still returned the older record, the decision was made on it, and
 * the write that followed went in after the tap and deleted (or overwrote) it.
 * In one readwrite transaction a tap's save lands wholly before the read —
 * and `decide` sees it — or wholly after the write. The in-memory copy is
 * decided on synchronously, which is the same guarantee.
 *
 * Returns the record as it was found.
 */
async function rewrite(
  matchId: string,
  decide: (stored: QueuedMatch | null) => { put: QueuedMatch } | "delete" | null,
): Promise<QueuedMatch | null> {
  const mem = memory.get(matchId) ?? null;
  const m = decide(mem);
  if (m === "delete") memory.delete(matchId);
  else if (m) memory.set(matchId, m.put);
  const db = await openDb();
  if (!db) return mem;
  return new Promise((resolve) => {
    let found: QueuedMatch | null = null;
    try {
      const t = db.transaction(STORE, "readwrite");
      const s = t.objectStore(STORE);
      const req = s.get(matchId);
      req.onsuccess = () => {
        found = (req.result as QueuedMatch | undefined) ?? null;
        const d = decide(found);
        if (d === "delete") s.delete(matchId);
        else if (d) s.put(d.put);
      };
      t.oncomplete = () => resolve(found ?? mem);
      t.onerror = () => resolve(found ?? mem);
      t.onabort = () => resolve(found ?? mem);
    } catch {
      resolve(mem);
    }
  });
}

/* ---------- replay ---------- */

/**
 * Clear the stored record only if it still holds exactly this log.
 *
 * The stored record is always the phone's NEWEST log — every tap saves it — and
 * a push carries a snapshot taken when it left. A tap (or an undo) made while
 * that push was on the wire is in the record and not in the snapshot; clearing
 * unconditionally deleted it, so a referee's second rally vanished the moment
 * the first one landed, with nothing on screen to say so.
 */
export async function clearIfLanded(matchId: string, log: readonly Side[], resetRev?: number): Promise<void> {
  await rewrite(matchId, (stored) =>
    (stored && sameLog(stored.log, log) && !olderThan({ resetRev }, stored) ? "delete" : null));
}

/**
 * The organiser reset this match at `resetRev` (step 8): a stored record built
 * before it holds rallies that are never put back. It is replaced by a
 * TOMBSTONE — no rallies, based on the reset — and returned so the console can
 * say how many were not kept. A record built at or after the reset is kept.
 */
/**
 * How many rallies this phone tapped that a dropped record held: the ones past
 * where it and the server's known log part ways. Not `log − base`: an undo
 * followed by two new rallies is two rallies the referee tapped, and a net
 * count called it one.
 */
export function unkeptRallies(rec: Pick<QueuedMatch, "log" | "baseLog" | "tombstone"> | null): number {
  if (!rec || rec.tombstone) return 0;
  const base = rec.baseLog ?? [];
  let shared = 0;
  while (shared < rec.log.length && shared < base.length && rec.log[shared] === base[shared]) shared++;
  return rec.log.length - shared;
}

/** Drop a record from before the reset (`dropBefore`) and say how many rallies
 *  went — the one call both the console and the no-court page make. */
export async function dropForReset(matchId: string, resetRev: number): Promise<number> {
  return unkeptRallies(await dropBefore(matchId, resetRev));
}

export async function dropBefore(matchId: string, resetRev: number): Promise<QueuedMatch | null> {
  let dropped: QueuedMatch | null = null;
  await rewrite(matchId, (stored) => {
    if (!stored || stored.baseRev >= resetRev) return null;
    dropped = stored;
    return {
      put: {
        matchId, log: [], baseRev: resetRev, baseLog: [], sent: [], queuedAt: Date.now(),
        resetRev, tombstone: true,
      },
    };
  });
  return dropped;
}

export type FlushOutcome =
  /** Settled: the server holds `serverLog` at `rev`, and nothing of this
   *  attempt is left to send. `landed` says whether THIS attempt's write is
   *  what put it there — false when the server already held the log, or more.
   *  The difference matters twice: time measured for a write that did not
   *  land has to be put back, and a tap made meanwhile was based on a log the
   *  server may not hold. */
  | { status: "flushed"; matchId: string; rev: number; landed: boolean; serverLog: Side[] }
  | { status: "nothing" }
  | { status: "conflict"; matchId: string; serverLog: Side[]; localLog: Side[]; rev: number }
  | { status: "failed"; matchId: string; error: string }
  /** The match holds a typed result. `kept`: this phone had rallies queued,
   *  and they are held for the referee. False for a push with nothing queued —
   *  a pause sent on its own — which has no rallies to hold. */
  | { status: "typed"; matchId: string; a: number; b: number; rev: number; outcome: TypedOutcome | null; kept: boolean }
  /** The server will never take these rallies; the record is gone. */
  | { status: "refused"; matchId: string; title: string; error: string }
  /** The organiser reset the match after this phone's base (step 8). The
   *  stored record is left as it is — the page that renders the reset drops it
   *  and says what was in it — and NOTHING more is sent, at any rev. */
  | { status: "reset"; matchId: string };

/**
 * What a reply MEANS for the record, for every reply that ends the attempt —
 * or null for "stale", which the caller settles by comparing logs.
 *
 * ONE mapper, used by `flushMatch` and by the console's conflict dialog
 * alike. The dialog used to read the reply itself, knew only "ok", and would
 * have sat on screen for ever on a reply it had never heard of.
 */
export async function settleReply(res: PushResult, rec: QueuedMatch): Promise<FlushOutcome | null> {
  if (res.ok) {
    await clearIfLanded(rec.matchId, rec.log, rec.resetRev);
    /* What the server STORED, which is what the phone's next step builds on.
       Recorded as the log sent, a log the server had cut at the finish left
       the phone believing in rallies the server threw away, and the next
       undos were built on them and changed nothing. */
    return { status: "flushed", matchId: rec.matchId, rev: res.rev, landed: true, serverLog: [...(res.log ?? rec.log)] };
  }
  switch (res.reason) {
    case "typed": {
      /* Hold what the phone has NOW, not what this attempt carried: a rally
         tapped while it was on the wire is in the stored record, and filing
         the older log over it lost that rally on the next reload.
         And only what was QUEUED. A pause sent with nothing queued carries
         the server's own log; filed as held, it came back after a reload as
         "rallies on this phone that were not saved" — rallies the organiser
         had deliberately replaced — with a button to put them back. */
      /* Never a tombstone (nobody's rallies), and never a record written
         under a later reset than this attempt's. `kept` is whether it WAS
         held — it said "a record existed", so the card asked about a tombstone
         even though nothing had been filed. */
      const holds = (stored: QueuedMatch | null): stored is QueuedMatch =>
        !!stored && !stored.tombstone && !olderThan(rec, stored);
      const found = await rewrite(rec.matchId, (stored) => (holds(stored) ? { put: { ...stored, held: true } } : null));
      return {
        status: "typed", matchId: rec.matchId, a: res.a, b: res.b, rev: res.rev,
        outcome: res.outcome ?? null, kept: holds(found),
      };
    }
    case "refused":
      await clearQueued(rec.matchId, rec.resetRev);
      return { status: "refused", matchId: rec.matchId, title: res.title, error: res.error };
    case "reset":
      return { status: "reset", matchId: rec.matchId };
    case "error":
      return { status: "failed", matchId: rec.matchId, error: res.error };
    case "stale":
      return null;
  }
}

/**
 * Push one queued match, resolving a stale rev where it is safe to do so.
 *
 * A stale rev is not automatically a conflict. If the server's log is a prefix
 * of ours, nobody else added anything — we simply read an older rev — so it
 * retries at the new one. Only genuinely divergent logs stop and ask.
 *
 * `clockOnly`: the log on the wire is not the phone's work but the log the
 * server was last known to hold, sent only to carry a pause or the clock. On
 * a stale reply it is never judged — there are no rallies of this phone's in
 * it — and the server's own log goes back instead, at the server's rev. Judged
 * like rallies, a pause written after another device's correction put the
 * removed rally back, or asked the referee about rallies they never scored.
 *
 * `attempts` bounds the retry: two devices scoring at once could otherwise keep
 * invalidating each other's rev indefinitely.
 */
export async function flushMatch(
  rec: QueuedMatch,
  push: (matchId: string, log: Side[], baseRev: number) => Promise<PushResult>,
  attempts = 3,
  opts: { clockOnly?: boolean } = {},
): Promise<FlushOutcome> {
  let base = rec.baseRev;
  let sending = rec;
  let known: Pick<QueuedMatch, "baseLog" | "sent"> = rec;

  for (let i = 0; i < attempts; i++) {
    /* A Server Action REJECTS when the request cannot be made at all — no
       route to the server, DNS gone, request aborted. That is the ordinary
       offline case, not an exception, and it has to come back as "failed" like
       any other: letting it throw past the caller means the console never
       learns the rallies are unsaved and shows them as if they were. The
       rallies themselves are safe either way, because they were written to
       IndexedDB before this was ever called. */
    let res: PushResult;
    try {
      res = await push(rec.matchId, sending.log, base);
    } catch (e) {
      return {
        status: "failed",
        matchId: rec.matchId,
        error: e instanceof Error ? e.message : "No connection to the server",
      };
    }

    const settled = await settleReply(res, sending);
    if (settled) return settled;
    if (res.ok || res.reason !== "stale") break;   // settled above; narrows the type

    if (opts.clockOnly) {
      sending = { ...sending, log: res.serverLog };
      base = res.rev;
      continue;
    }

    const relation = classify(res.serverLog, sending.log);
    if (relation === "same") {
      /* The log is there already — an earlier write landed and its reply was
         lost, or another device wrote the same. This attempt wrote nothing. */
      await clearIfLanded(rec.matchId, sending.log, rec.resetRev);
      return { status: "flushed", matchId: rec.matchId, rev: res.rev, landed: false, serverLog: res.serverLog };
    }
    /* Nobody else has written a rally: the rev moved under a log this phone
       had already seen or sent. Ours is the next step — retry at the rev the
       server now has, whatever shape the two logs make. */
    if (knownToPhone(known, res.serverLog)) {
      base = res.rev;
      known = { baseLog: res.serverLog, sent: [] };
      continue;
    }
    /* Another device took rallies off: put to the referee, never pushed over. */
    if (removedElsewhere(known, res.serverLog, sending.log)) {
      return { status: "conflict", matchId: rec.matchId, serverLog: res.serverLog, localLog: sending.log, rev: res.rev };
    }
    switch (relation) {
      case "ahead":
        base = res.rev;   // stale read only; retry at the current rev
        continue;
      case "behind":
        /* The server still has a rally this phone took off: ask. */
        if (removedHere(known, res.serverLog, sending.log)) {
          return { status: "conflict", matchId: rec.matchId, serverLog: res.serverLog, localLog: sending.log, rev: res.rev };
        }
        /* Another device has everything we have and more. Ours is redundant. */
        await clearIfLanded(rec.matchId, sending.log, rec.resetRev);
        return { status: "flushed", matchId: rec.matchId, rev: res.rev, landed: false, serverLog: res.serverLog };
      case "diverged":
        return {
          status: "conflict",
          matchId: rec.matchId,
          serverLog: res.serverLog,
          localLog: sending.log,
          rev: res.rev,
        };
    }
  }

  return { status: "failed", matchId: rec.matchId, error: "Could not settle after several attempts" };
}

/** Push everything queued, except what is held for the referee to decide.
 *  Returns one outcome per match it sent. */
export async function flushAll(
  push: (matchId: string, log: Side[], baseRev: number) => Promise<PushResult>,
): Promise<FlushOutcome[]> {
  const queued = await allQueued();
  const out: FlushOutcome[] = [];
  for (const rec of queued) {
    if (rec.held) continue;
    out.push(await flushMatch(rec, push));
  }
  return out;
}
