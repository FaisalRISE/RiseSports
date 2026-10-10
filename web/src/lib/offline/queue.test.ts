/* The offline queue.
 *
 * The important cases here are the unhappy ones. A queue that works when the
 * network comes back cleanly is easy; what matters is what happens when two
 * devices scored the same match, or when a response was lost after the write
 * landed. Getting those wrong loses points off a real scoreboard.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  classify, flushMatch, flushAll, saveQueued, loadQueued, clearQueued, allQueued, __resetQueue, settleReply,
  knownToPhone, withSent, clearIfLanded, removedElsewhere, removedHere,
  type PushResult, type QueuedMatch,
} from "./queue";
import type { Side } from "@/lib/scoring/replayLite";

const L = (s: string): Side[] => s.split("") as Side[];
const rec = (matchId: string, log: string, baseRev = 1): QueuedMatch =>
  ({ matchId, log: L(log), baseRev, queuedAt: 0 });

beforeEach(__resetQueue);

describe("classify", () => {
  it("identical logs are the same", () => {
    expect(classify(L("aab"), L("aab"))).toBe("same");
    expect(classify([], [])).toBe("same");
  });

  it("we have rallies the server has not seen", () => {
    expect(classify(L("aa"), L("aab"))).toBe("ahead");
    expect(classify([], L("a"))).toBe("ahead");
  });

  it("the server has rallies we have not seen", () => {
    expect(classify(L("aab"), L("aa"))).toBe("behind");
  });

  it("both added different rallies", () => {
    expect(classify(L("aab"), L("aaa"))).toBe("diverged");
    expect(classify(L("ab"), L("ba"))).toBe("diverged");
  });

  it("EQUAL LENGTH is not enough to call it the same", () => {
    /* Two devices each scoring one rally produce logs of the same length that
       disagree. Comparing lengths alone would silently drop a point. */
    expect(classify(L("aab"), L("aaa"))).toBe("diverged");
    expect(classify(L("a"), L("b"))).toBe("diverged");
  });
});

describe("storage", () => {
  it("round-trips a queued match", async () => {
    await saveQueued(rec("m1", "aab"));
    expect((await loadQueued("m1"))?.log).toEqual(L("aab"));
  });

  it("returns null for a match that was never queued", async () => {
    expect(await loadQueued("nope")).toBeNull();
  });

  it("clears", async () => {
    await saveQueued(rec("m1", "a"));
    await clearQueued("m1");
    expect(await loadQueued("m1")).toBeNull();
  });

  it("lists everything queued", async () => {
    await saveQueued(rec("m1", "a"));
    await saveQueued(rec("m2", "bb"));
    expect((await allQueued()).map((r) => r.matchId).sort()).toEqual(["m1", "m2"]);
  });

  it("survives with no IndexedDB at all", async () => {
    // the in-memory fallback is what makes a private window degrade rather than crash
    expect(typeof indexedDB).toBe("undefined");
    await saveQueued(rec("m1", "ab"));
    expect((await loadQueued("m1"))?.log).toEqual(L("ab"));
  });
});

