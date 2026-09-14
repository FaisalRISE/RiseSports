"use server";

/* Server Actions for community play.
 *
 * Every one of these re-reads what it needs from the database and decides for
 * itself whether the caller may do it. Nothing is trusted from the form beyond
 * the values it parses — in particular, the "who am I" cookie identifies but
 * never authorises: a host-only action checks the game's host, not the cookie's
 * claim about itself. See lib/community/me.ts.
 */

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { createGame } from "@/lib/community/store";
import { setMe, clearMe, myPersonId } from "@/lib/community/me";
import { NO_RESTRICTIONS, type CommunityGame } from "@/lib/db/schema";
import { SPORT_IDS } from "@/lib/sports/registry";

export type ActionResult = { ok: true } | { ok: false; error: string };

/* ── Identity ─────────────────────────────────────────────────────────────*/

export async function chooseIdentity(personId: string): Promise<ActionResult> {
  const id = z.string().min(1).max(64).safeParse(personId);
  if (!id.success) return { ok: false, error: "Pick a player." };
  await setMe(id.data);
  revalidatePath("/play");
  return { ok: true };
}

export async function forgetIdentity(): Promise<ActionResult> {
  await clearMe();
  revalidatePath("/play");
  return { ok: true };
}

export type PlayerHit = { id: string; name: string; rating: number | null };

/**
 * Find a player by name, to say which one you are.
 *
 * Returns the rating alongside the name because two "Rahul S" rows are
 * indistinguishable otherwise, and picking the wrong one here attaches your
 * evening to somebody else's rating — the same reasoning as PersonPicker.
 */
export async function searchPlayers(query: string): Promise<PlayerHit[]> {
  const q = z.string().trim().max(60).catch("").parse(query);
  if (q.length < 2) return [];
  const { searchPeople } = await import("@/lib/people");
  const found = await searchPeople(q, 8);
  return found.map((f) => ({ id: f.id, name: f.name, rating: f.rating }));
}

/* ── Hosting a game ───────────────────────────────────────────────────────*/

/** "" and "0" both mean "no limit". A real 0 would be a meaningless rating. */
const optionalNumber = z
  .union([z.string(), z.number(), z.null()])
  .transform((v) => {
    if (v == null) return null;
    const n = typeof v === "number" ? v : Number(String(v).trim());
    return String(v).trim() === "" || !Number.isFinite(n) ? null : n;
  });

/** "3.75" in the form, 375 in the database — DUPR is stored in hundredths. */
const optionalDupr = optionalNumber.transform((n) => (n == null ? null : Math.round(n * 100)));

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

const createSchema = z.object({
  name: z.string().trim().min(2, "Give the game a name.").max(80),
  sport: z.enum(SPORT_IDS as [string, ...string[]]),
  venue: z.string().trim().max(80),
  area: z.string().trim().max(80),
  freq: z.enum(["daily", "weekly"]),
  days: z.array(z.coerce.number().int().min(0).max(6)),
  startTime: z.string().regex(HHMM, "Start time must look like 20:00."),
  endTime: z.string().regex(HHMM, "End time must look like 22:00."),
  courts: z.coerce.number().int().min(1).max(10),
  perCourt: z.coerce.number().int().min(1).max(10),
  rotation: z.enum(["fixed", "rotate", "slots", "kotc", "ladder"]),
  scheduleMode: z.enum(["random", "balanced", "americano", "mexicano"]),
  accessType: z.enum(["open", "restricted"]),
  price: optionalNumber,
  gsrMin: optionalNumber, gsrMax: optionalNumber,
  duprMin: optionalDupr, duprMax: optionalDupr,
  ageMin: optionalNumber, ageMax: optionalNumber,
  gender: z.enum(["any", "M", "F"]),
});

export async function createCommunityGame(formData: FormData): Promise<never> {
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    sport: formData.get("sport"),
    venue: formData.get("venue") ?? "",
    area: formData.get("area") ?? "",
    freq: formData.get("freq"),
    days: formData.getAll("days"),
    startTime: formData.get("startTime"),
    endTime: formData.get("endTime"),
    courts: formData.get("courts"),
    perCourt: formData.get("perCourt"),
    rotation: formData.get("rotation"),
    scheduleMode: formData.get("scheduleMode"),
    accessType: formData.get("accessType"),
    price: formData.get("price"),
    gsrMin: formData.get("gsrMin"), gsrMax: formData.get("gsrMax"),
    duprMin: formData.get("duprMin"), duprMax: formData.get("duprMax"),
    ageMin: formData.get("ageMin"), ageMax: formData.get("ageMax"),
    gender: formData.get("gender") ?? "any",
  });

  if (!parsed.success) {
    const first = parsed.error.issues[0];
    redirect(`/play/new?error=${encodeURIComponent(first?.message ?? "Check the form.")}`);
  }

  const v = parsed.data;

  /* A pair of bounds entered the wrong way round is a typo, not a rule nobody
     can satisfy — swap rather than silently creating a game with no eligible
     players. */
  const range = (min: number | null, max: number | null): [number | null, number | null] =>
    min != null && max != null && min > max ? [max, min] : [min, max];
  const [gsrMin, gsrMax] = range(v.gsrMin, v.gsrMax);
  const [duprMin, duprMax] = range(v.duprMin, v.duprMax);
  const [ageMin, ageMax] = range(v.ageMin, v.ageMax);

  const game = await createGame({
    name: v.name,
    sport: v.sport as CommunityGame["sport"],
    venue: v.venue || "TBD Venue",
    area: v.area,
    freq: v.freq,
    days: v.days,
    startTime: v.startTime,
    endTime: v.endTime,
    courts: v.courts,
    perCourt: v.perCourt,
    rotation: v.rotation,
    scheduleMode: v.scheduleMode,
    accessType: v.accessType,
    /* Rupees in the form, integer paise in the database — never a float, the
       same rule the ledger runs on. */
    pricePaise: Math.round(Math.max(0, v.price ?? 0) * 100),
    restrictions: {
      ...NO_RESTRICTIONS,
      gsrMin, gsrMax, duprMin, duprMax, ageMin, ageMax,
      gender: v.gender === "any" ? null : v.gender,
    },
    /* Whoever is holding the phone becomes the host. With no identity chosen
       the game is hostless, and open access lets anyone run it — the same
       posture the tournament side takes while there is no sign-in. */
    hostPersonId: await myPersonId(),
  });

  revalidatePath("/play");
  redirect(`/play/${game.slug}`);
}
