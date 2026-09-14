"use client";

/* The evening's games, and the box for typing a score in.
 *
 * Ported from app.source.js:11425-11651 — the schedule display and the score
 * modal. Two things carried across deliberately:
 *
 *   The card says what a court looks like, not what a database row looks like:
 *   two sides with a "v" between them, the winner's score bolder.
 *
 *   The modal warns that saving moves everyone's rating. Community scores are
 *   the main thing that moves ratings in this product, they are typed in by
 *   whoever is holding the phone, and nobody expects a number they typed to
 *   change four people's ratings unless they are told.
 */

import { useState, useTransition } from "react";
import { generateScheduleAction, saveScoreAction, clearScoreAction } from "./actions";

export type ViewGame = {
  id: string;
  court: number;
  lineupA: string[];
  lineupB: string[];
  scoreA: number | null;
  scoreB: number | null;
};

export type ViewBlock = {
  block: number;
  label: string;
  courts: { court: number; games: ViewGame[] }[];
  benched: string[];
};

export function Schedule({
  slug, date, blocks, names, isHost, confirmedCount, courtWord,
}: {
  slug: string;
  date: string;
  blocks: ViewBlock[];
  names: Record<string, string>;
  isHost: boolean;
  confirmedCount: number;
  courtWord: string;
}) {
  const [error, setError] = useState<string | null>(null);
  const [scoring, setScoring] = useState<ViewGame | null>(null);
  const [pending, start] = useTransition();

  const nameOf = (id: string) => names[id] ?? "Unknown";
  const side = (ids: string[]) => ids.map(nameOf).join(" & ");

  const generate = () =>
    start(async () => {
      const res = await generateScheduleAction(slug, date);
      setError(res.ok ? null : res.error);
    });

  if (blocks.length === 0) {
    if (!isHost) return null;
    return (
      <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Games</h2>
        <p className="mt-1 text-sm text-neutral-400">
          {confirmedCount < 2
            ? `Confirm at least two players and you can draw up the ${courtWord}s.`
            : `${confirmedCount} confirmed. Draw up who plays whom.`}
        </p>
        <button
          type="button" onClick={generate} disabled={pending || confirmedCount < 2}
          className="mt-3 rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-amber-950 disabled:opacity-40"
        >
          {pending ? "Working…" : "Make the games"}
        </button>
        {error && <p className="mt-2 text-xs font-bold text-rose-400">{error}</p>}
      </div>
    );
  }

  return (
    <>
      <div className="space-y-3">
        {blocks.map((block) => (
          <div key={block.block} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="flex items-baseline justify-between gap-2">
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                {block.label}
              </h2>
              {isHost && block.block === 0 && (
                <button
                  type="button" onClick={generate} disabled={pending}
                  className="text-[11px] font-bold text-neutral-500 hover:text-amber-400 disabled:opacity-40"
                >
                  Redraw
                </button>
              )}
            </div>

            <div className="mt-2 space-y-3">
              {block.courts.map((court) => (
                <div key={court.court}>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-neutral-500">
                    {courtWord} {court.court}
                  </p>
                  <ul className="mt-1 space-y-1">
                    {court.games.map((g) => {
                      const done = g.scoreA !== null && g.scoreB !== null;
                      const aWon = done && (g.scoreA ?? 0) > (g.scoreB ?? 0);
                      return (
                        <li key={g.id}>
                          <button
                            type="button"
                            onClick={() => isHost && setScoring(g)}
                            disabled={!isHost}
                            className={`flex w-full items-center gap-2 rounded-lg border p-2.5 text-left ${
                              isHost ? "hover:border-neutral-600" : "cursor-default"
                            } ${done ? "border-neutral-800" : "border-dashed border-neutral-700"}`}
                          >
                            <span className={`min-w-0 flex-1 truncate text-sm ${aWon ? "font-bold" : ""}`}>
                              {side(g.lineupA)}
                            </span>
                            <span className="shrink-0 text-sm tabular-nums text-neutral-400">
                              {done ? (
                                <>
                                  <b className={aWon ? "text-neutral-200" : ""}>{g.scoreA}</b>
                                  <span className="px-1 text-neutral-600">–</span>
                                  <b className={!aWon ? "text-neutral-200" : ""}>{g.scoreB}</b>
                                </>
                              ) : (
                                <span className="text-[11px] font-bold uppercase tracking-wider text-neutral-600">
                                  v
                                </span>
                              )}
                            </span>
                            <span className={`min-w-0 flex-1 truncate text-right text-sm ${done && !aWon ? "font-bold" : ""}`}>
                              {side(g.lineupB)}
                            </span>
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}

              {block.benched.length > 0 && (
                <p className="text-xs text-neutral-500">
                  Sitting out: {block.benched.map(nameOf).join(", ")}
                </p>
              )}
            </div>
          </div>
        ))}
        {error && <p className="text-xs font-bold text-rose-400">{error}</p>}
      </div>

      {scoring && (
        <ScoreBox
          game={scoring}
          slug={slug}
          nameOf={nameOf}
          onClose={() => setScoring(null)}
          onError={setError}
        />
      )}
    </>
  );
}

/* ── The score box ────────────────────────────────────────────────────────*/

function ScoreBox({
  game, slug, nameOf, onClose, onError,
}: {
  game: ViewGame;
  slug: string;
  nameOf: (id: string) => string;
  onClose: () => void;
  onError: (e: string | null) => void;
}) {
  const [a, setA] = useState(game.scoreA?.toString() ?? "");
  const [b, setB] = useState(game.scoreB?.toString() ?? "");
  const [pending, start] = useTransition();
  const [localError, setLocalError] = useState<string | null>(null);

  const already = game.scoreA !== null && game.scoreB !== null;

  const save = () =>
    start(async () => {
      const res = await saveScoreAction(slug, game.id, Number(a), Number(b));
      if (res.ok) {
        onError(null);
        onClose();
      } else setLocalError(res.error);
    });

  const clear = () =>
    start(async () => {
      const res = await clearScoreAction(slug, game.id);
      if (res.ok) {
        onError(null);
        onClose();
      } else setLocalError(res.error);
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-4 sm:items-center"
      role="dialog" aria-modal="true" aria-label="Enter the score"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
        <h2 className="text-sm font-bold">Score</h2>

        <div className="mt-4 flex items-center gap-3">
          <div className="min-w-0 flex-1">
            <p className="truncate text-xs font-bold text-neutral-400">
              {game.lineupA.map(nameOf).join(" & ")}
            </p>
            <input
              value={a} onChange={(e) => setA(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric" aria-label="Score for the first side"
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-2xl font-black tabular-nums"
            />
          </div>
          <span className="pt-5 text-xs font-bold text-neutral-600">v</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-right text-xs font-bold text-neutral-400">
              {game.lineupB.map(nameOf).join(" & ")}
            </p>
            <input
              value={b} onChange={(e) => setB(e.target.value.replace(/\D/g, ""))}
              inputMode="numeric" aria-label="Score for the second side"
              className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-900 px-3 py-2 text-center text-2xl font-black tabular-nums"
            />
          </div>
        </div>

        {/* Community scores are what moves most ratings in this product. Nobody
            expects a number they typed to change four people's ratings, so it
            says so before the button, not after. */}
        <p className="mt-3 rounded-lg bg-amber-400/10 px-3 py-2 text-[11px] font-bold text-amber-400">
          {already
            ? "This score has already counted. Clear it to change it."
            : "Saving this updates the rating of all four players."}
        </p>

        {localError && <p className="mt-2 text-xs font-bold text-rose-400">{localError}</p>}

        <div className="mt-4 flex gap-2">
          <button
            type="button" onClick={onClose}
            className="flex-1 rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-300"
          >
            Cancel
          </button>
          {already ? (
            <button
              type="button" onClick={clear} disabled={pending}
              className="flex-1 rounded-lg border border-rose-400/50 px-3 py-2 text-xs font-bold text-rose-400 disabled:opacity-40"
            >
              {pending ? "…" : "Clear it"}
            </button>
          ) : (
            <button
              type="button" onClick={save} disabled={pending || a === "" || b === ""}
              className="flex-1 rounded-lg bg-amber-400 px-3 py-2 text-xs font-black text-amber-950 disabled:opacity-40"
            >
              {pending ? "Saving…" : "Save score"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
