import "server-only";

/* Reading and writing community games.
 *
 * Everything that touches the database lives here, so the pages stay about
 * layout and `lib/community/index.ts` stays pure and testable.
 */

import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  communityAttendance, communityGames, communityMembers, communitySessions,
  people,
  type AttendanceState, type CommunityGame, type CommunitySession, type Person,
  type Restrictions,
} from "@/lib/db/schema";
import { capacityOf, sessionDates, slugifyGame } from "./index";

/* ── Games ────────────────────────────────────────────────────────────────*/

export async function listGames(): Promise<CommunityGame[]> {
  return db
    .select()
    .from(communityGames)
    .where(isNull(communityGames.archivedAt))
    .orderBy(desc(communityGames.createdAt));
}

export async function gameBySlug(slug: string): Promise<CommunityGame | null> {
  const [game] = await db.select().from(communityGames).where(eq(communityGames.slug, slug)).limit(1);
  return game ?? null;
}

export type NewGameInput = {
  name: string;
  sport: CommunityGame["sport"];
  venue: string;
  area: string;
  freq: CommunityGame["freq"];
  days: number[];
  startTime: string;
  endTime: string;
  courts: number;
  perCourt: number;
  rotation: CommunityGame["rotation"];
  scheduleMode: CommunityGame["scheduleMode"];
  accessType: CommunityGame["accessType"];
  pricePaise: number;
  restrictions: Restrictions;
  hostPersonId: string | null;
};

export async function createGame(input: NewGameInput): Promise<CommunityGame> {
  /* Slugs are unique in the schema, so a collision is resolved here rather than
     surfacing as a database error in the organiser's face — the same approach
     the tournament create action takes. */
  let slug = slugifyGame(input.name);
  const taken = await db
    .select({ slug: communityGames.slug })
    .from(communityGames)
    .where(eq(communityGames.slug, slug));
  if (taken.length) slug = `${slug}-${randomUUID().slice(0, 4)}`;

  /* A weekly game with no day chosen would never run. Default to today, which
     is what the legacy create handler does (app.source.js:9377). */
  const days =
    input.freq === "daily" ? [] : input.days.length ? [...input.days].sort((a, b) => a - b) : [new Date().getDay()];

  const [game] = await db
    .insert(communityGames)
    .values({ id: randomUUID(), slug, ...input, days })
    .returning();
  return game;
}

/* ── Sessions ─────────────────────────────────────────────────────────────
 *
 * A session row is created lazily, the first time anyone interacts with a date.
 * A weekly game running for a year is 52 dates; materialising them up front
 * would write rows nobody ever looks at and would have to be re-run whenever
 * the organiser changes the days. */

export async function findSession(gameId: string, date: string): Promise<CommunitySession | null> {
  const [s] = await db
    .select()
    .from(communitySessions)
    .where(and(eq(communitySessions.gameId, gameId), eq(communitySessions.date, date)))
    .limit(1);
  return s ?? null;
}

export async function ensureSession(gameId: string, date: string): Promise<CommunitySession> {
  const existing = await findSession(gameId, date);
  if (existing) return existing;

  /* Two people hitting the same date at once would both miss the SELECT above
     and both insert. The unique index makes the second one fail, so take the
     conflict as "somebody else just made it" and read theirs. */
  const [created] = await db
    .insert(communitySessions)
    .values({ id: randomUUID(), gameId, date })
    .onConflictDoNothing({ target: [communitySessions.gameId, communitySessions.date] })
    .returning();
  if (created) return created;

  const row = await findSession(gameId, date);
  if (!row) throw new Error(`could not open session ${date}`);
  return row;
}

/* ── One session, as a screen needs it ────────────────────────────────────*/

export type RosterEntry = {
  personId: string;
  person: Person;
  state: AttendanceState;
  position: number;
  paid: boolean;
  paymentLinkSentAt: Date | null;
  withdrewAt: Date | null;
};

export type SessionView = {
  session: CommunitySession | null;
  date: string;
  capacity: number;
  roster: RosterEntry[];
  confirmed: RosterEntry[];
  waitlist: RosterEntry[];
  requested: RosterEntry[];
  interested: RosterEntry[];
  /** Confirmed players who pulled out. Their spots are what `openSlotsIn` counts. */
  withdrawn: RosterEntry[];
};

const byPosition = (a: RosterEntry, b: RosterEntry) => a.position - b.position;

/**
 * The whole guest list for one date, split by state.
 *
 * Reads the session even when it does not exist yet — browsing a future date
 * must not create a row, so this returns an empty roster rather than calling
 * ensureSession. Only an action that changes something opens a session.
 */
