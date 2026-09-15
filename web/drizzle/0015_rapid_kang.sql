ALTER TABLE "people" ADD COLUMN "hide_tags" boolean DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX "skill_endorsements_tag_idx" ON "skill_endorsements" USING btree ("sport","tag");--> statement-breakpoint
/* Two tags renamed. Rows store the tag TEXT, so the ones already saved have to
   move with the vocabulary or they keep displaying the old wording until their
   rater happens to save again.

   Done now because it is the last cheap moment: endorsements are visible on one
   profile card and nowhere else, and the next change puts them on the roster.

   `on conflict` is not needed — the unique index is on
   (subject, rater, sport, tag), and nobody can hold both the old and the new
   string for the same subject because the new one did not exist until now. */
UPDATE "skill_endorsements" SET "tag" = 'Lob Specialist' WHERE "tag" = 'Serial Lobber';--> statement-breakpoint
UPDATE "skill_endorsements" SET "tag" = 'Comeback Artist' WHERE "tag" = 'Comeback King';
