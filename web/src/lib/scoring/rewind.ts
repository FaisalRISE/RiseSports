/* "Take a point off them" — where to cut the log.
 *
 * A referee correcting a mistake thinks in points, not rallies, and under
 * side-out scoring those are different things: several rallies can pass with
 * nobody scoring. So taking a point off a side means rewinding to just before
 * the rally that gave it to them, discarding the side-outs that followed. The
 * log is the only stored state, so there is no other consistent way to remove a
 * point from the middle of it.
 *
 * ── Why this is a module of its own ───────────────────────────────────────
 * Because two engines need it and must not disagree. The server replays with
 * `replayRallies` (the real engine, including OSL); the browser replays with
 * `replayLite` when it is scoring offline. Writing the search twice is how the
 * two paths drift apart within a release. It takes the score function as an
 * argument and therefore contains no rules at all, which is also why it is safe
 * in the browser.
 */

/**
 * The log length to truncate to, or null if that side has nothing to take off.
 *
 * `scoreAt(n)` is the side's score after the first `n` rallies. A side's score
 * never falls as the log grows, so the prefix where it last changed is found by
 * halving rather than by replaying every prefix — which matters, because each
 * probe is a full replay.
 */
export function rewindIndex(length: number, scoreAt: (n: number) => number): number | null {
  const target = scoreAt(length);
  if (target <= 0) return null;

  /* The first prefix that already shows the current score. The rally just
     before it is the one that scored the point. */
  let lo = 0;
  let hi = length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (scoreAt(mid) >= target) hi = mid;
    else lo = mid + 1;
  }
  return Math.max(0, lo - 1);
}
