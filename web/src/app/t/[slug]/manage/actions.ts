"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { groups, matches, players, teams, tournaments } from "@/lib/db/schema";
import { principalFor } from "@/lib/auth/guard";
import { canManage, assert } from "@/lib/auth/policy";
import { planGroups, knockoutRefsFromGroups } from "@/lib/formats/pickleboss";
import { resolveRef } from "@/lib/brackets";
import { loadTournament, groupTables, refResolver } from "@/lib/tournamentState";

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

export async function addPlayer(tournamentId: string, teamId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const parsed = name.safeParse(formData.get("name"));
  const gender = formData.get("gender") === "F" ? "F" : "M";
  if (!parsed.success) return;

  await db.insert(players).values({
    id: randomUUID(),
    tournamentId: t.id,
    teamId,
    name: parsed.data,
    gender,
    ratings: {},
  });
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
