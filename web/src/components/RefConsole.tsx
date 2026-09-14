"use client";

import { useCallback, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { MatchView, CourtNotes } from "@/lib/matchState";
import type { Side } from "@/lib/scoring/replay";
import type { LiteRules } from "@/lib/scoring/replayLite";
import type { PushResult } from "@/lib/offline/queue";
import { fmtClock, PAUSE_REASONS, type PauseReason, type Tick } from "@/lib/scoring/clock";
import { useOfflineScoring } from "./useOfflineScoring";
import { useMatchClock } from "./useMatchClock";
import { useKeepAwake } from "./useKeepAwake";

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
  /** The rules in words, written on the server — see matchState.describeCourt. */
  notes: CourtNotes | null;
  actions: {
    score: (matchId: string, side: Side, rev: number, tick?: Tick) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
    undo: (matchId: string, rev: number, tick?: Tick) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
    minus: (matchId: string, side: Side, rev: number, tick?: Tick) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
    confirm: (matchId: string, gate: number, rev: number) => Promise<{ ok: true } | { ok: false; error: string }>;
    setup: (matchId: string, setup: { server?: Side; posA?: 0 | 1; posB?: 0 | 1 }) =>
      Promise<{ ok: true } | { ok: false; error: string }>;
    push: (matchId: string, log: Side[], baseRev: number, tick?: Tick) => Promise<PushResult>;
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

export function RefConsole({ view, teamA, teamB, canScore, notes, actions, offline }: RefConsoleProps) {
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  /* The clock is created before the queue because the queue writes through it:
     every push claims the milliseconds measured since the last one. */
  const clock = useMatchClock({
    timing: view.timing,
    live: (view.rallies > 0 || !!view.timing?.startedAt) && !view.over,
  });

  /* Stable, so the queue's callbacks are stable. An inline arrow here is a new
     function on every render, and this console re-renders every second. */
  const onSynced = useCallback(() => router.refresh(), [router]);

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
    onSynced,
    clock,
  });

  /* While rallies are queued the browser's own replay is what is true on court;
     the server's view is behind until they land. */
  const live = off.local
    ? { ...view, a: off.local.a, b: off.local.b, serving: off.local.serving, servePos: off.local.servePos,
        over: off.local.over, winner: off.local.winner, golden: off.local.golden,
        gamePoint: off.local.gamePoint, rallies: off.local.rallies }
    : view;

  /* Hold the screen on while there is a match to score. A phone that dims
     between rallies costs the referee a tap just to wake it. */
  useKeepAwake(canScore && !live.over);

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

  /* ONE path, always, whenever the browser can score this format. Branching on
     `off.online` looked right and was wrong: a hall with WiFi but no route to
     the server leaves navigator.onLine true, so the first tap took the direct
     Server Action, the fetch rejected inside the transition, and the rally was
     silently lost — the one outcome this whole feature exists to prevent.
     Queue first, send second: the rally is durable before anything can fail. */
  const point = (side: Side) => {
    if (off.canScoreOffline) off.scoreOffline(side);
    else run(() => actions.score(view.matchId, side, view.rev, clock.claim()));
  };
  const undo = () => {
    if (off.canScoreOffline) off.undoOffline();
    else run(() => actions.undo(view.matchId, view.rev, clock.claim()));
  };
  const minus = (side: Side) => {
    if (off.canScoreOffline) off.minusOffline(side);
    else run(() => actions.minus(view.matchId, side, view.rev, clock.claim()));
  };

  /* Pause takes effect on this device the instant it is tapped and is written
     through afterwards. The referee is standing over an injured player; a
     button that has to reach a server before the clock stops is a button that
     fails at exactly the wrong moment. */
  const setPaused = (reason: PauseReason | null) => {
    clock.setPaused(reason);
    off.syncClock();
  };

  const started = live.rallies > 0 || !!view.timing?.startedAt;
  const doubles = teamA.players.length > 1 || teamB.players.length > 1;
  /* Keyed on the LOG, not on whether the clock has started, so the screen and
     `setMatchSetup` agree about when this is allowed. The log is the real
     constraint: the service sequence is derived from it, so with nothing in it
     there is nothing to rewrite — including after a correction takes a match
     back to 0–0, which is exactly when a referee notices the wrong side was
     marked as serving. */
  const canSetUp = canScore && live.rallies === 0 && !off.conflict;

  const half = (t: ConsoleTeam, side: "left" | "right") => {
    const serving = live.serving === sideOf(t);
    return (
      <button
        type="button"
        disabled={locked}
        onClick={() => point(sideOf(t))}
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

  const chip = (label: string, active: boolean, onClick: () => void, key?: string) => (
    <button
      key={key ?? label}
      type="button"
      onClick={onClick}
      className={[
        "rounded-lg border px-3 py-1.5 text-xs font-bold transition",
        active
          ? "border-amber-400 bg-amber-400 text-amber-950"
          : "border-neutral-600 bg-neutral-900 text-neutral-300 hover:border-neutral-400",
      ].join(" ")}
    >
      {label}
    </button>
  );

  return (
    <div className="space-y-3">
      {/* The clock. Play time only: a match paused for eight minutes did not
          take eight more minutes of play, and that is the one number the spec
          asks the record to keep. */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-neutral-700 bg-neutral-900 p-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
            {clock.paused ? "Paused" : started ? "Playing time" : "Not started"}
          </div>
          <div
            data-testid="match-clock"
            className={[
              "font-mono text-2xl font-black tabular-nums",
              clock.paused ? "text-orange-600" : started ? "text-neutral-100" : "text-neutral-600",
            ].join(" ")}
          >
            {fmtClock(clock.displayMs)}
          </div>
        </div>
        {canScore && started && !live.over && (
          <button
            type="button"
            onClick={() => setPaused(clock.paused ? null : "timeout")}
            className={[
              "ml-auto rounded-lg px-4 py-2 text-sm font-black transition",
              clock.paused
                ? "bg-orange-600 text-white hover:brightness-110"
                : "border border-neutral-600 text-neutral-200 hover:border-neutral-400",
            ].join(" ")}
          >
            {clock.paused ? "▶ Resume" : "⏸ Pause"}
          </button>
        )}
      </div>

      {clock.paused && (
        <div role="status" className="rounded-xl border border-orange-500 bg-orange-500/10 p-3">
          <p className="text-sm font-bold text-orange-600">
            Paused — the clock is stopped. Play is not being timed.
          </p>
          {canScore && (
            <div className="mt-2 flex flex-wrap gap-2">
              {PAUSE_REASONS.map((r) =>
                chip(r.label, clock.reason === r.id, () => setPaused(r.id), r.id),
              )}
            </div>
          )}
        </div>
      )}

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

      {/* Game point. Under side-out only the serving side can convert, which is
          why this comes from the engine rather than from comparing the two
          scores here — the receiving side being one point from the target does
          not put them on game point. */}
      {!live.golden && !live.over && live.gamePoint.length > 0 && (
        <p className="rounded-xl border border-orange-500 bg-orange-500/10 p-3 text-sm font-bold text-orange-600">
          Game point · {live.gamePoint.map((s) => (s === "a" ? teamA.name : teamB.name)).join(" & ")}
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

      {/* Pre-match setup, and it disappears the moment the first rally lands.
          Not a courtesy: the whole service sequence is DERIVED by replaying the
          log against these two answers, so changing them at 8–6 would not
          correct a mistake, it would rewrite who had been serving all game. */}
      {canSetUp && (
        <div className="rounded-xl border border-neutral-700 bg-neutral-900 p-3">
          <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
            Before the first serve
          </h2>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <span className="min-w-24 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
              Serves first
            </span>
            {[teamA, teamB].map((t) =>
              chip(
                t.name,
                (offline.server ?? "a") === sideOf(t),
                () => run(() => actions.setup(view.matchId, { server: sideOf(t) })),
                t.id,
              ),
            )}
            <span className="text-[11px] text-neutral-500">the first server starts on the right</span>
          </div>
          {doubles && (
            <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-2">
              <span className="min-w-24 text-[11px] font-bold uppercase tracking-wide text-neutral-400">
                On the right
              </span>
              {[teamA, teamB].map((t) => {
                const a = t.id === teamA.id;
                const pos = (a ? offline.posA : offline.posB) === 1 ? 1 : 0;
                return (
                  <span key={t.id} className="inline-flex items-center gap-1 text-[11px] font-semibold text-neutral-300">
                    {t.name}:
                    <span className="text-neutral-400">{t.players[pos] ?? "—"}</span>
                    {chip("⇄", false, () =>
                      run(() =>
                        actions.setup(view.matchId, a ? { posA: pos ? 0 : 1 } : { posB: pos ? 0 : 1 }),
                      ), `${t.id}-swap`)}
                  </span>
                );
              })}
              <span className="text-[11px] text-neutral-500">each pair chooses its starting server</span>
            </div>
          )}
        </div>
      )}

      <div className="flex overflow-hidden rounded-xl shadow-lg">
        {half(left, "left")}
        <div className="w-1.5 bg-[repeating-linear-gradient(0deg,rgba(255,255,255,.95)_0_5px,rgba(255,255,255,.35)_5px_10px)]" />
        {half(right, "right")}
      </div>

      {/* The +/− fallback. The court is the input, but a referee who has just
          given a point to the wrong side needs a way to say so that is not
          "undo four times". */}
      {canScore && (
        <div className="space-y-1.5">
          {[left, right].map((t) => (
            <div key={t.id} className="flex items-center gap-2">
              <button
                type="button"
                disabled={locked || scoreOf(t) === 0}
                onClick={() => minus(sideOf(t))}
                aria-label={`Take a point off ${t.name}`}
                className="h-11 w-14 rounded-lg border border-neutral-600 text-xl font-black text-neutral-200 disabled:opacity-30"
              >
                −
              </button>
              <span className="min-w-0 flex-1 truncate text-[13px] font-bold text-neutral-300">{t.name}</span>
              <span className="font-mono text-sm font-bold tabular-nums text-neutral-500">{scoreOf(t)}</span>
              <button
                type="button"
                disabled={locked}
                onClick={() => point(sideOf(t))}
                aria-label={`Add a point for ${t.name}`}
                className="h-11 w-14 rounded-lg text-xl font-black text-white disabled:opacity-30"
                style={{ background: t.colour ?? "#17608a" }}
              >
                +
              </button>
            </div>
          ))}
        </div>
      )}

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
            onClick={undo}
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
          🏆 {live.winner === "a" ? teamA.name : teamB.name} win {Math.max(live.a, live.b)}–{Math.min(live.a, live.b)}
          {view.timing?.playingMs ? ` in ${fmtClock(view.timing.playingMs)}` : ""}.
        </p>
      )}

      {/* Reading the court. Misreading the service box is the mistake a new
          referee actually makes, and under side-out a rally won by the
          receivers looks like a tap the app ignored. */}
      {notes && (
        <details className="rounded-xl border border-neutral-700 bg-neutral-900 p-3">
          <summary className="cursor-pointer text-[10px] font-bold uppercase tracking-widest text-neutral-500">
            Reading the court
          </summary>
          <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">{notes.serve}</p>
          <p className="mt-2 text-[12px] leading-relaxed text-neutral-400">
            {notes.scoring} {live.rallies} {live.rallies === 1 ? "rally" : "rallies"} recorded —{" "}
            {live.a}+{live.b}={live.a + live.b}.
          </p>
        </details>
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
