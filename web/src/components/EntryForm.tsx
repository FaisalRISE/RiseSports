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
 * what that costs instead of nagging. The one exception is a category with a
 * RATING limit, where the number is how the player's level is found; there it
 * is required, and the form says why.
 *
 * ── Category rules (2026-09-17) ──────────────────────────────────────────
 * A category may limit who enters: men, women or mixed, an age range, a rating
 * level, a DUPR range. The limits show as short tags on the category and one
 * plain sentence under the picker, BEFORE anything is typed. Date of birth,
 * DUPR and a required man/woman choice appear only when the chosen category
 * needs them — a category with no rules looks exactly as it always did.
 *
 * Everything shown here — the tags, the sentence, what each category needs — is
 * computed on the server and handed down as plain strings and flags. The rules
 * themselves never reach the browser, and the server checks every entry again,
 * which is what actually decides.
 *
 * ── Submitted with onSubmit, not `action` ────────────────────────────────
 * A function passed as a form's `action` makes React reset every field once it
 * finishes. For an accepted entry that is invisible — the form is replaced by a
 * receipt. For a REFUSED one it wiped out everything the player had typed, in
 * the very moment they were told what to fix. Submitting from onSubmit keeps
 * what they typed on screen next to the reason.
 */

import { useRef, useState, useTransition } from "react";
import type { FormField, Waiver } from "@/lib/db/schema";
import type { SubmitResult } from "@/app/e/[slug]/actions";

export type EntryNeeds = { gender: boolean; dob: boolean; dupr: boolean; duprRequired: boolean; phone: boolean };

export type EntryDivision = {
  id: string;
  name: string;
  description: string | null;
  /** The rules in one sentence, or null for a category with none. */
  summary: string | null;
  chips: string[];
  needs: EntryNeeds;
};

export type EntryFormProps = {
  slug: string;
  minTeamSize: number;
  maxTeamSize: number;
  divisions: EntryDivision[];
  formFields: FormField[];
  waivers: Waiver[];
  feeLabel: string;
  needsApproval: boolean;
  submit: (slug: string, formData: FormData) => Promise<SubmitResult>;
};

const NO_NEEDS: EntryNeeds = { gender: false, dob: false, dupr: false, duprRequired: false, phone: false };

