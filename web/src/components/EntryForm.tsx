"use client";

/* The entry form a player fills in.
 *
 * ── Why phone is asked for, and asked for plainly ────────────────────────
 * A phone number is what makes a RISE Rating follow someone between events. It
 * is the whole reason this page is worth building: the alternative is an
 * organiser typing every name and number by hand, which is where ratings
 * currently stop travelling.
 *
 * So the field says what it is for rather than just demanding it. It is
 * optional — a player who will not give one still gets in — and the form says
 * what that costs instead of nagging.
 *
 * No engine imports: this is a client component, and the validation it mirrors
 * runs again on the server, which is what actually decides. */

import { useState, useTransition } from "react";
import type { FormField, Waiver } from "@/lib/db/schema";
import type { SubmitResult } from "@/app/e/[slug]/actions";

export type EntryFormProps = {
  slug: string;
  minTeamSize: number;
  maxTeamSize: number;
  divisions: { id: string; name: string; description: string | null }[];
  formFields: FormField[];
  waivers: Waiver[];
  feeLabel: string;
  needsApproval: boolean;
  submit: (slug: string, formData: FormData) => Promise<SubmitResult>;
};

export function EntryForm(props: EntryFormProps) {
  const { minTeamSize, maxTeamSize, divisions, formFields, waivers } = props;
  const [count, setCount] = useState(Math.max(1, minTeamSize));
  const [problems, setProblems] = useState<{ field: string; message: string }[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const errorFor = (field: string) => problems.find((p) => p.field === field)?.message;

  if (done) {
    return (
      <div className="rounded-2xl border border-emerald-600/50 bg-emerald-500/10 p-6 text-center">
        <h2 className="text-lg font-black text-emerald-300">Entry received</h2>
        <p className="mt-2 text-sm text-neutral-300">
          {props.needsApproval
            ? "The organiser will review it and confirm your place."
            : "You are in — see you on court."}
        </p>
        <p className="mt-3 font-mono text-xs text-neutral-500">Reference {done}</p>
      </div>
    );
  }

  return (
    <form
      action={(fd) =>
        start(async () => {
          const res = await props.submit(props.slug, fd);
          if (res.ok) setDone(res.reference);
          else setProblems(res.problems);
        })
      }
      className="space-y-5"
    >
      {/* Anything not attached to a specific field — a closed window, a
          duplicate entry — belongs at the top where it will be read. */}
      {errorFor("form") && (
        <p role="alert" className="rounded-xl border border-rose-500 bg-rose-500/10 p-3 text-sm font-bold text-rose-300">
          {errorFor("form")}
        </p>
      )}

      <div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Team name</label>
        <input
          name="teamName"
          required
          maxLength={60}
          placeholder="The Smashers"
          className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
        />
        <FieldError message={errorFor("teamName")} />
      </div>

      {divisions.length > 0 && (
        <div>
          <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Division</label>
          <select
            name="divisionId"
            defaultValue=""
            className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
          >
            <option value="">Choose a division…</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}{d.description ? ` — ${d.description}` : ""}
              </option>
            ))}
          </select>
          <FieldError message={errorFor("division")} />
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">
          Players {minTeamSize === maxTeamSize ? `(${minTeamSize})` : `(${minTeamSize}–${maxTeamSize})`}
        </legend>

        {Array.from({ length: count }, (_, i) => (
          <div key={i} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Player {i + 1}
              </span>
              {i >= minTeamSize && (
                <button
                  type="button"
                  onClick={() => setCount((c) => c - 1)}
                  className="ml-auto text-[10px] font-bold text-neutral-500 hover:text-rose-400"
                >
                  remove
                </button>
              )}
            </div>
            <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
              <input
                name="playerName"
                required={i < minTeamSize}
                maxLength={80}
                placeholder="Full name"
                className="min-w-0 rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm"
              />
              <select
                name="playerGender"
                defaultValue="M"
                aria-label={`Player ${i + 1} gender`}
                className="rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm"
              >
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </div>
            <input
              name="playerPhone"
              inputMode="tel"
              maxLength={32}
              placeholder="Mobile number"
              className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs"
            />
          </div>
        ))}

        <FieldError message={errorFor("players")} />

        {count < maxTeamSize && (
          <button
            type="button"
            onClick={() => setCount((c) => c + 1)}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-300 hover:border-neutral-500"
          >
            + Add player
          </button>
        )}

        {/* Says what the number is for and what skipping it costs, rather than
            demanding it. */}
        <p className="text-[11px] leading-relaxed text-neutral-500">
          A mobile number links each player to their RISE Rating, so it follows them from event to
          event. Leave it blank and the rating still works here — it just will not travel.
        </p>
      </fieldset>

      {formFields.length > 0 && (
        <fieldset className="space-y-3">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">
            A few questions
          </legend>
          {formFields.map((f) => (
            <div key={f.id}>
              <label className="text-xs font-semibold text-neutral-300">
                {f.question}
                {f.required && <span className="text-rose-400"> *</span>}
              </label>
              {f.type === "choice" ? (
                <select
                  name={`field:${f.id}`}
                  defaultValue=""
                  className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
                >
                  <option value="">Choose…</option>
                  {(f.options ?? []).map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              ) : (
                <input
                  name={`field:${f.id}`}
                  inputMode={f.type === "number" ? "decimal" : "text"}
                  maxLength={500}
                  className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
                />
              )}
              <FieldError message={errorFor(`field:${f.id}`)} />
            </div>
          ))}
        </fieldset>
      )}

      {waivers.length > 0 && (
        <fieldset className="space-y-2">
          <legend className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Waivers</legend>
          {waivers.map((w) => (
            <div key={w.id} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
              <label className="flex items-start gap-2 text-xs">
                <input type="checkbox" name={`waiver:${w.id}`} className="mt-0.5" />
                <span>
                  <span className="font-bold text-neutral-200">{w.title}</span>
                  <span className="mt-1 block leading-relaxed text-neutral-400">{w.body}</span>
                </span>
              </label>
              <FieldError message={errorFor(`waiver:${w.id}`)} />
            </div>
          ))}
        </fieldset>
      )}

      <div>
        <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">
          Email (optional)
        </label>
        <input
          name="contactEmail"
          type="email"
          maxLength={120}
          placeholder="So the organiser can reach you"
          className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
        />
      </div>

      <button
        type="submit"
        disabled={pending}
        className="w-full rounded-xl bg-amber-400 p-4 text-sm font-black text-amber-950 hover:bg-amber-300 disabled:opacity-60"
      >
        {pending ? "Sending…" : props.feeLabel === "Free" ? "Enter this event" : `Enter — ${props.feeLabel}`}
      </button>

      {/* Said before they commit, not after. */}
      <p className="text-center text-[11px] text-neutral-500">
        {props.needsApproval ? "The organiser reviews every entry before it is confirmed." : ""}
        {props.feeLabel !== "Free" && " Payment is arranged with the organiser directly."}
      </p>
    </form>
  );
}

function FieldError({ message }: { message?: string }) {
  if (!message) return null;
  return <p className="mt-1 text-[11px] font-semibold text-rose-400">{message}</p>;
}
