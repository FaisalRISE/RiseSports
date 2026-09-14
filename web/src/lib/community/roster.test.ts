import { describe, it, expect, beforeEach, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import fs from "node:fs";
import path from "node:path";

import * as schema from "@/lib/db/schema";

/* The roster runs against the database — the unique index and the transaction
 * ARE the state machine's guarantees, so testing it against a fake store would
 * test nothing that matters. PGlite is Postgres compiled to WASM, so the index,
 * the CHECK and the transaction all behave as they will in production.
 *
 * `@/lib/db` is mocked to this instance because the module reads DATABASE_URL at
 * import time and opens a pooled connection. */
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

const {
  toggleInterested, requestSpot, withdraw, takeFreedSpot,
  confirmPlayer, waitlistPlayer, promoteFromWaitlist, removePlayer, nudgeToRequest,
  togglePaid, markLinkSent, openSlotsIn,
} = await import("./roster");
const { sessionView } = await import("./store");

const DATE = "2026-09-17";
let game: schema.CommunityGame;

/** A game with `courts × perCourt` spots and a pool of people to fill it. */
async function freshGame(courts = 1, perCourt = 4) {
  await testDb.delete(schema.communityGames);
  await testDb.delete(schema.people);

  const [g] = await testDb
    .insert(schema.communityGames)
    .values({ id: "g1", slug: "g1", name: "Thursday Night", courts, perCourt })
    .returning();

  await testDb.insert(schema.people).values(
    Array.from({ length: 10 }, (_, i) => ({ id: `p${i + 1}`, name: `Player ${i + 1}` })),
  );
  return g;
}

/** The roster split by state, for terse assertions. */
async function roster() {
  const v = await sessionView(game, DATE);
  return {
    confirmed: v.confirmed.map((r) => r.personId),
    waitlist: v.waitlist.map((r) => r.personId),
    requested: v.requested.map((r) => r.personId),
    interested: v.interested.map((r) => r.personId),
  };
}

const stateOf = async (personId: string) => {
  const v = await sessionView(game, DATE);
  return v.roster.find((r) => r.personId === personId)?.state ?? "none";
};

beforeEach(async () => {
  game = await freshGame();
});

describe("a person is in exactly one state", () => {
  it("cannot be confirmed and waitlisted at once", async () => {
    /* The legacy version keeps four arrays and resolves an overlap by priority
       (app.source.js:10015). One row cannot overlap, so there is no priority
       rule to get wrong. */
    await confirmPlayer(game, DATE, "p1");
    await waitlistPlayer(game, DATE, "p1");

    const r = await roster();
    expect(r.confirmed).not.toContain("p1");
    expect(r.waitlist).toEqual(["p1"]);
  });

  it("moves cleanly through interested → requested → confirmed", async () => {
    await toggleInterested(game, DATE, "p1");
    expect(await stateOf("p1")).toBe("interested");

    await nudgeToRequest(game, DATE, "p1");
    expect(await stateOf("p1")).toBe("requested");

    await confirmPlayer(game, DATE, "p1");
    expect(await stateOf("p1")).toBe("confirmed");

    const r = await roster();
    expect(r.interested).toEqual([]);
    expect(r.requested).toEqual([]);
    expect(r.confirmed).toEqual(["p1"]);
  });
});

describe("marking yourself interested", () => {
  it("toggles off again", async () => {
    await toggleInterested(game, DATE, "p1");
    await toggleInterested(game, DATE, "p1");
    expect(await stateOf("p1")).toBe("none");
  });

  it("refuses to demote someone who already has a spot", async () => {
    /* The sharp edge in the legacy toggle: without this guard, a confirmed
       player tapping "interested" drops themselves out of the session. */
    await confirmPlayer(game, DATE, "p1");
    const res = await toggleInterested(game, DATE, "p1");
    expect(res.ok).toBe(false);
    expect(await stateOf("p1")).toBe("confirmed");
  });
});

describe("confirming into a full session", () => {
  it("waitlists rather than failing", async () => {
    for (const p of ["p1", "p2", "p3", "p4"]) await confirmPlayer(game, DATE, p);
    const res = await confirmPlayer(game, DATE, "p5");

    expect(res).toEqual({ ok: true, state: "waitlist" });
    const r = await roster();
    expect(r.confirmed).toHaveLength(4);
    expect(r.waitlist).toEqual(["p5"]);
  });

  it("never seats more than the capacity", async () => {
    for (const p of ["p1", "p2", "p3", "p4", "p5", "p6", "p7"]) await confirmPlayer(game, DATE, p);
    const r = await roster();
    expect(r.confirmed).toHaveLength(4);
    expect(r.waitlist).toEqual(["p5", "p6", "p7"]);
  });

  it("keeps the waitlist in the order people joined it", async () => {
    for (const p of ["p1", "p2", "p3", "p4"]) await confirmPlayer(game, DATE, p);
    for (const p of ["p7", "p5", "p6"]) await confirmPlayer(game, DATE, p);
    expect((await roster()).waitlist).toEqual(["p7", "p5", "p6"]);
  });
});

describe("backing out", () => {
  it("frees a spot and remembers that it was freed", async () => {
    for (const p of ["p1", "p2", "p3", "p4"]) await confirmPlayer(game, DATE, p);
    await confirmPlayer(game, DATE, "p5"); // waitlisted

    await withdraw(game, DATE, "p2");

    const r = await roster();
    expect(r.confirmed).toHaveLength(3);
    expect(await stateOf("p2")).toBe("withdrawn");
    /* Not in any of the four lists a player sees — withdrawn is its own thing. */
    expect([...r.confirmed, ...r.waitlist, ...r.requested, ...r.interested]).not.toContain("p2");
  });

  it("lets a waitlisted player take the freed spot", async () => {
    for (const p of ["p1", "p2", "p3", "p4"]) await confirmPlayer(game, DATE, p);
    await confirmPlayer(game, DATE, "p5");

    expect((await takeFreedSpot(game, DATE, "p5")).ok).toBe(false); // nothing free yet

    await withdraw(game, DATE, "p2");
    expect(await takeFreedSpot(game, DATE, "p5")).toEqual({ ok: true, state: "confirmed" });

    const r = await roster();
    expect(r.confirmed).toContain("p5");
    expect(r.waitlist).toEqual([]);
  });

  it("does not let two waitlisted players take one freed spot", async () => {
    for (const p of ["p1", "p2", "p3", "p4"]) await confirmPlayer(game, DATE, p);
    for (const p of ["p5", "p6"]) await confirmPlayer(game, DATE, p);

    await withdraw(game, DATE, "p1");
    expect((await takeFreedSpot(game, DATE, "p5")).ok).toBe(true);
    expect((await takeFreedSpot(game, DATE, "p6")).ok).toBe(false);

    expect((await roster()).confirmed).toHaveLength(4);
  });

  it("removes someone who had not been confirmed, with nothing to free", async () => {
    await requestSpot(game, DATE, "p1");
    await withdraw(game, DATE, "p1");
    expect(await stateOf("p1")).toBe("none");
  });

  it("lets someone who backed out sign up again", async () => {
    await confirmPlayer(game, DATE, "p1");
    await withdraw(game, DATE, "p1");
    expect((await requestSpot(game, DATE, "p1")).ok).toBe(true);
    expect(await stateOf("p1")).toBe("requested");
  });
});

describe("openSlotsIn", () => {
  /* The derived replacement for the legacy mutable `openSlots` counter. Both
     terms are load-bearing, so both are pinned. */
  it("is zero when nobody has backed out, however empty the session", () => {
    expect(openSlotsIn({ confirmed: 1, withdrawn: 0, maxWaitlistPosition: 0 }, 8)).toBe(0);
  });

  it("is zero once the freed spots have been refilled", () => {
    expect(openSlotsIn({ confirmed: 8, withdrawn: 2, maxWaitlistPosition: 0 }, 8)).toBe(0);
  });

  it("counts only the spots that are both freed and still empty", () => {
    expect(openSlotsIn({ confirmed: 7, withdrawn: 2, maxWaitlistPosition: 0 }, 8)).toBe(1);
    expect(openSlotsIn({ confirmed: 6, withdrawn: 2, maxWaitlistPosition: 0 }, 8)).toBe(2);
  });

  it("never goes negative", () => {
    expect(openSlotsIn({ confirmed: 9, withdrawn: 1, maxWaitlistPosition: 0 }, 8)).toBe(0);
  });
});

describe("the host promoting from the waitlist", () => {
  it("may fill a spot even though nobody backed out", async () => {
    /* A player may only move up into a spot a backout freed; the host may fill
       the session whenever there is room. It is their session. */
    await waitlistPlayer(game, DATE, "p1");
    expect((await takeFreedSpot(game, DATE, "p1")).ok).toBe(false);
    expect(await promoteFromWaitlist(game, DATE, "p1")).toEqual({ ok: true, state: "confirmed" });
  });

  it("refuses when the session is full", async () => {
    for (const p of ["p1", "p2", "p3", "p4"]) await confirmPlayer(game, DATE, p);
    await confirmPlayer(game, DATE, "p5");
    expect((await promoteFromWaitlist(game, DATE, "p5")).ok).toBe(false);
  });
});

describe("removing someone the host has confirmed", () => {
  it("frees their spot for the waitlist", async () => {
    for (const p of ["p1", "p2", "p3", "p4"]) await confirmPlayer(game, DATE, p);
    await confirmPlayer(game, DATE, "p5");

    await removePlayer(game, DATE, "p3");
    expect(await takeFreedSpot(game, DATE, "p5")).toEqual({ ok: true, state: "confirmed" });
  });

  it("clears a paid flag so a refund is not hidden", async () => {
    await confirmPlayer(game, DATE, "p1");
    await togglePaid(game, DATE, "p1");
    await removePlayer(game, DATE, "p1");

    const [row] = await testDb.select().from(schema.communityAttendance);
    expect(row.paid).toBe(false);
  });
});

describe("money", () => {
  it("toggles paid without changing the person's state", async () => {
    await confirmPlayer(game, DATE, "p1");
    await togglePaid(game, DATE, "p1");

    let v = await sessionView(game, DATE);
    expect(v.confirmed[0].paid).toBe(true);
    expect(v.confirmed[0].state).toBe("confirmed");

    await togglePaid(game, DATE, "p1");
    v = await sessionView(game, DATE);
    expect(v.confirmed[0].paid).toBe(false);
  });

  it("records when a payment link went out", async () => {
    await confirmPlayer(game, DATE, "p1");
    expect((await sessionView(game, DATE)).confirmed[0].paymentLinkSentAt).toBeNull();

    await markLinkSent(game, DATE, "p1");
    expect((await sessionView(game, DATE)).confirmed[0].paymentLinkSentAt).toBeInstanceOf(Date);
  });

  it("refuses to mark someone paid who is not on the list", async () => {
    expect((await togglePaid(game, DATE, "p9")).ok).toBe(false);
  });
});

describe("two people acting at once", () => {
  it("seats only as many as there are spots when everyone confirms together", async () => {
    /* Six requests land simultaneously on a four-spot session. Every action
       re-reads the count inside its own transaction, so the overflow becomes a
       waitlist rather than a fifth player on a full court. */
    const people = ["p1", "p2", "p3", "p4", "p5", "p6"];
    await Promise.all(people.map((p) => confirmPlayer(game, DATE, p)));

    const r = await roster();
    expect(r.confirmed.length).toBeLessThanOrEqual(4);
    expect(r.confirmed.length + r.waitlist.length).toBe(6);
  });

  it("keeps one row per person when the same person is tapped twice at once", async () => {
    await Promise.all([requestSpot(game, DATE, "p1"), requestSpot(game, DATE, "p1")]);
    const rows = await testDb.select().from(schema.communityAttendance);
    expect(rows.filter((r) => r.personId === "p1")).toHaveLength(1);
  });
});

describe("a session opens only when somebody acts on it", () => {
  it("does not create a row just because a date was looked at", async () => {
    await sessionView(game, DATE);
    expect(await testDb.select().from(schema.communitySessions)).toHaveLength(0);
  });

  it("creates exactly one when the first person acts", async () => {
    await toggleInterested(game, DATE, "p1");
    await toggleInterested(game, DATE, "p2");
    expect(await testDb.select().from(schema.communitySessions)).toHaveLength(1);
  });
});
