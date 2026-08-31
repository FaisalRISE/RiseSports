import { describe, it, expect } from "vitest";
import { validScore, carryScale, capDelta, repeatDamping } from "./apply";
import { resolveRules } from "@/lib/scoring/rules";

/* The trust machinery, tested on its own.
 *
 * These four rules are what stand between "a rating you can seed a draw from"
 * and "a number two friends can farm on a Tuesday". They are pure so they can
 * be pinned here; the database wiring around them is covered by e2e. */

const pb11 = resolveRules("pb", undefined);            // to 11, win by 2, no cap
const bd21 = resolveRules("bd", undefined);            // to 21, win by 2, cap 30

describe("validScore — spec §8", () => {
  /* "An invalid score must not silently produce a rating change." */
  it("accepts a legal win", () => {
    expect(validScore(pb11, 11, 4)).toBe(true);
    expect(validScore(pb11, 13, 11)).toBe(true);
  });

  it("rejects a winner who never reached the target", () => {
    expect(validScore(pb11, 9, 2)).toBe(false);
  });

  it("rejects a one-point win where two are required", () => {
    expect(validScore(pb11, 11, 10)).toBe(false);
  });

  it("rejects a draw or a losing 'winner'", () => {
    expect(validScore(pb11, 7, 7)).toBe(false);
    expect(validScore(pb11, 4, 11)).toBe(false);
  });

  /* Badminton caps at 30, where a one-point win is legal precisely because the
     cap forced it. Rejecting 30-29 would throw away real results. */
  it("allows the one-point finish the cap forces", () => {
    expect(validScore(bd21, 30, 29)).toBe(true);
    expect(validScore(bd21, 31, 29)).toBe(false);
  });

  /* Tennis and padel are scored in games and sets, which this engine does not
     model — validating them against a points target would reject everything. */
  it("falls back to 'winner scored more' where there are no rules", () => {
    expect(validScore(null, 3, 1)).toBe(true);
    expect(validScore(null, 1, 3)).toBe(false);
  });
});

describe("carryScale — spec §6.1, the doubles carry problem", () => {
  const favoured = 0.8;

  it("damps the WEAKER partner of a lopsided favoured winning pair", () => {
    expect(carryScale([600, 1200], 0, favoured, true)).toBe(0.7);
    expect(carryScale([600, 1200], 1, favoured, true)).toBe(1);
  });

  it("finds the weaker partner whichever side they are listed on", () => {
    expect(carryScale([1200, 600], 1, favoured, true)).toBe(0.7);
    expect(carryScale([1200, 600], 0, favoured, true)).toBe(1);
  });

  /* "Losses are never scaled — you keep full downside." Damping a loss would
     let a weak player hide behind a strong partner in both directions. */
  it("never scales a loss", () => {
    expect(carryScale([600, 1200], 0, favoured, false)).toBe(1);
  });

  it("does nothing when the partners are close", () => {
    expect(carryScale([900, 1000], 0, favoured, true)).toBe(1);
  });

  /* An underdog pair winning is exactly what SHOULD move rating, however
     mismatched they are — the guard is about unearned gains, not big gaps. */
  it("does nothing when the pair was not favoured", () => {
    expect(carryScale([600, 1200], 0, 0.4, true)).toBe(1);
  });

  it("does not apply to singles", () => {
    expect(carryScale([600], 0, favoured, true)).toBe(1);
  });
});

describe("capDelta — spec §8 daily cap", () => {
  it("lets an ordinary day through untouched", () => {
    expect(capDelta(0, 30)).toBe(30);
    expect(capDelta(-20, -30)).toBe(-30);
  });

  /* The cap bounds the DAY, not the match: six games must not move someone 360
     points while each one looks compliant on its own. */
  it("bounds the day, not the match", () => {
    expect(capDelta(50, 30)).toBe(10);
    expect(capDelta(60, 30)).toBe(0);
    expect(capDelta(-55, -30)).toBe(-5);
  });

  /* Caught a real bug: this returned −10, so a player already past the cap had
     a WIN pull their rating DOWN to meet it. The cap stops further movement; it
     does not claw back what is already applied. */
  it("refuses further movement rather than reversing it", () => {
    expect(capDelta(70, 10)).toBe(0);
    expect(capDelta(-70, -10)).toBe(0);
  });

  it("still allows a move back towards zero", () => {
    expect(capDelta(60, -20)).toBe(-20);
  });
});

describe("repeatDamping — spec §8 repeat opponents", () => {
  it("leaves the first two meetings alone", () => {
    expect(repeatDamping(0)).toBe(1);
    expect(repeatDamping(1)).toBe(1);
  });

  /* "Third and subsequent meeting inside 30 days" — two prior meetings means
     this one is the third. */
  it("damps from the third meeting", () => {
    expect(repeatDamping(2)).toBe(0.6);
    expect(repeatDamping(9)).toBe(0.6);
  });
});
