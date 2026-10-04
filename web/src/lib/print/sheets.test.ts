import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { RulesLine } from "./sheets";
import type { Tournament } from "@/lib/db/schema";

/* The rules line printed on every group sheet — "so a paper sheet is enough to
 * settle an argument". Read off the element rather than rendered: it is one
 * <div> of text. */

const text = (el: ReactElement | null) =>
  ([] as unknown[]).concat((el?.props as { children?: unknown } | undefined)?.children ?? []).join("");
const event = (over: Partial<Tournament>) =>
  ({ sport: "pb", format: "standard", scoring: null, ...over }) as Tournament;

describe("the rules line on a printed sheet", () => {
  /* A set number of boards is not a points game: printed as "One game to 25",
     the sheet settled the argument the wrong way. */
  it("says a carrom event over a set number of boards is played over them", () => {
    const line = text(RulesLine({ tournament: event({ sport: "cr", scoring: { boards: 8 } }) }));
    expect(line).toBe("8 boards. Most points after the last board wins; a level score is a draw in a group.");
  });

  it("still gives a points game its target", () => {
    expect(text(RulesLine({ tournament: event({ sport: "cr" }) }))).toContain("One game to 25.");
    expect(text(RulesLine({ tournament: event({}) }))).toContain("One game to 11.");
  });
});
