import { describe, it, expect } from "vitest";
import {
  localISO, fromISO, sessionDates, prettyDate, prettyDays,
  capacityOf, ageOn, eligibilityFailures, restrictionChips, isUnrestricted,
  priceLabel, slugifyGame,
} from "./index";
import { NO_RESTRICTIONS, type Restrictions } from "@/lib/db/schema";

const restrict = (over: Partial<Restrictions>): Restrictions => ({ ...NO_RESTRICTIONS, ...over });

const player = (over: Partial<Parameters<typeof eligibilityFailures>[0]> = {}) => ({
  gender: "M" as const, dob: null, riseBest: 800, dupr: null, ...over,
});

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
  const on = new Date(2026, 8, 14);

  it("lets anyone into a game with no restrictions", () => {
    expect(eligibilityFailures(player(), NO_RESTRICTIONS, on)).toEqual([]);
    expect(eligibilityFailures(player(), null, on)).toEqual([]);
  });

  it("reports every failure at once, not just the first", () => {
    const fails = eligibilityFailures(
      player({ gender: "F", riseBest: 400 }),
      restrict({ gender: "M", gsrMin: 600, ageMin: 18 }),
      on,
    );
    expect(fails).toHaveLength(3);
    expect(fails.join(" | ")).toContain("Men only");
    expect(fails.join(" | ")).toContain("Rating 600+");
    expect(fails.join(" | ")).toContain("Age 18+");
  });

  it("fails an age rule when the date of birth is unknown", () => {
    /* Deliberate: an organiser who set an age limit has not had it verified,
       and failing open admits exactly the people the rule excludes. */
    expect(eligibilityFailures(player({ dob: null }), restrict({ ageMin: 18 }), on))
      .toEqual(["Age 18+ only"]);
  });

  it("passes an age rule once the date of birth satisfies it", () => {
    expect(eligibilityFailures(player({ dob: "1994-03-21" }), restrict({ ageMin: 18, ageMax: 45 }), on))
      .toEqual([]);
  });

  it("treats an unrated player as 0, so a minimum excludes them", () => {
    expect(eligibilityFailures(player({ riseBest: null }), restrict({ gsrMin: 600 }), on))
      .toEqual(["Rating 600+ only"]);
  });

  it("reads DUPR in hundredths", () => {
    expect(eligibilityFailures(player({ dupr: 350 }), restrict({ duprMin: 400 }), on))
      .toEqual(["DUPR 4.00+ only"]);
    expect(eligibilityFailures(player({ dupr: 450 }), restrict({ duprMin: 400 }), on)).toEqual([]);
  });

  it("accepts someone exactly on both bounds", () => {
    expect(eligibilityFailures(player({ riseBest: 600 }), restrict({ gsrMin: 600, gsrMax: 600 }), on))
      .toEqual([]);
  });

  /* The two behaviours that changed when community play moved onto the shared
     checker in lib/eligibility (2026-09-17). Both used to let the wrong person
     in; both are pinned so neither comes back. */
  it("fails an age rule for a date of birth that is not a real date", () => {
    /* `fromISO` used to roll 1994-13-45 over into a real date in 1995. */
    expect(eligibilityFailures(player({ dob: "1994-13-45" }), restrict({ ageMin: 18 }), on))
      .toEqual(["Age 18+ only"]);
  });

  it("fails an 'and under' rule for a date of birth after the day of play", () => {
    /* That used to give a negative age, and -1 is "16 and under". */
    expect(eligibilityFailures(player({ dob: "2027-01-01" }), restrict({ ageMax: 16 }), on))
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
});

describe("slugifyGame", () => {
  it("makes a URL key from a name", () => {
    expect(slugifyGame("Thursday Night Pickleball!")).toBe("thursday-night-pickleball");
  });

  it("falls back rather than producing an empty key", () => {
    expect(slugifyGame("!!!")).toBe("game");
  });
});
