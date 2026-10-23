import { describe, it, expect, vi } from "vitest";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: () => {} }) }));

const { typedHeading, typedWords, sendTap, conflictWords, resetWords, pageReset, courtReset, readCard } = await import("./RefConsole");

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
    /* A walkover is the organiser's (step 8b), never "typed in". */
    expect(say(0, 11, "walkover")).toBe("Walkover to Bees — given by the organiser");
    expect(say(9, 7, "retired")).toBe("Typed in: Aces win 9–7 — the other side retired");
    expect(say(9, 7, "unrated")).toBe("Typed in: Aces win 9–7 — stopped early, no rating change");
  });

  it("a level score is just the score", () => {
    expect(say(1, 1)).toBe("Typed in: 1–1");
  });

  /* "Keep 0–11" named a game nobody played, in the court's order. */
  it("keeps a walkover as a walkover, and a score as the score", () => {
    expect(typedWords({ a: 0, b: 11, outcome: "walkover" })).toEqual({ happened: "The organiser gave this walkover", keep: "Keep the walkover" });
    expect(typedWords({ a: 11, b: 7, outcome: null })).toEqual({ happened: "The result was typed in", keep: "Keep 11–7" });
    expect(typedWords({ a: 9, b: 7, outcome: "retired" }).keep).toBe("Keep 9–7");
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

/* The card a referee sees when the organiser cleared or reset the match (step 8).
   "Not kept", never "not saved": a dropped record may hold rallies that WERE
   saved and then cleared with the rest. */
describe("the reset card", () => {
  it("says the match starts again, and how many of this phone's rallies went", () => {
    expect(resetWords(0)).toEqual({ heading: "The organiser reset this match", body: "It starts again at 0–0." });
    expect(resetWords(1).body).toBe("It starts again at 0–0. This phone's 1 rally was not kept.");
    expect(resetWords(3).body).toBe("It starts again at 0–0. This phone's 3 rallies were not kept.");
  });
});

/* When the reset card shows — and when it must not show again (step 8, round
   two). The card is the console's outer part; its rules are pure. */
describe("the reset card's rules", () => {
  const start = (seen = 0) => ({ seen, notice: null, replied: false, read: false, quiet: false });

  it("shows when the page comes back with a newer reset, even with nothing on the phone", () => {
    expect(pageReset(start(0), 3)).toMatchObject({ seen: 3, notice: { rallies: 0 } });
    expect(pageReset(start(3), 3)).toEqual(start(3));
  });

  it("is not news for a page catching up with a reset the court already knew of", () => {
    const known = { ...start(0), seen: 4 };   // the cached page was older; the court reported reset 4
    expect(pageReset(known, 4).notice).toBeNull();
    expect(pageReset(known, 5).notice).toEqual({ rallies: 0 });   // a later reset still is
  });

  it("counts the rallies the court let go, the larger count winning", () => {
    let c = courtReset(start(), 2, "reply");
    expect(c).toMatchObject({ notice: { rallies: 2 }, replied: true });
    c = pageReset(c, 3);
    c = courtReset(c, 3, "drop");
    expect(c.notice).toEqual({ rallies: 3 });
  });

  /* Read with no signal before the page came back: when it does, neither the
     newer reset nor the remounted court's drop of the same rallies shows it
     again — the referee has read it, and is looking at 0–0. */
  it("read before the page came back, it does not come back with the page", () => {
    let c = courtReset(start(0), 2, "reply");
    c = readCard(c);
    expect(c.notice).toBeNull();
    c = pageReset(c, 3);
    expect(c.notice).toBeNull();
    c = courtReset(c, 2, "drop");
    expect(c.notice).toBeNull();
    /* …and the next reset after that is news again. */
    c = pageReset(c, 5);
    expect(c.notice).toEqual({ rallies: 0 });
  });

  it("read AFTER the page came back, a later drop still shows", () => {
    let c = courtReset(start(0), 2, "reply");
    c = pageReset(c, 3);
    c = readCard(c);
    expect(c.read).toBe(false);
    c = courtReset(c, 1, "drop");
    expect(c.notice).toEqual({ rallies: 1 });
  });
});
