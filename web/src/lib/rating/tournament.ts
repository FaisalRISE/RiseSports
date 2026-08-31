import "server-only";

/* Rating movements across one tournament — DERIVED, never stored.
 *
 * ── Why derived ───────────────────────────────────────────────────────────
 * This codebase's central idea is that the rally log is the only stored state
 * and everything else is replayed from it. Ratings work the same way, and that
 * choice removes the three genuinely hard problems a stored version has:
 *
 *   - no `ratingsApplied` column and no double-apply when a match is re-saved;
 *   - UNDO WORKS FOR FREE. Dropping a rally can un-complete a match, and a
 *     stored rating would then have to be reversed. Here nothing was written,
 *     so the table simply recomputes;
 *   - the leaderboard can never disagree with the matches it is derived from.
 *
 * A tournament has tens of matches, so the cost is irrelevant.
 *
 * `players.ratings` is read as the STARTING rating and is never written.
 *
 * Scope: one tournament. Players are per-tournament in this schema
 * (`players.tournamentId` is NOT NULL and `users.id` is unset), so there is no
 * cross-event identity to carry a rating between tournaments yet. That is a
 * data-model decision, not a screen, and is deliberately not made here. */

import { calcRtgChange, getTier, DEFAULT_SEED, type Phase, type Tier } from "@/lib/rating";
import { ratingKey } from "@/lib/sports/registry";
import { viewMatch } from "@/lib/matchState";
import type { Match, Player, Tournament } from "@/lib/db/schema";

/**
 * Which rating bucket this tournament's results belong in — "pb:md" and so on.
 *
 * `tournament.format` is NOT this. That field holds the match format
 * ("standard" / "osl"); the rating key wants a category (men's doubles, mixed,
 * singles), and the schema has no column for it. So it is inferred from who is
 * actually on the teams, which is real data rather than a guess:
 *
 *   one player per team    -> singles      two per team -> doubles
 *   all men -> m…   all women -> w…   mixed -> mx (or "gn" for singles)
 *
 * Anything larger than a pair — OSL runs six-player teams — is "gn", the
 * general bucket, because it is not any of the conventional categories.
 *
 * If a category field is added later, prefer it over this.
 */
export function ratingFormatFor(players: Player[]): string {
  const byTeam = new Map<string, Player[]>();
  for (const p of players) {
    if (!p.teamId) continue;
    const list = byTeam.get(p.teamId) ?? [];
    list.push(p);
    byTeam.set(p.teamId, list);
  }
  if (byTeam.size === 0) return "gn";

  const sizes = [...byTeam.values()].map((v) => v.length).sort((a, b) => a - b);
  const size = sizes[Math.floor(sizes.length / 2)]; // median: one odd team should not decide it
  if (size > 2) return "gn";

  const men = players.some((p) => p.gender === "M");
  const women = players.some((p) => p.gender === "F");
  if (size === 1) return men && women ? "gn" : women ? "ws" : "ms";
  return men && women ? "mx" : women ? "wd" : "md";
}

export type PlayerRating = {
  playerId: string;
  name: string;
  teamId: string | null;
  start: number;
  delta: number;
  current: number;
  played: number;
  tier: Tier;
};

/** Rounds carry names, not phases. Read the phase out of the label. */
export function phaseOf(round: string): Phase {
  const r = round.toLowerCase();
  if (/\bfinal\b/.test(r) && !/semi|quarter/.test(r)) return "final";
  if (/semi/.test(r)) return "semi";
  if (/quarter/.test(r)) return "quarter";
  return "group";
}

type Settled = { winners: string[]; losers: string[]; scoreW: number; scoreL: number; phase: Phase };

