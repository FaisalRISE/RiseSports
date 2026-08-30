"use client";

/* Offline scoring for the referee console.
 *
 * Online, this is a thin pass-through: the Server Action runs, the page
 * revalidates, and the server's derived view is what renders. Nothing changes.
 *
 * Offline, the browser takes over: rallies append to a local log, `replayLite`
 * derives the score, and the queue holds the log until the network returns.
 *
 * ── The rule this follows ─────────────────────────────────────────────────
 * Never show a queued rally as if it were saved. A referee who cannot tell
 * "recorded" from "sent" will not know what to re-enter when a phone dies, so
 * the console says how many rallies are waiting and stops claiming anything
 * else. On a genuine two-device conflict it asks rather than guessing.
 */

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { replayLite, supportsLite, type LiteRules, type LiteState, type Side } from "@/lib/scoring/replayLite";
import {
  classify, flushMatch, loadQueued, saveQueued, clearQueued,
  type PushResult, type QueuedMatch,
} from "@/lib/offline/queue";

/* Subscribing outside the component keeps the reference stable, so
   useSyncExternalStore does not resubscribe on every render. */
function subscribeOnline(cb: () => void) {
  window.addEventListener("online", cb);
  window.addEventListener("offline", cb);
  return () => {
    window.removeEventListener("online", cb);
    window.removeEventListener("offline", cb);
  };
}

export type Conflict = { serverLog: Side[]; localLog: Side[]; rev: number };

export type OfflineScoring = {
  online: boolean;
  /** Rallies recorded here but not yet accepted by the server. */
  queued: number;
  /** Local overlay when offline, otherwise null (use the server's view). */
  local: LiteState | null;
  /** False when this format cannot be scored in the browser (OSL). */
  canScoreOffline: boolean;
  conflict: Conflict | null;
  syncing: boolean;
  /** A send has actually failed and the rallies are still waiting. This, not
   *  `queued > 0`, is what the console warns on: every tap queues, so a queue
   *  is normal and only a FAILED queue is news. */
  stalled: boolean;
  scoreOffline: (side: Side) => void;
  undoOffline: () => void;
  /** Resolve a conflict by discarding one side's rallies. */
  resolveConflict: (keep: "mine" | "theirs") => Promise<void>;
};

export type UseOfflineArgs = {
  matchId: string;
  rules: LiteRules | null;
  format: string | null;
  /** The server's authoritative log and rev, from the last successful render. */
  serverLog: Side[];
  serverRev: number;
  server: Side | null;
  posA: 0 | 1 | null;
  posB: 0 | 1 | null;
  push: (matchId: string, log: Side[], baseRev: number) => Promise<PushResult>;
  onSynced: () => void;
};

