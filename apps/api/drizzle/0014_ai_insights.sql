CREATE TABLE "insight" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"rule" text NOT NULL,
	"severity" text NOT NULL,
	"title" text NOT NULL,
	"detail" text NOT NULL,
	"recommendation" text NOT NULL,
	"link" text,
	"evidence" jsonb NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"first_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"decision_note" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX "insight_open_uq" ON "insight" USING btree ("data_mode","panel","rule") WHERE status = 'open';--> statement-breakpoint
CREATE INDEX "insight_status_idx" ON "insight" USING btree ("data_mode","status","last_seen_at");--> statement-breakpoint
-- Insights permissions on the built-in roles (matches src/auth/permissions.ts DEFAULT_ROLES).
UPDATE "admin_role" SET "permissions" = "permissions" || ARRAY['insights.read', 'insights.review']::text[]
  WHERE "system" AND "key" IN ('super_admin', 'brand_admin', 'panel_manager', 'data_steward', 'privacy_officer')
  AND NOT ('insights.read' = ANY("permissions"));--> statement-breakpoint
UPDATE "admin_role" SET "permissions" = "permissions" || ARRAY['insights.read']::text[]
  WHERE "system" AND "key" IN ('platform_admin', 'analyst') AND NOT ('insights.read' = ANY("permissions"));
