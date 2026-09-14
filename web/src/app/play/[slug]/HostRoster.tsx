"use client";

/* The host's guest list: four tabs, each with the moves that make sense in it.
 *
 * Ported from app.source.js:11076-11254. The tabs carry counts because the
 * whole job on a match night is "how many do I still need" — and the Requests
 * tab is first when it has anybody in it, because that is the one holding
 * somebody up.
 */

import { useState, useTransition } from "react";
import { actOnPlayer, addToSession } from "./actions";
import { searchPlayers, type PlayerHit } from "../actions";

export type RosterRow = {
  personId: string;
  name: string;
  rating: number | null;
  state: "confirmed" | "waitlist" | "requested" | "interested" | "withdrawn";
  paid: boolean;
  linkSent: boolean;
};

type Tab = "requested" | "confirmed" | "waitlist" | "interested" | "withdrawn";

const LABEL: Record<Tab, string> = {
  requested: "Requests",
  confirmed: "Confirmed",
  waitlist: "Waitlist",
  interested: "Interested",
  withdrawn: "Dropped out",
};

export function HostRoster({
  slug, date, rows, capacity, pricePaise,
}: {
  slug: string; date: string; rows: RosterRow[]; capacity: number; pricePaise: number;
}) {
  const byState = (s: Tab) => rows.filter((r) => r.state === s);
  const confirmed = byState("confirmed");

  /* Open on whatever needs the host: somebody waiting on a decision first,
     otherwise the list they are trying to fill. */
  const [tab, setTab] = useState<Tab>(byState("requested").length > 0 ? "requested" : "confirmed");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (personId: string, action: Parameters<typeof actOnPlayer>[3]) =>
    start(async () => {
      const res = await actOnPlayer(slug, date, personId, action);
      setError(res.ok ? null : res.error);
    });

  const tabs: Tab[] = ["requested", "confirmed", "waitlist", "interested", "withdrawn"];
  const shown = byState(tab);
  const full = confirmed.length >= capacity;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60">
      <div className="flex gap-1 overflow-x-auto border-b border-neutral-800 p-2">
        {tabs.map((t) => {
          const n = byState(t).length;
          if (t === "withdrawn" && n === 0) return null;
          return (
            <button
              key={t} type="button" onClick={() => setTab(t)}
              aria-pressed={tab === t}
              className={`shrink-0 rounded-lg px-2.5 py-1.5 text-[11px] font-bold uppercase tracking-wider ${
                tab === t ? "bg-amber-400 text-amber-950" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {LABEL[t]}
              <span className="ml-1 tabular-nums opacity-70">{n}</span>
            </button>
          );
        })}
      </div>

      {error && <p className="border-b border-neutral-800 p-3 text-xs font-bold text-rose-400">{error}</p>}

      {tab === "confirmed" && (
        <p className="border-b border-neutral-800 px-3 py-2 text-[11px] font-bold uppercase tracking-widest text-neutral-500">
          {confirmed.length} of {capacity} spots{full ? " · full" : ""}
        </p>
      )}

      {/* Walk-ins. Somebody turning up at the court who never opened the app is
          the ordinary case, and without this the host cannot put them on. */}
      {(tab === "confirmed" || tab === "requested") && (
        <AddPlayer slug={slug} date={date} onError={setError} alreadyOn={rows.map((r) => r.personId)} />
      )}

      {shown.length === 0 ? (
        <p className="p-6 text-center text-sm text-neutral-500">{empty(tab)}</p>
      ) : (
        <ul className="divide-y divide-neutral-800">
          {shown.map((r) => (
            <li key={r.personId} className="flex flex-wrap items-center gap-2 p-3">
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-bold">{r.name}</p>
                <p className="text-[11px] text-neutral-500">
                  Rating {r.rating ?? "—"}
                  {r.state === "confirmed" && pricePaise > 0 && (r.paid ? " · paid" : r.linkSent ? " · link sent" : " · unpaid")}
                </p>
              </div>

              <div className="flex flex-wrap gap-1.5">
                {tab === "requested" && (
                  <>
                    <Act onClick={() => act(r.personId, "confirm")} disabled={pending} primary>
                      {full ? "Confirm (waitlists)" : "Confirm"}
                    </Act>
                    <Act onClick={() => act(r.personId, "waitlist")} disabled={pending}>Waitlist</Act>
                    <Act onClick={() => act(r.personId, "remove")} disabled={pending} danger>Decline</Act>
                  </>
                )}

                {tab === "confirmed" && (
                  <>
                    {pricePaise > 0 && (
                      <>
                        <Act onClick={() => act(r.personId, "togglePaid")} disabled={pending}>
                          {r.paid ? "Mark unpaid" : "Mark paid"}
                        </Act>
                        {!r.paid && !r.linkSent && (
                          <Act onClick={() => act(r.personId, "markLinkSent")} disabled={pending}>
                            Link sent
                          </Act>
                        )}
                      </>
                    )}
                    <Act onClick={() => act(r.personId, "remove")} disabled={pending} danger>Remove</Act>
                  </>
                )}

                {tab === "waitlist" && (
                  <>
                    <Act onClick={() => act(r.personId, "promote")} disabled={pending || full} primary>
                      Give a spot
                    </Act>
                    <Act onClick={() => act(r.personId, "remove")} disabled={pending} danger>Remove</Act>
                  </>
                )}

                {tab === "interested" && (
                  <>
                    <Act onClick={() => act(r.personId, "confirm")} disabled={pending} primary>
                      {full ? "Confirm (waitlists)" : "Confirm"}
                    </Act>
                    <Act onClick={() => act(r.personId, "nudge")} disabled={pending}>Move to requests</Act>
                  </>
                )}

                {tab === "withdrawn" && (
                  <Act onClick={() => act(r.personId, "confirm")} disabled={pending}>Put back</Act>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Search for somebody and put them straight on the list. */
function AddPlayer({
  slug, date, onError, alreadyOn,
}: {
  slug: string; date: string; onError: (e: string | null) => void; alreadyOn: string[];
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[] | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    if (query.trim().length < 2) return;
    start(async () => setHits(await searchPlayers(query)));
  };

  const add = (personId: string) =>
    start(async () => {
      const res = await addToSession(slug, date, personId);
      onError(res.ok ? null : res.error);
      setHits(null);
      setQuery("");
    });

  const on = new Set(alreadyOn);

  return (
    <div className="border-b border-neutral-800 p-3">
      <div className="flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); run(); }
          }}
          placeholder="Add someone by name…"
          aria-label="Search for a player to add"
          className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
        />
        <button
          type="button" onClick={run} disabled={pending || query.trim().length < 2}
          className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[11px] font-bold text-neutral-300 disabled:opacity-40"
        >
          {pending ? "…" : "Find"}
        </button>
      </div>

      {hits && hits.length === 0 && (
        <p className="mt-2 text-xs text-neutral-500">Nobody by that name.</p>
      )}

      {hits && hits.length > 0 && (
        <ul className="mt-2 space-y-1">
          {hits.map((h) => (
            <li key={h.id}>
              <button
                type="button" onClick={() => add(h.id)} disabled={pending || on.has(h.id)}
                className="flex w-full items-center gap-2 rounded-lg border border-neutral-800 px-3 py-1.5 text-left hover:border-neutral-600 disabled:opacity-40"
              >
                <span className="min-w-0 flex-1 truncate text-sm">{h.name}</span>
                <span className="shrink-0 text-[11px] tabular-nums text-neutral-500">
                  {on.has(h.id) ? "already on" : h.rating ?? "—"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const empty = (tab: Tab) =>
  tab === "requested" ? "Nobody is waiting on you."
    : tab === "confirmed" ? "Nobody has a spot yet."
      : tab === "waitlist" ? "No waitlist."
        : tab === "withdrawn" ? "Nobody has dropped out."
          : "Nobody has said they might come.";

function Act({
  children, onClick, disabled, primary, danger,
}: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean;
  primary?: boolean; danger?: boolean;
}) {
  const cls = primary
    ? "bg-amber-400 text-amber-950 border-amber-400"
    : danger
      ? "border-neutral-700 text-neutral-400 hover:border-rose-400/60 hover:text-rose-400"
      : "border-neutral-700 text-neutral-300 hover:border-neutral-500";
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold disabled:opacity-40 ${cls}`}
    >
      {children}
    </button>
  );
}
