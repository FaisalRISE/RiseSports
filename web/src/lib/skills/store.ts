import "server-only";

/* Reading and writing peer ratings.
 *
 * The averages are computed from the rows on every read rather than kept on the
 * person. Same argument as the podium: a stored average cannot be corrected,
 * cannot drop a rater who was removed, and cannot tell you what it was made of.
 * Thirteen skills over a few dozen raters is a small sum.
 */

import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { people, skillEndorsements, skillRatings, type EndorsementPolicy } from "@/lib/db/schema";
import { skillsFor, tagsFor, type SportId } from "@/lib/sports/registry";
import { mayRate, type RatePermission } from "./eligibility";

export const MIN_SCORE = 1;
export const MAX_SCORE = 5;
export const DEFAULT_SCORE = 3;

export type SkillAverage = {
  skill: string;
  /** Mean of every rater's score, one decimal. Null when nobody has rated it. */
  score: number | null;
  raters: number;
};

export type SkillProfile = {
  sport: SportId;
  skills: SkillAverage[];
  /** How many DIFFERENT people have rated any skill. */
  raters: number;
  tags: { tag: string; count: number }[];
};

/** Average per skill, plus the tag tally, for one person in one sport. */
export async function skillProfile(
  subjectPersonId: string,
  sport: SportId,
): Promise<SkillProfile> {
  const [rows, tagRows] = await Promise.all([
    db
      .select()
      .from(skillRatings)
      .where(and(eq(skillRatings.subjectPersonId, subjectPersonId), eq(skillRatings.sport, sport))),
    db
      .select()
      .from(skillEndorsements)
      .where(
        and(
          eq(skillEndorsements.subjectPersonId, subjectPersonId),
          eq(skillEndorsements.sport, sport),
        ),
      ),
  ]);

  const bySkill = new Map<string, number[]>();
  for (const r of rows) {
    const list = bySkill.get(r.skill) ?? [];
    list.push(r.score);
    bySkill.set(r.skill, list);
  }

  /* Driven by the REGISTRY's list, not by what happens to be in the table, so
     every axis of the chart is present even when nobody has rated it — a radar
     missing three of its thirteen points is a different shape, not a gap. */
  const skills = skillsFor(sport).map((skill) => {
    const scores = bySkill.get(skill) ?? [];
    return {
      skill,
      score: scores.length
        ? Math.round((scores.reduce((s, n) => s + n, 0) / scores.length) * 10) / 10
        : null,
      raters: scores.length,
    };
  });

  const tally = new Map<string, number>();
  for (const t of tagRows) tally.set(t.tag, (tally.get(t.tag) ?? 0) + 1);

  return {
    sport,
    skills,
    /* Everyone who has said ANYTHING — scores or tags. Counting only scorers
       made a tags-only profile print "not rated yet" directly above a row of
       chips. */
    raters: new Set([
      ...rows.map((r) => r.raterPersonId),
      ...tagRows.map((r) => r.raterPersonId),
    ]).size,
    tags: [...tally.entries()]
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag)),
  };
}

/** What this rater said last time, so the form opens on their own answers. */
export async function myRatings(
  subjectPersonId: string,
  raterPersonId: string,
  sport: SportId,
): Promise<{ scores: Record<string, number>; tags: string[] }> {
  const [rows, tagRows] = await Promise.all([
    db
      .select()
      .from(skillRatings)
      .where(
        and(
          eq(skillRatings.subjectPersonId, subjectPersonId),
          eq(skillRatings.raterPersonId, raterPersonId),
          eq(skillRatings.sport, sport),
        ),
      ),
    db
      .select()
      .from(skillEndorsements)
      .where(
        and(
          eq(skillEndorsements.subjectPersonId, subjectPersonId),
          eq(skillEndorsements.raterPersonId, raterPersonId),
          eq(skillEndorsements.sport, sport),
        ),
      ),
  ]);
  return {
    scores: Object.fromEntries(rows.map((r) => [r.skill, r.score])),
    tags: tagRows.map((t) => t.tag),
  };
}

export type SaveResult = { ok: true; skills: number; tags: number } | { ok: false; reason: string };

const REFUSAL: Record<string, string> = {
  anonymous: "Tell us who you are first.",
  self: "You cannot rate yourself.",
  "not-played": "You can rate someone once you have played with or against them.",
};

