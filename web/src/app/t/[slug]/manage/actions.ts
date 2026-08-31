"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq, inArray } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { groups, matches, people, players, ratingHistory, teams, tournaments } from "@/lib/db/schema";
import { principalFor } from "@/lib/auth/guard";
import { canManage, assert } from "@/lib/auth/policy";
import { planGroups, knockoutRefsFromGroups } from "@/lib/formats/pickleboss";
import { resolveRef } from "@/lib/brackets";
import { loadTournament, groupTables, refResolver } from "@/lib/tournamentState";
import { findOrCreatePerson, carriedRating, peopleForTournament, searchPeople } from "@/lib/people";
import { reliabilityForPerson } from "@/lib/rating/reliability";
import type { PickerResult } from "@/components/PersonPicker";
import { ratingFormatFor } from "@/lib/rating/tournament";
import { ratingKey } from "@/lib/sports/registry";

/* Same discipline as the scoring actions: load, authorize server-side, write.
 * With RISE_OPEN_ACCESS unset these assertions pass for everyone; with it set
 * to 0 they start refusing, without a line of this file changing. */

async function requireManager(tournamentId: string) {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!t) throw new Error("Tournament not found");
  assert(canManage(await principalFor(t.id)), "manage this tournament");
  return t;
}

const name = z.string().trim().min(1).max(60);

export async function addTeam(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) return;

  const existing = await db.select({ id: teams.id }).from(teams).where(eq(teams.tournamentId, t.id));
  const COLOURS = ["#2450c8", "#c98d1c", "#07705b", "#ab1730", "#5f28c4", "#a85400", "#0b6f68", "#a8256e"];

  await db.insert(teams).values({
    id: randomUUID(),
    tournamentId: t.id,
    name: parsed.data,
    seed: existing.length + 1,
    colour: COLOURS[existing.length % COLOURS.length],
  });
  revalidatePath(`/t/${t.slug}/manage`);
}

/**
 * Add a player, linking them to a PERSON so their rating follows them.
 *
 * Matching is by phone only. A name is not an identity — auto-merging two
 * "Rahul S" entries would fuse two people's ratings, and unpicking that is far
 * harder than tolerating a duplicate. Where an organiser wants to reuse someone
 * whose number they do not have, they pick from the roster search
 * (`personId` in the form) instead.
 *
 * No phone and no pick still works: the player exists, gets a rating inside
 * this event, and simply has nothing to carry it elsewhere.
 */
