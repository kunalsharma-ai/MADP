CREATE TABLE "verification_evidence" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel_membership_id" uuid NOT NULL,
	"panel" "panel_code" NOT NULL,
	"claim" text NOT NULL,
	"method" text NOT NULL,
	"reference" text NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"expires_on" date,
	"recorded_by" uuid NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_panel_membership_id_panel_membership_id_fk" FOREIGN KEY ("panel_membership_id") REFERENCES "public"."panel_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "verification_evidence_status_idx" ON "verification_evidence" USING btree ("data_mode","panel","status");--> statement-breakpoint
CREATE INDEX "verification_evidence_membership_idx" ON "verification_evidence" USING btree ("panel_membership_id");--> statement-breakpoint
-- Verification permissions on the built-in roles (matches src/auth/permissions.ts DEFAULT_ROLES).
UPDATE "admin_role" SET "permissions" = "permissions" || ARRAY['verification.read', 'verification.review']::text[]
  WHERE "system" AND "key" IN ('super_admin', 'brand_admin', 'data_steward', 'privacy_officer')
  AND NOT ('verification.read' = ANY("permissions"));--> statement-breakpoint
UPDATE "admin_role" SET "permissions" = "permissions" || ARRAY['verification.read']::text[]
  WHERE "system" AND "key" = 'panel_manager' AND NOT ('verification.read' = ANY("permissions"));
