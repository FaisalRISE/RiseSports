-- Carry the old `published` flag into the new lifecycle BEFORE dropping it.
-- Generated as a bare DROP; edited by hand, because a generated migration does
-- not know that these two columns mean the same thing. Without this, every
-- previously-published tournament silently becomes a draft and disappears from
-- the public site on deploy.
UPDATE "tournaments" SET "status" = 'live' WHERE "published" = true;
--> statement-breakpoint
ALTER TABLE "tournaments" DROP COLUMN "published";
