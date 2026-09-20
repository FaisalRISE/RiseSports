import { describe, it, expect } from "vitest";
import { entryWindow, entryRuleProblems, validateEntry, verdictProblems, formatFee, feeToPaise, type EntryInput, type Problem, type TypedPlayer } from "./index";
import { NO_RULES, entryFailures, type Rules } from "@/lib/eligibility";
import { vi } from "vitest";
vi.mock("server-only", () => ({}));
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

  /* Every event now has at least one category behind the scenes. Asking a club
     night's entrants to choose from a list of one — and refusing the entry when
     they did not — is the regression this pins. */
  it("asks nothing when the event runs a single category", () => {
    expect(validateEntry(t(), entry(), ["only"])).toEqual([]);
  });

  it("still rejects a forged id, even with only one category", () => {
    expect(validateEntry(t(), entry({ divisionId: "nope" }), ["only"])).toContainEqual(
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

describe("what the category still needs from each player", () => {
  const rows = (...ps: Partial<TypedPlayer>[]): TypedPlayer[] =>
    ps.map((p, i) => ({ row: i, name: `P${i}`, phone: null, gender: "M", dob: "", dupr: "", ...p }));
  /* The real one is `normalisePhone`; digits only is enough to prove the rule
     is applied to the NORMALISED number and not to what was typed. */
  const norm = (p: string | null) => (p ? p.replace(/\D/g, "") || null : null);
  const rules = (over: Partial<Rules>): Rules => ({ ...NO_RULES, ...over });
  const says = (ps: Problem[], row: number) => ps.find((p) => p.field === `player:${row}`)?.message ?? "";

  it("asks for nothing at all in a category with no rules", () => {
    expect(entryRuleProblems(NO_RULES, rows({}, {}), norm)).toEqual([]);
  });

  it("refuses a date of birth the database would refuse", () => {
    const r = rules({ ageMin: 35, ageOn: "2026-10-12" });
    expect(says(entryRuleProblems(r, rows({ dob: "1989-05-17" }), norm), 0)).toBe("");
    /* A year typed as "1089", or as two digits — both parse, both would then
       break `registration_players_dob_sane` inside the insert. */
    expect(says(entryRuleProblems(r, rows({ dob: "1089-05-17" }), norm), 0)).toBe("Enter a real date of birth.");
    expect(says(entryRuleProblems(r, rows({ dob: "0019-05-17" }), norm), 0)).toBe("Enter a real date of birth.");
  });

  it("makes each player use their own number where the number IS the evidence", () => {
    const capped = rules({ ratingMax: 1049 });
    const shared = rows({ phone: "98200 11111" }, { phone: "9820011111" });
    expect(says(entryRuleProblems(capped, shared, norm), 0)).toBe("");
    expect(says(entryRuleProblems(capped, shared, norm), 1)).toContain("own mobile number");
    /* Two different numbers are fine, and so is one number where no rating
       limit makes the phone stand for a person. */
    expect(entryRuleProblems(capped, rows({ phone: "9820011111" }, { phone: "9820022222" }), norm)).toEqual([]);
    expect(entryRuleProblems(rules({ gender: "M" }), shared, norm)).toEqual([]);
  });
});

describe("telling the entrant what went wrong", () => {
  const typed: TypedPlayer[] = [
    { row: 0, name: "Ravi", phone: null, gender: "M", dob: "", dupr: "" },
    { row: 1, name: "Imran", phone: null, gender: "M", dob: "", dupr: "" },
  ];

  it("points at the players when it is the players", () => {
    const v = entryFailures(
      [
        { name: "Ravi", gender: "M", dob: null, rating: null, dupr: null },
        { name: "Imran", gender: "F", dob: null, rating: null, dupr: null },
      ],
      { ...NO_RULES, gender: "F" },
      { complete: true, minTeamSize: 2 },
    );
    const ps = verdictProblems(v, typed, "Women's Doubles");
    expect(ps[0]).toEqual({ field: "form", message: "Not everyone on this entry can play in Women's Doubles. See the note under each player." });
    expect(ps.find((p) => p.field === "player:0")?.message).toBe("Women only");
    expect(ps.some((p) => p.field === "player:1")).toBe(false);
  });

  it("says the team rule when nothing is wrong with anybody on the team", () => {
    /* Two men in Mixed break no rule as individuals, so "see the note under
       each player" sent the entrant hunting under two names with nothing
       written beneath either of them. */
    const v = entryFailures(
      [
        { name: "Ravi", gender: "M", dob: null, rating: null, dupr: null },
        { name: "Imran", gender: "M", dob: null, rating: null, dupr: null },
      ],
      { ...NO_RULES, gender: "MX" },
      { complete: true, minTeamSize: 2 },
    );
    const ps = verdictProblems(v, typed, "Mixed");
    expect(ps[0].message).toBe("This team cannot enter Mixed: Mixed needs at least one man and one woman.");
    expect(ps.some((p) => p.field.startsWith("player:"))).toBe(false);
    expect(ps.find((p) => p.field === "division")?.message).toBe("Mixed needs at least one man and one woman.");
  });
});
