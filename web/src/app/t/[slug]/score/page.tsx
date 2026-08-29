import { eq } from "drizzle-orm";
import { redirect, notFound } from "next/navigation";
import { db } from "@/lib/db";
import { tournaments } from "@/lib/db/schema";
import { principalFor } from "@/lib/auth/guard";
import { canScore } from "@/lib/auth/policy";
import { redeemPin } from "../actions";

export const dynamic = "force-dynamic";

/* PIN entry. A courtside volunteer unlocks scoring for ONE tournament without
 * needing an account; the grant is a server-side row and an httpOnly cookie, so
 * it can be revoked and it cannot be forged from the client. */
export default async function ScoreEntryPage({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ error?: string }>;
}) {
  const { slug } = await params;
  const { error } = await searchParams;

  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  if (!t) notFound();

  const principal = await principalFor(t.id);
  if (canScore(principal)) redirect(`/t/${slug}`);

  async function submit(formData: FormData) {
    "use server";
    const pin = String(formData.get("pin") ?? "");
    const result = await redeemPin(slug, pin);
    redirect(result.ok ? `/t/${slug}` : `/t/${slug}/score?error=1`);
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center p-6">
      <h1 className="text-2xl font-black">{t.name}</h1>
      <p className="mb-6 mt-1 text-sm text-neutral-400">
        Enter the referee PIN to score this tournament. It works for this event only.
      </p>
      <form action={submit} className="space-y-3">
        <input
          name="pin"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="PIN"
          required
          minLength={4}
          maxLength={12}
          className="w-full rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-center font-mono text-2xl tracking-[0.3em]"
        />
        {error && (
          <p role="alert" className="text-sm font-semibold text-rose-400">
            That PIN was not recognised.
          </p>
        )}
        <button type="submit" className="w-full rounded-xl bg-amber-400 p-4 text-sm font-black text-amber-950">
          Unlock scoring
        </button>
      </form>
    </main>
  );
}
