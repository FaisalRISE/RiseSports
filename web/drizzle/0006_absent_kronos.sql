CREATE TABLE "community_attendance" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"person_id" text NOT NULL,
	"state" text NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"paid" boolean DEFAULT false NOT NULL,
	"payment_link_sent_at" timestamp with time zone,
	"withdrew_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_byes" (
	"session_id" text NOT NULL,
	"block" integer NOT NULL,
	"person_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	CONSTRAINT "community_byes_session_id_block_pk" PRIMARY KEY("session_id","block")
);
--> statement-breakpoint
CREATE TABLE "community_games" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"sport" text DEFAULT 'pb' NOT NULL,
	"host_person_id" text,
	"created_by" text,
	"venue" text DEFAULT 'TBD Venue' NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"freq" text DEFAULT 'weekly' NOT NULL,
	"days" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"start_time" text DEFAULT '20:00' NOT NULL,
	"end_time" text DEFAULT '22:00' NOT NULL,
	"courts" integer DEFAULT 2 NOT NULL,
	"per_court" integer DEFAULT 4 NOT NULL,
	"rotation" text DEFAULT 'fixed' NOT NULL,
	"schedule_mode" text DEFAULT 'random' NOT NULL,
	"access_type" text DEFAULT 'open' NOT NULL,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"restrictions" jsonb DEFAULT '{"gsrMin":null,"gsrMax":null,"duprMin":null,"duprMax":null,"ageMin":null,"ageMax":null,"gender":null}'::jsonb NOT NULL,
	"ladder_order" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"ladder_log" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_matches" (
	"id" text PRIMARY KEY NOT NULL,
	"session_id" text NOT NULL,
	"block" integer DEFAULT 0 NOT NULL,
	"court" integer DEFAULT 1 NOT NULL,
	"lineup_a" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"lineup_b" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"score_a" integer,
	"score_b" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_members" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"person_id" text NOT NULL,
	"state" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "community_sessions" (
	"id" text PRIMARY KEY NOT NULL,
	"game_id" text NOT NULL,
	"date" text NOT NULL,
	"kotc" jsonb,
	"slot_data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"scheduled_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "rating_history" ALTER COLUMN "match_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rating_ledger" ALTER COLUMN "match_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "rating_history" ADD COLUMN "community_match_id" text;--> statement-breakpoint
ALTER TABLE "rating_ledger" ADD COLUMN "community_match_id" text;--> statement-breakpoint
ALTER TABLE "community_attendance" ADD CONSTRAINT "community_attendance_session_id_community_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."community_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_attendance" ADD CONSTRAINT "community_attendance_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_byes" ADD CONSTRAINT "community_byes_session_id_community_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."community_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_games" ADD CONSTRAINT "community_games_host_person_id_people_id_fk" FOREIGN KEY ("host_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_games" ADD CONSTRAINT "community_games_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_matches" ADD CONSTRAINT "community_matches_session_id_community_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."community_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_game_id_community_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."community_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_members" ADD CONSTRAINT "community_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "community_sessions" ADD CONSTRAINT "community_sessions_game_id_community_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."community_games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "community_attendance_session_person_idx" ON "community_attendance" USING btree ("session_id","person_id");--> statement-breakpoint
CREATE INDEX "community_attendance_session_idx" ON "community_attendance" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "community_attendance_person_idx" ON "community_attendance" USING btree ("person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_games_slug_idx" ON "community_games" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "community_games_host_idx" ON "community_games" USING btree ("host_person_id");--> statement-breakpoint
CREATE INDEX "community_matches_session_idx" ON "community_matches" USING btree ("session_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_matches_slot_idx" ON "community_matches" USING btree ("session_id","block","court");--> statement-breakpoint
CREATE UNIQUE INDEX "community_members_game_person_idx" ON "community_members" USING btree ("game_id","person_id");--> statement-breakpoint
CREATE INDEX "community_members_game_idx" ON "community_members" USING btree ("game_id");--> statement-breakpoint
CREATE UNIQUE INDEX "community_sessions_game_date_idx" ON "community_sessions" USING btree ("game_id","date");--> statement-breakpoint
CREATE INDEX "community_sessions_game_idx" ON "community_sessions" USING btree ("game_id");--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_community_match_id_community_matches_id_fk" FOREIGN KEY ("community_match_id") REFERENCES "public"."community_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_ledger" ADD CONSTRAINT "rating_ledger_community_match_id_community_matches_id_fk" FOREIGN KEY ("community_match_id") REFERENCES "public"."community_matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "rating_history_cmatch_person_format_idx" ON "rating_history" USING btree ("community_match_id","person_id","format");--> statement-breakpoint

-- HAND-ADDED, not generated by drizzle-kit.
--
-- Dropping NOT NULL from match_id above is what lets a community result into
-- the rating history, and it also lets in a row that references NEITHER match.
-- Such a row is invisible corruption: a rating moved, and nothing says what
-- moved it — which defeats the whole reason this table exists (spec §9, "when a
-- player disputes a rating the organiser needs to show the working").
--
-- Both existing rows and every tournament row to come have match_id set and
-- community_match_id null, so this validates against current data.
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_one_match_ck"
  CHECK (("match_id" IS NOT NULL) <> ("community_match_id" IS NOT NULL));--> statement-breakpoint
ALTER TABLE "rating_ledger" ADD CONSTRAINT "rating_ledger_one_match_ck"
  CHECK (("match_id" IS NOT NULL) <> ("community_match_id" IS NOT NULL));