"use client";

/* Invite-only games: where you stand, and — if you run it — who is in.
 *
 * Ported from app.source.js:10353-10552. Two audiences on one screen, so it is
 * two components: everyone sees where they stand, and only the host sees the
 * lists.
 */

import { useState, useTransition } from "react";
import { actOnMyMembership, actOnMembership } from "./actions";
import { searchPlayers, type PlayerHit } from "../actions";

export type Standing = "organiser" | "member" | "invited" | "requested" | "none";
export type MemberView = { personId: string; name: string; rating: number | null };

const btn = "rounded-lg border px-2.5 py-1 text-[11px] font-bold disabled:opacity-40";
const plain = `${btn} border-neutral-700 text-neutral-300 hover:border-neutral-500`;
const primary = `${btn} border-amber-400 bg-amber-400 text-amber-950`;
const danger = `${btn} border-neutral-700 text-neutral-400 hover:border-rose-400/60 hover:text-rose-400`;

/* ── Where you stand ──────────────────────────────────────────────────────*/

export function MyStanding({
  slug, standing, knowsWhoIAm,
}: { slug: string; standing: Standing; knowsWhoIAm: boolean }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const act = (action: "request" | "accept" | "leave") =>
    start(async () => {
      const res = await actOnMyMembership(slug, action);
      setError(res.ok ? null : res.error);
    });

  /* The host needs no card about their own game — they have the lists below. */
  if (standing === "organiser") return null;

  if (!knowsWhoIAm) {
    return (
      <Card tone="plain">
        <p className="text-sm font-bold">This game is invite only.</p>
        <p className="mt-0.5 text-xs text-neutral-400">
          Say who you are at the top of Play, then you can ask the host to let you in.
        </p>
      </Card>
    );
  }

  return (
    <Card tone={standing === "member" ? "good" : standing === "invited" ? "warn" : "plain"}>
      <p className="text-sm font-bold">{headline(standing)}</p>
      <p className="mt-0.5 text-xs text-neutral-400">{explain(standing)}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {standing === "none" && (
          <button type="button" className={primary} disabled={pending} onClick={() => act("request")}>
            Ask to join
          </button>
        )}
        {standing === "invited" && (
          <>
            <button type="button" className={primary} disabled={pending} onClick={() => act("accept")}>
              Accept the invitation
            </button>
            <button type="button" className={danger} disabled={pending} onClick={() => act("leave")}>
              No thanks
            </button>
          </>
        )}
        {standing === "requested" && (
          <button type="button" className={plain} disabled={pending} onClick={() => act("leave")}>
            Withdraw my request
          </button>
        )}
        {standing === "member" && (
          <button type="button" className={danger} disabled={pending} onClick={() => act("leave")}>
            Leave this game
          </button>
        )}
      </div>

      {error && <p className="mt-2 text-xs font-bold text-rose-400">{error}</p>}
    </Card>
  );
}

const headline = (s: Standing) =>
  s === "member" ? "You are in this game"
    : s === "invited" ? "You have been invited"
      : s === "requested" ? "You have asked to join"
        : "This game is invite only";

const explain = (s: Standing) =>
  s === "member" ? "You can put your name down for any date."
    : s === "invited" ? "Accept and you can start signing up for dates."
      : s === "requested" ? "Waiting for the host to let you in."
        : "Ask the host and they will let you in, or not.";

function Card({ children, tone }: { children: React.ReactNode; tone: "plain" | "good" | "warn" }) {
  const cls = tone === "good"
    ? "border-emerald-400/40 bg-emerald-400/5"
    : tone === "warn"
      ? "border-amber-400/40 bg-amber-400/5"
      : "border-neutral-800 bg-neutral-900/60";
  return <div className={`rounded-xl border p-4 ${cls}`}>{children}</div>;
}

/* ── The host's lists ─────────────────────────────────────────────────────*/

