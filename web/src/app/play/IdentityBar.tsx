"use client";

/* "You are …" — the strip at the top of the Play screens.
 *
 * Community play is the one part of the app where the viewer acts on their OWN
 * place in a session, so the page has to know who is holding the phone. There
 * is no sign-in yet, so this asks, once, and remembers in a cookie.
 *
 * It is stated plainly and is always changeable, rather than being inferred and
 * hidden — someone handing their phone to a friend to put THEIR name down is a
 * normal thing to happen at a court, and a silent wrong answer would put the
 * wrong person on the list.
 *
 * No engine imports: this is a Client Component that calls Server Actions and
 * renders what comes back.
 */

import { useState, useTransition } from "react";
import { chooseIdentity, forgetIdentity, searchPlayers, type PlayerHit } from "./actions";

export function IdentityBar({ name }: { name: string | null }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[] | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    if (query.trim().length < 2) return;
    start(async () => setHits(await searchPlayers(query)));
  };

  const pick = (id: string) => {
    start(async () => {
      await chooseIdentity(id);
      setOpen(false);
      setHits(null);
      setQuery("");
    });
  };

  if (name && !open) {
    return (
      <div className="mb-4 flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2">
        <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">You are</span>
        <span className="min-w-0 flex-1 truncate text-sm font-bold">{name}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="rounded-lg border border-neutral-700 px-2.5 py-1 text-[11px] font-bold text-neutral-400 hover:border-neutral-500 hover:text-neutral-200"
        >
          Not you?
        </button>
      </div>
    );
  }

  return (
    <div className="mb-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold">{name ? "Who is playing?" : "Who are you?"}</p>
        {name && (
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="text-[11px] font-bold text-neutral-500 hover:text-neutral-300"
          >
            cancel
          </button>
        )}
      </div>
      <p className="mt-0.5 text-xs text-neutral-400">
        So the app knows whose name to put down. You can change it any time.
      </p>

      <div className="mt-2 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="Search your name…"
          aria-label="Search for your name"
          className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={run}
          disabled={pending || query.trim().length < 2}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs font-bold text-neutral-300 disabled:opacity-40"
        >
          {pending ? "…" : "Find"}
        </button>
      </div>

      {hits && hits.length === 0 && (
        <p className="mt-2 text-xs text-neutral-500">
          Nobody by that name yet. An organiser adds you the first time you enter an event.
        </p>
      )}

      {hits && hits.length > 0 && (
        <ul className="mt-2 space-y-1">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button"
                onClick={() => pick(h.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-neutral-800 px-3 py-2 text-left hover:border-neutral-600"
              >
                <span className="min-w-0 flex-1 truncate text-sm font-bold">{h.name}</span>
                <span className="shrink-0 text-xs tabular-nums text-neutral-500">{h.rating ?? "—"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {name && (
        <button
          type="button"
          onClick={() => start(async () => { await forgetIdentity(); setOpen(false); })}
          className="mt-2 text-[11px] font-bold text-neutral-500 hover:text-rose-400"
        >
          Sign out of this device
        </button>
      )}
    </div>
  );
}
