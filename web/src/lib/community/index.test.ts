import { describe, it, expect, vi, afterEach } from "vitest";
import {
  localISO, fromISO, sessionDates, todayWeekday, prettyDate, prettyDays,
  capacityOf, ageOn, communityVerdict, eligibilityFailures, restrictionChips, isUnrestricted,
  priceLabel, slugifyGame,
} from "./index";
import { NO_RESTRICTIONS, type Restrictions } from "@/lib/db/schema";

const restrict = (over: Partial<Restrictions>): Restrictions => ({ ...NO_RESTRICTIONS, ...over });

type Entrant = Parameters<typeof eligibilityFailures>[0];
/* `rating` is a PLAYED pickleball doubles rating — the evidence `sportRating`
   counts. Anything subtler (another sport, a default seed nobody has played
   on) is written out in the test that is about it. */
const player = (over: Partial<Entrant> & { rating?: number | null } = {}): Entrant => {
  const { rating = 800, ...rest } = over;
  return {
    gender: "M", dob: null, dupr: null, seedSource: "default",
    riseRatings: rating == null ? {} : { "pb:md": rating },
    matchCount: rating == null ? {} : { "pb:md": 5 },
    ...rest,
  };
};

/* ── The bug that is deliberately not ported ──────────────────────────────
 *
 * The legacy helper walks local midnights but stores `toISOString().slice(0,10)`.
 * East of UTC those are different days. These tests fail if anyone "simplifies"
 * localISO back to toISOString — which is the obvious-looking change, and the
 * reason this is pinned rather than trusted to a comment.
 *
 * Verified by breaking it: replacing localISO's body with
 * `d.toISOString().slice(0, 10)` fails four of the tests below under
 * TZ=Asia/Kolkata (the app's own users) and none under TZ=UTC — which is also
 * why a developer in London would never have caught this by hand. */
describe("local dates never go through UTC", () => {
  it("formats a local midnight as its own calendar day", () => {
    /* 00:00 on 14 Sep local. In IST that instant is 13 Sep 18:30 UTC. */
    const midnight = new Date(2026, 8, 14, 0, 0, 0, 0);
    expect(localISO(midnight)).toBe("2026-09-14");
  });

  it("formats late evening as the same day, not tomorrow", () => {
    /* The mirror case: west of UTC, 23:00 local is already tomorrow in UTC. */
    expect(localISO(new Date(2026, 8, 14, 23, 30))).toBe("2026-09-14");
  });

  it("round-trips through fromISO", () => {
    for (const iso of ["2026-01-01", "2026-09-14", "2026-12-31"]) {
      expect(localISO(fromISO(iso))).toBe(iso);
    }
  });

  it("agrees with the weekday the recurrence was matched on", () => {
    /* The actual defect: the day filter and the stored string must describe the
       SAME day. 14 Sep 2026 is a Monday. */
    const monday = new Date(2026, 8, 14, 0, 0, 0, 0);
    const dates = sessionDates({ freq: "weekly", days: [monday.getDay()] }, 3, monday);
    for (const iso of dates) {
      expect(fromISO(iso).getDay()).toBe(monday.getDay());
    }
    expect(dates[0]).toBe("2026-09-14");
  });
});

describe("sessionDates", () => {
  const monday = new Date(2026, 8, 14, 9, 0, 0);

  it("starts today when today is a playing day", () => {
    expect(sessionDates({ freq: "weekly", days: [1] }, 3, monday)).toEqual([
      "2026-09-14", "2026-09-21", "2026-09-28",
    ]);
  });

  it("runs every day for a daily game, ignoring days", () => {
    expect(sessionDates({ freq: "daily", days: [] }, 3, monday)).toEqual([
      "2026-09-14", "2026-09-15", "2026-09-16",
    ]);
  });

  it("interleaves two weekdays in date order", () => {
    /* Tue and Thu from a Monday. */
    expect(sessionDates({ freq: "weekly", days: [2, 4] }, 4, monday)).toEqual([
      "2026-09-15", "2026-09-17", "2026-09-22", "2026-09-24",
    ]);
  });

  it("returns nothing rather than hanging when no day is set", () => {
    /* A weekly game with an empty day list matches nothing. The guard has to
       stop the walk; without it this call never returns. */
    expect(sessionDates({ freq: "weekly", days: [] }, 6, monday)).toEqual([]);
  });

  it("crosses a month and a year boundary", () => {
    const dec31 = new Date(2026, 11, 31, 12, 0, 0); // a Thursday
    expect(sessionDates({ freq: "daily", days: [] }, 2, dec31)).toEqual(["2026-12-31", "2027-01-01"]);
  });
});

