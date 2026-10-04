"use client";

/* How this event's games are scored.
 *
 * Ported from the CreateTab controls in app.source.js — target, win-by-2,
 * golden point, change ends — plus `goldenInfo`, which restates the whole thing
 * in one plain sentence underneath.
 *
 * That sentence is the point of the screen. "To 15, win by 2, golden at 17,
 * cap 18" is four settings that interact, and an organiser who has them wrong
 * finds out at 16–16 with two teams waiting. So the app says back exactly what
 * it will do, in words, before anyone plays.
 *
 * The sentence is computed on the SERVER as the controls move. `goldenInfo`
 * sits behind `import "server-only"` with the rest of the scoring engine, and
 * the whole reason for that is the rules never reach the browser — restating
 * them is worth one round trip.
 *
 * Saving says what it did to the matches already played (lib/scoring/change):
 * finished ones keep their results, ones being played follow the new rules.
 * A change made in the middle of an event is exactly when an organiser needs
 * to hear that, and a silent save leaves them guessing.
 *
 * Carrom has a second ending: a set number of boards, most points after the
 * last one wins. It is a different kind of match, not a target, so choosing it
 * hides the point controls rather than leaving them there meaning nothing.
 */

import { useEffect, useState, useTransition } from "react";
import { setScoring, clearScoring, describeScoring } from "./actions";
import type { ScoringSaved } from "@/lib/scoring/change";

export type ScoringState = {
  target: number;
  winBy2: boolean;
  goldenAt: number | "auto" | "none";
  switchAt: number | null;
  scoreType: "service" | "rally" | "";
  /** Carrom over a set number of boards; null for every other ending. */
  boards: number | null;
};

const field =
  "rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200";

