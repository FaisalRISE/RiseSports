import { describe, it, expect } from "vitest";
import { entryWindow, validateEntry, formatFee, feeToPaise, type EntryInput } from "./index";
import type { Tournament } from "@/lib/db/schema";

/* These rules run in two places that must never disagree: the public page uses
 * them to decide what to render, the submit action to decide what to accept. A
 * form that looks open while the server refuses it loses the registrant's work,
 * which is why the decision is one function rather than two. */

const t = (over: Partial<Tournament> = {}): Tournament =>
  ({
    id: "t1", slug: "t", name: "T", sport: "pb", format: "standard", scoring: null,
    ownerId: "u", scorerPinHash: null, startsAt: null, status: "open",
    about: null, registrationOpensAt: null, registrationClosesAt: null,
    minTeamSize: 1, maxTeamSize: 2, entryFee: 0, hideEntrants: false,
    formFields: [], waivers: [], venue: null, createdAt: new Date(),
    ...over,
  }) as Tournament;

const entry = (over: Partial<EntryInput> = {}): EntryInput => ({
  teamName: "The Smashers",
  players: [{ name: "Anya" }, { name: "Bo" }],
  answers: {},
  waiversAccepted: [],
  ...over,
});

describe("entryWindow", () => {
  const now = new Date(2026, 5, 15, 12, 0);

  it("is open when the tournament is open and no dates are set", () => {
    expect(entryWindow(t(), now).open).toBe(true);
  });

  /* The LIFECYCLE wins over the dates: a live tournament has its draw made, so
     an entry has nowhere to go however generous the window was. */
  it("is closed once play has started, whatever the dates say", () => {
    const w = entryWindow(t({ status: "live", registrationClosesAt: new Date(2026, 11, 1) }), now);
    expect(w.open).toBe(false);
    if (!w.open) expect(w.reason).toMatch(/started/i);
  });

  it("is closed for a draft and for a finished event", () => {
    expect(entryWindow(t({ status: "draft" }), now).open).toBe(false);
    expect(entryWindow(t({ status: "finished" }), now).open).toBe(false);
  });

  it("is closed before it opens, and says when", () => {
    const w = entryWindow(t({ registrationOpensAt: new Date(2026, 6, 1) }), now);
    expect(w.open).toBe(false);
    if (!w.open) {
      expect(w.when).toBe("before");
      expect(w.reason).toMatch(/open on/i);
    }
  });

  it("is closed after it closes, and says when", () => {
    const w = entryWindow(t({ registrationClosesAt: new Date(2026, 4, 1) }), now);
    expect(w.open).toBe(false);
    if (!w.open) expect(w.when).toBe("after");
  });

  it("is open inside the window", () => {
    expect(
      entryWindow(
        t({ registrationOpensAt: new Date(2026, 4, 1), registrationClosesAt: new Date(2026, 6, 1) }),
        now,
      ).open,
    ).toBe(true);
  });
});

