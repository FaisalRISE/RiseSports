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

    /* The lifecycle, replacing the old `published` boolean.
     *
     *   draft    — being set up; only the organiser sees it
     *   open     — the public registration page accepts entries
     *   live     — play has started; registration closed
     *   finished — done
     *
     * ONE field, not a status plus a `published` flag: two columns that can
     * disagree is the trap this codebase keeps avoiding. `canView` derives
     * visibility from it. */
    status: text("status").$type<TournamentStatus>().notNull().default("draft"),

    /* ── Registration settings ─────────────────────────────────────────── */
    /** Shown at the top of the public page. */
    about: text("about"),
    registrationOpensAt: timestamp("registration_opens_at", { withTimezone: true }),
    registrationClosesAt: timestamp("registration_closes_at", { withTimezone: true }),
    /** Squad-size limits enforced when an entry is submitted. */
    minTeamSize: integer("min_team_size").notNull().default(1),
    maxTeamSize: integer("max_team_size").notNull().default(2),
    /** INTEGER PAISE, never a float — see lib/finance for why. 0 = free. */
    entryFee: integer("entry_fee_paise").notNull().default(0),
    /** Keep the entrant list off the public page until the draw is made. */
    hideEntrants: boolean("hide_entrants").notNull().default(false),
    /** Extra questions on the entry form. Configuration, not entities — nothing
     *  joins to them, so they live here rather than in their own table. */
    formFields: jsonb("form_fields").$type<FormField[]>().notNull().default([]),
    /** Each must be accepted before an entry can be submitted. */
    waivers: jsonb("waivers").$type<Waiver[]>().notNull().default([]),
    venue: text("venue"),

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
    /* The person this entry is. Null on rows created before the roster existed,
       and on anyone the organiser added without linking — their rating still
       works inside the event, it just cannot follow them out of it. */
    personId: text("person_id").references(() => people.id, { onDelete: "set null" }),
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

export type TournamentStatus = "draft" | "open" | "live" | "finished";

/** An organiser-defined question on the entry form. */
export type FormField = {
  id: string;
  question: string;
  type: "text" | "choice" | "number";
  /** For `choice`. */
  options?: string[];
  required: boolean;
};

export type Waiver = { id: string; title: string; body: string };

/* ── Registration ─────────────────────────────────────────────────────────
 *
 * The point of all of this: players supply their OWN name and phone, instead of
 * an organiser typing both. A phone number is what makes a RISE Rating follow
 * someone between events, so this is where ratings actually start working
 * without data entry.
 *
 * An entry never touches the draw on its own. It sits as `pending` until an
 * organiser approves it, and only then does it become a team with players
 * linked to people. */

/** Optional skill bands a registrant picks between. */
export const divisions = pgTable(
  "divisions",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Free text — "3.0-3.5", "Advanced", whatever the organiser runs. */
    description: text("description"),
    position: integer("position").notNull().default(0),
    createdAt: created(),
  },
  (t) => [index("divisions_tournament_idx").on(t.tournamentId)],
);

export type RegistrationStatus = "pending" | "approved" | "declined" | "withdrawn";
export type PaymentState = "unpaid" | "paid" | "waived";

export const registrations = pgTable(
  "registrations",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    divisionId: text("division_id").references(() => divisions.id, { onDelete: "set null" }),
    teamName: text("team_name").notNull(),
    /** Whoever submitted it — the person to contact about this entry. */
    contactName: text("contact_name").notNull(),
    contactPhone: text("contact_phone"),
    contactEmail: text("contact_email"),
    /** Answers keyed by FormField id. */
    answers: jsonb("answers").$type<Record<string, string>>().notNull().default({}),
    waiversAccepted: jsonb("waivers_accepted").$type<string[]>().notNull().default([]),

    /* Declined and withdrawn are STATES, not deletions: an organiser needs to
       see who applied and what became of them. */
    status: text("status").$type<RegistrationStatus>().notNull().default("pending"),
    /** Set when approved, so the entry points at what it became. */
    teamId: text("team_id").references(() => teams.id, { onDelete: "set null" }),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    /** Why it was declined — the registrant deserves a reason. */
    note: text("note"),

    /* Money is RECORDED here, never moved. Collection stays off-app (UPI or
       cash), exactly as venue bookings already work. */
    paymentState: text("payment_state").$type<PaymentState>().notNull().default("unpaid"),
    paidAt: timestamp("paid_at", { withTimezone: true }),

    createdAt: created(),
  },
  (t) => [
    index("registrations_tournament_idx").on(t.tournamentId),
    index("registrations_status_idx").on(t.tournamentId, t.status),
  ],
);

