import "server-only";

/* May the caller run this game?
 *
 * Deliberately NOT in the actions file: a `"use server"` module exports every
 * function as something the browser can call by name, and an authorisation
 * check is the last thing that should be reachable that way.
 */

import { OPEN_ACCESS } from "@/lib/auth/access";
import { gameBySlug, isHost } from "./store";
import { myPersonId } from "./me";
import type { CommunityGame } from "@/lib/db/schema";

/**
 * Load a game and assert the caller may run it.
 *
 * Open access grants it to everyone, exactly as `principalFor` does for
 * tournaments — one switch, turned off in production, rather than two different
 * answers to "who is in charge here". The real check underneath is the game's
 * `hostPersonId`, and it still runs when the switch is off.
 */
export async function hostGuard(slug: string): Promise<CommunityGame> {
  const game = await gameBySlug(slug);
  if (!game) throw new Error("No such game.");
  if (OPEN_ACCESS) return game;

  const personId = await myPersonId();
  if (!isHost(game, personId)) throw new Error("Only the host can do that.");
  return game;
}

/** Is the viewer looking at this game as the person who runs it? */
export async function viewingAsHost(game: CommunityGame): Promise<boolean> {
  if (isHost(game, await myPersonId())) return true;
  /* With open access on and no host set, whoever opens the page runs it —
     otherwise a game created before anyone picked an identity is unmanageable. */
  return OPEN_ACCESS && game.hostPersonId === null;
}
