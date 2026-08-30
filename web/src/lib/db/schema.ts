/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Database schema.
 *
 * The design point that matters: a match stores its RALLY LOG, not a score.
 * Score, serving side, court positions and service box are all derived by
 * replaying the log (see lib/scoring/replay.ts). That is why undo is just
 * dropping an element, why two devices can never show contradictory scores,
 * and why a sync only has to carry an append-only array of "a"/"b".
 *
 * Roles are per-tournament rows, never a field on the user, so a person can be
 * an organiser of one event and a spectator at another. They are checked
 * server-side in every Server Action — the client is never trusted. */

import {
  pgTable, text, integer, boolean, timestamp, jsonb, uniqueIndex, index, primaryKey,
} from "drizzle-orm/pg-core";
import type { Side } from "@/lib/scoring/replay";
import type { SportId } from "@/lib/sports/registry";

const id = () => text("id").primaryKey();
const created = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const users = pgTable("users", {
  id: id(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  image: text("image"),
  createdAt: created(),
});

export const tournaments = pgTable(
  "tournaments",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    sport: text("sport").$type<SportId>().notNull().default("pb"),
    /** Match format: "standard" or "osl" (three-pair rotation, Rules 3.2). */
    format: text("format").notNull().default("standard"),
    /** Scoring overrides merged over the sport defaults by resolveRules. */
    scoring: jsonb("scoring").$type<Record<string, unknown>>(),
    ownerId: text("owner_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    /** Argon2/scrypt hash of the scorer PIN. Never the PIN itself. */
    scorerPinHash: text("scorer_pin_hash"),
    startsAt: timestamp("starts_at", { withTimezone: true }),
    published: boolean("published").notNull().default(false),
    createdAt: created(),
  },
  (t) => [uniqueIndex("tournaments_slug_idx").on(t.slug)],
);

export const teams = pgTable(
  "teams",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    seed: integer("seed").notNull().default(0),
    colour: text("colour"),
    createdAt: created(),
  },
  (t) => [index("teams_tournament_idx").on(t.tournamentId)],
);

export const players = pgTable(
  "players",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
    name: text("name").notNull(),
    gender: text("gender").$type<"M" | "F">().notNull().default("M"),
    /** Sport-namespaced ratings, e.g. { "pb:md": 1020 }. */
    ratings: jsonb("ratings").$type<Record<string, number>>().notNull().default({}),
    createdAt: created(),
  },
  (t) => [index("players_tournament_idx").on(t.tournamentId), index("players_team_idx").on(t.teamId)],
);

/** A draw group: one court, one round-robin, its own table. Pickleboss runs
 *  A-F across six courts; OSL runs two groups of four. */
export const groups = pgTable(
  "groups",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    /** "A", "B", ... — the letter used by seed references like "A1". */
    key: text("key").notNull(),
    name: text("name"),
    court: text("court"),
    position: integer("position").notNull().default(0),
    createdAt: created(),
  },
  (t) => [
    index("groups_tournament_idx").on(t.tournamentId),
    uniqueIndex("groups_key_idx").on(t.tournamentId, t.key),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    round: text("round").notNull().default("group"),
    court: integer("court"),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),

    groupId: text("group_id").references(() => groups.id, { onDelete: "set null" }),

    teamAId: text("team_a_id").references(() => teams.id, { onDelete: "set null" }),
    teamBId: text("team_b_id").references(() => teams.id, { onDelete: "set null" }),

    /* Seed references for a knockout slot that is not filled yet: "A1" is the
       winner of group A, "W:SF1" the winner of an earlier tie. The slot resolves
       to a team id as the results come in — see lib/brackets/resolveRef. */
    slotA: text("slot_a"),
    slotB: text("slot_b"),

    /** THE source of truth. One entry per rally: "a" or "b" for whoever won it. */
    log: jsonb("log").$type<Side[]>().notNull().default([]),
    /** Which side served first. */
    server: text("server").$type<Side>().notNull().default("a"),
    /** 1 = the second-listed player of that side starts on the right. */
    posA: integer("pos_a").notNull().default(0),
    posB: integer("pos_b").notNull().default(0),
    /** Player ids in court order, per side. */
    lineupA: jsonb("lineup_a").$type<string[]>().notNull().default([]),
    lineupB: jsonb("lineup_b").$type<string[]>().notNull().default([]),
    /** OSL only: rotation gates the referee has confirmed (Rules 3.4). */
    ackedGates: jsonb("acked_gates").$type<number[]>().notNull().default([]),

    /** Set when a result is typed in rather than scored rally by rally; such a
     *  match counts for the tables but is excluded from rally statistics. */
    typedScoreA: integer("typed_score_a"),
    typedScoreB: integer("typed_score_b"),

    /** Monotonically increasing per match. A write carrying a stale revision is
     *  rejected, so a device that was offline can never roll the score back. */
    rev: integer("rev").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: created(),
  },
  (t) => [
    index("matches_tournament_idx").on(t.tournamentId),
    index("matches_group_idx").on(t.groupId),
  ],
);

export const ROLES = ["PLAYER", "SCORER", "ORGANIZER", "ADMIN"] as const;
export type Role = (typeof ROLES)[number];

/** Per-tournament grants. A user's powers are always scoped to one event. */
export const eventRoles = pgTable(
  "event_roles",
  {
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    role: text("role").$type<Role>().notNull(),
    createdAt: created(),
  },
  (t) => [primaryKey({ columns: [t.tournamentId, t.userId] })],
);

/** A PIN redemption: a courtside volunteer who unlocked scoring for ONE event
 *  without needing an account. Scoped, revocable and auditable. */
export const scorerGrants = pgTable(
  "scorer_grants",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    /** Opaque token stored in the client's httpOnly cookie. */
    token: text("token").notNull(),
    label: text("label"),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [uniqueIndex("scorer_grants_token_idx").on(t.token), index("scorer_grants_tournament_idx").on(t.tournamentId)],
);

export type Tournament = typeof tournaments.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type EventRole = typeof eventRoles.$inferSelect;
export type ScorerGrant = typeof scorerGrants.$inferSelect;