/** The players on an entry. Phone is the field that makes this worth building. */
export const registrationPlayers = pgTable(
  "registration_players",
  {
    id: id(),
    registrationId: text("registration_id").notNull().references(() => registrations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    phone: text("phone"),
    gender: text("gender").$type<"M" | "F">().notNull().default("M"),
    position: integer("position").notNull().default(0),
    /** Filled in on approval, once matched or created in the roster. */
    personId: text("person_id").references(() => people.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [index("registration_players_registration_idx").on(t.registrationId)],
);

/* ── The person ───────────────────────────────────────────────────────────
 *
 * A RISE Rating is only useful if it follows the player, so it hangs off a
 * PERSON, not off a tournament entry. `players` stays what it was — the
 * per-event row carrying team, line-up and gender — and now points here.
 *
 * Deliberately NOT `users`. That table is an auth account: `email` is NOT NULL
 * and unique, which is wrong for the club player who will never log in and is
 * exactly the person whose rating matters most.
 *
 * `phone` is the key, and it is UNVERIFIED. An organiser adding someone to a
 * draw is asserting "this is the same Rahul as last week", which needs no OTP
 * and costs nothing; verification belongs to the day a player claims their own
 * profile, so SMS spend scales with engaged players rather than roster size.
 * `phoneVerified` stays false until auth ships, and this column is already the
 * login id when it does.
 *
 * It is NULLABLE because some people will not give a number — several NULLs are
 * allowed under a unique index in Postgres. Such a person still gets a rating;
 * it just cannot follow them anywhere else, and the UI should say so.
 *
 * Treat the number as personal data: normalised to E.164 for matching, never
 * rendered on a public page, never placed in a URL. */
export const people = pgTable(
  "people",
  {
    id: id(),
    /** E.164, e.g. "+919876543210". Unique, nullable, unverified. */
    phone: text("phone"),
    phoneVerified: boolean("phone_verified").notNull().default(false),
    name: text("name").notNull(),
    gender: text("gender").$type<"M" | "F">().notNull().default("M"),

    /* Spec §2: independent ratings per format — singles and doubles are
       different skills and must not share a number. Keyed "pb:md". */
    riseRatings: jsonb("rise_ratings").$type<Record<string, number>>().notNull().default({}),
    /** max() across formats. Display and SEEDING only — never fed back in. */
    riseBest: integer("rise_best"),
    /** Completed matches per format, for the provisional multiplier (§5). */
    matchCount: jsonb("match_count").$type<Record<string, number>>().notNull().default({}),

    /** Spec §7. 0–100. Decayed by inactivity — the RATING never is. */
    reliability: integer("reliability"),
    /** Spec §6.2 — per partner: matches, wins, avg partner/opponent rating. */
    partnerStats: jsonb("partner_stats").$type<Record<string, unknown>>().notNull().default({}),
    lastPlayedAt: timestamp("last_played_at", { withTimezone: true }),
    flags: jsonb("flags").$type<Record<string, unknown>>().notNull().default({}),

    /* DUPR is a STARTING REFERENCE, not a mirror. Many players never update it,
       which is the reason RiseR exists — so the date is stored and shown, and
       the number is converted once via seedFromDupr. */
    dupr: integer("dupr_x100"),
    duprEnteredAt: timestamp("dupr_entered_at", { withTimezone: true }),

    /** Spec §3: an organiser-set seed must be attributable. */
    seedSource: text("seed_source").$type<"dupr" | "organiser" | "default">(),
    seededBy: text("seeded_by").references(() => users.id, { onDelete: "set null" }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("people_phone_idx").on(t.phone),
    index("people_name_idx").on(t.name),
  ],
);

/* Spec §9. Every INPUT recorded, not just the result, because "when a player
 * disputes a rating — and they will — the organiser needs to show the working."
 *
 * The unique index is what makes applying a match idempotent: a re-save cannot
 * move a rating twice. Undoing a match deletes its rows. */
export const ratingHistory = pgTable(
  "rating_history",
  {
    id: id(),
    personId: text("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    format: text("format").notNull(),
    matchId: text("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    ratingBefore: integer("rating_before").notNull(),
    ratingAfter: integer("rating_after").notNull(),
    deltaApplied: integer("delta_applied").notNull(),
    /** The working, so a disputed rating can be explained rather than asserted. */
    expected: integer("expected_x1000").notNull(),
    marginMultiplier: integer("margin_x1000").notNull(),
    stageMultiplier: integer("stage_x1000").notNull(),
    verificationWeight: integer("verification_x1000").notNull(),
    provisionalMultiplier: integer("provisional_x1000").notNull(),
    /** Which damping actually fired, so a small delta is explainable. */
    notes: jsonb("notes").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("rating_history_match_person_format_idx").on(t.matchId, t.personId, t.format),
    index("rating_history_person_idx").on(t.personId),
  ],
);

/* Spec §5 and §6.1. Conservation is deliberately broken in two places — the
 * provisional multiplier and the doubles carry guard — and the difference is
 * WRITTEN DOWN rather than silently minted or destroyed. */
export const ratingLedger = pgTable(
  "rating_ledger",
  {
    id: id(),
    matchId: text("match_id").notNull().references(() => matches.id, { onDelete: "cascade" }),
    /** Points created (+) or destroyed (−) by this match. */
    imbalance: integer("imbalance").notNull(),
    reason: text("reason").notNull(),
    createdAt: created(),
  },
  (t) => [index("rating_ledger_match_idx").on(t.matchId)],
);

export type Tournament = typeof tournaments.$inferSelect;
export type Team = typeof teams.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type Player = typeof players.$inferSelect;
export type Match = typeof matches.$inferSelect;
export type EventRole = typeof eventRoles.$inferSelect;
export type ScorerGrant = typeof scorerGrants.$inferSelect;
export type Division = typeof divisions.$inferSelect;
export type Registration = typeof registrations.$inferSelect;
export type RegistrationPlayer = typeof registrationPlayers.$inferSelect;
export type Person = typeof people.$inferSelect;
export type RatingHistory = typeof ratingHistory.$inferSelect;
export type RatingLedger = typeof ratingLedger.$inferSelect;
