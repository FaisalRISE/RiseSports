"use client";

/* Approve, decline, and record payment on one entry.
 *
 * A client component only because approving needs to say what HAPPENED — "2
 * players brought an existing RISE Rating" is the whole payoff of collecting
 * phone numbers, and an organiser who never sees it has no reason to care
 * whether registrants filled the field in.
 *
 * Every decision is a Server Action; nothing here decides anything. */

import { useState, useTransition } from "react";

type Decision = (tournamentId: string, registrationId: string) => Promise<{ ok: true; message?: string } | { ok: false; error: string }>;
type Payment = (tournamentId: string, registrationId: string, state: "unpaid" | "paid" | "waived") =>
  Promise<{ ok: true; message?: string } | { ok: false; error: string }>;

export function EntryDecisions({
  tournamentId, registrationId, status, paymentState, hasFee, approve, decline, markPaid,
}: {
  tournamentId: string;
  registrationId: string;
  status: string;
  paymentState: string;
  hasFee: boolean;
  approve: Decision;
  decline: Decision;
  markPaid: Payment;
}) {
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const run = (fn: () => Promise<{ ok: true; message?: string } | { ok: false; error: string }>) => {
    setError(null);
    setNote(null);
    start(async () => {
      const r = await fn();
      if (r.ok) setNote(r.message ?? null);
      else setError(r.error);
    });
  };

  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {status === "pending" && (
          <>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => approve(tournamentId, registrationId))}
              className="rounded-lg bg-emerald-500/20 px-3 py-1.5 text-[11px] font-black text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-50"
            >
              Approve
            </button>
            <button
              type="button"
              disabled={pending}
              onClick={() => run(() => decline(tournamentId, registrationId))}
              className="rounded-lg border border-neutral-700 px-3 py-1.5 text-[11px] font-bold text-neutral-400 hover:border-rose-500 hover:text-rose-400 disabled:opacity-50"
            >
              Decline
            </button>
          </>
        )}

        {/* Money is RECORDED, never moved — collection happens off-app. */}
        {hasFee && status !== "declined" && (
          <div className="ml-auto flex items-center gap-1">
            {(["unpaid", "paid", "waived"] as const).map((s) => (
              <button
                key={s}
                type="button"
                disabled={pending || paymentState === s}
                onClick={() => run(() => markPaid(tournamentId, registrationId, s))}
                className={`rounded px-2 py-1 text-[10px] font-bold uppercase ${
                  paymentState === s
                    ? "bg-neutral-200 text-neutral-900"
                    : "border border-neutral-700 text-neutral-400 hover:border-neutral-500"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* The payoff, said out loud. */}
      {note && <p className="text-[11px] font-semibold text-emerald-400">{note}</p>}
      {error && <p className="text-[11px] font-semibold text-rose-400">{error}</p>}
    </div>
  );
}
