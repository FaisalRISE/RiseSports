"use client";

/* One book: Entries, Balances, Members.
 *
 * Ported from LedgerTab (app.source.js:12591-11997). Everything shown here is
 * computed server-side by lib/finance and handed down — no money arithmetic
 * happens in the browser, which is both the "hard to copy" rule and the reason
 * a balance on screen cannot disagree with one in the database.
 */

import { useState, useTransition } from "react";
import {
  saveEntryAction, deleteEntryAction, recordPaymentAction,
  decidePaymentAction, addMemberAction, viewAsAction,
} from "../actions";

export type MemberView = { id: string; name: string; balance: number; isMe: boolean };
export type EntryView = {
  id: string; amount: number; money: string; payerId: string; payerName: string;
  participantIds: string[]; type: string; emoji: string; label: string;
  note: string; venue: string; date: string; perHead: string;
};
export type PaymentView = {
  id: string; fromName: string; toName: string; toId: string; money: string;
  method: string; note: string; date: string;
};
export type TransferView = { from: string; to: string; fromName: string; toName: string; money: string };
export type PairView = { debtorName: string; creditorName: string; money: string };
export type TypeOption = { id: string; emoji: string; label: string };

/* The emoji and labels come from lib/finance's LEDGER_TYPES, handed down by the
 * page — NOT retyped here. A picker that shows a different icon from the list
 * it writes into looks like a bug, and it was one: this file had a stadium for
 * COURT_BOOKING while the entries list rendered a shuttlecock. */


const METHODS = ["UPI", "CASH", "BANK"] as const;

const btn = "rounded-lg border px-2.5 py-1 text-[11px] font-bold disabled:opacity-40";
const plain = `${btn} border-neutral-700 text-neutral-300 hover:border-neutral-500`;
const primary = `${btn} border-amber-400 bg-amber-400 text-amber-950`;
const danger = `${btn} border-neutral-700 text-neutral-400 hover:border-rose-400/60 hover:text-rose-400`;
const field = "w-full rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-2 text-sm";

type Tab = "entries" | "balances" | "members";

