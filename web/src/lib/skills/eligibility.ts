import "server-only";

/* Who is allowed to rate you.
 *
 * Faisal, 2026-09-15: "only people who have played against you and or with you
 * or in your network (a feature to be added later) will be able to rate you and
 * endorse your skills."
 *
 * So the rule is SHARED A COURT — either side of the net. A partner is included
 * deliberately: they have the best view of your third shot of anyone in the
 * building, and "with you" is in the sentence above. The network half is not
 * built yet and is not faked here; when it arrives it becomes a second way to
 * qualify, not a replacement for this one.
 *
 * ── What "played" means ──────────────────────────────────────────────────
 * A match that has been SCORED. A fixture on the order of play is two names on
 * a sheet — nobody has seen anybody play yet, and a draw published a week early
 * would otherwise open up ratings for matches that have not happened.
 *
 * ── Both halves of the app count ─────────────────────────────────────────
 * Tournament matches are between TEAMS, so sharing a court is derived from the
 * teams each person was in. Community matches store person ids directly in
 * their line-ups. Most people's evidence is on the community side — that is
 * where most play happens — so leaving it out would have made this feature look
 * broken for exactly the people using the app most.
 *
 * ── The honest limit ─────────────────────────────────────────────────────
 * This answers "may THIS PERSON rate that one". Whether the browser asking is
 * really that person is the `rs_me` cookie's problem, and it is a name badge
 * rather than a credential until sign-in lands (lib/community/me.ts). The guard
 * is written to be right the day it can be trusted; today it stops an honest
 * mistake and a casual stranger, not a determined one.
 */

import { and, eq, inArray, isNotNull, or, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { communityMatches, matches, players } from "@/lib/db/schema";

/** A match nobody has scored yet is not evidence that anybody played. */
const SCORED = sql`(${matches.typedScoreA} is not null or jsonb_array_length(${matches.log}) > 0)`;

/** Every person this one has shared a court with, from tournament play. */
async function tournamentOpponents(personId: string): Promise<Set<string>> {
  const mine = await db
    .select({ teamId: players.teamId })
    .from(players)
    .where(and(eq(players.personId, personId), isNotNull(players.teamId)));
  const myTeams = [...new Set(mine.map((r) => r.teamId).filter((x): x is string => !!x))];
  if (myTeams.length === 0) return new Set();

  const played = await db
    .select({ a: matches.teamAId, b: matches.teamBId })
    .from(matches)
    .where(
      and(
        SCORED,
        or(inArray(matches.teamAId, myTeams), inArray(matches.teamBId, myTeams)),
      ),
    );

  /* Both sides of every match they were in: the opposition, and their own team
     — which is where partners come from. */
  const teamIds = new Set<string>();
  for (const m of played) {
    if (m.a) teamIds.add(m.a);
    if (m.b) teamIds.add(m.b);
  }
  if (teamIds.size === 0) return new Set();

  const people = await db
    .select({ personId: players.personId })
    .from(players)
    .where(and(inArray(players.teamId, [...teamIds]), isNotNull(players.personId)));

  const out = new Set(people.map((r) => r.personId!).filter(Boolean));
  out.delete(personId);
  return out;
}

/** The same, from community play, where line-ups are person ids already. */
async function communityOpponents(personId: string): Promise<Set<string>> {
  const rows = await db
    .select({ a: communityMatches.lineupA, b: communityMatches.lineupB })
    .from(communityMatches)
    .where(
      and(
        /* Scored, for the same reason as above. */
        isNotNull(communityMatches.scoreA),
        sql`(${communityMatches.lineupA} || ${communityMatches.lineupB}) @> ${JSON.stringify([personId])}::jsonb`,
      ),
    );

  const out = new Set<string>();
  for (const r of rows) {
    for (const id of [...(r.a ?? []), ...(r.b ?? [])]) out.add(id);
  }
  out.delete(personId);
  return out;
}

/** Everyone who has shared a court with this person, from either side. */
export async function courtMates(personId: string): Promise<Set<string>> {
  const [a, b] = await Promise.all([
    tournamentOpponents(personId),
    communityOpponents(personId),
  ]);
  for (const id of b) a.add(id);
  return a;
}

export type RatePermission =
  | { allowed: true }
  | { allowed: false; reason: "self" | "not-played" | "anonymous" };

/**
 * May `rater` rate `subject`?
 *
 * Deliberately returns WHY, so the screen can say "play them first" rather than
 * hiding a control with no explanation — a missing button is a bug report.
 */
export async function mayRate(
  raterPersonId: string | null,
  subjectPersonId: string,
): Promise<RatePermission> {
  if (!raterPersonId) return { allowed: false, reason: "anonymous" };
  if (raterPersonId === subjectPersonId) return { allowed: false, reason: "self" };
  const mates = await courtMates(subjectPersonId);
  return mates.has(raterPersonId) ? { allowed: true } : { allowed: false, reason: "not-played" };
}