describe("flushing", () => {
  it("pushes cleanly and clears the queue", async () => {
    await saveQueued(rec("m1", "aab"));
    const push = async (): Promise<PushResult> => ({ ok: true, rev: 5 });
    const out = await flushMatch(rec("m1", "aab"), push);
    expect(out).toEqual({ status: "flushed", matchId: "m1", rev: 5, landed: true, serverLog: L("aab") });
    expect(await loadQueued("m1")).toBeNull();
  });

  it("retries at the new rev when the read was merely stale", async () => {
    /* Nobody else scored — we just held an old rev. This must resolve itself
       without troubling the referee. */
    let calls = 0;
    const push = async (_id: string, _log: Side[], base: number): Promise<PushResult> => {
      calls++;
      if (base === 1) return { ok: false, reason: "stale", serverLog: L("aa"), rev: 4 };
      return { ok: true, rev: 5 };
    };
    const out = await flushMatch(rec("m1", "aab", 1), push);
    expect(out.status).toBe("flushed");
    expect(calls).toBe(2);
  });

  it("treats an already-landed write as success, not a conflict", async () => {
    /* The write succeeded and the response was lost. The server's log equals
       ours; re-pushing must not look like a conflict. */
    const push = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("aab"), rev: 9 });
    const out = await flushMatch(rec("m1", "aab"), push);
    /* Not LANDED: this attempt wrote nothing, so the time it carried goes back. */
    expect(out).toEqual({ status: "flushed", matchId: "m1", rev: 9, landed: false, serverLog: L("aab") });
  });

  it("drops a redundant queue when the server is already ahead", async () => {
    await saveQueued(rec("m1", "aa"));
    const push = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("aabb"), rev: 7 });
    const out = await flushMatch(rec("m1", "aa"), push);
    expect(out).toMatchObject({ status: "flushed", landed: false, serverLog: L("aabb") });
    expect(await loadQueued("m1")).toBeNull();
  });

  /* The rev moved and nobody added a rally — a scoring change moves every
     match's rev, and a write whose reply was lost moves this one. An undo is
     SHORTER than the server's log, so `classify` calls it "behind", and it was
     dropped as redundant: the point the referee took off came back. */
  it("retries an undo when the server holds the log this phone was based on", async () => {
    const pushed: [string, number][] = [];
    const push = async (_id: string, log: Side[], base: number): Promise<PushResult> => {
      pushed.push([log.join(""), base]);
      return base === 3 ? { ok: false, reason: "stale", serverLog: L("aab"), rev: 4 } : { ok: true, rev: 5 };
    };
    const undo: QueuedMatch = { ...rec("m1", "aa", 3), baseLog: L("aab") };
    expect(await flushMatch(undo, push)).toMatchObject({ status: "flushed", landed: true, rev: 5 });
    expect(pushed).toEqual([["aa", 3], ["aa", 4]]);
  });

  it("retries an undo when the server holds a log this phone sent and never heard back about", async () => {
    const pushed: [string, number][] = [];
    const push = async (_id: string, log: Side[], base: number): Promise<PushResult> => {
      pushed.push([log.join(""), base]);
      return base === 1 ? { ok: false, reason: "stale", serverLog: L("aab"), rev: 2 } : { ok: true, rev: 3 };
    };
    const undo: QueuedMatch = { ...rec("m1", "aa", 1), baseLog: L("aa"), sent: [L("aab")] };
    expect(await flushMatch(undo, push)).toMatchObject({ status: "flushed", landed: true });
    expect(pushed).toEqual([["aa", 1], ["aa", 2]]);
  });

  it("an undo then a tap is this phone's own edit, not a conflict, when nobody else wrote", async () => {
    const push = async (_id: string, _log: Side[], base: number): Promise<PushResult> =>
      base === 3 ? { ok: false, reason: "stale", serverLog: L("aab"), rev: 4 } : { ok: true, rev: 5 };
    const edit: QueuedMatch = { ...rec("m1", "aaa", 3), baseLog: L("aab") };
    expect(await flushMatch(edit, push)).toMatchObject({ status: "flushed", landed: true });
  });

  /* The other half of the rule: a log this phone has NOT seen is another
     device's work, and is judged by `classify` exactly as before. */
  it("still asks about a difference, and drops only what adds nothing, against another device's rallies", async () => {
    const theirs = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("aabb"), rev: 4 });
    /* This phone's taps that the other device's log already holds: nothing to send. */
    const covered: QueuedMatch = { ...rec("m1", "aab", 3), baseLog: L("aa") };
    expect(await flushMatch(covered, theirs)).toMatchObject({ status: "flushed", landed: false });
    const tapped: QueuedMatch = { ...rec("m1", "aaba", 3), baseLog: L("aab") };
    expect(await flushMatch(tapped, theirs)).toMatchObject({ status: "conflict" });
  });

  /* This phone took a rally off its base while another device scored on top
     of it. Ours is a prefix of theirs — "behind" — and was dropped as already
     there, so the point the referee took off came back. It is a question. */
  it("asks, rather than dropping, when this phone took a rally off and another scored on top", async () => {
    const theirs = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("aabb"), rev: 4 });
    const undone: QueuedMatch = { ...rec("m1", "aa", 3), baseLog: L("aab") };
    expect(await flushMatch(undone, theirs)).toEqual({
      status: "conflict", matchId: "m1", serverLog: L("aabb"), localLog: L("aa"), rev: 4,
    });
  });

  /* Both devices took the same rally off, and this one then tapped a new one.
     Pushing ours keeps their correction and adds our rally: no question. */
  it("does not ask when both devices took the same rally off", async () => {
    const pushed: number[] = [];
    const push = async (_id: string, _log: Side[], base: number): Promise<PushResult> => {
      pushed.push(base);
      return base === 3 ? { ok: false, reason: "stale", serverLog: L("aa"), rev: 4 } : { ok: true, rev: 5 };
    };
    const retapped: QueuedMatch = { ...rec("m1", "aab", 3), baseLog: L("aaa") };
    expect(await flushMatch(retapped, push)).toMatchObject({ status: "flushed", landed: true });
    expect(pushed).toEqual([3, 4]);
  });

  /* Every log sent and never heard back about stays recognisable however many
     failed taps follow it: eight used to push the oldest out of the list, and
     the referee was then asked about their own write — or undo — as if another
     device had made it. A log sent twice is listed once. */
  it("remembers every log sent since the last reply", () => {
    let sent = withSent([], L("a"));
    sent = withSent(sent, L(""));
    for (let i = 1; i <= 12; i++) sent = withSent(sent, L("b".repeat(i)));
    sent = withSent(sent, L("a"));
    expect(sent.map((s) => s.join(""))).toEqual(["", ...Array.from({ length: 12 }, (_, i) => "b".repeat(i + 1)), "a"]);
  });

  /* Both devices took the same rally off, and the OTHER then scored. The
     server has everything this phone has and nothing it removed: ours adds
     nothing, and goes without a question — the mirror of the case above. */
  it("does not ask when both devices took the same rally off and the other then scored", async () => {
    const theirs = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("aab"), rev: 4 });
    const undone: QueuedMatch = { ...rec("m1", "aa", 3), baseLog: L("aaa") };
    expect(await flushMatch(undone, theirs)).toMatchObject({ status: "flushed", landed: false });
  });

  /* This phone's write, cut at the finish by the server, landed and its reply
     was lost; the referee then took rallies off below the finish. The server's
     log is one this phone never sent whole, so it used to read as another
     device's — and ours, "behind" it, was dropped: the correction lost with no
     word. The server still has a rally this phone took off, so it asks. */
  it("asks when the server holds this phone's own write, cut at the finish, below which it undid", async () => {
    const cut = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("aaa"), rev: 2 });
    const undone: QueuedMatch = { ...rec("m1", "aa", 1), baseLog: L(""), sent: [L("aaaa")] };
    expect(await flushMatch(undone, cut)).toMatchObject({ status: "conflict", serverLog: L("aaa"), localLog: L("aa") });
  });

  /* Shorter than the log this phone knew the server held, and not one it
     sent: another device took a rally off. Ours reads as "ahead" of it, and
     was pushed straight over the correction. */
  it("puts rallies another device took off to the referee, not back on the server", async () => {
    let calls = 0;
    const push = async (): Promise<PushResult> => { calls++; return { ok: false, reason: "stale", serverLog: L("aa"), rev: 4 }; };
    const tapped: QueuedMatch = { ...rec("m1", "aaab", 3), baseLog: L("aaa") };
    expect(await flushMatch(tapped, push)).toEqual({ status: "conflict", matchId: "m1", serverLog: L("aa"), localLog: L("aaab"), rev: 4 });
    expect(calls).toBe(1);
    /* This phone's OWN undo, sent and unheard, is not someone else's. */
    const own: QueuedMatch = { ...rec("m1", "aab", 3), baseLog: L("aaa"), sent: [L("aa")] };
    let retried = 0;
    expect(await flushMatch(own, async (_id, _log, base) => {
      retried++;
      return base === 3 ? { ok: false, reason: "stale", serverLog: L("aa"), rev: 4 } : { ok: true, rev: 5 };
    })).toMatchObject({ status: "flushed", landed: true });
    expect(retried).toBe(2);
  });

  /* A pause with nothing queued sends the log the server was last known to
     hold, only to carry the clock. On a stale reply that log is not this
     phone's work and is never judged: the server's own log goes back. */
  it("a clock-only push sends the server's own log back on a stale reply", async () => {
    const pushed: [string, number][] = [];
    const push = async (_id: string, log: Side[], base: number): Promise<PushResult> => {
      pushed.push([log.join(""), base]);
      return base === 3 ? { ok: false, reason: "stale", serverLog: L("aab"), rev: 4 } : { ok: true, rev: 5 };
    };
    const pause: QueuedMatch = { ...rec("m1", "aaa", 3), baseLog: L("aaa") };
    expect(await flushMatch(pause, push, 3, { clockOnly: true })).toEqual({
      status: "flushed", matchId: "m1", rev: 5, landed: true, serverLog: L("aab"),
    });
    expect(pushed).toEqual([["aaa", 3], ["aab", 4]]);
  });

  /* The server cuts a log at the rally that ended the game, and says what it
     stored. That — not what was sent — is what the server holds. */
  it("takes what the server stored when it cut the log at the finish", async () => {
    const push = async (): Promise<PushResult> => ({ ok: true, rev: 2, log: L("aa") });
    expect(await flushMatch(rec("m1", "aaab"), push)).toMatchObject({ status: "flushed", landed: true, serverLog: L("aa") });
  });

  it("knows a log only by its content, and a record from before it knows nothing", () => {
    expect(knownToPhone({ baseLog: L("ab") }, L("ab"))).toBe(true);
    expect(knownToPhone({ baseLog: L("ab") }, L("ba"))).toBe(false);
    expect(knownToPhone({ sent: [L("a"), L("ab")] }, L("ab"))).toBe(true);
    expect(knownToPhone({}, L("ab"))).toBe(false);
    expect(knownToPhone({}, [])).toBe(false);
    expect(withSent([L("a"), L("ab")], L("a"))).toEqual([L("ab"), L("a")]);
    expect(withSent(Array.from({ length: 9 }, (_, i) => L("a".repeat(i + 1))), L("b"))).toHaveLength(10);
  });

  /* The stored record is the phone's NEWEST log. Clearing it because an older
     one landed deleted a tap made meanwhile. */
  it("clears a record only while it still holds the log that landed", async () => {
    await saveQueued(rec("m1", "aab"));
    await clearIfLanded("m1", L("aa"));
    expect((await loadQueued("m1"))?.log).toEqual(L("aab"));
    await clearIfLanded("m1", L("aab"));
    expect(await loadQueued("m1")).toBeNull();
  });

  it("STOPS and reports a genuine divergence instead of picking a winner", async () => {
    await saveQueued(rec("m1", "aab"));
    const push = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("aaa"), rev: 6 });
    const out = await flushMatch(rec("m1", "aab"), push);
    expect(out).toEqual({
      status: "conflict", matchId: "m1", serverLog: L("aaa"), localLog: L("aab"), rev: 6,
    });
    // and the queue is NOT cleared — the rallies are still recoverable
    expect(await loadQueued("m1")).not.toBeNull();
  });

  it("gives up rather than looping forever against a moving target", async () => {
    let rev = 1;
    const push = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("a"), rev: ++rev });
    const out = await flushMatch(rec("m1", "ab", 1), push, 3);
    expect(out.status).toBe("failed");
  });

  it("surfaces a transport error without discarding the rallies", async () => {
    await saveQueued(rec("m1", "aab"));
    const push = async (): Promise<PushResult> => ({ ok: false, reason: "error", error: "offline" });
    const out = await flushMatch(rec("m1", "aab"), push);
    expect(out).toEqual({ status: "failed", matchId: "m1", error: "offline" });
    expect(await loadQueued("m1")).not.toBeNull();
  });

  it("flushes every queued match and reports each", async () => {
    await saveQueued(rec("m1", "a"));
    await saveQueued(rec("m2", "bb"));
    const push = async (id: string): Promise<PushResult> =>
      id === "m1" ? { ok: true, rev: 2 } : { ok: false, reason: "stale", serverLog: L("ba"), rev: 3 };
    const out = await flushAll(push);
    expect(out.map((o) => o.status).sort()).toEqual(["conflict", "flushed"]);
    // the clean one is gone, the conflicted one is kept
    expect(await loadQueued("m1")).toBeNull();
    expect(await loadQueued("m2")).not.toBeNull();
  });
});

