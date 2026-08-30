/* Demo data.
 *
 * Takes a Drizzle database rather than importing one, so the same code seeds
 * Neon in `pnpm seed` and PGlite in the tests. That is what lets the schema and
 * the seed be proven before either touches a real project.
 *
 * Builds two tournaments so both scoring paths can be exercised:
 *   - a standard pickleball club night (side-out serving, first to 11)
 *   - an OSL team event (Rules v4.8: three pairs rotating at 7 and 14, to 25)
 * and leaves matches in three states: not started, part-scored, and finished.
 */

import { randomUUID } from "node:crypto";
import { matches, players, teams, tournaments, users } from "./schema";
import type { Side } from "@/lib/scoring/replay";

type Db = {
  insert: (table: never) => { values: (v: never) => Promise<unknown> };
};

const id = () => randomUUID();

const TEAM_COLOURS = ["#2450c8", "#c98d1c", "#07705b", "#ab1730", "#5f28c4", "#a85400", "#0b6f68", "#a8256e"];

/** Five men and a woman, in the pair order OSL 3.2 wants: no two women adjacent. */
const OSL_SQUAD = (team: string) => [
  { name: `${team} A1`, gender: "M" as const },
  { name: `${team} A2`, gender: "M" as const },
  { name: `${team} A3`, gender: "M" as const },
  { name: `${team} A4`, gender: "M" as const },
  { name: `${team} A5`, gender: "M" as const },
  { name: `${team} W1`, gender: "F" as const },
];

/** A rally log that reaches the given score, alternating so the running score
 *  looks plausible rather than one side scoring everything first. */
export function buildLog(a: number, b: number): Side[] {
  const log: Side[] = [];
  let x = a, y = b;
  while (x > 0 || y > 0) {
    if (x > 0) { log.push("a"); x--; }
    if (y > 0) { log.push("b"); y--; }
  }
  return log;
}

export async function seed(db: Db) {
  const insert = <T,>(table: T, values: unknown) =>
    (db.insert as unknown as (t: T) => { values: (v: unknown) => Promise<unknown> })(table).values(values);

  const ownerId = id();
  await insert(users, { id: ownerId, email: "demo@rise.sports", name: "Demo Organiser" });

  /* ---------- 1. standard pickleball club night ---------- */
  const clubId = id();
  await insert(tournaments, {
    id: clubId, slug: "club-night", name: "Thursday Club Night",
    sport: "pb", format: "standard", ownerId, published: true,
  });

  const clubTeams = ["Smashers", "Dinkers", "Volley Llamas", "Net Gains"].map((name, i) => ({
    id: id(), tournamentId: clubId, name, seed: i + 1, colour: TEAM_COLOURS[i],
  }));
  await insert(teams, clubTeams);

  const clubPlayers = clubTeams.flatMap((t) =>
    [1, 2].map((n) => ({
      id: id(), tournamentId: clubId, teamId: t.id,
      name: `${t.name} ${n}`, gender: (n === 2 ? "F" : "M") as "M" | "F",
      ratings: { "pb:md": 1000 + n * 25 },
    })),
  );
  await insert(players, clubPlayers);

  const lineupFor = (teamId: string) => clubPlayers.filter((p) => p.teamId === teamId).map((p) => p.id);

  await insert(matches, [
    { id: id(), tournamentId: clubId, round: "Round 1", court: 1,
      teamAId: clubTeams[0].id, teamBId: clubTeams[1].id,
      lineupA: lineupFor(clubTeams[0].id), lineupB: lineupFor(clubTeams[1].id),
      log: buildLog(11, 7), server: "a" },                       // finished
    { id: id(), tournamentId: clubId, round: "Round 1", court: 2,
      teamAId: clubTeams[2].id, teamBId: clubTeams[3].id,
      lineupA: lineupFor(clubTeams[2].id), lineupB: lineupFor(clubTeams[3].id),
      log: buildLog(6, 4), server: "b" },                        // in progress
    { id: id(), tournamentId: clubId, round: "Round 2", court: 1,
      teamAId: clubTeams[0].id, teamBId: clubTeams[2].id,
      lineupA: lineupFor(clubTeams[0].id), lineupB: lineupFor(clubTeams[2].id),
      log: [], server: "a" },                                    // not started
  ]);

  /* ---------- 2. OSL team event ---------- */
  const oslId = id();
  await insert(tournaments, {
    id: oslId, slug: "osl-2026", name: "Odyssey Sports League 2026",
    sport: "pb", format: "osl", ownerId, published: true,
  });

  const oslTeams = ["Zen Masters", "Smash Syndicate", "C & C Warriors", "Podium Finishers"].map((name, i) => ({
    id: id(), tournamentId: oslId, name, seed: i + 1, colour: TEAM_COLOURS[i],
  }));
  await insert(teams, oslTeams);

  const oslPlayers = oslTeams.flatMap((t) =>
    OSL_SQUAD(t.name.split(" ")[0]).map((p) => ({
      id: id(), tournamentId: oslId, teamId: t.id, name: p.name, gender: p.gender,
      ratings: { "pb:md": 1000 },
    })),
  );
  await insert(players, oslPlayers);

  const oslSix = (teamId: string) => oslPlayers.filter((p) => p.teamId === teamId).map((p) => p.id);

  await insert(matches, [
    /* Parked one point BEFORE the first rotation, so opening this match and
       tapping once demonstrates the blocking Pair B confirmation immediately. */
    { id: id(), tournamentId: oslId, round: "Group A", court: 1,
      teamAId: oslTeams[0].id, teamBId: oslTeams[1].id,
      lineupA: oslSix(oslTeams[0].id), lineupB: oslSix(oslTeams[1].id),
      log: buildLog(6, 4), server: "a", ackedGates: [] },
    /* Past the 14 gate, so the ends change and Pair C are already showing. */
    { id: id(), tournamentId: oslId, round: "Group A", court: 2,
      teamAId: oslTeams[2].id, teamBId: oslTeams[3].id,
      lineupA: oslSix(oslTeams[2].id), lineupB: oslSix(oslTeams[3].id),
      log: buildLog(16, 12), server: "b", ackedGates: [7, 14] },
    /* Golden point: 24-24, next rally decides it (Rules 3.3). */
    { id: id(), tournamentId: oslId, round: "Semi-Final", court: 1,
      teamAId: oslTeams[0].id, teamBId: oslTeams[2].id,
      lineupA: oslSix(oslTeams[0].id), lineupB: oslSix(oslTeams[2].id),
      log: buildLog(24, 24), server: "a", ackedGates: [7, 14] },
    { id: id(), tournamentId: oslId, round: "Final", court: 1,
      teamAId: null, teamBId: null, lineupA: [], lineupB: [], log: [], server: "a" },
  ]);

  return { ownerId, clubId, oslId, slugs: ["club-night", "osl-2026"] };
}
