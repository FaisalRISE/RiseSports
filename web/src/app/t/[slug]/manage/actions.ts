"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { divisions, groups, matches, people, players, ratingHistory, teams, tournaments } from "@/lib/db/schema";
import {
  NO_RULES, PRESETS, duprToX100, entryFailures, floatingDateISO, hasRules, needsFrom, parseDobISO, parseRules,
  playerEvidence, rulesOfDivision, rulesSentence, squadIsComplete, todayInIndia, waiverLine,
  type PresetId, type RulesProblem,
} from "@/lib/eligibility";
import { principalFor } from "@/lib/auth/guard";
import { canManage, assert } from "@/lib/auth/policy";
import { divisionsOf, resolveDivisionId } from "@/lib/divisions";
import { planGroups, knockoutRefsFromGroups } from "@/lib/formats/pickleboss";
import { singleElimMatches, thirdPlaceMatch } from "@/lib/formats/singleElim";
import { resolveRef } from "@/lib/brackets";
import { loadTournament, groupTables, resolverFactory } from "@/lib/tournamentState";
import { findOrCreatePerson, findByPhone, carriedRating, peopleForTournament, searchPeople } from "@/lib/people";
import { reliabilityForPerson } from "@/lib/rating/reliability";
import type { PickerResult } from "@/components/PersonPicker";
import { ratingFormatFor, refileSeeds } from "@/lib/rating/tournament";
import { seedFromDupr } from "@/lib/rating";
import { DEFAULT_SPORT, SPORTS, ratingKey } from "@/lib/sports/registry";

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

/* Which category an action applies to. Every form that draws or adds carries
   it; an event with one category sends nothing and gets its "Main" back, which
   is why single-category events need no UI for this at all. */
const divisionFrom = (tournamentId: string, formData: FormData) =>
  resolveDivisionId(tournamentId, (formData.get("divisionId") as string | null) ?? null);

