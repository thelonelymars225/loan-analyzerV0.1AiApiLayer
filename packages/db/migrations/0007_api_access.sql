ALTER TABLE "users" ADD COLUMN "api_access" boolean DEFAULT false NOT NULL;--> statement-breakpoint
-- Whoever already made a key keeps using the API.
UPDATE "users" SET "api_access" = true WHERE "id" IN (SELECT "reference_id" FROM "api_keys");
