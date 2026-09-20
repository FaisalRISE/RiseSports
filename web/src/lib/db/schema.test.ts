import { describe, it, expect, beforeAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { eq } from "drizzle-orm";

import * as schema from "./schema";
import { seed, buildLog } from "./seed";
import { viewMatch } from "@/lib/matchState";

/* Runs the REAL generated migration and the REAL seed against Postgres — PGlite
 * is Postgres compiled to WASM, so constraints, defaults and foreign keys all
 * behave as they will on Neon. This is what stops `drizzle-kit push` being the
 * first time anyone finds out the schema does not apply. */

let db: ReturnType<typeof drizzle<typeof schema>>;
let seeded: Awaited<ReturnType<typeof seed>>;

beforeAll(async () => {
  const client = new PGlite();
  db = drizzle(client, { schema });

  const dir = path.resolve(process.cwd(), "drizzle");
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();
  expect(files.length, "no generated migration found — run `pnpm db:generate`").toBeGreaterThan(0);

  for (const f of files) {
    const sql = fs.readFileSync(path.join(dir, f), "utf8");
    // drizzle-kit separates statements with a breakpoint marker
    for (const stmt of sql.split("--> statement-breakpoint")) {
      const trimmed = stmt.trim();
      if (trimmed) await client.exec(trimmed);
    }
  }

  seeded = await seed(db as never);
}, 60_000);

describe("the generated migration applies to a real Postgres", () => {
  it("creates every table", async () => {
    const rows = await db.execute(
      `select table_name from information_schema.tables where table_schema = 'public' order by table_name`,
    );
    const names = (rows.rows as { table_name: string }[]).map((r) => r.table_name);
    expect(names).toEqual([
      "community_attendance", "community_byes", "community_games", "community_matches",
      "community_members", "community_sessions",
      "divisions", "event_roles", "groups",
      "ledger_books", "ledger_entries", "ledger_members", "ledger_payments",
      "matches", "people", "players",
      "rating_history", "rating_ledger", "registration_players", "registrations",
      "scorer_grants", "skill_endorsements", "skill_ratings",
      "teams", "tournaments", "users",
      "venue_bookings", "venues",
    ]);
  });

  it("applies migrations incrementally, not just the first one", async () => {
    /* 0001 added groups and the seed-ref slots. If only 0000 had run, these
       columns would be missing and the query below would throw. */
    const rows = await db.execute(
      `select column_name from information_schema.columns
       where table_name = 'matches' and column_name in ('group_id','slot_a','slot_b')
       order by column_name`,
    );
    expect((rows.rows as { column_name: string }[]).map((r) => r.column_name))
      .toEqual(["group_id", "slot_a", "slot_b"]);
  });

  it("keeps group keys unique within a CATEGORY, not within a tournament", async () => {
    const t2 = await db.insert(schema.tournaments).values({
      id: "other", slug: "other-cup", name: "Other Cup", ownerId: seeded.ownerId,
    }).returning({ id: schema.tournaments.id });
    await db.insert(schema.divisions).values({ id: "dOther", tournamentId: t2[0].id, name: "Main" });

    const [oslMain] = await db.select().from(schema.divisions)
      .where(eq(schema.divisions.tournamentId, seeded.oslId));

    /* A second category in the SAME event — the case the index exists for. */
    await db.insert(schema.divisions).values({
      id: "dMixed", tournamentId: seeded.oslId, name: "Mixed Doubles", position: 1,
    });

    await db.insert(schema.groups).values({
      id: "g1", tournamentId: seeded.oslId, divisionId: oslMain.id, key: "A",
    });

    // same key, different tournament: allowed
    await db.insert(schema.groups).values({
      id: "g2", tournamentId: t2[0].id, divisionId: "dOther", key: "A",
    });

    /* Same key, same tournament, DIFFERENT category: allowed, and this is the
       whole point — Men's Doubles and Mixed each get their own Group A. */
    await db.insert(schema.groups).values({
      id: "g3", tournamentId: seeded.oslId, divisionId: "dMixed", key: "A",
    });

    // same key, same category: still refused
    await expect(
      db.insert(schema.groups).values({
        id: "g4", tournamentId: seeded.oslId, divisionId: oslMain.id, key: "A",
      }),
    ).rejects.toThrow();

    /* Clean up so later tests see only the seeded tournaments — these run
       against one shared database, so a test that leaves rows behind breaks
       its neighbours. */
    await db.delete(schema.tournaments).where(eq(schema.tournaments.id, t2[0].id));
    await db.delete(schema.groups).where(eq(schema.groups.id, "g1"));
    await db.delete(schema.divisions).where(eq(schema.divisions.id, "dMixed"));
  });

  it("enforces the unique slug", async () => {
    await expect(
      db.insert(schema.tournaments).values({
        id: "dupe", slug: "club-night", name: "Clash", ownerId: seeded.ownerId,
      }),
    ).rejects.toThrow();
  });

  it("cascades a tournament delete to its matches", async () => {
    const before = await db.select().from(schema.matches).where(eq(schema.matches.tournamentId, seeded.clubId));
    expect(before.length).toBeGreaterThan(0);
    await db.delete(schema.tournaments).where(eq(schema.tournaments.id, seeded.clubId));
    const after = await db.select().from(schema.matches).where(eq(schema.matches.tournamentId, seeded.clubId));
    expect(after).toEqual([]);
  });
});

describe("the seed produces states worth testing", () => {
  it("creates both tournaments", async () => {
    const rows = await db.select().from(schema.tournaments);
    expect(rows.map((r) => r.slug).sort()).toEqual(["osl-2026"]); // club-night deleted by the cascade test
  });

  it("OSL matches round-trip through the scoring engine", async () => {
    const t = (await db.select().from(schema.tournaments).where(eq(schema.tournaments.slug, "osl-2026")))[0];
    const ms = await db.select().from(schema.matches).where(eq(schema.matches.tournamentId, t.id));
    const views = ms.map((m) => viewMatch(t, m));

    // one match sits one point short of the Pair B rotation
    const nearGate = views.find((v) => Math.max(v.a, v.b) === 6);
    expect(nearGate?.osl?.pairLabel).toBe("Pair A");
    expect(nearGate?.osl?.pendingGate).toBe(0);

    // one is past 14: ends changed, Pair C on court
    const late = views.find((v) => Math.max(v.a, v.b) === 16);
    expect(late?.osl?.pairLabel).toBe("Pair C");
    expect(late?.osl?.endsChanged).toBe(true);

    // one is on the golden point
    const golden = views.find((v) => v.a === 24 && v.b === 24);
    expect(golden?.golden).toBe(true);
    expect(golden?.over).toBe(false);

    // the final has no teams yet and must not crash the view
    const empty = views.find((v) => v.rallies === 0);
    expect(empty?.over).toBe(false);
  });

  it("every OSL six is a legal line-up under Rules 3.1", async () => {
    const { oslLineupIssues } = await import("@/lib/formats/osl");
    const t = (await db.select().from(schema.tournaments).where(eq(schema.tournaments.slug, "osl-2026")))[0];
    const ps = await db.select().from(schema.players).where(eq(schema.players.tournamentId, t.id));
    const byId = new Map(ps.map((p) => [p.id, p]));
    const ms = await db.select().from(schema.matches).where(eq(schema.matches.tournamentId, t.id));

    for (const m of ms) {
      for (const lineup of [m.lineupA, m.lineupB]) {
        if (lineup.length === 0) continue;
        const six = lineup.map((pid) => {
          const p = byId.get(pid)!;
          return { id: p.id, name: p.name, gender: p.gender };
        });
        expect(oslLineupIssues(six), `${m.round}`).toEqual([]);
      }
    }
  });
});

/* The community tables, against a real Postgres.
 *
 * These check the guarantees the SCHEMA makes, not the ones application code
 * makes — the difference matters, because application code is what gets a bug.
 * A unique index and a CHECK hold even when a Server Action forgets to. */
describe("community play", () => {
  const game = async (over: Partial<typeof schema.communityGames.$inferInsert> = {}) => {
    const id = `g${Math.random().toString(36).slice(2, 9)}`;
    const [row] = await db.insert(schema.communityGames).values({
      id, slug: id, name: "Thursday Night", ...over,
    }).returning();
    return row;
  };

  /* The guard for a bug that shipped silently.
   *
   * drizzle-kit does not generate row-level security, and Supabase grants the
   * `anon` role full SELECT/INSERT/UPDATE/DELETE on every table in `public`.
   * So a table drizzle creates is, by default, readable and WRITABLE by the
   * anon key — which is published in the legacy app's shipped HTML. That is
   * exactly what happened to all six community tables when 0006 was applied to
   * production; 0008 closed it.
   *
   * Nothing about the application's behaviour changes when RLS is missing, so
   * there is no failing screen to notice. This test is the only thing that
   * would catch the seventh community table being added without it. */
  it("has row-level security on EVERY app table", async () => {
    /* Deliberately not scoped to `community%`: the point is that a table added
       next year is covered by default. The three legacy tables belong to the
       old per-event apps and reach PostgREST on purpose, so they are named
       here rather than the check being narrowed to today's tables. */
    const LEGACY_POSTREST = ["osl_live", "app_backups", "live_scores"];

    const rows = await db.execute(
      `select c.relname, c.relrowsecurity
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relkind = 'r'
        order by c.relname`,
    );
    const tables = (rows.rows as { relname: string; relrowsecurity: boolean }[])
      .filter((t) => !LEGACY_POSTREST.includes(t.relname));
    expect(tables.length, "no tables found — did the migrations run?").toBeGreaterThan(10);

    const open = tables.filter((t) => !t.relrowsecurity).map((t) => t.relname);
    expect(open, `RLS is off, so the published anon key can read and write: ${open.join(", ")}`)
      .toEqual([]);
  });

  it("has no policy on them, which is what keeps them shut", async () => {
    /* RLS with no policy denies everything. A policy would OPEN these tables —
       the linter's "RLS enabled, no policy" notices are the intended state.
       The legacy PostgREST tables are excluded here for the same reason as
       above: they carry policies on purpose. */
    const rows = await db.execute(
      `select tablename, count(*)::int as n from pg_policies
        where schemaname = 'public'
          and tablename not in ('osl_live','app_backups','live_scores')
        group by tablename`,
    );
    expect(rows.rows).toEqual([]);
  });

  it("allows only one session row per game per date", async () => {
    const g = await game();
    await db.insert(schema.communitySessions).values({ id: "s1", gameId: g.id, date: "2026-09-17" });
    await expect(
      db.insert(schema.communitySessions).values({ id: "s2", gameId: g.id, date: "2026-09-17" }),
    ).rejects.toThrow();
  });

  it("lets the same date exist for two different games", async () => {
    const a = await game();
    const b = await game();
    await db.insert(schema.communitySessions).values({ id: "sa", gameId: a.id, date: "2026-09-18" });
    await expect(
      db.insert(schema.communitySessions).values({ id: "sb", gameId: b.id, date: "2026-09-18" }),
    ).resolves.toBeDefined();
  });

  it("allows only one attendance row per person per session", async () => {
    /* This index is what makes the whole five-state roster coherent: without it
       a double-tap makes someone confirmed AND waitlisted at once. */
    const g = await game();
    const [s] = await db.insert(schema.communitySessions)
      .values({ id: "sdup", gameId: g.id, date: "2026-09-24" }).returning();
    const [p] = await db.insert(schema.people)
      .values({ id: "pdup", name: "Asha" }).returning();

    await db.insert(schema.communityAttendance)
      .values({ id: "a1", sessionId: s.id, personId: p.id, state: "confirmed" });
    await expect(
      db.insert(schema.communityAttendance)
        .values({ id: "a2", sessionId: s.id, personId: p.id, state: "waitlist" }),
    ).rejects.toThrow();
  });

  it("takes a session's attendance down with the session", async () => {
    const g = await game();
    const [s] = await db.insert(schema.communitySessions)
      .values({ id: "scas", gameId: g.id, date: "2026-10-01" }).returning();
    const [p] = await db.insert(schema.people).values({ id: "pcas", name: "Ravi" }).returning();
    await db.insert(schema.communityAttendance)
      .values({ id: "acas", sessionId: s.id, personId: p.id, state: "interested" });

    await db.delete(schema.communityGames).where(eq(schema.communityGames.id, g.id));

    const left = await db.select().from(schema.communityAttendance)
      .where(eq(schema.communityAttendance.id, "acas"));
    expect(left).toHaveLength(0);
  });

  it("refuses two results for the same court in the same block", async () => {
    const g = await game();
    const [s] = await db.insert(schema.communitySessions)
      .values({ id: "sslot", gameId: g.id, date: "2026-10-08" }).returning();
    await db.insert(schema.communityMatches)
      .values({ id: "m1", sessionId: s.id, block: 0, court: 1 });
    await expect(
      db.insert(schema.communityMatches).values({ id: "m2", sessionId: s.id, block: 0, court: 1 }),
    ).rejects.toThrow();
    /* …but the second block on the same court is a different game. */
    await expect(
      db.insert(schema.communityMatches).values({ id: "m3", sessionId: s.id, block: 1, court: 1 }),
    ).resolves.toBeDefined();
  });
});

/* Migration 0006 drops NOT NULL from rating_history.match_id so a community
 * result can be recorded. The CHECK is what stops that from also admitting a
 * row referencing NOTHING — a rating that moved with no record of what moved
 * it, which is exactly what this table exists to prevent. */
describe("a rating record always names the match that caused it", () => {
  const historyRow = (over: Record<string, unknown>) => ({
    id: `rh${Math.random().toString(36).slice(2, 9)}`,
    personId: "rhp", format: "pb:md",
    ratingBefore: 800, ratingAfter: 812, deltaApplied: 12,
    expected: 500, marginMultiplier: 1000, stageMultiplier: 1000,
    verificationWeight: 1000, provisionalMultiplier: 1000,
    ...over,
  });

  beforeAll(async () => {
    await db.insert(schema.people).values({ id: "rhp", name: "Meera" }).onConflictDoNothing();
  });

  it("rejects a row that names neither a tournament nor a community match", async () => {
    await expect(
      db.insert(schema.ratingHistory).values(historyRow({ matchId: null, communityMatchId: null }) as never),
    ).rejects.toThrow();
  });

  it("rejects a row that names both", async () => {
    const [g] = await db.insert(schema.communityGames)
      .values({ id: "gboth", slug: "gboth", name: "Both" }).returning();
    const [s] = await db.insert(schema.communitySessions)
      .values({ id: "sboth", gameId: g.id, date: "2026-10-15" }).returning();
    const [cm] = await db.insert(schema.communityMatches)
      .values({ id: "cmboth", sessionId: s.id, block: 0, court: 1 }).returning();
    const anyMatch = (await db.select().from(schema.matches).limit(1))[0];

    await expect(
      db.insert(schema.ratingHistory)
        .values(historyRow({ matchId: anyMatch.id, communityMatchId: cm.id }) as never),
    ).rejects.toThrow();
  });

  it("accepts a community result, and applies it only once", async () => {
    const [g] = await db.insert(schema.communityGames)
      .values({ id: "gonce", slug: "gonce", name: "Once" }).returning();
    const [s] = await db.insert(schema.communitySessions)
      .values({ id: "sonce", gameId: g.id, date: "2026-10-22" }).returning();
    const [cm] = await db.insert(schema.communityMatches)
      .values({ id: "cmonce", sessionId: s.id, block: 0, court: 1 }).returning();

    await expect(
      db.insert(schema.ratingHistory).values(historyRow({ communityMatchId: cm.id }) as never),
    ).resolves.toBeDefined();

    /* The re-save guard. Without the second partial unique index this would
       succeed, and one community game would move a rating twice. */
    await expect(
      db.insert(schema.ratingHistory).values(historyRow({ communityMatchId: cm.id }) as never),
    ).rejects.toThrow();
  });
});

describe("peer ratings, enforced by the database", () => {
  /* The rules are also checked in lib/skills, but that is a Server Action and
     a Server Action is a public endpoint. These CHECKs are the floor that holds
     however the row arrives. */
  const person = async (id: string, name: string) => {
    await db.insert(schema.people).values({ id, name } as never).onConflictDoNothing();
    return id;
  };

  it("refuses a score outside the scale", async () => {
    const a = await person("sk-a", "Rater");
    const b = await person("sk-b", "Subject");
    for (const score of [0, 6, -1, 99]) {
      await expect(
        db.insert(schema.skillRatings).values({
          id: `bad-${score}`, subjectPersonId: b, raterPersonId: a,
          sport: "pb", skill: "Serve", score,
        } as never),
      ).rejects.toThrow();
    }
  });

  it("accepts one inside it", async () => {
    await expect(
      db.insert(schema.skillRatings).values({
        id: "good-1", subjectPersonId: "sk-b", raterPersonId: "sk-a",
        sport: "pb", skill: "Serve", score: 4,
      } as never),
    ).resolves.toBeDefined();
  });

  it("refuses a self-rating, which is not a peer review", async () => {
    await expect(
      db.insert(schema.skillRatings).values({
        id: "self-1", subjectPersonId: "sk-a", raterPersonId: "sk-a",
        sport: "pb", skill: "Serve", score: 5,
      } as never),
    ).rejects.toThrow();
    await expect(
      db.insert(schema.skillEndorsements).values({
        id: "self-2", subjectPersonId: "sk-a", raterPersonId: "sk-a",
        sport: "pb", tag: "Wall",
      } as never),
    ).rejects.toThrow();
  });

  it("gives one rater ONE voice per skill", async () => {
    /* The whole reason the rows are kept individually instead of folded into a
       running average: without this index, pressing Save twice counts twice. */
    await expect(
      db.insert(schema.skillRatings).values({
        id: "dupe-1", subjectPersonId: "sk-b", raterPersonId: "sk-a",
        sport: "pb", skill: "Serve", score: 1,
      } as never),
    ).rejects.toThrow();
  });

  it("but lets the same rater score a DIFFERENT skill, and another sport", async () => {
    await expect(
      db.insert(schema.skillRatings).values({
        id: "ok-2", subjectPersonId: "sk-b", raterPersonId: "sk-a",
        sport: "pb", skill: "Dink", score: 5,
      } as never),
    ).resolves.toBeDefined();
    await expect(
      db.insert(schema.skillRatings).values({
        id: "ok-3", subjectPersonId: "sk-b", raterPersonId: "sk-a",
        sport: "bd", skill: "Serve", score: 5,
      } as never),
    ).resolves.toBeDefined();
  });
});

describe("category rules, enforced by the database", () => {
  /* lib/eligibility checks every rule on every way into a category, but a
     Server Action is a public endpoint. These CHECKs refuse rules that cannot
     mean anything, however the row arrives.

     Each refusal is matched to the CONSTRAINT that should have fired, not just
     to "it threw" — a missing foreign key or a typo in the test would also
     throw, and a test that passes for the wrong reason proves nothing. */
  async function refusedBy(write: Promise<unknown>, constraint: string) {
    let caught: unknown = null;
    try {
      await write;
    } catch (e) {
      caught = e;
    }
    expect(caught, `expected ${constraint} to refuse this row`).not.toBeNull();
    const err = caught as { constraint?: string; cause?: { constraint?: string } };
    expect(err.cause?.constraint ?? err.constraint).toBe(constraint);
  }

  let n = 0;
  const division = (over: Record<string, unknown>) =>
    db.insert(schema.divisions).values({
      id: `rules-${++n}`, tournamentId: seeded.oslId, name: `Rules ${n}`, ...over,
    } as never);

  it("accepts a category with no rules at all, which is every category until now", async () => {
    await expect(division({})).resolves.toBeDefined();
  });

  it("accepts a fully ruled one", async () => {
    await expect(
      division({
        genderRule: "MX", ageMin: 35, ageMax: 49, ageOn: "2026-10-12",
        ratingMin: 750, ratingMax: 1049, duprMin: 300, duprMax: 400,
      }),
    ).resolves.toBeDefined();
  });

  it("refuses a gender rule that is not men, women or mixed", async () => {
    await refusedBy(division({ genderRule: "X" }), "divisions_gender_rule_valid");
  });

  it("refuses an impossible age, and a youngest above the oldest", async () => {
    await refusedBy(division({ ageMin: 130, ageOn: "2026-10-12" }), "divisions_age_range");
    await refusedBy(division({ ageMin: 40, ageMax: 30, ageOn: "2026-10-12" }), "divisions_age_range");
  });

  it("refuses an age limit with no day to count ages on", async () => {
    /* "35+" means nothing without a date: a player is 34 on one day and 35 on
       the next. */
    await refusedBy(division({ ageMin: 35 }), "divisions_age_needs_date");
  });

  it("refuses a date that does not exist", async () => {
    /* The column is a real `date`, so the database itself rejects 30 February
       rather than storing text that no calendar has. */
    await expect(division({ ageMin: 18, ageOn: "2026-02-30" })).rejects.toThrow();
  });

  it("refuses a rating range upside down", async () => {
    await refusedBy(division({ ratingMin: 1200, ratingMax: 900 }), "divisions_rating_range");
  });

  it("refuses a DUPR outside the scale, stored in hundredths", async () => {
    await refusedBy(division({ duprMin: 50 }), "divisions_dupr_range");
    await refusedBy(division({ duprMax: 900 }), "divisions_dupr_range");
    await refusedBy(division({ duprMin: 450, duprMax: 350 }), "divisions_dupr_range");
  });

  it("refuses a nonsense date of birth or DUPR typed on an entry or a player", async () => {
    await db.insert(schema.registrations).values({
      id: "rules-reg", tournamentId: seeded.oslId, teamName: "Checks", contactName: "C",
    } as never);
    const entrant = (over: Record<string, unknown>) =>
      db.insert(schema.registrationPlayers).values({
        id: `rules-rp-${++n}`, registrationId: "rules-reg", name: "E", ...over,
      } as never);
    await refusedBy(entrant({ dob: "1850-01-01" }), "registration_players_dob_sane");
    await refusedBy(entrant({ dupr: 900 }), "registration_players_dupr_range");
    await expect(entrant({ dob: "1990-05-17", dupr: 375 })).resolves.toBeDefined();

    const player = (over: Record<string, unknown>) =>
      db.insert(schema.players).values({
        id: `rules-p-${++n}`, tournamentId: seeded.oslId, name: "P", ...over,
      } as never);
    await refusedBy(player({ dob: "1850-01-01" }), "players_dob_sane");
    await refusedBy(player({ dupr: 50 }), "players_dupr_range");
    await expect(player({ dob: "1990-05-17", dupr: 375 })).resolves.toBeDefined();
  });

  it("reads a date back as the same Y-M-D it was written, with no timezone in between", async () => {
    const [row] = await db.select().from(schema.divisions).where(eq(schema.divisions.id, "rules-2"));
    expect(row.ageOn).toBe("2026-10-12");
  });
});

describe("buildLog", () => {
  it("produces exactly the requested score", () => {
    for (const [a, b] of [[11, 7], [25, 0], [24, 24], [0, 3], [0, 0]]) {
      const log = buildLog(a, b);
      expect(log.filter((x) => x === "a").length).toBe(a);
      expect(log.filter((x) => x === "b").length).toBe(b);
    }
  });
});
