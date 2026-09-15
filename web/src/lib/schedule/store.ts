import "server-only";

/* Loading a tournament into the scheduler and writing the answer back.
 *
 * The engine in `./index` is pure and knows nothing about tables. This is the
 * only place that turns rows into its vocabulary, and its whole job is the two
 * translations the engine cannot do for itself: WHO is on court, and WHAT each
 * match is waiting for.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { groups, matches, players, tournaments, type Match } from "@/lib/db/schema";
import { resolveRef, type RefResolver } from "@/lib/brackets";
import { buildSchedule, busyKey, type ScheduleMatch, type SchedulePlan } from "./index";

export type ScheduleOptions = {
  courts: number;
  matchMinutes: number;
  startsAt: Date;
};

/**
 * What a match is waiting for, read out of the seed references it already has.
 *
 * `resolveRef` is reused rather than re-parsed. It owns the grammar — "A1" is
 * the winner of group A, "W:Semi-Final 1" the winner of an earlier tie — and a
 * second parser here would be a second thing to keep in step. It takes a
 * resolver, so it is handed one that answers with a DEPENDENCY KEY instead of a
 * team id; the shape is the same and the grammar stays in one file.
 */
function dependencyResolver(divisionId: string): RefResolver {
  return {
    groupPlacing: (key) => `group:${divisionId}:${key}`,
    tieWinner: (code) => `tie:${divisionId}:${code}`,
    tieLoser: (code) => `tie:${divisionId}:${code}`,
  };
}

/** Everything the scheduler needs, read once. */
export async function loadScheduleMatches(tournamentId: string): Promise<{
  items: ScheduleMatch[];
  rows: Match[];
}> {
  const [rows, groupRows, playerRows] = await Promise.all([
    db.select().from(matches).where(eq(matches.tournamentId, tournamentId)),
    db.select().from(groups).where(eq(groups.tournamentId, tournamentId)),
    db.select().from(players).where(eq(players.tournamentId, tournamentId)),
  ]);

  /* Clash keys by TEAM, not by the stored line-up. A line-up is which six are
     on court for OSL's rotation; for "is this person free at 10:30" the answer
     is the whole squad, and a knockout match whose slot has just been filled
     has a team but no line-up yet. */
  const squad = new Map<string, string[]>();
  for (const p of playerRows) {
    if (!p.teamId) continue;
    const list = squad.get(p.teamId) ?? [];
    list.push(busyKey(p));
    squad.set(p.teamId, list);
  }

  /* Dependency keys to the match ids that satisfy them. A group placing waits
     on EVERY match in that group — a table is only final when the last one is
     played, which is exactly why a knockout drawn from it cannot be played
     alongside it. */
  const satisfiedBy = new Map<string, string[]>();
  const add = (key: string, id: string) => {
    const list = satisfiedBy.get(key) ?? [];
    list.push(id);
    satisfiedBy.set(key, list);
  };
  const groupById = new Map(groupRows.map((g) => [g.id, g]));
  for (const m of rows) {
    const g = m.groupId ? groupById.get(m.groupId) : null;
    if (g) add(`group:${g.divisionId}:${g.key}`, m.id);
    /* Ties are addressed by their round label, which is what `W:`/`L:` carry. */
    add(`tie:${m.divisionId}:${m.round}`, m.id);
  }

  const items: ScheduleMatch[] = rows.map((m) => {
    const people = [
      ...(m.teamAId ? (squad.get(m.teamAId) ?? []) : []),
      ...(m.teamBId ? (squad.get(m.teamBId) ?? []) : []),
    ];
    const resolver = dependencyResolver(m.divisionId);
    const dependsOn = [m.slotA, m.slotB]
      .filter((r): r is string => !!r)
      .flatMap((r) => {
        const key = resolveRef(r, resolver);
        return key ? (satisfiedBy.get(key) ?? []) : [];
      })
      .filter((id) => id !== m.id);

    return {
      id: m.id,
      people: [...new Set(people)],
      decided: !!m.teamAId && !!m.teamBId,
      dependsOn: [...new Set(dependsOn)],
      started: (m.log as unknown[]).length > 0 || m.typedScoreA !== null,
    };
  });

  return { items, rows };
}

export type ScheduleResult = SchedulePlan & { cleared: number };

/**
 * Draw up the times and write them.
 *
 * A match that could not be placed has its old time REMOVED rather than left
 * standing. A stale 10:30 against a match that is no longer in the plan is
 * worse than a blank: somebody turns up for it.
 */
export async function applySchedule(
  tournamentId: string,
  opts: ScheduleOptions,
): Promise<ScheduleResult> {
  const { items } = await loadScheduleMatches(tournamentId);
  const plan = buildSchedule({ matches: items, ...opts });

  const placed = new Map(plan.placements.map((p) => [p.matchId, p]));

  await db.transaction(async (tx) => {
    for (const p of plan.placements) {
      await tx
        .update(matches)
        .set({ court: p.court, scheduledAt: p.startsAt })
        .where(eq(matches.id, p.matchId));
    }

    const orphans = items
      .filter((m) => !m.started && !placed.has(m.id))
      .map((m) => m.id);
    if (orphans.length) {
      await tx
        .update(matches)
        .set({ court: null, scheduledAt: null })
        .where(and(eq(matches.tournamentId, tournamentId), inArray(matches.id, orphans)));
    }

    await tx
      .update(tournaments)
      .set({ courts: opts.courts, matchMinutes: opts.matchMinutes, startsAt: opts.startsAt })
      .where(eq(tournaments.id, tournamentId));
  });

  const cleared = items.filter((m) => !m.started && !placed.has(m.id)).length;
  return { ...plan, cleared };
}

/** Take every time back off, leaving the draw alone. */
export async function clearSchedule(tournamentId: string): Promise<void> {
  await db
    .update(matches)
    .set({ court: null, scheduledAt: null })
    .where(eq(matches.tournamentId, tournamentId));
}
