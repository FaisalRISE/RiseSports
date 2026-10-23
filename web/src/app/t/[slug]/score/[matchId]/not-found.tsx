"use client";

/* The score page's own "not found", in place of Next's bare 404.
 *
 * Its usual way here is a match DELETED while a referee had it open — "Remove
 * the pair" deletes a pair's matches, a live one included (step 8b). A console
 * that cannot score offline is told "this match was deleted" and reloads; the
 * reload lands here, and a bare "404 This page could not be found" with no way
 * back left the referee stranded on a dead page. The same page answers a match
 * that never existed, or an event not open to this viewer, so it says nothing
 * that only one of those would make true.
 *
 * A not-found page is given no params, so the event's address comes from the
 * URL in the browser. */

import Link from "next/link";
import { useParams } from "next/navigation";

export default function MatchNotFound() {
  const params = useParams<{ slug?: string }>();
  const slug = typeof params?.slug === "string" ? params.slug : null;
  return (
    <main className="mx-auto max-w-md space-y-3 p-6" data-testid="match-not-found">
      <h1 className="text-xl font-black">This match is not here</h1>
      <p className="text-sm text-neutral-400">
        There is no such match in this event. It may have been deleted on the manage screen.
      </p>
      <div className="flex flex-wrap gap-2">
        {slug && (
          <Link href={`/t/${slug}`} className="inline-block rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-amber-950">
            Back to the event
          </Link>
        )}
        <Link href="/" className="inline-block rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-300">
          All events
        </Link>
      </div>
    </main>
  );
}
