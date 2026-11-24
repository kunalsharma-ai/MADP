CREATE TABLE "consent_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"master_person_id" uuid NOT NULL,
	"panel" "panel_code" NOT NULL,
	"purpose" text NOT NULL,
	"previous_status" "consent_status",
	"status" "consent_status" NOT NULL,
	"evidence" jsonb NOT NULL,
	"captured_at" timestamp with time zone,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "contact_preference" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel_membership_id" uuid NOT NULL,
	"panel" "panel_code" NOT NULL,
	"channel" text NOT NULL,
	"status" text NOT NULL,
	"source" text NOT NULL,
	"reason" text NOT NULL,
	"recorded_by" uuid NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "contact_preference" ADD CONSTRAINT "contact_preference_panel_membership_id_panel_membership_id_fk" FOREIGN KEY ("panel_membership_id") REFERENCES "public"."panel_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "consent_event_person_idx" ON "consent_event" USING btree ("master_person_id","panel");--> statement-breakpoint
CREATE INDEX "consent_event_at_idx" ON "consent_event" USING btree ("data_mode","panel","at");--> statement-breakpoint
CREATE INDEX "contact_preference_membership_idx" ON "contact_preference" USING btree ("panel_membership_id","channel","recorded_at");--> statement-breakpoint
-- Every change to a current consent record appends its history, whichever code path made it.
CREATE OR REPLACE FUNCTION madp_consent_history() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' OR NEW.status IS DISTINCT FROM OLD.status OR (NEW.evidence - 'importJobId') IS DISTINCT FROM (OLD.evidence - 'importJobId') THEN
    -- A re-read that only names a new import job is not a change.
    INSERT INTO consent_event (data_mode, master_person_id, panel, purpose, previous_status, status, evidence, captured_at)
    VALUES (NEW.data_mode, NEW.master_person_id, NEW.panel, NEW.purpose,
      CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END, NEW.status, NEW.evidence, NEW.captured_at);
  ELSIF NEW.master_person_id IS DISTINCT FROM OLD.master_person_id THEN
    -- An identity merge or unmerge moved the record: note it on the person it moved to.
    INSERT INTO consent_event (data_mode, master_person_id, panel, purpose, previous_status, status, evidence, captured_at)
    VALUES (NEW.data_mode, NEW.master_person_id, NEW.panel, NEW.purpose, OLD.status, NEW.status,
      NEW.evidence || jsonb_build_object('movedFromPerson', OLD.master_person_id), NEW.captured_at);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_record_history AFTER INSERT OR UPDATE ON consent_record
  FOR EACH ROW EXECUTE FUNCTION madp_consent_history();
--> statement-breakpoint
-- Backfill: the records that exist now are the first entry of their history.
INSERT INTO consent_event (data_mode, master_person_id, panel, purpose, previous_status, status, evidence, captured_at, at)
  SELECT data_mode, master_person_id, panel, purpose, NULL, status, evidence, captured_at, created_at FROM consent_record;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION madp_reject_history_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION '% is append-only (% rejected)', TG_TABLE_NAME, TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER consent_event_append_only BEFORE UPDATE OR DELETE ON consent_event
  FOR EACH ROW EXECUTE FUNCTION madp_reject_history_mutation();
--> statement-breakpoint
CREATE TRIGGER contact_preference_append_only BEFORE UPDATE OR DELETE ON contact_preference
  FOR EACH ROW EXECUTE FUNCTION madp_reject_history_mutation();
