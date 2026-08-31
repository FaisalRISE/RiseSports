import { notFound } from "next/navigation";
import Link from "next/link";
import { asc, eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { divisions, registrations, tournaments, users } from "@/lib/db/schema";
import { sportOf } from "@/lib/sports/registry";
import { entryWindow, formatFee } from "@/lib/registration";
import { rulesFor } from "@/lib/matchState";
import { EntryForm } from "@/components/EntryForm";
import { submitEntry } from "./actions";

/* The public event page — the one surface built for people who are not the
 * organiser.
 *
 * Deliberately NOT behind `canView`: a draft is hidden, but everything else is
 * meant to be handed round on WhatsApp. That is the point of the link.
 *
 * Nothing about the organiser's setup leaks here: no PIN, no admin links, no
 * entrant phone numbers. The entrant list is names only, and only if the
 * organiser left it visible. */
export const dynamic = "force-dynamic";

export default async function EventPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;

  const [t] = await db.select().from(tournaments).where(eq(tournaments.slug, slug)).limit(1);
  /* A draft is not a 403 — it simply does not exist to the public yet. */
  if (!t || t.status === "draft") notFound();

  const [divs, entered, [owner]] = await Promise.all([
    db.select().from(divisions).where(eq(divisions.tournamentId, t.id)).orderBy(asc(divisions.position)),
    db.select().from(registrations).where(eq(registrations.tournamentId, t.id)),
    db.select().from(users).where(eq(users.id, t.ownerId)).limit(1),
  ]);

  const approved = entered.filter((r) => r.status === "approved");
  const window = entryWindow(t);
  const sport = sportOf(t.sport);
  const rules = rulesFor(t);
  const fee = formatFee(t.entryFee);

  return (
    <main className="mx-auto max-w-2xl space-y-5 p-4 sm:p-6">
      {/* The poster. A shared link should look like an event, not a form. */}
      <section className="overflow-hidden rounded-2xl bg-gradient-to-b from-[#1b2a6b] to-[#0f1738] p-8 text-center">
        <p className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/60">RISE Sports</p>
        <h1 className="mt-3 text-4xl font-black uppercase tracking-tight text-white">{t.name}</h1>
        {t.about && <p className="mx-auto mt-3 max-w-md text-sm leading-relaxed text-white/70">{t.about}</p>}

        <p className="mt-6 text-[10px] font-bold uppercase tracking-[0.2em] text-white/50">Entry fee</p>
        <p className="text-3xl font-black text-white">{fee}</p>

        <div className="mt-5 flex flex-wrap justify-center gap-2">
          {[
            `${sport.emoji} ${sport.name}`,
            t.format === "osl" ? "OSL team format" : t.format === "pickleboss" ? "Pickleboss" : "Standard",
            rules ? `To ${rules.target}` : null,
            t.status === "live" ? "In progress" : t.status === "finished" ? "Finished" : null,
          ]
            .filter(Boolean)
            .map((chip) => (
              <span key={chip as string} className="rounded-full bg-white/10 px-3 py-1 text-[11px] font-bold text-white">
                {chip}
              </span>
            ))}
        </div>
      </section>

      {/* Register, or say plainly why not. */}
      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
        {window.open ? (
          <>
            <h2 className="mb-1 text-lg font-black">Enter this event</h2>
            <p className="mb-4 text-xs text-neutral-400">
              {t.registrationClosesAt
                ? `Entries close ${t.registrationClosesAt.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}.`
                : "Entries are open."}
            </p>
            <EntryForm
              slug={slug}
              minTeamSize={t.minTeamSize}
              maxTeamSize={t.maxTeamSize}
              divisions={divs.map((d) => ({ id: d.id, name: d.name, description: d.description }))}
              formFields={t.formFields ?? []}
              waivers={t.waivers ?? []}
              feeLabel={fee}
              needsApproval
              submit={submitEntry}
            />
          </>
        ) : (
          <div className="py-4 text-center">
            <h2 className="text-lg font-black text-neutral-300">Entries closed</h2>
            <p className="mt-1 text-sm text-neutral-500">{window.reason}</p>
          </div>
        )}
      </section>

      {/* Names only, and only if the organiser wants them shown. */}
      {!t.hideEntrants && approved.length > 0 && (
        <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
          <h2 className="mb-3 text-sm font-black uppercase tracking-widest text-neutral-400">
            {approved.length} {approved.length === 1 ? "team" : "teams"} in
          </h2>
          <ul className="flex flex-wrap gap-2">
            {approved.map((r) => (
              <li key={r.id} className="rounded-lg bg-neutral-800 px-3 py-1.5 text-xs font-semibold">
                {r.teamName}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="rounded-2xl border border-neutral-800 bg-neutral-900/60 p-5">
        <dl className="grid gap-3 sm:grid-cols-2">
          <Detail label="Sport" value={`${sport.emoji} ${sport.name}`} />
          <Detail label="Format" value={t.format === "osl" ? "OSL team format" : t.format === "pickleboss" ? "Pickleboss" : "Standard"} />
          <Detail label="Date" value={t.startsAt ? t.startsAt.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "long" }) : "To be confirmed"} />
          <Detail label="Venue" value={t.venue ?? "To be confirmed"} />
          <Detail label="Team size" value={t.minTeamSize === t.maxTeamSize ? `${t.minTeamSize} players` : `${t.minTeamSize}–${t.maxTeamSize} players`} />
          <Detail label="Organised by" value={owner?.name ?? "—"} />
        </dl>
      </section>

      {(t.status === "live" || t.status === "finished") && (
        <Link
          href={`/t/${slug}`}
          className="block rounded-2xl border border-neutral-700 p-4 text-center text-sm font-bold hover:border-neutral-500"
        >
          See scores and standings →
        </Link>
      )}

      <p className="pb-6 text-center text-[11px] text-neutral-600">Run on RISE Sports</p>
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">{label}</dt>
      <dd className="text-sm font-semibold text-neutral-200">{value}</dd>
    </div>
  );
}
