ALTER TABLE "matches" ADD COLUMN "sets" jsonb;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "outcome" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "rules" jsonb;--> statement-breakpoint
-- Hand-written (drizzle-kit emits no CHECKs). A result that moves no rating
-- says why in one of three words, and only a TYPED result can carry one: a
-- rally log is a game played to its end, which is an ordinary result.
ALTER TABLE "matches" ADD CONSTRAINT "matches_outcome_known" CHECK (outcome IS NULL OR outcome IN ('walkover', 'retired', 'unrated'));--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_outcome_typed" CHECK (outcome IS NULL OR (typed_score_a IS NOT NULL AND typed_score_b IS NOT NULL));--> statement-breakpoint
-- The games in each set are the detail of a typed tennis or padel result; they
-- never stand alone.
ALTER TABLE "matches" ADD CONSTRAINT "matches_sets_typed" CHECK (sets IS NULL OR (typed_score_a IS NOT NULL AND typed_score_b IS NOT NULL));
