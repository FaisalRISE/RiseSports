import { describe, it, expect, vi, afterEach } from "vitest";
import {
  NO_RULES, PRESETS, ageOnISO, dateLabel, duprLabel, duprToX100, entryFailures, floatingDateISO,
  hasRules, needsFrom, parseDobISO, parseISODate, parseRules, personFailures, playerEvidence, ruleChips,
  rulesOfDivision, rulesSentence, sportRating, squadFailures, squadIsComplete, todayInIndia, waiverLine,
  type Evidence, type Rules,
} from "./index";

/* The rules, judged without a database. Every date is a string, so these pass
 * the same under TZ=UTC and TZ=Asia/Kolkata — `npm run test:tz` runs both, and
 * a regression that brought a `Date` back into age maths would show up there as
 * a birthday counted a day early. */

const rules = (over: Partial<Rules>): Rules => ({ ...NO_RULES, ...over });
const who = (over: Partial<Evidence> = {}): Evidence => ({
  name: "Asha", gender: "F", dob: "1990-05-17", rating: 800, dupr: 350, ...over,
});
const codes = (fs: { code: string }[]) => fs.map((f) => f.code);
const blocks = (fs: { severity: string; code: string }[]) => fs.filter((f) => f.severity === "block").map((f) => f.code);

describe("dates are strings, and real ones", () => {
  it("accepts a real date and refuses impossible ones", () => {
    expect(parseISODate("2026-10-12")).toEqual({ y: 2026, m: 10, d: 12 });
    expect(parseISODate("2026-02-30")).toBeNull();
    expect(parseISODate("2023-02-29")).toBeNull();
    expect(parseISODate("2024-02-29")).toEqual({ y: 2024, m: 2, d: 29 });
    expect(parseISODate("1994-13-45")).toBeNull();
    expect(parseISODate("")).toBeNull();
    expect(parseISODate("12/10/2026")).toBeNull();
  });

  it("counts the birthday itself, and not the day before", () => {
    expect(ageOnISO("1991-10-12", "2026-10-12")).toBe(35);
    expect(ageOnISO("1991-10-13", "2026-10-12")).toBe(34);
  });

  it("puts a 29 February birthday on 1 March in a year without one", () => {
    expect(ageOnISO("2008-02-29", "2025-02-28")).toBe(16);
    expect(ageOnISO("2008-02-29", "2025-03-01")).toBe(17);
    expect(ageOnISO("2008-02-29", "2028-02-29")).toBe(20);
  });

  it("has no age for a missing, invalid or future date of birth", () => {
    expect(ageOnISO(null, "2026-10-12")).toBeNull();
    expect(ageOnISO("", "2026-10-12")).toBeNull();
    expect(ageOnISO("1994-13-45", "2026-10-12")).toBeNull();
    expect(ageOnISO("2027-01-01", "2026-10-12")).toBeNull();
  });

  it("refuses a year the database would refuse, so nothing reaches the CHECK", () => {
    /* "1089" for "1989" is one slip; "0019-05-17" is what a date field hands
       over when two digits are typed into the year. Both parse as real dates
       and both used to sail through an "at least" age rule with an age in the
       hundreds — and then violate `registration_players_dob_sane` inside the
       insert, which gave the entrant no entry and no message. */
    expect(parseISODate("1089-05-17")).toEqual({ y: 1089, m: 5, d: 17 });
    expect(parseDobISO("1089-05-17")).toBeNull();
    expect(parseDobISO("0019-05-17")).toBeNull();
    expect(parseDobISO("1899-12-31")).toBeNull();
    expect(parseDobISO("1900-01-01")).toEqual({ y: 1900, m: 1, d: 1 });
    expect(ageOnISO("1089-05-17", "2026-10-12")).toBeNull();
    expect(blocks(personFailures(who({ dob: "1089-05-17" }), rules({ ageMin: 35, ageOn: "2026-10-12" }))))
      .toEqual(["age:min:35"]);
  });

  it("labels a date from its own parts", () => {
    expect(dateLabel("2026-10-12")).toBe("12 Oct 2026");
  });

  it("reads a floating event time as the venue's calendar day", () => {
    /* 7pm on 12 Oct at the venue is stored as 19:00 UTC — the day is the 12th,
       whatever the server's own timezone thinks. */
    expect(floatingDateISO(new Date(Date.UTC(2026, 9, 12, 19, 0)))).toBe("2026-10-12");
  });

  afterEach(() => vi.useRealTimers());

  it("knows today in India even when the server's clock is still on yesterday in UTC", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-11T19:00:00Z")); // 00:30 on the 12th in India
    expect(todayInIndia()).toBe("2026-10-12");
  });
});