export function useOfflineScoring(args: UseOfflineArgs): OfflineScoring {
  const { matchId, rules, format, serverLog, serverRev, push, onSynced } = args;

  const canScoreOffline = supportsLite(rules, format);

  /* Connectivity is an external store, not component state: `navigator.onLine`
     cannot be read during render (it would differ from the server's HTML and
     break hydration), and `useSyncExternalStore`'s third argument is exactly
     the server snapshot React needs. Assume online there — the server always
     has a connection, and a referee page rendered on the server got one too. */
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [localLog, setLocalLog] = useState<Side[] | null>(null);
  const [conflict, setConflict] = useState<Conflict | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [stalled, setStalled] = useState(false);

  /* The rev the queue is based on. Held in a ref because the flush runs from an
     event handler that would otherwise close over a stale value. */
  const baseRev = useRef(serverRev);
  /* True while a push is on the wire — see the guard in `flush`. */
  const inFlight = useRef(false);
  useEffect(() => {
    if (localLog === null) baseRev.current = serverRev;
  }, [serverRev, localLog]);

  /* Takes the log explicitly rather than reading state: it is called straight
     after a tap, when `localLog` has not re-rendered yet. */
  const flush = useCallback(async (logArg?: Side[]) => {
    const log = logArg ?? localLog;
    if (!log || log.length === 0) return;
    /* A ref, not the `syncing` state: the retry timer and a tap can both call
       this within the same tick, before any re-render has happened, and two
       concurrent pushes of the same log would make the second one look like a
       conflict against the first. */
    if (inFlight.current) return;
    inFlight.current = true;
    setSyncing(true);
    const rec: QueuedMatch = { matchId, log, baseRev: baseRev.current, queuedAt: Date.now() };
    let out;
    try {
      out = await flushMatch(rec, push);
    } finally {
      /* Released in `finally` so a thrown push cannot wedge the queue shut for
         the rest of the match. */
      inFlight.current = false;
      setSyncing(false);
    }

    if (out.status === "flushed") {
      setLocalLog(null);
      setConflict(null);
      setStalled(false);
      baseRev.current = out.rev;
      onSynced();
      return;
    }
    if (out.status === "conflict") {
      setConflict({ serverLog: out.serverLog, localLog: out.localLog, rev: out.rev });
    }
    /* "failed" keeps the queue and raises the banner; the retry timer and the
       online event both try again. */
    if (out.status === "failed") setStalled(true);
  }, [localLog, matchId, push, onSynced]);

  /* Restore anything left queued by a previous session — a phone that died
     mid-match must not lose the rallies it already took. */
  useEffect(() => {
    let cancelled = false;
    void loadQueued(matchId).then((rec) => {
      if (cancelled || !rec) return;
      /* Only adopt it if it is genuinely ahead of what the server now has;
         otherwise the match moved on elsewhere and the queue is stale. */
      if (classify(serverLog, rec.log) === "ahead") {
        baseRev.current = rec.baseRev;
        setLocalLog(rec.log);
        /* A restored queue that is ahead of the server IS unsaved work, by
           definition — say so straight away. Waiting for the retry timer to
           discover it would leave a reloaded console showing rallies as saved
           for up to fifteen seconds, which is the one thing this must never
           do. A successful flush clears it. */
        setStalled(true);
        /* Try immediately rather than waiting up to fifteen seconds for the
           retry timer. A referee who reopens the console with the signal back
           should see it settle at once, not sit staring at a warning that is
           already out of date. */
        void flush(rec.log);
      } else {
        void clearQueued(matchId);
      }
    });
    return () => { cancelled = true; };
    // deliberately once per match: re-running on every server render would
    // fight the user's own taps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);


  /* Retry the moment the connection comes back. The send happens inside the
     event handler, not in the effect body — an effect that writes state on
     every render of a queued match fights React's scheduling.

     The timer is not belt-and-braces, it is the main path for the failure mode
     that actually happens in a sports hall: WiFi associated, no route to the
     server. `navigator.onLine` stays true throughout, so no `online` event ever
     fires, and without this the queue would sit until the referee happened to
     tap again — stranding the last rally of a match indefinitely. */
  useEffect(() => {
    const retry = () => { void flush(); };
    window.addEventListener("online", retry);
    const timer = window.setInterval(retry, 15_000);
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(timer);
    };
  }, [flush]);

  /* Queue first, then try to send. Flushing is triggered by the tap and by the
     `online` event rather than by an effect watching the queue — an effect that
     calls setState on every queue change fights React's own scheduling, and
     lint rightly objects. The failure mode is also better this way: a rally is
     durably queued BEFORE any network attempt, so a request that dies mid-flight
     cannot lose it. */
  const append = useCallback(
    (next: Side[]) => {
      setLocalLog(next);
      void saveQueued({ matchId, log: next, baseRev: baseRev.current, queuedAt: Date.now() });
      /* Try immediately when we believe we are online. This covers the common
         hall case — one bar of signal, where navigator.onLine says true and the
         request still fails. */
      if (navigator.onLine && !conflict) void flush(next);
    },
    [matchId, conflict, flush],
  );

  const scoreOffline = useCallback(
    (side: Side) => {
      if (!canScoreOffline) return;
      append([...(localLog ?? serverLog), side]);
    },
    [append, canScoreOffline, localLog, serverLog],
  );

  const undoOffline = useCallback(() => {
    const base = localLog ?? serverLog;
    if (base.length === 0) return;
    append(base.slice(0, -1));
  }, [append, localLog, serverLog]);

  const resolveConflict = useCallback(
    async (keep: "mine" | "theirs") => {
      if (!conflict) return;
      if (keep === "theirs") {
        await clearQueued(matchId);
        setLocalLog(null);
        setConflict(null);
        baseRev.current = conflict.rev;
        onSynced();
        return;
      }
      /* Keeping ours overwrites the other device's rallies. Push at the
         server's current rev so the guard accepts it. */
      setSyncing(true);
      const res = await push(matchId, conflict.localLog, conflict.rev);
      setSyncing(false);
      if (res.ok) {
        await clearQueued(matchId);
        setLocalLog(null);
        setConflict(null);
        baseRev.current = res.rev;
        onSynced();
      }
    },
    [conflict, matchId, push, onSynced],
  );

  const local =
    localLog && canScoreOffline
      ? replayLite({ log: localLog, server: args.server, posA: args.posA, posB: args.posB }, rules)
      : null;

  return {
    online,
    queued: localLog ? Math.max(0, localLog.length - serverLog.length) : 0,
    local,
    canScoreOffline,
    conflict,
    syncing,
    stalled,
    scoreOffline,
    undoOffline,
    resolveConflict,
  };
}
