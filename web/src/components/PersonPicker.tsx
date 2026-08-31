"use client";

/* Find an existing player and reuse them, so their rating follows them.
 *
 * Phone is the only AUTOMATIC match — see lib/people. This is the manual path,
 * for the common case where an organiser knows the person but not their number.
 *
 * ── Why the results show so much ─────────────────────────────────────────
 * Two "Rahul S" rows are indistinguishable by name, and picking the wrong one
 * fuses two people's ratings — far harder to unpick than a duplicate. So each
 * result carries rating, tier, reliability, when they last played and how many
 * events they appear in: whatever it takes for the organiser to recognise the
 * right person rather than guess.
 *
 * No engine imports here. This is a client component; it calls a Server Action
 * and renders what comes back. */

import { useState, useTransition } from "react";

export type PickerResult = {
  id: string;
  name: string;
  phoneMasked: string | null;
  rating: number | null;
  tier: string | null;
  reliability: string | null;
  lastPlayed: string | null;
  appearances: number;
};

export function PersonPicker({
  search,
  onPick,
}: {
  search: (q: string) => Promise<PickerResult[]>;
  onPick?: (p: PickerResult | null) => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<PickerResult[] | null>(null);
  const [picked, setPicked] = useState<PickerResult | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    if (query.trim().length < 2) return;
    start(async () => setResults(await search(query)));
  };

  const choose = (r: PickerResult | null) => {
    setPicked(r);
    setResults(null);
    onPick?.(r);
  };

  if (picked) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-emerald-600/50 bg-emerald-500/10 p-2">
        {/* The hidden field the roster form reads. */}
        <input type="hidden" name="personId" value={picked.id} />
        <div className="min-w-0 flex-1">
          <div className="truncate text-xs font-bold text-emerald-300">
            Linked: {picked.name}
          </div>
          <div className="truncate text-[10px] text-neutral-400">
            {picked.rating ?? "—"}
            {picked.tier ? ` · ${picked.tier}` : ""}
            {picked.appearances ? ` · ${picked.appearances} events` : ""}
          </div>
        </div>
        <button
          type="button"
          onClick={() => choose(null)}
          className="text-[10px] font-bold text-neutral-400 hover:text-rose-400"
        >
          unlink
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          /* Enter must not submit the surrounding roster form — that would add
             the player before the organiser has picked anyone. */
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              run();
            }
          }}
          placeholder="Find an existing player…"
          className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs"
        />
        <button
          type="button"
          onClick={run}
          disabled={pending || query.trim().length < 2}
          className="rounded-lg border border-neutral-700 px-3 text-[11px] font-bold text-neutral-300 disabled:opacity-40"
        >
          {pending ? "…" : "Find"}
        </button>
      </div>

      {results && results.length === 0 && (
        <p className="text-[10px] text-neutral-500">
          Nobody found — leave this blank and they will be created as a new player.
        </p>
      )}

      {results && results.length > 0 && (
        <ul className="max-h-48 space-y-1 overflow-y-auto rounded-lg border border-neutral-800 p-1">
          {results.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                onClick={() => choose(r)}
                className="w-full rounded-md px-2 py-1.5 text-left hover:bg-neutral-800"
              >
                <div className="flex items-baseline gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-bold">{r.name}</span>
                  <span className="font-mono text-sm font-black">{r.rating ?? "—"}</span>
                </div>
                {/* The disambiguating detail. Without it, two people with the
                    same name are a coin flip. */}
                <div className="truncate text-[10px] text-neutral-500">
                  {[
                    r.phoneMasked,
                    r.tier,
                    r.reliability ? `reliability ${r.reliability}` : null,
                    r.appearances ? `${r.appearances} event${r.appearances === 1 ? "" : "s"}` : "never played",
                    r.lastPlayed ? `last ${r.lastPlayed}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