describe("DUPR is stored in hundredths", () => {
  it("converts what an organiser or player types", () => {
    expect(duprToX100("3.75")).toBe(375);
    expect(duprToX100("4")).toBe(400);
    expect(duprToX100("3,5")).toBe(350);
    expect(duprLabel(350)).toBe("3.50");
  });

  it("refuses anything that is not a DUPR", () => {
    for (const bad of ["9", "0.5", "abc", "", "3.75.1", "-3"]) expect(duprToX100(bad), bad).toBeNull();
  });
});

describe("one player against the rules", () => {
  it("lets anyone into a category with no rules", () => {
    expect(personFailures(who({ gender: null, dob: null, rating: null, dupr: null }), NO_RULES)).toEqual([]);
    expect(personFailures(who(), null)).toEqual([]);
  });

  it("reports every broken rule at once, in community order: rating, DUPR, gender, age", () => {
    const fs = personFailures(
      who({ gender: "M", rating: 600, dupr: 300, dob: "2000-01-01" }),
      rules({ gender: "F", ratingMin: 750, duprMin: 350, ageMin: 35, ageOn: "2026-10-12" }),
    );
    expect(codes(fs)).toEqual(["rating:min:750", "dupr:min:350", "gender:F", "age:min:35"]);
  });

  it("treats every bound as inclusive", () => {
    const r = rules({ ratingMin: 750, ratingMax: 1049, duprMin: 300, duprMax: 400, ageMin: 35, ageMax: 49, ageOn: "2026-10-12" });
    expect(personFailures(who({ rating: 750, dupr: 300, dob: "1991-10-12" }), r)).toEqual([]);
    expect(personFailures(who({ rating: 1049, dupr: 400, dob: "1976-10-13" }), r)).toEqual([]);
    expect(blocks(personFailures(who({ rating: 749, dupr: 299, dob: "1991-10-13" }), r)))
      .toEqual(["rating:min:750", "dupr:min:300", "age:min:35"]);
    expect(blocks(personFailures(who({ rating: 1050, dupr: 401, dob: "1976-10-12" }), r)))
      .toEqual(["rating:max:1049", "dupr:max:400", "age:max:49"]);
  });

  it("stores Under-17 as 16 and under", () => {
    const u17 = rules({ ageMax: 16, ageOn: "2026-10-12" });
    expect(personFailures(who({ dob: "2010-01-01" }), u17)).toEqual([]);
    expect(codes(personFailures(who({ dob: "2009-10-12" }), u17))).toEqual(["age:max:16"]);
  });

  it("fails an age rule with no date of birth, and flags it as missing", () => {
    const [f] = personFailures(who({ dob: null }), rules({ ageMin: 35, ageOn: "2026-10-12" }));
    expect(f).toMatchObject({ code: "age:min:35", missing: true, severity: "block" });
  });

  it("does not ask for a date of birth when there is no age rule", () => {
    /* The legacy checkEligibility demanded one for an empty age rule. */
    expect(personFailures(who({ dob: null }), rules({ gender: "F" }))).toEqual([]);
  });

  it("fails both age bounds for a date of birth after the counting day", () => {
    /* It used to give a negative age, which passed "N and under". */
    expect(codes(personFailures(who({ dob: "2027-01-01" }), rules({ ageMax: 16, ageOn: "2026-10-12" }))))
      .toEqual(["age:max:16"]);
  });

  it("says which day the age is counted on, when asked", () => {
    const [f] = personFailures(who({ dob: "1995-01-01" }), rules({ ageMin: 35, ageOn: "2026-10-12" }), { dated: true });
    expect(f.text).toBe("Age 35+ only (on 12 Oct 2026)");
  });

  it("keeps an unrated player out of an 'at least' category", () => {
    const fs = personFailures(who({ rating: null }), rules({ ratingMin: 900 }));
    expect(fs).toEqual([expect.objectContaining({ code: "rating:min:900:unrated", severity: "block", missing: true })]);
  });

  it("lets an unrated player into an 'up to' category, with a note for the organiser only", () => {
    /* Faisal, 2026-09-17: a newcomer belongs in the beginners' category. */
    const fs = personFailures(who({ rating: null }), rules({ ratingMax: 1049 }));
    expect(fs).toEqual([expect.objectContaining({ severity: "note", text: "Unrated: check this player's level" })]);
    expect(entryFailures([who({ rating: null })], rules({ ratingMax: 1049 }), { complete: true, minTeamSize: 2 }).ok).toBe(true);
  });

  it("fails BOTH DUPR bounds when no DUPR is given", () => {
    expect(blocks(personFailures(who({ dupr: null }), rules({ duprMin: 300 })))).toEqual(["dupr:min:300"]);
    expect(blocks(personFailures(who({ dupr: null }), rules({ duprMax: 400 })))).toEqual(["dupr:max:400"]);
  });

  it("fails a gender rule for a player with no gender chosen", () => {
    expect(personFailures(who({ gender: null }), rules({ gender: "M" }))[0])
      .toMatchObject({ code: "gender:M:missing", missing: true });
    expect(codes(personFailures(who({ gender: "F" }), rules({ gender: "M" })))).toEqual(["gender:M"]);
  });

  it("leaves Mixed to the team check, not to each player", () => {
    expect(personFailures(who({ gender: "M" }), rules({ gender: "MX" }))).toEqual([]);
  });
});

