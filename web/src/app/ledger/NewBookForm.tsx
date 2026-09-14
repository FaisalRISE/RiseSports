"use client";

/* Starting a book.
 *
 * The legacy version asks for a name in a browser `prompt()` and then seeds
 * four hard-coded members — You, Nadeem, Sumit, Kautubh (app.source.js:12570).
 * Four strangers' names appearing in your ledger is a demo artefact, not a
 * feature, so the names are asked for instead. One per line, because that is
 * how people write a list.
 */

import { useState } from "react";
import { createBookAction } from "./actions";

export function NewBookForm() {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <button
        type="button" onClick={() => setOpen(true)}
        className="w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-amber-950"
      >
        + New book
      </button>
    );
  }

  return (
    <form action={createBookAction} className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <label className="block space-y-1">
        <span className="text-xs font-bold text-neutral-400">What is this book for?</span>
        <input
          name="name" required minLength={2} maxLength={80} autoFocus
          placeholder="Thursday Court Nights"
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
        />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-bold text-neutral-400">Who is in it? One name per line.</span>
        <textarea
          name="members" rows={4} defaultValue="You"
          placeholder={"You\nNadeem\nSumit"}
          className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm"
        />
        <span className="block text-[11px] text-neutral-500">
          You can add more later. Put yourself first — the book reads from that person&rsquo;s side.
        </span>
      </label>

      <div className="flex gap-2">
        <button type="button" onClick={() => setOpen(false)}
          className="flex-1 rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-300">
          Cancel
        </button>
        <button type="submit"
          className="flex-1 rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-amber-950">
          Create book
        </button>
      </div>
    </form>
  );
}
