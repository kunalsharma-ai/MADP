CREATE TABLE "identity_link_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"action" text NOT NULL,
	"source_identity_id" uuid NOT NULL,
	"from_person_id" uuid NOT NULL,
	"to_person_id" uuid NOT NULL,
	"candidate_id" uuid,
	"reason" text,
	"actor_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "master_person" ADD COLUMN "field_sources" jsonb;--> statement-breakpoint
ALTER TABLE "source_identity" ADD COLUMN "country" text;--> statement-breakpoint
ALTER TABLE "source_identity" ADD COLUMN "state" text;--> statement-breakpoint
ALTER TABLE "source_identity" ADD COLUMN "city" text;--> statement-breakpoint
ALTER TABLE "source_identity" ADD COLUMN "gender" text;--> statement-breakpoint
ALTER TABLE "source_identity" ADD COLUMN "birth_year" smallint;--> statement-breakpoint
ALTER TABLE "identity_link_event" ADD CONSTRAINT "identity_link_event_source_identity_id_source_identity_id_fk" FOREIGN KEY ("source_identity_id") REFERENCES "public"."source_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link_event" ADD CONSTRAINT "identity_link_event_from_person_id_master_person_id_fk" FOREIGN KEY ("from_person_id") REFERENCES "public"."master_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link_event" ADD CONSTRAINT "identity_link_event_to_person_id_master_person_id_fk" FOREIGN KEY ("to_person_id") REFERENCES "public"."master_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_link_event" ADD CONSTRAINT "identity_link_event_candidate_id_identity_match_candidate_id_fk" FOREIGN KEY ("candidate_id") REFERENCES "public"."identity_match_candidate"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "identity_link_event_identity_idx" ON "identity_link_event" USING btree ("source_identity_id","created_at");--> statement-breakpoint
CREATE INDEX "identity_link_event_from_idx" ON "identity_link_event" USING btree ("from_person_id");--> statement-breakpoint
CREATE INDEX "identity_link_event_to_idx" ON "identity_link_event" USING btree ("to_person_id");--> statement-breakpoint
-- identity_link_event is append-only: an unmerge is a new event, never an edit of the merge.
CREATE OR REPLACE FUNCTION madp_reject_link_event_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'identity_link_event is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER identity_link_event_append_only BEFORE UPDATE OR DELETE ON identity_link_event
  FOR EACH ROW EXECUTE FUNCTION madp_reject_link_event_mutation();