/**
 * Record one person's view of another.
 *
 * ── Every write goes through the same gate ───────────────────────────────
 * The screen hides the form when it is not allowed, and that is a courtesy, not
 * the control. This function re-asks `mayRate` for itself, because a Server
 * Action is a public endpoint and "the button was not on the page" stops
 * nobody.
 *
 * ── Replacing, not adding ────────────────────────────────────────────────
 * A rater who rates the same skill twice OVERWRITES their earlier answer —
 * `onConflictDoUpdate` against the unique index. That is what makes the average
 * a count of people rather than of submissions, and it is the whole reason the
 * rows are kept individually instead of folded into a running mean.
 *
 * Skills not named are left ALONE rather than reset, so a partial form cannot
 * wipe an earlier answer.
 */
export async function saveSkillRating(input: {
  subjectPersonId: string;
  raterPersonId: string | null;
  sport: SportId;
  scores: Record<string, number>;
  tags: string[];
}): Promise<SaveResult> {
  const permission: RatePermission = await mayRate(input.raterPersonId, input.subjectPersonId);
  if (!permission.allowed) {
    return { ok: false, reason: REFUSAL[permission.reason] ?? "Not allowed." };
  }
  const rater = input.raterPersonId!;

  /* Only skills and tags this sport actually has. A crafted post naming
     "Bandeja" on a chess profile writes nothing. */
  const allowedSkills = new Set(skillsFor(input.sport));
  const allowedTags = new Set(tagsFor(input.sport));

  const scores = Object.entries(input.scores).filter(
    ([skill, score]) =>
      allowedSkills.has(skill) &&
      Number.isInteger(score) &&
      score >= MIN_SCORE &&
      score <= MAX_SCORE,
  );
  const tags = [...new Set(input.tags)].filter((t) => allowedTags.has(t));

  await db.transaction(async (tx) => {
    for (const [skill, score] of scores) {
      await tx
        .insert(skillRatings)
        .values({
          id: randomUUID(),
          subjectPersonId: input.subjectPersonId,
          raterPersonId: rater,
          sport: input.sport,
          skill,
          score,
        })
        .onConflictDoUpdate({
          target: [
            skillRatings.subjectPersonId,
            skillRatings.raterPersonId,
            skillRatings.sport,
            skillRatings.skill,
          ],
          set: { score, updatedAt: new Date() },
        });
    }

    /* Tags are a set, so this rater's selection REPLACES their previous one —
       un-ticking has to mean something. Scoped to this rater and sport, so it
       cannot touch anybody else's endorsements. */
    await tx
      .delete(skillEndorsements)
      .where(
        and(
          eq(skillEndorsements.subjectPersonId, input.subjectPersonId),
          eq(skillEndorsements.raterPersonId, rater),
          eq(skillEndorsements.sport, input.sport),
        ),
      );
    if (tags.length) {
      await tx.insert(skillEndorsements).values(
        tags.map((tag) => ({
          id: randomUUID(),
          subjectPersonId: input.subjectPersonId,
          raterPersonId: rater,
          sport: input.sport,
          tag,
        })),
      );
    }
  });

  return { ok: true, skills: scores.length, tags: tags.length };
}

/**
 * Which sports this person has been rated in, for the picker.
 *
 * Ordered, and over BOTH tables. Without the ORDER BY Postgres is free to
 * return the rows in any order, so the profile's default sport — `already[0]` —
 * could differ between two loads of the same page and the chart would change
 * sport on a refresh. And reading only `skillRatings` made a sport with
 * endorsements but no scores unreachable through the picker.
 */
export async function ratedSports(subjectPersonId: string): Promise<SportId[]> {
  const [scored, tagged] = await Promise.all([
    db
      .select({ sport: skillRatings.sport })
      .from(skillRatings)
      .where(eq(skillRatings.subjectPersonId, subjectPersonId))
      .orderBy(skillRatings.sport),
    db
      .select({ sport: skillEndorsements.sport })
      .from(skillEndorsements)
      .where(eq(skillEndorsements.subjectPersonId, subjectPersonId))
      .orderBy(skillEndorsements.sport),
  ]);
  return [...new Set([...scored, ...tagged].map((r) => r.sport))].sort();
}

/** Record who this person is willing to be rated and endorsed by. */
export async function setEndorsementPolicy(
  personId: string,
  policy: EndorsementPolicy,
): Promise<void> {
  await db.update(people).set({ endorsementPolicy: policy }).where(eq(people.id, personId));
}

/** Remove a rater's whole view of somebody — used when a profile is merged. */
export async function clearRatingsBy(raterPersonId: string, subjectPersonIds: string[]) {
  if (subjectPersonIds.length === 0) return;
  await db
    .delete(skillRatings)
    .where(
      and(
        eq(skillRatings.raterPersonId, raterPersonId),
        inArray(skillRatings.subjectPersonId, subjectPersonIds),
      ),
    );
}