describe("a Mixed team", () => {
  const mx = rules({ gender: "MX" });
  const done = { complete: true, minTeamSize: 2 };

  it("needs at least one man and one woman", () => {
    expect(squadFailures(["M", "F"], mx, done)).toEqual([]);
    expect(codes(squadFailures(["M", "M"], mx, done))).toEqual(["team:mixed"]);
    expect(codes(squadFailures(["F", "F"], mx, done))).toEqual(["team:mixed"]);
    expect(codes(squadFailures(["M"], mx, done))).toEqual(["team:mixed"]);
  });

  it("is happy with any mix in a bigger team", () => {
    expect(squadFailures(["M", "M", "F"], mx, { complete: true, minTeamSize: 2 })).toEqual([]);
  });

  it("does not complain about a lone player while the organiser is still building the team", () => {
    const building = { complete: false, minTeamSize: 2 };
    expect(squadFailures(["M"], mx, building)).toEqual([]);
    expect(codes(squadFailures(["M", "M"], mx, building))).toEqual(["team:mixed"]);
    /* Past the minimum already — adding a player does not check squad size. */
    expect(codes(squadFailures(["M", "M", "M"], mx, building))).toEqual(["team:mixed"]);
  });

  it("stops the organiser on the squad the flags would mark, not on a bigger one", () => {
    /* A min-2, max-6 event. The check used to wait for six while the flags
       called the team complete at two, so the second man was added without a
       word and the card went red at once — with no waiver, and no way to give
       one, because nobody was ever asked. */
    const building = { complete: false, minTeamSize: 2 };
    expect(codes(squadFailures(["M", "M"], mx, building))).toEqual(["team:mixed"]);
    expect(squadIsComplete(2, 2)).toBe(true);
    /* One person is never a Mixed team, whatever the event's minimum says. */
    expect(squadIsComplete(1, 1)).toBe(false);
    expect(squadFailures(["M"], mx, { complete: false, minTeamSize: 1 })).toEqual([]);
    expect(squadIsComplete(2, 1)).toBe(true);
    /* A six-a-side event is not judged until it has six. */
    expect(squadFailures(["M", "M"], mx, { complete: false, minTeamSize: 6 })).toEqual([]);
    expect(codes(squadFailures(["M", "M", "M", "M", "M", "M"], mx, { complete: false, minTeamSize: 6 })))
      .toEqual(["team:mixed"]);
  });

  it("refuses a player with no gender chosen", () => {
    expect(codes(squadFailures(["M", null], mx, done))).toEqual(["team:mixed:missing"]);
  });

  it("means nothing for any other rule", () => {
    expect(squadFailures(["M", "M"], rules({ gender: "F" }), done)).toEqual([]);
    expect(squadFailures(["M", "M"], NO_RULES, done)).toEqual([]);
  });

  it("blocks the whole entry through entryFailures", () => {
    const v = entryFailures([who({ gender: "M" }), who({ gender: "M" })], mx, done);
    expect(v.ok).toBe(false);
    expect(codes(v.team)).toEqual(["team:mixed"]);
    expect(v.players).toEqual([[], []]);
  });
});

