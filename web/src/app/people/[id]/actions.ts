"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { myPersonId } from "@/lib/community/me";
import { saveSkillRating, setHideTags, MIN_SCORE, MAX_SCORE } from "@/lib/skills/store";
import { skillsFor, tagsFor, SPORTS, type SportId } from "@/lib/sports/registry";

/* Rating somebody's skills.
 *
 * The rater is read from the COOKIE and never from the form. A person id in a
 * hidden field would let anyone rate as anyone — the same rule the community
 * actions follow, and for the same reason: a form field is something every
 * caller can change. */

const sportSchema = z.string().refine((s): s is SportId => s in SPORTS);

export type RateResult = { ok: true; message: string } | { ok: false; error: string };

export async function rateSkills(
  subjectPersonId: string,
  formData: FormData,
): Promise<RateResult> {
  const subject = z.string().min(1).max(64).parse(subjectPersonId);
  const sport = sportSchema.parse(formData.get("sport"));

  /* Only the names this sport has. Reading them from the registry rather than
     from the form is what stops a crafted post inventing a skill. */
  const scores: Record<string, number> = {};
  for (const skill of skillsFor(sport)) {
    const raw = formData.get(`skill:${skill}`);
    if (raw == null) continue;
    const n = Number(raw);
    if (Number.isInteger(n) && n >= MIN_SCORE && n <= MAX_SCORE) scores[skill] = n;
  }

  const tags = tagsFor(sport).filter((t) => formData.get(`tag:${t}`) === "on");

  const me = await myPersonId();
  const res = await saveSkillRating({
    subjectPersonId: subject,
    raterPersonId: me,
    sport,
    scores,
    tags,
  });

  if (!res.ok) return { ok: false, error: res.reason };

  revalidatePath(`/people/${subject}`);
  return {
    ok: true,
    message:
      res.skills === 0 && res.tags === 0
        ? "Nothing to save."
        : `Saved — ${res.skills} skill${res.skills === 1 ? "" : "s"}` +
          (res.tags ? ` and ${res.tags} tag${res.tags === 1 ? "" : "s"}` : "") +
          ". Rating again replaces what you said, it does not add to it.",
  };
}

/**
 * Switch your own endorsements off everywhere but your profile.
 *
 * Only for YOURSELF: the person id comes from the cookie and the form's subject
 * has to match it, so this cannot be used to silence somebody else's profile.
 * That check is as strong as the cookie is, which is a name badge until sign-in
 * lands — but the rule is written to be right the day it can be trusted, and it
 * is the only control anybody has over a label another player chose for them.
 */
export async function setTagVisibility(
  subjectPersonId: string,
  hide: boolean,
): Promise<RateResult> {
  const subject = z.string().min(1).max(64).parse(subjectPersonId);
  const me = await myPersonId();
  if (!me || me !== subject) return { ok: false, error: "You can only change your own." };

  await setHideTags(subject, hide);
  revalidatePath(`/people/${subject}`);
  revalidatePath("/people");
  return {
    ok: true,
    message: hide
      ? "Your endorsements are hidden from lists. They are still on your profile."
      : "Your endorsements are shown again.",
  };
}

/** Form-shaped wrapper: a `<form action>` must resolve to void. The page
 *  revalidates, so the flipped button label is the feedback. */
export async function toggleTagVisibility(subjectPersonId: string, hide: boolean): Promise<void> {
  await setTagVisibility(subjectPersonId, hide);
}
