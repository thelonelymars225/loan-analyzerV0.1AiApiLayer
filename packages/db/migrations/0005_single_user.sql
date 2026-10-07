ALTER TABLE "documents" RENAME COLUMN "uploaded_by" TO "user_id";--> statement-breakpoint
ALTER TABLE "ratings" RENAME COLUMN "created_by" TO "user_id";--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_org_id_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "documents" DROP CONSTRAINT "documents_uploaded_by_users_id_fk";
--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_org_id_orgs_id_fk";
--> statement-breakpoint
ALTER TABLE "ratings" DROP CONSTRAINT "ratings_created_by_users_id_fk";
--> statement-breakpoint
DROP INDEX "audit_events_org_at_idx";--> statement-breakpoint
DROP INDEX "documents_org_idx";--> statement-breakpoint
DROP INDEX "documents_uploaded_by_idx";--> statement-breakpoint
DROP INDEX "ratings_org_created_idx";--> statement-breakpoint
DROP INDEX "ratings_created_by_idx";--> statement-breakpoint
UPDATE "audit_events" SET "user_id" = "documents"."user_id" FROM "documents" WHERE "audit_events"."user_id" IS NULL AND "audit_events"."target_id" = "documents"."id";--> statement-breakpoint
ALTER TABLE "audit_events" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "ratings" ALTER COLUMN "user_id" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD CONSTRAINT "documents_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ratings" ADD CONSTRAINT "ratings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "documents_user_idx" ON "documents" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "ratings_user_created_idx" ON "ratings" USING btree ("user_id","created_at");--> statement-breakpoint
ALTER TABLE "audit_events" DROP COLUMN "org_id";--> statement-breakpoint
ALTER TABLE "documents" DROP COLUMN "org_id";--> statement-breakpoint
ALTER TABLE "ratings" DROP COLUMN "org_id";--> statement-breakpoint
ALTER TABLE "sessions" DROP COLUMN "active_organization_id";--> statement-breakpoint
DROP TABLE "invitations" CASCADE;--> statement-breakpoint
DROP TABLE "memberships" CASCADE;--> statement-breakpoint
DROP TABLE "orgs" CASCADE;
