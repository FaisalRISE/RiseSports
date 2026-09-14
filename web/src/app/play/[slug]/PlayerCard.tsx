"use client";

/* What one player sees for the chosen date, and the buttons for their own place.
 *
 * Ported from app.source.js:11254-11387. The shape that matters: the card shows
 * the state you are ACTUALLY in and only the moves available from it, rather
 * than a row of buttons that mostly do nothing. A player looking at this should
 * be able to answer "am I playing on Thursday?" without reading a list.
 */

import { useState, useTransition } from "react";
import { actOnMyPlace } from "./actions";

type State = "none" | "interested" | "requested" | "confirmed" | "waitlist" | "withdrawn";

export function PlayerCard({
  slug, date, prettyDate, state, paid, pricePaise, queuePosition, openSlots,
}: {
  slug: string;
  date: string;
  prettyDate: string;
  state: State;
  paid: boolean;
  pricePaise: number;
  queuePosition: number | null;
  openSlots: number;
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (action: "interested" | "request" | "withdraw" | "takeFreedSpot") =>
    start(async () => {
      const res = await actOnMyPlace(slug, date, action);
      setError(res.ok ? null : res.error);
    });

  const price = pricePaise > 0 ? `₹${(pricePaise / 100).toLocaleString("en-IN")}` : null;

  return (
    <div className={`rounded-xl border p-4 ${tone(state)}`}>
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-bold">{headline(state, prettyDate, queuePosition)}</p>
        {state === "confirmed" && price && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${
              paid ? "bg-emerald-400/15 text-emerald-400" : "bg-amber-400/15 text-amber-400"
            }`}
          >
            {paid ? "Paid" : `${price} due`}
          </span>
        )}
      </div>

      <p className="mt-0.5 text-xs text-neutral-400">{explain(state, openSlots)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {state === "none" || state === "withdrawn" ? (
          <>
            <Btn primary onClick={() => act("request")} disabled={pending}>
              {state === "withdrawn" ? "Actually, put me back" : "Put me down"}
            </Btn>
            <Btn onClick={() => act("interested")} disabled={pending}>I might come</Btn>
          </>
        ) : null}

        {state === "interested" && (
          <>
            <Btn primary onClick={() => act("request")} disabled={pending}>Put me down properly</Btn>
            <Btn onClick={() => act("interested")} disabled={pending}>Never mind</Btn>
          </>
        )}

        {state === "requested" && (
          <Btn onClick={() => act("withdraw")} disabled={pending}>Cancel my request</Btn>
        )}

        {state === "waitlist" && (
          <>
            {openSlots > 0 && (
              <Btn primary onClick={() => act("takeFreedSpot")} disabled={pending}>
                Take the free spot
              </Btn>
            )}
            <Btn onClick={() => act("withdraw")} disabled={pending}>Leave the waitlist</Btn>
          </>
        )}

        {state === "confirmed" && (
          <Btn danger onClick={() => act("withdraw")} disabled={pending}>I can&rsquo;t make it</Btn>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-bold text-rose-400">{error}</p>}
    </div>
  );
}

function headline(state: State, prettyDate: string, queuePosition: number | null): string {
  switch (state) {
    case "confirmed": return `You're playing on ${prettyDate}`;
    case "waitlist": return queuePosition ? `You're ${ordinal(queuePosition)} on the waitlist` : "You're on the waitlist";
    case "requested": return "You've asked for a spot";
    case "interested": return "You said you might come";
    case "withdrawn": return `You pulled out of ${prettyDate}`;
    default: return `${prettyDate}`;
  }
}

function explain(state: State, openSlots: number): string {
  switch (state) {
    case "confirmed": return "The host has you on the list. Let them know early if that changes.";
    case "waitlist":
      return openSlots > 0
        ? "A spot has just come free — first to take it gets it."
        : "You move up if somebody drops out.";
    case "requested": return "Waiting for the host to confirm you.";
    case "interested": return "This does not hold you a spot. Put your name down properly to be counted.";
    case "withdrawn": return "Your spot went back to the list. You can ask for another one.";
    default: return "You have not put your name down for this date.";
  }
}

const ordinal = (n: number) => {
  const s = ["th", "st", "nd", "rd"];
  return n + (s[(n % 100 - 20) % 10] ?? s[n % 100] ?? s[0]);
};

const tone = (state: State) =>
  state === "confirmed"
    ? "border-emerald-400/40 bg-emerald-400/5"
    : state === "waitlist"
      ? "border-amber-400/40 bg-amber-400/5"
      : "border-neutral-800 bg-neutral-900/60";

function Btn({
  children, onClick, disabled, primary, danger,
}: {
  children: React.ReactNode; onClick: () => void; disabled?: boolean;
  primary?: boolean; danger?: boolean;
}) {
  const cls = primary
    ? "bg-amber-400 text-amber-950 border-amber-400"
    : danger
      ? "border-rose-400/50 text-rose-400 hover:bg-rose-400/10"
      : "border-neutral-700 text-neutral-300 hover:border-neutral-500";
  return (
    <button
      type="button" onClick={onClick} disabled={disabled}
      className={`rounded-lg border px-3 py-1.5 text-xs font-bold disabled:opacity-50 ${cls}`}
    >
      {children}
    </button>
  );
}
