import "server-only";

/* Who is allowed to rate you.
 *
 * Faisal, 2026-09-15: "we can have a setting in a player's profile to receive
 * endorsement from his connected networks, players played with or vs, or from
 * anyone. So the player himself/herself will set the criteria."
 *
 * So the rule is NOT the app's to fix — each person chooses it, and
 * `people.endorsementPolicy` holds their answer:
 *
 *   "played"   the default. Shared a court, either side of the net. A partner
 *              counts deliberately: they have the best view of your third shot
 *              of anyone in the building, and "with or vs" says so.
 *   "anyone"   any identified person but yourself.
 *   "network"  people you are connected to. Connections do not exist yet, so
 *              this currently qualifies nobody — which is honest rather than
 *              convenient, and is why the form shows it greyed. The day
 *              connections land, `networkOf` is the only thing to write.
 *
 * The default is "played" because it is the middle setting and the one nobody
 * has to think about.
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
import { communityMatches, matches, people, players } from "@/lib/db/schema";

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
  | { allowed: false; reason: "self" | "not-played" | "not-connected" | "anonymous" };

/**
 * Who this person is connected to.
 *
 * A placeholder with an honest answer rather than a guess: connections are not
 * built, so nobody is connected to anybody. It is a function rather than an
 * inlined empty set so that the day the feature lands there is exactly one
 * place to change, and `mayRate` already calls it.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function networkOf(personId: string): Promise<Set<string>> {
  return new Set();
}

/**
 * May `rater` rate `subject`?
 *
 * The SUBJECT's setting decides, and it is read here rather than passed in —
 * a caller that could supply the policy is a caller that could supply the wrong
 * one, and this is the gate every write goes through.
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

  const [subject] = await db
    .select({ policy: people.endorsementPolicy })
    .from(people)
    .where(eq(people.id, subjectPersonId))
    .limit(1);
  /* A person who is not there cannot be rated. Failing CLOSED on a missing row
     rather than falling through to the permissive branch. */
  if (!subject) return { allowed: false, reason: "not-played" };

  if (subject.policy === "anyone") return { allowed: true };

  if (subject.policy === "network") {
    const net = await networkOf(subjectPersonId);
    return net.has(raterPersonId) ? { allowed: true } : { allowed: false, reason: "not-connected" };
  }

  const mates = await courtMates(subjectPersonId);
  return mates.has(raterPersonId) ? { allowed: true } : { allowed: false, reason: "not-played" };
}
