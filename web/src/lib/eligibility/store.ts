import "server-only";

/* Which teams no longer fit their category's rules.
 *
 * Faisal, 2026-09-17: when an organiser changes a category's limits after teams
 * have entered, NOBODY is removed — the teams that no longer fit are marked in
 * red, and the draw still works. This file produces those marks.
 *
 * ── A fixed number of queries, however many teams ────────────────────────
 * Tournament, categories, teams, players, people: five queries, one after
 * another, grouped in memory. A query per team — or worse, one per team fired
 * together — is the fan-out that wedged the site on 2026-09-15 (lib/db/index.ts).
 *
 * ── The same evidence approval used ──────────────────────────────────────
 * Each player is judged on what was declared for them on THIS team (copied onto
 * the player row at approval, or typed by the organiser) and then on their
 * person record — `playerEvidence`, the one precedence rule. So a team that
 * approval let in is not flagged here unless something actually changed, and
 * players are never matched back to an entry by name, which would break the
 * moment two on one team share one.
 */

import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { divisions, people, players, teams, tournaments } from "@/lib/db/schema";
import { entryFailures, hasRules, playerEvidence, rulesOfDivision, squadIsComplete, waiverLine, type Rules } from "./index";

export type Misfit = {
  teamId: string;
  teamName: string;
  divisionId: string;
  /** Rules broken and NOT waived: "Ravi Kumar (Women only)". Shown in red. */
  reasons: string[];
  /** Rules broken that the organiser chose to let in. Shown as "let in by organiser". */
  waived: string[];
  /** Things to check that never block: "Kabir Shah: Unrated: check this player's level". */
  notes: string[];
};

/**
 * Every team in a ruled category with something to say about it. Teams that fit
 * with nothing to note are left out; categories with no rules are skipped
 * entirely.
 */
export async function divisionMisfits(tournamentId: string): Promise<Misfit[]> {
  const [t] = await db.select().from(tournaments).where(eq(tournaments.id, tournamentId)).limit(1);
  if (!t) return [];

  const ruled = new Map<string, Rules>();
  for (const d of await db.select().from(divisions).where(eq(divisions.tournamentId, t.id))) {
    const r = rulesOfDivision(d);
    if (hasRules(r)) ruled.set(d.id, r);
  }
  if (ruled.size === 0) return [];

  const teamRows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.tournamentId, t.id), inArray(teams.divisionId, [...ruled.keys()])));
  if (teamRows.length === 0) return [];

  const playerRows = await db.select().from(players).where(inArray(players.teamId, teamRows.map((x) => x.id)));
  const personIds = [...new Set(playerRows.map((p) => p.personId).filter((x): x is string => !!x))];
  const folk = personIds.length ? await db.select().from(people).where(inArray(people.id, personIds)) : [];
  const personOf = new Map(folk.map((p) => [p.id, p]));

  const out: Misfit[] = [];
  for (const team of teamRows) {
    const rules = ruled.get(team.divisionId)!;
    const squad = playerRows.filter((p) => p.teamId === team.id);
    const evidence = squad.map((p) => playerEvidence(
      { name: p.name, gender: p.gender, dob: p.dob, dupr: p.dupr },
      p.personId ? personOf.get(p.personId) : null,
      t.sport,
      { useStored: true },
    ));

    /* A team still being put together is not yet "one man short of Mixed": it
       is judged as complete once it has at least the event's minimum, and never
       before it has two. `squadIsComplete` is the same line `addPlayer` uses,
       so the organiser is stopped at exactly the squad this would flag. */
    const complete = squadIsComplete(squad.length, t.minTeamSize);
    const verdict = entryFailures(evidence, rules, {
      complete, minTeamSize: t.minTeamSize, dated: true,
    });

    /* What is broken, each carrying the key `addPlayer` writes when the
       organiser lets it through: what was let in stays let in, and anything NEW
       — a rule tightened since — still shows red. The words are built here and
       the key is matched separately, because the words move when the evidence
       does and the key does not (see `waiverLine`). */
    const broken = [
      ...verdict.players.flatMap((fs, i) =>
        fs.filter((f) => f.severity === "block")
          .map((f) => ({ text: `${squad[i].name} (${f.text})`, key: waiverLine(f, squad[i].id) }))),
      ...verdict.team.filter((f) => f.severity === "block")
        .map((f) => ({ text: f.text, key: waiverLine(f, null) })),
    ];
    const notes = verdict.players.flatMap((fs, i) =>
      fs.filter((f) => f.severity === "note").map((f) => `${squad[i].name}: ${f.text}`));

    const letIn = new Set((team.rulesWaived ?? "").split("\n").filter(Boolean));
    const reasons = broken.filter((b) => !letIn.has(b.key)).map((b) => b.text);
    const waived = broken.filter((b) => letIn.has(b.key)).map((b) => b.text);

    if (reasons.length || waived.length || notes.length) {
      out.push({ teamId: team.id, teamName: team.name, divisionId: team.divisionId, reasons, waived, notes });
    }
  }
  return out;
}
