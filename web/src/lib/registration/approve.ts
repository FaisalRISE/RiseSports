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
import { and, asc, eq, isNull, ne } from "drizzle-orm";
import { db } from "@/lib/db";
import {
  divisions, people, players, registrationPlayers, registrations, teams, tournaments,
  type Registration,
} from "@/lib/db/schema";
import { divisionsOf, resolveDivisionId } from "@/lib/divisions";
import { findOrCreatePerson, carriedRating, normalisePhone, peopleByPhones } from "@/lib/people";
import { entryFailures, hasRules, rulesOfDivision } from "@/lib/eligibility";
import { entrantEvidence } from "@/lib/registration";
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
  opts: { tournamentId?: string } = {},
): Promise<ApproveResult> {
  const [reg] = await db.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  if (!reg) return { ok: false, error: "That entry no longer exists." };
  /* The organiser's action names the event it was pressed in. An entry id from
     another event must not be approvable from this one's screen. */
  if (opts.tournamentId && reg.tournamentId !== opts.tournamentId) {
    return { ok: false, error: "That entry is not part of this event." };
  }
  if (reg.status === "approved") return { ok: false, error: "That entry is already approved." };
  /* Only a WAITING entry can be approved. The screen only ever offers Approve
     on one, but a stale page on a second phone, or a direct call, could approve
     a declined entry — and once the same phone has entered again, bringing the
     old one back to life collides with `registrations_one_live_per_phone`
     inside the transaction below and throws. */
  if (reg.status !== "pending") {
    return { ok: false, error: `That entry was ${reg.status}. Ask them to enter again.` };
  }

  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, reg.tournamentId)).limit(1);
  if (!t) return { ok: false, error: "Tournament not found." };

  /* In the order they were typed, so "the first player" below means the first
     player on the form and not whichever row the database returned first. */
  const entrants = await db
    .select()
    .from(registrationPlayers)
    .where(eq(registrationPlayers.registrationId, reg.id))
    .orderBy(asc(registrationPlayers.position));
  if (entrants.length === 0) return { ok: false, error: "That entry has no players." };

  /* ── Which category, and does the entry still fit it? ─────────────────
     An entry whose category has since been removed (the link is set null on
     delete) used to fall back silently to the event's first category — so a
     Women's Doubles pair could land in Men's Doubles because somebody tidied
     up the list. With more than one category left that is a guess, and the
     organiser is the one who should make it. */
  if (!reg.divisionId && (await divisionsOf(t.id)).length > 1) {
    return {
      ok: false,
      error: "This entry's category was removed. Decline it, or ask them to enter again.",
    };
  }
  const divisionId = await resolveDivisionId(t.id, reg.divisionId);
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId)).limit(1);
  const rules = division ? rulesOfDivision(division) : null;

  /* The rules are checked AGAIN here, and before anybody is created. The entry
     fitted when it was submitted, but the organiser may have tightened the
     category since — and approval is the last moment to say so rather than
     flagging a team that already exists.
     Stored records count here, unlike on the public form: this is the organiser
     acting, and a returning player's known rating is exactly what a rating
     limit is about. For a date of birth or a DUPR the DECLARED value still
     wins (`playerEvidence`) — neither is proof, and the later one is usually
     the correction — but where the two disagree the organiser is told, so a
     rule is never judged on a date the app itself contradicts. */
  if (rules && hasRules(rules)) {
    const known = await peopleByPhones(entrants.map((e) => e.phone));
    /* Judged the way it will be STORED — one person per phone number. See
       `entrantEvidence`; the approvals list builds it with the same call. */
    const squad = entrantEvidence(entrants, known, t.sport, normalisePhone);
    const verdict = entryFailures(squad, rules, { complete: true, minTeamSize: t.minTeamSize, dated: true });
    if (!verdict.ok) {
      const who = verdict.players
        .map((fs, i) => {
          const texts = fs.filter((f) => f.severity === "block").map((f) => f.text);
          return texts.length ? `${entrants[i].name} (${texts.join(", ")})` : null;
        })
        .filter(Boolean);
      const team = verdict.team.filter((f) => f.severity === "block").map((f) => f.text);
      return {
        ok: false,
        error: `Can't approve into ${division!.name}: ${[...who, ...team].join(" · ")}`,
      };
    }
  }

  const existingTeams = await db.select({ id: teams.id }).from(teams).where(eq(teams.tournamentId, t.id));
  const roster = await db.select().from(players).where(eq(players.tournamentId, t.id));

  /* The rating bucket is decided by the squad this entry would ADD, not by the
     roster as it stands — approving the first doubles pair into an empty event
     would otherwise be filed as singles. */
  const format = ratingFormatFor([
    ...roster,
    ...entrants.map((e) => ({ teamId: "pending", gender: e.gender }) as never),
  ], t.minTeamSize);
  const formatKey = ratingKey(t.sport, format);

  const teamId = randomUUID();
  let linked = 0;
  let carriedIn = 0;

  /* People are found or created BEFORE the transaction: `findOrCreatePerson`
     does its own writes, and nesting them inside would hold the team insert
     open across several round trips for no benefit. An orphaned person with no
     player is harmless; a team with no players is not.

     ONE AT A TIME, not a Promise.all over the entrants. Firing every lookup
     together meant each asked "is this phone known?" before any of them had
     created anyone, so a pair who gave the same contact number raced each other
     into a duplicate-key error. It was also a fan-out that grows with the entry
     — the shape that took the site down on 2026-09-15 — and twelve sequential
     round trips is nothing. `db-fanout.test.ts` keeps it this way. */
  const resolved: { entrant: (typeof entrants)[number]; personId: string | null; rating: number | null }[] = [];
  const seen = new Set<string>();
  for (const e of entrants) {
    if (!e.phone) {
      resolved.push({ entrant: e, personId: null, rating: null });
      continue;
    }

    /* A number already used by an earlier player on THIS entry leaves the later
       player unlinked. Linking both would put one person on a team twice, and
       every match that team plays would then write two rating rows for the same
       match, person and format — refused by the unique index, and a rating
       failure on score save is only logged, so the team's ratings would quietly
       stop moving. The first player keeps the link; the organiser can see the
       second is unlinked and fix the phone. */
    const key = normalisePhone(e.phone);
    if (key && seen.has(key)) {
      resolved.push({ entrant: e, personId: null, rating: null });
      continue;
    }
    if (key) seen.add(key);

    const { person, created } = await findOrCreatePerson({
      name: e.name,
      gender: e.gender,
      phone: e.phone,
      formatKey,
    });
    if (!created) carriedIn++;
    linked++;
    resolved.push({ entrant: e, personId: person.id, rating: carriedRating(person, t.sport, format) });
  }

  const claimed = await db.transaction(async (tx) => {
    /* Claim the entry FIRST, conditionally. The check at the top of this
       function reads the status outside any transaction, so two approvals of
       the same entry — a double tap, or two organisers on two phones — both saw
       "pending" and both built a team. This update succeeds for exactly one of
       them: on Postgres the second waits for the first to commit and then finds
       the row no longer pending, so it matches nothing and writes nothing.
       `= 'pending'` rather than `<> 'approved'`, so a declined entry can never
       be claimed either. */
    const won = await tx
      .update(registrations)
      .set({ status: "approved", decidedAt: new Date(), note: null })
      .where(and(eq(registrations.id, reg.id), eq(registrations.status, "pending")))
      .returning({ id: registrations.id });
    if (won.length === 0) return false;

    await tx.insert(teams).values({
      id: teamId,
      tournamentId: t.id,
      divisionId,
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
        /* What was declared, carried onto the player row, so the "doesn't fit"
           flags on the manage screen judge the same evidence approval just
           did — and never have to match players back to the entry by name. */
        dob: r.entrant.dob,
        dupr: r.entrant.dupr,
      })),
    );

    /* A declared date of birth fills a person's record only where it has
       none. Never overwrites: a returning player's stored date may have come
       from an organiser who checked it, and an entry form typed by anybody
       should not be able to change it. One at a time — at most twelve. */
    for (const r of resolved) {
      if (!r.personId || !r.entrant.dob) continue;
      await tx
        .update(people)
        .set({ dob: r.entrant.dob })
        .where(and(eq(people.id, r.personId), isNull(people.dob)));
    }

    /* Write the person back onto the entry, so the organiser can see who was
       matched and the link survives if the player row is later removed. */
    for (const r of resolved) {
      if (!r.personId) continue;
      await tx
        .update(registrationPlayers)
        .set({ personId: r.personId })
        .where(eq(registrationPlayers.id, r.entrant.id));
    }

    /* Pointed at the team only now that the team exists. */
    await tx.update(registrations).set({ teamId }).where(eq(registrations.id, reg.id));
    return true;
  });

  if (!claimed) return { ok: false, error: "That entry is already approved." };

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
  opts: { tournamentId?: string } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [reg] = await db.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  if (!reg) return { ok: false, error: "That entry no longer exists." };
  /* Same scoping as approval: decided from THIS event's screen, or not at all. */
  if (opts.tournamentId && reg.tournamentId !== opts.tournamentId) {
    return { ok: false, error: "That entry is not part of this event." };
  }

  /* Un-approving would leave a team and players behind with no entry pointing
     at them. Removing the team is the organiser's call on the Players tab, not
     a side effect of changing a status here. */
  const alreadyTeam = { ok: false as const, error: "This entry is already a team — remove the team first." };
  if (reg.status === "approved") return alreadyTeam;

  /* The same guard again in the WHERE, not only in the read above: a decline
     arriving just after an approval committed would otherwise overwrite
     "approved" and leave a team with an entry that says it was turned down. */
  const changed = await db
    .update(registrations)
    .set({ status, decidedAt: new Date(), note: note?.trim() || null })
    .where(and(eq(registrations.id, registrationId), ne(registrations.status, "approved")))
    .returning({ id: registrations.id });
  if (changed.length === 0) return alreadyTeam;
  return { ok: true };
}

/** Mark an entry paid, unpaid or waived. The app records money, never moves it. */
export async function setPaymentState(
  registrationId: string,
  state: Registration["paymentState"],
  opts: { tournamentId?: string } = {},
): Promise<{ ok: true } | { ok: false; error: string }> {
  const [reg] = await db.select().from(registrations).where(eq(registrations.id, registrationId)).limit(1);
  if (!reg) return { ok: false, error: "That entry no longer exists." };
  if (opts.tournamentId && reg.tournamentId !== opts.tournamentId) {
    return { ok: false, error: "That entry is not part of this event." };
  }

  await db
    .update(registrations)
    .set({ paymentState: state, paidAt: state === "paid" ? new Date() : null })
    .where(eq(registrations.id, registrationId));
  return { ok: true };
}
