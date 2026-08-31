import "server-only";

/* Turning an approved entry into a team that can play.
 *
 * This is where the registration page pays for itself. The registrant typed
 * their own name and phone; approval matches that phone to a PERSON, so someone
 * who has played before arrives carrying their RISE Rating with no organiser
 * data entry at all. Before this existed, every rating started from scratch
 * unless an organiser typed the number themselves.
 *
 * Everything is one transaction: an approval either produces a complete team or
 * changes nothing. A half-approved entry — team created, players missing — is
 * the kind of mess that is easier to prevent than to find. */

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  players, registrationPlayers, registrations, teams, tournaments,
  type Registration,
} from "@/lib/db/schema";
import { findOrCreatePerson, carriedRating } from "@/lib/people";
import { ratingFormatFor } from "@/lib/rating/tournament";
import { ratingKey } from "@/lib/sports/registry";

const TEAM_COLOURS = [
  "#2450c8", "#c98d1c", "#07705b", "#ab1730",
  "#5f28c4", "#a85400", "#0b6f68", "#a8256e",
];

export type ApproveResult =
  | { ok: true; teamId: string; linked: number; carried: number }
  | { ok: false; error: string };

/**
 * Approve an entry: create the team, its players, and link each player to a
 * person by phone.
 *
 * @param decidedBy the organiser's user id, recorded for the audit trail
 */
export async function approveRegistration(
  registrationId: string,
  decidedBy?: string | null,
): Promise<ApproveResult> {
  const [reg] = await db.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  if (!reg) return { ok: false, error: "That entry no longer exists." };
  if (reg.status === "approved") return { ok: false, error: "That entry is already approved." };

  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, reg.tournamentId)).limit(1);
  if (!t) return { ok: false, error: "Tournament not found." };

  const entrants = await db
    .select()
    .from(registrationPlayers)
    .where(eq(registrationPlayers.registrationId, reg.id));
  if (entrants.length === 0) return { ok: false, error: "That entry has no players." };

  const existingTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.tournamentId, t.id));
  const roster = await db.select().from(players).where(eq(players.tournamentId, t.id));

  /* The rating bucket is decided by the squad this entry would ADD, not by the
     roster as it stands — approving the first doubles pair into an empty event
     would otherwise be filed as singles. */
  const format = ratingFormatFor([
    ...roster,
    ...entrants.map((e) => ({ teamId: "pending", gender: e.gender }) as never),
  ]);
  const formatKey = ratingKey(t.sport, format);

  const teamId = randomUUID();
  let linked = 0;
  let carriedIn = 0;

  /* People are found or created BEFORE the transaction: `findOrCreatePerson`
     does its own writes, and nesting them inside would hold the team insert
     open across several round trips for no benefit. An orphaned person with no
     player is harmless; a team with no players is not. */
  const resolved = await Promise.all(
    entrants.map(async (e) => {
      if (!e.phone) return { entrant: e, personId: null, rating: null };
      const { person, created } = await findOrCreatePerson({
        name: e.name,
        gender: e.gender,
        phone: e.phone,
        formatKey,
      });
      if (!created) carriedIn++;
      linked++;
      return { entrant: e, personId: person.id, rating: carriedRating(person, t.sport, format) };
    }),
  );

  await db.transaction(async (tx) => {
    await tx.insert(teams).values({
      id: teamId,
      tournamentId: t.id,
      name: reg.teamName,
      /* Arrival order, as before. "Seed by RISE Rating" on the manage page is
         what replaces it with a skill order, deliberately as a separate act. */
      seed: existingTeams.length + 1,
      colour: TEAM_COLOURS[existingTeams.length % TEAM_COLOURS.length],
    });

    await tx.insert(players).values(
      resolved.map((r) => ({
        id: randomUUID(),
        tournamentId: t.id,
        teamId,
        personId: r.personId,
        name: r.entrant.name,
        gender: r.entrant.gender,
        ratings: r.rating == null ? {} : { [formatKey]: r.rating },
      })),
    );

    /* Write the person back onto the entry, so the organiser can see who was
       matched and the link survives if the player row is later removed. */
    for (const r of resolved) {
      if (!r.personId) continue;
      await tx
        .update(registrationPlayers)
        .set({ personId: r.personId })
        .where(eq(registrationPlayers.id, r.entrant.id));
    }

    await tx
      .update(registrations)
      .set({ status: "approved", teamId, decidedAt: new Date(), note: null })
      .where(eq(registrations.id, reg.id));
  });

  void decidedBy;
  return { ok: true, teamId, linked, carried: carriedIn };
}

/**
 * Decline or withdraw an entry.
 *
 * A state, never a delete: an organiser needs to see who applied and what
 * happened to them, and a registrant asking "did you get my entry?" deserves an
 * answer better than silence.
 */
export async function setRegistrationStatus(
  registrationId: string,
  status: Extract<Registration["status"], "declined" | "withdrawn" | "pending">,
  note?: string | null,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [reg] = await db.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  if (!reg) return { ok: false, error: "That entry no longer exists." };

  /* Un-approving would leave a team and players behind with no entry pointing
     at them. Removing the team is the organiser's call on the Players tab, not
     a side effect of changing a status here. */
  if (reg.status === "approved") {
    return { ok: false, error: "This entry is already a team — remove the team first." };
  }

  await db
    .update(registrations)
    .set({ status, decidedAt: new Date(), note: note?.trim() || null })
    .where(eq(registrations.id, registrationId));
  return { ok: true };
}

/** Mark an entry paid, unpaid or waived. The app records money, never moves it. */
export async function setPaymentState(
  registrationId: string,
  state: Registration["paymentState"],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [reg] = await db.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  if (!reg) return { ok: false, error: "That entry no longer exists." };

  await db
    .update(registrations)
    .set({ paymentState: state, paidAt: state === "paid" ? new Date() : null })
    .where(eq(registrations.id, registrationId));
  return { ok: true };
}
