-- Divisions become the unit of a draw.
--
-- HAND-EDITED. drizzle-kit generated `ADD COLUMN "division_id" text NOT NULL`
-- for three tables that already hold rows, which fails outright: there is no
-- default and no value to put there. The generated version is kept below in
-- spirit but split into add-nullable → backfill → enforce, which is the only
-- order that works on a database with data in it.
--
-- The backfill gives every tournament a division named "Main" if it has none,
-- then points its teams, groups and matches at one. Existing draws were
-- tournament-wide, so the tournament's first division is the correct home for
-- all of them. Teams that came in through the public entry page are better
-- served than that: their registration already recorded which category the
-- entrant picked, so that is preferred where it exists.

DROP INDEX "groups_key_idx";--> statement-breakpoint

ALTER TABLE "divisions" ADD COLUMN "shape" text DEFAULT 'groups_ko' NOT NULL;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "third_place" boolean DEFAULT false NOT NULL;--> statement-breakpoint

-- 1. Add nullable, so existing rows survive the ALTER.
ALTER TABLE "groups" ADD COLUMN "division_id" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "division_id" text;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "division_id" text;--> statement-breakpoint

-- 2. Every tournament has at least one division, from here on.
INSERT INTO "divisions" ("id", "tournament_id", "name", "position")
SELECT gen_random_uuid()::text, t."id", 'Main', 0
  FROM "tournaments" t
 WHERE NOT EXISTS (SELECT 1 FROM "divisions" d WHERE d."tournament_id" = t."id");--> statement-breakpoint

-- 3. Backfill. A team keeps the category its entrant actually chose when the
--    entry page recorded one; everything else falls to the first division.
UPDATE "teams" tm
   SET "division_id" = COALESCE(
         (SELECT r."division_id" FROM "registrations" r
           WHERE r."team_id" = tm."id" AND r."division_id" IS NOT NULL
           LIMIT 1),
         (SELECT d."id" FROM "divisions" d
           WHERE d."tournament_id" = tm."tournament_id"
           ORDER BY d."position", d."created_at"
           LIMIT 1))
 WHERE tm."division_id" IS NULL;--> statement-breakpoint

UPDATE "groups" g
   SET "division_id" = (SELECT d."id" FROM "divisions" d
                         WHERE d."tournament_id" = g."tournament_id"
                         ORDER BY d."position", d."created_at"
                         LIMIT 1)
 WHERE g."division_id" IS NULL;--> statement-breakpoint

UPDATE "matches" m
   SET "division_id" = (SELECT d."id" FROM "divisions" d
                         WHERE d."tournament_id" = m."tournament_id"
                         ORDER BY d."position", d."created_at"
                         LIMIT 1)
 WHERE m."division_id" IS NULL;--> statement-breakpoint

-- 4. Now it can be required. If any of these fail, the backfill above missed a
--    row and the migration should stop rather than leave a half-shaped table.
ALTER TABLE "groups" ALTER COLUMN "division_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "matches" ALTER COLUMN "division_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "teams" ALTER COLUMN "division_id" SET NOT NULL;--> statement-breakpoint

ALTER TABLE "groups" ADD CONSTRAINT "groups_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

CREATE INDEX "groups_division_idx" ON "groups" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "matches_division_idx" ON "matches" USING btree ("division_id");--> statement-breakpoint
CREATE INDEX "teams_division_idx" ON "teams" USING btree ("division_id");--> statement-breakpoint

-- Per DIVISION now: Men's Doubles and Mixed each get their own Group A.
CREATE UNIQUE INDEX "groups_key_idx" ON "groups" USING btree ("tournament_id","division_id","key");
