/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Open-access mode — TESTING ONLY.
 *
 * While the product is pre-release, every visitor gets full rights: no PIN, no
 * sign-in, nothing to remember. The point is to exercise the features, not the
 * access control.
 *
 * This is a SWITCH, not a deletion. The authorization system underneath is
 * intact and still unit-tested (lib/auth/policy.ts, 20 tests): roles, the
 * scrypt-hashed scorer PIN, per-tournament grants and the checks inside every
 * Server Action all still exist.
 *
 *   RISE_OPEN_ACCESS=0   -> enforce roles and PINs
 *   anything else/unset  -> open access (current default, for testing)
 *
 * ── DO NOT SET IT TO 0 YET. It would lock EVERYONE out. ───────────────────
 *
 * An earlier version of this comment said flipping the flag "turns them back on
 * in one move, with no code to rewrite". That is false, and acting on it takes
 * the tournament side down.
 *
 * `next-auth` is in package.json but was never wired up: there is no
 * `api/auth/[...nextauth]` route, `NextAuth()` is called nowhere, and
 * `currentUserId()` in lib/auth/guard.ts is a placeholder that returns null.
 * So with this flag off, `principalFor` yields `anonymous()` — `userId: null`,
 * `role: null`, `isOwner: false` — and `atLeast()` is therefore false for
 * everyone, forever. Consequences, checked rather than assumed:
 *
 *   canManage()      -> false for every visitor, the owner included
 *   canView(draft)   -> false, so draft tournaments vanish for everybody
 *
 * Nobody could create a team, draw a bracket, set a scorer PIN, or reach the
 * manage screen to turn any of it back on. The only route in would be flipping
 * the flag again.
 *
 * It would also buy little on the community side, where `hostGuard` /
 * `ownerGuard` compare against the `rs_me` cookie — a name badge the viewer
 * picks from a list, not a credential. See lib/community/me.ts: it identifies,
 * it never authorises.
 *
 * **The prerequisite is real sign-in**, not this flag. Wire `currentUserId()`
 * to something that can actually answer the question, then this becomes the
 * one-move switch it claims to be.
 *
 * Faisal's decision, 2026-09-14, with the above on the table: leave it OPEN.
 * He is the only one testing and the product is not public yet. Revisit before
 * the address is shared with organisers.
 *
 * Every page shows a banner while this is on, so an open deployment cannot be
 * mistaken for a locked one.
 */

export const OPEN_ACCESS = process.env.RISE_OPEN_ACCESS !== "0";

/** Human-readable reason, for the banner and for logs. */
export const OPEN_ACCESS_NOTICE =
  "Open access is on — anyone can score and manage. Set RISE_OPEN_ACCESS=0 to require a PIN.";
