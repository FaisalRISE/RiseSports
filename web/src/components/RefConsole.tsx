"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MatchView } from "@/lib/matchState";
import type { Side } from "@/lib/scoring/replay";
import type { LiteRules } from "@/lib/scoring/replayLite";
import type { PushResult } from "@/lib/offline/queue";
import { useOfflineScoring } from "./useOfflineScoring";

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
    push: (matchId: string, log: Side[], baseRev: number) => Promise<PushResult>;
  };
  /** Rules and raw log as DATA, so the browser can keep scoring with no signal. */
  offline: {
    rules: LiteRules | null;
    format: string | null;
    serverLog: Side[];
    server: Side | null;
    posA: 0 | 1 | null;
    posB: 0 | 1 | null;
  };
};

export function RefConsole({ view, teamA, teamB, canScore, actions, offline }: RefConsoleProps) {
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  const off = useOfflineScoring({
    matchId: view.matchId,
    rules: offline.rules,
    format: offline.format,
    serverLog: offline.serverLog,
    serverRev: view.rev,
    server: offline.server,
    posA: offline.posA,
    posB: offline.posB,
    push: actions.push,
    onSynced: () => router.refresh(),
  });

  /* While rallies are queued the browser's own replay is what is true on court;
     the server's view is behind until they land. */
  const live = off.local
    ? { ...view, a: off.local.a, b: off.local.b, serving: off.local.serving, servePos: off.local.servePos,
        over: off.local.over, winner: off.local.winner, golden: off.local.golden, rallies: off.local.rallies }
    : view;

  /* Ends change at 14 in the OSL format, so the console mirrors itself to match
     where the teams are actually standing. */
  const swapped = (live.osl?.endsChanged ?? false) !== flipped;
  const left = swapped ? teamB : teamA;
  const right = swapped ? teamA : teamB;
  const scoreOf = (t: ConsoleTeam) => (t.id === teamA.id ? live.a : live.b);
  const sideOf = (t: ConsoleTeam): Side => (t.id === teamA.id ? "a" : "b");

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => {
    setError(null);
    start(async () => {
      const r = await fn();
      if (!r.ok) setError(r.error);
    });
  };

  /* Offline, the server cannot be asked whether a rotation is pending, so a
     format that needs one is not scoreable here at all. */
  const locked =
    live.locked || !canScore || pending ||
    (!off.online && !off.canScoreOffline) || !!off.conflict;
  const gate = live.osl?.pendingGate ?? 0;

  const half = (t: ConsoleTeam, side: "left" | "right") => {
    const serving = live.serving === sideOf(t);
    return (
      <button
        type="button"
        disabled={locked}
        onClick={() => {
          /* ONE path, always, whenever the browser can score this format.
             Branching on `off.online` looked right and was wrong: a hall with
             WiFi but no route to the server leaves navigator.onLine true, so
             the first tap took the direct Server Action, the fetch rejected
             inside the transition, and the rally was silently lost — the one
             outcome this whole feature exists to prevent. Queue first, send
             second: the rally is durable before anything can fail. */
          if (off.canScoreOffline) off.scoreOffline(sideOf(t));
          else run(() => actions.score(view.matchId, sideOf(t), view.rev));
        }}
        aria-label={`Point to ${t.name}`}
        className={[
          "relative flex min-h-40 flex-1 flex-col justify-center gap-1 p-4 text-left transition",
          side === "left" ? "rounded-l-xl" : "rounded-r-xl",
          locked ? "cursor-default opacity-90" : "cursor-pointer hover:brightness-110 active:brightness-125",
        ].join(" ")}
        style={{ background: t.colour ?? (side === "left" ? "#1b4f74" : "#17608a") }}
      >
        <div className="pr-7 text-[10px] font-bold uppercase tracking-widest text-white/70">
          {serving ? `Serving · ${live.servePos === "R" ? "right / even" : "left / odd"}` : "Receiving"}
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
      {live.osl && (
        <div className="flex flex-wrap items-baseline gap-2 rounded-xl border border-neutral-700 bg-neutral-900 p-3">
          <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-400">On court</span>
          <span className="text-xl font-black text-amber-400">{live.osl.pairLabel}</span>
          <span className="text-[11px] font-semibold text-neutral-400">{live.osl.pairRange}</span>
          {live.osl.endsChanged && (
            <span className="ml-auto text-[11px] font-semibold text-neutral-400">
              Ends changed — {left.name} now on the left
            </span>
          )}
        </div>
      )}

      {live.golden && !live.over && (
        <p className="rounded-xl border border-rose-500 bg-rose-500/10 p-3 text-sm font-bold text-rose-300">
          ⚡ Golden point — the next rally wins the match.
        </p>
      )}

      {/* Connection state. A referee must always be able to tell "recorded on
          this phone" from "saved" — otherwise they cannot know what to re-enter
          if the phone dies. Never claim a queued rally is saved. */}
      {/* Shown only once a send has actually FAILED, or the browser reports
          itself offline. Every tap queues now, so keying this off `queued > 0`
          would flash a warning on every single point of a healthy match and
          teach the referee to ignore the one banner that matters. */}
      {(!off.online || off.stalled) && (
        <p
          role="status"
          className={[
            "rounded-xl border p-3 text-sm font-bold",
            off.queued > 0
              ? "border-amber-500 bg-amber-500/10 text-amber-300"
              : "border-neutral-600 bg-neutral-800 text-neutral-300",
          ].join(" ")}
        >
          {off.queued > 0
              ? `${!off.online ? "Offline" : "No connection to the server"} — ${off.queued} ${off.queued === 1 ? "rally" : "rallies"} recorded on this phone, not yet saved. They will save on their own when the signal returns; keep scoring.`
              : off.canScoreOffline
                ? "Offline — you can keep scoring, and it will save when the signal returns."
                : "Offline — this format is scored on the server, so scoring is paused until the signal returns."}
        </p>
      )}

      {/* Two devices scored the same match. There is no safe automatic answer:
          picking one silently discards real rallies from a real court. */}
      {off.conflict && (
        <div className="rounded-xl border-2 border-rose-500 bg-rose-500/10 p-4">
          <h2 className="text-sm font-black uppercase tracking-wide text-rose-300">
            Another device also scored this match
          </h2>
          <p className="mt-1 text-[13px] font-semibold text-neutral-300">
            Both versions have rallies the other does not, so they cannot be merged automatically.
            Check the court and choose which is right.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => void off.resolveConflict("mine")}
              className="rounded-lg border border-rose-400 bg-rose-500/20 p-3 text-left text-[13px] font-bold text-rose-200 hover:bg-rose-500/30"
            >
              Keep this phone&apos;s score
              <span className="mt-1 block font-mono text-lg">{off.conflict.localLog.length} rallies</span>
            </button>
            <button
              type="button"
              onClick={() => void off.resolveConflict("theirs")}
              className="rounded-lg border border-neutral-500 bg-neutral-800 p-3 text-left text-[13px] font-bold text-neutral-200 hover:bg-neutral-700"
            >
              Keep the saved score
              <span className="mt-1 block font-mono text-lg">{off.conflict.serverLog.length} rallies</span>
            </button>
          </div>
        </div>
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
            disabled={pending || live.rallies === 0 || !!off.conflict}
            onClick={() => {
              /* Same single path as scoring above — an undo that vanishes into
                 a rejected fetch is as bad as a lost point. */
              if (off.canScoreOffline) off.undoOffline();
              else run(() => actions.undo(view.matchId, view.rev));
            }}
            className="rounded-lg border border-neutral-600 px-3 py-1.5 text-xs font-bold text-neutral-300 hover:border-neutral-400 disabled:opacity-40"
          >
            Undo last point
          </button>
        )}
        {/* The connection banner also says "N rallies", so the e2e scripts need
            to address this one exactly rather than by scanning the page. */}
        <span data-testid="rally-count" className="ml-auto text-[11px] font-semibold text-neutral-500">
          {live.rallies} rallies{live.over ? " · match complete" : ""}
        </span>
      </div>

      {error && (
        <p role="alert" className="rounded-lg border border-rose-500 bg-rose-500/10 p-3 text-sm font-semibold text-rose-300">
          {error}
        </p>
      )}

      {live.over && (
        <p className="rounded-xl border border-emerald-500 bg-emerald-500/10 p-3 text-sm font-bold text-emerald-300">
          🏆 {live.winner === "a" ? teamA.name : teamB.name} win {Math.max(live.a, live.b)}–{Math.min(live.a, live.b)}.
        </p>
      )}

      {/* Blocking rotation confirmation — Rules 3.4, and at 14 also 5.6.
          Scoring stays locked until the referee says the players have swapped. */}
      {gate > 0 && live.osl && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 p-4">
          <div className="w-full max-w-md rounded-2xl border-2 border-emerald-400 bg-neutral-900 p-5 text-center">
            <h2 className="text-xl font-black uppercase text-emerald-400">
              {live.osl.pairLabel} on court · {gate} reached
            </h2>
            <p className="mt-1 text-sm font-semibold text-neutral-400">
              {live.osl.pendingIsEndsChange
                ? "Teams change ends at 14 — the pair change and the end change happen together."
                : `The score is not reset — ${live.osl.pairLabel} picks up from ${gate}.`}
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
              Scoring is paused until this is confirmed. {live.osl.switchSeconds}s to take position.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
