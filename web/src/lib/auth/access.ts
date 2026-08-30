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
 * Server Action all still exist. Flipping this flag turns them back on in one
 * move, with no code to rewrite.
 *
 *   RISE_OPEN_ACCESS=0   -> enforce roles and PINs (production posture)
 *   anything else/unset  -> open access (current default, for testing)
 *
 * Deliberately defaults to OPEN so a fresh deploy is immediately usable. When
 * the product matures, set RISE_OPEN_ACCESS=0 on the Vercel project and the
 * PIN gate returns. Every page shows a banner while this is on, so an open
 * deployment cannot be mistaken for a locked one.
 */

export const OPEN_ACCESS = process.env.RISE_OPEN_ACCESS !== "0";

/** Human-readable reason, for the banner and for logs. */
export const OPEN_ACCESS_NOTICE =
  "Open access is on — anyone can score and manage. Set RISE_OPEN_ACCESS=0 to require a PIN.";