/* Regression: found by killing the server with the page open.
 *
 * A Server Action rejects outright when the request cannot be made — which is
 * the NORMAL offline case, not an exceptional one. It used to propagate out of
 * flushMatch, so the console never ran its "failed" branch and showed queued
 * rallies as saved. The rallies were never at risk (IndexedDB is written
 * first); the lie to the referee was the bug. */
describe("a push that rejects outright", () => {
  const rec = { matchId: "m1", log: ["a", "b"] as Side[], baseRev: 3, queuedAt: 0 };

  it("comes back as failed rather than throwing", async () => {
    const out = await flushMatch(rec, async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.error).toBe("Failed to fetch");
  });

  it("keeps the queue so the rallies can still be sent later", async () => {
    __resetQueue();
    await saveQueued(rec);
    await flushMatch(rec, async () => {
      throw new Error("offline");
    });
    expect((await loadQueued("m1"))?.log).toEqual(["a", "b"]);
  });

  it("survives a rejection that is not an Error", async () => {
    const out = await flushMatch(rec, async () => {
      throw "gone";
    });
    expect(out.status).toBe("failed");
    if (out.status === "failed") expect(out.error).toBe("No connection to the server");
  });
});

/* Step 7. Two replies the queue used to have no word for, and so retried:
 * "the match was typed in" and "this match will never take rallies". The first
 * is how a phone that reconnected used to wipe out a typed result — its push
 * was stale, the typed match's log was empty, so its rallies looked "ahead"
 * and went again at the new rev, and that write replaced the typed score. */
