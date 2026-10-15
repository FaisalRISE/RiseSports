"use client";

/* The submit end of a match's "Delete match…", "Reset to 0–0…" or "Clear
 * result…" form (step 8).
 *
 * Built like DrawButton, for the same reasons: the confirming submit button
 * does not EXIST until the first tap — a button hidden inside a closed
 * <details> is still the form's default button, so Enter would skip the
 * question — and what it sends is the match's rev as the page SAW it, so the
 * server refuses to clear or delete a match that changed since (another
 * referee's rally, another organiser's clear). The page keys this on that rev,
 * so a change remounts it closed. */

import { useState } from "react";

export function ConfirmButton({ label, question, yes, token, hook }: {
  /** The first tap: "Clear result…". */
  label: string;
  /** What the second tap does, in a sentence. */
  question: string;
  /** The second tap: "Yes, clear the result". */
  yes: string;
  /** The match's rev on this page. */
  token: number;
  /** A stable name for tests: "clear", "reset" or "delete". */
  hook: string;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button type="button" data-row-action={hook} onClick={() => setOpen(true)}
        className="min-h-9 rounded-lg border border-neutral-600 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:border-neutral-400">
        {label}
      </button>
    );
  }

  return (
    <span data-row-action-open={hook} className="flex w-full flex-wrap items-center gap-2">
      <span className="w-full text-[12px] leading-relaxed text-neutral-300">{question}</span>
      <button name="confirm" value={String(token)}
        className="min-h-9 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-black text-neutral-950">
        {yes}
      </button>
      <button type="button" onClick={() => setOpen(false)}
        className="min-h-9 text-[11px] font-bold text-neutral-500 hover:text-neutral-300">
        Cancel
      </button>
    </span>
  );
}
