"use client";

/* The submit end of a match's "Delete match…", "Reset to 0–0…", "Clear
 * result…" or "Walkover…" form, and a team's "Remove the pair…" (step 8).
 *
 * Built like DrawButton, for the same reasons: the confirming submit button
 * does not EXIST until the first tap — a button hidden inside a closed
 * <details> is still the form's default button, so Enter would skip the
 * question — and what it sends is the match's rev as the page SAW it, so the
 * server refuses to clear or delete a match that changed since (another
 * referee's rally, another organiser's clear). The page keys this on that rev,
 * so a change remounts it closed.
 *
 * A walkover asks WHO, so its second tap is one button per side (`choices`):
 * each posts `side`, and the token rides in a hidden field that likewise does
 * not exist until the first tap. */

import { useState } from "react";

export function ConfirmButton({ label, question, yes, token, hook, heading, choices }: {
  /** The first tap: "Clear result…". */
  label: string;
  /** What the second tap does, in a sentence. */
  question: string;
  /** The second tap: "Yes, clear the result". Unused with `choices`. */
  yes: string;
  /** The match's rev on this page, or a fingerprint of what it saw. */
  token: number | string;
  /** A stable name for tests: "clear", "reset", "delete", "walkover", "withdraw". */
  hook: string;
  /** A bold first line over the question: "Remove Chops from Mixed?". */
  heading?: string;
  /** One confirming button per choice, each posting `side=<value>`. */
  choices?: { value: string; label: string }[];
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
      {heading && <strong className="w-full text-sm font-black text-rose-300">{heading}</strong>}
      <span className="w-full whitespace-pre-line text-[12px] leading-relaxed text-neutral-300">{question}</span>
      {choices ? (
        <>
          <input type="hidden" name="confirm" value={String(token)} />
          {choices.map((c) => (
            <button key={c.value} name="side" value={c.value} data-choice={c.value}
              className="min-h-9 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-black text-neutral-950">
              {c.label}
            </button>
          ))}
        </>
      ) : (
        <button name="confirm" value={String(token)}
          className="min-h-9 rounded-lg bg-rose-500 px-3 py-1.5 text-xs font-black text-neutral-950">
          {yes}
        </button>
      )}
      <button type="button" onClick={() => setOpen(false)}
        className="min-h-9 text-[11px] font-bold text-neutral-500 hover:text-neutral-300">
        Cancel
      </button>
    </span>
  );
}
