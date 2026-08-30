/* Build-time guarantee, not a convention: importing this from a Client
   Component fails the build. Grepping the output bundle cannot do this — the
   minifier renames every identifier, so the algorithm ships intact under a
   one-letter name. See lib/__tests__/bundle-leak.test.ts. */
import "server-only";

/* Scorer PIN hashing.
 *
 * A PIN is short and low-entropy by design — a volunteer has to type it
 * courtside on a phone — so it is treated as a password: salted, stretched with
 * scrypt, and compared in constant time. The PIN itself is never stored, never
 * logged and never sent to the client.
 *
 * scrypt from node:crypto rather than bcrypt/argon2 so there is no native
 * dependency to build on a serverless runtime. */

import { randomBytes, scrypt as scryptCb, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
) => Promise<Buffer>;

const KEYLEN = 32;
const PREFIX = "scrypt";

/** `scrypt$<saltHex>$<hashHex>` — self-describing so the format can change later. */
export async function hashPin(pin: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(pin.normalize("NFKC"), salt, KEYLEN);
  return `${PREFIX}$${salt.toString("hex")}$${hash.toString("hex")}`;
}

export async function verifyPin(pin: string, stored: string | null | undefined): Promise<boolean> {
  if (!stored) return false;
  const [scheme, saltHex, hashHex] = stored.split("$");
  if (scheme !== PREFIX || !saltHex || !hashHex) return false;

  const expected = Buffer.from(hashHex, "hex");
  if (expected.length !== KEYLEN) return false;

  const actual = await scrypt(pin.normalize("NFKC"), Buffer.from(saltHex, "hex"), KEYLEN);
  return timingSafeEqual(actual, expected);
}

/** A random 6-digit PIN. Uses rejection sampling so every value is equally
 *  likely — `randomBytes % 1000000` is biased and this is an access control. */
export function generatePin(): string {
  const LIMIT = 1_000_000;
  const MAX = Math.floor(0xffffffff / LIMIT) * LIMIT;
  for (;;) {
    const n = randomBytes(4).readUInt32BE(0);
    if (n < MAX) return String(n % LIMIT).padStart(6, "0");
  }
}

/** Opaque, unguessable token for a redeemed PIN, stored in an httpOnly cookie. */
export const generateGrantToken = (): string => randomBytes(32).toString("base64url");
