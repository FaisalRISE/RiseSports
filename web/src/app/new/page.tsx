import Link from "next/link";
import { createTournament } from "../actions";
import { SPORTS, SPORT_IDS } from "@/lib/sports/registry";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { NewTournamentWizard } from "@/components/NewTournamentWizard";

/* The sports registry stays on the server — only names and emoji cross to the
 * wizard. Its scoring blocks, serve models and skill lists are engine data and
 * have no business in a client bundle. */
export default async function NewTournament({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const { error } = await searchParams;

  const sports = SPORT_IDS.map((id) => ({
    id,
    name: SPORTS[id].name,
    emoji: SPORTS[id].emoji,
    formats: SPORTS[id].formats,
  }));

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-lg p-6">
        <Link href="/" className="text-xs font-bold text-neutral-400 hover:underline">← All tournaments</Link>
        <h1 className="mb-6 mt-2 text-2xl font-black">New tournament</h1>

        <NewTournamentWizard sports={sports} action={createTournament} error={!!error} />
      </main>
    </>
  );
}
