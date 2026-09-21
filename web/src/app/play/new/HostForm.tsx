"use client";

/* Host a game.
 *
 * The legacy form (app.source.js:9438-9994) is six stacked sections ending in a
 * sentence that restates the whole configuration before you commit — "Runs on
 * Tue, Thu · 20:00–22:00 · 2 courts × 4 = 8 spots · …". That sentence is the
 * most valuable part of the screen and is kept: a host who has mis-set courts
 * or picked the wrong days finds out here rather than when eight people turn up
 * to four spots.
 *
 * It is built from local state rather than imported from lib/community, on
 * purpose — this is a Client Component, and every module under lib/ carries
 * `import "server-only"` so the engines cannot reach the browser. Restating
 * labels is not engine work, so it costs nothing to do it here.
 */

import { useState } from "react";
import { createCommunityGame } from "../actions";

const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const ROTATIONS = [
  ["fixed", "Same players all session", "Whoever is confirmed plays the whole time."],
  ["rotate", "Reshuffle at half time", "Two halves, with partners redrawn for the second."],
  ["slots", "Reserve per 30 min", "People book half-hour slots instead of the whole session."],
  ["kotc", "King of the Court", "Winners climb towards the King court, losers drop."],
  ["ladder", "Ladder league", "A standing order; beat someone above you and take their place."],
] as const;

const SCHEDULES = [
  ["random", "Random", "Draw partners and opponents out of a hat."],
  ["balanced", "Balanced by rating", "Even up the courts so games are close."],
  ["americano", "Americano", "Everyone partners everyone in turn."],
  ["mexicano", "Mexicano", "Each round is matched on how you are doing."],
] as const;

