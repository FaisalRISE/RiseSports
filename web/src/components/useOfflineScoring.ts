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
import { rewindIndex } from "@/lib/scoring/rewind";
import type { MatchClock } from "./useMatchClock";
import type { Tick } from "@/lib/scoring/clock";
import {
  classify, flushMatch, loadQueued, saveQueued, clearQueued, clearIfLanded, settleReply, knownToPhone, removedElsewhere,
  removedHere, sameLog, withSent,
  type FlushOutcome, type PushResult, type QueuedMatch, type TypedOutcome,
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

/* A reply that never came is not a refusal: the request may have landed. */
const NO_SIGNAL = "The signal dropped before the server answered, so this may or may not have been saved. Try again when the signal is back.";

/** The match holds a typed result, and this phone holds rallies it never sent. */
export type Held = { a: number; b: number; rev: number; outcome: TypedOutcome | null };

/** The server will never take this phone's rallies; they are gone, and why. */
export type Refused = { title: string; error: string; rallies: number };

type Push = (
  matchId: string, log: Side[], baseRev: number, tick?: Tick, opts?: { replaceTyped?: boolean },
) => Promise<PushResult>;

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
  /** Take a point off one side — see lib/scoring/rewind for what that means. */
  minusOffline: (side: Side) => void;
  /** Write the clock with the score unchanged, for a pause or a resume. */
  syncClock: () => void;
  /** Resolve a conflict by discarding one side's rallies. Resolves to a
   *  sentence for the referee when that did not simply happen. */
  resolveConflict: (keep: "mine" | "theirs") => Promise<string | null>;
  /** Set when the match was typed in while this phone held rallies. Nothing
   *  is sent until the referee picks `keepTyped` or `replaceTyped`. */
  held: Held | null;
  keepTyped: () => Promise<string | null>;
  /** Replace the typed result with this phone's rallies. Resolves to an error
   *  sentence when that did not happen, or null when it did. */
  replaceTyped: () => Promise<string | null>;
  /** The server refused these rallies for good (the match was deleted). */
  refused: Refused | null;
  /** False until the queue a previous session left has been read; the court
   *  takes no tap before then. */
  ready: boolean;
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
  /** The match's typed result, from the last render — null when it has none. */
  typed: { a: number; b: number; outcome: TypedOutcome | null } | null;
  /** The two team ids this console shows, stored with every queued batch. */
  sides: [string, string];
  push: Push;
  onSynced: () => void;
  /** Where the milliseconds are measured and split. See useMatchClock. */
  clock: MatchClock;
};


