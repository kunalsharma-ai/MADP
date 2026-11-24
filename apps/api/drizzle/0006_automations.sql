CREATE TABLE "automation_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"version_id" uuid NOT NULL,
	"dry_run" boolean NOT NULL,
	"as_of" timestamp with time zone NOT NULL,
	"counts" jsonb,
	"error" text,
	"requested_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "automation_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"automation_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"config" jsonb NOT NULL,
	"steps" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"restored_from" uuid,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "automation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"name" text NOT NULL,
	"trigger" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"current_version_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "celebration_date" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel" "panel_code" NOT NULL,
	"name" text NOT NULL,
	"observance" text NOT NULL,
	"on_date" date NOT NULL,
	"countries" text[] NOT NULL,
	"note" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "communication_event" ADD COLUMN "automation_id" uuid;--> statement-breakpoint
ALTER TABLE "communication_event" ADD COLUMN "automation_run_id" uuid;--> statement-breakpoint
ALTER TABLE "communication_event" ADD COLUMN "step" integer;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_run" ADD CONSTRAINT "automation_run_version_id_automation_version_id_fk" FOREIGN KEY ("version_id") REFERENCES "public"."automation_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "automation_version" ADD CONSTRAINT "automation_version_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "automation_version_key" ON "automation_version" USING btree ("automation_id","version");--> statement-breakpoint
CREATE INDEX "automation_panel_idx" ON "automation" USING btree ("data_mode","panel","status");--> statement-breakpoint
CREATE INDEX "celebration_date_panel_idx" ON "celebration_date" USING btree ("panel","on_date");--> statement-breakpoint
ALTER TABLE "communication_event" ADD CONSTRAINT "communication_event_automation_id_automation_id_fk" FOREIGN KEY ("automation_id") REFERENCES "public"."automation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_event" ADD CONSTRAINT "communication_event_automation_run_id_automation_run_id_fk" FOREIGN KEY ("automation_run_id") REFERENCES "public"."automation_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "communication_event_automation_idx" ON "communication_event" USING btree ("automation_id","master_person_id");