/** A match reduced to "who beat whom, by how much" — or null if it is not a result. */
function settle(t: Tournament, m: Match, playersOfTeam: (id: string) => string[]): Settled | null {
  if (!m.teamAId || !m.teamBId) return null;
  const v = viewMatch(t, m);
  const [a, b] = v.typed ? [m.typedScoreA ?? 0, m.typedScoreB ?? 0] : [v.a, v.b];

  /* Only a FINISHED match moves a rating. A match in progress must not, or the
     table would swing on every rally — the same rule the standings follow. */
  if (!(v.typed || v.over)) return null;
  if (a === b) return null; // a draw has no winner to move rating toward

  const aWon = a > b;
  return {
    winners: playersOfTeam(aWon ? m.teamAId : m.teamBId),
    losers: playersOfTeam(aWon ? m.teamBId : m.teamAId),
    scoreW: aWon ? a : b,
    scoreL: aWon ? b : a,
    phase: phaseOf(m.round),
  };
}

const mean = (ns: number[]): number =>
  ns.length ? ns.reduce((s, n) => s + n, 0) / ns.length : DEFAULT_SEED;

/**
 * Walk a tournament's finished matches and return each player's movement.
 *
 * Team formats are rated by the TEAM's mean rating, with the shared delta
 * applied to every player on that side. That is what keeps the pool conserved:
 * one delta out of the losers, the same delta into the winners.
 */
export function tournamentRatings(
  tournament: Tournament,
  players: Player[],
  matches: Match[],
): PlayerRating[] {
  const key = ratingKey(tournament.sport, ratingFormatFor(players));

  const playersOfTeam = (teamId: string): string[] =>
    players.filter((p) => p.teamId === teamId).map((p) => p.id);

  const start = new Map<string, number>();
  for (const p of players) start.set(p.id, p.ratings?.[key] ?? DEFAULT_SEED);

  const live = new Map(start);
  const delta = new Map<string, number>(players.map((p) => [p.id, 0]));
  const played = new Map<string, number>(players.map((p) => [p.id, 0]));

  /* Chronological. Rating is path-dependent — beating someone before they
     climb is worth less than beating them after — so the order matters. */
  const ordered = [...matches].sort(
    (x, y) => (x.updatedAt?.getTime() ?? 0) - (y.updatedAt?.getTime() ?? 0),
  );

  for (const m of ordered) {
    const s = settle(tournament, m, playersOfTeam);
    if (!s || s.winners.length === 0 || s.losers.length === 0) continue;

    const wRating = mean(s.winners.map((id) => live.get(id) ?? DEFAULT_SEED));
    const lRating = mean(s.losers.map((id) => live.get(id) ?? DEFAULT_SEED));

    const change = calcRtgChange(wRating, lRating, s.scoreW, s.scoreL, {
      phase: s.phase,
      /* Scored in the app by an organiser or a PIN-holding scorer, which is the
         highest-weighted case in spec §4.5. */
      verification: "organiser",
      winnerGames: Math.max(...s.winners.map((id) => played.get(id) ?? 0)),
      loserGames: Math.max(...s.losers.map((id) => played.get(id) ?? 0)),
    });

    for (const id of s.winners) {
      live.set(id, (live.get(id) ?? DEFAULT_SEED) + change.wG);
      delta.set(id, (delta.get(id) ?? 0) + change.wG);
      played.set(id, (played.get(id) ?? 0) + 1);
    }
    for (const id of s.losers) {
      live.set(id, (live.get(id) ?? DEFAULT_SEED) - change.lL);
      delta.set(id, (delta.get(id) ?? 0) - change.lL);
      played.set(id, (played.get(id) ?? 0) + 1);
    }
  }

  return players
    .map((p) => {
      const current = live.get(p.id) ?? DEFAULT_SEED;
      return {
        playerId: p.id,
        name: p.name,
        teamId: p.teamId,
        start: start.get(p.id) ?? DEFAULT_SEED,
        delta: delta.get(p.id) ?? 0,
        current,
        played: played.get(p.id) ?? 0,
        tier: getTier(current),
      };
    })
    .sort((a, b) => b.current - a.current || b.delta - a.delta || a.name.localeCompare(b.name));
}
