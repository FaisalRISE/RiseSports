/* The offline queue.
 *
 * The important cases here are the unhappy ones. A queue that works when the
 * network comes back cleanly is easy; what matters is what happens when two
 * devices scored the same match, or when a response was lost after the write
 * landed. Getting those wrong loses points off a real scoreboard.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  classify, flushMatch, flushAll, saveQueued, loadQueued, clearQueued, allQueued, __resetQueue,
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
    expect(out).toEqual({ status: "flushed", matchId: "m1", rev: 5 });
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
    expect(out).toEqual({ status: "flushed", matchId: "m1", rev: 9 });
  });

  it("drops a redundant queue when the server is already ahead", async () => {
    await saveQueued(rec("m1", "aa"));
    const push = async (): Promise<PushResult> => ({ ok: false, reason: "stale", serverLog: L("aabb"), rev: 7 });
    const out = await flushMatch(rec("m1", "aa"), push);
    expect(out.status).toBe("flushed");
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
