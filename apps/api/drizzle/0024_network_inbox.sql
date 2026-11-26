CREATE TABLE "network_batch" (
	"panel" text NOT NULL,
	"batch" text NOT NULL,
	"source" text NOT NULL,
	"kind" text NOT NULL,
	"records" integer NOT NULL,
	"created_by" uuid,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "network_batch_panel_batch_pk" PRIMARY KEY("panel","batch")
);
--> statement-breakpoint
CREATE TABLE "network_push_key" (
	"panel" text PRIMARY KEY NOT NULL,
	"secret_enc" text NOT NULL,
	"hint" text NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "network_record" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"data_mode" "data_mode" DEFAULT 'live' NOT NULL,
	"panel" text NOT NULL,
	"kind" text NOT NULL,
	"source_member_id" text,
	"source_question_id" text,
	"payload_enc" text NOT NULL,
	"batch" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "source_type" text DEFAULT 'panel_api' NOT NULL;--> statement-breakpoint
ALTER TABLE "network_batch" ADD CONSTRAINT "network_batch_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_push_key" ADD CONSTRAINT "network_push_key_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "network_record" ADD CONSTRAINT "network_record_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "network_record_feed_idx" ON "network_record" USING btree ("panel","kind","id");--> statement-breakpoint
ALTER TABLE "panel" ADD CONSTRAINT "panel_source_type_values" CHECK (source_type IN ('panel_api', 'inbox'));--> statement-breakpoint
ALTER TABLE "network_record" ADD CONSTRAINT "network_record_kind_values" CHECK (kind IN ('member', 'answer', 'question', 'deletion'));--> statement-breakpoint
ALTER TABLE "network_batch" ADD CONSTRAINT "network_batch_source_values" CHECK (source IN ('upload', 'push'));--> statement-breakpoint
-- The built-in panels run on the shared panel backend.
CREATE OR REPLACE FUNCTION madp_panel_source_guard() RETURNS trigger AS $$
BEGIN
  IF OLD.built_in AND NEW.source_type <> 'panel_api' THEN
    RAISE EXCEPTION 'built-in panel % runs on the shared panel backend', OLD.code;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER panel_source_guard BEFORE UPDATE ON "panel" FOR EACH ROW EXECUTE FUNCTION madp_panel_source_guard();