export function useOfflineScoring(args: UseOfflineArgs): OfflineScoring {
  const { matchId, rules, format, serverLog, serverRev, push, onSynced, sides } = args;
  /* Pulled out of the clock object rather than used through it. The object is
     rebuilt every render — it carries a clock that changes every second — so
     depending on it would rebuild `flush` a second at a time. These are
     `useCallback`s with stable dependencies, which is what the retry timer
     below needs. */
  const { claim, restore, hasPending } = args.clock;

  const canScoreOffline = supportsLite(rules, format);

  /* Connectivity is an external store, not component state: `navigator.onLine`
     cannot be read during render (it would differ from the server's HTML and
     break hydration), and `useSyncExternalStore`'s third argument is exactly
     the server snapshot React needs. Assume online there — the server always
     has a connection, and a referee page rendered on the server got one too. */
  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const [localLog, setLocalLog] = useState<Side[] | null>(null);
  const [conflict, setConflictState] = useState<Conflict | null>(null);
  /* A ref as well as state, like "held": while the referee is being asked,
     NOTHING is sent — the retry timer and the online event reach `flush`
     through a ref and cannot wait for a render. Without it a conflict found on
     RELOAD (where the base had already been learnt at the server's rev) was
     written over by the next timer tick, fifteen seconds later, with the
     referee's question still on screen. */
  const conflictRef = useRef<Conflict | null>(null);
  const setConflict = useCallback((c: Conflict | null) => { conflictRef.current = c; setConflictState(c); }, []);
  const [syncing, setSyncing] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [held, setHeldState] = useState<Held | null>(null);
  const [refused, setRefused] = useState<Refused | null>(null);
  /* A ref as well as state: the retry timer reaches `flush` through a ref set
     once, so it must be able to see "held" without waiting for a render. */
  const heldRef = useRef<Held | null>(null);
  const setHeld = useCallback((h: Held | null) => { heldRef.current = h; setHeldState(h); }, []);
  /* Refused for good: nothing is sent after it, not even a pause. */
  const refusedRef = useRef<Refused | null>(null);
  /* The NEWEST log on this phone, readable the instant a tap makes it, or null
     when nothing is queued. A push carries a snapshot; when it lands, anything
     newer is sent straight after. Without this a rally tapped while the
     previous push was on the wire was saved, then deleted when that push
     landed — gone, with nothing on screen to say so. Every change of the local
     log goes through `setLog`. */
  const latestRef = useRef<Side[] | null>(null);
  const setLog = useCallback((l: Side[] | null) => { latestRef.current = l; setLocalLog(l); }, []);

  /* What this phone KNOWS the server holds: its log at `baseRev`, learnt from
     a render or from a write that landed, and the logs sent since then that
     may have landed unheard. A server holding any of them holds nothing this
     phone has not seen — see `knownToPhone`. Refs, because the send loop and
     the taps read them between renders. */
  const baseRev = useRef(serverRev);
  const baseLog = useRef<Side[]>(serverLog);
  const sent = useRef<Side[][]>([]);
  const learn = useCallback((rev: number, log: Side[]) => {
    baseRev.current = rev;
    baseLog.current = log;
    sent.current = [];
  }, []);
  /* True while a push is on the wire — see the guard in `flush`. */
  const inFlight = useRef(false);
  useEffect(() => {
    /* A render at least as new as anything this phone knows, with nothing
       queued: that is the base now. Never an older one — a write that has just
       landed is newer than the render still on its way, and falling back to
       the render's rev and log made the next tap's base a log the server no
       longer held. The SAME rev is taken too: one rev is one row, so the
       render's log is what the server holds at it — the correction for a base
       learnt from a reply that said less than the row does. */
    if (latestRef.current === null && serverRev >= baseRev.current) learn(serverRev, serverLog);
  }, [serverRev, serverLog, localLog, learn]);
  /* A push whose reply never came — the request may or may not have landed.
     Set only by the two choices a referee makes on a card ("Use this phone's
     score", "Keep this phone's score"), so that the OTHER choice, made next,
     first finds out what the server holds instead of assuming. */
  const uncertainRef = useRef<Side[] | null>(null);
  /* The queue left by an earlier session has been read. Until it has, a tap
     would build on a log about to be replaced by the stored one — and one of
     the two was lost. */
  const loadedRef = useRef(false);
  const [ready, setReady] = useState(false);

  /* Every record carries what the phone knew when it was written, so a reload
     can still tell this phone's own next step from another device's work. */
  const recordOf = useCallback((log: Side[]): QueuedMatch => ({
    matchId, log, baseRev: baseRev.current, baseLog: baseLog.current, sent: sent.current, queuedAt: Date.now(), sides,
  }), [matchId, sides]);

  /* The two replies that are neither "saved" nor "try again": the match was
     typed in (hold the rallies, ask the referee), or the server will never
     take them (drop them, say why). Shared by every path that sends. */
  const settleSideways = (out: FlushOutcome, log: Side[]) => {
    if (out.status === "typed") {
      setStalled(false);
      /* Nothing was queued — a pause sent on its own. There are no rallies
         to hold; the page shows the typed result once it has re-rendered. */
      if (out.kept) setHeld({ a: out.a, b: out.b, rev: out.rev, outcome: out.outcome });
      else onSynced();
    }
    if (out.status === "refused" && !refusedRef.current) {
      const r = { title: out.title, error: out.error, rallies: Math.max(0, log.length - serverLog.length) };
      refusedRef.current = r;
      setRefused(r);
      setLog(null);
      setStalled(false);
      setConflict(null);
    }
  };

  /* Sends what is QUEUED — the newest log on the phone — and loops until what
     landed is the newest. With nothing queued it sends nothing, which is what
     keeps the fifteen-second retry timer honest: it would otherwise rewrite
     the match every fifteen seconds for the length of the game, purely to
     carry a clock that is meant to ride along with the rallies. A pause asks
     for `clock`, which sends the log the server is known to hold. */
  const flush = useCallback(async (opts?: { clock?: boolean }) => {
    /* Held for the referee (the match was typed in, and only their choice
       sends these rallies), or refused for good. The fifteen-second retry
       would otherwise send them straight back into the same answer. */
    if (heldRef.current || refusedRef.current || conflictRef.current) return;
    /* A ref, not the `syncing` state: the retry timer and a tap can both call
       this within the same tick, before any re-render has happened, and two
       concurrent pushes of the same log would make the second one look like a
       conflict against the first. The push already on the wire sends the
       newest log once it lands (below), so nothing is dropped here. */
    if (inFlight.current) return;
    const queued = latestRef.current;
    if (!queued && !opts?.clock) return;
    /* The phone's log this flush is about: the queue, or — for a pause with
       nothing queued — the log the server is known to hold. */
    let log: Side[] = queued ?? baseLog.current;
    /* Nothing of this phone's to send: the log is the one the server is known
       to hold, and nothing sent since is unaccounted for — an undo back to
       where the server stands. Settled here, or the banner that a failed send
       raised would stay up over a queue with nothing in it. An undo back to
       0–0 is NOT this when the server holds a rally, and is sent like any
       other log, from the tap, the timer or a reload alike. */
    if (queued && !opts?.clock && sameLog(queued, baseLog.current) && sent.current.length === 0) {
      void clearIfLanded(matchId, queued);
      setLog(null);
      setStalled(false);
      return;
    }
    inFlight.current = true;
    setSyncing(true);
    let out: FlushOutcome;
    /* What goes on the wire: the phone's log, or a log that only carries the
       clock — the server's own, for a pause with nothing queued, or once, for
       a pause tapped while a push was out. `clockOnly` is never judged as
       rallies (see flushMatch). */
    let send = log;
    let clockOnly = !queued;
    let pauseRound = false;
    try {
      for (;;) {
        const rec = recordOf(send);
        /* Claim the measured time and any pause change for THIS attempt. A
           stale rev writes nothing at all server-side, so a retry cannot
           double-count it. */
        const claimed = claim();
        const asClock = clockOnly;
        try {
          out = await flushMatch(rec, (id, l, rev) => {
            if (!asClock) sent.current = withSent(sent.current, l);
            return push(id, l, rev, claimed);
          }, 3, { clockOnly: asClock });
        } catch (e) {
          restore(claimed);
          throw e;
        }
        /* Anything short of THIS write landing puts the measurement back —
           including a log the server already held, which wrote nothing. */
        if (out.status !== "flushed" || !out.landed) restore(claimed);
        if (out.status !== "flushed" && out.status !== "conflict") break;

        const server = out.serverLog;
        const newest = latestRef.current;
        /* The server holds what this phone sent — written now, written by an
           earlier attempt whose reply was lost (`same`), or cut at the finish.
           A clock-only push is the phone's only while the server's log did not
           move under it. */
        const ours = out.status === "flushed" &&
          (asClock ? sameLog(server, send) : out.landed || sameLog(server, send));
        const settled = out.status === "flushed" && (newest === null || sameLog(newest, log));
        if (ours || settled) learn(out.rev, server);
        if (settled) {
          /* One more round only for a pause tapped while this push was on the
             wire: it rides on no rally, so nothing else would carry it before
             the next point. */
          if (hasPending() && !pauseRound) {
            pauseRound = true;
            send = server;
            clockOnly = true;
            continue;
          }
          break;
        }
        if (newest === null) break;
        if (ours) {
          /* A newer tap — or an undo — built on exactly what the server holds:
             it is this phone's next step, sent at the rev just found. It used
             to go only after a write that LANDED, so an undo made while a
             retry of an unanswered write was out read as "behind" and the
             rally came back. */
          void saveQueued(recordOf(newest));
          log = send = newest;
          clockOnly = false;
          continue;
        }
        /* The server holds something this phone has not seen. The newest log
           is judged by the same rules as any push — sent from the base it was
           built on, so the reply is stale and flushMatch decides. Judged here
           by `classify` alone, an undo by another device read as "ahead" and
           was written over. */
        if (out.status === "conflict" && sameLog(newest, log)) break;
        log = send = newest;
        clockOnly = false;
      }
    } finally {
      /* Released in `finally` so a thrown push cannot wedge the queue shut for
         the rest of the match. */
      inFlight.current = false;
      setSyncing(false);
    }

    if (out.status === "flushed") {
      setLog(null);
      setConflict(null);
      setStalled(false);
      onSynced();
      return;
    }
    if (out.status === "conflict") {
      setConflict({ serverLog: out.serverLog, localLog: out.localLog, rev: out.rev });
    }
    settleSideways(out, log);
    /* "failed" keeps the queue and raises the banner; the retry timer and the
       online event both try again. */
    if (out.status === "failed") setStalled(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settleSideways only calls stable setters and onSynced
  }, [serverLog, matchId, push, onSynced, claim, restore, hasPending, setLog, learn, recordOf]);

  /* Rallies this phone holds, against a server state it has just learnt:
     send them, ask, or let them go. ONE decision, for a reload, for a hold
     that has been released, and for a reply saying the typed result has gone.
     Before it, a reload adopted only a log strictly AHEAD of the server's —
     so an undo made with no signal (shorter, so "behind") was thrown away,
     and so was a genuine disagreement ("diverged"), silently, with the
     referee's rallies in it. */
  const resume = useCallback(
    (log: Side[], server: { log: Side[]; rev: number }, known: Pick<QueuedMatch, "baseRev" | "baseLog" | "sent">) => {
      const relation = classify(server.log, log);
      if (relation === "same") {
        void clearIfLanded(matchId, log);
        learn(server.rev, server.log);
        setLog(null);
        setStalled(false);
        return;
      }
      const mine = knownToPhone(known, server.log) || known.baseRev === server.rev;
      /* Another device took rallies off since this phone's base: our log is
         "ahead" of the server's, and sending it would put them back. The send
         loop already asked this; a reload did not, so a refreshed phone undid
         the correction silently. */
      if (!mine && removedElsewhere(known, server.log, log)) {
        setLog(log);
        setConflict({ serverLog: server.log, localLog: log, rev: server.rev });
        return;
      }
      if (mine || relation === "ahead") {
        learn(server.rev, server.log);
        setLog(log);
        /* Unsaved work, by definition — say so straight away rather than
           showing rallies as saved until the retry timer finds out. A
           successful flush clears it. */
        setStalled(true);
        void flush();
        return;
      }
      if (relation === "diverged") {
        setLog(log);
        setConflict({ serverLog: server.log, localLog: log, rev: server.rev });
        return;
      }
      /* The server still has a rally this phone took off: ask. */
      if (removedHere(known, server.log, log)) {
        setLog(log);
        setConflict({ serverLog: server.log, localLog: log, rev: server.rev });
        return;
      }
      /* Another device has everything this phone had, and more. */
      void clearIfLanded(matchId, log);
      setLog(null);
      setStalled(false);
    },
    [matchId, learn, setLog, flush, setConflict],
  );

  /* Restore anything left queued by a previous session — a phone that died
     mid-match must not lose the rallies it already took. */
  useEffect(() => {
    let cancelled = false;
    void loadQueued(matchId).then((rec) => {
      if (cancelled) return;
      loadedRef.current = true;
      setReady(true);
      if (!rec) return;
      /* Rallies on a match that is typed in: show the choice — keep the typed
         result, or use this phone's — and send nothing. Whether or not a push
         had come back "typed" before the reload: the organiser may have typed
         the result over rallies this phone queued with no signal, and judged as
         rallies the typed match's empty log read as another device taking every
         rally off, a two-device question about a typed result. Held, but the
         typed result has gone since (cleared on the manage screen): an ordinary
         queue again. */
      if (args.typed && (rec.held || rec.log.length > 0)) {
        baseRev.current = rec.baseRev;
        baseLog.current = rec.baseLog ?? [];
        sent.current = rec.sent ?? [];
        if (!rec.held) void saveQueued({ ...rec, held: true });
        setLog(rec.log);
        setHeld({ ...args.typed, rev: serverRev });
        return;
      }
      if (rec.held) void saveQueued({ ...rec, held: false });
      resume(rec.log, { log: serverLog, rev: serverRev }, rec);
    });
    return () => { cancelled = true; };
    // deliberately once per match: re-running on every server render would
    // fight the user's own taps
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [matchId]);

  /* A hold is a snapshot of the typed result, and the match moves on without
     it: typed again on the manage screen, its rev moved by a scoring change,
     or the typed result replaced by another phone's rallies. Each newer render
     brings the hold up to date — or, with the typed result gone, releases the
     rallies to the ordinary queue. It used to stay as it was, so the card
     showed a result the match no longer had, and every "Use this phone's
     score" went out at the old rev and failed for ever. */
  const typedKey = args.typed ? `${args.typed.a}:${args.typed.b}:${args.typed.outcome ?? ""}` : "";
  useEffect(() => {
    const h = heldRef.current;
    if (!h || serverRev <= h.rev) return;
    let cancelled = false;
    const typed = args.typed;
    void loadQueued(matchId).then((rec) => {
      if (cancelled || heldRef.current !== h) return;
      if (typed) {
        setHeld({ ...typed, rev: serverRev });
        return;
      }
      setHeld(null);
      const log = rec?.log ?? latestRef.current;
      if (!log) {
        setLog(null);
        return;
      }
      if (rec) void saveQueued({ ...rec, held: false });
      resume(log, { log: serverLog, rev: serverRev }, rec ?? { baseRev: baseRev.current });
    });
    return () => { cancelled = true; };
    // typedKey stands for args.typed, which is a new object on every render
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverRev, typedKey, held, matchId, resume, setHeld, setLog]);

  /* Retry the moment the connection comes back. The send happens inside the
     event handler, not in the effect body — an effect that writes state on
     every render of a queued match fights React's scheduling.

     The timer is not belt-and-braces, it is the main path for the failure mode
     that actually happens in a sports hall: WiFi associated, no route to the
     server. `navigator.onLine` stays true throughout, so no `online` event ever
     fires, and without this the queue would sit until the referee happened to
     tap again — stranding the last rally of a match indefinitely. */
  /* Set up ONCE, and reached through a ref, because a timer whose effect
     depends on `flush` is a timer that never fires: `flush` is rebuilt whenever
     anything it closes over changes, and the console now re-renders every
     second to move the match clock, so the interval was being cleared and
     restarted fourteen seconds before it was due. The queue then sat unsent
     until the referee happened to tap again — which the offline suite caught as
     "the queue flushes with no user action" failing while the rallies were
     provably on the server. Anything periodic here must be pinned like this. */
  const flushRef = useRef(flush);
  useEffect(() => { flushRef.current = flush; }, [flush]);

  useEffect(() => {
    const retry = () => { void flushRef.current(); };
    window.addEventListener("online", retry);
    const timer = window.setInterval(retry, 15_000);
    return () => {
      window.removeEventListener("online", retry);
      window.clearInterval(timer);
    };
  }, []);

  /* Queue first, then try to send. Flushing is triggered by the tap and by the
     `online` event rather than by an effect watching the queue — an effect that
     calls setState on every queue change fights React's own scheduling, and
     lint rightly objects. The failure mode is also better this way: a rally is
     durably queued BEFORE any network attempt, so a request that dies mid-flight
     cannot lose it. */
  const append = useCallback(
    (next: Side[]) => {
      setLog(next);
      void saveQueued(recordOf(next));
      /* Try immediately when we believe we are online. This covers the common
         hall case — one bar of signal, where navigator.onLine says true and the
         request still fails. */
      if (navigator.onLine && !conflict) void flush();
    },
    [conflict, flush, setLog, recordOf],
  );

  /* Every tap builds on the queue, or else on what the server is KNOWN to
     hold — not on the last render's log. For a moment after every write that
     lands that render is a write behind, and a tap built on it dropped the
     rally that had just been saved. */
  const scoreOffline = useCallback(
    (side: Side) => {
      if (!canScoreOffline || heldRef.current || !loadedRef.current) return;
      const base = latestRef.current ?? baseLog.current;
      /* A finished game takes no more rallies. The court is locked once the
         phone's own replay says it is over, but a tap already on its way (a
         double tap on the winning rally) would still land here — and queued
         past the end, 11–4 became 12–4, a final no game produces. The server
         cuts such a log at the finish too (`pushLog`); this keeps the phone
         from ever showing it. */
      if (replayLite({ log: base, server: args.server, posA: args.posA, posB: args.posB }, rules).over) return;
      append([...base, side]);
    },
    [append, canScoreOffline, rules, args.server, args.posA, args.posB],
  );

  const undoOffline = useCallback(() => {
    if (heldRef.current || !loadedRef.current) return;
    const base = latestRef.current ?? baseLog.current;
    if (base.length === 0) return;
    append(base.slice(0, -1));
  }, [append]);

  /* The same rewind the server does, driven by the browser's own replay so a
     correction made with no signal lands on the same rally as one made with.
     One search, two engines — see lib/scoring/rewind. */
  const minusOffline = useCallback(
    (side: Side) => {
      if (!canScoreOffline || heldRef.current || !loadedRef.current) return;
      const base = latestRef.current ?? baseLog.current;
      const cut = rewindIndex(base.length, (n) =>
        replayLite(
          { log: base.slice(0, n), server: args.server, posA: args.posA, posB: args.posB },
          rules,
        )[side]);
      if (cut === null) return;
      append(base.slice(0, cut));
    },
    [append, canScoreOffline, rules, args.server, args.posA, args.posB],
  );

  /* A pause adds no rally, so there is nothing to queue — but the record still
     has to learn about it, and a timeout is called at exactly the moment when
     nobody is scoring. The log goes back unchanged and the tick carries the
     change. With no signal this does nothing and the pause travels with the
     next point, which is why the console never reports a failure here. A pause
     tapped while a push is on the wire goes when that push lands (`flush`). */
  const syncClock = useCallback(() => {
    if (!navigator.onLine || conflict) return;   // a refused phone is stopped in `flush`
    void flush({ clock: true });
  }, [flush, conflict]);

  /* Resolves to a sentence for the referee when the choice did not simply
     happen, or null when it did. */
  const resolveConflict = useCallback(
    async (keep: "mine" | "theirs"): Promise<string | null> => {
      if (!conflict) return null;
      if (keep === "theirs") {
        /* "Keep the saved score" means the server holds the OTHER device's
           log. After a "Keep this phone's score" whose reply never came, that
           is not a given: it may have landed. Find out, and put theirs back if
           it did — clearing the phone and walking away left the referee's
           rejected rallies on the server. */
        const maybe = uncertainRef.current;
        let settledAt = { rev: conflict.rev, log: conflict.serverLog };
        if (maybe) {
          setSyncing(true);
          try {
            let rev = conflict.rev;
            for (let i = 0; i < 2; i++) {
              const res = await push(matchId, conflict.serverLog, rev);
              if (res.ok) {
                settledAt = { rev: res.rev, log: conflict.serverLog };
                break;
              }
              if (res.reason === "stale" && sameLog(res.serverLog, maybe)) {
                rev = res.rev;   // ours landed after all: write theirs back over it
                continue;
              }
              if (res.reason === "stale" && sameLog(res.serverLog, conflict.serverLog)) {
                settledAt = { rev: res.rev, log: res.serverLog };
                break;
              }
              if (res.reason === "stale") {
                setConflict({ serverLog: res.serverLog, localLog: latestRef.current ?? conflict.localLog, rev: res.rev });
                return "The match changed again on another device — look at both scores before choosing.";
              }
              const out = await settleReply(res, { ...recordOf(conflict.serverLog), baseRev: rev });
              if (out?.status === "typed" || out?.status === "refused") {
                setConflict(null);
                settleSideways(out, latestRef.current ?? conflict.localLog);
                return null;
              }
              return `Not changed — ${out?.status === "failed" ? out.error : "try again"}.`;
            }
          } catch {
            return NO_SIGNAL;
          } finally {
            setSyncing(false);
          }
          uncertainRef.current = null;
        }
        await clearQueued(matchId);
        setLog(null);
        setConflict(null);
        setStalled(false);
        learn(settledAt.rev, settledAt.log);
        onSynced();
        return null;
      }
      /* Keeping ours overwrites the other device's rallies. Push at the
         server's current rev so the guard accepts it — and the NEWEST log, the
         one the court shows. */
      const mine = latestRef.current ?? conflict.localLog;
      let rev = conflict.rev;
      setSyncing(true);
      let out: FlushOutcome | null = null;
      try {
        for (let i = 0; i < 2 && !out; i++) {
          const claimed = claim();
          let res: PushResult;
          try {
            sent.current = withSent(sent.current, mine);
            res = await push(matchId, mine, rev, claimed);
          } catch {
            restore(claimed);
            uncertainRef.current = mine;
            setStalled(true);
            return NO_SIGNAL;
          }
          uncertainRef.current = null;
          if (!res.ok) restore(claimed);
          if (!res.ok && res.reason === "stale") {
            /* Only the rev moved — a scoring change, say. The referee's choice
               was made against this very log, so it still stands. */
            if (sameLog(res.serverLog, conflict.serverLog)) {
              rev = res.rev;
              continue;
            }
            if (sameLog(res.serverLog, mine)) {
              out = { status: "flushed", matchId, rev: res.rev, landed: false, serverLog: res.serverLog };
              break;
            }
            /* The other device scored again: show the choice with what the
               server holds now. Choosing blind against counts that have
               changed is not a choice. */
            setConflict({ serverLog: res.serverLog, localLog: mine, rev: res.rev });
            return "The match changed again on another device — look at both scores before choosing.";
          }
          out = await settleReply(res, { ...recordOf(mine), baseRev: rev });
        }
      } finally {
        setSyncing(false);
      }
      if (out?.status === "flushed") {
        learn(out.rev, out.serverLog);
        setLog(null);
        setConflict(null);
        setStalled(false);
        onSynced();
        return null;
      }
      if (out?.status === "typed" || out?.status === "refused") {
        setConflict(null);
        settleSideways(out, mine);
        return null;
      }
      if (out?.status === "failed") {
        setStalled(true);
        return `Not saved — ${out.error}. Try again when the signal is back.`;
      }
      return null;
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settleSideways only calls stable setters and onSynced
    [conflict, matchId, push, onSynced, claim, restore, setLog, learn, recordOf],
  );

  /* The typed result stands: this phone's rallies go. Resolves to a sentence
     when that is not what happened. */
  const keepTyped = useCallback(async (): Promise<string | null> => {
    const h = heldRef.current;
    if (!h) return null;
    /* A "Use this phone's score" whose reply never came may have landed. Ask
       before clearing anything: without `replaceTyped` the server answers
       "typed" while the typed result stands, and writes nothing. Cleared
       blind, the referee was told the typed result stood while the match held
       this phone's rallies. */
    const maybe = uncertainRef.current;
    if (maybe) {
      let res: PushResult;
      setSyncing(true);
      try {
        res = await push(matchId, maybe, h.rev);
      } catch {
        return NO_SIGNAL;
      } finally {
        setSyncing(false);
      }
      uncertainRef.current = null;
      if (!res.ok && res.reason === "stale" && sameLog(res.serverLog, maybe)) {
        await clearQueued(matchId);
        setHeld(null);
        setLog(null);
        setStalled(false);
        learn(res.rev, res.serverLog);
        onSynced();
        return "This phone's score had already reached the server, so it replaced the typed result.";
      }
      if (!(!res.ok && res.reason === "typed")) {
        onSynced();
        return "The match changed on another device — look at it again.";
      }
    }
    await clearQueued(matchId);
    setLog(null);
    setHeld(null);
    setStalled(false);
    /* A typed result is written with an empty log, and nothing writes rallies
       over one until somebody chooses to. */
    learn(h.rev, []);
    onSynced();
    return null;
  }, [matchId, push, onSynced, setHeld, setLog, learn]);

  /* This phone's rallies replace the typed result — at the rev of the result
     the referee was shown. If it was typed AGAIN since, the server answers
     with the result as it now stands; the card shows that one and asks again,
     so nothing is replaced that the referee has not seen. */
  const replaceTyped = useCallback(async (): Promise<string | null> => {
    const h = heldRef.current;
    const mine = latestRef.current;
    if (!h || !mine) return null;
    setSyncing(true);
    let rev = h.rev;
    /* Run once the busy state is cleared: an ordinary send starts its own. */
    let after: (() => void) | null = null;
    try {
      for (let i = 0; i < 2; i++) {
        const claimed = claim();
        let res: PushResult;
        try {
          sent.current = withSent(sent.current, mine);
          res = await push(matchId, mine, rev, claimed, { replaceTyped: true });
        } catch {
          restore(claimed);
          uncertainRef.current = mine;
          return NO_SIGNAL;
        }
        uncertainRef.current = null;
        if (!res.ok) restore(claimed);
        if (!res.ok && res.reason === "typed") {
          /* The same result at a newer rev: nobody typed anything — a scoring
             change moves every match's rev. The referee has seen this result,
             so the choice stands. */
          if (res.a === h.a && res.b === h.b && (res.outcome ?? null) === h.outcome) {
            rev = res.rev;
            continue;
          }
          setHeld({ a: res.a, b: res.b, rev: res.rev, outcome: res.outcome ?? null });
          onSynced();
          return `The result was typed in again, as ${res.a}–${res.b} — look at it before replacing it.`;
        }
        if (!res.ok && res.reason === "stale") {
          /* The match holds no typed result any more — another phone replaced
             it first, it was cleared, or an earlier replace from this phone
             landed unheard. There is nothing to replace: these rallies are an
             ordinary queue again, judged against what the server holds now —
             sent, put to the referee as a conflict, or already there. */
          setHeld(null);
          const known = recordOf(mine);
          void saveQueued({ ...known, held: false });
          after = () => resume(mine, { log: res.serverLog, rev: res.rev }, known);
          onSynced();
          return null;
        }
        const out = await settleReply(res, { ...recordOf(mine), baseRev: rev });
        if (out?.status === "flushed") {
          setHeld(null);
          learn(out.rev, out.serverLog);
          if (latestRef.current && sameLog(latestRef.current, mine)) setLog(null);
          setStalled(false);
          onSynced();
          return null;
        }
        if (out?.status === "refused") {
          setHeld(null);
          settleSideways(out, mine);
          return null;
        }
        if (out?.status === "failed") return `Not replaced — ${out.error}. Try again when the signal is back.`;
      }
      onSynced();
      return "The match changed on another device — look at it again before replacing the result.";
    } finally {
      setSyncing(false);
      after?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- settleSideways only calls stable setters and onSynced
  }, [matchId, push, onSynced, claim, restore, setHeld, setLog, learn, recordOf, resume]);

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
    minusOffline,
    syncClock,
    resolveConflict,
    held,
    keepTyped,
    replaceTyped,
    refused,
    ready,
  };
}