/* ── "Today" is India's today, wherever the server is ─────────────────────
 *
 * The live server runs in UTC. From 00:00 to 05:30 in India its date is still
 * yesterday, and every "today" worked out with its own clock was a day behind:
 * the session strip opened on a day that was over, and ages were counted on it.
 *
 * Every instant below is written in UTC so it names ONE moment on any machine.
 * 20:00 UTC on Monday 21 Sep is 01:30 on Tuesday the 22nd in India.
 *
 * Verified by breaking it: with the old code (the walk starting from the
 * server's own midnight, ages on `localISO(new Date())`) these fail under
 * TZ=UTC — where the live site runs — and pass under TZ=Asia/Kolkata, which is
 * why nobody testing on a laptop in India could have seen it. */
describe("today is India's today", () => {
  const afterMidnightInIndia = new Date("2026-09-21T20:00:00Z");

  afterEach(() => vi.useRealTimers());

  it("starts the session strip on India's date, not the server's", () => {
    expect(sessionDates({ freq: "daily", days: [] }, 2, afterMidnightInIndia))
      .toEqual(["2026-09-22", "2026-09-23"]);
  });

  it("does not offer a Monday game on a Monday that is already over in India", () => {
    expect(sessionDates({ freq: "weekly", days: [1] }, 1, afterMidnightInIndia)).toEqual(["2026-09-28"]);
    expect(sessionDates({ freq: "weekly", days: [2] }, 1, afterMidnightInIndia)).toEqual(["2026-09-22"]);
  });

  it("uses India's date when no clock is passed in — which is how the pages call it", () => {
    vi.useFakeTimers();
    vi.setSystemTime(afterMidnightInIndia);
    expect(sessionDates({ freq: "daily", days: [] }, 1)).toEqual(["2026-09-22"]);
    expect(todayWeekday()).toBe(2); // Tuesday
  });

  it("changes day at midnight in India, and not a minute before", () => {
    const daily = { freq: "daily" as const, days: [] };
    expect(sessionDates(daily, 1, new Date("2026-09-21T18:29:00Z"))).toEqual(["2026-09-21"]); // 23:59
    expect(sessionDates(daily, 1, new Date("2026-09-21T18:30:00Z"))).toEqual(["2026-09-22"]); // 00:00
  });

  it("counts a birthday on India's date", () => {
    /* 18 on the 22nd. At 01:30 that morning in India the server still says the
       21st, and used to call them 17. */
    const turning18 = player({ dob: "2008-09-22" });
    expect(ageOn("2008-09-22", afterMidnightInIndia)).toBe(18);
    vi.useFakeTimers();
    vi.setSystemTime(afterMidnightInIndia);
    expect(eligibilityFailures(turning18, restrict({ ageMin: 18 }), { sport: "pb" })).toEqual([]);
  });
});

describe("display", () => {
  it("names a date the way the session strip shows it", () => {
    expect(prettyDate("2026-09-14")).toBe("Mon 14 Sep");
  });

  it("lists the days a game runs, in week order", () => {
    expect(prettyDays({ freq: "weekly", days: [4, 2] })).toBe("Tue, Thu");
    expect(prettyDays({ freq: "daily", days: [] })).toBe("Every day");
    expect(prettyDays({ freq: "weekly", days: [] })).toBe("No days set");
  });

  it("shows a free game as free, not as zero rupees", () => {
    expect(priceLabel(0)).toBe("Free");
    expect(priceLabel(30000)).toBe("₹300");
    expect(priceLabel(25050)).toBe("₹250.50");
  });
});

describe("capacityOf", () => {
  it("multiplies courts by players per court", () => {
    expect(capacityOf({ courts: 2, perCourt: 4 })).toBe(8);
    expect(capacityOf({ courts: 1, perCourt: 2 })).toBe(2);
  });
});