describe("what the organiser let in anyway", () => {
  it("keys a waiver on the rule and the player, never on the sentence", () => {
    const unrated = personFailures(who({ rating: null }), rules({ ratingMin: 1200 }))[0];
    const belowIt = personFailures(who({ rating: 850 }), rules({ ratingMin: 1200 }))[0];
    /* Two different sentences, one decision: the organiser was asked about
       Ravi against "Rating 1200+", and said let him in. */
    expect(unrated.text).not.toBe(belowIt.text);
    expect(waiverLine(unrated, "p-ravi")).toBe(waiverLine(belowIt, "p-ravi"));
    expect(waiverLine(unrated, "p-ravi")).toBe("rating:min:1200\tp-ravi");
  });

  it("does not carry over to another player, another bound, or another rule", () => {
    const f = personFailures(who({ rating: 850 }), rules({ ratingMin: 1200 }))[0];
    const tighter = personFailures(who({ rating: 850 }), rules({ ratingMin: 1500 }))[0];
    expect(waiverLine(f, "p-ravi")).not.toBe(waiverLine(f, "p-arjun"));
    expect(waiverLine(f, "p-ravi")).not.toBe(waiverLine(tighter, "p-ravi"));
    const noGender = personFailures(who({ gender: null }), rules({ gender: "F" }))[0];
    const wrongGender = personFailures(who({ gender: "M" }), rules({ gender: "F" }))[0];
    expect(waiverLine(noGender, "p-ravi")).toBe(waiverLine(wrongGender, "p-ravi"));
  });

  it("keys a team rule on the rule alone, because it belongs to no one player", () => {
    const f = squadFailures(["M", "M"], rules({ gender: "MX" }), { complete: true, minTeamSize: 2 })[0];
    expect(waiverLine(f, null)).toBe("team:mixed\t");
  });
});

describe("which rating counts", () => {
  const person = (over: Record<string, unknown>) => ({
    riseRatings: {}, matchCount: {}, seedSource: "default", ...over,
  }) as never;

  it("is nothing for a default seed nobody has played on", () => {
    expect(sportRating(person({ riseRatings: { "pb:md": 750 } }), "pb")).toBeNull();
  });

  it("counts a rating with matches behind it, over an unplayed default", () => {
    expect(sportRating(person({ riseRatings: { "pb:md": 750, "pb:mx": 600 }, matchCount: { "pb:mx": 3 } }), "pb")).toBe(600);
  });

  it("counts a seed someone placed on purpose, from a DUPR or an organiser", () => {
    expect(sportRating(person({ riseRatings: { "pb:md": 1125 }, seedSource: "dupr" }), "pb")).toBe(1125);
    expect(sportRating(person({ riseRatings: { "pb:md": 1000 }, seedSource: "organiser" }), "pb")).toBe(1000);
  });

  it("ignores every other sport, however strong", () => {
    expect(sportRating(person({ riseRatings: { "bd:md": 1400 }, matchCount: { "bd:md": 20 } }), "pb")).toBeNull();
  });

  it("takes the best format that counts", () => {
    expect(sportRating(person({ riseRatings: { "pb:md": 900, "pb:ms": 1100 }, matchCount: { "pb:md": 2, "pb:ms": 5 } }), "pb")).toBe(1100);
  });

  it("is nothing for nobody", () => {
    expect(sportRating(null, "pb")).toBeNull();
  });
});

