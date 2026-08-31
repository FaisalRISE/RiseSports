CREATE TABLE "people" (
	"id" text PRIMARY KEY NOT NULL,
	"phone" text,
	"phone_verified" boolean DEFAULT false NOT NULL,
	"name" text NOT NULL,
	"gender" text DEFAULT 'M' NOT NULL,
	"rise_ratings" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"rise_best" integer,
	"match_count" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"reliability" integer,
	"partner_stats" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"last_played_at" timestamp with time zone,
	"flags" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"dupr_x100" integer,
	"dupr_entered_at" timestamp with time zone,
	"seed_source" text,
	"seeded_by" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_history" (
	"id" text PRIMARY KEY NOT NULL,
	"person_id" text NOT NULL,
	"format" text NOT NULL,
	"match_id" text NOT NULL,
	"rating_before" integer NOT NULL,
	"rating_after" integer NOT NULL,
	"delta_applied" integer NOT NULL,
	"expected_x1000" integer NOT NULL,
	"margin_x1000" integer NOT NULL,
	"stage_x1000" integer NOT NULL,
	"verification_x1000" integer NOT NULL,
	"provisional_x1000" integer NOT NULL,
	"notes" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rating_ledger" (
	"id" text PRIMARY KEY NOT NULL,
	"match_id" text NOT NULL,
	"imbalance" integer NOT NULL,
	"reason" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "players" ADD COLUMN "person_id" text;--> statement-breakpoint
ALTER TABLE "people" ADD CONSTRAINT "people_seeded_by_users_id_fk" FOREIGN KEY ("seeded_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_history" ADD CONSTRAINT "rating_history_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "rating_ledger" ADD CONSTRAINT "rating_ledger_match_id_matches_id_fk" FOREIGN KEY ("match_id") REFERENCES "public"."matches"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "people_phone_idx" ON "people" USING btree ("phone");--> statement-breakpoint
CREATE INDEX "people_name_idx" ON "people" USING btree ("name");--> statement-breakpoint
CREATE UNIQUE INDEX "rating_history_match_person_format_idx" ON "rating_history" USING btree ("match_id","person_id","format");--> statement-breakpoint
CREATE INDEX "rating_history_person_idx" ON "rating_history" USING btree ("person_id");--> statement-breakpoint
CREATE INDEX "rating_ledger_match_idx" ON "rating_ledger" USING btree ("match_id");--> statement-breakpoint
ALTER TABLE "players" ADD CONSTRAINT "players_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;