CREATE TABLE "audience_segment" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"minors" boolean DEFAULT false NOT NULL,
	"built_in" boolean DEFAULT false NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"sort" smallint DEFAULT 100 NOT NULL,
	"archived_at" timestamp with time zone,
	"archived_by" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "segment_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel" text NOT NULL,
	"source_value" text NOT NULL,
	"segment" text NOT NULL,
	"minor" boolean DEFAULT false NOT NULL,
	"evidence" text DEFAULT '' NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
INSERT INTO "audience_segment" (key, label, description, minors, built_in, sort) VALUES
  ('consumer', 'Consumers', 'Adults answering consumer surveys (source category b2c).', false, true, 1),
  ('business_professional', 'Business Professionals', 'Working professionals (source category b2b).', false, true, 2),
  ('healthcare_professional', 'Healthcare Professionals', 'Doctors, nurses and other healthcare workers on MHO.', false, true, 3),
  ('patient', 'Patients', 'People answering about their own health on MHO.', false, true, 4),
  ('caregiver', 'Caregivers', 'People caring for a patient, on MHO.', false, true, 5),
  ('teen', 'Teens', 'Members under 18 (source categories minor and minor patient). Minor rules always apply.', true, true, 6)
ON CONFLICT (key) DO NOTHING;--> statement-breakpoint
ALTER TABLE "attribute_definition" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "category_membership" ALTER COLUMN "category" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "segment_rule" ADD CONSTRAINT "segment_rule_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "segment_rule" ADD CONSTRAINT "segment_rule_segment_audience_segment_key_fk" FOREIGN KEY ("segment") REFERENCES "public"."audience_segment"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "segment_rule_key" ON "segment_rule" USING btree ("panel","source_value","segment");--> statement-breakpoint
INSERT INTO "segment_rule" (panel, source_value, segment, minor, evidence) VALUES
  ('t2o', 'b2c', 'consumer', false, 'User.category default "b2c" (backend/app/model/User.js)'),
  ('t2o', 'b2b', 'business_professional', false, 'Category lookup {name: {$in: ["b2c","b2b"]}} in integrationRoutes.js'),
  ('t2o', 'minor', 'consumer', true, 'User.registrationStatus virtual treats category "minor" as Teen'),
  ('t2o', 'minor', 'teen', true, 'Teens segment (Kunal, 26 Nov 2026)'),
  ('mfr', 'b2c', 'consumer', false, 'User.category default "b2c" (api/app/model/User.js)'),
  ('mfr', 'b2b', 'business_professional', false, 'frontend-1 WORLD_QUESTIONS comment: "category b2b / b2c"'),
  ('mfr', 'minor', 'consumer', true, 'User.name.last required unless category includes "minor"'),
  ('mfr', 'minor', 'teen', true, 'Teens segment (Kunal, 26 Nov 2026)'),
  ('mho', 'healthcare professional', 'healthcare_professional', false, 'sections/hcp/data-source/*.Question.json category values'),
  ('mho', 'patient', 'patient', false, 'sections/hcp/data-source/*.Question.json category values'),
  ('mho', 'care giver', 'caregiver', false, 'sections/hcp/data-source/*.Question.json category values'),
  ('mho', 'minor patient', 'patient', true, 'sections/hcp/data-source/*.Question.json category values'),
  ('mho', 'minor patient', 'teen', true, 'Teens segment (Kunal, 26 Nov 2026)')
ON CONFLICT DO NOTHING;--> statement-breakpoint
-- Members already marked as minors join Teens too, next to their adult segment.
INSERT INTO "category_membership" (data_mode, master_person_id, category, panel, basis, is_minor)
  SELECT DISTINCT ON (master_person_id, panel) data_mode, master_person_id, 'teen', panel, basis, true
  FROM "category_membership" WHERE is_minor AND category <> 'teen'
  ORDER BY master_person_id, panel, created_at
ON CONFLICT DO NOTHING;--> statement-breakpoint
ALTER TABLE "attribute_definition" ADD CONSTRAINT "attribute_definition_category_audience_segment_key_fk" FOREIGN KEY ("category") REFERENCES "public"."audience_segment"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_membership" ADD CONSTRAINT "category_membership_category_audience_segment_key_fk" FOREIGN KEY ("category") REFERENCES "public"."audience_segment"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."audience_category";--> statement-breakpoint
ALTER TABLE "audience_segment" ADD CONSTRAINT "audience_segment_key_format" CHECK (key ~ '^[a-z][a-z0-9_]{1,31}$');--> statement-breakpoint
ALTER TABLE "audience_segment" ADD CONSTRAINT "audience_segment_status_values" CHECK (status IN ('active', 'archived'));--> statement-breakpoint
ALTER TABLE "segment_rule" ADD CONSTRAINT "segment_rule_status_values" CHECK (status IN ('active', 'archived'));--> statement-breakpoint
CREATE OR REPLACE FUNCTION madp_segment_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.built_in THEN RAISE EXCEPTION 'built-in segment % cannot be deleted', OLD.key; END IF;
    RETURN OLD;
  END IF;
  IF OLD.built_in AND (NOT NEW.built_in OR NEW.key <> OLD.key) THEN
    RAISE EXCEPTION 'built-in segment % cannot be re-keyed', OLD.key;
  END IF;
  IF OLD.key = 'teen' AND NOT NEW.minors THEN RAISE EXCEPTION 'Teens stays a minors segment'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER audience_segment_guard BEFORE UPDATE OR DELETE ON "audience_segment" FOR EACH ROW EXECUTE FUNCTION madp_segment_guard();