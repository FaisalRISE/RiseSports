"use client";

import { useTransition, useState } from "react";
import { setPolicy } from "./actions";
import type { EndorsementPolicy } from "@/lib/db/schema";

/* Who may rate and endorse you — your choice, on your own profile.
 *
 * Faisal, 2026-09-15: "the player himself/herself will set the criteria."
 * That is the right shape. The app deciding for everybody means one rule that
 * is too tight for a club regular and too loose for somebody who would rather
 * not be labelled by strangers; the person being labelled is the one who knows.
 *
 * "Connections" is shown and NOT selectable, because connections do not exist
 * yet — choosing it today would quietly mean "nobody", which looks like a bug
 * rather than a setting. Saying what it will do is more use than hiding it.
 */

const OPTIONS: { id: EndorsementPolicy; label: string; note: string; ready: boolean }[] = [
  {
    id: "played",
    label: "People I have played",
    note: "With or against, in a match that was scored.",
    ready: true,
  },
  {
    id: "anyone",
    label: "Anyone",
    note: "Any player who has said who they are.",
    ready: true,
  },
  {
    id: "network",
    label: "My connections",
    note: "Coming with connections — nobody would qualify yet.",
    ready: false,
  },
];

export function PolicyPicker({
  personId,
  policy,
}: {
  personId: string;
  policy: EndorsementPolicy;
}) {
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const current = OPTIONS.find((o) => o.id === policy) ?? OPTIONS[0];

  if (!open) {
    return (
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-neutral-800 pt-3">
        <span className="text-[11px] text-neutral-500">
          Rated by: <span className="font-bold text-neutral-300">{current.label.toLowerCase()}</span>
        </span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="text-[11px] font-bold text-neutral-500 hover:text-neutral-300"
        >
          change
        </button>
      </div>
    );
  }

  return (
    <div className="mt-3 border-t border-neutral-800 pt-3">
      <h3 className="mb-2 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
        Who can rate and endorse me
      </h3>
      <div className="space-y-1">
        {OPTIONS.map((o) => (
          <button
            key={o.id}
            type="button"
            disabled={!o.ready || pending}
            onClick={() => start(async () => { await setPolicy(personId, o.id); setOpen(false); })}
            className={[
              "block w-full rounded-lg border p-2 text-left transition",
              o.id === policy
                ? "border-amber-400 bg-amber-400/10"
                : "border-neutral-700 hover:border-neutral-500",
              o.ready ? "" : "opacity-45",
            ].join(" ")}
          >
            <span className="block text-[12px] font-bold text-neutral-200">
              {o.label}
              {o.id === policy && <span className="ml-2 text-amber-400">current</span>}
            </span>
            <span className="block text-[11px] text-neutral-500">{o.note}</span>
          </button>
        ))}
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        className="mt-2 text-[11px] font-bold text-neutral-500 hover:text-neutral-300"
      >
        close
      </button>
    </div>
  );
}
