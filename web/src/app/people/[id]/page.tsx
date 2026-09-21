import { notFound } from "next/navigation";
import Link from "next/link";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "@/lib/db";
import { matches, people, ratingHistory, tournaments } from "@/lib/db/schema";
import { getTier, sportRating } from "@/lib/rating";
import { reliabilityForPerson, playedFromHistory } from "@/lib/rating/reliability";
import { detectSandbagging, sandbaggingNote } from "@/lib/rating/sandbagging";
import { maskPhone } from "@/lib/people";
import { honoursFor } from "@/lib/placings/honours";
import { partnersOf, RATE_THRESHOLD } from "@/lib/rating/partners";
import { skillProfile, myRatings, ratedSports } from "@/lib/skills/store";
import { mayRate } from "@/lib/skills/eligibility";
import { myPersonId } from "@/lib/community/me";
import { SkillRadar } from "@/components/SkillRadar";
import { RateForm } from "./RateForm";
import { PolicyPicker } from "./PolicyPicker";
import { SPORTS, SPORT_IDS, skillsFor, tagsFor, sportOf, DEFAULT_SPORT, type SportId } from "@/lib/sports/registry";
import { PLACING_LABEL, PLACING_MEDAL } from "@/lib/placings";
import { OpenAccessBanner } from "@/components/OpenAccessBanner";

/* One person's RISE Rating and how it got there.
 *
 * This page is the answer to "why is my rating that?" — spec §9 keeps every
 * input precisely so an organiser can show the working instead of asserting a
 * number. It is also where the Reliability Index earns its place: a rating
 * built on four games against the same two people should not look like one
 * built on forty. */
/* Not indexed. These pages list real people — name, gender, the last four
   digits of a phone number, and now labels other players chose for them — and
   nobody on them opted in: a `people` row is created by an organiser entering
   somebody into an event. Playing a match is consent to be scored. It is not
   consent to be a search result. */
export const metadata = { robots: { index: false, follow: false } };

export const dynamic = "force-dynamic";