export function MembershipPanel({
  slug, members, requested, invited,
}: {
  slug: string;
  members: MemberView[];
  requested: MemberView[];
  invited: MemberView[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PlayerHit[] | null>(null);
  const [pending, start] = useTransition();

  const act = (personId: string, action: Parameters<typeof actOnMembership>[2]) =>
    start(async () => {
      const res = await actOnMembership(slug, personId, action);
      setError(res.ok ? null : res.error);
      if (res.ok) { setHits(null); setQuery(""); }
    });

  const search = () => {
    if (query.trim().length < 2) return;
    start(async () => setHits(await searchPlayers(query)));
  };

  const known = new Set([...members, ...requested, ...invited].map((r) => r.personId));

  return (
    <div className="rounded-xl border border-neutral-800 bg-neutral-900/60">
      <div className="border-b border-neutral-800 p-3">
        <h2 className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">
          Who is in this game
        </h2>
        <p className="mt-0.5 text-xs text-neutral-400">
          Only members can sign up for dates.
        </p>
      </div>

      {error && <p className="border-b border-neutral-800 p-3 text-xs font-bold text-rose-400">{error}</p>}

      {/* Requests first — they are the ones waiting on a decision. */}
      {requested.length > 0 && (
        <Section title={`Asking to join · ${requested.length}`}>
          {requested.map((r) => (
            <Row key={r.personId} row={r}>
              <button type="button" className={primary} disabled={pending}
                onClick={() => act(r.personId, "approve")}>Let them in</button>
              <button type="button" className={danger} disabled={pending}
                onClick={() => act(r.personId, "deny")}>Decline</button>
            </Row>
          ))}
        </Section>
      )}

      {invited.length > 0 && (
        <Section title={`Invited · ${invited.length}`}>
          {invited.map((r) => (
            <Row key={r.personId} row={r} note="not accepted yet">
              <button type="button" className={danger} disabled={pending}
                onClick={() => act(r.personId, "cancelInvite")}>Cancel</button>
            </Row>
          ))}
        </Section>
      )}

      <Section title={`Members · ${members.length}`}>
        {members.length === 0 ? (
          <p className="px-3 py-4 text-sm text-neutral-500">
            Nobody yet. Invite someone below.
          </p>
        ) : (
          members.map((r) => (
            <Row key={r.personId} row={r}>
              <button type="button" className={danger} disabled={pending}
                onClick={() => act(r.personId, "remove")}>Remove</button>
            </Row>
          ))
        )}
      </Section>

      <div className="border-t border-neutral-800 p-3">
        <div className="flex gap-2">
          <input
            value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); search(); } }}
            placeholder="Invite someone by name…" aria-label="Search for somebody to invite"
            className="min-w-0 flex-1 rounded-lg border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-sm"
          />
          <button type="button" className={plain} onClick={search}
            disabled={pending || query.trim().length < 2}>Find</button>
        </div>

        {hits && hits.length === 0 && (
          <p className="mt-2 text-xs text-neutral-500">Nobody by that name.</p>
        )}

        {hits?.map((h) => (
          <button
            key={h.id} type="button" disabled={pending || known.has(h.id)}
            onClick={() => act(h.id, "invite")}
            className="mt-1 flex w-full items-center gap-2 rounded-lg border border-neutral-800 px-3 py-1.5 text-left hover:border-neutral-600 disabled:opacity-40"
          >
            <span className="min-w-0 flex-1 truncate text-sm">{h.name}</span>
            <span className="shrink-0 text-[11px] text-neutral-500">
              {known.has(h.id) ? "already listed" : "invite"}
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-neutral-800 last:border-b-0">
      <p className="px-3 pt-3 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
        {title}
      </p>
      <div className="divide-y divide-neutral-800">{children}</div>
    </div>
  );
}

function Row({
  row, note, children,
}: { row: MemberView; note?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center gap-2 px-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold">{row.name}</p>
        <p className="text-[11px] text-neutral-500">
          Rating {row.rating ?? "—"}{note ? ` · ${note}` : ""}
        </p>
      </div>
      <div className="flex gap-1.5">{children}</div>
    </div>
  );
}
