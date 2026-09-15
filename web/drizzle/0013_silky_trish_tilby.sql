ALTER TABLE "tournaments" ADD COLUMN "courts" integer DEFAULT 2 NOT NULL;--> statement-breakpoint
ALTER TABLE "tournaments" ADD COLUMN "match_minutes" integer DEFAULT 20 NOT NULL;