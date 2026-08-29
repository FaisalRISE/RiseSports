"use client";

import { useState, useTransition } from "react";
import type { MatchView } from "@/lib/matchState";
import type { Side } from "@/lib/scoring/replay";

/* The referee console.
 *
 * The load-bearing idea, carried over from the console used at real events:
 * THE COURT IS THE INPUT. A referee standing courtside taps the half belonging
 * to the side that won the rally, rather than hunting for a labelled button.
 * "Flip my view" matters more than it looks — the referee may stand at either
 * end, and a court drawn the wrong way round guarantees mis-taps.
 *
 * This component holds no scoring logic. It renders the state the server
 * derived and calls Server Actions. The rules, the rotation and the serve
 * model never reach the browser. */

export type ConsoleTeam = { id: string; name: string; colour: string | null; players: string[] };

export type RefConsoleProps = {
  view: MatchView;
  teamA: ConsoleTeam;
  teamB: ConsoleTeam;
  canScore: boolean;
  actions: {
    score: (matchId: string, side: Side, rev: number) => Promise<{ ok: true } | { ok: false; error: string }>;
    undo: (matchId: string, rev: number) => Promise<{ ok: true } | { ok: false; error: string }>;
    confirm: (matchId: string, gate: number, rev: number) => Promise<{ ok: true } | { ok: false; error: string }>;
  };
};

export function RefConsole({ view, teamA, teamB, canScore, actions }: RefConsoleProps) {
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /* Ends change at 14 in the OSL format, so the console mirrors itself to match
     where the teams are actually standing. */
  const swapped = (view.osl?.endsChanged ?? false) !== flipped;
  const left = swapped ? teamB : teamA;
  const right = swapped ? teamA : teamB;
  const scoreOf = (t: ConsoleTeam) => (t.id === teamA.id ? view.a : view.b);
  const sideOf = (t: ConsoleTeam): Side => (t.id === teamA.id ? "a" : "b");

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
    });
  };

  const locked = view.locked || !canScore || pending;
  const gate = view.osl?.pendingGate ?? 0;

  const half = (t: ConsoleTeam, side: "left" | "right") => {
    const serving = view.serving === sideOf(t);
    return (
      <button
        type="button"
        disabled={locked}
        onClick={() => run(() => actions.score(view.matchId, sideOf(t), view.rev))}
        aria-label={`Point to ${t.name}`}
        className={[
          "relative flex min-h-40 flex-1 flex-col justify-center gap-1 p-4 text-left transition",
          side === "left" ? "rounded-l-xl" : "rounded-r-xl",
          locked ? "cursor-default opacity-90" : "cursor-pointer hover:brightness-110 active:brightness-125",
        ].join(" ")}
        style={{ background: t.colour ?? (side === "left" ? "#1b4f74" : "#17608a") }}
      >
        <div className="text-[10px] font-bold uppercase tracking-widest text-white/70">
          {serving ? `Serving · ${view.servePos === "R" ? "right / even" : "left / odd"}` : "Receiving"}
        </div>
        <div className="truncate text-base font-bold text-white drop-shadow">{t.name}</div>
        <div className="font-mono text-5xl font-black leading-none text-white drop-shadow">{scoreOf(t)}</div>
        {view.osl && (
          <div className="truncate text-[11px] font-semibold text-white/80">
            {t.players.slice(view.osl.slots[0], view.osl.slots[1] + 1).join(" & ") || "Line-up not set"}
          </div>
        )}
        {!locked && (
          <div className="absolute bottom-1 left-0 right-0 text-center text-[9px] font-bold uppercase tracking-widest text-white/60">
            tap = +1
          </div>
        )}
        {serving && <span className="absolute right-3 top-3 text-lg" aria-hidden>🟡</span>}
      </button>
    );
  };

  return (
    <div className="space-y-3">
      {view.osl && (
        <div className="flex flex-wrap items-baseline gap-2 rounded-xl border border-neutral-700 bg-neutral-900 p-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">On court</span>
          <span className="text-xl font-black text-amber-400">{view.osl.pairLabel}</span>
          <span className="text-[11px] font-semibold text-neutral-400">{view.osl.pairRange}</span>
          {view.osl.endsChanged && (
            <span className="ml-auto text-[11px] font-semibold text-neutral-400">
              Ends changed — {left.name} now on the left
            </span>
          )}
        </div>
      )}

      {view.golden && !view.over && (
        <p className="rounded-xl border border-rose-500 bg-rose-500/10 p-3 text-sm font-bold text-rose-300">
          ⚡ Golden point — the next rally wins the match.
        </p>
      )}

      <div className="flex overflow-hidden rounded-xl shadow-lg">
        {half(left, "left")}
        <div className="w-1.5 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,.95)_0_5px,rgba(255,255,255,.35)_5px_10px)]" />
        {half(right, "right")}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="rounded-lg border border-neutral-600 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:border-neutral-400"
        >
          ⤢ {flipped ? "View flipped" : "Flip my view"}
        </button>
        {canScore && (
          <button
            type="button"
            disabled={pending || view.rallies === 0}
            onClick={() => run(() => actions.undo(view.matchId, view.rev))}
            className="rounded-lg border border-neutral-600 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:border-neutral-400 disabled:opacity-40"
          >
            Undo last point
          </button>
        )}
        <span className="ml-auto text-[11px] font-semibold text-neutral-500">
          {view.rallies} rallies{view.over ? " · match complete" : ""}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-500 bg-rose-500/10 p-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      )}

      {view.over && (
        <p className="rounded-xl border border-emerald-500 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-300">
          🏆 {view.winner === "a" ? teamA.name : teamB.name} win {Math.max(view.a, view.b)}–{Math.min(view.a, view.b)}.
        </p>
      )}

      {/* Blocking rotation confirmation — Rules 3.4, and at 14 also 5.6.
          Scoring stays locked until the referee says the players have swapped. */}
      {gate > 0 && view.osl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-2xl border-2 border-emerald-400 bg-neutral-900 p-5 text-center">
            <h2 className="text-xl font-black uppercase text-emerald-400">
              {view.osl.pairLabel} on court · {gate} reached
            </h2>
            <p className="mt-1 text-sm font-semibold text-neutral-400">
              {view.osl.pendingIsEndsChange
                ? "Teams change ends at 14 — the pair change and the end change happen together."
                : `The score is not reset — ${view.osl.pairLabel} picks up from ${gate}.`}
            </p>
            <dl className="my-4 space-y-2 text-left">
              {[teamA, teamB].map((t) => (
                <div key={t.id} className="rounded-lg border border-neutral-700 bg-neutral-950 p-3">
                  <dt className="text-[11px] font-bold uppercase tracking-wide text-neutral-400">{t.name}</dt>
                  <dd className="text-sm font-semibold text-neutral-100">
                    {t.players.slice(view.osl!.slots[0], view.osl!.slots[1] + 1).join(" & ") || "—"}
                  </dd>
                </div>
              ))}
            </dl>
            {canScore ? (
              <button
                type="button"
                disabled={pending}
                onClick={() => run(() => actions.confirm(view.matchId, gate, view.rev))}
                className="w-full rounded-xl bg-emerald-400 px-4 py-3 text-sm font-black text-emerald-950 disabled:opacity-50"
              >
                ✓ On court — resume play
              </button>
            ) : (
              <p className="text-sm font-semibold text-neutral-400">Waiting for the referee to confirm.</p>
            )}
            <p className="mt-2 text-[11px] font-semibold text-neutral-500">
              Scoring is paused until this is confirmed. {view.osl.switchSeconds}s to take position.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
