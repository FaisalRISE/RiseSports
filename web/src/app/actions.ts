"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { z } from "zod";

import { db } from "@/lib/db";
import { tournaments } from "@/lib/db/schema";
import { SPORT_IDS } from "@/lib/sports/registry";

/** URL-safe slug from a name, with a short suffix if it is already taken. */
function slugify(name: string): string {
  const base = name
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "tournament";
}

const createSchema = z.object({
  name: z.string().trim().min(2).max(80),
  sport: z.enum(SPORT_IDS as [string, ...string[]]),
  format: z.enum(["standard", "osl", "pickleboss"]),
});

export async function createTournament(formData: FormData) {
  const parsed = createSchema.safeParse({
    name: formData.get("name"),
    sport: formData.get("sport"),
    format: formData.get("format"),
  });
  if (!parsed.success) redirect("/new?error=1");

  const { name, sport, format } = parsed.data;

  /* Slugs are unique in the schema, so resolve a collision here rather than
     letting the insert fail in the user's face. */
  let slug = slugify(name);
  const taken = await db.select({ slug: tournaments.slug }).from(tournaments).where(eq(tournaments.slug, slug));
  if (taken.length) slug = `${slug}-${randomUUID().slice(0, 4)}`;

  /* Open access has no signed-in user, so the demo organiser owns everything
     created from the UI. Auth.js replaces this with the real user id. */
  const ownerId = await demoOwnerId();

  await db.insert(tournaments).values({
    id: randomUUID(),
    slug,
    name,
    sport: sport as never,
    format,
    ownerId,
    published: true,
  });

  revalidatePath("/");
  redirect(`/t/${slug}/manage`);
}

/** The placeholder owner used while there is no sign-in. Created on demand. */
async function demoOwnerId(): Promise<string> {
  const { users } = await import("@/lib/db/schema");
  const email = "demo@rise.sports";
  const [existing] = await db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing.id;
  const id = randomUUID();
  await db.insert(users).values({ id, email, name: "Demo Organiser" });
  return id;
}
