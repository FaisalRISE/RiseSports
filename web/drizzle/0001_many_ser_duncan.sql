CREATE TABLE "groups" (
	"id" text PRIMARY KEY NOT NULL,
	"tournament_id" text NOT NULL,
	"key" text NOT NULL,
	"name" text,
	"court" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "group_id" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "slot_a" text;--> statement-breakpoint
ALTER TABLE "matches" ADD COLUMN "slot_b" text;--> statement-breakpoint
ALTER TABLE "groups" ADD CONSTRAINT "groups_tournament_id_tournaments_id_fk" FOREIGN KEY ("tournament_id") REFERENCES "public"."tournaments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "groups_tournament_idx" ON "groups" USING btree ("tournament_id");--> statement-breakpoint
CREATE UNIQUE INDEX "groups_key_idx" ON "groups" USING btree ("tournament_id","key");--> statement-breakpoint
ALTER TABLE "matches" ADD CONSTRAINT "matches_group_id_groups_id_fk" FOREIGN KEY ("group_id") REFERENCES "public"."groups"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "matches_group_idx" ON "matches" USING btree ("group_id");