describe("a reply that ends the attempt for good", () => {
  it("typed: keeps the rallies, holds them for the referee, and sends them once", async () => {
    await saveQueued(rec("m1", "ab"));
    let calls = 0;
    const push = async (): Promise<PushResult> => { calls++; return { ok: false, reason: "typed", a: 11, b: 3, rev: 4 }; };
    expect(await flushMatch(rec("m1", "ab"), push)).toEqual({ status: "typed", matchId: "m1", a: 11, b: 3, rev: 4, outcome: null, kept: true });
    expect(calls).toBe(1);
    expect(await loadQueued("m1")).toMatchObject({ log: L("ab"), held: true });

    /* Nothing sends a held record on its own. */
    expect(await flushAll(push)).toEqual([]);
    expect(calls).toBe(1);
  });

  /* The differential: the old reply for the same situation. A stale answer
     with the typed match's empty log reads as "ahead" and is retried — that
     retry is the write that replaced the typed result. */
  it("where a stale reply with an empty server log would have been retried", async () => {
    expect(classify([], L("ab"))).toBe("ahead");
    let calls = 0;
    await flushMatch(rec("m1", "ab"), async () => {
      calls++;
      return calls === 1 ? { ok: false, reason: "stale", serverLog: [], rev: 4 } : { ok: true, rev: 5 };
    });
    expect(calls).toBe(2);
  });

  it("refused: drops the rallies and does not retry", async () => {
    await saveQueued(rec("m1", "ab"));
    let calls = 0;
    const out = await flushMatch(rec("m1", "ab"), async () => {
      calls++;
      return { ok: false, reason: "refused", title: "This match was deleted", error: "It was removed on the manage screen." };
    });
    expect(out).toEqual({ status: "refused", matchId: "m1", title: "This match was deleted", error: "It was removed on the manage screen." });
    expect(calls).toBe(1);
    expect(await loadQueued("m1")).toBeNull();
  });

  /* A pause sent with nothing queued carries the server's own log. Filed as
     held, a reload offered to "put back" rallies the organiser had replaced. */
  it("typed: holds nothing when nothing was queued", async () => {
    const out = await flushMatch(rec("m1", "ab"), async () => ({ ok: false, reason: "typed", a: 11, b: 3, rev: 4 }));
    expect(out).toMatchObject({ status: "typed", kept: false });
    expect(await loadQueued("m1")).toBeNull();
  });

  it("settleReply is the one reading of a reply, for the conflict dialog too", async () => {
    const r = rec("m1", "ab");
    expect(await settleReply({ ok: true, rev: 3 }, r)).toEqual({ status: "flushed", matchId: "m1", rev: 3, landed: true, serverLog: L("ab") });
    expect(await settleReply({ ok: false, reason: "error", error: "x" }, r)).toEqual({ status: "failed", matchId: "m1", error: "x" });
    expect(await settleReply({ ok: false, reason: "stale", serverLog: [], rev: 3 }, r)).toBeNull();
    expect(await settleReply({ ok: false, reason: "typed", a: 1, b: 0, rev: 3 }, r)).toMatchObject({ status: "typed" });
    expect(await settleReply({ ok: false, reason: "refused", title: "t", error: "e" }, r)).toMatchObject({ status: "refused" });
  });
});

