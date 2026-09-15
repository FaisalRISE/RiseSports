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

    /* What the scheduler needs and nothing else does: how many courts are
       booked, and how long a match is allowed to take. Stored rather than asked
       for each time, because an organiser redrawing the sheet after a late
       entry should not have to remember what they typed an hour ago — and
       because "we have four courts" is a fact about the event, not about one
       press of a button. See lib/schedule. */
    courts: integer("courts").notNull().default(2),
    matchMinutes: integer("match_minutes").notNull().default(20),

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
    /* Which category this team entered. A person may appear in two divisions
       with different partners — that is two teams, one person. */
    divisionId: text("division_id").notNull().references(() => divisions.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    seed: integer("seed").notNull().default(0),
    colour: text("colour"),
    createdAt: created(),
  },
  (t) => [
    index("teams_tournament_idx").on(t.tournamentId),
    index("teams_division_idx").on(t.divisionId),
  ],
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
    divisionId: text("division_id").notNull().references(() => divisions.id, { onDelete: "cascade" }),
    /** "A", "B", ... — the letter used by seed references like "A1". */
    key: text("key").notNull(),
    name: text("name"),
    court: text("court"),
    position: integer("position").notNull().default(0),
    createdAt: created(),
  },
  (t) => [
    index("groups_tournament_idx").on(t.tournamentId),
    index("groups_division_idx").on(t.divisionId),
    /* Per DIVISION, not per tournament: Men's Doubles and Mixed each get their
       own Group A, and a seed reference "A1" means the A of its own category. */
    uniqueIndex("groups_key_idx").on(t.tournamentId, t.divisionId, t.key),
  ],
);

