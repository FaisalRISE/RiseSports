-- HAND-WRITTEN. drizzle-kit does not generate row-level security, so a table it
-- creates comes up with RLS OFF — and Supabase grants the `anon` role
-- SELECT/INSERT/UPDATE/DELETE on every table in `public` by default.
--
-- That combination is not theoretical. When 0006 was applied to production the
-- six community tables were readable AND writable by the anon key, which is
-- published in the legacy app's shipped HTML. `community_attendance` links a
-- named person to a date and a venue; `community_games` carries the host.
-- Verified by probing as the anon role before and after.
--
-- The posture here matches the other 14 app tables, and it is the INTENDED one:
-- RLS enabled with NO policies shuts the public PostgREST API off for these
-- tables completely. The app is unaffected because it connects through the
-- pooler as the table OWNER, and owners bypass RLS.
--
-- Supabase's linter reports each of these as "RLS enabled, no policy". That is
-- the desired state, not a defect to fix. **Adding a policy would OPEN these
-- tables to the world** — do not add one without deciding what should be
-- public. See CLAUDE.md, "Supabase backend".
--
-- Any future community table belongs in this list on the day it is created.
ALTER TABLE "community_games" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "community_sessions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "community_attendance" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "community_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "community_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "community_byes" ENABLE ROW LEVEL SECURITY;
