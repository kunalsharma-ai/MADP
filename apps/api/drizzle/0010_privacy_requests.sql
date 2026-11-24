CREATE TABLE "erasure_hold" (
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"source_member_id" text NOT NULL,
	"request_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"panel_deleted_at" timestamp with time zone,
	CONSTRAINT "erasure_hold_data_mode_panel_source_member_id_pk" PRIMARY KEY("data_mode","panel","source_member_id")
);
--> statement-breakpoint
CREATE TABLE "privacy_request_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"request_id" uuid NOT NULL,
	"action" text NOT NULL,
	"actor_id" uuid,
	"note" text DEFAULT '' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "privacy_request" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"master_person_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"panels" text[] NOT NULL,
	"status" text DEFAULT 'received' NOT NULL,
	"reference" text NOT NULL,
	"jurisdiction" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"due_at" timestamp with time zone NOT NULL,
	"created_by" uuid NOT NULL,
	"verified_by" uuid,
	"completed_at" timestamp with time zone,
	"result" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "erasure_hold" ADD CONSTRAINT "erasure_hold_request_id_privacy_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "privacy_request_event" ADD CONSTRAINT "privacy_request_event_request_id_privacy_request_id_fk" FOREIGN KEY ("request_id") REFERENCES "public"."privacy_request"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "privacy_request_event_request_idx" ON "privacy_request_event" USING btree ("request_id","at");--> statement-breakpoint
CREATE INDEX "privacy_request_status_idx" ON "privacy_request" USING btree ("data_mode","status","due_at");--> statement-breakpoint
CREATE INDEX "privacy_request_person_idx" ON "privacy_request" USING btree ("master_person_id");--> statement-breakpoint
CREATE TRIGGER privacy_request_event_append_only BEFORE UPDATE OR DELETE ON privacy_request_event
  FOR EACH ROW EXECUTE FUNCTION madp_reject_history_mutation();
