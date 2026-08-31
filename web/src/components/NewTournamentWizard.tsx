"use client";

/* Creating a tournament, as steps rather than one form.
 *
 * The old version was a name box, a sport DROPDOWN and three radios — which
 * hides eleven sports behind a control that shows one, and puts three dense
 * format explanations on screen at once whether or not they are relevant.
 *
 * Two things change:
 *   - sports and formats are CARDS, so the choice is visible rather than
 *     hidden behind a click;
 *   - the questions come in order, so each screen asks one thing.
 *
 * It stays ONE form and one Server Action, so the server side is unchanged.
 * Sport and format ride as hidden inputs; the name box is only mounted on its
 * own step, which is also the only step with a submit button — so a value can
 * never be submitted from a screen that is not showing it. */

import { useState } from "react";

export type SportOption = { id: string; name: string; emoji: string; formats: readonly string[] };

const FORMATS = [
  {
    id: "standard",
    name: "Standard",
    hint: "The sport's own scoring",
    detail:
      "Pickleball to 11 side-out, badminton to 21 rally, table tennis to 11. Whatever the sport normally does.",
  },
  {
    id: "pickleboss",
    name: "Pickleboss",
    hint: "To 15, groups on courts",
    detail:
      "To 15, win by 2, with the two-point rule stopping at 17 so the 18th point decides it. Groups on separate courts, ranked on wins then point difference.",
  },
  {
    id: "osl",
    name: "OSL team event",
    hint: "Six players, three pairs",
    detail:
      "Six players as three declared pairs, rotating when the leader reaches 7 and 14. First to 25, golden point at 24–24, ends change at 14.",
  },
] as const;

const STEPS = ["Sport", "Format", "Name"] as const;

export function NewTournamentWizard({
  sports,
  action,
  error,
}: {
  sports: SportOption[];
  action: (formData: FormData) => void;
  error?: boolean;
}) {
  const [step, setStep] = useState(0);
  const [sport, setSport] = useState("pb");
  const [format, setFormat] = useState("standard");
  const [name, setName] = useState("");

  const chosenSport = sports.find((s) => s.id === sport);
  const canAdvance = step === 0 ? !!sport : step === 1 ? !!format : name.trim().length >= 2;

  return (
    <form action={action} className="space-y-6">
      {/* Sport and format are card choices with no text input of their own, so
          they ride as hidden fields. The NAME is not mirrored here — the
          visible box carries `name="name"` itself, because two inputs with one
          value is exactly the kind of duplication that drifts. */}
      <input type="hidden" name="sport" value={sport} />
      <input type="hidden" name="format" value={format} />

      <ol className="flex items-center gap-2">
        {STEPS.map((label, i) => (
          <li key={label} className="flex flex-1 items-center gap-2">
            <button
              type="button"
              /* Going BACK is always allowed; going forward is not, so a
                 half-answered wizard cannot skip to the end. */
              onClick={() => i < step && setStep(i)}
              disabled={i > step}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[11px] font-black ${
                i < step ? "bg-amber-400 text-amber-950"
                : i === step ? "bg-neutral-100 text-neutral-900"
                : "border border-neutral-700 text-neutral-600"
              }`}
            >
              {i < step ? "✓" : i + 1}
            </button>
            <span className={`text-[11px] font-bold uppercase tracking-widest ${i === step ? "text-neutral-200" : "text-neutral-600"}`}>
              {label}
            </span>
            {i < STEPS.length - 1 && <span className="h-px flex-1 bg-neutral-800" />}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <fieldset>
          <legend className="mb-3 text-lg font-black">Which sport?</legend>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {sports.map((s) => (
              <button
                key={s.id}
                type="button"
                onClick={() => { setSport(s.id); setStep(1); }}
                aria-pressed={sport === s.id}
                className={`flex flex-col items-center gap-1 rounded-xl border p-4 transition ${
                  sport === s.id
                    ? "border-amber-400 bg-amber-400/10"
                    : "border-neutral-800 hover:border-neutral-600"
                }`}
              >
                <span className="text-2xl" aria-hidden>{s.emoji}</span>
                <span className="text-xs font-bold">{s.name}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {step === 1 && (
        <fieldset>
          <legend className="mb-1 text-lg font-black">How is it scored?</legend>
          <p className="mb-3 text-xs text-neutral-500">
            {chosenSport?.emoji} {chosenSport?.name}
          </p>
          <div className="space-y-2">
            {FORMATS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => { setFormat(f.id); setStep(2); }}
                aria-pressed={format === f.id}
                className={`block w-full rounded-xl border p-4 text-left transition ${
                  format === f.id ? "border-amber-400 bg-amber-400/10" : "border-neutral-800 hover:border-neutral-600"
                }`}
              >
                <span className="flex items-baseline gap-2">
                  <span className="text-sm font-black">{f.name}</span>
                  <span className="text-[11px] text-neutral-500">{f.hint}</span>
                </span>
                {/* The long explanation only for the one being considered —
                    three at once is what made the old page a wall. */}
                {format === f.id && (
                  <span className="mt-1 block text-xs leading-relaxed text-neutral-400">{f.detail}</span>
                )}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {step === 2 && (
        <fieldset>
          <legend className="mb-3 text-lg font-black">What is it called?</legend>
          <input
            autoFocus
            name="name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            minLength={2}
            maxLength={80}
            placeholder="Thursday Club Night"
            className="w-full rounded-xl border border-neutral-700 bg-neutral-950 p-4 text-base"
          />
          <p className="mt-2 text-xs text-neutral-500">
            Players will see this on the entry page. It becomes the public link too.
          </p>

          <dl className="mt-4 space-y-1 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3 text-xs">
            <Row label="Sport" value={`${chosenSport?.emoji} ${chosenSport?.name}`} />
            <Row label="Format" value={FORMATS.find((f) => f.id === format)?.name ?? ""} />
          </dl>
        </fieldset>
      )}

      {error && (
        <p role="alert" className="text-sm font-semibold text-rose-400">
          Check the name is 2–80 characters and try again.
        </p>
      )}

      <div className="flex gap-2">
        {step > 0 && (
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            className="rounded-xl border border-neutral-700 px-4 py-3 text-sm font-bold text-neutral-300"
          >
            Back
          </button>
        )}
        {step < STEPS.length - 1 ? (
          <button
            type="button"
            disabled={!canAdvance}
            onClick={() => setStep((s) => s + 1)}
            className="flex-1 rounded-xl bg-neutral-200 p-3 text-sm font-black text-neutral-900 disabled:opacity-40"
          >
            Next
          </button>
        ) : (
          <button
            type="submit"
            disabled={!canAdvance}
            className="flex-1 rounded-xl bg-amber-400 p-3 text-sm font-black text-amber-950 disabled:opacity-40"
          >
            Create tournament
          </button>
        )}
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-neutral-500">{label}</dt>
      <dd className="font-semibold text-neutral-200">{value}</dd>
    </div>
  );
}
