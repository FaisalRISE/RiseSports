"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { matches, players, teams, tournaments } from "@/lib/db/schema";
import { principalFor } from "@/lib/auth/guard";
import { canManage, assert } from "@/lib/auth/policy";

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
