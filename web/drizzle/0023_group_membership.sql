ALTER TABLE "teams" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "withdrawn_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "teams_group_idx" ON "teams" USING btree ("group_id");--> statement-breakpoint
-- Hand-written (drizzle-kit writes no data migration). Membership for groups
-- drawn before this column existed, read off their FIXTURES: a team in the
-- fixtures of exactly one group, of its own category, is a member of it. A
-- team seen in two groups, or in a group of another category (possible in data
-- older than 0005), is left without one rather than guessed. Idempotent: it
-- only fills a team that has none, so it can be run again after the deploy
-- (for groups the old code DREW in between; a fixture the old code DELETED in
-- between needs the second half of web/scripts/0023-after-deploy.sql, which
-- runs this again too).
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
