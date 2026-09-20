import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* Approval, against a real database.
 *
 * This is the payoff of the whole registration feature and the reason it is
 * worth the schema: the registrant typed their own phone, and approval turns
 * that into a PERSON — so someone who has played before arrives carrying their
 * RISE Rating with no organiser typing anything.
 *
 * Driven through the real path for the reason recorded in
 * lib/rating/pipeline.test.ts: unit tests that hand-build their inputs go
 * around the pipeline and can keep a dead feature green. */

const dir = path.join(os.tmpdir(), `rise-approve-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let approve: typeof import("./approve");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;

const ids = { owner: randomUUID(), tournament: randomUUID() };

/** A pending entry with the given players. */
async function entryWith(players: { name: string; phone?: string | null }[], teamName: string) {
  const registrationId = randomUUID();
  await db.insert(schema.registrations).values({
    id: registrationId,
    tournamentId: ids.tournament,
    teamName,
    contactName: players[0].name,
    contactPhone: players[0].phone ?? null,
    status: "pending",
  });
  await db.insert(schema.registrationPlayers).values(
    players.map((p, i) => ({
      id: randomUUID(),
      registrationId,
      name: p.name,
      phone: p.phone ?? null,
      gender: "M" as const,
      position: i,
    })),
  );
  return registrationId;
}

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  approve = await import("./approve");
  ({ eq } = await import("drizzle-orm"));

  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migrations, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }

  await db.insert(schema.users).values({ id: ids.owner, email: "o@e.st", name: "Organiser" });
  await db.insert(schema.tournaments).values({
    id: ids.tournament, slug: "approve-cup", name: "Approve Cup", sport: "pb",
    format: "standard", ownerId: ids.owner, status: "open", minTeamSize: 1, maxTeamSize: 2,
  });
}, 120_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("approving an entry", () => {
  it("creates a team and its players", async () => {
    const id = await entryWith([{ name: "Anya", phone: "+919000000001" }, { name: "Bo", phone: "+919000000002" }], "Falcons");
    const res = await approve.approveRegistration(id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    const [team] = await db.select().from(schema.teams).where(eq(schema.teams.id, res.teamId));
    expect(team.name).toBe("Falcons");

    const squad = await db.select().from(schema.players).where(eq(schema.players.teamId, res.teamId));
    expect(squad.map((p) => p.name).sort()).toEqual(["Anya", "Bo"]);
  });

  /* THE POINT. The registrant supplied the phone; approval turns it into a
     person, so a rating has something to attach to. */
  it("links every player with a phone to a person", async () => {
    const squad = await db.select().from(schema.players).where(eq(schema.players.tournamentId, ids.tournament));
    expect(squad.every((p) => p.personId)).toBe(true);

    const roster = await db.select().from(schema.people);
    expect(roster.map((p) => p.name).sort()).toEqual(["Anya", "Bo"]);
  });

  it("writes the matched person back onto the entry", async () => {
    const rows = await db.select().from(schema.registrationPlayers);
    expect(rows.every((r) => r.personId)).toBe(true);
  });

  it("marks the entry approved and points it at the team it became", async () => {
    const [reg] = await db.select().from(schema.registrations);
    expect(reg.status).toBe("approved");
    expect(reg.teamId).toBeTruthy();
    expect(reg.decidedAt).toBeTruthy();
  });

  /* The whole reason phones are collected: a returning player is the SAME
     person, carrying whatever rating they earned last time. */
  it("reuses the person on a second event and carries the rating in", async () => {
    const [anya] = await db.select().from(schema.people).where(eq(schema.people.phone, "+919000000001"));
    await db.update(schema.people)
      .set({ riseRatings: { "pb:md": 1180 }, riseBest: 1180 })
      .where(eq(schema.people.id, anya.id));

    /* Same number, different spelling of the number and a different team. */
    const id = await entryWith([{ name: "Anya K", phone: "09000000001" }, { name: "Cy", phone: "+919000000003" }], "Kites");
    const res = await approve.approveRegistration(id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;

    /* Two linked, ONE of them already known. */
    expect(res.linked).toBe(2);
    expect(res.carried).toBe(1);

    const squad = await db.select().from(schema.players).where(eq(schema.players.teamId, res.teamId));
    const returning = squad.find((p) => p.personId === anya.id);
    expect(returning, "the returning player is the same person, not a duplicate").toBeTruthy();
    expect(Object.values(returning!.ratings)[0]).toBe(1180);

    const named = await db.select().from(schema.people).where(eq(schema.people.phone, "+919000000001"));
    expect(named).toHaveLength(1);
  });

  /* A player who will not give a number still gets in — their rating just
     cannot travel. The UI says so; this proves the code does not refuse them. */
  it("accepts a player with no phone, unlinked", async () => {
    const id = await entryWith([{ name: "Anon" }], "Wrens");
    const res = await approve.approveRegistration(id);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.linked).toBe(0);

    const squad = await db.select().from(schema.players).where(eq(schema.players.teamId, res.teamId));
    expect(squad[0].personId).toBeNull();
  });

  it("refuses to approve the same entry twice", async () => {
    const [reg] = await db.select().from(schema.registrations);
    const again = await approve.approveRegistration(reg.id);
    expect(again.ok).toBe(false);
  });

  it("refuses an entry with no players rather than making an empty team", async () => {
    const empty = randomUUID();
    await db.insert(schema.registrations).values({
      id: empty, tournamentId: ids.tournament, teamName: "Ghosts", contactName: "Nobody", status: "pending",
    });
    const res = await approve.approveRegistration(empty);
    expect(res.ok).toBe(false);
    const teams = await db.select().from(schema.teams).where(eq(schema.teams.name, "Ghosts"));
    expect(teams).toEqual([]);
  });
});

describe("declining and payment", () => {
  it("declining is a state, not a delete", async () => {
    const id = await entryWith([{ name: "Late", phone: "+919000000009" }], "Latecomers");
    const res = await approve.setRegistrationStatus(id, "declined", "Event full");
    expect(res.ok).toBe(true);

    const [reg] = await db.select().from(schema.registrations).where(eq(schema.registrations.id, id));
    expect(reg.status).toBe("declined");
    expect(reg.note).toBe("Event full");
  });

  /* Un-approving would orphan a team and its players. Removing the team is a
     separate, deliberate act. */
  it("refuses to un-approve an entry that is already a team", async () => {
    const [approved] = await db.select().from(schema.registrations).where(eq(schema.registrations.status, "approved"));
    const res = await approve.setRegistrationStatus(approved.id, "declined");
    expect(res.ok).toBe(false);
  });

  it("records payment without moving money", async () => {
    const [reg] = await db.select().from(schema.registrations);
    expect((await approve.setPaymentState(reg.id, "paid")).ok).toBe(true);
    const [paid] = await db.select().from(schema.registrations).where(eq(schema.registrations.id, reg.id));
    expect(paid.paymentState).toBe("paid");
    expect(paid.paidAt).toBeTruthy();

    await approve.setPaymentState(reg.id, "unpaid");
    const [back] = await db.select().from(schema.registrations).where(eq(schema.registrations.id, reg.id));
    expect(back.paidAt).toBeNull();
  });
});

/* Kept LAST, with phones nothing above uses: earlier tests read "the first
 * registration" and "every person", and would see these rows otherwise.
 *
 * All three were found by the concurrency audit that followed the 2026-09-15
 * outage. Approval used to look people up with a Promise.all over the entrants,
 * so every entrant's "is this phone known?" was asked before any of them was
 * created — which is how one phone could become two people. */
describe("the same phone twice, and two taps at once", () => {
  it("links a number given twice on one entry to ONE person, and only the first player", async () => {
    /* The same number written two ways: a pair who gave one contact phone. */
    const id = await entryWith(
      [{ name: "Dev", phone: "+919000000201" }, { name: "Dev's partner", phone: "09000000201" }],
      "Same Phone",
    );
    const res = await approve.approveRegistration(id);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;

    const found = await db.select().from(schema.people).where(eq(schema.people.phone, "+919000000201"));
    expect(found).toHaveLength(1);
    expect(res.linked).toBe(1);

    /* Not both. One person twice on a team gives two rating rows for the same
       match, person and format, which the unique index refuses — and a rating
       failure on score save is only logged, so that team's ratings would stop
       moving with nothing on screen to say why. */
    const squad = await db.select().from(schema.players).where(eq(schema.players.teamId, res.teamId));
    const personOf = Object.fromEntries(squad.map((p) => [p.name, p.personId]));
    expect(personOf["Dev"]).toBe(found[0].id);
    expect(personOf["Dev's partner"]).toBeNull();
  });

  it("gives two simultaneous creates of one phone the same person", async () => {
    const { findOrCreatePerson } = await import("@/lib/people");
    const input = { name: "Esha", gender: "F" as const, phone: "+919000000202", formatKey: "pb:md" };

    const [a, b] = await Promise.all([findOrCreatePerson(input), findOrCreatePerson(input)]);

    expect(a.person.id).toBe(b.person.id);
    /* Exactly one of them made it; the other found it. */
    expect([a.created, b.created].sort()).toEqual([false, true]);
    expect(
      await db.select().from(schema.people).where(eq(schema.people.phone, "+919000000202")),
    ).toHaveLength(1);
  });

  it("turns two simultaneous approvals of one entry into ONE team", async () => {
    /* A double tap on Approve, or two organisers on two phones. */
    const id = await entryWith([{ name: "Faiz", phone: "+919000000203" }], "Double Tap");

    const results = await Promise.all([approve.approveRegistration(id), approve.approveRegistration(id)]);

    expect(results.filter((r) => r.ok)).toHaveLength(1);
    const refused = results.find((r) => !r.ok);
    expect(refused && !refused.ok && refused.error).toMatch(/already approved/i);
    expect(
      await db.select().from(schema.teams).where(eq(schema.teams.name, "Double Tap")),
    ).toHaveLength(1);
  });
});

/* ── Category rules at approval (2026-09-17) ──────────────────────────────
 *
 * Kept LAST and in their OWN event, so nothing above sees these rows. The
 * public form checks the rules too, but approval checks them AGAIN and before
 * creating anybody: an entry that fitted when it was sent may not fit the
 * category as the organiser has since set it, and approval is the last moment
 * to refuse rather than flag a team that already exists. */
describe("approving into a category with rules", () => {
  const rules = { tournament: randomUUID(), wd: randomUUID(), vets: randomUUID(), cap: randomUUID(), other: randomUUID(), min: randomUUID() };

  beforeAll(async () => {
    await db.insert(schema.tournaments).values({
      id: rules.tournament, slug: "rules-cup", name: "Rules Cup", sport: "pb",
      format: "standard", ownerId: ids.owner, status: "open", minTeamSize: 2, maxTeamSize: 2,
    });
    await db.insert(schema.divisions).values([
      { id: rules.wd, tournamentId: rules.tournament, name: "Women's Doubles", position: 0, genderRule: "F" },
      { id: rules.vets, tournamentId: rules.tournament, name: "Vets", position: 1, ageMin: 35, ageOn: "2026-10-12" },
      { id: rules.cap, tournamentId: rules.tournament, name: "Capped", position: 2, ratingMax: 1049 },
      { id: rules.other, tournamentId: rules.tournament, name: "Open", position: 3 },
      { id: rules.min, tournamentId: rules.tournament, name: "Rated Only", position: 4, ratingMin: 750 },
    ]);
  });

  type P = { name: string; phone?: string | null; gender?: "M" | "F"; dob?: string | null; dupr?: number | null };
  async function ruledEntry(divisionId: string | null, squad: P[], teamName: string) {
    const registrationId = randomUUID();
    await db.insert(schema.registrations).values({
      id: registrationId, tournamentId: rules.tournament, divisionId, teamName,
      contactName: squad[0].name, contactPhone: squad[0].phone ?? null, status: "pending",
    });
    await db.insert(schema.registrationPlayers).values(squad.map((p, i) => ({
      id: randomUUID(), registrationId, name: p.name, phone: p.phone ?? null,
      gender: p.gender ?? ("F" as const), dob: p.dob ?? null, dupr: p.dupr ?? null, position: i,
    })));
    return registrationId;
  }
  const peopleCount = async () => (await db.select().from(schema.people)).length;
  const teamCount = async () => (await db.select().from(schema.teams)).length;
  const statusOf = async (id: string) =>
    (await db.select().from(schema.registrations).where(eq(schema.registrations.id, id)))[0].status;

  it("refuses a man into Women's Doubles, and creates nothing", async () => {
    const id = await ruledEntry(rules.wd, [
      { name: "Priya", phone: "+919000000301", gender: "F" },
      { name: "Ravi", phone: "+919000000302", gender: "M" },
    ], "Mixed Up");
    const peopleBefore = await peopleCount();
    const teamsBefore = await teamCount();

    const res = await approve.approveRegistration(id);

    expect(res.ok).toBe(false);
    expect(!res.ok && res.error).toBe("Can't approve into Women's Doubles: Ravi (Women only)");
    expect(await peopleCount()).toBe(peopleBefore);
    expect(await teamCount()).toBe(teamsBefore);
    expect(await statusOf(id)).toBe("pending");
  });

  it("approves a pair that fits, and carries what they declared onto the players", async () => {
    const id = await ruledEntry(rules.wd, [
      { name: "Asha", phone: "+919000000303", gender: "F", dob: "1990-05-17", dupr: 375 },
      { name: "Meera", phone: "+919000000304", gender: "F" },
    ], "Net Queens");
    const res = await approve.approveRegistration(id);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;

    const squad = await db.select().from(schema.players).where(eq(schema.players.teamId, res.teamId));
    const asha = squad.find((p) => p.name === "Asha")!;
    expect(asha.dob).toBe("1990-05-17");
    expect(asha.dupr).toBe(375);
  });

  it("refuses an entry that fitted when sent but not the category as it is now", async () => {
    const id = await ruledEntry(rules.vets, [
      { name: "Sanjay", phone: "+919000000305", gender: "M", dob: "1988-01-01" },
      { name: "Imran", phone: "+919000000306", gender: "M", dob: "1985-01-01" },
    ], "Old Hands");
    /* 38 and 41 on the day: they fit 35+. The organiser then makes it 40+. */
    await db.update(schema.divisions).set({ ageMin: 40 }).where(eq(schema.divisions.id, rules.vets));

    const res = await approve.approveRegistration(id);
    expect(!res.ok && res.error).toBe("Can't approve into Vets: Sanjay (Age 40+ only (on 12 Oct 2026))");

    await db.update(schema.divisions).set({ ageMin: 35 }).where(eq(schema.divisions.id, rules.vets));
    expect((await approve.approveRegistration(id)).ok).toBe(true);
  });

  it("refuses an entry whose category was removed, when there is more than one left", async () => {
    const id = await ruledEntry(null, [{ name: "Lost", phone: null }, { name: "Found", phone: null }], "Orphans");
    const res = await approve.approveRegistration(id);
    expect(!res.ok && res.error).toBe("This entry's category was removed. Decline it, or ask them to enter again.");
  });

  it("refuses an entry from another event", async () => {
    const id = await ruledEntry(rules.other, [{ name: "Elsewhere" }, { name: "Too" }], "Wrong Event");
    const res = await approve.approveRegistration(id, null, { tournamentId: ids.tournament });
    expect(!res.ok && res.error).toBe("That entry is not part of this event.");
    expect(await statusOf(id)).toBe("pending");
  });

  it("fills an empty date of birth on the person, and never overwrites one", async () => {
    const known = randomUUID();
    await db.insert(schema.people).values({ id: known, name: "Known", phone: "+919000000308", dob: "1970-01-01" });

    const id = await ruledEntry(rules.other, [
      { name: "Fresh", phone: "+919000000307", dob: "1999-09-09" },
      { name: "Known", phone: "+919000000308", dob: "2001-01-01" },
    ], "Dates");
    expect((await approve.approveRegistration(id)).ok).toBe(true);

    const [fresh] = await db.select().from(schema.people).where(eq(schema.people.phone, "+919000000307"));
    const [kept] = await db.select().from(schema.people).where(eq(schema.people.id, known));
    expect(fresh.dob).toBe("1999-09-09");
    expect(kept.dob).toBe("1970-01-01");
  });

  it("keeps a returning strong player out of a capped category, and lets newcomers in", async () => {
    await db.insert(schema.people).values({
      id: randomUUID(), name: "Strong", phone: "+919000000309",
      riseRatings: { "pb:md": 1200 }, riseBest: 1200, matchCount: { "pb:md": 6 },
    });
    const strong = await ruledEntry(rules.cap, [
      { name: "Strong", phone: "+919000000309" }, { name: "Partner", phone: "+919000000310" },
    ], "Sandbaggers");
    const refused = await approve.approveRegistration(strong);
    expect(!refused.ok && refused.error).toBe("Can't approve into Capped: Strong (Rating 1049 and under only)");

    /* Two phones nobody has seen: unrated, which under an "up to" limit is a
       note for the organiser and never a refusal (Faisal, 2026-09-17). */
    const newcomers = await ruledEntry(rules.cap, [
      { name: "New One", phone: "+919000000311" }, { name: "New Two", phone: "+919000000312" },
    ], "Beginners");
    expect((await approve.approveRegistration(newcomers)).ok).toBe(true);
  });

  it("agrees with the manage screen's flags about the same player", async () => {
    /* A stored date of birth says 30; the entry declared 36. Approval judges
       the declaration, carries it onto the player row, and the flags read that
       row first — so the team approval let in is not marked red a moment later. */
    await db.insert(schema.people).values({ id: randomUUID(), name: "Disputed", phone: "+919000000313", dob: "1996-06-06" });
    const id = await ruledEntry(rules.vets, [
      { name: "Disputed", phone: "+919000000313", gender: "M", dob: "1990-01-01" },
      { name: "Steady", phone: "+919000000314", gender: "M", dob: "1980-01-01" },
    ], "Agreement");
    const res = await approve.approveRegistration(id);
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    if (!res.ok) return;

    const { divisionMisfits } = await import("@/lib/eligibility/store");
    const flagged = (await divisionMisfits(rules.tournament)).find((m) => m.teamId === res.teamId);
    expect(flagged?.reasons ?? []).toEqual([]);
    /* Nothing is refused on it — neither date is proof — but the organiser is
       shown that the app holds a different one, because they are the one who
       can ask. */
    expect(flagged?.notes ?? []).toEqual([
      "Disputed: Date of birth typed here (1 Jan 1990) is not the one on file",
    ]);
  });

  it("judges a shared phone the way it will be stored, not twice over", async () => {
    /* A rating limit makes the phone the evidence, so one number can only
       stand for one player: the write links the first and deliberately leaves
       the second unlinked. Judged with both borrowing the same person, the
       entry was approved and the manage screen then flagged it red for the
       player it had just unlinked — with no waiver to be had. */
    await db.insert(schema.people).values({
      id: randomUUID(), name: "Rated", phone: "+919000000315",
      riseRatings: { "pb:md": 900 }, riseBest: 900, matchCount: { "pb:md": 5 },
    });
    const together = await ruledEntry(rules.min, [
      { name: "Rated", phone: "+919000000315", gender: "F" },
      { name: "Plus One", phone: "+919000000315", gender: "F" },
    ], "One Phone");
    const res = await approve.approveRegistration(together);
    expect(!res.ok && res.error).toBe("Can't approve into Rated Only: Plus One (Rating 750+ only (unrated))");

    /* Their own number, and the same pair goes through. */
    await db.update(schema.registrationPlayers)
      .set({ phone: "+919000000316" })
      .where(eq(schema.registrationPlayers.name, "Plus One"));
    await db.insert(schema.people).values({
      id: randomUUID(), name: "Plus One", phone: "+919000000316",
      riseRatings: { "pb:md": 800 }, riseBest: 800, matchCount: { "pb:md": 2 },
    });
    expect((await approve.approveRegistration(together)).ok).toBe(true);
  });
});