export function ScoringControls({
  tournamentId, initial, isCustom, presetName, sportDefault, carrom = false,
}: {
  tournamentId: string;
  initial: ScoringState;
  /** Carrom offers "a set number of boards" beside "first to a score". */
  carrom?: boolean;
  /** Whether this event already has its own rules, or is on the sport's. */
  isCustom: boolean;
  /** Set when the FORMAT fixes the rules, so these controls cannot apply. */
  presetName: string | null;
  sportDefault: string;
}) {
  const [target, setTarget] = useState(initial.target);
  const [winBy2, setWinBy2] = useState(initial.winBy2);
  const [goldenAt, setGoldenAt] = useState<string>(String(initial.goldenAt));
  const [switchAt, setSwitchAt] = useState<string>(initial.switchAt ? String(initial.switchAt) : "");
  const [scoreType, setScoreType] = useState<string>(initial.scoreType);
  const [sentence, setSentence] = useState<string>("");
  const [pending, start] = useTransition();
  const [ending, setEnding] = useState<"boards" | "score">(initial.boards != null ? "boards" : "score");
  const [boards, setBoards] = useState<string>(String(initial.boards ?? 8));
  /* What the last save did. Cleared by the next save, so it never describes
     settings other than the ones it was about. */
  const [saved, setSaved] = useState<ScoringSaved | null>(null);
  const byBoards = carrom && ending === "boards";

  /* After a save the page re-renders with the STORED settings. Every control
     above was seeded from `initial` once, so the card went on showing what
     was there before — "Back to the sport's defaults" left "8 boards"
     highlighted under a box saying the event now plays to 25, and the next
     save posted the stale values again. Adjusted during render, React's way
     of following a prop, so the "what this change did" box stays put. */
  const initialKey = JSON.stringify(initial);
  const [seen, setSeen] = useState(initialKey);
  if (seen !== initialKey) {
    setSeen(initialKey);
    setTarget(initial.target);
    setWinBy2(initial.winBy2);
    setGoldenAt(String(initial.goldenAt));
    setSwitchAt(initial.switchAt ? String(initial.switchAt) : "");
    setScoreType(initial.scoreType);
    setEnding(initial.boards != null ? "boards" : "score");
    setBoards(String(initial.boards ?? 8));
  }

  /* Ask the server what these settings mean, whenever they change. */
  useEffect(() => {
    let cancelled = false;
    describeScoring({ target, winBy2, goldenAt, scoreType, boards: byBoards ? boards : null })
      .then((s) => { if (!cancelled) setSentence(s); })
      .catch(() => { if (!cancelled) setSentence(""); });
    return () => { cancelled = true; };
  }, [target, winBy2, goldenAt, scoreType, byBoards, boards]);

  if (presetName) {
    return (
      <p className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4 text-sm text-neutral-400">
        This event runs the <b className="text-neutral-200">{presetName}</b> rules, which fix how
        games are scored. Change the format to set your own.
      </p>
    );
  }

  return (
    <form
      action={(fd) => start(async () => { setSaved(null); setSaved(await setScoring(tournamentId, fd)); })}
      className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
    >
      {carrom && (
        <fieldset className="space-y-2" data-testid="carrom-ending">
          <legend className="text-xs font-bold text-neutral-400">How a match ends</legend>
          <input type="hidden" name="carromEnd" value={ending} />
          <label
            className={`flex items-start gap-3 rounded-xl border p-3 ${
              ending === "boards" ? "border-2 border-amber-400 bg-amber-400/10" : "border-neutral-700 bg-neutral-950"
            }`}
          >
            <input
              type="radio" name="carromEndChoice" checked={ending === "boards"}
              onChange={() => setEnding("boards")} className="mt-1 h-4 w-4"
            />
            <span className="space-y-1">
              <span className="block text-sm font-black">A set number of boards</span>
              <span className="block text-xs text-neutral-400">
                Most points after the last board wins. A level score is a draw.
              </span>
              {ending === "boards" && (
                <span className="flex items-center gap-2 pt-1">
                  <input
                    name="boards" type="number" min={1} max={99} value={boards}
                    onChange={(e) => setBoards(e.target.value)}
                    aria-label="Number of boards"
                    className={`${field} w-20`}
                  />
                  <span className="text-sm font-bold text-neutral-300">boards</span>
                </span>
              )}
            </span>
          </label>
          <label
            className={`flex items-start gap-3 rounded-xl border p-3 ${
              ending === "score" ? "border-2 border-amber-400 bg-amber-400/10" : "border-neutral-700 bg-neutral-950"
            }`}
          >
            <input
              type="radio" name="carromEndChoice" checked={ending === "score"}
              onChange={() => setEnding("score")} className="mt-1 h-4 w-4"
            />
            <span className="space-y-1">
              <span className="block text-sm font-black">First to a score</span>
              <span className="block text-xs text-neutral-400">
                Usually 25. The board that gets a player there can carry them past it, so 29–18 is a real
                result. It can&rsquo;t end level.
              </span>
            </span>
          </label>
        </fieldset>
      )}

      {!byBoards && (
      <>
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-bold text-neutral-400">Points to win</span>
          <input
            name="target" type="number" min={1} max={99} value={target}
            onChange={(e) => setTarget(Number(e.target.value) || 1)}
            className={`${field} w-full`}
          />
        </label>

        <label className="block space-y-1">
          <span className="text-xs font-bold text-neutral-400">Change ends at</span>
          <input
            name="switchAt" type="number" min={1} max={99} value={switchAt}
            onChange={(e) => setSwitchAt(e.target.value)}
            placeholder="never"
            className={`${field} w-full`}
          />
          <span className="block text-[11px] text-neutral-500">
            Leave blank if sides do not change mid-game.
          </span>
        </label>
      </div>

      <fieldset className="space-y-1">
        <legend className="text-xs font-bold text-neutral-400">How points are scored</legend>
        <div className="flex flex-wrap gap-1.5">
          {[
            ["", `The sport's own (${sportDefault})`],
            ["rally", "Rally — every rally is a point"],
            ["service", "Service — only the serving side scores"],
          ].map(([v, label]) => (
            <button
              key={v} type="button" onClick={() => setScoreType(v)}
              aria-pressed={scoreType === v}
              className={`rounded-lg border px-3 py-1.5 text-xs font-bold ${
                scoreType === v
                  ? "border-amber-400 bg-amber-400 text-amber-950"
                  : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
              }`}
            >{label}</button>
          ))}
        </div>
        <input type="hidden" name="scoreType" value={scoreType} />
      </fieldset>

      <fieldset className="space-y-1">
        <legend className="text-xs font-bold text-neutral-400">How the game ends</legend>
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox" name="winBy2" checked={winBy2}
            onChange={(e) => setWinBy2(e.target.checked)}
            className="h-4 w-4"
          />
          Must win by two clear points
        </label>

        {winBy2 && (
          <div className="mt-1 flex flex-wrap items-center gap-1.5 border-l-2 border-neutral-800 pl-3">
            <span className="text-[11px] font-bold text-neutral-500">Two-point rule stops at</span>
            {["auto", "none"].map((v) => (
              <button
                key={v} type="button" onClick={() => setGoldenAt(v)}
                aria-pressed={goldenAt === v}
                className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold ${
                  goldenAt === v
                    ? "border-amber-400 bg-amber-400 text-amber-950"
                    : "border-neutral-700 text-neutral-400"
                }`}
              >{v === "auto" ? `Two above (${target + 2})` : "No ceiling"}</button>
            ))}
            <input
              type="number" min={1} max={99}
              value={goldenAt === "auto" || goldenAt === "none" ? "" : goldenAt}
              onChange={(e) => setGoldenAt(e.target.value || "auto")}
              placeholder="or a number"
              className={`${field} w-28`}
            />
          </div>
        )}
        <input type="hidden" name="goldenAt" value={goldenAt} />
      </fieldset>
      </>
      )}

      {/* The sentence that stops all of the above being misread. */}
      {sentence && (
        <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-sm font-bold text-amber-400">
          {sentence}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <button
          type="submit" disabled={pending}
          className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black text-amber-950 disabled:opacity-40"
        >
          {pending ? "Saving…" : "Save scoring"}
        </button>
        {isCustom && (
          <button
            type="button" disabled={pending}
            onClick={() => start(async () => { setSaved(null); setSaved(await clearScoring(tournamentId)); })}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-400 hover:border-neutral-500"
          >
            Back to the sport&rsquo;s defaults
          </button>
        )}
      </div>

      {saved && (
        <div
          role="status"
          data-testid="scoring-saved"
          className={`space-y-1 rounded-lg border p-3 text-sm ${
            saved.ok ? "border-emerald-500 bg-emerald-500/10 text-emerald-300" : "border-rose-500 bg-rose-500/10 text-rose-300"
          }`}
        >
          {saved.ok
            ? saved.lines.map((line, i) => (
                <p key={i} className={i === 0 ? "font-black" : "font-semibold"}>{line}</p>
              ))
            : <p className="font-bold">{saved.error}</p>}
        </div>
      )}

      <p className="text-[11px] text-neutral-500">
        {isCustom
          ? "This event uses its own rules."
          : `This event currently uses ${sportDefault}.`}
      </p>
    </form>
  );
}
