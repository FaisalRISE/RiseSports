import Link from "next/link";
import { createTournament } from "../actions";
import { SPORTS, SPORT_IDS } from "@/lib/sports/registry";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

export default async function NewTournament({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-md p-6">
        <Link href="/" className="text-xs font-bold text-neutral-400 hover:underline">← All tournaments</Link>
        <h1 className="mb-6 mt-2 text-2xl font-black">New tournament</h1>

        <form action={createTournament} className="space-y-4">
          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Name</span>
            <input
              name="name" required minLength={2} maxLength={80}
              placeholder="Thursday Club Night"
              className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
            />
          </label>

          <label className="block">
            <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Sport</span>
            <select name="sport" defaultValue="pb" className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm">
              {SPORT_IDS.map((id) => (
                <option key={id} value={id}>{SPORTS[id].emoji} {SPORTS[id].name}</option>
              ))}
            </select>
          </label>

          <fieldset className="space-y-2">
            <legend className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Match format</legend>
            <label className="flex gap-3 rounded-xl border border-neutral-700 p-3">
              <input type="radio" name="format" value="standard" defaultChecked className="mt-1" />
              <span>
                <span className="block text-sm font-bold">Standard</span>
                <span className="block text-xs text-neutral-400">The sport&apos;s own scoring — pickleball to 11 side-out, badminton to 21 rally, table tennis to 11.</span>
              </span>
            </label>
            <label className="flex gap-3 rounded-xl border border-neutral-700 p-3">
              <input type="radio" name="format" value="pickleboss" className="mt-1" />
              <span>
                <span className="block text-sm font-bold">Pickleboss</span>
                <span className="block text-xs text-neutral-400">To 15, win by 2, with the two-point rule stopping at 17 so the 18th point decides it. Groups on separate courts, ranked on wins then point difference.</span>
              </span>
            </label>
            <label className="flex gap-3 rounded-xl border border-neutral-700 p-3">
              <input type="radio" name="format" value="osl" className="mt-1" />
              <span>
                <span className="block text-sm font-bold">OSL team event</span>
                <span className="block text-xs text-neutral-400">Six players as three declared pairs, rotating when the leader reaches 7 and 14. First to 25, golden point at 24–24, ends change at 14.</span>
              </span>
            </label>
          </fieldset>

          {error && (
            <p role="alert" className="text-sm font-semibold text-rose-400">
              Check the name is 2–80 characters and try again.
            </p>
          )}

          <button type="submit" className="w-full rounded-xl bg-amber-400 p-3 text-sm font-black text-amber-950">
            Create
          </button>
        </form>
      </main>
    </>
  );
}
