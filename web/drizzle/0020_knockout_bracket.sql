ALTER TABLE "matches" ADD COLUMN "bracket" text;--> statement-breakpoint
-- Hand-written (drizzle-kit emits no CHECKs): a group fixture is never part of a
-- drawn bracket. Group rounds legitimately share labels ("Group A · R1"); only
-- bracket rows are held to one label per category.
ALTER TABLE "matches" ADD CONSTRAINT "matches_bracket_not_group" CHECK (bracket IS NULL OR group_id IS NULL);--> statement-breakpoint
-- Hand-written backfill, BEFORE the unique index: tag the knockout rows the app
-- drew as the "main" bracket. A drawn row is a non-group row with a seed slot
-- or one of the labels the draws produce. Where the old redraw bug left two
-- rows with one label, ONE is tagged: the played one if any (it is a recorded
-- result), then one with seed slots (the draw's, not a match an organiser
-- typed the same name into), then the newest. A label that already has a
-- bracket row is skipped, so the two statements are idempotent on the data
-- they were written for. DO NOT re-run them once the new code is live: a match
-- added by hand keeps bracket NULL, and a re-run would pull it into the
-- bracket or delete it. Production held no matches at all when this shipped.
WITH candidates AS (
  SELECT m.id, m.division_id, m.round, m.created_at, m.slot_a, m.slot_b,
    (jsonb_array_length(m.log) > 0 OR m.typed_score_a IS NOT NULL OR m.typed_score_b IS NOT NULL
      OR EXISTS (SELECT 1 FROM rating_history h WHERE h.match_id = m.id)) AS played
  FROM matches m
  WHERE m.bracket IS NULL AND m.group_id IS NULL
    AND (m.slot_a IS NOT NULL OR m.slot_b IS NOT NULL
      OR m.round ~ '^(Final|Third Place|(Semi-Final|Quarter-Final|Round of [0-9]+) [0-9]+)$')
    AND NOT EXISTS (
      SELECT 1 FROM matches b
      WHERE b.division_id = m.division_id AND b.round = m.round AND b.bracket IS NOT NULL
    )
), ranked AS (
  SELECT id, row_number() OVER (
    PARTITION BY division_id, round
    ORDER BY played DESC, (slot_a IS NOT NULL OR slot_b IS NOT NULL) DESC, created_at DESC, id
  ) AS rn
  FROM candidates
)
UPDATE matches SET bracket = 'main' FROM ranked WHERE matches.id = ranked.id AND ranked.rn = 1;--> statement-breakpoint
-- Hand-written: the losing duplicates that were never played, moved no rating
-- and carry seed slots are the extra rows the old redraw inserted — delete
-- them. Only SLOTTED rows: a row without slots may be a match an organiser
-- added by hand and typed a draw-like name into, and that is theirs to delete.
-- A PLAYED losing duplicate is kept, outside every bracket (bracket stays
-- NULL): it is somebody's result, and deleting it would take a rating's record
-- with it.
DELETE FROM matches m
WHERE m.bracket IS NULL AND m.group_id IS NULL
  AND (m.slot_a IS NOT NULL OR m.slot_b IS NOT NULL)
  AND EXISTS (
    SELECT 1 FROM matches b
    WHERE b.division_id = m.division_id AND b.round = m.round AND b.bracket IS NOT NULL
  )
  AND jsonb_array_length(m.log) = 0 AND m.typed_score_a IS NULL AND m.typed_score_b IS NULL
  AND NOT EXISTS (SELECT 1 FROM rating_history h WHERE h.match_id = m.id);--> statement-breakpoint
CREATE UNIQUE INDEX "matches_division_bracket_round_idx" ON "matches" USING btree ("division_id","round") WHERE bracket is not null;
