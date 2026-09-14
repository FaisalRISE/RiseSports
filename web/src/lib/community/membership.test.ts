import { describe, it, expect, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

const client = new PGlite();
const testDb = drizzle(client, { schema });

vi.mock("@/lib/db", () => ({ db: testDb }));
vi.mock("server-only", () => ({}));

const dir = path.resolve(process.cwd(), "drizzle");
for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".sql")).sort()) {
  for (const stmt of fs.readFileSync(path.join(dir, f), "utf8").split("--> statement-breakpoint")) {
    if (stmt.trim()) await client.exec(stmt.trim());
  }
}

const m = await import("./membership");
const { canJoinSessions } = await import("./store");
const { confirmPlayer } = await import("./roster");

let game: schema.CommunityGame;
let openGame: schema.CommunityGame;

beforeEach(async () => {
  await testDb.delete(schema.communityGames);
  await testDb.delete(schema.people);

  await testDb.insert(schema.people).values(
    Array.from({ length: 6 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` })),
  );

  [game] = await testDb.insert(schema.communityGames).values({
    id: "g1", slug: "g1", name: "Invite Only", accessType: "restricted", hostPersonId: "p1",
  }).returning();

  [openGame] = await testDb.insert(schema.communityGames).values({
    id: "g2", slug: "g2", name: "Open Game", accessType: "open", hostPersonId: "p1",
  }).returning();
});

describe("standing", () => {
  it("is none for somebody with no row", async () => {
    expect(await m.standingOf(game, "p2")).toBe("none");
  });

  it("is organiser for the host, with no row needed", async () => {
    expect(await m.standingOf(game, "p1")).toBe("organiser");
    expect(await testDb.select().from(schema.communityMembers)).toHaveLength(0);
  });

  it("is none for a viewer who has not said who they are", async () => {
    expect(await m.standingOf(game, null)).toBe("none");
  });
});

describe("asking to join", () => {
  it("puts a request in front of the host", async () => {
    expect(await m.requestToJoin(game, "p2")).toEqual({ ok: true, standing: "requested" });
    expect((await m.membersOf(game)).requested.map((r) => r.personId)).toEqual(["p2"]);
  });

  it("refuses a second ask", async () => {
    await m.requestToJoin(game, "p2");
    expect((await m.requestToJoin(game, "p2")).ok).toBe(false);
  });

  it("refuses somebody already in", async () => {
    await m.requestToJoin(game, "p2");
    await m.approveRequest(game, "p2");
    expect((await m.requestToJoin(game, "p2")).ok).toBe(false);
  });

  it("points an invited player at their invitation instead", async () => {
    /* Accepting is one tap and needs nobody; turning it into a request would
       put them back in a queue they had already been let out of. */
    await m.invitePlayer(game, "p2");
    const res = await m.requestToJoin(game, "p2");
    expect(res.ok).toBe(false);
    expect(res.ok === false && res.error).toContain("invitation");
    expect(await m.standingOf(game, "p2")).toBe("invited");
  });
});

describe("invitations", () => {
  it("is one tap to accept", async () => {
    await m.invitePlayer(game, "p2");
    expect(await m.acceptInvitation(game, "p2")).toEqual({ ok: true, standing: "member" });
  });

  it("cannot be accepted by somebody who was never invited", async () => {
    expect((await m.acceptInvitation(game, "p3")).ok).toBe(false);
  });

  it("can be cancelled before it is taken up", async () => {
    await m.invitePlayer(game, "p2");
    expect((await m.cancelInvitation(game, "p2")).ok).toBe(true);
    expect(await m.standingOf(game, "p2")).toBe("none");
  });

  it("cannot be cancelled once accepted", async () => {
    await m.invitePlayer(game, "p2");
    await m.acceptInvitation(game, "p2");
    expect((await m.cancelInvitation(game, "p2")).ok).toBe(false);
    expect(await m.standingOf(game, "p2")).toBe("member");
  });

  it("lets somebody in directly when they had already asked", async () => {
    /* The host has said yes either way. Leaving them on the request list after
       tapping invite would read as the tap having done nothing. */
    await m.requestToJoin(game, "p2");
    expect(await m.invitePlayer(game, "p2")).toEqual({ ok: true, standing: "member" });
    const list = await m.membersOf(game);
    expect(list.requested).toEqual([]);
    expect(list.members.map((r) => r.personId)).toEqual(["p2"]);
  });

  it("refuses to invite somebody already in", async () => {
    await m.invitePlayer(game, "p2");
    await m.acceptInvitation(game, "p2");
    expect((await m.invitePlayer(game, "p2")).ok).toBe(false);
  });
});

describe("the host deciding", () => {
  it("approves a request into membership", async () => {
    await m.requestToJoin(game, "p2");
    expect(await m.approveRequest(game, "p2")).toEqual({ ok: true, standing: "member" });
    const list = await m.membersOf(game);
    expect(list.requested).toEqual([]);
    expect(list.members.map((r) => r.personId)).toEqual(["p2"]);
  });

  it("denies one without leaving a trace", async () => {
    await m.requestToJoin(game, "p2");
    expect((await m.denyRequest(game, "p2")).ok).toBe(true);
    expect(await m.standingOf(game, "p2")).toBe("none");
    expect(await testDb.select().from(schema.communityMembers)).toHaveLength(0);
  });

  it("will not approve somebody who never asked", async () => {
    expect((await m.approveRequest(game, "p3")).ok).toBe(false);
  });

  it("removes a member", async () => {
    await m.invitePlayer(game, "p2");
    await m.acceptInvitation(game, "p2");
    expect((await m.removeMember(game, "p2")).ok).toBe(true);
    expect(await m.standingOf(game, "p2")).toBe("none");
  });

  it("cannot remove the organiser", async () => {
    const res = await m.removeMember(game, "p1");
    expect(res.ok).toBe(false);
    expect(await m.standingOf(game, "p1")).toBe("organiser");
  });
});

describe("leaving", () => {
  it("lets a member go", async () => {
    await m.invitePlayer(game, "p2");
    await m.acceptInvitation(game, "p2");
    expect((await m.leaveGame(game, "p2")).ok).toBe(true);
    expect(await m.standingOf(game, "p2")).toBe("none");
  });

  it("withdraws a request", async () => {
    await m.requestToJoin(game, "p2");
    await m.leaveGame(game, "p2");
    expect(await m.standingOf(game, "p2")).toBe("none");
  });

  it("declines an invitation", async () => {
    await m.invitePlayer(game, "p2");
    await m.leaveGame(game, "p2");
    expect(await m.standingOf(game, "p2")).toBe("none");
  });

  it("will not let the organiser abandon their own game", async () => {
    expect((await m.leaveGame(game, "p1")).ok).toBe(false);
  });
});

describe("what membership actually gates", () => {
  it("keeps a non-member out of the dates", async () => {
    expect(await canJoinSessions(game, "p2")).toBe(false);
  });

  it("lets a member in", async () => {
    await m.invitePlayer(game, "p2");
    await m.acceptInvitation(game, "p2");
    expect(await canJoinSessions(game, "p2")).toBe(true);
  });

  it("does not let a pending request in", async () => {
    /* Asking is not belonging — that is the whole point of the state. */
    await m.requestToJoin(game, "p2");
    expect(await canJoinSessions(game, "p2")).toBe(false);
  });

  it("does not let an un-accepted invitation in either", async () => {
    await m.invitePlayer(game, "p2");
    expect(await canJoinSessions(game, "p2")).toBe(false);
  });

  it("always lets the organiser in", async () => {
    expect(await canJoinSessions(game, "p1")).toBe(true);
  });

  it("lets anyone into an OPEN game, with no rows at all", async () => {
    expect(await canJoinSessions(openGame, "p5")).toBe(true);
    expect(await canJoinSessions(openGame, null)).toBe(true);
    const list = await m.membersOf(openGame);
    expect([...list.members, ...list.requested, ...list.invited]).toEqual([]);
  });
});

describe("removing a member", () => {
  it("leaves the sessions they already played alone", async () => {
    /* Their attendance is a record of what happened, and the ratings those
       results moved point at it. Removal is about future dates. */
    await m.invitePlayer(game, "p2");
    await m.acceptInvitation(game, "p2");
    await confirmPlayer(game, "2026-09-17", "p2");
    expect(await testDb.select().from(schema.communityAttendance)).toHaveLength(1);

    await m.removeMember(game, "p2");
    expect(await testDb.select().from(schema.communityAttendance)).toHaveLength(1);
  });
});

describe("one row per person", () => {
  it("never leaves somebody in two states at once", async () => {
    await m.requestToJoin(game, "p2");
    await m.invitePlayer(game, "p2");
    await m.approveRequest(game, "p2");

    const rows = await testDb.select().from(schema.communityMembers)
      .where(eq(schema.communityMembers.personId, "p2"));
    expect(rows).toHaveLength(1);
  });

  it("holds even when two requests land at once", async () => {
    await Promise.all([m.requestToJoin(game, "p3"), m.requestToJoin(game, "p3")]);
    const rows = await testDb.select().from(schema.communityMembers)
      .where(eq(schema.communityMembers.personId, "p3"));
    expect(rows).toHaveLength(1);
  });
});