export async function addPlayer(tournamentId: string, teamId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const parsed = name.safeParse(formData.get("name"));
  const gender = formData.get("gender") === "F" ? "F" : "M";
  if (!parsed.success) return;

  const pickedId = String(formData.get("personId") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const duprRaw = String(formData.get("dupr") ?? "").trim();
  const bandRaw = String(formData.get("band") ?? "").trim();

  const roster = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const formatKey = ratingKey(t.sport, ratingFormatFor([...roster, { gender, teamId } as never]));

  let personId: string | null = null;
  let carried: number | null = null;

  if (pickedId) {
    const [existing] = await db.select().from(people).where(eq(people.id, pickedId)).limit(1);
    if (existing) {
      personId = existing.id;
      carried = carriedRating(existing, t.sport, ratingFormatFor(roster));
    }
  } else if (phone || duprRaw || bandRaw) {
    const dupr = duprRaw ? Number(duprRaw) : null;
    const band = bandRaw ? Number(bandRaw) : null;
    const { person } = await findOrCreatePerson({
      name: parsed.data,
      gender,
      phone: phone || null,
      dupr: Number.isFinite(dupr) && dupr! > 0 ? dupr : null,
      bandSeed: Number.isFinite(band) && band! > 0 ? band : null,
      formatKey,
      seededBy: t.ownerId,
    });
    personId = person.id;
    carried = carriedRating(person, t.sport, ratingFormatFor(roster));
  }

  await db.insert(players).values({
    id: randomUUID(),
    tournamentId: t.id,
    teamId,
    personId,
    name: parsed.data,
    gender,
    /* The rating they bring IN. The per-event view starts here; the person's
       own record is what actually moves. */
    ratings: carried == null ? {} : { [formatKey]: carried },
  });
  revalidatePath(`/t/${t.slug}/manage`);
}

/**
 * Seed the draw by RISE Rating instead of arrival order.
 *
 * This is the point of the whole rating: `planGroups` already snake-drafts from
 * `teams.seed`, so putting a skill order into that column is the entire change.
 * Left as an explicit action rather than done automatically — an organiser
 * knows things the number does not, and their manual order must not be silently
 * overwritten.
 *
 * Teams with nobody linked to a person sort last: no evidence is not the same
 * as a low rating, and burying them at the top of the draw would be worse than
 * leaving them at the bottom.
 */
export async function seedByRating(tournamentId: string) {
  const t = await requireManager(tournamentId);

  const rows = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const roster = await peopleForTournament(t.id);
  const teamRows = await db.select().from(teams).where(eq(teams.tournamentId, t.id));

  const strengthOf = (teamId: string): number | null => {
    const ids = rows.filter((p) => p.teamId === teamId && p.personId).map((p) => p.personId!);
    const ratings = ids
      .map((id) => roster.get(id)?.riseBest)
      .filter((r): r is number => typeof r === "number");
    if (ratings.length === 0) return null;
    return ratings.reduce((s, n) => s + n, 0) / ratings.length;
  };

  const ranked = teamRows
    .map((tm) => ({ id: tm.id, name: tm.name, strength: strengthOf(tm.id) }))
    .sort((a, b) => {
      if (a.strength == null && b.strength == null) return a.name.localeCompare(b.name);
      if (a.strength == null) return 1;
      if (b.strength == null) return -1;
      return b.strength - a.strength;
    });

  for (let i = 0; i < ranked.length; i++) {
    await db.update(teams).set({ seed: i + 1 }).where(eq(teams.id, ranked[i].id));
  }
  revalidatePath(`/t/${t.slug}/manage`);
}

export async function removePlayer(tournamentId: string, playerId: string) {
  const t = await requireManager(tournamentId);
  await db.delete(players).where(eq(players.id, playerId));
  revalidatePath(`/t/${t.slug}/manage`);
}

export async function addMatch(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const round = z.string().trim().min(1).max(40).catch("Round 1").parse(formData.get("round"));
  const a = String(formData.get("teamA") ?? "");
  const b = String(formData.get("teamB") ?? "");
  if (!a || !b || a === b) return;

  /* Seed the line-up with the team's squad in listed order. For the OSL format
     that IS the declared pair order (A1+A2, A3+A4, A5+A6), so a match is
     immediately scoreable and the organiser can reorder afterwards. */
  const squad = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const six = (teamId: string) => squad.filter((p) => p.teamId === teamId).slice(0, 6).map((p) => p.id);

  await db.insert(matches).values({
    id: randomUUID(),
    tournamentId: t.id,
    round,
    teamAId: a,
    teamBId: b,
    lineupA: six(a),
    lineupB: six(b),
    log: [],
    server: "a",
  });
  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
}

export async function removeMatch(tournamentId: string, matchId: string) {
  const t = await requireManager(tournamentId);
  await db.delete(matches).where(eq(matches.id, matchId));
  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
}

/** Reorder a side's line-up. In the OSL format this is the declared pair order,
 *  which Rules 3.2 fixes once play begins — so it is refused mid-match. */
export async function setLineup(tournamentId: string, matchId: string, side: "a" | "b", playerIds: string[]) {
  const t = await requireManager(tournamentId);
  const [m] = await db.select().from(matches).where(eq(matches.id, matchId)).limit(1);
  if (!m) return { ok: false as const, error: "Match not found." };
  if ((m.log ?? []).length > 0) {
    return { ok: false as const, error: "The order cannot change once play has begun (Rules 3.2)." };
  }

  await db
    .update(matches)
    .set(side === "a" ? { lineupA: playerIds } : { lineupB: playerIds })
    .where(eq(matches.id, matchId));

  revalidatePath(`/t/${t.slug}/manage`);
  return { ok: true as const };
}


/* ---------- group stage and knockout ---------- */

/**
 * Draw the teams into groups and generate every group fixture.
 *
 * Destructive by design: it clears any existing groups and their matches, so an
 * organiser who mis-set the group count can simply redraw. Knockout matches
 * (which have no groupId) are left alone.
 */
export async function generateGroups(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const count = z.coerce.number().int().min(1).max(8).catch(2).parse(formData.get("groups"));
  const courtNames = String(formData.get("courts") ?? "")
    .split(",").map((c) => c.trim()).filter(Boolean);

  const teamRows = await db.select().from(teams).where(eq(teams.tournamentId, t.id));
  if (teamRows.length < 2) return;

  const squads = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const six = (teamId: string) => squads.filter((p) => p.teamId === teamId).slice(0, 6).map((p) => p.id);

  const existing = await db.select({ id: groups.id }).from(groups).where(eq(groups.tournamentId, t.id));
  for (const g of existing) {
    await db.delete(matches).where(eq(matches.groupId, g.id));
  }
  await db.delete(groups).where(eq(groups.tournamentId, t.id));

  const seeded = [...teamRows].sort((a, b) => a.seed - b.seed);
  const plans = planGroups(seeded, count, courtNames);

  for (const [i, plan] of plans.entries()) {
    if (plan.entrants.length < 2) continue;
    const groupId = randomUUID();
    await db.insert(groups).values({
      id: groupId, tournamentId: t.id, key: plan.key,
      name: `Group ${plan.key}`, court: plan.court, position: i,
    });

    const rows = plan.rounds.flatMap((round, ri) =>
      round.map(([a, b]) => {
        const teamA = plan.entrants[a], teamB = plan.entrants[b];
        return {
          id: randomUUID(),
          tournamentId: t.id,
          groupId,
          round: `Group ${plan.key} · R${ri + 1}`,
          teamAId: teamA.id,
          teamBId: teamB.id,
          lineupA: six(teamA.id),
          lineupB: six(teamB.id),
          log: [] as never,
          server: "a" as const,
        };
      }),
    );
    if (rows.length) await db.insert(matches).values(rows);
  }

  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
}

/**
 * Create the knockout round from group placings, as seed references.
 *
 * The slots are NOT resolved to teams here — they are stored as "A1", "B2" and
 * fill themselves as each group finishes. That way a knockout can be drawn
 * before the group stage is over, and it can never be seeded from a half-played
 * table by mistake.
 */
export async function generateKnockout(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const perGroup = z.coerce.number().int().min(1).max(4).catch(2).parse(formData.get("qualify"));

  const groupRows = await db.select().from(groups).where(eq(groups.tournamentId, t.id));
  if (groupRows.length < 1) return;

  /* Replace any previous, unplayed knockout draw. A played one is left alone:
     redrawing over results would destroy them. */
  const existing = await db.select().from(matches).where(eq(matches.tournamentId, t.id));
  for (const m of existing) {
    if (m.groupId === null && (m.log as unknown[]).length === 0 && m.typedScoreA === null) {
      await db.delete(matches).where(eq(matches.id, m.id));
    }
  }

  const pairs = knockoutRefsFromGroups(groupRows.length, perGroup);
  const label = pairs.length === 1 ? "Final" : pairs.length === 2 ? "Semi-Final" : "Quarter-Final";

  const rows = pairs.map((pair, i) => ({
    id: randomUUID(),
    tournamentId: t.id,
    groupId: null,
    round: pairs.length === 1 ? "Final" : `${label} ${i + 1}`,
    teamAId: null,
    teamBId: null,
    slotA: pair[0],
    slotB: pair[1],
    lineupA: [] as never,
    lineupB: [] as never,
    log: [] as never,
    server: "a" as const,
  }));
  if (rows.length) await db.insert(matches).values(rows);

  /* A final fed by the two semi-final winners, so the bracket is complete. */
  if (pairs.length === 2) {
    await db.insert(matches).values({
      id: randomUUID(),
      tournamentId: t.id,
      groupId: null,
      round: "Final",
      slotA: "W:Semi-Final 1",
      slotB: "W:Semi-Final 2",
      lineupA: [] as never,
      lineupB: [] as never,
      log: [] as never,
      server: "a",
    });
  }

  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
}

/** Lock a resolved seed reference into a real team once its group has finished. */
export async function fillKnockoutSlots(tournamentId: string) {
  const t = await requireManager(tournamentId);
  const loaded = await loadTournament(t.slug);
  if (!loaded) return;

  const tables = groupTables(loaded);
  const resolver = refResolver(loaded, tables);

  for (const m of loaded.matches) {
    if (m.groupId !== null) continue;
    const a = m.teamAId ?? (m.slotA ? resolveRef(m.slotA, resolver) : null);
    const b = m.teamBId ?? (m.slotB ? resolveRef(m.slotB, resolver) : null);
    if (a === m.teamAId && b === m.teamBId) continue;

    const squads = await db.select().from(players).where(eq(players.tournamentId, t.id));
    const six = (teamId: string | null) =>
      teamId ? squads.filter((p) => p.teamId === teamId).slice(0, 6).map((p) => p.id) : [];

    await db.update(matches)
      .set({ teamAId: a, teamBId: b, lineupA: six(a), lineupB: six(b) })
      .where(eq(matches.id, m.id));
  }

  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
}

/**
 * Roster search for the person picker.
 *
 * Returns display-ready strings, not domain objects: this crosses to a client
 * component, so the rating engine and the reliability rules stay on the server
 * exactly as the bundle-leak guard requires.
 */
export async function searchRoster(query: string): Promise<PickerResult[]> {
  const q = z.string().trim().max(60).catch("").parse(query);
  if (q.length < 2) return [];

  const found = await searchPeople(q, 8);
  const now = new Date();
  const ids = found.map((f) => f.id);
  const history = ids.length
    ? await db
        .select({
          personId: ratingHistory.personId,
          createdAt: ratingHistory.createdAt,
          ratingBefore: ratingHistory.ratingBefore,
          notes: ratingHistory.notes,
        })
        .from(ratingHistory)
        .where(inArray(ratingHistory.personId, ids))
    : [];

  return found.map((f) => {
    /* Computed, not read from the column — reliability decays with time. */
    const rel = reliabilityForPerson(history, f.id, now);
    return {
      id: f.id,
      name: f.name,
      phoneMasked: f.phoneMasked,
      rating: f.rating,
      tier: f.tier ? `${f.tier.emoji} ${f.tier.name}` : null,
      reliability: f.lastPlayedAt ? rel.band : null,
      lastPlayed: f.lastPlayedAt
        ? f.lastPlayedAt.toLocaleDateString("en-GB", { month: "short", year: "numeric" })
        : null,
      appearances: f.appearances,
    };
  });
}