/* The two rules on their own, so each keeps its whole contract whatever its
   callers check first: both callers ask knownToPhone before removedElsewhere
   today, which would hide a removedElsewhere that forgot it. */
describe("who took a rally off", () => {
  it("removedElsewhere: shorter than the base, a prefix of it, ours continues it — and not a log this phone sent", () => {
    expect(removedElsewhere({ baseLog: L("aab") }, L("aa"), L("aab"))).toBe(true);
    expect(removedElsewhere({ baseLog: L("aab"), sent: [L("aa")] }, L("aa"), L("aab"))).toBe(false);
    expect(removedElsewhere({ baseLog: L("aab") }, L("aa"), L("aaa"))).toBe(false);
    expect(removedElsewhere({ baseLog: L("aab") }, L("ab"), L("aab"))).toBe(false);
    expect(removedElsewhere({}, L("aa"), L("aab"))).toBe(false);
  });

  it("removedHere: the server's next rally is one this phone built on or sent past its own log", () => {
    expect(removedHere({ baseLog: L("aab") }, L("aabb"), L("aa"))).toBe(true);
    expect(removedHere({ baseLog: L("aaa") }, L("aab"), L("aa"))).toBe(false);
    expect(removedHere({ baseLog: L(""), sent: [L("aaaa")] }, L("aaa"), L("aa"))).toBe(true);
    expect(removedHere({ baseLog: L("aa") }, L("aabb"), L("aab"))).toBe(false);
    expect(removedHere({ baseLog: L("aab") }, L("aa"), L("aa"))).toBe(false);
  });
});