export function HostForm({ sports, error, defaultDay }: {
  sports: { id: string; name: string; emoji: string }[];
  error?: string;
  /** Today's weekday in India, worked out on the server. Read here with
      `new Date()` it was the SERVER's day while rendering (UTC, still
      yesterday until 05:30 in India) and the phone's once running. */
  defaultDay: number;
}) {
  const [name, setName] = useState("");
  const [freq, setFreq] = useState<"daily" | "weekly">("weekly");
  const [days, setDays] = useState<number[]>([defaultDay]);
  const [startTime, setStartTime] = useState("20:00");
  const [endTime, setEndTime] = useState("22:00");
  const [courts, setCourts] = useState(2);
  const [perCourt, setPerCourt] = useState(4);
  const [rotation, setRotation] = useState<string>("fixed");
  const [scheduleMode, setScheduleMode] = useState<string>("random");
  const [accessType, setAccessType] = useState<string>("open");
  const [price, setPrice] = useState("");
  const [limitsOpen, setLimitsOpen] = useState(false);
  /* Held here, not left to the inputs, so the cut-off date can appear the
     moment an age limit is typed — and so all three survive hiding the limits. */
  const [ages, setAges] = useState<[string, string]>(["", ""]);
  const [ageOn, setAgeOn] = useState("");
  const hasAge = ages[0].trim() !== "" || ages[1].trim() !== "";

  const toggleDay = (d: number) =>
    setDays((cur) => (cur.includes(d) ? cur.filter((x) => x !== d) : [...cur, d].sort((a, b) => a - b)));

  const spots = courts * perCourt;
  const when = freq === "daily" ? "Every day" : days.length ? days.map((d) => DAYS[d]).join(", ") : "No days chosen";
  const rotationLabel = ROTATIONS.find((r) => r[0] === rotation)?.[1] ?? "";
  const scheduleLabel = SCHEDULES.find((s) => s[0] === scheduleMode)?.[1] ?? "";
  const priceLabel = Number(price) > 0 ? `₹${Number(price).toLocaleString("en-IN")} per player` : "Free";

  return (
    <form action={createCommunityGame} className="space-y-5">
      {error && (
        <p className="rounded-xl border border-rose-500 bg-rose-500/10 p-3 text-sm font-bold text-rose-300">
          {error}
        </p>
      )}

      {/* ── Basics ─────────────────────────────────────────────────────── */}
      <Section title="The basics">
        <Field label="Game name">
          <input
            name="name" value={name} onChange={(e) => setName(e.target.value)}
            required minLength={2} maxLength={80}
            placeholder="Thursday Night Pickleball"
            className={input}
          />
        </Field>

        <Field label="Sport">
          <select name="sport" defaultValue="pb" className={input}>
            {sports.map((s) => (
              <option key={s.id} value={s.id}>{s.emoji} {s.name}</option>
            ))}
          </select>
        </Field>

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Venue">
            <input name="venue" placeholder="Smash Arena" maxLength={80} className={input} />
          </Field>
          <Field label="Area">
            <input name="area" placeholder="Bandra" maxLength={80} className={input} />
          </Field>
        </div>

        <Field label="How often">
          <div className="flex gap-2">
            {(["weekly", "daily"] as const).map((f) => (
              <button
                key={f} type="button" onClick={() => setFreq(f)}
                aria-pressed={freq === f}
                className={pill(freq === f)}
              >
                {f === "weekly" ? "Chosen days" : "Every day"}
              </button>
            ))}
          </div>
          <input type="hidden" name="freq" value={freq} />
        </Field>

        {freq === "weekly" && (
          <Field label="Which days">
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((label, d) => (
                <button
                  key={d} type="button" onClick={() => toggleDay(d)}
                  aria-pressed={days.includes(d)}
                  className={`w-12 rounded-lg border px-0 py-1.5 text-xs font-bold ${
                    days.includes(d)
                      ? "border-amber-400 bg-amber-400 text-amber-950"
                      : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            {days.map((d) => (
              <input key={d} type="hidden" name="days" value={d} />
            ))}
          </Field>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Starts">
            <input type="time" name="startTime" value={startTime}
              onChange={(e) => setStartTime(e.target.value)} required className={input} />
          </Field>
          <Field label="Ends">
            <input type="time" name="endTime" value={endTime}
              onChange={(e) => setEndTime(e.target.value)} required className={input} />
          </Field>
        </div>
      </Section>

      {/* ── Capacity ───────────────────────────────────────────────────── */}
      <Section title="How many can play">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Courts booked">
            <Stepper value={courts} min={1} max={10} onChange={setCourts} name="courts" />
          </Field>
          <Field label={`Players per court${perCourt === 2 ? " (singles)" : perCourt === 4 ? " (doubles)" : ""}`}>
            <Stepper value={perCourt} min={1} max={10} onChange={setPerCourt} name="perCourt" />
          </Field>
        </div>
        <p className="text-sm text-neutral-400">
          That is <b className="text-neutral-200">{spots} spots</b> a session.
        </p>
      </Section>

      {/* ── How the session runs ───────────────────────────────────────── */}
      <Section title="How the session runs">
        <Choices name="rotation" options={ROTATIONS} value={rotation} onChange={setRotation} />
      </Section>

      <Section title="How matches are made">
        <Choices name="scheduleMode" options={SCHEDULES} value={scheduleMode} onChange={setScheduleMode} />
      </Section>

      {/* ── Access and price ───────────────────────────────────────────── */}
      <Section title="Who can join, and what it costs">
        <Choices
          name="accessType"
          value={accessType}
          onChange={setAccessType}
          options={[
            ["open", "Open", "Anyone who meets the limits below can ask for a spot."],
            ["restricted", "Invite only", "You approve members; only they see the dates."],
          ] as const}
        />
        <Field label="Price per player (₹)">
          <input
            name="price" value={price} onChange={(e) => setPrice(e.target.value)}
            inputMode="decimal" placeholder="0" className={input}
          />
        </Field>
      </Section>

      {/* ── Optional limits ────────────────────────────────────────────── */}
      <Section title="Limit who can join">
        <button
          type="button" onClick={() => setLimitsOpen((v) => !v)}
          aria-expanded={limitsOpen}
          className="text-sm font-bold text-amber-400"
        >
          {limitsOpen ? "− Hide limits" : "+ Add limits (optional)"}
        </button>

        {limitsOpen && (
          <div className="space-y-3 border-l-2 border-neutral-800 pl-3">
            <p className="text-xs text-neutral-500">
              Leave anything blank for no limit. Someone who does not meet a limit is told
              exactly which one, rather than just being refused.
            </p>
            <Pair label="Rating" a="gsrMin" b="gsrMax" aPlace="600" bPlace="900" />
            <Pair label="DUPR" a="duprMin" b="duprMax" aPlace="3.00" bPlace="4.50" />
            {/* Faisal, 2026-09-21: a player without a DUPR is let in at the
                host's discretion, and flagged; strict keeps them out. It only
                means anything beside a DUPR limit, and is saved off without one. */}
            <Field label="Players without a DUPR">
              <select name="duprStrict" defaultValue="" className={input}>
                <option value="">Let them in, flagged for you</option>
                <option value="on">Keep them out (strict)</option>
              </select>
              <span className="block text-[11px] text-neutral-500">Only matters if you set a DUPR limit.</span>
            </Field>
            <Pair label="Age" a="ageMin" b="ageMax" aPlace="18" bPlace="45" value={ages} onChange={setAges} />
            {/* Faisal, 2026-09-21: the host sets the cut-off. `required` here is
                the host's own setting, not a fact about a player, so the browser
                may insist on it — and it saves the host from the server's refusal,
                which sends the form back empty. */}
            {hasAge && (
              <Field label="Age counted on">
                <input
                  type="date" name="ageOn" required min="1900-01-01"
                  value={ageOn} onChange={(e) => setAgeOn(e.target.value)} className={input}
                />
                <span className="block text-[11px] text-neutral-500">
                  The cut-off date. A player&apos;s age on this day is what counts, for every session.
                </span>
              </Field>
            )}
            <Field label="Gender">
              <select name="gender" defaultValue="any" className={input}>
                <option value="any">Anyone</option>
                <option value="M">Men only</option>
                <option value="F">Women only</option>
              </select>
            </Field>
          </div>
        )}
      </Section>

      {/* ── The sentence that catches the mistake ──────────────────────── */}
      <div className="rounded-xl border border-amber-400/40 bg-amber-400/5 p-4">
        <p className="text-[10px] font-bold uppercase tracking-widest text-amber-400">Before you create it</p>
        <p className="mt-1.5 text-sm leading-relaxed">
          <b>{name.trim() || "Your game"}</b> runs <b>{when}</b>, <b>{startTime}–{endTime}</b>, on{" "}
          <b>{courts} court{courts === 1 ? "" : "s"} × {perCourt}</b> = <b>{spots} spots</b>.{" "}
          {rotationLabel}. {scheduleLabel} pairings. <b>{priceLabel}</b>.{" "}
          {accessType === "restricted" ? "Invite only." : "Open to anyone eligible."}
        </p>
      </div>

      <button
        type="submit"
        className="w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-amber-950"
      >
        Create game
      </button>
    </form>
  );
}

/* ── Small pieces ─────────────────────────────────────────────────────────*/

const input =
  "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm text-neutral-200";

const pill = (on: boolean) =>
  `rounded-lg border px-3 py-1.5 text-xs font-bold ${
    on ? "border-amber-400 bg-amber-400 text-amber-950" : "border-neutral-700 text-neutral-400 hover:border-neutral-500"
  }`;

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
      <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-bold text-neutral-400">{label}</span>
      {children}
    </label>
  );
}

function Stepper({
  value, min, max, onChange, name,
}: { value: number; min: number; max: number; onChange: (n: number) => void; name: string }) {
  const step = (d: number) => onChange(Math.min(max, Math.max(min, value + d)));
  return (
    <div className="flex items-center gap-2">
      <button type="button" onClick={() => step(-1)} aria-label={`One fewer ${name}`}
        className="h-9 w-9 rounded-lg border border-neutral-700 text-lg font-bold text-neutral-300">−</button>
      <span className="w-10 text-center text-lg font-black tabular-nums">{value}</span>
      <button type="button" onClick={() => step(1)} aria-label={`One more ${name}`}
        className="h-9 w-9 rounded-lg border border-neutral-700 text-lg font-bold text-neutral-300">+</button>
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

function Choices({
  name, options, value, onChange,
}: {
  name: string;
  options: readonly (readonly [string, string, string])[];
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <div className="space-y-1.5">
      {options.map(([id, label, hint]) => (
        <button
          key={id} type="button" onClick={() => onChange(id)}
          aria-pressed={value === id}
          className={`block w-full rounded-lg border p-3 text-left ${
            value === id ? "border-amber-400 bg-amber-400/10" : "border-neutral-800 hover:border-neutral-600"
          }`}
        >
          <span className="block text-sm font-bold">{label}</span>
          <span className="block text-xs text-neutral-400">{hint}</span>
        </button>
      ))}
      <input type="hidden" name={name} value={value} />
    </div>
  );
}

/** Two bounds. Left to the inputs unless `value` is given, when the caller
    holds them — the age pair does, to know when to ask for a cut-off date. */
function Pair({
  label, a, b, aPlace, bPlace, value, onChange,
}: {
  label: string; a: string; b: string; aPlace: string; bPlace: string;
  value?: [string, string]; onChange?: (v: [string, string]) => void;
}) {
  const held = (i: 0 | 1) =>
    value && onChange
      ? {
          value: value[i],
          onChange: (e: React.ChangeEvent<HTMLInputElement>) =>
            onChange(i === 0 ? [e.target.value, value[1]] : [value[0], e.target.value]),
        }
      : {};
  return (
    <div className="space-y-1">
      <span className="text-xs font-bold text-neutral-400">{label}</span>
      <div className="flex items-center gap-2">
        <input name={a} placeholder={aPlace} inputMode="decimal" aria-label={`${label} minimum`} className={input} {...held(0)} />
        <span className="text-xs text-neutral-500">to</span>
        <input name={b} placeholder={bPlace} inputMode="decimal" aria-label={`${label} maximum`} className={input} {...held(1)} />
      </div>
    </div>
  );
}