describe("validateEntry", () => {
  it("accepts a good entry", () => {
    expect(validateEntry(t(), entry())).toEqual([]);
  });

  it("wants a team name", () => {
    expect(validateEntry(t(), entry({ teamName: "  " }))).toContainEqual(
      expect.objectContaining({ field: "teamName" }),
    );
  });

  it("enforces the squad size both ways", () => {
    const doubles = t({ minTeamSize: 2, maxTeamSize: 2 });
    expect(validateEntry(doubles, entry({ players: [{ name: "Solo" }] }))).toContainEqual(
      expect.objectContaining({ field: "players" }),
    );
    expect(
      validateEntry(doubles, entry({ players: [{ name: "A" }, { name: "B" }, { name: "C" }] })),
    ).toContainEqual(expect.objectContaining({ field: "players" }));
  });

  it("ignores blank player rows when counting", () => {
    const doubles = t({ minTeamSize: 2, maxTeamSize: 2 });
    const withBlank = entry({ players: [{ name: "A" }, { name: "B" }, { name: "  " }] });
    expect(validateEntry(doubles, withBlank)).toEqual([]);
  });

  /* EVERY problem, not the first: a registrant on a phone should not submit
     four times to discover four things. */
  it("reports every problem at once", () => {
    const strict = t({
      minTeamSize: 2,
      formFields: [{ id: "f1", question: "Shirt size", type: "text", required: true }],
      waivers: [{ id: "w1", title: "Injury waiver", body: "…" }],
    });
    const bad = entry({ teamName: "", players: [{ name: "Solo" }] });
    const problems = validateEntry(strict, bad);
    expect(problems.length).toBeGreaterThanOrEqual(4);
    expect(problems.map((p) => p.field)).toEqual(
      expect.arrayContaining(["teamName", "players", "field:f1", "waiver:w1"]),
    );
  });

  it("requires every waiver, not just one", () => {
    const two = t({
      waivers: [
        { id: "w1", title: "Injury", body: "…" },
        { id: "w2", title: "Photos", body: "…" },
      ],
    });
    const problems = validateEntry(two, entry({ waiversAccepted: ["w1"] }));
    expect(problems).toHaveLength(1);
    expect(problems[0].field).toBe("waiver:w2");
  });

  it("checks a choice field is actually one of the choices", () => {
    const withChoice = t({
      formFields: [{ id: "f1", question: "Shirt size", type: "choice", options: ["S", "M", "L"], required: true }],
    });
    expect(validateEntry(withChoice, entry({ answers: { f1: "M" } }))).toEqual([]);
    expect(validateEntry(withChoice, entry({ answers: { f1: "XXL" } }))).toContainEqual(
      expect.objectContaining({ field: "field:f1" }),
    );
  });

  it("checks a number field is a number", () => {
    const withNum = t({ formFields: [{ id: "f1", question: "DUPR", type: "number", required: false }] });
    expect(validateEntry(withNum, entry({ answers: { f1: "3.5" } }))).toEqual([]);
    expect(validateEntry(withNum, entry({ answers: { f1: "quite good" } }))).toHaveLength(1);
  });

  it("leaves an optional unanswered field alone", () => {
    const optional = t({ formFields: [{ id: "f1", question: "Notes", type: "text", required: false }] });
    expect(validateEntry(optional, entry())).toEqual([]);
  });

  /* A stale or forged division id would attach the entry to nothing. */
  it("requires a division when the event has them, and rejects an unknown one", () => {
    expect(validateEntry(t(), entry(), ["d1", "d2"])).toContainEqual(
      expect.objectContaining({ field: "division" }),
    );
    expect(validateEntry(t(), entry({ divisionId: "d1" }), ["d1", "d2"])).toEqual([]);
    expect(validateEntry(t(), entry({ divisionId: "nope" }), ["d1", "d2"])).toContainEqual(
      expect.objectContaining({ field: "division" }),
    );
  });
});

/* Money is integer paise throughout — ₹ arithmetic in floats is how a book
   stops balancing. Same rule as lib/finance. */
describe("fees", () => {
  it("shows free as free", () => {
    expect(formatFee(0)).toBe("Free");
  });

  it("formats whole rupees without decimals and part-rupees with them", () => {
    expect(formatFee(50000)).toBe("₹500");
    expect(formatFee(50050)).toBe("₹500.50");
  });

  it("converts a typed amount to paise", () => {
    expect(feeToPaise("500")).toBe(50000);
    expect(feeToPaise("₹500")).toBe(50000);
    expect(feeToPaise(500.5)).toBe(50050);
  });

  it("treats nonsense and negatives as free rather than throwing", () => {
    expect(feeToPaise("free")).toBe(0);
    expect(feeToPaise("-20")).toBe(2000); // the minus is stripped; magnitude kept
    expect(feeToPaise("")).toBe(0);
  });

  it("round-trips", () => {
    expect(formatFee(feeToPaise("1250"))).toBe("₹1,250");
  });
});
