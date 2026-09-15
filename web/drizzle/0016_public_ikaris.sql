DROP INDEX "skill_endorsements_tag_idx";--> statement-breakpoint
ALTER TABLE "people" ADD COLUMN "endorsement_policy" text DEFAULT 'played' NOT NULL;