"use client";

/* The three alternative session screens: half-hour slots, King of the Court,
 * and the ladder. Which one a game shows is decided by its `rotation`.
 *
 * Ported from app.source.js — the slots panel (:10865-11031), the KotC panel
 * (:10618-10735) and the ladder panel (:10735-10865).
 */

import { useState, useTransition } from "react";
import { slotAction, slotActionFor, kotcAction, ladderAction } from "./actions";
import { searchPlayers, type PlayerHit } from "../actions";

const btn = "rounded-lg border px-2.5 py-1 text-[11px] font-bold disabled:opacity-40";
const plain = `${btn} border-neutral-700 text-neutral-300 hover:border-neutral-500`;
const primary = `${btn} border-amber-400 bg-amber-400 text-amber-950`;
const danger = `${btn} border-neutral-700 text-neutral-400 hover:border-rose-400/60 hover:text-rose-400`;

/* ── Half-hour slots ──────────────────────────────────────────────────────*/

export function SlotsPanel({
  slug, date, slots, labels, capacity, names, meId, isHost,
}: {
  slug: string; date: string;
  slots: Record<string, string[]>;
  labels: string[];
  capacity: number;
  names: Record<string, string>;
  meId: string | null;
  isHost: boolean;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (slot: string, take: boolean) =>
    start(async () => {
      const res = await slotAction(slug, date, slot, take);
      setError(res.ok ? null : res.error);
    });

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60">
      <div className="border-b border-neutral-800 p-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
          Book your half hour
        </h2>
        <p className="mt-0.5 text-xs text-neutral-400">
          {capacity} places in each slot. Take as many as you like.
        </p>
      </div>

      {error && <p className="border-b border-neutral-800 p-3 text-xs font-bold text-rose-400">{error}</p>}

      <ul className="divide-y divide-neutral-800">
        {labels.map((slot) => {
          const booked = slots[slot] ?? [];
          const mine = !!meId && booked.includes(meId);
          const full = booked.length >= capacity;

          return (
            <li key={slot} className="p-3">
              <div className="flex items-center gap-2">
                <span className="w-28 shrink-0 text-sm font-bold tabular-nums">{slot}</span>
                <span className={`text-xs tabular-nums ${full ? "text-rose-400" : "text-neutral-500"}`}>
                  {booked.length}/{capacity}
                </span>
                <span className="flex-1" />
                {meId && (
                  mine ? (
                    <button type="button" className={danger} disabled={pending}
                      onClick={() => act(slot, false)}>Cancel</button>
                  ) : full ? (
                    <span className="rounded bg-neutral-800 px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-neutral-500">
                      Full
                    </span>
                  ) : (
                    <button type="button" className={primary} disabled={pending}
                      onClick={() => act(slot, true)}>Reserve</button>
                  )
                )}
              </div>

              {booked.length > 0 && (
                <p className="mt-1 text-xs text-neutral-500">
                  {booked.map((id) => names[id] ?? "Unknown").join(", ")}
                </p>
              )}

              {isHost && (
                <HostSlot slug={slug} date={date} slot={slot} booked={booked}
                  names={names} onError={setError} full={full} />
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** The host putting somebody in a slot, or pulling them out of one. */
function HostSlot({
  slug, date, slot, booked, names, onError, full,
}: {
  slug: string; date: string; slot: string; booked: string[];
  names: Record<string, string>; onError: (e: string | null) => void; full: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[] | null>(null);
  const [pending, start] = useTransition();

  const run = () => {
    if (query.trim().length < 2) return;
    start(async () => setHits(await searchPlayers(query)));
  };

  const put = (personId: string, take: boolean) =>
    start(async () => {
      const res = await slotActionFor(slug, date, slot, personId, take);
      onError(res.ok ? null : res.error);
      setHits(null);
      setQuery("");
    });

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className="mt-1 text-[11px] font-bold text-neutral-500 hover:text-amber-400">
        Manage this slot
      </button>
    );
  }

  return (
    <div className="mt-2 space-y-2 border-l-2 border-neutral-800 pl-2">
      {booked.map((id) => (
        <div key={id} className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-xs">{names[id] ?? "Unknown"}</span>
          <button type="button" className={danger} disabled={pending}
            onClick={() => put(id, false)}>Remove</button>
        </div>
      ))}

      {!full && (
        <div className="flex gap-2">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); run(); } }}
            placeholder="Add someone…" aria-label={`Add someone to ${slot}`}
            className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs"
          />
          <button type="button" className={plain} onClick={run}
            disabled={pending || query.trim().length < 2}>Find</button>
        </div>
      )}

      {hits?.map((h) => (
        <button key={h.id} type="button" onClick={() => put(h.id, true)} disabled={pending}
          className="block w-full rounded-lg border border-neutral-800 px-2 py-1 text-left text-xs hover:border-neutral-600">
          {h.name}
        </button>
      ))}

      <button type="button" onClick={() => setOpen(false)}
        className="text-[11px] font-bold text-neutral-500 hover:text-neutral-300">done</button>
    </div>
  );
}

/* ── King of the Court ────────────────────────────────────────────────────*/

export type KotcView = {
  courts: { a: string[]; b: string[]; winner: "a" | "b" | null }[];
  bench: string[];
  crowns: Record<string, number>;
  round: number;
} | null;

export function KotcPanel({
  slug, date, state, names, isHost, confirmedCount, courtWord,
}: {
  slug: string; date: string; state: KotcView;
  names: Record<string, string>; isHost: boolean; confirmedCount: number; courtWord: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (action: Parameters<typeof kotcAction>[2]) =>
    start(async () => {
      const res = await kotcAction(slug, date, action);
      setError(res.ok ? null : res.error);
    });

  const nameOf = (id: string) => names[id] ?? "Unknown";
  const side = (ids: string[]) => ids.map(nameOf).join(" & ");

  if (!state) {
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
          King of the {courtWord}
        </h2>
        <p className="mt-1 text-sm text-neutral-400">
          Winners hold the top {courtWord.toLowerCase()}. Win there and you take a crown; lose
          anywhere and you drop one.
        </p>
        {isHost && (
          <>
            <button type="button" className={`${primary} mt-3 px-3 py-2`} disabled={pending || confirmedCount < 4}
              onClick={() => run({ op: "start" })}>
              {pending ? "Working…" : "Start"}
            </button>
            {confirmedCount < 4 && (
              <p className="mt-2 text-xs text-neutral-500">Needs four confirmed players.</p>
            )}
          </>
        )}
        {error && <p className="mt-2 text-xs font-bold text-rose-400">{error}</p>}
      </div>
    );
  }

  const ready = state.courts.every((c) => c.winner !== null);
  const leaders = Object.entries(state.crowns).sort((a, b) => b[1] - a[1]).slice(0, 3);

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60">
      <div className="flex items-baseline justify-between gap-2 border-b border-neutral-800 p-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
          Round {state.round}
        </h2>
        {isHost && (
          <button type="button" onClick={() => run({ op: "reset" })} disabled={pending}
            className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">Start over</button>
        )}
      </div>

      {error && <p className="border-b border-neutral-800 p-3 text-xs font-bold text-rose-400">{error}</p>}

      <ul className="divide-y divide-neutral-800">
        {state.courts.map((c, i) => (
          <li key={i} className={`p-3 ${i === 0 ? "bg-amber-400/5" : ""}`}>
            <p className={`text-[11px] font-bold uppercase tracking-wider ${i === 0 ? "text-amber-400" : "text-neutral-500"}`}>
              {i === 0 ? `👑 King ${courtWord.toLowerCase()}` : `${courtWord} ${i + 1}`}
            </p>
            <div className="mt-1.5 flex items-center gap-2">
              <button
                type="button" disabled={!isHost || pending}
                onClick={() => run({ op: "pick", court: i, side: "a" })}
                className={`min-w-0 flex-1 rounded-lg border p-2 text-left text-sm ${
                  c.winner === "a" ? "border-emerald-400/60 bg-emerald-400/10 font-bold" : "border-neutral-800"
                } ${isHost ? "hover:border-neutral-600" : ""}`}
              >
                <span className="block truncate">{side(c.a)}</span>
              </button>
              <span className="text-[11px] font-bold text-neutral-600">v</span>
              <button
                type="button" disabled={!isHost || pending}
                onClick={() => run({ op: "pick", court: i, side: "b" })}
                className={`min-w-0 flex-1 rounded-lg border p-2 text-right text-sm ${
                  c.winner === "b" ? "border-emerald-400/60 bg-emerald-400/10 font-bold" : "border-neutral-800"
                } ${isHost ? "hover:border-neutral-600" : ""}`}
              >
                <span className="block truncate">{side(c.b)}</span>
              </button>
            </div>
          </li>
        ))}
      </ul>

      {state.bench.length > 0 && (
        <p className="border-t border-neutral-800 p-3 text-xs text-neutral-500">
          Waiting: {state.bench.map(nameOf).join(", ")}
        </p>
      )}

      {leaders.length > 0 && (
        <p className="border-t border-neutral-800 p-3 text-xs text-neutral-400">
          <span className="font-bold text-amber-400">Crowns</span>{" "}
          {leaders.map(([id, n]) => `${nameOf(id)} ${n}`).join(" · ")}
        </p>
      )}

      {isHost && (
        <div className="border-t border-neutral-800 p-3">
          <button type="button" className={`${primary} px-3 py-2`} disabled={pending || !ready}
            onClick={() => run({ op: "next" })}>
            {pending ? "Working…" : ready ? "Next round" : "Pick every winner first"}
          </button>
        </div>
      )}
    </div>
  );
}

/* ── Ladder ───────────────────────────────────────────────────────────────*/

export function LadderPanel({
  slug, order, log, names, isHost, meId,
}: {
  slug: string;
  order: string[];
  log: { challenger: string; defender: string; won: boolean; at: string }[];
  names: Record<string, string>;
  isHost: boolean;
  meId: string | null;
}) {
  const [error, setError] = useState<string | null>(null);
  const [challenger, setChallenger] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[] | null>(null);

  const nameOf = (id: string) => names[id] ?? "Unknown";

  const run = (action: Parameters<typeof ladderAction>[1]) =>
    start(async () => {
      const res = await ladderAction(slug, action);
      setError(res.ok ? null : res.error);
      if (res.ok) setChallenger(null);
    });

  const search = () => {
    if (query.trim().length < 2) return;
    start(async () => setHits(await searchPlayers(query)));
  };

  /* Tap yourself (or anyone, as host), then tap somebody above you. */
  const challengerIndex = challenger ? order.indexOf(challenger) : -1;

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60">
      <div className="border-b border-neutral-800 p-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Ladder</h2>
        <p className="mt-0.5 text-xs text-neutral-400">
          {challenger
            ? `${nameOf(challenger)} is challenging — now tap somebody above them.`
            : "Tap a player, then tap somebody above them to record a challenge."}
        </p>
      </div>

      {error && <p className="border-b border-neutral-800 p-3 text-xs font-bold text-rose-400">{error}</p>}

      {order.length === 0 ? (
        <p className="p-6 text-center text-sm text-neutral-500">Nobody on the ladder yet.</p>
      ) : (
        <ol className="divide-y divide-neutral-800">
          {order.map((id, i) => {
            const isChallenger = id === challenger;
            const canBeDefended = challengerIndex >= 0 && i < challengerIndex;
            return (
              <li key={id} className={`flex items-center gap-2 p-3 ${i === 0 ? "bg-amber-400/5" : ""}`}>
                <span className={`w-6 shrink-0 text-sm font-black tabular-nums ${i === 0 ? "text-amber-400" : "text-neutral-500"}`}>
                  {i + 1}
                </span>
                <button
                  type="button"
                  onClick={() => {
                    if (canBeDefended) return; // handled by the buttons below
                    setChallenger(isChallenger ? null : id);
                  }}
                  disabled={pending || (!isHost && id !== meId && !canBeDefended)}
                  className={`min-w-0 flex-1 truncate rounded-lg px-2 py-1 text-left text-sm ${
                    isChallenger ? "bg-amber-400/15 font-bold text-amber-400" : ""
                  } disabled:opacity-60`}
                >
                  {nameOf(id)}
                  {id === meId ? " (you)" : ""}
                </button>

                {canBeDefended && (
                  <span className="flex shrink-0 gap-1">
                    <button type="button" className={primary} disabled={pending}
                      onClick={() => run({ op: "settle", challenger: challenger!, defender: id, challengerWon: true })}>
                      Challenger won
                    </button>
                    <button type="button" className={plain} disabled={pending}
                      onClick={() => run({ op: "settle", challenger: challenger!, defender: id, challengerWon: false })}>
                      Held
                    </button>
                  </span>
                )}

                {isHost && !canBeDefended && !isChallenger && (
                  <button type="button" className={danger} disabled={pending}
                    onClick={() => run({ op: "remove", personId: id })}>Remove</button>
                )}
              </li>
            );
          })}
        </ol>
      )}

      {isHost && (
        <div className="border-t border-neutral-800 p-3">
          <div className="flex gap-2">
            <input
              value={query} onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
              placeholder="Add someone to the ladder…" aria-label="Add someone to the ladder"
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
            />
            <button type="button" className={plain} onClick={search}
              disabled={pending || query.trim().length < 2}>Find</button>
          </div>
          {hits?.map((h) => (
            <button key={h.id} type="button" disabled={pending || order.includes(h.id)}
              onClick={() => { run({ op: "add", personId: h.id }); setHits(null); setQuery(""); }}
              className="mt-1 block w-full rounded-lg border border-neutral-800 px-3 py-1.5 text-left text-sm hover:border-neutral-600 disabled:opacity-40">
              {h.name}{order.includes(h.id) ? " — already on" : ""}
            </button>
          ))}
        </div>
      )}

      {log.length > 0 && (
        <div className="border-t border-neutral-800 p-3">
          <p className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Recent</p>
          <ul className="mt-1 space-y-0.5">
            {log.map((e, i) => (
              <li key={i} className="text-xs text-neutral-400">
                {nameOf(e.challenger)} challenged {nameOf(e.defender)} —{" "}
                <span className={e.won ? "text-emerald-400" : "text-neutral-500"}>
                  {e.won ? "took the place" : "held"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
