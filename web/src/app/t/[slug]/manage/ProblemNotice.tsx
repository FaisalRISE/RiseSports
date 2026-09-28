"use client";

/* A refusal, said once.
 *
 * A draw that is refused comes back to the manage page with a code in the
 * address (`?problem=…`), and the page builds the sentence. The address used to
 * keep that code, so the sentence stayed on screen through every later action —
 * including a redraw of the same category that WORKED, directly under "nothing
 * was changed". Once shown, the code is taken off the address, so the next
 * action re-renders a clean page. The sentence itself stays until then. */

import { useEffect } from "react";

export function ProblemNotice({ code, text }: { code: string; text: string }) {
  useEffect(() => {
    window.history.replaceState(null, "", window.location.pathname);
  }, [code, text]);

  return (
    <p role="alert" data-problem={code}
      className="mt-3 rounded-lg border border-amber-500/50 bg-amber-500/10 p-3 text-xs font-semibold text-amber-200">
      {text}
    </p>
  );
}
