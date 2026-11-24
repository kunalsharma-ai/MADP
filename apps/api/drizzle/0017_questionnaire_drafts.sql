CREATE TABLE "questionnaire_draft" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"category" text NOT NULL,
	"slug" text NOT NULL,
	"profile_id" text NOT NULL,
	"note" text,
	"base" jsonb NOT NULL,
	"spec" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid NOT NULL,
	"submitted_by" uuid,
	"submitted_at" timestamp with time zone,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"applied_by" uuid,
	"applied_at" timestamp with time zone,
	"apply_result" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "questionnaire_draft_panel_idx" ON "questionnaire_draft" USING btree ("data_mode","panel","status");--> statement-breakpoint
CREATE UNIQUE INDEX "questionnaire_draft_open_uq" ON "questionnaire_draft" USING btree ("data_mode","panel","category","slug") WHERE status in ('draft', 'review', 'approved');