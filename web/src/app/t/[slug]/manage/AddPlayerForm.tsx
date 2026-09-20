"use client";

/* Adding a player to a team, on the manage screen.
 *
 * It was a plain server form, and could say nothing: a bad name returned
 * silently and there was nothing else to report. Category rules (2026-09-17)
 * gave it something to say. Faisal chose what happens when an organiser adds a
 * player who does not fit: be STOPPED with the reason, and be able to let them
 * in anyway with one tick — and the team then shows that he did.
 *
 * ── Kept exactly, because five e2e suites drive it ───────────────────────
 * Rendered inside the team's `[data-team]` card, as a `form` holding
 * `input[placeholder="Player name"]`, `select[name="gender"]`, the phone, DUPR
 * and starting-level inputs, the roster picker, and a button labelled "Add".
 * In a category with no gender rule the gender starts on M, as it always did.
 *
 * ── onSubmit AND `action`, which is not a belt-and-braces mistake ────────
 * The work is done in `onSubmit`, because a function `action` makes React clear
 * every field when it returns — after a refusal that empties the very form the
 * organiser is being asked to tick "add anyway" on.
 *
 * `action` is still the Server Action, for the seconds before React hydrates.
 * This was a plain server form; a tap in that window used to add the player.
 * With only `onSubmit` the browser instead did a GET of the manage page with
 * the fields in the query string: nothing added, nothing said. React checks
 * `defaultPrevented` before running a form action, so once hydrated the
 * `preventDefault` below is what stops it — there is never a double add.
 */

import { useRef, useState, useTransition } from "react";
import type { AddPlayerResult } from "./actions";
import { PersonPicker, type PickerResult } from "@/components/PersonPicker";

export function AddPlayerForm({
  add, search, needs, hasGenderRule, seedBands,
}: {
  add: (formData: FormData) => Promise<AddPlayerResult>;
  search: (q: string) => Promise<PickerResult[]>;
  /** What this team's category needs to judge a player. */
  needs: { dob: boolean; dupr: boolean };
  hasGenderRule: boolean;
  seedBands: readonly { label: string; seed: number }[];
}) {
  const formRef = useRef<HTMLFormElement>(null);
  const [result, setResult] = useState<AddPlayerResult | null>(null);
  const [pickerKey, setPickerKey] = useState(0);
  const [pending, start] = useTransition();

  const refused = result && !result.ok ? result : null;

  return (
    <form
      ref={formRef}
      /* The cast is only about the RETURN value: React types a form action as
         answering with nothing, and this one answers with a refusal we read
         when there is JavaScript to read it with. The reference itself must
         stay the Server Action or the pre-hydration post has nowhere to go. */
      action={add as unknown as (formData: FormData) => void}
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await add(fd);
          setResult(res);
          if (res.ok) {
            formRef.current?.reset();
            setPickerKey((k) => k + 1);
          }
        });
      }}
      className="space-y-2"
    >
      <div className="flex gap-2">
        <input name="name" required placeholder="Player name"
          className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm" />
        <select name="gender" defaultValue={hasGenderRule ? "" : "M"} required={hasGenderRule}
          className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-1.5 text-sm">
          {hasGenderRule && <option value="">Choose…</option>}
          <option value="M">M</option>
          <option value="F">F</option>
        </select>
        <button disabled={pending} className="rounded-lg border border-neutral-600 px-3 text-xs font-bold disabled:opacity-50">
          Add
        </button>
      </div>

      {/* Reuse an existing player when their number is not to hand. Phone
          stays the only automatic match; this is the deliberate,
          organiser-confirmed one. */}
      <PersonPicker key={pickerKey} search={search} />

      <div className="flex flex-wrap gap-2">
        <input name="phone" inputMode="tel" placeholder="Phone (optional)"
          className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-1.5 text-xs" />
        {/* NOT `required`, even where the category has a DUPR limit. The
            browser would refuse to submit at all, so the organiser would never
            see the reason and never see the "add anyway" tick — the one path
            Faisal asked for. The server refuses it instead, with both. */}
        <input name="dupr" inputMode="decimal" placeholder={needs.dupr ? "DUPR (needed)" : "DUPR"}
          className="w-24 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs" />
        <select name="band" defaultValue=""
          className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs">
          <option value="">Starting level…</option>
          {seedBands.map((b) => (
            <option key={b.seed} value={b.seed}>{b.label}</option>
          ))}
        </select>
      </div>

      {needs.dob && (
        <label className="flex items-center gap-2 text-xs text-neutral-400">
          <span className="shrink-0 font-bold">Date of birth</span>
          {/* The same floor the database keeps, so a year typed as two digits
              is caught by the browser rather than by a CHECK. */}
          <input name="dob" type="date" min="1900-01-01"
            className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-xs" />
        </label>
      )}

      {refused?.message && (
        <p className="text-[11px] font-semibold text-rose-400">{refused.message}</p>
      )}

      {/* Stopped, with the reason — and the choice to let them in anyway. */}
      {refused?.reasons && (
        <div className="space-y-1.5">
          <p role="alert" className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-2 text-[11px] font-semibold text-rose-300">
            Doesn’t fit this category: {refused.reasons.join(" · ")}
          </p>
          {refused.canWaive && (
            <label className="flex items-start gap-2 text-[11px] text-neutral-300">
              <input type="checkbox" name="waive" className="mt-0.5" />
              <span>
                <b>Add anyway</b>, I’m choosing to let this player in. The team will show it.
              </span>
            </label>
          )}
        </div>
      )}

      {result?.ok && result.notes.length > 0 && (
        <p className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-2 text-[11px] text-neutral-500">
          Added. {result.notes.join(" · ")}
        </p>
      )}

      <p className="text-[10px] leading-snug text-neutral-600">
        No phone: their rating works here but will not follow them to another event.
      </p>
    </form>
  );
}
