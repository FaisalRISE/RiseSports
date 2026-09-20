import { notFound } from "next/navigation";
import Link from "next/link";
import { inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { registrationPlayers } from "@/lib/db/schema";
import { principalFor } from "@/lib/auth/guard";
import { canManage } from "@/lib/auth/policy";
import { entrantEvidence, entryWindow } from "@/lib/registration";
import { maskPhone, normalisePhone, peopleByPhones } from "@/lib/people";
import { entryFailures, hasRules, rulesOfDivision } from "@/lib/eligibility";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";
import { EntryDecisions } from "@/components/EntryDecisions";
import {
  loadRegistrationTab, saveRegistrationSettings, setStatus,
  addDivision, removeDivision, addFormField, removeFormField, addWaiver, removeWaiver,
  approveEntry, declineEntry, markPayment,
} from "./actions";

/* The organiser's registration screen: configure the public page, then decide
 * on what comes in. Laid out as titled cards rather than one long form, which
 * is the structural complaint that started this work. */
export const dynamic = "force-dynamic";

const statusLabel = {
  draft: "Draft — nobody can see it",
  open: "Open — the public link takes entries",
  live: "Live — play has started, entries closed",
  finished: "Finished",
} as const;

export default async function RegistrationPage({
  params, searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ problem?: string }>;
}) {
  const { slug } = await params;
  const { problem } = await searchParams;
  const data = await loadRegistrationTab(slug);
  if (!data) notFound();
  const { tournament: t, divisions: divs, entries } = data;
  if (!canManage(await principalFor(t.id))) notFound();

  const people = entries.length
    ? await db.select().from(registrationPlayers).where(inArray(registrationPlayers.registrationId, entries.map((e) => e.id)))
    : [];
  const playersOf = (id: string) =>
    people.filter((p) => p.registrationId === id).sort((a, b) => a.position - b.position);

  /* ── Does each waiting entry still fit its category? ───────────────────
     Said on the list, so the organiser sees it BEFORE pressing Approve rather
     than only in the refusal after. Every waiting entrant's person is found in
     ONE query, not one per entry: a query per entry is a fan-out that grows
     with the list (lib/db/index.ts). Same evidence and same verdict approval
     will reach — `approveRegistration` builds it the same way. */
  const pending = entries.filter((e) => e.status === "pending");
  const known = await peopleByPhones(pending.flatMap((e) => playersOf(e.id).map((p) => p.phone)));
  const divisionOf = new Map(divs.map((d) => [d.id, d]));
  const fitOf = new Map(
    pending.map((e) => {
      const d = e.divisionId ? divisionOf.get(e.divisionId) : divs.length === 1 ? divs[0] : undefined;
      const r = d ? rulesOfDivision(d) : null;
      if (!r || !hasRules(r)) return [e.id, { reasons: [] as string[], notes: [] as string[] }];
      const squad = playersOf(e.id);
      const verdict = entryFailures(
        entrantEvidence(squad, known, t.sport, normalisePhone),
        r,
        { complete: true, minTeamSize: t.minTeamSize, dated: true },
      );
      return [e.id, {
        reasons: [
          ...verdict.players.flatMap((fs, i) =>
            fs.filter((f) => f.severity === "block").map((f) => `${squad[i].name} (${f.text})`)),
          ...verdict.team.filter((f) => f.severity === "block").map((f) => f.text),
        ],
        /* Notes never block; they are what the organiser should look at before
           pressing Approve. "Unrated" is worded for that moment; the rest —
           a date of birth or a DUPR that disagrees with the record on file —
           are already sentences. */
        notes: verdict.players.flatMap((fs, i) =>
          fs.filter((f) => f.severity === "note").map((f) =>
            f.code.startsWith("rating:max")
              ? `${squad[i].name} is unrated. Check their level before approving.`
              : `${squad[i].name}: ${f.text}.`)),
      }];
    }),
  );

  /* A code from the settings form, turned into words HERE from the database —
     never a sentence carried in the URL, which anyone could craft. */
  const mixedName = divs.find((d) => d.genderRule === "MX")?.name;
  const settingsProblem =
    problem === "mixed-team-size" && mixedName
      ? `${mixedName} is Mixed and needs teams of at least two. Change that category's rules first, or keep team size at 2 or more.`
      : null;

  const approved = entries.filter((e) => e.status === "approved");
  const window = entryWindow(t);
  const publicUrl = `/e/${t.slug}`;

  const dt = (d: Date | null) => (d ? new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "");

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <header>
          <Link href={`/t/${slug}/manage`} className="text-xs font-bold text-neutral-400 hover:underline">
            ← {t.name}
          </Link>
          <h1 className="mt-2 text-2xl font-black">Registration</h1>
        </header>

        {/* ── Lifecycle ─────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-neutral-400">Status</h2>
          <p className="mt-1 text-sm font-bold">{statusLabel[t.status]}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            {(["draft", "open", "live", "finished"] as const).map((s) => (
              <form key={s} action={setStatus.bind(null, t.id, s)}>
                <button
                  disabled={t.status === s}
                  className={`rounded-lg px-3 py-2 text-xs font-black ${
                    t.status === s
                      ? "bg-neutral-200 text-neutral-900"
                      : "border border-neutral-700 text-neutral-300 hover:border-neutral-500"
                  }`}
                >
                  {s === "draft" ? "Draft" : s === "open" ? "Open entries" : s === "live" ? "Go live" : "Finish"}
                </button>
              </form>
            ))}
          </div>
        </section>

        {/* ── The link ──────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-neutral-400">Public link</h2>
          <p className="mt-2 break-all rounded-lg bg-neutral-950 p-3 font-mono text-xs text-amber-300">{publicUrl}</p>
          <p className="mt-2 text-[11px] text-neutral-500">
            {window.open ? "Taking entries now." : window.reason} Share this with players — it is the only
            page they need.
          </p>
          <Link href={publicUrl} className="mt-2 inline-block text-xs font-bold text-amber-400 underline">
            Open it →
          </Link>
        </section>

        {/* ── Entries ───────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-neutral-400">
            Entries · {pending.length} pending · {approved.length} approved
          </h2>

          {entries.length === 0 ? (
            <p className="mt-3 rounded-lg border border-dashed border-neutral-800 p-6 text-center text-xs text-neutral-500">
              Nothing yet. Entries appear here as they come in.
            </p>
          ) : (
            <ol className="mt-3 space-y-2">
              {entries.map((e) => {
                const squad = playersOf(e.id);
                return (
                  <li key={e.id} className="rounded-lg border border-neutral-800 bg-neutral-950 p-3">
                    <div className="flex flex-wrap items-baseline gap-2">
                      <span className="font-bold">{e.teamName}</span>
                      {/* Which category — the thing its rules are judged against. */}
                      {divs.length > 1 && (
                        <span className="rounded-full border border-neutral-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-widest text-neutral-400">
                          {(e.divisionId && divisionOf.get(e.divisionId)?.name) || "No category"}
                        </span>
                      )}
                      <span
                        className={`rounded px-1.5 text-[10px] font-black uppercase ${
                          e.status === "approved" ? "bg-emerald-500/20 text-emerald-300"
                          : e.status === "pending" ? "bg-amber-500/20 text-amber-300"
                          : "bg-neutral-700 text-neutral-300"
                        }`}
                      >
                        {e.status}
                      </span>
                      {t.entryFee > 0 && (
                        <span
                          className={`rounded px-1.5 text-[10px] font-black uppercase ${
                            e.paymentState === "paid" ? "bg-emerald-500/20 text-emerald-300"
                            : e.paymentState === "waived" ? "bg-neutral-700 text-neutral-300"
                            : "bg-rose-500/20 text-rose-300"
                          }`}
                        >
                          {e.paymentState}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-neutral-600">
                        {e.createdAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}
                      </span>
                    </div>

                    {/* Names in full; numbers masked. The organiser needs to know
                        a number is on file, not to read it off a screen. Man or
                        woman per player, because category rules turn on it. */}
                    <ul className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-neutral-400">
                      {squad.map((p) => (
                        <li key={p.id} className="flex items-center gap-1.5">
                          <span>{p.name}</span>
                          <span className={`rounded px-1 text-[10px] font-bold ${p.gender === "F" ? "bg-violet-500/20 text-violet-300" : "bg-blue-500/20 text-blue-300"}`}>
                            {p.gender}
                          </span>
                          <span className="font-mono text-[10px] text-neutral-600">{p.phone ? maskPhone(p.phone) : "no phone"}</span>
                        </li>
                      ))}
                    </ul>

                    {(() => {
                      const fit = fitOf.get(e.id);
                      if (!fit || (fit.reasons.length === 0 && fit.notes.length === 0)) return null;
                      return (
                        <div className="mt-2 space-y-1" data-entry-fit>
                          {fit.reasons.length > 0 && (
                            <p className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-2 text-[11px] font-semibold text-rose-300">
                              Doesn’t fit current rules: {fit.reasons.join(" · ")}
                            </p>
                          )}
                          {fit.notes.map((n) => (
                            <p key={n} className="rounded-lg border border-neutral-800 bg-neutral-900/60 p-2 text-[11px] text-neutral-500">{n}</p>
                          ))}
                        </div>
                      );
                    })()}

                    {Object.keys(e.answers ?? {}).length > 0 && (
                      <p className="mt-1 text-[11px] text-neutral-500">
                        {(t.formFields ?? [])
                          .filter((f) => e.answers?.[f.id])
                          .map((f) => `${f.question}: ${e.answers[f.id]}`)
                          .join(" · ")}
                      </p>
                    )}

                    <EntryDecisions
                      tournamentId={t.id}
                      registrationId={e.id}
                      status={e.status}
                      paymentState={e.paymentState}
                      hasFee={t.entryFee > 0}
                      approve={approveEntry}
                      decline={declineEntry}
                      markPaid={markPayment}
                    />
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* ── Settings ──────────────────────────────────────────────────── */}
        <form action={saveRegistrationSettings.bind(null, t.id)} className="space-y-4 rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-neutral-400">The public page</h2>

          {settingsProblem && (
            <p role="alert" className="rounded-lg border border-rose-500/50 bg-rose-500/10 p-3 text-xs font-semibold text-rose-300">
              Not saved. {settingsProblem}
            </p>
          )}

          <Field label="About">
            <textarea name="about" defaultValue={t.about ?? ""} rows={3} maxLength={1000}
              placeholder="What players should know before entering"
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-3 text-sm" />
          </Field>

          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Venue">
              <input name="venue" defaultValue={t.venue ?? ""} maxLength={120}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm" />
            </Field>
            <Field label="Entry fee (₹)" hint="0 for a free event">
              <input name="entryFee" inputMode="decimal" defaultValue={t.entryFee ? String(t.entryFee / 100) : "0"}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm" />
            </Field>
            <Field label="Entries open">
              <input type="datetime-local" name="opensAt" defaultValue={dt(t.registrationOpensAt)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm" />
            </Field>
            <Field label="Entries close">
              <input type="datetime-local" name="closesAt" defaultValue={dt(t.registrationClosesAt)}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm" />
            </Field>
            <Field label="Min players per team">
              <input type="number" name="minTeamSize" min={1} max={12} defaultValue={t.minTeamSize}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm" />
            </Field>
            <Field label="Max players per team">
              <input type="number" name="maxTeamSize" min={1} max={12} defaultValue={t.maxTeamSize}
                className="w-full rounded-lg border border-neutral-700 bg-neutral-950 p-2.5 text-sm" />
            </Field>
          </div>

          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" name="hideEntrants" defaultChecked={t.hideEntrants} />
            Hide the entrant list on the public page
          </label>

          <button className="rounded-lg bg-neutral-200 px-4 py-2 text-xs font-black text-neutral-900">Save</button>
        </form>

        {/* ── Divisions ─────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-neutral-400">Divisions</h2>
          <p className="mt-1 text-[11px] text-neutral-500">Optional. Registrants pick one when entering.</p>
          {divs.length > 0 && (
            <ul className="mt-3 space-y-1">
              {divs.map((d) => (
                <li key={d.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">
                    {d.name}
                    {d.description && <span className="text-neutral-500"> — {d.description}</span>}
                  </span>
                  <form action={removeDivision.bind(null, t.id, d.id)}>
                    <button className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addDivision.bind(null, t.id)} className="mt-3 flex flex-wrap gap-2">
            <input name="name" required placeholder="Advanced" maxLength={60}
              className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            <input name="description" placeholder="3.5+ (optional)" maxLength={120}
              className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs" />
            <button className="rounded-lg border border-neutral-600 px-3 text-xs font-bold">Add</button>
          </form>
        </section>

        {/* ── Extra questions ───────────────────────────────────────────── */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-neutral-400">Extra questions</h2>
          <p className="mt-1 text-[11px] text-neutral-500">Name and phone are always asked. These are yours.</p>
          {(t.formFields ?? []).length > 0 && (
            <ul className="mt-3 space-y-1">
              {(t.formFields ?? []).map((f) => (
                <li key={f.id} className="flex items-center gap-2 text-sm">
                  <span className="flex-1 truncate">
                    {f.question}
                    <span className="text-neutral-500"> · {f.type}{f.required ? " · required" : ""}</span>
                  </span>
                  <form action={removeFormField.bind(null, t.id, f.id)}>
                    <button className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addFormField.bind(null, t.id)} className="mt-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <input name="question" required placeholder="Shirt size" maxLength={120}
                className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
              <select name="type" defaultValue="text"
                className="rounded-lg border border-neutral-700 bg-neutral-950 px-2 py-2 text-sm">
                <option value="text">Text</option>
                <option value="choice">Choice</option>
                <option value="number">Number</option>
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <input name="options" placeholder="S, M, L, XL (for a choice)" maxLength={300}
                className="min-w-0 flex-1 rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs" />
              <label className="flex items-center gap-1 text-[11px]">
                <input type="checkbox" name="required" /> Required
              </label>
              <button className="rounded-lg border border-neutral-600 px-3 py-2 text-xs font-bold">Add</button>
            </div>
          </form>
        </section>

        {/* ── Waivers ───────────────────────────────────────────────────── */}
        <section className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
          <h2 className="text-[11px] font-black uppercase tracking-widest text-neutral-400">Waivers</h2>
          <p className="mt-1 text-[11px] text-neutral-500">Every one must be ticked before an entry is accepted.</p>
          {(t.waivers ?? []).length > 0 && (
            <ul className="mt-3 space-y-1">
              {(t.waivers ?? []).map((w) => (
                <li key={w.id} className="flex items-start gap-2 text-sm">
                  <span className="flex-1">
                    <span className="font-semibold">{w.title}</span>
                    <span className="block truncate text-[11px] text-neutral-500">{w.body}</span>
                  </span>
                  <form action={removeWaiver.bind(null, t.id, w.id)}>
                    <button className="text-[11px] font-bold text-neutral-500 hover:text-rose-400">remove</button>
                  </form>
                </li>
              ))}
            </ul>
          )}
          <form action={addWaiver.bind(null, t.id)} className="mt-3 space-y-2">
            <input name="title" required placeholder="Injury waiver" maxLength={80}
              className="w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm" />
            <textarea name="body" required rows={2} maxLength={2000} placeholder="What the player is agreeing to"
              className="w-full rounded-lg border border-neutral-800 bg-neutral-950 px-3 py-2 text-xs" />
            <button className="rounded-lg border border-neutral-600 px-3 py-2 text-xs font-bold">Add waiver</button>
          </form>
        </section>
      </main>
    </>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-400">{label}</span>
      {hint && <span className="ml-2 text-[10px] text-neutral-600">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}
