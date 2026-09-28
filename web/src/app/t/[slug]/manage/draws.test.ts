import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";

/* The three draws against a real database, through the real actions.
 *
 * What they used to do, each tested here by its opposite:
 *   - "Draw groups & fixtures" deleted PLAYED group matches, and the rating
 *     history cascaded away with them while the players' ratings stayed moved;
 *   - "Draw knockout" kept a played row and added a second "Semi-Final 1" and a
 *     second "Final" beside it;
 *   - "Draw the bracket" on a category switched from groups left the empty
 *     group tables behind — and deleted a match the organiser added by hand;
 *   - an unknown or foreign category id quietly redrew the FIRST category;
 *   - removeMatch and setLineup acted on any event's match by id. */

vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
/* redirect() works by throwing; here it throws something the test can read. */
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`REDIRECT ${url}`); },
}));

const dir = path.join(os.tmpdir(), `rise-draws-${randomUUID()}`);
process.env.DATABASE_URL = `pglite://${dir.replace(/\\/g, "/")}`;

let actions: typeof import("./actions");
let apply: typeof import("@/lib/rating/apply");
let guard: typeof import("@/lib/draw/guard");
let db: typeof import("@/lib/db").db;
let schema: typeof import("@/lib/db/schema");
let eq: typeof import("drizzle-orm").eq;
let and: typeof import("drizzle-orm").and;

const owner = randomUUID();

/** An event with one groups-then-knockout category and four teams, each with
    two players linked to people, so a result moves real ratings. */
async function event(slug: string) {
  const id = randomUUID();
  await db.insert(schema.tournaments).values({
    id, slug, name: slug, sport: "pb", format: "standard", ownerId: owner, status: "draft",
    minTeamSize: 2, maxTeamSize: 2,
  });
  const divisionId = randomUUID();
  await db.insert(schema.divisions).values({ id: divisionId, tournamentId: id, name: "Main", shape: "groups_ko", genderRule: "M" });
  const teamIds: string[] = [];
  for (let i = 0; i < 4; i++) {
    const teamId = randomUUID();
    teamIds.push(teamId);
    await db.insert(schema.teams).values({ id: teamId, tournamentId: id, divisionId, name: `${slug}-T${i + 1}`, seed: i + 1 });
    for (let k = 0; k < 2; k++) {
      const personId = randomUUID();
      await db.insert(schema.people).values({ id: personId, name: `${slug}-${i}${k}`, gender: "M", riseRatings: { "pb:md": 1000 }, riseBest: 1000, matchCount: {}, seedSource: "organiser" });
      await db.insert(schema.players).values({ id: randomUUID(), tournamentId: id, teamId, personId, name: `${slug}-${i}${k}`, gender: "M", ratings: { "pb:md": 1000 } });
    }
  }
  return { id, slug, divisionId, teamIds };
}

/* What the manage page puts on a draw button: the fingerprint of exactly the
   rows this draw would replace, as the page saw them (DrawButton). */
async function pageToken(divisionId: string, kind: "whole" | "bracket") {
  const rows = await db.select().from(schema.matches).where(eq(schema.matches.divisionId, divisionId));
  const replaced = rows.filter((m) => (kind === "bracket" ? m.bracket !== null : m.groupId !== null || m.bracket !== null));
  return guard.drawSignature(replaced.map((m) => m.id));
}

/* A draw post as the page makes it. `unconfirmed` is one without the
   fingerprint — Enter pressed before the second tap, or a crafted post;
   `token` is a page that saw something else (a stale phone). */
const form = async (fields: Record<string, string>, { unconfirmed = false, token }: { unconfirmed?: boolean; token?: string } = {}) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  if (!unconfirmed) f.set("confirm", token ?? (await pageToken(fields.divisionId ?? "", "qualify" in fields ? "bracket" : "whole")));
  return f;
};

/** The redirect a draw ended with, or null when it drew without one. */
const outcome = (p: Promise<unknown>) =>
  p.then(() => null, (e: Error) => {
    if (!e.message.startsWith("REDIRECT ")) throw e;
    return new URL(e.message.slice(9), "http://x").searchParams.get("problem");
  });

const matchesOf = (divisionId: string) =>
  db.select().from(schema.matches).where(eq(schema.matches.divisionId, divisionId));

