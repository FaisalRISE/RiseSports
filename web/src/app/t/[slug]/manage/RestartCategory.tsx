"use client";

/* "Start this category again…" (step 8; Faisal, 2026-10-10).
 *
 * It clears every result in a category, so it asks the hardest of any control:
 * the first tap says exactly what goes, and the confirming button stays greyed
 * until the category's NAME is typed (Faisal chose that over two taps). A
 * disabled button is no default button, so Enter in the box does nothing. The
 * server checks the name again, and the fingerprint of the results this page
 * SAW (`restartSignature`), so a page opened before more results came in cannot
 * clear them blind. Keyed on that fingerprint by the page. */

import { useState } from "react";
import { sameCategoryName } from "./sameName";

export function RestartCategory({ divisionId, name, token, what }: {
  divisionId: string;
  name: string;
  token: string;
  /** What starting again clears, in sentences. */
  what: string;
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const matches = sameCategoryName(typed, name);

  if (!open) {
    return (
      <button type="button" data-restart onClick={() => setOpen(true)}
        className="min-h-9 rounded-lg border border-rose-500/60 px-3 py-1.5 text-xs font-bold text-rose-300 hover:bg-rose-500/10">
        Start this category again…
      </button>
    );
  }

  return (
    <div data-restart-open className="space-y-2 rounded-lg border border-rose-500/60 bg-rose-500/10 p-3">
      <p className="text-sm font-black text-rose-200">Start {name} again?</p>
      <p className="text-[12px] leading-relaxed text-rose-100">{what}</p>
      <p className="text-[12px] font-bold text-rose-100">This can’t be undone.</p>
      <input type="hidden" name="divisionId" value={divisionId} />
      <label className="block text-[11px] font-bold text-neutral-300">
        Type {name} to confirm
        <input name="name" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off"
          className="mt-1 block w-full rounded-lg border border-neutral-600 bg-neutral-950 px-3 py-2 text-sm text-neutral-100" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button name="confirm" value={token} disabled={!matches}
          className="min-h-9 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-black text-neutral-950 disabled:bg-neutral-700 disabled:text-neutral-400">
          Start {name} again
        </button>
        <button type="button" onClick={() => { setOpen(false); setTyped(""); }}
          className="min-h-9 text-[11px] font-bold text-neutral-500 hover:text-neutral-300">
          Cancel
        </button>
      </div>
    </div>
  );
}