export const matches = pgTable(
  "matches",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    /* Carried on the match itself, not inferred from the group, because a
       knockout match has no group — and its seed references ("A1",
       "W:Semi-Final 1") must resolve inside its own category or they resolve to
       the wrong team in silence. See lib/tournamentState refResolver. */
    divisionId: text("division_id").notNull().references(() => divisions.id, { onDelete: "cascade" }),
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

    /* How long the match actually took — spec: match-timing-spec.md v2.0.
     * Only ACCUMULATED milliseconds and a wall-clock start for ordering; never
     * a raw performance.now() reading, which means nothing once it has crossed
     * the wire. Written only by ref-mode scoring; a typed-in final score leaves
     * it null. See lib/scoring/timing.ts. */
    timing: jsonb("timing").$type<Record<string, unknown> | null>(),

    /** Monotonically increasing per match. A write carrying a stale revision is
     *  rejected, so a device that was offline can never roll the score back. */
    rev: integer("rev").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: created(),
  },
  (t) => [
    index("matches_tournament_idx").on(t.tournamentId),
    index("matches_division_idx").on(t.divisionId),
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
/* How one division is run. Faisal, 2026-09-13: "every tournament is different …
 * some are team events, some have various categories" — and the categories in
 * ONE event may run differently from each other, so the shape belongs here and
 * not on the tournament.
 *
 * Deliberately excludes double elimination. `buildLoserBracket`/`advanceDE` are
 * ported and tested in lib/brackets, but running it was declined; leave them
 * dead rather than half-wiring a shape nobody asked for. */
export type DivisionShape = "groups_ko" | "league" | "single_elim";

/* A category within an event: Men's Doubles, Mixed, U-17, Beginners.
 *
 * EVERY tournament has at least one, named "Main" when the organiser never
 * asked for categories. The alternative — divisions optional, with a fallback
 * when absent — means two code paths through every draw function, and the
 * no-division path is the one that rots unseen. One path; the manage screen
 * simply hides the tabs when there is only one. */
export const divisions = pgTable(
  "divisions",
  {
    id: id(),
    tournamentId: text("tournament_id").notNull().references(() => tournaments.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    /** Free text — "3.0-3.5", "Advanced", whatever the organiser runs. */
    description: text("description"),
    position: integer("position").notNull().default(0),
    /** Default matches what every existing event already does. */
    shape: text("shape").$type<DivisionShape>().notNull().default("groups_ko"),
    /** Losing semi-finalists play off for third. Costs one match row — the
     *  `L:` seed reference that fills it already resolves (lib/brackets). */
    thirdPlace: boolean("third_place").notNull().default(false),
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
    /* ISO date, "1994-03-21". Needed by community games that restrict entry by
       age (app.source.js:8800). Nullable, and an age restriction on a player
       with no date of birth fails closed — the organiser cannot verify it. */
    dob: text("dob"),

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
    /* Exactly one of these is set. Community play moves more ratings than
       tournaments do (the legacy app applies a rating change on every community
       score, app.source.js:9254), so its results have to land in the same
       history — otherwise a disputed rating can be explained only half the
       time. A CHECK constraint in the migration enforces the "exactly one"; it
       cannot be expressed in Drizzle's column types. */
    matchId: text("match_id").references(() => matches.id, { onDelete: "cascade" }),
    communityMatchId: text("community_match_id").references(() => communityMatches.id, { onDelete: "cascade" }),
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
    /* Two partial indexes rather than one over both columns: a unique index
       treats NULLs as distinct, so a single index on (matchId, communityMatchId,
       personId, format) would let the same community result apply twice. */
    uniqueIndex("rating_history_match_person_format_idx").on(t.matchId, t.personId, t.format),
    uniqueIndex("rating_history_cmatch_person_format_idx").on(t.communityMatchId, t.personId, t.format),
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
    /** Exactly one is set, as on ratingHistory. */
    matchId: text("match_id").references(() => matches.id, { onDelete: "cascade" }),
    communityMatchId: text("community_match_id").references(() => communityMatches.id, { onDelete: "cascade" }),
    /** Points created (+) or destroyed (−) by this match. */
    imbalance: integer("imbalance").notNull(),
    reason: text("reason").notNull(),
    createdAt: created(),
  },
  (t) => [index("rating_ledger_match_idx").on(t.matchId)],
);

/* ── Community play ───────────────────────────────────────────────────────
 *
 * The other half of the app, and the half that moves most ratings: a weekly
 * game at a court, people putting their hands up for a date, the host building
 * the guest list, then pairings and scores.
 *
 * It is NOT a tournament wearing a different hat, which is why these are their
 * own tables. A tournament has teams, groups, a draw and one date; a community
 * game has none of those, and has instead a repeating schedule, a roster where
 * a person sits in one of five states, per-person payment, and four separate
 * ways of deciding who plays whom. Bending `tournaments` to cover both would
 * mean making `divisionId` and `teamId` nullable everywhere and putting a kind
 * check in front of every query — undoing the guard migration 0005 added.
 *
 * Legacy source: CommunityTab, app.source.js:9221-11651, stored under `rs_cg`.
 */

export type Rotation = "fixed" | "rotate" | "slots" | "kotc" | "ladder";
export type ScheduleMode = "random" | "balanced" | "americano" | "mexicano";
export type AccessType = "open" | "restricted";

/** Who may join. Any field left null is simply not checked. */
export type Restrictions = {
  gsrMin: number | null; gsrMax: number | null;
  duprMin: number | null; duprMax: number | null;
  ageMin: number | null; ageMax: number | null;
  gender: "M" | "F" | null;
};

export const NO_RESTRICTIONS: Restrictions = {
  gsrMin: null, gsrMax: null, duprMin: null, duprMax: null,
  ageMin: null, ageMax: null, gender: null,
};

export const communityGames = pgTable(
  "community_games",
  {
    id: id(),
    /** Short URL key, as tournaments have. */
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    sport: text("sport").$type<SportId>().notNull().default("pb"),

    /** The host, as a person — not a user. Most organisers never sign in. */
    hostPersonId: text("host_person_id").references(() => people.id, { onDelete: "set null" }),
    /** Who may administer it when signed in. Null while open access is on. */
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),

    /* Venue is free text, as in the legacy app. The venues directory is its own
       port; when it lands this gains a nullable venueId beside this, which is
       additive and needs no backfill. */
    venue: text("venue").notNull().default("TBD Venue"),
    area: text("area").notNull().default(""),

    /** "daily", or "weekly" on the chosen `days`. */
    freq: text("freq").$type<"daily" | "weekly">().notNull().default("weekly"),
    /** 0 = Sunday, matching Date#getDay. Empty when freq is daily. */
    days: jsonb("days").$type<number[]>().notNull().default([]),
    startTime: text("start_time").notNull().default("20:00"),
    endTime: text("end_time").notNull().default("22:00"),

    /** courts × perCourt is the number of spots in one session. */
    courts: integer("courts").notNull().default(2),
    perCourt: integer("per_court").notNull().default(4),

    rotation: text("rotation").$type<Rotation>().notNull().default("fixed"),
    scheduleMode: text("schedule_mode").$type<ScheduleMode>().notNull().default("random"),
    accessType: text("access_type").$type<AccessType>().notNull().default("open"),

    /** Integer paise, never a float — the same rule the ledger runs on. */
    pricePaise: integer("price_paise").notNull().default(0),

    restrictions: jsonb("restrictions").$type<Restrictions>().notNull().default(NO_RESTRICTIONS),

    /* The ladder belongs to the GAME, not to a session — it persists across
       dates, which is the whole point of a ladder. */
    ladderOrder: jsonb("ladder_order").$type<string[]>().notNull().default([]),
    ladderLog: jsonb("ladder_log").$type<unknown[]>().notNull().default([]),

    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("community_games_slug_idx").on(t.slug),
    index("community_games_host_idx").on(t.hostPersonId),
  ],
);

/* One date of a repeating game. Created lazily — a session row exists only once
 * somebody interacts with that date, so a weekly game does not manufacture rows
 * into the far future. */
export const communitySessions = pgTable(
  "community_sessions",
  {
    id: id(),
    gameId: text("game_id").notNull().references(() => communityGames.id, { onDelete: "cascade" }),
    /** ISO date, "2026-09-18". Date only — the time of day lives on the game. */
    date: text("date").notNull(),

    /** King of the Court live state: courts, bench, crowns, round. */
    kotc: jsonb("kotc").$type<Record<string, unknown> | null>(),
    /** Half-hour reservations: slot index → person ids. */
    slotData: jsonb("slot_data").$type<Record<string, string[]>>().notNull().default({}),

    /** Set when the host generates pairings, so the page knows to show them. */
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("community_sessions_game_date_idx").on(t.gameId, t.date),
    index("community_sessions_game_idx").on(t.gameId),
  ],
);

/* The states a person can be in for one session. "none" is the ABSENCE of a
 * row, so it is not in the union — that keeps "has this person done anything
 * about this date?" a single row lookup rather than a state comparison.
 *
 * "withdrawn" is the one state the legacy app does not have. There, backing out
 * deletes you from every list and bumps a mutable `openSlots` counter on the
 * session (app.source.js:10019) — so the host loses the fact that you ever
 * signed up, and the counter can drift away from reality with no way back.
 * Keeping the row instead means the host can see who dropped out, and the
 * number of spots freed by a backout becomes DERIVABLE rather than tallied.
 * See `openSlotsIn` in lib/community/roster.ts. */
export type AttendanceState =
  | "confirmed" | "waitlist" | "requested" | "interested" | "withdrawn";

export const communityAttendance = pgTable(
  "community_attendance",
  {
    id: id(),
    sessionId: text("session_id").notNull().references(() => communitySessions.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    state: text("state").$type<AttendanceState>().notNull(),
    /** Queue order within a state. Waitlist promotion takes the lowest. */
    position: integer("position").notNull().default(0),

    paid: boolean("paid").notNull().default(false),
    paymentLinkSentAt: timestamp("payment_link_sent_at", { withTimezone: true }),
    /** Set when a confirmed player backs out, so the host sees a freed spot. */
    withdrewAt: timestamp("withdrew_at", { withTimezone: true }),

    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    /* One row per person per session — the whole state machine rests on it. */
    uniqueIndex("community_attendance_session_person_idx").on(t.sessionId, t.personId),
    index("community_attendance_session_idx").on(t.sessionId),
    index("community_attendance_person_idx").on(t.personId),
  ],
);

/** Membership of a restricted game. Open games have no rows here at all. */
export type MembershipState = "member" | "requested" | "invited";

export const communityMembers = pgTable(
  "community_members",
  {
    id: id(),
    gameId: text("game_id").notNull().references(() => communityGames.id, { onDelete: "cascade" }),
    personId: text("person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    state: text("state").$type<MembershipState>().notNull(),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("community_members_game_person_idx").on(t.gameId, t.personId),
    index("community_members_game_idx").on(t.gameId),
  ],
);

/* One played game inside a session.
 *
 * Deliberately NOT a row in `matches`: that table's entire shape is tournament
 * scoping — `tournamentId` and `divisionId` are both NOT NULL, and seed
 * references resolve within a division. A community game has neither, and
 * loosening those two columns to fit would remove the guard that migration 0005
 * exists to add.
 *
 * The score is stored directly rather than as a rally log because community
 * scores are typed in at the end of a game; the rally-by-rally console belongs
 * to refereed tournament matches. */
export const communityMatches = pgTable(
  "community_matches",
  {
    id: id(),
    sessionId: text("session_id").notNull().references(() => communitySessions.id, { onDelete: "cascade" }),
    /** 0, or 0 and 1 when the game reshuffles at half time. */
    block: integer("block").notNull().default(0),
    court: integer("court").notNull().default(1),
    /** Person ids per side, in court order. */
    lineupA: jsonb("lineup_a").$type<string[]>().notNull().default([]),
    lineupB: jsonb("lineup_b").$type<string[]>().notNull().default([]),
    scoreA: integer("score_a"),
    scoreB: integer("score_b"),
    createdAt: created(),
  },
  (t) => [
    index("community_matches_session_idx").on(t.sessionId),
    uniqueIndex("community_matches_slot_idx").on(t.sessionId, t.block, t.court),
  ],
);

/** Who sat out each block, so the schedule can say so rather than leave a gap. */
export const communityByes = pgTable(
  "community_byes",
  {
    sessionId: text("session_id").notNull().references(() => communitySessions.id, { onDelete: "cascade" }),
    block: integer("block").notNull(),
    personIds: jsonb("person_ids").$type<string[]>().notNull().default([]),
  },
  (t) => [primaryKey({ columns: [t.sessionId, t.block] })],
);

/* ── Venues ───────────────────────────────────────────────────────────────
 *
 * A court somebody hosts, and the requests to use it. Ported from
 * `VenuesSection` (app.source.js:8963-9220), which renders INSIDE the Play tab
 * — venues are not a separate part of the app, they are where community play
 * happens, so they live on the same screen here too.
 *
 * Money is settled off-app by design: the price is shown so people know what
 * they are agreeing to, and nothing here takes a payment.
 */

export const venues = pgTable(
  "venues",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    area: text("area").notNull().default(""),
    courts: integer("courts").notNull().default(2),

    /** "06:00" / "22:00" — the hours the venue can be booked within. */
    openTime: text("open_time").notNull().default("06:00"),
    closeTime: text("close_time").notNull().default("22:00"),

    /** Integer paise PER HOUR, never a float. Same rule as the ledger. */
    pricePaise: integer("price_paise").notNull().default(0),

    /** Whoever runs it, as a person — most venue hosts never sign in. */
    ownerPersonId: text("owner_person_id").references(() => people.id, { onDelete: "set null" }),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),

    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    uniqueIndex("venues_slug_idx").on(t.slug),
    index("venues_owner_idx").on(t.ownerPersonId),
  ],
);

export type BookingStatus = "requested" | "confirmed" | "declined";

/* One request for one half-hour on one date.
 *
 * A venue with four courts can hold four confirmed bookings in the same slot,
 * so there is deliberately NO unique index on (venue, date, slot) — the cap is
 * the court count and it is enforced when a booking is CONFIRMED, not when it
 * is asked for. The legacy version enforces nothing at all and will happily
 * confirm fifty bookings onto two courts.
 *
 * `personId` is null for a guest who typed their name in without being on the
 * roster, which is the common case for a venue: the people booking a court are
 * not necessarily players anyone has registered. */
export const venueBookings = pgTable(
  "venue_bookings",
  {
    id: id(),
    venueId: text("venue_id").notNull().references(() => venues.id, { onDelete: "cascade" }),
    /** ISO date, "2026-09-18". Local, never via toISOString — see lib/community. */
    date: text("date").notNull(),
    /** "06:00–06:30", as produced by halfHourSlots. */
    slot: text("slot").notNull(),

    personId: text("person_id").references(() => people.id, { onDelete: "set null" }),
    /** Shown when there is no linked person. */
    guestName: text("guest_name").notNull().default("Guest"),

    status: text("status").$type<BookingStatus>().notNull().default("requested"),
    decidedAt: timestamp("decided_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index("venue_bookings_venue_idx").on(t.venueId),
    index("venue_bookings_when_idx").on(t.venueId, t.date),
    /* Stops one PERSON asking for the same half hour twice. NULLs count as
       distinct in a unique index, which is exactly right here: several guests
       may each want the same slot on different courts. */
    uniqueIndex("venue_bookings_person_slot_idx").on(t.venueId, t.date, t.slot, t.personId),
  ],
);

/* ── Court Ledger ─────────────────────────────────────────────────────────
 *
 * Shared spending for one group: who paid for what, who it splits between, and
 * the smallest set of transfers that squares everyone up.
 *
 * The maths is ALREADY PORTED and tested — `lib/finance` carries
 * ledgerShares / OwedMap / Balances / Pairs / SettleUp across from the
 * standalone ledger app, with the invariants pinned (balances sum to zero;
 * applying the settle-up plan zeroes everyone; circular debt needs no
 * transfers). These tables exist to load a book into the exact `LedgerBook`
 * shape that engine already takes, so not a line of the arithmetic changes.
 *
 * **Amounts are integer paise, never floats.** ₹1000 split three ways is
 * 33333 + 33333 + 33334, the odd paise to the payer, so a book sums to exactly
 * what was spent.
 *
 * Legacy source: LedgerTab, app.source.js:12544-11997, stored under `rs_ledger`.
 */

export const ledgerBooks = pgTable(
  "ledger_books",
  {
    id: id(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    archivedAt: timestamp("archived_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [uniqueIndex("ledger_books_slug_idx").on(t.slug)],
);

/* A member of a book.
 *
 * Deliberately NOT a foreign key to `people`. A book is often shared with
 * someone's flatmate or a friend who drove — people who settle up but never
 * play, and who have no business in a table that carries ratings. `personId`
 * links the ones who ARE players, and is null for everyone else. */
export const ledgerMembers = pgTable(
  "ledger_members",
  {
    id: id(),
    bookId: text("book_id").notNull().references(() => ledgerBooks.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    personId: text("person_id").references(() => people.id, { onDelete: "set null" }),
    /** Position in the book, which also picks their avatar colour. */
    position: integer("position").notNull().default(0),
    createdAt: created(),
  },
  (t) => [index("ledger_members_book_idx").on(t.bookId)],
);

export type LedgerEntryType = "COURT_BOOKING" | "EQUIPMENT" | "FOOD_DRINKS" | "OTHER";

/** One expense: somebody paid, and it splits between these people. */
export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: id(),
    bookId: text("book_id").notNull().references(() => ledgerBooks.id, { onDelete: "cascade" }),
    /** Integer paise. */
    amount: integer("amount_paise").notNull(),
    payerId: text("payer_id").notNull().references(() => ledgerMembers.id, { onDelete: "cascade" }),
    /** Member ids the cost splits between. At least one, always. */
    participantIds: jsonb("participant_ids").$type<string[]>().notNull().default([]),
    type: text("type").$type<LedgerEntryType>().notNull().default("OTHER"),
    note: text("note").notNull().default(""),
    /** Where it happened, free text. */
    venue: text("venue").notNull().default(""),
    /** ISO date, local — never via toISOString. */
    date: text("date").notNull(),
    createdAt: created(),
  },
  (t) => [
    index("ledger_entries_book_idx").on(t.bookId),
    index("ledger_entries_date_idx").on(t.bookId, t.date),
  ],
);

export type LedgerPaymentStatus = "PENDING" | "CONFIRMED" | "REJECTED";
export type LedgerPaymentMethod = "UPI" | "CASH" | "BANK";

/* Money actually handed over.
 *
 * Lands as PENDING and needs the RECIPIENT to confirm it, so one side cannot
 * clear a debt on their own. Only a CONFIRMED payment moves a balance — see
 * `ledgerOwedMap` in lib/finance. */
export const ledgerPayments = pgTable(
  "ledger_payments",
  {
    id: id(),
    bookId: text("book_id").notNull().references(() => ledgerBooks.id, { onDelete: "cascade" }),
    fromId: text("from_id").notNull().references(() => ledgerMembers.id, { onDelete: "cascade" }),
    toId: text("to_id").notNull().references(() => ledgerMembers.id, { onDelete: "cascade" }),
    /** Integer paise. */
    amount: integer("amount_paise").notNull(),
    method: text("method").$type<LedgerPaymentMethod>().notNull().default("UPI"),
    status: text("status").$type<LedgerPaymentStatus>().notNull().default("PENDING"),
    note: text("note").notNull().default(""),
    date: text("date").notNull(),
    confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
    createdAt: created(),
  },
  (t) => [
    index("ledger_payments_book_idx").on(t.bookId),
    index("ledger_payments_status_idx").on(t.bookId, t.status),
  ],
);

/* ── Peer ratings and endorsements ────────────────────────────────────────
 *
 * What other players say you are good at. The RISE Rating measures results;
 * this is the other half — "great hands at the net", "always a good partner" —
 * and it never touches the rating.
 *
 * ── One row per rater, not a running average ─────────────────────────────
 * The legacy app keeps an average and a count on the player
 * (`skills`, `skillRatingsCount`) and folds each new rating in. That cannot
 * tell two ratings from one person apart from two people's, so anybody can lift
 * their own numbers by submitting repeatedly, and there is no way to find out
 * afterwards or take it back.
 *
 * A row per (subject, rater, sport, skill) with a UNIQUE index makes a second
 * rating from the same person REPLACE their first. One person, one voice —
 * enforced by the database rather than by the screen.
 *
 * `sport` is on the row because the thirteen skills differ per sport: a
 * pickleball dink and a chess endgame are not the same axis.
 */
export const skillRatings = pgTable(
  "skill_ratings",
  {
    id: id(),
    subjectPersonId: text("subject_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    raterPersonId: text("rater_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    sport: text("sport").$type<SportId>().notNull(),
    /** One of SPORTS[sport].skills. */
    skill: text("skill").notNull(),
    /** 1-5, the legacy scale, with 3 as the neutral default. */
    score: integer("score").notNull(),
    createdAt: created(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("skill_ratings_subject_idx").on(t.subjectPersonId),
    /* The anti-inflation guard. Rating the same skill again updates this row. */
    uniqueIndex("skill_ratings_one_per_rater_idx")
      .on(t.subjectPersonId, t.raterPersonId, t.sport, t.skill),
  ],
);

/** A tag somebody put on you ("Dink Master"). Same one-per-rater rule. */
export const skillEndorsements = pgTable(
  "skill_endorsements",
  {
    id: id(),
    subjectPersonId: text("subject_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    raterPersonId: text("rater_person_id").notNull().references(() => people.id, { onDelete: "cascade" }),
    sport: text("sport").$type<SportId>().notNull(),
    /** One of SPORTS[sport].tags. */
    tag: text("tag").notNull(),
    createdAt: created(),
  },
  (t) => [
    index("skill_endorsements_subject_idx").on(t.subjectPersonId),
    uniqueIndex("skill_endorsements_one_per_rater_idx")
      .on(t.subjectPersonId, t.raterPersonId, t.sport, t.tag),
  ],
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
export type CommunityGame = typeof communityGames.$inferSelect;
export type CommunitySession = typeof communitySessions.$inferSelect;
export type CommunityAttendance = typeof communityAttendance.$inferSelect;
export type CommunityMember = typeof communityMembers.$inferSelect;
export type CommunityMatch = typeof communityMatches.$inferSelect;
export type Venue = typeof venues.$inferSelect;
export type VenueBooking = typeof venueBookings.$inferSelect;
export type LedgerBookRow = typeof ledgerBooks.$inferSelect;
export type LedgerMemberRow = typeof ledgerMembers.$inferSelect;
export type LedgerEntryRow = typeof ledgerEntries.$inferSelect;
export type LedgerPaymentRow = typeof ledgerPayments.$inferSelect;
export type SkillRating = typeof skillRatings.$inferSelect;
export type SkillEndorsement = typeof skillEndorsements.$inferSelect;