export function EntryForm(props: EntryFormProps) {
  const { minTeamSize, maxTeamSize, divisions, formFields, waivers } = props;
  const [problems, setProblems] = useState<{ field: string; message: string }[]>([]);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();

  /* With one category there is no picker, and that category's rules apply. */
  const [divisionId, setDivisionId] = useState(divisions.length === 1 ? divisions[0].id : "");
  const division = divisions.find((d) => d.id === divisionId) ?? null;
  const needs = division?.needs ?? NO_NEEDS;

  /* ── One object per player row, with an identity React can follow ────────
     The rows used to be a COUNT, rendered `key={i}`, with name, phone, date of
     birth and DUPR left uncontrolled in the DOM. "Remove" on player 2 of 3
     dropped the count to 2, React unmounted the LAST child, and what vanished
     was player THREE's typing — player 2's stayed exactly where it was. The
     entrant deletes the wrong person and need not even notice, because a name
     is still sitting in the row they clicked. A stable `id` as the key makes
     React move each surviving row's own DOM node rather than renumber them, so
     an uncontrolled value goes where its row goes.
     `data-player` and the error keys stay POSITIONAL, because the server
     numbers players by their position in the submitted form.

     Man/woman rides on the row for the same reason — a parallel array came
     apart from the rows it described, so a row set to F, removed and added
     back came back showing F and still marked as chosen, which meant changing
     category could not reset it either. It is controlled so a category with a
     gender rule can start every row on "Choose…" rather than a silent "M" the
     entrant never looked at; an untouched row follows the category, a chosen
     one keeps its choice. */
  const [rows, setRows] = useState(() =>
    Array.from({ length: Math.max(1, minTeamSize) }, (_, id) => ({
      id, gender: needs.gender ? "" : "M", touched: false,
    })));
  const nextId = useRef(rows.length);
  const count = rows.length;

  const setGenderAt = (i: number, v: string) =>
    setRows((rs) => rs.map((r, j) => (j === i ? { ...r, gender: v, touched: true } : r)));

  const chooseDivision = (id: string) => {
    setDivisionId(id);
    const next = divisions.find((d) => d.id === id)?.needs ?? NO_NEEDS;
    setRows((rs) => rs.map((r) => (r.touched ? r : { ...r, gender: next.gender ? "" : "M" })));
  };

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
      onSubmit={(e) => {
        e.preventDefault();
        const fd = new FormData(e.currentTarget);
        start(async () => {
          const res = await props.submit(props.slug, fd);
          if (res.ok) setDone(res.reference);
          else setProblems(res.problems);
        });
      }}
      className="space-y-5"
    >
      {/* Anything not attached to a specific field — a closed window, a
          duplicate entry, a category someone does not fit — belongs at the top
          where it will be read. */}
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

      {/* Only when there is a real choice. Every event has at least one
          category behind the scenes, and asking a club night's entrants to pick
          from a list of one is a question with no information in it. */}
      {divisions.length > 1 && (
        <div>
          <label className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">Division</label>
          <select
            name="divisionId"
            value={divisionId}
            onChange={(e) => chooseDivision(e.target.value)}
            className="mt-1 w-full rounded-xl border border-neutral-700 bg-neutral-950 p-3 text-sm"
          >
            <option value="">Choose a division…</option>
            {divisions.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
                {d.chips.length ? ` · ${d.chips.join(" · ")}` : ""}
                {d.description ? ` — ${d.description}` : ""}
              </option>
            ))}
          </select>
          <FieldError message={errorFor("division")} />
        </div>
      )}

      {/* The rules, said before anybody types a thing. */}
      {division?.summary && (
        <div data-rules className="space-y-2">
          {divisions.length === 1 && division.chips.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {division.chips.map((c) => (
                <span key={c} className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-neutral-300">
                  {c}
                </span>
              ))}
            </div>
          )}
          <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-xs font-semibold leading-relaxed text-amber-300">
            {division.summary}
          </p>
          {divisions.length === 1 && <FieldError message={errorFor("division")} />}
        </div>
      )}

      <fieldset className="space-y-3">
        <legend className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">
          Players {minTeamSize === maxTeamSize ? `(${minTeamSize})` : `(${minTeamSize}–${maxTeamSize})`}
        </legend>

        {rows.map((row, i) => (
          <div key={row.id} data-player={i} className="rounded-xl border border-neutral-800 bg-neutral-900/50 p-3">
            <div className="mb-2 flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Player {i + 1}
              </span>
              {i >= minTeamSize && (
                <button
                  type="button"
                  /* THIS row goes — the one whose "remove" was pressed. */
                  onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))}
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
                value={row.gender}
                required={needs.gender && i < minTeamSize}
                onChange={(e) => setGenderAt(i, e.target.value)}
                aria-label={`Player ${i + 1} gender`}
                className="rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm"
              >
                {needs.gender && <option value="">Man or woman…</option>}
                <option value="M">M</option>
                <option value="F">F</option>
              </select>
            </div>

            {/* Only what this category needs. */}
            {(needs.dob || needs.dupr) && (
              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                {needs.dob && (
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Date of birth</span>
                    <input
                      name="playerDob"
                      type="date"
                      /* The floor the database keeps: a browser hands over
                         "0019-05-17" when two digits are typed into the year. */
                      min="1900-01-01"
                      required={i < minTeamSize}
                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm"
                    />
                  </label>
                )}
                {needs.dupr && (
                  <label className="block">
                    <span className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">DUPR</span>
                    <input
                      name="playerDupr"
                      inputMode="decimal"
                      /* Required only where the organiser made the category
                         strict. Otherwise a blank is allowed, and the organiser
                         sees "No DUPR" beside the name (Faisal, 2026-09-21). */
                      placeholder={needs.duprRequired ? "e.g. 3.75" : "e.g. 3.75, if you have one"}
                      required={needs.duprRequired && i < minTeamSize}
                      maxLength={5}
                      className="mt-1 w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm"
                    />
                  </label>
                )}
              </div>
            )}

            <input
              name="playerPhone"
              inputMode="tel"
              maxLength={32}
              required={needs.phone && i < minTeamSize}
              placeholder={needs.phone ? "Mobile number (needed)" : "Mobile number"}
              className="mt-2 w-full rounded-lg border border-neutral-800 bg-neutral-950 p-2.5 text-xs"
            />
            {needs.phone && i === 0 && (
              <p className="mt-1 text-[10px] leading-snug text-neutral-500">
                Needed for this category: it’s how we find each player’s rating.
              </p>
            )}

            {/* The reason for THIS player, under their name. */}
            <FieldError message={errorFor(`player:${i}`)} />
          </div>
        ))}

        <FieldError message={errorFor("players")} />

        {count < maxTeamSize && (
          <button
            type="button"
            onClick={() =>
              setRows((rs) => [...rs, { id: nextId.current++, gender: needs.gender ? "" : "M", touched: false }])}
            className="rounded-lg border border-neutral-700 px-3 py-2 text-xs font-bold text-neutral-300 hover:border-neutral-500"
          >
            + Add player
          </button>
        )}

        {/* Says what the number is for and what skipping it costs, rather than
            demanding it. */}
        {!needs.phone && (
          <p className="text-[11px] leading-relaxed text-neutral-500">
            A mobile number links each player to their RISE Rating, so it follows them from event to
            event. Leave it blank and the rating still works here — it just will not travel.
          </p>
        )}
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
