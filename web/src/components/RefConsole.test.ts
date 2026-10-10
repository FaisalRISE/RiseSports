import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { typedHeading, sendTap, conflictWords } = await import("./RefConsole");

/* The heading on the referee's card when a result was typed in. A walkover or
   a retirement says so, as every other screen does, rather than reading as a
   game played out on the court. */
describe("the typed result on the referee's card", () => {
  const say = (a: number, b: number, outcome: "walkover" | "retired" | "unrated" | null = null) =>
    typedHeading({ a, b, outcome }, "Aces", "Bees");

  it("names the winner and the score, larger first", () => {
    expect(say(11, 7)).toBe("Typed in: Aces win 11–7");
    expect(say(7, 11)).toBe("Typed in: Bees win 11–7");
  });

  it("says why a result moves no rating", () => {
    expect(say(0, 11, "walkover")).toBe("Typed in: walkover to Bees");
    expect(say(9, 7, "retired")).toBe("Typed in: Aces win 9–7 — the other side retired");
    expect(say(9, 7, "unrated")).toBe("Typed in: Aces win 9–7 — stopped early, no rating change");
  });

  it("a level score is just the score", () => {
    expect(say(1, 1)).toBe("Typed in: 1–1");
  });
});

/* A console that cannot score offline (carrom, chess, OSL) sends each tap on
   its own, carrying the time the clock measured since the last write. A write
   that did not land wrote no time either, so the time goes back to the clock
   and rides on the next one. It was claimed and dropped: after a scoring save,
   which moves every rev, every live court of such an event lost a rally's
   worth of play time. */
describe("one tap from a console that cannot score offline", () => {
  const clock = () => {
    const c = {
      restored: [] as unknown[],
      claim: () => ({ playMs: 1000, pausedMs: 0 }),
      restore: (t: unknown) => { c.restored.push(t); },
    };
    return c;
  };

  it("keeps the time a write that landed carried", async () => {
    const c = clock();
    expect(await sendTap(async () => ({ ok: true }), c)).toEqual({ ok: true });
    expect(c.restored).toEqual([]);
  });

  it("puts the time back when the match had moved on", async () => {
    const c = clock();
    const stale = { ok: false as const, error: "Not recorded", stale: true as const };
    expect(await sendTap(async () => stale, c)).toEqual(stale);
    expect(c.restored).toEqual([{ playMs: 1000, pausedMs: 0 }]);
  });

  it("puts the time back, and says the tap was not recorded, when no answer came", async () => {
    const c = clock();
    const r = await sendTap(async () => { throw new Error("fetch failed"); }, c);
    expect(r).toEqual({ ok: false, error: "Not recorded — the server did not answer. Try again." });
    expect(c.restored).toHaveLength(1);
  });

  it("claims nothing for a write that carries no time", async () => {
    let tick: unknown = "unset";
    await sendTap(async (t) => { tick = t; return { ok: true }; }, null);
    expect(tick).toBeUndefined();
  });
});

/* The conflict dialog says what was found. One sentence — "both versions have
   rallies the other does not" — was false for two of the three situations that
   reach it, and one of the choices then overwrites real rallies. */
describe("what the conflict dialog says", () => {
  const L = (s: string) => s.split("") as ("a" | "b")[];
  it("the saved score still has a rally this phone took off", () => {
    expect(conflictWords(L("aab"), L("aa")).heading).toBe("The saved score has a rally this phone took off");
    expect(conflictWords(L("aab"), L("aa")).body).toBe("This phone took a rally off, but the saved score still has it.");
    expect(conflictWords(L("aabb"), L("aa")).body).toBe("This phone took a rally off, but the saved score still has it, and more after it.");
  });
  it("another device took rallies off", () => {
    expect(conflictWords(L("aa"), L("aaab")).heading).toBe("Another device took rallies off");
    expect(conflictWords(L(""), L("ab")).body).toContain("Keeping this phone's score puts them back.");
  });
  it("each has rallies the other lacks", () => {
    expect(conflictWords(L("aab"), L("aaa")).heading).toBe("Another device also scored this match");
  });
});
