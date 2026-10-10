"use client";

/* The submit end of a category's "remove" form.
 *
 * Built like DrawButton, for the same reasons. An empty category goes with one
 * tap — there is nothing to lose. One with teams, fixtures or waiting entries
 * asks first, and the confirming submit button does not EXIST until the first
 * tap, so Enter cannot skip the question. What it sends is a fingerprint of the
 * teams, matches and waiting entries this page SAW (categorySignature); the
 * server removes only if it finds exactly those, so it holds whatever the
 * browser does.
 *
 * A category with results never reaches this: the page shows the reason in its
 * place, because the server would refuse it. The page keys this on the
 * fingerprint, so a change to the category remounts it closed. */

import { useState } from "react";

export function RemoveCategoryButton({ name, what, token }: {
  name: string;
  /** What removing it would take, as a sentence; null when there is nothing. */
  what: string | null;
  /** categorySignature of the teams and matches this page saw. */
  token: string;
}) {
  const [open, setOpen] = useState(false);
  const quiet = "text-[11px] font-bold text-neutral-500 hover:text-rose-400";

  if (!what) {
    return <button name="confirm" value={token} className={quiet}>remove</button>;
  }

  if (!open) {
    return (
      <button type="button" data-remove-category onClick={() => setOpen(true)} className={quiet}>
        remove…
      </button>
    );
  }

  return (
    <span data-remove-category-open className="flex flex-wrap items-center gap-2">
      <span className="text-[11px] text-neutral-400">
        {what} Nothing in {name} has a recorded result.
      </span>
      <button name="confirm" value={token}
        className="rounded-lg bg-rose-500 px-3 py-1.5 text-[11px] font-black text-neutral-950">
        Yes, remove
      </button>
      <button type="button" onClick={() => setOpen(false)}
        className="text-[11px] font-bold text-neutral-500 hover:text-neutral-300">
        Cancel
      </button>
    </span>
  );
}
