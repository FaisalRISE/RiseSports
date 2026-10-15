"use client";

/* The one part of the referee console that runs where there is NO court.
 *
 * Clearing a semi-final empties the Final's side that was filled from it, and
 * the Final's page then shows "waiting for the teams" instead of the console —
 * so the queue's own drop-at-load never runs there, and a phone that scored the
 * Final offline before the clear kept those rallies until somebody filled the
 * side again, perhaps with a different pair. This drops a stored record from
 * before the reset as the page loads, and says so (step 8). */

import { useEffect, useState } from "react";
import { dropForReset } from "@/lib/offline/queue";
import { resetWords } from "./RefConsole";

export function ResetDrop({ matchId, resetRev }: { matchId: string; resetRev: number }) {
  const [rallies, setRallies] = useState(0);
  useEffect(() => {
    if (resetRev <= 0) return;
    let cancelled = false;
    void dropForReset(matchId, resetRev).then((n) => {
      if (!cancelled) setRallies(n);
    });
    return () => { cancelled = true; };
  }, [matchId, resetRev]);

  if (rallies === 0) return null;
  const words = resetWords(rallies);
  return (
    <div role="alert" data-testid="reset-notice" className="rounded-xl border border-sky-500 bg-sky-500/10 p-4">
      <h2 className="text-base font-black text-sky-200">{words.heading}</h2>
      <p className="mt-1 text-sm font-semibold text-sky-100">{words.body}</p>
    </div>
  );
}
