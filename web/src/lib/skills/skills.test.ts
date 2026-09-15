import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { SkillRadar } from "@/components/SkillRadar";
import { skillsFor, tagsFor, canonicalTag, SPORTS, type SportId } from "@/lib/sports/registry";
import type { SkillAverage } from "./store";

/* The store and the eligibility rule both talk to the database, so they are
 * covered end to end in `e2e/skills.mjs` — a unit test with a stubbed database
 * would only prove the stub agrees with itself, and the thing worth proving is
 * that somebody who has not played you cannot rate you.
 *
 * What IS unit-testable is the part with no database in it: the chart's
 * geometry, the registry's shape, and the migration that closes the tables. */

describe("every sport has a full set of axes", () => {
  it("thirteen skills, so the chart is the same shape for everyone", () => {
    for (const id of Object.keys(SPORTS) as SportId[]) {
      expect(skillsFor(id)).toHaveLength(13);
      expect(new Set(skillsFor(id)).size).toBe(13);
    }
  });

  it("and fifteen tags", () => {
    for (const id of Object.keys(SPORTS) as SportId[]) {
      expect(tagsFor(id)).toHaveLength(15);
      expect(new Set(tagsFor(id)).size).toBe(15);
    }
  });
});

const axes = (scores: (number | null)[]): SkillAverage[] =>
  scores.map((score, i) => ({ skill: `S${i}`, score, raters: score == null ? 0 : 1 }));

/** Pull the points out of a rendered polygon. */
function polygons(el: React.ReactElement): string[] {
  const out: string[] = [];
  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    if (Array.isArray(node)) return node.forEach(walk);
    const n = node as { type?: unknown; props?: Record<string, unknown> };
    if (n.type === "polygon" && typeof n.props?.points === "string") out.push(n.props.points);
    if (n.props?.children) walk(n.props.children);
  };
  walk(el);
  return out;
}

describe("the radar's geometry", () => {
  it("draws nothing for fewer than three axes", () => {
    expect(SkillRadar({ skills: axes([3, 4]) })).toBeNull();
  });

  it("puts one point on the chart per skill", () => {
    const el = SkillRadar({ skills: axes(Array(13).fill(3)) })!;
    const shape = polygons(el).at(-1)!;
    expect(shape.split(" ")).toHaveLength(13);
  });

  it("draws an unrated axis at the centre rather than dropping it", () => {
    /* Twelve points make a different shape from thirteen, and a reader cannot
       tell a missing axis from a weak one unless the axis is still drawn. */
    const el = SkillRadar({ skills: axes([5, null, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5]) })!;
    const shape = polygons(el).at(-1)!;
    expect(shape.split(" ")).toHaveLength(13);
  });

  it("scales with the score: a 5 sits further out than a 1", () => {
    const at = (score: number) => {
      const el = SkillRadar({ skills: axes([score, ...Array(12).fill(3)]) })!;
      const [x, y] = polygons(el).at(-1)!.split(" ")[0].split(",").map(Number);
      return { x, y };
    };
    /* The first axis points straight up, so a bigger score means a SMALLER y. */
    expect(at(5).y).toBeLessThan(at(1).y);
  });

  it("clamps a score outside the scale instead of drawing off the chart", () => {
    const el = SkillRadar({ skills: axes([99, ...Array(12).fill(3)]) })!;
    const [, y] = polygons(el).at(-1)!.split(" ")[0].split(",").map(Number);
    const top = SkillRadar({ skills: axes([5, ...Array(12).fill(3)]) })!;
    const [, ty] = polygons(top).at(-1)!.split(" ")[0].split(",").map(Number);
    expect(y).toBeCloseTo(ty, 5);
  });

  it("draws no shape at all when nothing has been rated", () => {
    const el = SkillRadar({ skills: axes(Array(13).fill(null)) })!;
    /* Only the five background rings, and no filled polygon. */
    expect(polygons(el)).toHaveLength(5);
  });

  it("adds the comparison shape when one is given", () => {
    const withCompare = SkillRadar({
      skills: axes(Array(13).fill(3)),
      compare: { S0: 5, S1: 1 },
    })!;
    expect(polygons(withCompare)).toHaveLength(7);   // 5 rings + compare + shape
  });
});

describe("the migration closes the tables it opens", () => {
  /* CLAUDE.md, learned the hard way: drizzle-kit does NOT generate RLS, a new
     table defaults to it OFF, and Supabase grants `anon` full CRUD on
     everything in `public`. The window between CREATE and ENABLE is a window
     where the published anon key can write. */
  const sql = fs.readFileSync(
    path.resolve(process.cwd(), "drizzle/0014_easy_guardian.sql"),
    "utf8",
  );

  for (const table of ["skill_ratings", "skill_endorsements"]) {
    it(`${table} has row-level security turned on in the same file`, () => {
      expect(sql).toContain(`CREATE TABLE "${table}"`);
      expect(sql).toMatch(
        new RegExp(`ALTER TABLE "${table}" ENABLE ROW LEVEL SECURITY`, "i"),
      );
    });
  }

  it("refuses a score outside the scale at the database, not only in code", () => {
    expect(sql).toMatch(/CHECK \("score" BETWEEN 1 AND 5\)/i);
  });

  it("refuses a self-rating at the database too", () => {
    expect(sql.match(/rater_person_id" <> "subject_person_id/g) ?? []).toHaveLength(2);
  });

  it("keeps one rating per rater per skill", () => {
    expect(sql).toMatch(
      /CREATE UNIQUE INDEX "skill_ratings_one_per_rater_idx"[\s\S]*?"subject_person_id","rater_person_id","sport","skill"/,
    );
  });
});

describe("the tag vocabulary", () => {
  /* Renamed 2026-09-15, while endorsements were still on one profile card and
     nowhere else — the last moment it was cheap. Rows store the tag TEXT, so
     drizzle/0015 moves the ones already saved. */
  it("no longer ships a tag that reads as a complaint", () => {
    for (const id of Object.keys(SPORTS) as SportId[]) {
      expect(tagsFor(id)).not.toContain("Serial Lobber");
    }
    expect(tagsFor("pb")).toContain("Lob Specialist");
  });

  it("no longer ships a gendered one, in any sport", () => {
    for (const id of Object.keys(SPORTS) as SportId[]) {
      expect(tagsFor(id)).not.toContain("Comeback King");
      expect(tagsFor(id)).toContain("Comeback Artist");
    }
  });

  it("still reads an old row written before the rename", () => {
    expect(canonicalTag("Serial Lobber")).toBe("Lob Specialist");
    expect(canonicalTag("Comeback King")).toBe("Comeback Artist");
    expect(canonicalTag("Dink Master")).toBe("Dink Master");
  });

  it("moves the rows that were already saved", () => {
    const sql = fs.readFileSync(
      path.resolve(process.cwd(), "drizzle/0015_rapid_kang.sql"),
      "utf8",
    );
    expect(sql).toMatch(/UPDATE "skill_endorsements" SET "tag" = 'Lob Specialist'/);
    expect(sql).toMatch(/UPDATE "skill_endorsements" SET "tag" = 'Comeback Artist'/);
    /* And an index a (sport, tag) search can actually use. */
    expect(sql).toMatch(/CREATE INDEX "skill_endorsements_tag_idx"[\s\S]*?"sport","tag"/);
  });
});