export async function sessionView(game: CommunityGame, date: string): Promise<SessionView> {
  const session = await findSession(game.id, date);
  const capacity = capacityOf(game);

  if (!session) {
    return {
      session: null, date, capacity, roster: [],
      confirmed: [], waitlist: [], requested: [], interested: [], withdrawn: [],
    };
  }

  const rows = await db
    .select({ a: communityAttendance, p: people })
    .from(communityAttendance)
    .innerJoin(people, eq(communityAttendance.personId, people.id))
    .where(eq(communityAttendance.sessionId, session.id))
    .orderBy(asc(communityAttendance.position), asc(communityAttendance.createdAt));

  const roster: RosterEntry[] = rows.map(({ a, p }) => ({
    personId: a.personId,
    person: p,
    state: a.state,
    position: a.position,
    paid: a.paid,
    paymentLinkSentAt: a.paymentLinkSentAt,
    withdrewAt: a.withdrewAt,
  }));

  const of = (s: AttendanceState) => roster.filter((r) => r.state === s).sort(byPosition);

  return {
    session, date, capacity, roster,
    confirmed: of("confirmed"),
    waitlist: of("waitlist"),
    requested: of("requested"),
    interested: of("interested"),
    withdrawn: of("withdrawn"),
  };
}

/** My own row for this date, or null when I have not engaged with it. */
export function myEntry(view: SessionView, personId: string | null): RosterEntry | null {
  if (!personId) return null;
  return view.roster.find((r) => r.personId === personId) ?? null;
}

/* ── List-screen summaries ────────────────────────────────────────────────*/

export type GameCard = {
  game: CommunityGame;
  nextDate: string | null;
  confirmedCount: number;
  capacity: number;
};

/**
 * The browse list: every game with its next date and how full that date is.
 *
 * The counts come from ONE grouped query rather than a query per game — a
 * hundred games on a city's browse screen would otherwise be a hundred round
 * trips through the pooler.
 */
export async function gameCards(now = new Date()): Promise<GameCard[]> {
  const games = await listGames();
  if (!games.length) return [];

  const nextDates = new Map(games.map((g) => [g.id, sessionDates(g, 1, now)[0] ?? null]));

  const wanted = games
    .map((g) => ({ gameId: g.id, date: nextDates.get(g.id) }))
    .filter((x): x is { gameId: string; date: string } => !!x.date);
  if (!wanted.length) {
    return games.map((g) => ({ game: g, nextDate: null, confirmedCount: 0, capacity: capacityOf(g) }));
  }

  const counts = await db
    .select({
      gameId: communitySessions.gameId,
      date: communitySessions.date,
      n: sql<number>`count(*)::int`,
    })
    .from(communityAttendance)
    .innerJoin(communitySessions, eq(communityAttendance.sessionId, communitySessions.id))
    .where(
      and(
        inArray(communitySessions.gameId, wanted.map((w) => w.gameId)),
        inArray(communitySessions.date, [...new Set(wanted.map((w) => w.date))]),
        eq(communityAttendance.state, "confirmed"),
      ),
    )
    .groupBy(communitySessions.gameId, communitySessions.date);

  const key = (gameId: string, date: string) => `${gameId} ${date}`;
  const countBy = new Map(counts.map((c) => [key(c.gameId, c.date), c.n]));

  return games.map((g) => {
    const nextDate = nextDates.get(g.id) ?? null;
    return {
      game: g,
      nextDate,
      confirmedCount: nextDate ? countBy.get(key(g.id, nextDate)) ?? 0 : 0,
      capacity: capacityOf(g),
    };
  });
}

/* ── Membership of restricted games ───────────────────────────────────────*/

export async function membershipOf(gameId: string, personId: string | null) {
  if (!personId) return null;
  const [row] = await db
    .select()
    .from(communityMembers)
    .where(and(eq(communityMembers.gameId, gameId), eq(communityMembers.personId, personId)))
    .limit(1);
  return row ?? null;
}

/**
 * May this person put their hand up for a date?
 *
 * Open games: anyone. Restricted games: members only — an invitation or a
 * pending request is not yet membership, which is the point of the state.
 */
export async function canJoinSessions(game: CommunityGame, personId: string | null): Promise<boolean> {
  if (game.accessType === "open") return true;
  if (!personId) return false;
  if (game.hostPersonId === personId) return true;
  const m = await membershipOf(game.id, personId);
  return m?.state === "member";
}

/** True when this person runs the game. Host-only actions all go through it. */
export const isHost = (game: CommunityGame, personId: string | null): boolean =>
  !!personId && game.hostPersonId === personId;