describe("where the evidence comes from", () => {
  const stored = { dob: "1980-01-01", dupr: 420, riseRatings: { "pb:md": 900 }, matchCount: { "pb:md": 4 }, seedSource: "default" } as never;
  const declared = { name: "Ravi", gender: "M" as const, dob: null, dupr: null };

  it("uses what was declared for this team first", () => {
    const e = playerEvidence({ ...declared, dob: "1995-06-01", dupr: 300 }, stored, "pb", { useStored: true });
    expect(e).toMatchObject({ dob: "1995-06-01", dupr: 300, rating: 900 });
  });

  it("falls back to the person's stored record", () => {
    expect(playerEvidence(declared, stored, "pb", { useStored: true })).toMatchObject({ dob: "1980-01-01", dupr: 420 });
  });

  it("never reads the stored record from the public form — but still the rating", () => {
    /* No sign-in: typing someone else's phone must not borrow their DOB. */
    expect(playerEvidence(declared, stored, "pb", { useStored: false })).toMatchObject({ dob: null, dupr: null, rating: 900 });
  });

  it("carries out a declaration that contradicts the record, for the organiser to see", () => {
    const e = playerEvidence({ ...declared, dob: "2012-01-01", dupr: 300 }, stored, "pb", { useStored: true });
    expect(e).toMatchObject({ storedDob: "1980-01-01", storedDupr: 420 });
    /* An age rule then carries a NOTE beside the block-or-pass, never instead
       of it: the declaration still decides, and the organiser is told. */
    const fs = personFailures(e, rules({ ageMax: 16, ageOn: "2026-10-12" }));
    expect(blocks(fs)).toEqual([]);
    expect(codes(fs)).toEqual(["dob:mismatch"]);
    expect(fs[0].text).toBe("Date of birth typed here (1 Jan 2012) is not the one on file");
  });

  it("says nothing when the declaration agrees, or when there is no rule to judge", () => {
    expect(playerEvidence({ ...declared, dob: "1980-01-01", dupr: 420 }, stored, "pb", { useStored: true }))
      .toMatchObject({ storedDob: null, storedDupr: null });
    /* Never on the public form: what is on file for a number somebody typed is
       not theirs to be told. */
    expect(playerEvidence({ ...declared, dob: "2012-01-01" }, stored, "pb", { useStored: false }).storedDob).toBeNull();
    /* And no note where the rule does not read the field at all. */
    const e = playerEvidence({ ...declared, dob: "2012-01-01" }, stored, "pb", { useStored: true });
    expect(personFailures(e, rules({ gender: "M" }))).toEqual([]);
  });

  it("judges an organiser's new player on the level they are being given", () => {
    /* `addPlayer` creates the person a statement later and seeds them from this
       very form. Judged against "nobody by that number yet" the answer was
       "unrated", the organiser was waved through, and the card went red the
       instant the page re-rendered. */
    const e = playerEvidence({ ...declared, rating: 1300 }, null, "pb", { useStored: true });
    expect(e.rating).toBe(1300);
    expect(blocks(personFailures(e, rules({ ratingMax: 1049 })))).toEqual(["rating:max:1049"]);

    /* A person who already exists is judged on their own record, because the
       write does not re-seed them. */
    expect(playerEvidence({ ...declared, rating: 1300 }, stored, "pb", { useStored: true }).rating).toBe(900);
    /* An existing person with no rating stays unrated, for the same reason. */
    const fresh = { dob: null, dupr: null, riseRatings: {}, matchCount: {}, seedSource: "default" } as never;
    expect(playerEvidence({ ...declared, rating: 1300 }, fresh, "pb", { useStored: true }).rating).toBeNull();
  });
});

describe("what the entry form must ask for", () => {
  it("asks for nothing new in a category with no rules", () => {
    expect(needsFrom(NO_RULES)).toEqual({ gender: false, dob: false, dupr: false, phone: false });
  });

  it("asks for exactly what each rule needs", () => {
    expect(needsFrom(rules({ gender: "F" }))).toMatchObject({ gender: true, dob: false });
    expect(needsFrom(rules({ ageMin: 35, ageOn: "2026-10-12" }))).toMatchObject({ dob: true, phone: false });
    expect(needsFrom(rules({ duprMax: 400 }))).toMatchObject({ dupr: true, phone: false });
  });

  it("requires a phone exactly when there is a rating limit", () => {
    expect(needsFrom(rules({ ratingMax: 1049 })).phone).toBe(true);
    expect(needsFrom(rules({ ratingMin: 750 })).phone).toBe(true);
    expect(needsFrom(rules({ duprMin: 300, gender: "M" })).phone).toBe(false);
  });
});