export async function addTeam(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) return;

  /* A category id that is not one of THIS event's is refused rather than
     quietly swapped for the default: that swap would file the team in a
     category the organiser did not pick, with rules they did not choose. Only a
     form that sends no category at all gets the default. */
  const wanted = String(formData.get("divisionId") ?? "").trim();
  if (wanted && !(await divisionsOf(t.id)).some((d) => d.id === wanted)) return;

  const divisionId = await divisionFrom(t.id, formData);
  /* Seed and colour run per CATEGORY, not per event: Mixed starting at seed 9
     because Men's Doubles filled the first eight would be nonsense. */
  const existing = await db
    .select({ id: teams.id })
    .from(teams)
    .where(and(eq(teams.tournamentId, t.id), eq(teams.divisionId, divisionId)));
  const COLOURS = ["#2450c8", "#c98d1c", "#07705b", "#ab1730", "#5f28c4", "#a85400", "#0b6f68", "#a8256e"];

  await db.insert(teams).values({
    id: randomUUID(),
    tournamentId: t.id,
    divisionId,
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
export type AddPlayerResult =
  | { ok: true; notes: string[] }
  /* `reasons` are the category rules this player breaks. The organiser may add
     them anyway (Faisal, 2026-09-17) by sending the same form with `waive`. */
  | { ok: false; message?: string; reasons?: string[]; canWaive?: boolean };

export async function addPlayer(tournamentId: string, teamId: string, formData: FormData): Promise<AddPlayerResult> {
  const t = await requireManager(tournamentId);
  const parsed = name.safeParse(formData.get("name"));
  if (!parsed.success) return { ok: false, message: "Give the player a name." };

  /* The team, from THIS event. The id arrives bound into the form, and binding
     is not authorisation: without the tournament in the WHERE a manager of one
     event could add players to another's team. */
  const [team] = await db
    .select()
    .from(teams)
    .where(and(eq(teams.id, teamId), eq(teams.tournamentId, t.id)))
    .limit(1);
  if (!team) return { ok: false, message: "That team is not part of this event." };

  const [division] = await db.select().from(divisions).where(eq(divisions.id, team.divisionId)).limit(1);
  const rules = division ? rulesOfDivision(division) : NO_RULES;

  /* A blank gender means "not chosen" only where the category has a gender
     rule and so offers "Choose…". Everywhere else the form preselects M, and a
     blank is read as M exactly as it always was. */
  const g = String(formData.get("gender") ?? "");
  const gender: "M" | "F" | null = g === "F" ? "F" : g === "M" ? "M" : rules.gender ? null : "M";

  const pickedId = String(formData.get("personId") ?? "").trim();
  const phone = String(formData.get("phone") ?? "").trim();
  const duprRaw = String(formData.get("dupr") ?? "").trim();
  const bandRaw = String(formData.get("band") ?? "").trim();
  const dobRaw = String(formData.get("dob") ?? "").trim();

  if (gender == null) return { ok: false, message: "Choose man or woman." };
  /* The same floor the database keeps, so a mistyped year is a sentence here
     rather than a CHECK violation thrown out of the insert. */
  if (dobRaw && !parseDobISO(dobRaw)) return { ok: false, message: "Enter a real date of birth." };
  /* Kept only where the category asks for it, exactly as the public form does:
     a date of birth nothing is going to read is personal data held for nothing.
     The field is only rendered when it is needed; this is for a crafted post. */
  const dob = needsFrom(rules).dob ? dobRaw || null : null;
  /* A DUPR that is not a DUPR is refused, not quietly dropped. Dropped, "35"
     became no DUPR at all — which since the "No DUPR" switch is let in with a
     flag, so a typo would slip a player past a DUPR limit with a note that
     misstates what was typed. */
  if (duprRaw && duprToX100(duprRaw) == null) {
    return { ok: false, message: "DUPR must be a number between 1.00 and 8.00." };
  }
  const duprX100 = duprRaw ? duprToX100(duprRaw) : null;

  /* The rating this add is ABOUT to place, when it is placing one.
     `insertPlayer` creates the person a moment later and seeds them from the
     DUPR or the starting level on this very form, and `sportRating` counts a
     deliberate seed — so judging a rating limit against "nobody by that phone
     number yet" answers a question about a person who is one statement from
     existing. It got "unrated": the organiser was waved through, and the card
     went red the instant the page re-rendered. A DEFAULT seed stays null
     because it is not evidence of anything, and a picked person is judged on
     their own record, which this write does not touch. */
  const bandSeed = Number(bandRaw);
  const placing = pickedId
    ? null
    : duprX100 != null ? seedFromDupr(duprX100 / 100)
    : Number.isFinite(bandSeed) && bandSeed > 0 ? bandSeed
    : null;

  /* ── The category's rules, BEFORE anybody is created ──────────────────
     The candidate is looked up without creating them, so a refusal leaves no
     orphan person behind. The team's existing players count too, because
     Mixed is a rule about the team: the second man on a Mixed pair is refused
     even though nothing is wrong with him on his own. */
  if (hasRules(rules)) {
    const candidate = pickedId
      ? (await db.select().from(people).where(eq(people.id, pickedId)).limit(1))[0] ?? null
      : phone ? await findByPhone(phone) : null;

    const squadRows = await db.select().from(players).where(eq(players.teamId, team.id));
    const ids = squadRows.map((p) => p.personId).filter((x): x is string => !!x);
    const squadPeople = ids.length ? await db.select().from(people).where(inArray(people.id, ids)) : [];
    const personOf = new Map(squadPeople.map((p) => [p.id, p]));

    const squad = [
      ...squadRows.map((p) => playerEvidence(
        { name: p.name, gender: p.gender, dob: p.dob, dupr: p.dupr },
        p.personId ? personOf.get(p.personId) : null,
        t.sport,
        { useStored: true },
      )),
      playerEvidence({ name: parsed.data, gender, dob, dupr: duprX100, rating: placing }, candidate, t.sport, { useStored: true }),
    ];
    /* `squadIsComplete` decides when a Mixed team counts as a team, and the
       flags on the manage screen use the same line — so the organiser is
       stopped on exactly the squad that would otherwise go red without them
       ever having been asked. */
    const verdict = entryFailures(squad, rules, {
      complete: squadIsComplete(squad.length, t.minTeamSize), minTeamSize: t.minTeamSize, dated: true,
    });
    const mine = verdict.players[verdict.players.length - 1];
    const blocking = [
      ...mine.filter((f) => f.severity === "block").map((f) => ({ f, text: `${parsed.data} (${f.text})`, mine: true })),
      ...verdict.team.filter((f) => f.severity === "block").map((f) => ({ f, text: f.text, mine: false })),
    ];

    if (blocking.length && formData.get("waive") !== "on") {
      return { ok: false, reasons: blocking.map((b) => b.text), canWaive: true };
    }

    const added = await insertPlayer(t, team.id, parsed.data, gender, { pickedId, phone, duprRaw, bandRaw, dob, duprX100 });

    /* Let in anyway: what was waived is recorded on the team, so the card can
       say so — and a rule tightened later, which is a different rule, still
       flags it. Stored as `waiverLine` keys rather than as the sentences,
       because the sentence changes with the evidence and the decision did not:
       see the note on `waiverLine`. */
    if (blocking.length) {
      const before = (team.rulesWaived ?? "").split("\n").filter(Boolean);
      const now = blocking.map((b) => waiverLine(b.f, b.mine ? added : null));
      const merged = [...new Set([...before, ...now])].join("\n");
      await db.update(teams).set({ rulesWaived: merged }).where(eq(teams.id, team.id));
    }
    revalidatePath(`/t/${t.slug}/manage`);
    return { ok: true, notes: mine.filter((f) => f.severity === "note").map((f) => `${parsed.data}: ${f.text}`) };
  }

  await insertPlayer(t, team.id, parsed.data, gender, { pickedId, phone, duprRaw, bandRaw, dob, duprX100 });
  revalidatePath(`/t/${t.slug}/manage`);
  return { ok: true, notes: [] };
}

/* The write half of adding a player, unchanged in what it does for a category
   with no rules: link or create the person by phone, carry their rating in. */
async function insertPlayer(
  t: typeof tournaments.$inferSelect,
  teamId: string,
  playerName: string,
  gender: "M" | "F",
  form: { pickedId: string; phone: string; duprRaw: string; bandRaw: string; dob: string | null; duprX100: number | null },
): Promise<string> {
  const roster = await db.select().from(players).where(eq(players.tournamentId, t.id));
  /* ONE format for everything this add writes — the seed's key, the rating
     carried in, and the key it is recorded under — decided by the roster as it
     will be with this player on it, and the event's team size. The carried
     rating used to be read for the roster WITHOUT them, which for the first
     player of an event is no roster at all. */
  const format = ratingFormatFor([...roster, { gender, teamId } as never], t.minTeamSize);
  const formatKey = ratingKey(t.sport, format);

  let personId: string | null = null;
  let carried: number | null = null;

  if (form.pickedId) {
    const [existing] = await db.select().from(people).where(eq(people.id, form.pickedId)).limit(1);
    if (existing) {
      personId = existing.id;
      carried = carriedRating(existing, t.sport, format);
    }
  } else if (form.phone || form.duprRaw || form.bandRaw) {
    /* The validated DUPR, not the raw text: "9" is not a DUPR, and seeding a
       rating from it — while `players.dupr` refused to store it — put a number
       on the person that the rules check had already discounted. */
    const dupr = form.duprX100 != null ? form.duprX100 / 100 : null;
    const band = form.bandRaw ? Number(form.bandRaw) : null;
    const { person } = await findOrCreatePerson({
      name: playerName,
      gender,
      phone: form.phone || null,
      dupr,
      bandSeed: Number.isFinite(band) && band! > 0 ? band : null,
      formatKey,
      seededBy: t.ownerId,
    });
    personId = person.id;
    carried = carriedRating(person, t.sport, format);
  }

  const id = randomUUID();
  await db.insert(players).values({
    id,
    tournamentId: t.id,
    teamId,
    personId,
    name: playerName,
    gender,
    /* The rating they bring IN. The per-event view starts here; the person's
       own record is what actually moves. */
    ratings: carried == null ? {} : { [formatKey]: carried },
    /* What the organiser declared for this player on this team — the evidence
       the category's rules and the "doesn't fit" flags read first. */
    dob: form.dob,
    dupr: form.duprX100,
  });

  /* A typed date of birth also fills the person's record, but only where it is
     empty — never overwriting one that is already there. */
  if (personId && form.dob) {
    await db.update(people).set({ dob: form.dob }).where(and(eq(people.id, personId), isNull(people.dob)));
  }

  /* This player may be the one who shows what the event is: the partner who
     turns a team of one into a pair, or the woman who makes it mixed. Seeds the
     earlier players were filed under on the old guess move to where the event
     will actually be rated. The new row is already filed under `formatKey`, so
     only the rows read before it can be stale. */
  await refileSeeds(t, roster, formatKey);
  return id;
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

  /* Seeded on each player's rating in THIS event's sport and format — the
     number the event carries in. It was `riseBest`, the best across every
     sport, so a pickleball star topped the seeding of their first badminton
     event (Faisal, 2026-09-21: "RiseR rating is specific to each sport"). */
  const format = ratingFormatFor(rows, t.minTeamSize);
  const strengthOf = (teamId: string): number | null => {
    const ids = rows.filter((p) => p.teamId === teamId && p.personId).map((p) => p.personId!);
    const ratings = ids
      .map((id) => roster.get(id))
      .filter((person): person is NonNullable<typeof person> => !!person)
      .map((person) => carriedRating(person, t.sport, format));
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
  /* Only a player of THIS event — deleting by id alone let a manager of one
     event remove players from another. */
  await db.delete(players).where(and(eq(players.id, playerId), eq(players.tournamentId, t.id)));
  revalidatePath(`/t/${t.slug}/manage`);
}

export async function addMatch(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const round = z.string().trim().min(1).max(40).catch("Round 1").parse(formData.get("round"));
  const a = String(formData.get("teamA") ?? "");
  const b = String(formData.get("teamB") ?? "");
  if (!a || !b || a === b) return;

  /* The category comes from the TEAMS, never from the form: a match belongs to
     whichever category its entrants are in, and two teams from different
     categories have no business playing a fixture. Refusing here is cheap;
     tracking down a Mixed pair in the Men's Doubles table later is not. */
  const sides = await db
    .select({ id: teams.id, divisionId: teams.divisionId })
    .from(teams)
    .where(and(eq(teams.tournamentId, t.id), inArray(teams.id, [a, b])));
  if (sides.length !== 2) return;
  const [first, second] = sides;
  if (first.divisionId !== second.divisionId) return;

  /* Seed the line-up with the team's squad in listed order. For the OSL format
     that IS the declared pair order (A1+A2, A3+A4, A5+A6), so a match is
     immediately scoreable and the organiser can reorder afterwards. */
  const squad = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const six = (teamId: string) => squad.filter((p) => p.teamId === teamId).slice(0, 6).map((p) => p.id);

  await db.insert(matches).values({
    id: randomUUID(),
    tournamentId: t.id,
    divisionId: first.divisionId,
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


/* ---------- categories ---------- */

/**
 * Add a category to an event: Men's Doubles, Mixed, U-17, Beginners.
 *
 * Until this existed, every tournament had exactly the one category it was
 * created with, so the draw's support for several of them was unreachable —
 * plumbing with no tap on the end of it.
 */
export async function addDivision(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);

  /* A starting point fills the rules in, so Women's Doubles or 35+ needs no
     further typing (Faisal, 2026-09-17). A blank name takes the starting
     point's own label — "Women’s" is a perfectly good category name. */
  const presetId = String(formData.get("preset") ?? "open") as PresetId;
  const preset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const typedName = String(formData.get("name") ?? "").trim();
  const parsed = name.safeParse(typedName || (preset.id === "open" ? "" : preset.label));
  if (!parsed.success) return;

  const existing = await divisionsOf(t.id);
  /* Same name twice is almost always a mis-click, and two categories called
     "Mixed" are indistinguishable everywhere they appear. */
  if (existing.some((d) => d.name.toLowerCase() === parsed.data.toLowerCase())) return;

  const rules = { ...preset.rules };
  /* Mixed cannot exist in a singles event; the screen hides it, and a crafted
     post gets a category with no gender rule rather than an impossible one. */
  if (rules.gender === "MX" && t.maxTeamSize < 2) delete rules.gender;

  await db.insert(divisions).values({
    id: randomUUID(),
    tournamentId: t.id,
    name: parsed.data,
    position: existing.length,
    genderRule: rules.gender ?? null,
    ageMin: rules.ageMin ?? null,
    ageMax: rules.ageMax ?? null,
    /* An age preset counts ages on the event day. An event with no date yet
       counts on today in India — and the rules panel says so prominently,
       because that date will not follow the event if one is set later. */
    ageOn: rules.ageMin != null || rules.ageMax != null
      ? (t.startsAt ? floatingDateISO(t.startsAt) : todayInIndia())
      : null,
  });

  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
  revalidatePath(`/e/${t.slug}`);
}

/* ---------- who can enter a category ---------- */

export type RulesSaveResult =
  | { ok: true; message: string }
  | { ok: false; problems: RulesProblem[] };

const rulesInputFrom = (formData: FormData) => ({
  gender: formData.get("gender") as string | null,
  ageMin: formData.get("ageMin") as string | null,
  ageMax: formData.get("ageMax") as string | null,
  ageOn: formData.get("ageOn") as string | null,
  ratingMin: formData.get("ratingMin") as string | null,
  ratingMax: formData.get("ratingMax") as string | null,
  duprMin: formData.get("duprMin") as string | null,
  duprMax: formData.get("duprMax") as string | null,
  duprStrict: formData.get("duprStrict") as string | null,
});

/**
 * Save who can enter one category.
 *
 * Changing the rules NEVER removes anybody. Teams already in the category that
 * no longer fit are counted and reported — "2 teams already entered don't meet
 * these rules" — and marked on the manage screen, and the organiser decides
 * what to do about them. A rules form that silently deleted entries would be
 * the most destructive button in the app.
 */
export async function setDivisionRules(tournamentId: string, formData: FormData): Promise<RulesSaveResult> {
  const t = await requireManager(tournamentId);
  const divisionId = String(formData.get("divisionId") ?? "");

  const parsed = parseRules(rulesInputFrom(formData), { maxTeamSize: t.maxTeamSize });
  if (!parsed.ok) return parsed;
  const r = parsed.rules;

  const saved = await db
    .update(divisions)
    .set({
      genderRule: r.gender, ageMin: r.ageMin, ageMax: r.ageMax, ageOn: r.ageOn,
      ratingMin: r.ratingMin, ratingMax: r.ratingMax, duprMin: r.duprMin, duprMax: r.duprMax,
      duprStrict: r.duprStrict,
    })
    /* Scoped to this event, so a division id from another cannot be edited. */
    .where(and(eq(divisions.id, divisionId), eq(divisions.tournamentId, t.id)))
    .returning({ id: divisions.id });
  if (saved.length === 0) return { ok: false, problems: [{ field: "gender", message: "That category is not part of this event." }] };

  const { divisionMisfits } = await import("@/lib/eligibility/store");
  const flagged = (await divisionMisfits(t.id)).filter((m) => m.divisionId === divisionId && m.reasons.length > 0).length;

  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/e/${t.slug}`);
  return {
    ok: true,
    message: flagged === 0
      ? "Saved."
      : `Saved. ${flagged} ${flagged === 1 ? "team" : "teams"} already entered ${flagged === 1 ? "doesn’t" : "don’t"} meet these rules. ${flagged === 1 ? "It’s" : "They’re"} marked below. Nobody was removed.`,
  };
}

/**
 * The rules in plain words, as the controls move.
 *
 * On the server for the same reason as `describeScoring`: the rules live behind
 * `import "server-only"`, and restating them is one round trip. Problems come
 * back too, so a youngest age above the oldest is said before Save is pressed.
 */
export async function describeDivisionRules(
  tournamentId: string,
  input: Record<string, string>,
): Promise<{ sentence: string; problems: RulesProblem[] }> {
  /* A Server Action is a public endpoint, and this one reads the database:
     without the guard anyone could point it at any event id, as fast as they
     liked. The precedent it was written from, `describeScoring`, is pure and
     touches nothing — this is not, so it authorises like every other action in
     this file. The form also asks once the typing stops, not once per key. */
  const t = await requireManager(tournamentId);
  const parsed = parseRules(input, { maxTeamSize: t.maxTeamSize });
  return parsed.ok
    ? { sentence: rulesSentence(parsed.rules), problems: [] }
    : { sentence: "", problems: parsed.problems };
}

/* ---------- how a category is run ---------- */

/**
 * Set the shape of one category, and whether it plays for third place.
 *
 * Per CATEGORY rather than per tournament, because Faisal runs events where
 * Men's Doubles goes groups→knockout while a beginners' category is a simple
 * league. Changing the shape does NOT redraw: an organiser choosing a shape has
 * not yet said they want the existing fixtures thrown away.
 */
export async function setDivisionShape(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const divisionId = await divisionFrom(t.id, formData);

  const shape = z
    .enum(["groups_ko", "league", "single_elim"])
    .catch("groups_ko")
    .parse(formData.get("shape"));
  const thirdPlace = formData.get("thirdPlace") === "on";

  await db
    .update(divisions)
    .set({ shape, thirdPlace })
    .where(and(eq(divisions.id, divisionId), eq(divisions.tournamentId, t.id)));

  revalidatePath(`/t/${t.slug}/manage`);
}

/* ---------- group stage and knockout ---------- */

/**
 * Draw the teams into groups and generate every group fixture.
 *
 * Destructive by design: it clears any existing groups and their matches, so an
 * organiser who mis-set the group count can simply redraw. Knockout matches
 * (which have no groupId) are left alone.
 *
 * A LEAGUE is this with exactly one group: every team plays every other, one
 * table, no knockout. That is not a special case in the draw, only a constraint
 * on the count — so it is forced here rather than trusted from the form.
 */
export async function generateGroups(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const asked = z.coerce.number().int().min(1).max(8).catch(2).parse(formData.get("groups"));
  const courtNames = String(formData.get("courts") ?? "")
    .split(",").map((c) => c.trim()).filter(Boolean);

  const divisionId = await divisionFrom(t.id, formData);
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId));

  /* A league is one group by definition. Enforced here rather than left to the
     form, so the shape cannot be contradicted by a stale field or a crafted
     post. */
  const count = division?.shape === "league" ? 1 : asked;

  const teamRows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.tournamentId, t.id), eq(teams.divisionId, divisionId)));
  if (teamRows.length < 2) return;

  const squads = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const six = (teamId: string) => squads.filter((p) => p.teamId === teamId).slice(0, 6).map((p) => p.id);

  /* Redraw THIS category only. Drawing Mixed must not wipe the Men's Doubles
     groups that were drawn an hour ago and may already have results in them. */
  const existing = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.tournamentId, t.id), eq(groups.divisionId, divisionId)));
  for (const g of existing) {
    await db.delete(matches).where(eq(matches.groupId, g.id));
  }
  await db.delete(groups).where(and(eq(groups.tournamentId, t.id), eq(groups.divisionId, divisionId)));

  const seeded = [...teamRows].sort((a, b) => a.seed - b.seed);
  const plans = planGroups(seeded, count, courtNames);

  for (const [i, plan] of plans.entries()) {
    if (plan.entrants.length < 2) continue;
    const groupId = randomUUID();
    await db.insert(groups).values({
      id: groupId, tournamentId: t.id, divisionId, key: plan.key,
      name: `Group ${plan.key}`, court: plan.court, position: i,
    });

    const rows = plan.rounds.flatMap((round, ri) =>
      round.map(([a, b]) => {
        const teamA = plan.entrants[a], teamB = plan.entrants[b];
        return {
          id: randomUUID(),
          tournamentId: t.id,
          divisionId,
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
 * Draw a straight knockout from the category's teams — no group stage.
 *
 * The seeding is `seedBracket`, which has been in the repository, tested and
 * uncalled since the port. Team seed 1 is the strongest, and `seedBracket`
 * sorts by descending strength, so the seed is simply negated.
 *
 * Byes produce no match row (see lib/formats/singleElim): a bye is not a
 * fixture, and the team that got one appears in the next round as a real team
 * rather than waiting on a match nobody can play.
 */
export async function generateSingleElim(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const divisionId = await divisionFrom(t.id, formData);
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId));

  const teamRows = await db
    .select()
    .from(teams)
    .where(and(eq(teams.tournamentId, t.id), eq(teams.divisionId, divisionId)));
  if (teamRows.length < 2) return;

  const drawn = singleElimMatches(
    [...teamRows].map((x) => ({ id: x.id, name: x.name, strength: -x.seed })),
  );
  if (!drawn) return;

  /* Replace the unplayed draw in THIS category only, and leave anything with a
     result alone — redrawing over a played match destroys it. */
  const existing = await db
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, t.id), eq(matches.divisionId, divisionId)));
  for (const m of existing) {
    if ((m.log as unknown[]).length === 0 && m.typedScoreA === null) {
      await db.delete(matches).where(eq(matches.id, m.id));
    }
  }

  const squads = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const six = (teamId: string | null) =>
    teamId ? squads.filter((p) => p.teamId === teamId).slice(0, 6).map((p) => p.id) : [];

  const third = division?.thirdPlace ? thirdPlaceMatch(drawn) : null;

  const rows = [...drawn, ...(third ? [third] : [])].map((m) => ({
    id: randomUUID(),
    tournamentId: t.id,
    divisionId,
    groupId: null,
    round: m.round,
    teamAId: m.teamAId,
    teamBId: m.teamBId,
    slotA: m.slotA,
    slotB: m.slotB,
    lineupA: six(m.teamAId) as never,
    lineupB: six(m.teamBId) as never,
    log: [] as never,
    server: "a" as const,
  }));
  if (rows.length) await db.insert(matches).values(rows);

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

  const divisionId = await divisionFrom(t.id, formData);

  const groupRows = await db
    .select()
    .from(groups)
    .where(and(eq(groups.tournamentId, t.id), eq(groups.divisionId, divisionId)));
  if (groupRows.length < 1) return;

  /* Replace any previous, unplayed knockout draw IN THIS CATEGORY. A played one
     is left alone: redrawing over results would destroy them. Scoping to the
     division also stops a Mixed redraw deleting the Men's Doubles semi-finals,
     which share a tournament and nothing else. */
  const existing = await db
    .select()
    .from(matches)
    .where(and(eq(matches.tournamentId, t.id), eq(matches.divisionId, divisionId)));
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
    divisionId,
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

  /* A third-place playoff costs one row, because `L:` references resolve just
     as `W:` ones do — the losing semi-finalists fill it themselves. */
  const [division] = await db.select().from(divisions).where(eq(divisions.id, divisionId));
  if (pairs.length === 2 && division?.thirdPlace) {
    await db.insert(matches).values({
      id: randomUUID(),
      tournamentId: t.id,
      divisionId,
      groupId: null,
      round: "Third Place",
      slotA: "L:Semi-Final 1",
      slotB: "L:Semi-Final 2",
      lineupA: [] as never,
      lineupB: [] as never,
      log: [] as never,
      server: "a",
    });
  }

  /* A final fed by the two semi-final winners, so the bracket is complete. */
  if (pairs.length === 2) {
    await db.insert(matches).values({
      id: randomUUID(),
      tournamentId: t.id,
      divisionId,
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

  /* One resolver PER CATEGORY. A single shared resolver would read "A1" out of
     whichever category happened to come back from the database last — see
     refResolver's note. */
  const resolverFor = resolverFactory(loaded, tables);

  /* Hoisted out of the loop: it does not vary per match, and re-reading the
     whole squad once per knockout slot was a query per match for no reason. */
  const squads = await db.select().from(players).where(eq(players.tournamentId, t.id));
  const six = (teamId: string | null) =>
    teamId ? squads.filter((p) => p.teamId === teamId).slice(0, 6).map((p) => p.id) : [];

  for (const m of loaded.matches) {
    if (m.groupId !== null) continue;
    const resolver = resolverFor(m.divisionId);
    const a = m.teamAId ?? (m.slotA ? resolveRef(m.slotA, resolver) : null);
    const b = m.teamBId ?? (m.slotB ? resolveRef(m.slotB, resolver) : null);
    if (a === m.teamAId && b === m.teamBId) continue;

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
 *
 * The rating shown is the one in the EVENT's sport — the page binds it, so the
 * picker keeps its `(query) => …` shape. A bound argument still arrives from
 * the browser, so it is checked against the registry like any other input.
 */
export async function searchRoster(sport: string, query: string): Promise<PickerResult[]> {
  const q = z.string().trim().max(60).catch("").parse(query);
  if (q.length < 2) return [];

  const sp = sport in SPORTS ? sport : DEFAULT_SPORT;
  const found = await searchPeople(q, 8, sp);
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

/* ---------- how the game is scored ----------
 *
 * `buildScoring` and `goldenInfo` have existed in lib/scoring since the engine
 * was ported, and `tournaments.scoring` has existed since 0000. Nothing wrote
 * it: the organiser had no way to say "to 15, win by 2, capped at 18", so every
 * event ran on its sport's defaults. This is the control that was missing.
 *
 * Note `rulesFor` prefers a FORMAT PRESET over these overrides — an OSL or
 * Pickleboss event has fixed rules by definition — so the screen only offers
 * this for the standard format.
 */

const scoreTypeSchema = z.enum(["service", "rally", ""]).catch("");

/** The organiser's controls, parsed. Shared by the save and the preview. */
const scoringSchema = z.object({
  target: z.coerce.number().int().min(1).max(99).catch(11),
  winBy2: z.boolean(),
  /* "auto" puts the ceiling two above the target; "none" lets the two-point
     rule run on, which is traditional and can strand a schedule. */
  goldenAt: z.union([z.coerce.number().int().min(1).max(99), z.literal("auto"), z.literal("none")]).catch("auto"),
  switchAt: z.union([z.coerce.number().int().min(1).max(99), z.null()]).catch(null),
  scoreType: scoreTypeSchema,
});

export async function setScoring(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);

  const raw = {
    target: formData.get("target"),
    winBy2: formData.get("winBy2") === "on",
    goldenAt: formData.get("goldenAt"),
    switchAt: formData.get("switchAt") || null,
    scoreType: formData.get("scoreType") ?? "",
  };
  const v = scoringSchema.parse(raw);

  const { buildScoring } = await import("@/lib/scoring/rules");

  /* `buildScoring` uses the target to work out the golden point and cap, but
     deliberately does NOT return it — in the legacy app the target travelled
     separately as the tournament's `pointsToWin`. So it has to be supplied
     here, or `resolveRules` falls back to the sport default and an event set
     "to 15" silently plays to 11. `picklebossRuleOverrides` carries the same
     note and the same explicit target.
     Caught by playing a match rather than by a test: the manage screen said
     "To 15" and the referee console ended it 11-2. */
  const overrides = {
    target: v.target,
    ...buildScoring(v.target, v.winBy2, v.goldenAt, v.switchAt, v.scoreType),
  };

  await db
    .update(tournaments)
    .set({ scoring: overrides as Record<string, unknown> })
    .where(eq(tournaments.id, t.id));

  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
}

/** Back to the sport's own defaults. */
export async function clearScoring(tournamentId: string) {
  const t = await requireManager(tournamentId);
  await db.update(tournaments).set({ scoring: null }).where(eq(tournaments.id, t.id));
  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
}

/**
 * The plain-English restatement, live as the controls move.
 *
 * Computed HERE rather than in the browser: `goldenInfo` lives behind
 * `import "server-only"` with the rest of the scoring engine, and the whole
 * point of that is the rules never ship. Restating them is one round trip.
 */
export async function describeScoring(input: {
  target: number | string; winBy2: boolean;
  goldenAt: number | string; scoreType: string;
}): Promise<string> {
  const v = scoringSchema.parse({ ...input, switchAt: null });
  const { goldenInfo } = await import("@/lib/scoring/rules");
  return goldenInfo(v.target, v.winBy2, v.goldenAt, v.scoreType);
}

/* ── Order of play ─────────────────────────────────────────────────────── */

const scheduleSchema = z.object({
  startsAt: z.string().min(1),
  courts: z.coerce.number().int().min(1).max(20).catch(2),
  matchMinutes: z.coerce.number().int().min(5).max(180).catch(20),
});

/**
 * Put times and courts against every match that has not been played.
 *
 * The engine is `lib/schedule`; this only reads the form. What it is FOR is the
 * multi-category day: a person entered in Men's Doubles and Mixed must never be
 * given two matches at once, and until categories existed there was nothing to
 * clash. See lib/schedule/store for how "who is on court" and "what is this
 * waiting for" are read out of the rows.
 */
export async function generateSchedule(tournamentId: string, formData: FormData) {
  const t = await requireManager(tournamentId);
  const v = scheduleSchema.parse({
    startsAt: formData.get("startsAt"),
    courts: formData.get("courts"),
    matchMinutes: formData.get("matchMinutes"),
  });

  const { floatingInstant } = await import("@/lib/schedule");
  const startsAt = floatingInstant(v.startsAt);
  if (!startsAt) return;

  const { applySchedule } = await import("@/lib/schedule/store");
  await applySchedule(t.id, { courts: v.courts, matchMinutes: v.matchMinutes, startsAt });

  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
  revalidatePath(`/t/${t.slug}/print`);
}

/** Take the times back off. The draw itself is untouched. */
export async function dropSchedule(tournamentId: string) {
  const t = await requireManager(tournamentId);
  const { clearSchedule } = await import("@/lib/schedule/store");
  await clearSchedule(t.id);
  revalidatePath(`/t/${t.slug}/manage`);
  revalidatePath(`/t/${t.slug}`);
  revalidatePath(`/t/${t.slug}/print`);
}
