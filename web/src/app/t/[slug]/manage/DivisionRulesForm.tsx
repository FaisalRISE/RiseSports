"use client";

/* "Who can enter" — one category's limits, on the manage screen.
 *
 * Faisal, 2026-09-17: men, women or mixed; an age range; a rating level; a DUPR
 * range. Laid out after the picture he approved: closed, it is one line saying
 * who can enter; open, it is the controls with ONE plain sentence underneath
 * that says the rules back as they change.
 *
 * That sentence comes from the server, as `describeScoring`'s does for scoring:
 * the rules live behind `import "server-only"` and never reach the browser, and
 * restating them is worth one round trip. Problems come back the same way, so
 * "Youngest age is above oldest age" is said before Save is pressed.
 *
 * Saving never removes anybody. The reply counts the teams already in that no
 * longer fit, and the manage screen marks them.
 */

import { useEffect, useState, useTransition } from "react";
import type { RulesSaveResult } from "./actions";

export type RulesFormState = {
  gender: string; ageMin: string; ageMax: string; ageOn: string;
  ratingMin: string; ratingMax: string; duprMin: string; duprMax: string;
  /** "on" for strict, "" to let players with no DUPR in, flagged. */
  duprStrict: string;
};

type Problem = { field: string; message: string };

const field = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm";
const label = "text-[10px] font-bold uppercase tracking-widest text-neutral-500";

