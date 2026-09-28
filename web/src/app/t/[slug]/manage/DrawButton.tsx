"use client";

/* The submit end of a draw form.
 *
 * A first draw is one tap. A REDRAW — one that replaces fixtures already on the
 * page — asks first, and the confirming submit button does not EXIST until the
 * first tap. That matters: a button hidden inside a closed <details> is still
 * the form's default button, so pressing Enter in "Qualify per group" used to
 * redraw without the second tap. With no submit button in the form, Enter
 * submits (or not) without `confirm`, and the server refuses a redraw that
 * lacks it — so the rule holds whatever the browser does. What it sends is a
 * fingerprint of the fixtures this page SAW (see drawSignature), not a flag.
 *
 * The page keys this on the rows it would replace, so after a redraw (new rows,
 * new ids) it comes back closed rather than one tap from the next redraw. */

import { useState } from "react";

export function DrawButton({ label, replaces, token }: {
  label: string;
  /** What a redraw would replace, in words; null for a first draw. */
  replaces: string | null;
  /** drawSignature of the rows this page saw. The server redraws only if it
      finds exactly those, so a page opened before somebody else drew cannot
      replace their fixtures with one tap. */
  token: string;
}) {
  const [open, setOpen] = useState(false);

  if (!replaces) {
    return (
      <button name="confirm" value={token}
        className="rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900">
        {label}
      </button>
    );
  }

  if (!open) {
    return (
      <button type="button" data-draw-confirm onClick={() => setOpen(true)}
        className="rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900">
        {label}…
      </button>
    );
  }

  return (
    <span data-draw-confirm-open className="flex flex-wrap items-center gap-2 self-center">
      <span className="text-[11px] text-neutral-400">
        Replaces {replaces}. Nothing in it has a recorded result.
      </span>
      <button name="confirm" value={token}
        className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black text-neutral-900">
        Yes, redraw
      </button>
      <button type="button" onClick={() => setOpen(false)}
        className="text-[11px] font-bold text-neutral-500 hover:text-neutral-300">
        Cancel
      </button>
    </span>
  );
}
