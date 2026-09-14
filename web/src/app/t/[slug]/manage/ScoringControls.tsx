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
 */

import { useEffect, useState, useTransition } from "react";
import { setScoring, clearScoring, describeScoring } from "./actions";

export type ScoringState = {
  target: number;
  winBy2: boolean;
  goldenAt: number | "auto" | "none";
  switchAt: number | null;
  scoreType: "service" | "rally" | "";
};

const field =
  "rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200";

export function ScoringControls({
  tournamentId, initial, isCustom, presetName, sportDefault,
}: {
  tournamentId: string;
  initial: ScoringState;
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

  /* Ask the server what these settings mean, whenever they change. */
  useEffect(() => {
    let cancelled = false;
    describeScoring({ target, winBy2, goldenAt, scoreType })
      .then((s) => { if (!cancelled) setSentence(s); })
      .catch(() => { if (!cancelled) setSentence(""); });
    return () => { cancelled = true; };
  }, [target, winBy2, goldenAt, scoreType]);

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
      action={(fd) => start(async () => { await setScoring(tournamentId, fd); })}
      className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4"
    >
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
            onClick={() => start(async () => { await clearScoring(tournamentId); })}
            className="rounded-lg border border-neutral-700 px-4 py-2 text-xs font-bold text-neutral-400 hover:border-neutral-500"
          >
            Back to the sport&rsquo;s defaults
          </button>
        )}
      </div>

      <p className="text-[11px] text-neutral-500">
        {isCustom
          ? "This event uses its own rules."
          : `This event currently uses ${sportDefault}.`}
      </p>
    </form>
  );
}
