CREATE TABLE "campaign_run" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"campaign_id" uuid NOT NULL,
	"dry_run" boolean NOT NULL,
	"counts" jsonb,
	"requested_by" uuid,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "campaign" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"template_version_id" uuid NOT NULL,
	"audience" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"approved_by" uuid,
	"approved_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "communication_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"master_person_id" uuid NOT NULL,
	"panel" "panel_code" NOT NULL,
	"campaign_id" uuid,
	"run_id" uuid,
	"channel" text NOT NULL,
	"state" text NOT NULL,
	"reason" text,
	"dry_run" boolean NOT NULL,
	"planned_for" timestamp with time zone,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fatigue_policy" (
	"panel" "panel_code" PRIMARY KEY NOT NULL,
	"max_per_week" integer DEFAULT 2 NOT NULL,
	"max_per_month" integer DEFAULT 6 NOT NULL,
	"quiet_start_hour" smallint DEFAULT 21 NOT NULL,
	"quiet_end_hour" smallint DEFAULT 8 NOT NULL,
	"bands" jsonb DEFAULT '{"high": 60, "medium": 30}'::jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_template_version" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"template_id" uuid NOT NULL,
	"version" integer NOT NULL,
	"language" text DEFAULT 'en' NOT NULL,
	"subject" text NOT NULL,
	"body_html" text NOT NULL,
	"body_text" text NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"reviewed_by" uuid,
	"reviewed_at" timestamp with time zone,
	"review_note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "message_template" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel" "panel_code" NOT NULL,
	"key" text NOT NULL,
	"name" text NOT NULL,
	"kind" text NOT NULL,
	"channel" text DEFAULT 'email' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "source_identity" ADD COLUMN "timezone" text;--> statement-breakpoint
ALTER TABLE "campaign_run" ADD CONSTRAINT "campaign_run_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_template_version_id_message_template_version_id_fk" FOREIGN KEY ("template_version_id") REFERENCES "public"."message_template_version"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_event" ADD CONSTRAINT "communication_event_master_person_id_master_person_id_fk" FOREIGN KEY ("master_person_id") REFERENCES "public"."master_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_event" ADD CONSTRAINT "communication_event_campaign_id_campaign_id_fk" FOREIGN KEY ("campaign_id") REFERENCES "public"."campaign"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_event" ADD CONSTRAINT "communication_event_run_id_campaign_run_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."campaign_run"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template_version" ADD CONSTRAINT "message_template_version_template_id_message_template_id_fk" FOREIGN KEY ("template_id") REFERENCES "public"."message_template"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "campaign_panel_idx" ON "campaign" USING btree ("data_mode","panel","status");--> statement-breakpoint
CREATE INDEX "communication_event_person_idx" ON "communication_event" USING btree ("master_person_id","occurred_at");--> statement-breakpoint
CREATE INDEX "communication_event_run_idx" ON "communication_event" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "communication_event_panel_state_idx" ON "communication_event" USING btree ("panel","state","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "message_template_version_key" ON "message_template_version" USING btree ("template_id","version");--> statement-breakpoint
CREATE UNIQUE INDEX "message_template_key" ON "message_template" USING btree ("panel","key");