describe("ageOn", () => {
  it("has not counted a birthday that has not happened yet this year", () => {
    expect(ageOn("2000-12-25", new Date(2026, 8, 14))).toBe(25);
  });

  it("counts it on the day itself", () => {
    expect(ageOn("2000-09-14", new Date(2026, 8, 14))).toBe(26);
  });

  it("is null when the date of birth is unknown", () => {
    expect(ageOn(null, new Date(2026, 8, 14))).toBeNull();
  });
});

describe("eligibilityFailures", () => {
  const pb = { sport: "pb" as const, on: new Date(2026, 8, 14) };

  it("lets anyone into a game with no restrictions", () => {
    expect(eligibilityFailures(player(), NO_RESTRICTIONS, pb)).toEqual([]);
    expect(eligibilityFailures(player(), null, pb)).toEqual([]);
  });

  it("reports every failure at once, not just the first", () => {
    const fails = eligibilityFailures(
      player({ gender: "F", rating: 400 }),
      restrict({ gender: "M", gsrMin: 600, ageMin: 18 }),
      pb,
    );
    expect(fails).toHaveLength(3);
    expect(fails.join(" | ")).toContain("Men only");
    expect(fails.join(" | ")).toContain("Rating 600+");
    expect(fails.join(" | ")).toContain("Age 18+");
  });

  it("fails an age rule when the date of birth is unknown", () => {
    /* Deliberate: an organiser who set an age limit has not had it verified,
       and failing open admits exactly the people the rule excludes. */
    expect(eligibilityFailures(player({ dob: null }), restrict({ ageMin: 18 }), pb))
      .toEqual(["Age 18+ only"]);
  });

  it("passes an age rule once the date of birth satisfies it", () => {
    expect(eligibilityFailures(player({ dob: "1994-03-21" }), restrict({ ageMin: 18, ageMax: 45 }), pb))
      .toEqual([]);
  });

  it("keeps an unrated player out of a minimum, and lets them under a maximum", () => {
    /* It used to read an unrated player as 0: the same outcomes, but "0" was a
       number nobody had. The note under a maximum goes to the host. */
    expect(eligibilityFailures(player({ rating: null }), restrict({ gsrMin: 600 }), pb))
      .toEqual(["Rating 600+ only (unrated)"]);
    expect(eligibilityFailures(player({ rating: null }), restrict({ gsrMax: 700 }), pb)).toEqual([]);
    expect(communityVerdict(player({ rating: null }), restrict({ gsrMax: 700 }), pb).notes)
      .toEqual(["Unrated: check this player's level"]);
  });

  it("judges the rating in THIS game's sport, not the best in any sport", () => {
    /* Faisal, 2026-09-21: "RiseR rating is specific to each sport." A strong
       badminton player who has never played pickleball is unrated at it. By
       `riseBest` they were kept out of a beginners' pickleball game and let
       into an advanced one. */
    const shuttler = player({ rating: null, riseRatings: { "bd:md": 1500 }, matchCount: { "bd:md": 20 } });
    expect(eligibilityFailures(shuttler, restrict({ gsrMin: 1200 }), pb)).toEqual(["Rating 1200+ only (unrated)"]);
    expect(eligibilityFailures(shuttler, restrict({ gsrMax: 1049 }), pb)).toEqual([]);
    /* And in a badminton game, their badminton rating is what counts. */
    expect(eligibilityFailures(shuttler, restrict({ gsrMax: 1049 }), { ...pb, sport: "bd" }))
      .toEqual(["Rating 1049 and under only"]);
  });

  it("treats a newcomer on the default starting rating as unrated", () => {
    /* Every entrant approval creates starts at 750 with no matches. That is a
       number the app wrote, not a level anybody showed — Faisal, 2026-09-21. It
       used to pass "600+" and fail "up to 700"; now it is the other way round,
       which is how tournaments have always treated them. */
    const newcomer = player({ rating: null, riseRatings: { "pb:md": 750 }, matchCount: {}, seedSource: "default" });
    expect(eligibilityFailures(newcomer, restrict({ gsrMin: 600 }), pb)).toEqual(["Rating 600+ only (unrated)"]);
    expect(eligibilityFailures(newcomer, restrict({ gsrMax: 700 }), pb)).toEqual([]);
    /* An organiser's deliberate placement IS a level, played or not. */
    const placed = { ...newcomer, seedSource: "organiser" as const };
    expect(eligibilityFailures(placed, restrict({ gsrMin: 600 }), pb)).toEqual([]);
  });

  it("reads DUPR in hundredths", () => {
    expect(eligibilityFailures(player({ dupr: 350 }), restrict({ duprMin: 400 }), pb))
      .toEqual(["DUPR 4.00+ only"]);
    expect(eligibilityFailures(player({ dupr: 450 }), restrict({ duprMin: 400 }), pb)).toEqual([]);
  });

  it("lets a player with no DUPR in, flagged for the host — unless the game is strict", () => {
    /* Faisal, 2026-09-21: "A player can join without DUPR based on organiser's
       discretion. we can highlight the same." A missing DUPR used to read as 0,
       which slipped under every "up to" limit without a word to anybody. */
    const lenient = restrict({ duprMax: 350 });
    expect(eligibilityFailures(player({ dupr: null }), lenient, pb)).toEqual([]);
    expect(communityVerdict(player({ dupr: null }), lenient, pb).notes).toEqual(["No DUPR"]);
    expect(eligibilityFailures(player({ dupr: null }), restrict({ duprMin: 350 }), pb)).toEqual([]);

    const strict = restrict({ duprMax: 350, duprStrict: true });
    expect(eligibilityFailures(player({ dupr: null }), strict, pb)).toEqual(["DUPR 3.50 and under only"]);
    /* A DUPR that is there is judged either way. */
    expect(eligibilityFailures(player({ dupr: 400 }), lenient, pb)).toEqual(["DUPR 3.50 and under only"]);
  });

  it("accepts someone exactly on both bounds", () => {
    expect(eligibilityFailures(player({ rating: 600 }), restrict({ gsrMin: 600, gsrMax: 600 }), pb))
      .toEqual([]);
  });

  /* The two behaviours that changed when community play moved onto the shared
     checker in lib/eligibility (2026-09-17). Both used to let the wrong person
     in; both are pinned so neither comes back. */
  it("fails an age rule for a date of birth that is not a real date", () => {
    /* `fromISO` used to roll 1994-13-45 over into a real date in 1995. */
    expect(eligibilityFailures(player({ dob: "1994-13-45" }), restrict({ ageMin: 18 }), pb))
      .toEqual(["Age 18+ only"]);
  });

  it("fails an 'and under' rule for a date of birth after the day of play", () => {
    /* That used to give a negative age, and -1 is "16 and under". */
    expect(eligibilityFailures(player({ dob: "2027-01-01" }), restrict({ ageMax: 16 }), pb))
      .toEqual(["Age 16 and under only"]);
  });
});

