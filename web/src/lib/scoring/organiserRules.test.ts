import { describe, it, expect } from "vitest";
import { buildScoring, resolveRules, goldenInfo } from "./rules";

/* The gap that let "to 15" play to 11.
 *
 * `buildScoring` and `resolveRules` were each well tested on their own, and the
 * bug lived in the seam: buildScoring uses the target to derive the golden
 * point and cap but does not RETURN it, so anything saving its output without
 * adding the target back gets the sport default instead. The manage screen said
 * "To 15" and the referee console ended the match 11-2.
 *
 * These tests compose the two, which is what the app actually does. */

/** Exactly what the organiser controls save — see setScoring. */
const asSaved = (
  target: number, winBy2: boolean, goldenAt: number | "auto" | "none",
  switchAt: number | null = null, scoreType: "service" | "rally" | "" = "",
) => ({ target, ...buildScoring(target, winBy2, goldenAt, switchAt, scoreType) });

describe("what the organiser sets is what gets played", () => {
  it("keeps the target through the round trip", () => {
    const rules = resolveRules("pb", asSaved(15, true, 17));
    expect(rules?.target).toBe(15);
  });

  it("does not silently fall back to the sport default", () => {
    /* Pickleball's own target is 11. A bare buildScoring result resolves to
       that, which is the bug — kept here so the reason is visible. */
    const withoutTarget = resolveRules("pb", buildScoring(15, true, 17, null));
    expect(withoutTarget?.target).toBe(11);

    const withTarget = resolveRules("pb", asSaved(15, true, 17));
    expect(withTarget?.target).toBe(15);
  });

  it("carries the whole Pickleboss rule set", () => {
    const r = resolveRules("pb", asSaved(15, true, 17));
    expect(r).toMatchObject({ target: 15, winBy: 2, golden: 17, cap: 18 });
  });

  it("makes a golden-point game end on the target", () => {
    const r = resolveRules("pb", asSaved(21, false, "auto"));
    expect(r).toMatchObject({ target: 21, winBy: 1, golden: 20, cap: 21 });
  });

  it("leaves no ceiling when the organiser asks for none", () => {
    const r = resolveRules("pb", asSaved(15, true, "none"));
    expect(r).toMatchObject({ target: 15, winBy: 2, golden: null, cap: null });
  });

  it("puts the ceiling two above on auto", () => {
    const r = resolveRules("pb", asSaved(15, true, "auto"));
    expect(r).toMatchObject({ target: 15, golden: 17, cap: 18 });
  });

  it("carries change-of-ends and the scoring type", () => {
    const r = resolveRules("pb", asSaved(15, true, 17, 8, "rally"));
    expect(r?.switchAt).toBe(8);
    expect(r?.sideOut).toBe(false);

    const service = resolveRules("bd", asSaved(21, true, "auto", null, "service"));
    expect(service?.sideOut).toBe(true);
  });

  it("leaves the sport's own serve model alone when no type is chosen", () => {
    /* Pickleball is side-out, badminton is rally. An organiser who does not
       touch the control must not have either overwritten. */
    expect(resolveRules("pb", asSaved(11, true, "auto"))?.sideOut).toBe(true);
    expect(resolveRules("bd", asSaved(21, true, "auto"))?.sideOut).toBe(false);
  });

  it("says in words exactly what it will do", () => {
    /* The sentence under the controls has to describe the rules that were
       actually saved, or it is worse than no sentence at all. */
    const words = goldenInfo(15, true, 17);
    const rules = resolveRules("pb", asSaved(15, true, 17));
    expect(words).toContain("To 15");
    expect(words).toContain(String(rules!.golden));
    expect(words).toContain(String(rules!.cap));
  });
});
