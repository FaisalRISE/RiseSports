-- HAND-WRITTEN. Row-level security for every table 0000-0005 created.
--
-- Production has had this since those tables were made — it was applied by hand
-- in the Supabase console and never written down. The MIGRATIONS did not
-- reproduce it, so `pnpm db:setup` against a fresh database (local dev, a
-- staging copy, a new environment) produced a schema where `tournaments`,
-- `people`, `matches`, `registrations` and the rest were all readable AND
-- writable through PostgREST by the published anon key.
--
-- Nothing was exposed in production. The hole was in what the repo could
-- rebuild, which is the kind that surfaces the day somebody stands up a second
-- environment and assumes it matches the first.
--
-- Found by widening the RLS test from `community%` to every table, after 0006
-- shipped six tables with RLS off. The narrow version of that test would never
-- have caught this.
--
-- RLS on with NO policy shuts PostgREST off completely. The app is unaffected:
-- it connects as the table OWNER through the pooler, and owners bypass RLS.
-- **Adding a policy would OPEN these tables** — see CLAUDE.md, "Supabase
-- backend", before ever adding one.
--
-- ENABLE ROW LEVEL SECURITY is safe to re-run, so this applies cleanly to the
-- production database that already has it.
--
-- `osl_live`, `app_backups` and `live_scores` are deliberately absent: they
-- belong to the legacy per-event apps, reach PostgREST on purpose, and carry
-- their own policies. See the schema.test.ts exclusion list.
ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "tournaments" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "teams" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "players" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "groups" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "divisions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registrations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "registration_players" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "people" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rating_history" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "rating_ledger" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "event_roles" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "scorer_grants" ENABLE ROW LEVEL SECURITY;
