import Link from "next/link";

import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { SPORTS, SPORT_IDS } from "@/lib/sports/registry";
import { HostForm } from "./HostForm";

/* The registry stays on the server — only id, name and emoji cross to the form.
 * Its scoring blocks, serve models and skill lists are engine data and have no
 * business in a client bundle. Same rule as /new. */
export default async function NewCommunityGame({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const sports = SPORT_IDS.map((id) => ({ id, name: SPORTS[id].name, emoji: SPORTS[id].emoji }));

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-lg p-4 sm:p-6">
        <Link href="/play" className="text-xs font-bold text-neutral-400 hover:underline">← All games</Link>
        <h1 className="mb-1 mt-2 text-2xl font-black">Host a game</h1>
        <p className="mb-6 text-sm text-neutral-400">
          Set it up once; it then runs on the days you choose, week after week.
        </p>

        <HostForm sports={sports} error={error} />
      </main>
    </>
  );
}