describe("restrictionChips", () => {
  it("is empty for an unrestricted game", () => {
    expect(restrictionChips(NO_RESTRICTIONS)).toEqual([]);
    expect(isUnrestricted(NO_RESTRICTIONS)).toBe(true);
  });

  it("collapses a pair of bounds into one range", () => {
    expect(restrictionChips(restrict({ gsrMin: 600, gsrMax: 900 }))).toEqual(["Rating 600–900"]);
  });

  it("states a single bound as a limit", () => {
    expect(restrictionChips(restrict({ gsrMin: 600 }))).toEqual(["Rating 600+"]);
    expect(restrictionChips(restrict({ gsrMax: 900 }))).toEqual(["Rating up to 900"]);
  });

  it("lists gender first, then rating, DUPR and age", () => {
    expect(restrictionChips(restrict({ gender: "F", gsrMin: 600, duprMax: 400, ageMin: 18 })))
      .toEqual(["Women only", "Rating 600+", "DUPR up to 4.00", "Age 18+"]);
  });

  it("says DUPR is required only where the game is strict AND has a DUPR limit", () => {
    expect(restrictionChips(restrict({ duprMax: 400, duprStrict: true }))).toEqual(["DUPR up to 4.00", "DUPR required"]);
    expect(restrictionChips(restrict({ duprMax: 400 }))).toEqual(["DUPR up to 4.00"]);
    /* Strict with nothing to be strict about is no limit at all. */
    expect(restrictionChips(restrict({ duprStrict: true }))).toEqual([]);
    expect(isUnrestricted(restrict({ duprStrict: true }))).toBe(true);
  });
});

describe("slugifyGame", () => {
  it("makes a URL key from a name", () => {
    expect(slugifyGame("Thursday Night Pickleball!")).toBe("thursday-night-pickleball");
  });

  it("falls back rather than producing an empty key", () => {
    expect(slugifyGame("!!!")).toBe("game");
  });
});
