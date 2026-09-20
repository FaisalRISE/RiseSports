ALTER TABLE "divisions" ADD COLUMN "gender_rule" text;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "age_min" integer;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "age_max" integer;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "age_on" date;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "rating_min" integer;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "rating_max" integer;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "dupr_min_x100" integer;--> statement-breakpoint
ALTER TABLE "divisions" ADD COLUMN "dupr_max_x100" integer;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "dob" date;--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "dupr_x100" integer;--> statement-breakpoint
ALTER TABLE "registration_players" ADD COLUMN "dob" date;--> statement-breakpoint
ALTER TABLE "registration_players" ADD COLUMN "dupr_x100" integer;--> statement-breakpoint
ALTER TABLE "teams" ADD COLUMN "rules_waived" text;--> statement-breakpoint
/* Hand-added, because drizzle-kit generates no CHECK constraints.

   Category rules ("who can enter", 2026-09-17). The server checks every rule
   on every way into a category (lib/eligibility), but a Server Action is a
   public endpoint and a form is only one of its callers, so the database
   refuses rules that cannot mean anything. This is the floor, not the only
   guard: whether a PERSON meets a rule spans several tables and cannot be a
   CHECK.

   Every new column is nullable with no default and NULL means "no limit", so
   every existing row satisfies all of these — the migration changes nothing
   that is already there. No new tables, so no row-level security to add. */
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_gender_rule_valid"
  CHECK ("gender_rule" IS NULL OR "gender_rule" IN ('M', 'F', 'MX'));--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_age_range"
  CHECK (("age_min" IS NULL OR "age_min" BETWEEN 0 AND 120)
     AND ("age_max" IS NULL OR "age_max" BETWEEN 0 AND 120)
     AND ("age_min" IS NULL OR "age_max" IS NULL OR "age_min" <= "age_max"));--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_age_needs_date"
  CHECK (("age_min" IS NULL AND "age_max" IS NULL) OR "age_on" IS NOT NULL);--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_rating_range"
  CHECK (("rating_min" IS NULL OR "rating_min" BETWEEN 0 AND 9999)
     AND ("rating_max" IS NULL OR "rating_max" BETWEEN 0 AND 9999)
     AND ("rating_min" IS NULL OR "rating_max" IS NULL OR "rating_min" <= "rating_max"));--> statement-breakpoint
ALTER TABLE "divisions" ADD CONSTRAINT "divisions_dupr_range"
  CHECK (("dupr_min_x100" IS NULL OR "dupr_min_x100" BETWEEN 100 AND 800)
     AND ("dupr_max_x100" IS NULL OR "dupr_max_x100" BETWEEN 100 AND 800)
     AND ("dupr_min_x100" IS NULL OR "dupr_max_x100" IS NULL OR "dupr_min_x100" <= "dupr_max_x100"));--> statement-breakpoint
ALTER TABLE "registration_players" ADD CONSTRAINT "registration_players_dob_sane"
  CHECK ("dob" IS NULL OR "dob" >= DATE '1900-01-01');--> statement-breakpoint
ALTER TABLE "registration_players" ADD CONSTRAINT "registration_players_dupr_range"
  CHECK ("dupr_x100" IS NULL OR "dupr_x100" BETWEEN 100 AND 800);--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_dob_sane"
  CHECK ("dob" IS NULL OR "dob" >= DATE '1900-01-01');--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_dupr_range"
  CHECK ("dupr_x100" IS NULL OR "dupr_x100" BETWEEN 100 AND 800);