/** Record a typed result and let it move ratings, as a real save would. */
async function play(matchId: string) {
  await db.update(schema.matches).set({ typedScoreA: 11, typedScoreB: 5, rev: 1 }).where(eq(schema.matches.id, matchId));
  return apply.applyMatchRatings(matchId);
}

beforeAll(async () => {
  ({ db } = await import("@/lib/db"));
  schema = await import("@/lib/db/schema");
  actions = await import("./actions");
  apply = await import("@/lib/rating/apply");
  guard = await import("@/lib/draw/guard");
  ({ eq, and } = await import("drizzle-orm"));

  const migrations = path.resolve(process.cwd(), "drizzle");
  for (const f of fs.readdirSync(migrations).filter((x) => x.endsWith(".sql")).sort()) {
    const sql = fs.readFileSync(path.join(migrations, f), "utf8");
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const t = stmt.trim();
      if (t) await db.execute(t as never);
    }
  }
  await db.insert(schema.users).values({ id: owner, email: "o@e.st", name: "Organiser" });
}, 120_000);

afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("redrawing the groups", () => {
  it("replaces everything while nothing has been played", async () => {
    const t = await event("fresh-groups");
    expect(await outcome(actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "2" })))).toBeNull();
    const first = (await matchesOf(t.divisionId)).map((m) => m.id);
    expect(first.length).toBe(2); // two groups of two: one fixture each

    expect(await outcome(actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "1" })))).toBeNull();
    const second = await matchesOf(t.divisionId);
    expect(second.length).toBe(6); // one group of four
    expect(second.some((m) => first.includes(m.id))).toBe(false);
  });

  /* The second tap is enforced on the server: pressing Enter in the form before
     "Yes, redraw" posts without it, and used to redraw anyway. */
  it("refuses a redraw that was not confirmed, and changes nothing", async () => {
    const t = await event("unconfirmed");
    await actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "2" }, { unconfirmed: true }));
    const first = (await matchesOf(t.divisionId)).map((m) => m.id).sort();
    expect(first.length).toBe(2); // a FIRST draw needs no confirmation

    expect(await outcome(actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "1" }, { unconfirmed: true }))))
      .toBe("confirm-needed");
    expect((await matchesOf(t.divisionId)).map((m) => m.id).sort()).toEqual(first);
  });

  /* A phone left open since before the first draw shows the one-tap FIRST-draw
     button. Meanwhile a laptop draws. The phone's tap must not replace the
     laptop's fixtures: it never showed them, so it never asked. */
  it("refuses a draw from a page opened before somebody else drew", async () => {
    const t = await event("stale-page");
    const phone = await pageToken(t.divisionId, "whole"); // the phone's page: nothing drawn yet
    await actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "2" })); // the laptop draws
    const drawn = (await matchesOf(t.divisionId)).map((m) => m.id).sort();
    expect(drawn.length).toBe(2);

    expect(await outcome(actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "1" }, { token: phone }))))
      .toBe("draw-stale");
    expect((await matchesOf(t.divisionId)).map((m) => m.id).sort()).toEqual(drawn);
  });

  it("is refused once a group match has a result, and the result and its ratings survive", async () => {
    const t = await event("played-groups");
    await actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "1" }));
    const [m] = await matchesOf(t.divisionId);
    expect((await play(m.id)).status).toBe("applied");

    expect(await outcome(actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "2" })))).toBe("draw-locked");

    const after = await matchesOf(t.divisionId);
    expect(after.length).toBe(6);
    expect(after.find((x) => x.id === m.id)?.typedScoreA).toBe(11);
    expect((await db.select().from(schema.ratingHistory).where(eq(schema.ratingHistory.matchId, m.id))).length).toBe(4);
  });
});

