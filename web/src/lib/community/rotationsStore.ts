import "server-only";

/* The database side of slots, King of the Court and the ladder.
 *
 * The engines in rotations.ts are pure; these read the current state, hand it
 * to the engine, and write what comes back — inside a transaction, so two
 * people tapping the same slot or the same court cannot both win.
 */

import { eq } from "drizzle-orm";

import { db } from "@/lib/db";
import {
  communityGames, communitySessions,
  type CommunityGame,
} from "@/lib/db/schema";
import { todayInIndia } from "@/lib/eligibility";
import { capacityOf } from "./index";
import { ensureSession } from "./store";
import {
  reserveSlot, leaveSlot, kotcStart, kotcPickWinner, kotcNextRound,
  ladderAdd, ladderRemove, ladderChallenge,
  type KotcState, type LadderEntry, type SlotData,
} from "./rotations";

export type RotationResult = { ok: true } | { ok: false; error: string };
const no = (error: string): RotationResult => ({ ok: false, error });

/* ── Slots ────────────────────────────────────────────────────────────────*/

/**
 * How many people fit in one half-hour slot.
 *
 * The whole venue, not one court: a slot is a window of time across every court
 * the host has booked, which is how the legacy app counts it (`W` at :10114).
 */
export const slotCapacity = (game: CommunityGame): number => capacityOf(game);

async function withSlots(
  game: CommunityGame,
  date: string,
  change: (slots: SlotData) => SlotData,
): Promise<RotationResult> {
  const session = await ensureSession(game.id, date);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ slotData: communitySessions.slotData })
      .from(communitySessions)
      .where(eq(communitySessions.id, session.id))
      .limit(1);

    const next = change(current?.slotData ?? {});
    await tx
      .update(communitySessions)
      .set({ slotData: next })
      .where(eq(communitySessions.id, session.id));
    return { ok: true } as RotationResult;
  });
}

export const takeSlot = (game: CommunityGame, date: string, personId: string, slot: string) =>
  withSlots(game, date, (s) => reserveSlot(s, slot, personId, slotCapacity(game)));

export const giveUpSlot = (game: CommunityGame, date: string, personId: string, slot: string) =>
  withSlots(game, date, (s) => leaveSlot(s, slot, personId));

/** Reservations for one date. Reading never opens a session. */
export async function slotsFor(game: CommunityGame, date: string): Promise<SlotData> {
  const { findSession } = await import("./store");
  const session = await findSession(game.id, date);
  return session?.slotData ?? {};
}

/* ── King of the Court ────────────────────────────────────────────────────*/

async function withKotc(
  game: CommunityGame,
  date: string,
  change: (state: KotcState | null) => KotcState | null | { error: string },
): Promise<RotationResult> {
  const session = await ensureSession(game.id, date);

  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ kotc: communitySessions.kotc })
      .from(communitySessions)
      .where(eq(communitySessions.id, session.id))
      .limit(1);

    const next = change((current?.kotc as KotcState | null) ?? null);
    if (next && "error" in next) return no(next.error);

    await tx
      .update(communitySessions)
      .set({ kotc: next as Record<string, unknown> | null })
      .where(eq(communitySessions.id, session.id));
    return { ok: true } as RotationResult;
  });
}

export async function startKotc(game: CommunityGame, date: string): Promise<RotationResult> {
  const { sessionView } = await import("./store");
  const view = await sessionView(game, date);
  const confirmed = view.confirmed.map((r) => r.personId);

  return withKotc(game, date, () => {
    const drawn = kotcStart(confirmed, game.courts);
    return drawn ?? { error: "King of the Court needs at least four confirmed players." };
  });
}

export const pickKotcWinner = (
  game: CommunityGame, date: string, courtIndex: number, side: "a" | "b",
) =>
  withKotc(game, date, (s) =>
    s ? kotcPickWinner(s, courtIndex, side) : { error: "Start the session first." },
  );

export const advanceKotc = (game: CommunityGame, date: string) =>
  withKotc(game, date, (s) => {
    if (!s) return { error: "Start the session first." };
    const next = kotcNextRound(s);
    /* kotcNextRound returns the same object when a court is unresolved, which
       would otherwise look like a successful no-op to the person tapping it. */
    return next === s ? { error: "Every court needs a winner first." } : next;
  });

export const resetKotc = (game: CommunityGame, date: string) =>
  withKotc(game, date, () => null);

export async function kotcFor(game: CommunityGame, date: string): Promise<KotcState | null> {
  const { findSession } = await import("./store");
  const session = await findSession(game.id, date);
  return (session?.kotc as KotcState | null) ?? null;
}

/* ── Ladder ───────────────────────────────────────────────────────────────
 *
 * On the GAME, not on a session: a ladder persists across dates, which is the
 * whole point of one. */

async function withLadder(
  game: CommunityGame,
  change: (order: string[], log: LadderEntry[]) =>
    { order: string[]; log: LadderEntry[] } | { error: string },
): Promise<RotationResult> {
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ order: communityGames.ladderOrder, log: communityGames.ladderLog })
      .from(communityGames)
      .where(eq(communityGames.id, game.id))
      .limit(1);

    const next = change(
      current?.order ?? [],
      (current?.log as LadderEntry[] | null) ?? [],
    );
    if ("error" in next) return no(next.error);

    await tx
      .update(communityGames)
      .set({ ladderOrder: next.order, ladderLog: next.log })
      .where(eq(communityGames.id, game.id));
    return { ok: true } as RotationResult;
  });
}

export const addToLadder = (game: CommunityGame, personId: string) =>
  withLadder(game, (order, log) => ({ order: ladderAdd(order, personId), log }));

export const removeFromLadder = (game: CommunityGame, personId: string) =>
  withLadder(game, (order, log) => ({ order: ladderRemove(order, personId), log }));

export const settleChallenge = (
  game: CommunityGame, challenger: string, defender: string, challengerWon: boolean,
) =>
  withLadder(game, (order, log) => {
    const res = ladderChallenge(order, log, challenger, defender, challengerWon, todayInIndia());
    return res.ok ? { order: res.order, log: res.log } : { error: res.error };
  });

export async function ladderFor(
  game: CommunityGame,
): Promise<{ order: string[]; log: LadderEntry[] }> {
  const [row] = await db
    .select({ order: communityGames.ladderOrder, log: communityGames.ladderLog })
    .from(communityGames)
    .where(eq(communityGames.id, game.id))
    .limit(1);
  return { order: row?.order ?? [], log: (row?.log as LadderEntry[] | null) ?? [] };
}
