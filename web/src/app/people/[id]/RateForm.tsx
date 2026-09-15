"use client";

import { useState, useTransition } from "react";
import { rateSkills, type RateResult } from "./actions";

/* Rating somebody, 1 to 5.
 *
 * Radio buttons rather than a slider, because a slider has to be told what it
 * currently says and that needs JavaScript; five radios say it themselves. It
 * is also what a thumb wants on a phone at the side of a court.
 *
 * The form opens on what THIS rater said last time, so re-rating is a
 * correction rather than a fresh start — and the copy says plainly that it
 * replaces rather than adds, because the opposite is what the legacy app did
 * and is what anyone would assume.
 */

export type RateFormProps = {
  subjectPersonId: string;
  subjectName: string;
  sport: string;
  sportName: string;
  skills: string[];
  tags: string[];
  mine: { scores: Record<string, number>; tags: string[] };
};

const SCALE = [1, 2, 3, 4, 5];

export function RateForm({
  subjectPersonId, subjectName, sport, sportName, skills, tags, mine,
}: RateFormProps) {
  const [open, setOpen] = useState(false);
  const [result, setResult] = useState<RateResult | null>(null);
  const [pending, start] = useTransition();
  const rated = Object.keys(mine.scores).length > 0 || mine.tags.length > 0;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black text-amber-950 hover:brightness-110"
      >
        {rated ? "Change what you said" : `Rate ${subjectName.split(" ")[0]}`}
      </button>
    );
  }

  return (
    <form
      action={(fd) => start(async () => setResult(await rateSkills(subjectPersonId, fd)))}
      className="space-y-4 rounded-xl border border-neutral-700 bg-neutral-900 p-4"
    >
      <input type="hidden" name="sport" value={sport} />
      <div>
        <h3 className="text-sm font-black">
          {rated ? "Your rating" : "How do they play?"} · {sportName}
        </h3>
        <p className="text-[11px] text-neutral-500">
          Only you can change your own answers, and they replace what you said before — rating
          twice does not count twice.
        </p>
      </div>

      <div className="space-y-1">
        {skills.map((skill) => {
          const current = mine.scores[skill] ?? 3;
          return (
            <div key={skill} className="flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-neutral-300">
                {skill}
              </span>
              <div className="flex gap-1">
                {SCALE.map((n) => (
                  <label
                    key={n}
                    className="cursor-pointer"
                    title={`${skill}: ${n}`}
                  >
                    <input
                      type="radio"
                      name={`skill:${skill}`}
                      value={n}
                      defaultChecked={current === n}
                      className="peer sr-only"
                    />
                    <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-700 text-[11px] font-bold text-neutral-400 peer-checked:border-amber-400 peer-checked:bg-amber-400 peer-checked:text-amber-950">
                      {n}
                    </span>
                  </label>
                ))}
              </div>
            </div>
          );
        })}
      </div>

      <div>
        <h4 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
          What are they like to play?
        </h4>
        <div className="flex flex-wrap gap-2">
          {tags.map((tag) => (
            <label key={tag} className="cursor-pointer">
              <input
                type="checkbox"
                name={`tag:${tag}`}
                defaultChecked={mine.tags.includes(tag)}
                className="peer sr-only"
              />
              <span className="inline-flex rounded-full border border-neutral-700 px-3 py-1 text-[11px] font-bold text-neutral-400 peer-checked:border-amber-400 peer-checked:bg-amber-400 peer-checked:text-amber-950">
                {tag}
              </span>
            </label>
          ))}
        </div>
      </div>

      {result && (
        <p
          role="status"
          className={`rounded-lg border p-2 text-[12px] font-semibold ${
            result.ok
              ? "border-emerald-500 bg-emerald-500/10 text-emerald-300"
              : "border-rose-500 bg-rose-500/10 text-rose-300"
          }`}
        >
          {result.ok ? result.message : result.error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          disabled={pending}
          className="rounded-lg bg-amber-400 px-4 py-2 text-xs font-black text-amber-950 disabled:opacity-50"
        >
          {pending ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-lg border border-neutral-600 px-4 py-2 text-xs font-bold text-neutral-300"
        >
          Close
        </button>
      </div>
    </form>
  );
}
