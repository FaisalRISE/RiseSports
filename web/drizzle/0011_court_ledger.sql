CREATE TABLE "ledger_books" (
	"id" text PRIMARY KEY NOT NULL,
	"slug" text NOT NULL,
	"name" text NOT NULL,
	"created_by" text,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"payer_id" text NOT NULL,
	"participant_ids" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"type" text DEFAULT 'OTHER' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"venue" text DEFAULT '' NOT NULL,
	"date" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_members" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"name" text NOT NULL,
	"person_id" text,
	"position" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ledger_payments" (
	"id" text PRIMARY KEY NOT NULL,
	"book_id" text NOT NULL,
	"from_id" text NOT NULL,
	"to_id" text NOT NULL,
	"amount_paise" integer NOT NULL,
	"method" text DEFAULT 'UPI' NOT NULL,
	"status" text DEFAULT 'PENDING' NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"date" text NOT NULL,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ledger_books" ADD CONSTRAINT "ledger_books_created_by_users_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."users"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_book_id_ledger_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."ledger_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_entries" ADD CONSTRAINT "ledger_entries_payer_id_ledger_members_id_fk" FOREIGN KEY ("payer_id") REFERENCES "public"."ledger_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_members" ADD CONSTRAINT "ledger_members_book_id_ledger_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."ledger_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_members" ADD CONSTRAINT "ledger_members_person_id_people_id_fk" FOREIGN KEY ("person_id") REFERENCES "public"."people"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_payments" ADD CONSTRAINT "ledger_payments_book_id_ledger_books_id_fk" FOREIGN KEY ("book_id") REFERENCES "public"."ledger_books"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_payments" ADD CONSTRAINT "ledger_payments_from_id_ledger_members_id_fk" FOREIGN KEY ("from_id") REFERENCES "public"."ledger_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ledger_payments" ADD CONSTRAINT "ledger_payments_to_id_ledger_members_id_fk" FOREIGN KEY ("to_id") REFERENCES "public"."ledger_members"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "ledger_books_slug_idx" ON "ledger_books" USING btree ("slug");--> statement-breakpoint
CREATE INDEX "ledger_entries_book_idx" ON "ledger_entries" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "ledger_entries_date_idx" ON "ledger_entries" USING btree ("book_id","date");--> statement-breakpoint
CREATE INDEX "ledger_members_book_idx" ON "ledger_members" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "ledger_payments_book_idx" ON "ledger_payments" USING btree ("book_id");--> statement-breakpoint
CREATE INDEX "ledger_payments_status_idx" ON "ledger_payments" USING btree ("book_id","status");--> statement-breakpoint

-- HAND-ADDED, in the SAME migration as the tables. drizzle-kit does not emit
-- row-level security and a new table defaults to RLS OFF, while Supabase grants
-- `anon` full SELECT/INSERT/UPDATE/DELETE on everything in `public` — so a gap
-- between CREATE and ENABLE is a window in which these are world-writable by
-- the anon key published in the legacy app's HTML.
--
-- A ledger is the most personal data in the product: who owes whom, how much,
-- and whether they have paid.
--
-- RLS on with NO policy shuts PostgREST off entirely. The app connects as the
-- table OWNER through the pooler and owners bypass RLS, so nothing changes for
-- it. Adding a policy would OPEN these — see CLAUDE.md, "Supabase backend".
ALTER TABLE "ledger_books" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_members" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_entries" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "ledger_payments" ENABLE ROW LEVEL SECURITY;