export function DivisionRulesForm({
  tournamentId, divisionId, initial, summary, eventDay, eventDayLabel, tiers, allowMixed, allowDupr, save, describe,
}: {
  tournamentId: string;
  divisionId: string;
  initial: RulesFormState;
  /** "Women only · 35+", or "Anyone" — the closed line. */
  summary: string;
  /** The event's date as "YYYY-MM-DD", or null when it has none yet. */
  eventDay: string | null;
  eventDayLabel: string | null;
  tiers: { name: string; min: number; max: number }[];
  allowMixed: boolean;
  /** DUPR is a pickleball rating: another sport's category has no DUPR limit. */
  allowDupr: boolean;
  save: (tournamentId: string, formData: FormData) => Promise<RulesSaveResult>;
  describe: (tournamentId: string, input: Record<string, string>) => Promise<{ sentence: string; problems: Problem[] }>;
}) {
  const [open, setOpen] = useState(false);
  const [s, setS] = useState<RulesFormState>(initial);
  const [sentence, setSentence] = useState("");
  const [problems, setProblems] = useState<Problem[]>([]);
  const [saved, setSaved] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const set = (k: keyof RulesFormState) => (v: string) => {
    setSaved(null);
    setS((prev) => ({ ...prev, [k]: v }));
  };

  /* Ask the server what these settings mean when they have STOPPED changing.
     Per keystroke, "3.50" typed into the DUPR box was four round trips and four
     database reads; a quarter of a second after the last one is still instant
     to read and asks once. */
  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      describe(tournamentId, s)
        .then((r) => {
          if (cancelled) return;
          setSentence(r.sentence);
          setProblems(r.problems);
        })
        .catch(() => { if (!cancelled) setSentence(""); });
    }, 250);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [open, s, tournamentId, describe]);

  const hasAge = s.ageMin.trim() !== "" || s.ageMax.trim() !== "";
  const problemFor = (f: string) => problems.find((p) => p.field === f)?.message;

  if (!open) {
    return (
      <div className="flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3" data-rules-line>
        <span className="text-[11px] text-neutral-500">
          Who can enter: <span className="font-bold text-neutral-200">{summary}</span>
        </span>
        <button type="button" onClick={() => setOpen(true)}
          className="text-[11px] font-bold text-neutral-400 underline hover:text-neutral-200">
          change
        </button>
      </div>
    );
  }

  const whoOptions: [string, string][] = [["", "Anyone"], ["M", "Men"], ["F", "Women"], ["MX", "Mixed"]];

  return (
    <form
      data-rules-form
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await save(tournamentId, fd);
          if (res.ok) {
            setSaved(res.message);
            setProblems([]);
          } else {
            setSaved(null);
            setProblems(res.problems);
          }
        });
      }}
      className="space-y-3 border-t border-neutral-800 pt-3"
    >
      <input type="hidden" name="divisionId" value={divisionId} />
      <input type="hidden" name="gender" value={s.gender} />

      <div className="flex items-baseline justify-between">
        <h4 className="text-[11px] font-black uppercase tracking-widest text-neutral-300">Who can enter</h4>
        <button type="button" onClick={() => setOpen(false)}
          className="text-[11px] font-bold text-neutral-500 hover:text-neutral-300">
          close
        </button>
      </div>

      <div className="space-y-1">
        <span className={label}>Who</span>
        <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-neutral-700">
          {whoOptions.map(([v, text]) => {
            const disabled = v === "MX" && !allowMixed;
            return (
              <button
                key={v} type="button" disabled={disabled}
                aria-pressed={s.gender === v}
                onClick={() => set("gender")(v)}
                title={disabled ? "Mixed needs teams of at least two" : undefined}
                className={`py-1.5 text-xs font-bold ${
                  s.gender === v ? "bg-neutral-200 text-neutral-900" : "text-neutral-400 hover:text-neutral-200"
                } disabled:opacity-40`}
              >
                {text}
              </button>
            );
          })}
        </div>
        {problemFor("gender") && <p className="text-[11px] font-semibold text-rose-400">{problemFor("gender")}</p>}
      </div>

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className={label}>Youngest</span>
          <input name="ageMin" type="number" min={0} max={120} inputMode="numeric" placeholder="any"
            value={s.ageMin} onChange={(e) => set("ageMin")(e.target.value)} className={field} />
        </label>
        <label className="space-y-1">
          <span className={label}>Oldest</span>
          <input name="ageMax" type="number" min={0} max={120} inputMode="numeric" placeholder="any"
            value={s.ageMax} onChange={(e) => set("ageMax")(e.target.value)} className={field} />
        </label>
      </div>
      {problemFor("ageMin") && <p className="text-[11px] font-semibold text-rose-400">{problemFor("ageMin")}</p>}

      {hasAge && (
        <div className="space-y-1">
          <label className="block space-y-1">
            <span className={label}>Age counted on</span>
            <input name="ageOn" type="date" value={s.ageOn}
              onChange={(e) => set("ageOn")(e.target.value)} className={field} />
          </label>
          {/* Prominent, because this date will NOT follow the event if one is
              set later — the organiser has to know it is a stand-in. */}
          {!eventDay && (
            <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-2 text-[11px] font-semibold text-rose-300">
              Your event has no date yet, so ages are counted on this day. Change it to the event day.
            </p>
          )}
          {eventDay && s.ageOn && s.ageOn !== eventDay && (
            <p className="text-[11px] text-neutral-500">
              Ages are counted on this date, not the event day ({eventDayLabel}).
            </p>
          )}
          {problemFor("ageOn") && <p className="text-[11px] font-semibold text-rose-400">{problemFor("ageOn")}</p>}
        </div>
      )}
      {!hasAge && <input type="hidden" name="ageOn" value="" />}

      <div className="grid grid-cols-2 gap-2">
        <label className="space-y-1">
          <span className={label}>Rating from</span>
          <select name="ratingMin" value={s.ratingMin} onChange={(e) => set("ratingMin")(e.target.value)} className={field}>
            <option value="">Any level</option>
            {tiers.map((t) => <option key={t.min} value={t.min}>{t.name} ({t.min})</option>)}
          </select>
        </label>
        <label className="space-y-1">
          <span className={label}>Rating up to</span>
          <select name="ratingMax" value={s.ratingMax} onChange={(e) => set("ratingMax")(e.target.value)} className={field}>
            <option value="">Any level</option>
            {tiers.map((t) => <option key={t.max} value={t.max}>{t.name} ({t.max > 5000 ? "top" : t.max})</option>)}
          </select>
        </label>
      </div>
      {problemFor("ratingMin") && <p className="text-[11px] font-semibold text-rose-400">{problemFor("ratingMin")}</p>}

      {allowDupr && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="space-y-1">
              <span className={label}>DUPR from</span>
              <input name="duprMin" inputMode="decimal" placeholder="e.g. 3.00" value={s.duprMin}
                onChange={(e) => set("duprMin")(e.target.value)} className={field} />
            </label>
            <label className="space-y-1">
              <span className={label}>DUPR up to</span>
              <input name="duprMax" inputMode="decimal" placeholder="e.g. 4.00" value={s.duprMax}
                onChange={(e) => set("duprMax")(e.target.value)} className={field} />
            </label>
          </div>
          {(problemFor("duprMin") || problemFor("duprMax")) && (
            <p className="text-[11px] font-semibold text-rose-400">{problemFor("duprMin") ?? problemFor("duprMax")}</p>
          )}
          {/* Faisal, 2026-09-21: a player without a DUPR is in at the organiser's
              discretion. Only offered once there is a DUPR limit to apply it to —
              the server saves it off otherwise. */}
          {(s.duprMin.trim() !== "" || s.duprMax.trim() !== "") && (
            <label className="block space-y-1">
              <span className={label}>Players without a DUPR</span>
              <select name="duprStrict" value={s.duprStrict} onChange={(e) => set("duprStrict")(e.target.value)} className={field}>
                <option value="">Let them in, flagged for you</option>
                <option value="on">Keep them out (strict)</option>
              </select>
            </label>
          )}
        </>
      )}

      {sentence && problems.length === 0 && (
        <p data-rules-sentence className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs font-semibold text-amber-300">
          {sentence}
        </p>
      )}

      <div className="flex justify-end">
        <button disabled={pending} className="rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900 disabled:opacity-50">
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      {saved && (
        <p role="status" className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-2 text-[11px] text-neutral-400">
          {saved}
        </p>
      )}
    </form>
  );
}
