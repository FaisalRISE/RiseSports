"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { myPersonId } from "@/lib/community/me";
import { saveSkillRating, setEndorsementPolicy, MIN_SCORE, MAX_SCORE } from "@/lib/skills/store";
import { skillsFor, tagsFor, SPORTS, type SportId } from "@/lib/sports/registry";
import type { EndorsementPolicy } from "@/lib/db/schema";

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
 * Choose who may rate and endorse you.
 *
 * Only for YOURSELF: the person id comes from the cookie and the subject has to
 * match it, so this cannot be used to open somebody else's profile up or close
 * it down. That check is as strong as the cookie is, which is a name badge
 * until sign-in lands — the rule is written to be right the day it can be
 * trusted.
 *
 * "network" is accepted and stored, and today qualifies nobody, because
 * connections do not exist yet. The form does not offer it for that reason;
 * a crafted post that sets it simply closes that person's ratings.
 */
export async function setPolicy(
  subjectPersonId: string,
  policy: EndorsementPolicy,
): Promise<void> {
  const subject = z.string().min(1).max(64).parse(subjectPersonId);
  const chosen = z.enum(["network", "played", "anyone"]).parse(policy);
  const me = await myPersonId();
  if (!me || me !== subject) return;

  await setEndorsementPolicy(subject, chosen);
  revalidatePath(`/people/${subject}`);
}