describe("saying the rules back in plain words", () => {
  it("says a category is open when it has no rules", () => {
    expect(hasRules(NO_RULES)).toBe(false);
    expect(rulesSentence(NO_RULES)).toBe("Open: anyone can enter.");
    expect(ruleChips(NO_RULES)).toEqual([]);
  });

  it("matches the picture Faisal approved", () => {
    expect(rulesSentence(rules({ gender: "M", ageMin: 35, ageOn: "2026-10-12" })))
      .toBe("Men only. Age 35 or older on 12 Oct 2026.");
    expect(rulesSentence(rules({ ratingMax: 1049, duprMax: 400 })))
      .toBe("Rating 1049 or lower (up to Intermediate+). DUPR 4.00 or lower. A phone number is needed so we can find each player's rating.");
    expect(ruleChips(rules({ ratingMax: 1049, duprMax: 400 }))).toEqual(["Up to Intermediate+", "DUPR up to 4.00"]);
    expect(ruleChips(rules({ gender: "F" }))).toEqual(["Women only"]);
    expect(ruleChips(rules({ gender: "M", ageMin: 35, ageOn: "2026-10-12" }))).toEqual(["Men only", "35+"]);
  });

  it("names tiers only where a bound sits on a tier edge", () => {
    expect(ruleChips(rules({ ratingMin: 750, ratingMax: 1049 }))).toEqual(["Intermediate to Intermediate+"]);
    expect(ruleChips(rules({ ratingMin: 800 }))).toEqual(["Rating 800+"]);
    expect(rulesSentence(rules({ ratingMin: 1050 }))).toContain("Rating 1050 or higher (Advanced and above).");
  });

  it("describes every starting point", () => {
    for (const p of PRESETS) {
      const r = rules({ ...p.rules, ...(p.rules.ageMin != null || p.rules.ageMax != null ? { ageOn: "2026-10-12" } : {}) });
      expect(rulesSentence(r), p.id).toBeTruthy();
    }
    expect(ruleChips(rules({ ageMax: 16, ageOn: "2026-10-12" }))).toEqual(["16 and under"]);
    expect(rulesSentence(rules({ gender: "MX" }))).toBe("At least one man and one woman per team.");
  });

  it("reads a category row", () => {
    expect(rulesOfDivision({
      genderRule: "F", ageMin: null, ageMax: null, ageOn: null,
      ratingMin: null, ratingMax: 1049, duprMin: null, duprMax: null,
    })).toEqual(rules({ gender: "F", ratingMax: 1049 }));
  });
});

describe("reading the organiser's form", () => {
  const ctx = { maxTeamSize: 2 };

  it("turns a filled form into rules", () => {
    const res = parseRules({ gender: "M", ageMin: "35", ageOn: "2026-10-12", duprMin: "3.5" }, ctx);
    expect(res).toEqual({ ok: true, rules: rules({ gender: "M", ageMin: 35, ageOn: "2026-10-12", duprMin: 350 }) });
  });

  it("turns an empty form into no rules at all", () => {
    expect(parseRules({}, ctx)).toEqual({ ok: true, rules: NO_RULES });
  });

  it("refuses a minimum above its maximum rather than swapping them", () => {
    const res = parseRules({ ageMin: "40", ageMax: "30", ageOn: "2026-10-12" }, ctx);
    expect(res.ok).toBe(false);
    expect(!res.ok && res.problems.map((p) => p.message)).toContain("Youngest age is above oldest age.");
    expect(parseRules({ ratingMin: "1200", ratingMax: "900" }, ctx).ok).toBe(false);
    expect(parseRules({ duprMin: "4.5", duprMax: "3.5" }, ctx).ok).toBe(false);
  });

  it("refuses an age limit with no day to count on", () => {
    const res = parseRules({ ageMin: "35" }, ctx);
    expect(!res.ok && res.problems.map((p) => p.message)).toContain("Choose the date ages are counted on.");
  });

  it("refuses a DUPR off the scale and a date that does not exist", () => {
    expect(parseRules({ duprMax: "9" }, ctx).ok).toBe(false);
    expect(parseRules({ ageMin: "18", ageOn: "2026-02-30" }, ctx).ok).toBe(false);
  });

  it("refuses Mixed for a singles event", () => {
    expect(parseRules({ gender: "MX" }, { maxTeamSize: 1 }).ok).toBe(false);
    expect(parseRules({ gender: "MX" }, { maxTeamSize: 2 }).ok).toBe(true);
  });

  it("drops a counting day that no age rule uses", () => {
    expect(parseRules({ ageOn: "2026-10-12" }, ctx)).toEqual({ ok: true, rules: NO_RULES });
  });
});