export default async function PersonPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sport?: string }>;
}) {
  const { id } = await params;
  const { sport: sportParam } = await searchParams;

  const [person] = await db.select().from(people).where(eq(people.id, id)).limit(1);
  if (!person) notFound();

  const history = await db
    .select({ h: ratingHistory, match: matches, tournament: tournaments })
    .from(ratingHistory)
    .innerJoin(matches, eq(ratingHistory.matchId, matches.id))
    .innerJoin(tournaments, eq(matches.tournamentId, tournaments.id))
    .where(eq(ratingHistory.personId, id))
    .orderBy(desc(ratingHistory.createdAt))
    .limit(100);

  /* Everything derived comes through the one shared reader, so this page cannot
     drift from the roster or the tournament view. */
  const reliability = reliabilityForPerson(history.map((r) => r.h), id, new Date());

  /* §8.1 — recomputed here rather than trusting `people.flags`, so the profile
     shows the current picture even if the stored flag is behind. */
  const played = playedFromHistory(history.map((r) => r.h), id);
  const flag = detectSandbagging(
    played
      .filter((m) => (m.opponentRatings?.length ?? 0) > 0)
      .map((m) => ({
        avgOpponentRating: m.opponentRatings!.reduce((s, n) => s + n, 0) / m.opponentRatings!.length,
        won: m.won,
        playedAt: m.playedAt,
      })),
    person.riseBest ?? 0,
  );
  const flagNote = sandbaggingNote(flag);

  /* What they have won. Derived from the finals themselves rather than kept on
     the person — see lib/placings. Nothing appears until a final is finished,
     and a corrected score changes this page with it. */
  const honours = await honoursFor(id);

  /* Written on every rated match since the engine was ported and shown nowhere
     until now — see lib/rating/partners. */
  const partners = await partnersOf(person.partnerStats);

  /* ── Peer ratings ─────────────────────────────────────────────────────
   * Thirteen skills, and they differ per sport, so the chart is always OF a
   * sport. Defaults to one this person has actually been rated in rather than
   * to pickleball, so a chess player's profile does not open on an empty
   * pickleball radar. */
  const already = await ratedSports(id);
  const sport: SportId =
    (sportParam && sportParam in SPORTS ? (sportParam as SportId) : null) ??
    already[0] ??
    DEFAULT_SPORT;

  const [profile, me] = await Promise.all([skillProfile(id, sport), myPersonId()]);
  const permission = await mayRate(me, id);
  const mine = permission.allowed && me
    ? await myRatings(id, me, sport)
    : { scores: {}, tags: [] };

  const names = await opponentNames(history);

  /* One rating PER SPORT played — Faisal, 2026-09-21: "RiseR rating is
     specific to each sport". The single number this card used to show was
     `riseBest`, a max() across every sport, so a player's pickleball page could
     be headed by their badminton rating. A sport appears once there is a
     rating in it that counts (matches, or a deliberate placement). */
  const ratedIn = SPORT_IDS
    .map((sp) => ({ sport: SPORTS[sp], rating: sportRating(person, sp) }))
    .filter((r): r is { sport: (typeof SPORTS)[SportId]; rating: number } => r.rating != null);

  /* Where they started, for someone who has not played yet: the one key a new
     person is seeded with, and the sport it is in. */
  const seedKey = Object.keys(person.riseRatings ?? {})[0] ?? null;
  const seedSport = seedKey ? sportOf(seedKey.split(":")[0] as SportId) : null;

  return (
    <>
      <OpenAccessBanner />
      <main className="mx-auto max-w-3xl space-y-6 p-4 sm:p-6">
        <header>
          <Link href="/people" className="text-sm font-semibold text-neutral-400 hover:text-neutral-200">
            ← Players
          </Link>
          <h1 className="mt-2 text-3xl font-black tracking-tight">{person.name}</h1>
          <p className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
            {person.gender === "F" ? "Women" : "Men"}
            {/* Masked: a phone number is how a person is matched, not something
                to publish. */}
            {person.phone ? ` · ${maskPhone(person.phone)}` : " · no phone on file"}
          </p>
        </header>

        {/* §8.1. Neutral wording on purpose: this fires just as readily on a
            player improving fast as on one hiding, and the spec is explicit
            that it is a prompt for a human, never an automatic correction. */}
        {flagNote && (
          <p className="rounded-xl border border-amber-500/50 bg-amber-500/10 p-3 text-sm font-bold text-amber-300">
            ⚠ {flagNote}
          </p>
        )}

        <section className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4" data-ratings>
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">RISE Rating</div>
            {ratedIn.length === 0 ? (
              <>
                <div className="font-mono text-4xl font-black">—</div>
                <div className="text-sm text-neutral-400">Unrated</div>
              </>
            ) : (
              <ul className="mt-1 space-y-1.5">
                {ratedIn.map(({ sport: sp, rating }) => {
                  const t = getTier(rating);
                  return (
                    <li key={sp.id} data-sport-rating={sp.id}>
                      <div className="flex items-baseline justify-between gap-2">
                        <span className="text-xs font-bold text-neutral-400">{sp.emoji} {sp.name}</span>
                        <span className="font-mono text-2xl font-black tabular-nums">{rating}</span>
                      </div>
                      <div className="text-right text-[11px] text-neutral-400">{t.emoji} {t.name}</div>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">Reliability</div>
            <div
              className={`font-mono text-4xl font-black ${
                reliability.band === "High" ? "text-emerald-400"
                : reliability.band === "Medium" ? "text-amber-400"
                : "text-rose-400"
              }`}
            >
              {reliability.band}
            </div>
            <div className="text-xs text-neutral-400">{reliability.reason}</div>
          </div>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            <div className="text-[10px] font-bold uppercase tracking-widest text-neutral-500">DUPR</div>
            <div className="font-mono text-4xl font-black text-neutral-300">
              {person.dupr == null ? "—" : (person.dupr / 100).toFixed(2)}
            </div>
            <div className="text-xs text-neutral-500">
              {person.duprEnteredAt
                ? `entered ${person.duprEnteredAt.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
                : "not provided"}
              {person.seedSource === "dupr" && " · used to seed"}
            </div>
          </div>
        </section>

        {/* What other players say. Never feeds the RISE Rating — that is
            measured from results, and this is opinion. */}
        <section>
          <div className="mb-1 flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-black">Skills</h2>
            <span className="text-[11px] font-bold uppercase tracking-widest text-neutral-500">
              {profile.raters === 0
                ? "not rated yet"
                : `${profile.raters} ${profile.raters === 1 ? "person" : "people"}`}
            </span>
            {already.length > 1 && (
              <div className="ml-auto flex gap-1">
                {already.map((sp) => (
                  <Link key={sp} href={`/people/${id}?sport=${sp}`}
                    className={`rounded-lg border px-2 py-1 text-[11px] font-bold ${
                      sp === sport
                        ? "border-amber-400 bg-amber-400 text-amber-950"
                        : "border-neutral-700 text-neutral-400"
                    }`}>
                    {sportOf(sp).emoji} {sportOf(sp).name}
                  </Link>
                ))}
              </div>
            )}
          </div>
          <p className="mb-3 text-[12px] text-neutral-500">
            {sportOf(sport).name} · rated by people they have played with or against. This is
            opinion, and it never moves the RISE Rating.
          </p>

          <div className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-4">
            {profile.raters === 0 ? (
              <p className="py-6 text-center text-sm text-neutral-500">
                No peer ratings in {sportOf(sport).name} yet.
              </p>
            ) : (
              <div className="flex justify-center text-neutral-400">
                <SkillRadar skills={profile.skills} compare={mine.scores} />
              </div>
            )}

            {profile.tags.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-neutral-800 pt-3">
                {profile.tags.map((t) => (
                  /* The count stays here. Endorsements live on the profile and
                     nowhere else — Faisal, 2026-09-15 — so there is no list to
                     link out to and no count to leak onto one. */
                  <span key={t.tag}
                    className="inline-flex items-center gap-1 rounded-full border border-neutral-700 px-3 py-1 text-[11px] font-bold text-neutral-300">
                    {t.tag}
                    <span className="font-mono text-neutral-500">{t.count}</span>
                  </span>
                ))}
              </div>
            )}

            {/* Your own page: you decide who may label you. */}
            {!permission.allowed && permission.reason === "self" && (
              <PolicyPicker personId={id} policy={person.endorsementPolicy} />
            )}

            <div className="mt-4 border-t border-neutral-800 pt-3">
              {permission.allowed ? (
                <RateForm
                  subjectPersonId={id}
                  subjectName={person.name}
                  sport={sport}
                  sportName={sportOf(sport).name}
                  skills={skillsFor(sport)}
                  tags={tagsFor(sport)}
                  mine={mine}
                />
              ) : (
                /* Said out loud rather than hidden. A control that is simply
                   absent reads as a bug; a reason reads as a rule. */
                <p className="text-[12px] text-neutral-500">
                  {permission.reason === "self"
                    ? "You cannot rate yourself."
                    : permission.reason === "anonymous"
                      ? "Pick who you are on the Play tab to rate people you have played."
                      : permission.reason === "not-connected"
                        ? `${person.name.split(" ")[0]} only takes ratings from their connections.`
                        : `${person.name.split(" ")[0]} takes ratings from people they have played with or against.`}
                </p>
              )}
            </div>
          </div>
        </section>

        {honours.length > 0 && (
          <section>
            <h2 className="mb-3 text-lg font-black">Honours</h2>
            <ul className="space-y-2">
              {honours.map((h, i) => (
                <li key={i} className="flex items-center gap-3 rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                  <span className="text-xl" aria-hidden>{PLACING_MEDAL[h.placing]}</span>
                  <div className="min-w-0 flex-1">
                    <Link href={`/t/${h.tournamentSlug}`} className="truncate text-sm font-bold hover:underline">
                      {h.tournamentName}
                    </Link>
                    <p className="text-[11px] text-neutral-500">
                      {PLACING_LABEL[h.placing]}
                      {h.categoryName ? ` · ${h.categoryName}` : ""}
                      {h.at ? ` · ${h.at.toLocaleDateString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" })}` : ""}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        {partners.length > 0 && (
          <section>
            <h2 className="mb-1 text-lg font-black">Who they play with</h2>
            <p className="mb-3 text-[12px] text-neutral-500">
              Doubles partners, most played first. A win rate needs {RATE_THRESHOLD} matches
              together before it is shown — below that it is one good day, not a pattern.
            </p>
            <div className="overflow-x-auto rounded-xl border border-neutral-800">
              <table className="w-full min-w-[30rem] text-left text-[13px]">
                <thead>
                  <tr className="border-b border-neutral-800 text-[10px] font-bold uppercase tracking-widest text-neutral-500">
                    <th className="p-2">Partner</th>
                    <th className="p-2 text-right">Played</th>
                    <th className="p-2 text-right">Won</th>
                    <th className="p-2 text-right">Rate</th>
                    <th className="p-2 text-right">Their rating</th>
                  </tr>
                </thead>
                <tbody>
                  {partners.map((pt) => (
                    <tr key={pt.personId} className="border-b border-neutral-800 last:border-0">
                      <td className="p-2">
                        <Link href={`/people/${pt.personId}`} className="font-semibold hover:underline">
                          {pt.name}
                        </Link>
                      </td>
                      <td className="p-2 text-right font-mono tabular-nums">{pt.matches}</td>
                      <td className="p-2 text-right font-mono tabular-nums">{pt.wins}</td>
                      <td className="p-2 text-right font-mono tabular-nums">
                        {pt.winRate == null
                          ? <span className="text-neutral-600">—</span>
                          : `${pt.winRate}%`}
                      </td>
                      <td className="p-2 text-right font-mono tabular-nums text-neutral-400">
                        {pt.avgPartnerRating || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <section>
          <h2 className="mb-3 text-lg font-black">How this rating was earned</h2>
          {history.length === 0 ? (
            <p className="rounded-xl border border-dashed border-neutral-800 p-8 text-center text-sm text-neutral-500">
              No rated matches yet. Started at {seedKey ? person.riseRatings[seedKey] : "—"}
              {seedSport ? ` in ${seedSport.name}` : ""}
              {person.seedSource === "dupr" ? ", seeded from DUPR."
                : person.seedSource === "organiser" ? ", set by an organiser."
                : " — the standard start, which counts as unrated until they play."}
            </p>
          ) : (
            <ol className="space-y-2">
              {history.map((r) => {
                const notes = (r.h.notes ?? {}) as { won?: boolean; damped?: boolean; carried?: boolean; opponentIds?: string[] };
                const opps = (notes.opponentIds ?? []).map((o) => names.get(o) ?? "—").join(" & ");
                return (
                  <li key={r.h.id} className="rounded-xl border border-neutral-800 bg-neutral-900/60 p-3">
                    <div className="flex items-baseline gap-2">
                      <span className={`font-mono text-lg font-black ${r.h.deltaApplied >= 0 ? "text-emerald-400" : "text-rose-400"}`}>
                        {r.h.deltaApplied > 0 ? "+" : ""}{r.h.deltaApplied}
                      </span>
                      <span className="text-sm font-semibold">{notes.won ? "beat" : "lost to"} {opps || "—"}</span>
                      <span className="ml-auto font-mono text-xs text-neutral-500">
                        {r.h.ratingBefore} → {r.h.ratingAfter}
                      </span>
                    </div>
                    <div className="mt-1 flex flex-wrap gap-x-3 text-[11px] text-neutral-500">
                      <span>{r.tournament.name} · {r.match.round}</span>
                      <span>expected {(r.h.expected / 1000).toFixed(2)}</span>
                      <span>margin ×{(r.h.marginMultiplier / 1000).toFixed(2)}</span>
                      <span>stage ×{(r.h.stageMultiplier / 1000).toFixed(2)}</span>
                      <span>verified ×{(r.h.verificationWeight / 1000).toFixed(2)}</span>
                      {/* Named explicitly, so a small gain is explainable rather
                          than looking like a bug. */}
                      {notes.damped && <span className="text-amber-400">repeat opponent ×0.6</span>}
                      {notes.carried && <span className="text-amber-400">carry guard ×0.7</span>}
                    </div>
                  </li>
                );
              })}
            </ol>
          )}
        </section>
      </main>
    </>
  );
}

/** Opponent ids are person ids; the page needs names. */
async function opponentNames(
  history: { h: { notes: unknown } }[],
): Promise<Map<string, string>> {
  const ids = new Set<string>();
  for (const r of history) {
    for (const o of ((r.h.notes ?? {}) as { opponentIds?: string[] }).opponentIds ?? []) ids.add(o);
  }
  if (ids.size === 0) return new Map();
  const rows = await db.select({ id: people.id, name: people.name }).from(people).where(inArray(people.id, [...ids]));
  return new Map(rows.map((r) => [r.id, r.name]));
}