export function BookView({
  slug, members, entries, settleUp, pairs, pending, myBalanceLabel, myBalance, today, types,
}: {
  slug: string;
  members: MemberView[];
  entries: EntryView[];
  settleUp: TransferView[];
  pairs: PairView[];
  pending: PaymentView[];
  myBalanceLabel: string;
  myBalance: number;
  today: string;
  types: TypeOption[];
}) {
  const [tab, setTab] = useState<Tab>("entries");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<EntryView | null>(null);
  const [adding, setAdding] = useState(false);
  const [paying, setPaying] = useState<{ fromId: string; toId: string; amount: string } | null>(null);
  const [pending_, start] = useTransition();

  const me = members.find((m) => m.isMe);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) =>
    start(async () => {
      const res = await fn();
      setError(res.ok ? null : res.error ?? "That did not work.");
      if (res.ok) { setEditing(null); setAdding(false); setPaying(null); }
    });

  return (
    <>
      <div className="mb-4 flex gap-1 rounded-xl border border-neutral-800 bg-neutral-900/60 p-1">
        {(["entries", "balances", "members"] as Tab[]).map((t) => (
          <button
            key={t} type="button" onClick={() => setTab(t)} aria-pressed={tab === t}
            className={`flex-1 rounded-lg px-3 py-1.5 text-xs font-bold capitalize ${
              tab === t ? "bg-amber-400 text-amber-950" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {t}
          </button>
        ))}
      </div>

      {error && <p className="mb-3 text-xs font-bold text-rose-400">{error}</p>}

      {/* ── Entries ─────────────────────────────────────────────────── */}
      {tab === "entries" && (
        <>
          <ul className="space-y-2">
            {entries.map((e) => (
              <li key={e.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                <div className="flex items-start gap-3">
                  <span className="text-xl leading-none" aria-hidden>{e.emoji}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-bold">{e.note || e.label}</p>
                    <p className="truncate text-[11px] text-neutral-500">
                      {[e.venue, e.date, `${e.payerName} paid`,
                        `${e.participantIds.length} ways · ${e.perHead} each`]
                        .filter(Boolean).join(" · ")}
                    </p>
                  </div>
                  <span className="shrink-0 text-sm font-black tabular-nums">{e.money}</span>
                </div>
                <div className="mt-2 flex gap-1.5">
                  <button type="button" className={plain} disabled={pending_}
                    onClick={() => setEditing(e)}>Edit</button>
                  <button type="button" className={plain} disabled={pending_}
                    onClick={() => setEditing({ ...e, id: "" })}>Duplicate</button>
                  <button
                    type="button" className={danger} disabled={pending_}
                    onClick={() => {
                      if (!confirm("Delete this entry? Everyone's balances will be recalculated.")) return;
                      run(() => deleteEntryAction(slug, e.id));
                    }}
                  >Delete</button>
                </div>
              </li>
            ))}
            {entries.length === 0 && (
              <li className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
                Nothing spent yet.
              </li>
            )}
          </ul>

          <button
            type="button" onClick={() => setAdding(true)}
            className="mt-4 w-full rounded-xl bg-amber-400 px-4 py-3 text-sm font-black text-amber-950"
          >
            + Add an entry
          </button>
        </>
      )}

      {/* ── Balances ────────────────────────────────────────────────── */}
      {tab === "balances" && (
        <div className="space-y-4">
          <div className={`rounded-xl border p-5 text-center ${
            myBalance > 0 ? "border-emerald-400/40 bg-emerald-400/5"
              : myBalance < 0 ? "border-rose-400/40 bg-rose-400/5"
                : "border-neutral-800 bg-neutral-900/60"
          }`}>
            <p className="text-3xl font-black tabular-nums">{myBalanceLabel}</p>
            <p className="mt-1 text-xs text-neutral-400">
              {/* A book can be read from anybody's side, so the verb has to
                  agree with the name. "Sumit owe this" is what happens when the
                  copy assumes the reader is always called You. */}
              {myBalance === 0
                ? "All square"
                : `${me?.name ?? "You"} ${
                    (me?.name ?? "You").toLowerCase() === "you"
                      ? myBalance > 0 ? "are owed" : "owe"
                      : myBalance > 0 ? "is owed" : "owes"
                  } this across the book`}
            </p>
          </div>

          {pending.length > 0 && (
            <section>
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Waiting to be confirmed
              </h2>
              <ul className="mt-2 space-y-1">
                {pending.map((p) => (
                  <li key={p.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-400/30 bg-amber-400/5 p-3">
                    <span className="min-w-0 flex-1 text-sm">
                      <b>{p.fromName}</b> paid <b>{p.toName}</b> {p.money}
                      <span className="text-neutral-500"> · {p.method}</span>
                    </span>
                    {/* Only the recipient is offered the button — a payment is
                        not real until the person who was paid says so. */}
                    {p.toId === me?.id ? (
                      <span className="flex gap-1.5">
                        <button type="button" className={primary} disabled={pending_}
                          onClick={() => run(() => decidePaymentAction(slug, p.id, true))}>Confirm</button>
                        <button type="button" className={danger} disabled={pending_}
                          onClick={() => run(() => decidePaymentAction(slug, p.id, false))}>Not received</button>
                      </span>
                    ) : (
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-400">
                        {p.toName} to confirm
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <section>
            <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
              Settle up — the shortest way
            </h2>
            {settleUp.length === 0 ? (
              <p className="mt-2 rounded-xl border border-dashed border-neutral-800 p-6 text-center text-sm text-neutral-500">
                Nobody owes anybody.
              </p>
            ) : (
              <ul className="mt-2 space-y-1">
                {settleUp.map((t, i) => (
                  <li key={i} className="flex flex-wrap items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                    <span className="min-w-0 flex-1 text-sm">
                      <b>{t.fromName}</b> pays <b>{t.toName}</b>
                    </span>
                    <span className="text-sm font-black tabular-nums">{t.money}</span>
                    <button
                      type="button" className={primary} disabled={pending_}
                      onClick={() => setPaying({ fromId: t.from, toId: t.to, amount: t.money.replace(/[^0-9.]/g, "") })}
                    >Settle</button>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {pairs.length > 0 && (
            <section>
              <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                Who owes whom
              </h2>
              <ul className="mt-2 space-y-1">
                {pairs.map((p, i) => (
                  <li key={i} className="flex items-center gap-2 rounded-xl border border-neutral-800 bg-neutral-900/60 px-3 py-2 text-sm">
                    <Avatar name={p.debtorName} />
                    <span className="min-w-0 flex-1">
                      <b>{p.debtorName}</b> owes <b>{p.creditorName}</b>
                    </span>
                    <span className="font-bold tabular-nums">{p.money}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          <button
            type="button"
            onClick={() => setPaying({ fromId: me?.id ?? "", toId: "", amount: "" })}
            className="w-full rounded-xl border border-dashed border-neutral-700 px-4 py-3 text-sm font-bold text-neutral-400 hover:border-neutral-500"
          >
            + Record a payment
          </button>
        </div>
      )}

      {/* ── Members ─────────────────────────────────────────────────── */}
      {tab === "members" && (
        <MembersTab slug={slug} members={members} disabled={pending_} run={run} />
      )}

      {(adding || editing) && (
        <EntrySheet
          slug={slug} members={members} today={today} entry={editing} types={types}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={setError}
        />
      )}

      {paying && (
        <PaymentSheet
          slug={slug} members={members} seed={paying}
          onClose={() => setPaying(null)} onSaved={setError}
        />
      )}
    </>
  );
}

/* ── Members ──────────────────────────────────────────────────────────────*/

function MembersTab({
  slug, members, disabled, run,
}: {
  slug: string; members: MemberView[]; disabled: boolean;
  run: (fn: () => Promise<{ ok: boolean; error?: string }>) => void;
}) {
  const [name, setName] = useState("");

  return (
    <div className="space-y-3">
      <p className="text-xs text-neutral-500">
        Tap somebody to read the book from their side. It changes whose number the
        balance shows — not what anyone can do.
      </p>

      <ul className="space-y-1">
        {members.map((m) => (
          <li key={m.id}>
            <button
              type="button" disabled={disabled || m.isMe}
              onClick={() => run(() => viewAsAction(slug, m.id))}
              className={`flex w-full items-center gap-3 rounded-xl border p-3 text-left ${
                m.isMe ? "border-amber-400/50 bg-amber-400/5" : "border-neutral-800 hover:border-neutral-600"
              }`}
            >
              <Avatar name={m.name} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-bold">
                  {m.name}{m.isMe ? " — you" : ""}
                </span>
                <span className="block text-[11px] text-neutral-500">
                  {m.balance > 0 ? "is owed" : m.balance < 0 ? "owes" : "settled"}
                </span>
              </span>
              <span className={`text-sm font-black tabular-nums ${
                m.balance > 0 ? "text-emerald-400" : m.balance < 0 ? "text-rose-400" : "text-neutral-500"
              }`}>
                {m.balance === 0 ? "—" : Math.abs(m.balance / 100).toLocaleString("en-IN")}
              </span>
            </button>
          </li>
        ))}
      </ul>

      <div className="flex gap-2">
        <input
          value={name} onChange={(e) => setName(e.target.value)}
          placeholder="Add somebody by name" maxLength={60} className={field}
          onKeyDown={(e) => {
            if (e.key === "Enter" && name.trim()) {
              e.preventDefault();
              run(() => addMemberAction(slug, name).then((r) => { setName(""); return r; }));
            }
          }}
        />
        <button
          type="button" className={plain} disabled={disabled || !name.trim()}
          onClick={() => run(() => addMemberAction(slug, name).then((r) => { setName(""); return r; }))}
        >Add</button>
      </div>
    </div>
  );
}

function Avatar({ name }: { name: string }) {
  const initials = name.split(/\s+/).slice(0, 2).map((w) => w[0] ?? "").join("").toUpperCase();
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-neutral-800 text-[11px] font-black text-neutral-300">
      {initials}
    </span>
  );
}

/* ── The expense sheet ────────────────────────────────────────────────────*/

function EntrySheet({
  slug, members, today, entry, types, onClose, onSaved,
}: {
  slug: string; members: MemberView[]; today: string;
  entry: EntryView | null; types: TypeOption[];
  onClose: () => void; onSaved: (e: string | null) => void;
}) {
  const [amount, setAmount] = useState(entry ? String(entry.amount / 100) : "");
  const [payerId, setPayerId] = useState(entry?.payerId ?? members.find((m) => m.isMe)?.id ?? members[0]?.id ?? "");
  const [participants, setParticipants] = useState<string[]>(
    entry?.participantIds ?? members.map((m) => m.id),
  );
  const [type, setType] = useState<string>(entry?.type ?? "COURT_BOOKING");
  const [note, setNote] = useState(entry?.note ?? "");
  const [venue, setVenue] = useState(entry?.venue ?? "");
  const [date, setDate] = useState(entry?.date ?? today);
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const paise = Math.round((Number(amount) || 0) * 100);
  const perHead = participants.length ? paise / participants.length / 100 : 0;
  const canSave = paise > 0 && participants.length > 0 && !!payerId;

  const toggle = (id: string) =>
    setParticipants((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]));

  const save = () =>
    start(async () => {
      const res = await saveEntryAction(
        slug,
        { amount, payerId, participantIds: participants, type, note, venue, date },
        entry?.id || undefined,
      );
      if (res.ok) { onSaved(null); onClose(); } else setErr(res.error);
    });

  return (
    <Sheet title={entry?.id ? "Edit entry" : "Add an entry"} onClose={onClose}>
      <div className="grid grid-cols-4 gap-1.5">
        {types.map(({ id, emoji, label }) => (
          <button
            key={id} type="button" onClick={() => setType(id)} aria-pressed={type === id}
            className={`rounded-lg border p-2 text-center ${
              type === id ? "border-amber-400 bg-amber-400/10" : "border-neutral-800"
            }`}
          >
            <span className="block text-lg" aria-hidden>{emoji}</span>
            <span className="block text-[9px] font-bold leading-tight text-neutral-400">{label}</span>
          </button>
        ))}
      </div>

      <input value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="What was it?" maxLength={120} className={field} />

      <label className="block space-y-1">
        <span className="text-xs font-bold text-neutral-400">Amount (₹)</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
          autoFocus placeholder="0" className={`${field} text-2xl font-black tabular-nums`} />
      </label>

      <label className="block space-y-1">
        <span className="text-xs font-bold text-neutral-400">Who paid</span>
        <select value={payerId} onChange={(e) => setPayerId(e.target.value)} className={field}>
          {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
      </label>

      <div className="space-y-1">
        <span className="text-xs font-bold text-neutral-400">
          Split between {participants.length}
          {participants.length > 0 && paise > 0 && (
            <span className="text-neutral-500">
              {" "}· ₹{perHead.toLocaleString("en-IN", { maximumFractionDigits: 2 })} each
            </span>
          )}
        </span>
        <div className="flex flex-wrap gap-1.5">
          {members.map((m) => (
            <button
              key={m.id} type="button" onClick={() => toggle(m.id)}
              aria-pressed={participants.includes(m.id)}
              className={`rounded-full border px-3 py-1 text-xs font-bold ${
                participants.includes(m.id)
                  ? "border-amber-400 bg-amber-400 text-amber-950"
                  : "border-neutral-700 text-neutral-400"
              }`}
            >{m.name}</button>
          ))}
        </div>
      </div>

      <div className="grid gap-2 sm:grid-cols-2">
        <input value={venue} onChange={(e) => setVenue(e.target.value)}
          placeholder="Where (optional)" maxLength={80} className={field} />
        <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={field} />
      </div>

      {err && <p className="text-xs font-bold text-rose-400">{err}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={`${plain} flex-1 py-2`}>Cancel</button>
        <button type="button" onClick={save} disabled={busy || !canSave}
          className={`${primary} flex-1 py-2`}>
          {busy ? "Saving…" : entry?.id ? "Save changes" : "Add entry"}
        </button>
      </div>
    </Sheet>
  );
}

/* ── The payment sheet ────────────────────────────────────────────────────*/

function PaymentSheet({
  slug, members, seed, onClose, onSaved,
}: {
  slug: string; members: MemberView[];
  seed: { fromId: string; toId: string; amount: string };
  onClose: () => void; onSaved: (e: string | null) => void;
}) {
  const [fromId, setFromId] = useState(seed.fromId || members[0]?.id || "");
  const [toId, setToId] = useState(seed.toId || "");
  const [amount, setAmount] = useState(seed.amount);
  const [method, setMethod] = useState<string>("UPI");
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const paise = Math.round((Number(amount) || 0) * 100);
  const canSave = paise > 0 && !!fromId && !!toId && fromId !== toId;

  const save = () =>
    start(async () => {
      const res = await recordPaymentAction(slug, { fromId, toId, amount, method, note });
      if (res.ok) { onSaved(null); onClose(); } else setErr(res.error);
    });

  return (
    <Sheet title="Record a payment" onClose={onClose}>
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-bold text-neutral-400">From</span>
          <select value={fromId} onChange={(e) => setFromId(e.target.value)} className={field}>
            {members.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-bold text-neutral-400">To</span>
          <select value={toId} onChange={(e) => setToId(e.target.value)} className={field}>
            <option value="">Choose…</option>
            {members.filter((m) => m.id !== fromId).map((m) => (
              <option key={m.id} value={m.id}>{m.name}</option>
            ))}
          </select>
        </label>
      </div>

      <label className="block space-y-1">
        <span className="text-xs font-bold text-neutral-400">Amount (₹)</span>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
          className={`${field} text-2xl font-black tabular-nums`} />
      </label>

      <div className="flex gap-1.5">
        {METHODS.map((m) => (
          <button key={m} type="button" onClick={() => setMethod(m)} aria-pressed={method === m}
            className={`flex-1 rounded-lg border py-2 text-xs font-bold ${
              method === m ? "border-amber-400 bg-amber-400 text-amber-950" : "border-neutral-700 text-neutral-400"
            }`}>{m}</button>
        ))}
      </div>

      <input value={note} onChange={(e) => setNote(e.target.value)}
        placeholder="Note (optional)" maxLength={120} className={field} />

      {/* The rule that makes the ledger trustworthy, said out loud. */}
      <p className="rounded-lg bg-amber-400/10 px-3 py-2 text-[11px] font-bold text-amber-400">
        This is recorded as pending. It only changes anyone&rsquo;s balance once the person
        who received it confirms.
      </p>

      {err && <p className="text-xs font-bold text-rose-400">{err}</p>}

      <div className="flex gap-2">
        <button type="button" onClick={onClose} className={`${plain} flex-1 py-2`}>Cancel</button>
        <button type="button" onClick={save} disabled={busy || !canSave}
          className={`${primary} flex-1 py-2`}>
          {busy ? "Saving…" : "Record it"}
        </button>
      </div>
    </Sheet>
  );
}

function Sheet({
  title, children, onClose,
}: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center overflow-y-auto bg-black/50 p-4 sm:items-center"
      role="dialog" aria-modal="true" aria-label={title}
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="w-full max-w-sm space-y-3 rounded-2xl border border-neutral-800 bg-neutral-950 p-5">
        <h2 className="text-sm font-bold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
