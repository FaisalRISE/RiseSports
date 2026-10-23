-- Run ONCE against production right after the step 8b code is live (and safe to
-- run again). Migration 0023 is applied BEFORE the push, so for a few minutes
-- the OLD code serves on the new columns and knows nothing of them:
--
-- 1. A group the old code DREW in that window has fixtures and no membership.
--    This is 0023's own backfill again — idempotent, it only fills a team with
--    none.
-- 2. A fixture the old code DELETED in that window — its "Delete match" let a
--    pair lose every group match — leaves a member the backfill already filled
--    with no fixture in its group. The new tables count members, so that pair
--    would sit at nought played and the group could never be decided. Their
--    membership is taken off again, which is exactly the table the old code
--    showed. The new code cannot produce this state (a pair's last fixture
--    cannot be deleted — `fixtureDeletionProblem`), so nothing it did is undone.
--
-- Pinned by src/lib/db/migration-0023.test.ts.

UPDATE "teams" tm SET "group_id" = p."group_id"
FROM (
  SELECT x."team_id", min(x."group_id") AS "group_id"
  FROM (
    SELECT "team_a_id" AS "team_id", "group_id" FROM "matches" WHERE "group_id" IS NOT NULL AND "team_a_id" IS NOT NULL
    UNION ALL
    SELECT "team_b_id", "group_id" FROM "matches" WHERE "group_id" IS NOT NULL AND "team_b_id" IS NOT NULL
  ) x
  GROUP BY x."team_id"
  HAVING count(DISTINCT x."group_id") = 1
) p
JOIN "groups" g ON g."id" = p."group_id"
WHERE tm."id" = p."team_id" AND g."division_id" = tm."division_id"
  AND tm."group_id" IS NULL AND tm."withdrawn_at" IS NULL;

UPDATE "teams" tm SET "group_id" = NULL
WHERE tm."withdrawn_at" IS NULL
  AND tm."group_id" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "matches" m WHERE m."group_id" = tm."group_id")
  AND NOT EXISTS (
    SELECT 1 FROM "matches" m
    WHERE m."group_id" = tm."group_id" AND (m."team_a_id" = tm."id" OR m."team_b_id" = tm."id")
  );
