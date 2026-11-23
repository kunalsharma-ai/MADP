CREATE TABLE "dead_letter" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"import_job_id" uuid,
	"stream" text NOT NULL,
	"source_member_ids" jsonb NOT NULL,
	"error_kind" text NOT NULL,
	"error" text NOT NULL,
	"attempts" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"last_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dead_letter" ADD CONSTRAINT "dead_letter_import_job_id_import_job_id_fk" FOREIGN KEY ("import_job_id") REFERENCES "public"."import_job"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "dead_letter_open_idx" ON "dead_letter" USING btree ("data_mode","panel","status");