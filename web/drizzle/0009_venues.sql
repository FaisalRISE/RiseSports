CREATE TABLE "venue_bookings" (
	"id" text PRIMARY KEY NOT NULL,
	"venue_id" text NOT NULL,
	"date" text NOT NULL,
	"slot" text NOT NULL,
	"person_id" text,
	"guest_name" text DEFAULT 'Guest' NOT NULL,
	"status" text DEFAULT 'requested' NOT NULL,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "venues" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"area" text DEFAULT '' NOT NULL,
	"courts" integer DEFAULT 2 NOT NULL,
	"open_time" text DEFAULT '06:00' NOT NULL,
	"close_time" text DEFAULT '22:00' NOT NULL,
	"price_paise" integer DEFAULT 0 NOT NULL,
	"owner_person_id" text,
	"created_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "venue_bookings" ADD CONSTRAINT "venue_bookings_venue_id_venues_id_fk" FOREIGN KEY ("venue_id") REFERENCES "public"."venues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venue_bookings" ADD CONSTRAINT "venue_bookings_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_owner_person_id_people_id_fk" FOREIGN KEY ("owner_person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "venues" ADD CONSTRAINT "venues_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "venue_bookings_venue_idx" ON "venue_bookings" USING btree ("venue_id");--> statement-breakpoint
CREATE INDEX "venue_bookings_when_idx" ON "venue_bookings" USING btree ("venue_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "venue_bookings_person_slot_idx" ON "venue_bookings" USING btree ("venue_id","date","slot","person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "venues_slug_idx" ON "venues" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "venues_owner_idx" ON "venues" USING btree ("owner_person_id");--> statement-breakpoint

-- HAND-ADDED, because drizzle-kit does not generate row-level security and a
-- new table defaults to RLS OFF. Supabase grants `anon` full
-- SELECT/INSERT/UPDATE/DELETE on everything in `public`, and that key is
-- published in the legacy app's HTML — so without these two lines both tables
-- would be readable and writable by anyone the moment this is applied. That is
-- not hypothetical; it is exactly what happened to the six community tables in
-- 0006, and 0008 is the migration that cleaned it up.
--
-- RLS on with NO policy denies everything through PostgREST. The app is
-- unaffected: it connects as the table OWNER through the pooler, and owners
-- bypass RLS. Adding a policy would OPEN these tables — don't.
--
-- `venue_bookings` holds guest names typed in by members of the public, which
-- makes it exactly the kind of table that must not be world-readable.
ALTER TABLE "venues" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "venue_bookings" ENABLE ROW LEVEL SECURITY;