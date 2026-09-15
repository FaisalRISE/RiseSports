CREATE TABLE "skill_endorsements" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_person_id" text NOT NULL,
	"rater_person_id" text NOT NULL,
	"sport" text NOT NULL,
	"tag" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "skill_ratings" (
	"id" text PRIMARY KEY NOT NULL,
	"subject_person_id" text NOT NULL,
	"rater_person_id" text NOT NULL,
	"sport" text NOT NULL,
	"skill" text NOT NULL,
	"score" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "skill_endorsements" ADD CONSTRAINT "skill_endorsements_subject_person_id_people_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_endorsements" ADD CONSTRAINT "skill_endorsements_rater_person_id_people_id_fk" FOREIGN KEY ("rater_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_subject_person_id_people_id_fk" FOREIGN KEY ("subject_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_rater_person_id_people_id_fk" FOREIGN KEY ("rater_person_id") REFERENCES "public"."people"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "skill_endorsements_subject_idx" ON "skill_endorsements" USING btree ("subject_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_endorsements_one_per_rater_idx" ON "skill_endorsements" USING btree ("subject_person_id","rater_person_id","sport","tag");--> statement-breakpoint
CREATE INDEX "skill_ratings_subject_idx" ON "skill_ratings" USING btree ("subject_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "skill_ratings_one_per_rater_idx" ON "skill_ratings" USING btree ("subject_person_id","rater_person_id","sport","skill");--> statement-breakpoint
/* Hand-added, because drizzle-kit generates NEITHER of these.

   RLS: a new table defaults to row-level security OFF, and Supabase grants
   `anon` full CRUD on everything in `public` — so between CREATE and this line
   these tables are readable and writable by the key published in the old app's
   HTML. It has to be in the SAME migration as the CREATE; a gap is a window.
   The app reaches them as the table owner, and owners bypass RLS.

   The CHECKs are the rules that must hold whatever calls the database:
   a score outside 1-5 is not a rating, and rating yourself is not a peer
   review. Both are enforced in lib/skills too — this is the floor, not the
   only guard. */
ALTER TABLE "skill_ratings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_endorsements" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_score_range"
  CHECK ("score" BETWEEN 1 AND 5);--> statement-breakpoint
ALTER TABLE "skill_ratings" ADD CONSTRAINT "skill_ratings_not_self"
  CHECK ("rater_person_id" <> "subject_person_id");--> statement-breakpoint
ALTER TABLE "skill_endorsements" ADD CONSTRAINT "skill_endorsements_not_self"
  CHECK ("rater_person_id" <> "subject_person_id");
