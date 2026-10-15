ALTER TABLE "rating_history" DROP CONSTRAINT "rating_history_match_id_matches_id_fk";
--> statement-breakpoint
ALTER TABLE "rating_ledger" DROP CONSTRAINT "rating_ledger_match_id_matches_id_fk";
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "reset_rev" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_ledger" ADD CONSTRAINT "rating_ledger_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
-- Hand-written (drizzle-kit emits no CHECKs). Checked against production first:
-- no row broke any of them (2026-10-11). reset_rev is the rev a clear or reset
-- landed at, so it can never be ahead of the match.
ALTER TABLE "matches" ADD CONSTRAINT "matches_reset_rev_sane" CHECK (reset_rev >= 0 AND reset_rev <= rev);--> statement-breakpoint
-- A typed result is a PAIR: one box filled is a half-typed score that reads as
-- no result on one screen and a result on another.
ALTER TABLE "matches" ADD CONSTRAINT "matches_typed_pair" CHECK (num_nonnulls(typed_score_a, typed_score_b) <> 1);--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_typed_nonneg" CHECK (coalesce(typed_score_a, 0) >= 0 AND coalesce(typed_score_b, 0) >= 0);--> statement-breakpoint
-- A typed result and a rally log never stand together: typing replaces the
-- rallies, and a rally replaces the typed result (writeResult).
ALTER TABLE "matches" ADD CONSTRAINT "matches_typed_or_log" CHECK (typed_score_a IS NULL OR jsonb_array_length(log) = 0);