describe("redrawing the knockout", () => {
  it("is refused once a knockout match has a result, and never makes a second Final", async () => {
    const t = await event("played-ko");
    await actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "2" }));
    await actions.generateKnockout(t.id, await form({ divisionId: t.divisionId, qualify: "2" }));
    const sf1 = (await matchesOf(t.divisionId)).find((x) => x.round === "Semi-Final 1")!;
    /* Played straight onto the row: its teams are placeholders until the groups
       finish, which is not what this test is about. */
    await db.update(schema.matches).set({ typedScoreA: 11, typedScoreB: 9 }).where(eq(schema.matches.id, sf1.id));

    expect(await outcome(actions.generateKnockout(t.id, await form({ divisionId: t.divisionId, qualify: "2" })))).toBe("draw-locked");

    const rounds = (await matchesOf(t.divisionId)).filter((x) => x.bracket).map((x) => x.round);
    expect(rounds.filter((r) => r === "Semi-Final 1")).toHaveLength(1);
    expect(rounds.filter((r) => r === "Final")).toHaveLength(1);
  });

  it("replaces an unplayed knockout, keeping the groups", async () => {
    const t = await event("fresh-ko");
    await actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "2" }));
    await actions.generateKnockout(t.id, await form({ divisionId: t.divisionId, qualify: "2" }));
    const before = await matchesOf(t.divisionId);
    await actions.generateKnockout(t.id, await form({ divisionId: t.divisionId, qualify: "1" }));
    const after = await matchesOf(t.divisionId);
    expect(after.filter((x) => x.groupId).map((x) => x.id).sort()).toEqual(before.filter((x) => x.groupId).map((x) => x.id).sort());
    expect(after.filter((x) => x.bracket).map((x) => x.round)).toEqual(["Final"]);
  });
});

describe("a straight knockout drawn over groups", () => {
  it("clears the old groups but keeps a match added by hand", async () => {
    const t = await event("switch-to-ko");
    await actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "2" }));
    await actions.addMatch(t.id, await form({ round: "Friendly", teamA: t.teamIds[0], teamB: t.teamIds[1] }));

    expect(await outcome(actions.generateSingleElim(t.id, await form({ divisionId: t.divisionId })))).toBeNull();

    expect((await db.select().from(schema.groups).where(eq(schema.groups.divisionId, t.divisionId))).length).toBe(0);
    const rows = await matchesOf(t.divisionId);
    expect(rows.filter((x) => x.round === "Friendly")).toHaveLength(1);
    expect(rows.filter((x) => x.groupId)).toHaveLength(0);
    expect(rows.filter((x) => x.bracket === "main").length).toBeGreaterThan(0);
  });
});

describe("the category a draw is for", () => {
  it("refuses a category that is not this event's, and touches nothing", async () => {
    const t = await event("own-cat");
    const other = await event("other-cat");
    await actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "2" }));
    const before = (await matchesOf(t.divisionId)).map((m) => m.id).sort();

    expect(await outcome(actions.generateGroups(t.id, await form({ divisionId: other.divisionId, groups: "1" })))).toBe("unknown-category");
    expect(await outcome(actions.generateGroups(t.id, await form({ divisionId: "no-such-category", groups: "1" })))).toBe("unknown-category");

    expect((await matchesOf(t.divisionId)).map((m) => m.id).sort()).toEqual(before);
    expect(await matchesOf(other.divisionId)).toHaveLength(0);
  });
});

describe("match actions stay inside their event", () => {
  it("cannot delete or reorder another event's match", async () => {
    const a = await event("event-a");
    const b = await event("event-b");
    await actions.generateGroups(b.id, await form({ divisionId: b.divisionId, groups: "1" }));
    const [target] = await matchesOf(b.divisionId);

    await actions.removeMatch(a.id, target.id);
    const res = await actions.setLineup(a.id, target.id, "a", []);

    expect(res.ok).toBe(false);
    const [still] = await db.select().from(schema.matches).where(eq(schema.matches.id, target.id));
    expect(still).toBeDefined();
    expect(still.lineupA.length).toBeGreaterThan(0);
  });
});

/* The race the guard exists for: a result lands between the draw reading the
   rows and deleting them. The DELETE re-checks each row itself, and the draw's
   transaction rolls back rather than delete a played match. */
describe("a result that arrives mid-draw", () => {
  it("rolls the delete back rather than lose it", async () => {
    const t = await event("race");
    await actions.generateGroups(t.id, await form({ divisionId: t.divisionId, groups: "1" }));
    const planned = (await matchesOf(t.divisionId)).map((m) => m.id);

    /* "Meanwhile", somebody scores one of them. */
    await db.update(schema.matches).set({ log: ["a"] as never }).where(eq(schema.matches.id, planned[0]));

    await expect(db.transaction(async (tx) => guard.deleteUnplayed(tx, planned))).rejects.toBeInstanceOf(guard.DrawChanged);
    /* Nothing went, the scored match included. */
    expect((await matchesOf(t.divisionId)).map((m) => m.id).sort()).toEqual([...planned].sort());
    expect((await db.select().from(schema.matches).where(and(eq(schema.matches.id, planned[0]))))[0].log).toEqual(["a"]);
  });
});
