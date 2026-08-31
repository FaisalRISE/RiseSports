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
