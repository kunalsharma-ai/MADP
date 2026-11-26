ALTER TABLE "admin_role_grant" ALTER COLUMN "brands" SET DATA TYPE text[];--> statement-breakpoint
ALTER TABLE "audit_event" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "automation" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "brand_setting" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "campaign" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "category_membership" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "celebration_date" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "communication_event" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "consent_event" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "consent_record" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "contact_preference" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "dead_letter" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "erasure_hold" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "fatigue_policy" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "import_job" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "insight" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "loyalty_account" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "loyalty_reconciliation" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "message_template" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "panel_connection" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "panel_membership" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "panel" ALTER COLUMN "code" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "questionnaire_draft" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "reward_ledger" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "source_identity" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "source_question_mapping" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "survey_invitation" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "survey_participation" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "sync_checkpoint" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "verification_evidence" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "webhook_inbox" ALTER COLUMN "panel" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "short_name" text;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "site_url" text;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "description" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "built_in" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "status" text DEFAULT 'active' NOT NULL;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "sort" smallint DEFAULT 100 NOT NULL;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "archived_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "archived_by" uuid;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "created_by" uuid;--> statement-breakpoint
ALTER TABLE "panel" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
-- The three built-in panels, before any foreign key points at them. They are mandatory and equal.
INSERT INTO "panel" ("code", "name", "sensitive") VALUES
  ('t2o', 'Turn2Opinion', false), ('mfr', 'MyFrequentRewards', false), ('mho', 'MyHealthOpinions', true)
  ON CONFLICT ("code") DO NOTHING;--> statement-breakpoint
UPDATE "panel" SET "built_in" = true, "status" = 'active',
  "short_name" = CASE "code" WHEN 't2o' THEN 'T2O' WHEN 'mfr' THEN 'MFR' WHEN 'mho' THEN 'MHO' END,
  "site_url" = CASE "code" WHEN 't2o' THEN 'https://www.turn2opinion.com/' WHEN 'mfr' THEN 'https://www.myfrequentrewards.com/'
    WHEN 'mho' THEN 'https://www.myhealthopinions.com/' END,
  "sort" = CASE "code" WHEN 't2o' THEN 1 WHEN 'mfr' THEN 2 WHEN 'mho' THEN 3 END,
  "sensitive" = ("code" = 'mho') OR "sensitive"
  WHERE "code" IN ('t2o', 'mfr', 'mho');--> statement-breakpoint
UPDATE "panel" SET "short_name" = upper("code") WHERE "short_name" IS NULL;--> statement-breakpoint
ALTER TABLE "panel" ALTER COLUMN "short_name" SET NOT NULL;--> statement-breakpoint
ALTER TABLE "panel" ADD CONSTRAINT "panel_code_format" CHECK ("code" ~ '^[a-z][a-z0-9_]{1,15}$');--> statement-breakpoint
ALTER TABLE "panel" ADD CONSTRAINT "panel_status_values" CHECK ("status" IN ('active', 'archived'));--> statement-breakpoint
-- Built-in panels can't be archived, deleted or made non-sensitive (MHO).
CREATE OR REPLACE FUNCTION madp_panel_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.built_in THEN RAISE EXCEPTION 'built-in panel % cannot be deleted', OLD.code; END IF;
    RETURN OLD;
  END IF;
  IF OLD.built_in AND (NEW.status <> 'active' OR NOT NEW.built_in OR NEW.code <> OLD.code) THEN
    RAISE EXCEPTION 'built-in panel % cannot be archived or renamed', OLD.code;
  END IF;
  IF OLD.code = 'mho' AND NOT NEW.sensitive THEN RAISE EXCEPTION 'MHO stays sensitive'; END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;--> statement-breakpoint
CREATE TRIGGER panel_guard BEFORE UPDATE OR DELETE ON "panel" FOR EACH ROW EXECUTE FUNCTION madp_panel_guard();--> statement-breakpoint
ALTER TABLE "automation" ADD CONSTRAINT "automation_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "brand_setting" ADD CONSTRAINT "brand_setting_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "campaign" ADD CONSTRAINT "campaign_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "category_membership" ADD CONSTRAINT "category_membership_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "celebration_date" ADD CONSTRAINT "celebration_date_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "communication_event" ADD CONSTRAINT "communication_event_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_event" ADD CONSTRAINT "consent_event_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contact_preference" ADD CONSTRAINT "contact_preference_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter" ADD CONSTRAINT "dead_letter_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "erasure_hold" ADD CONSTRAINT "erasure_hold_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "fatigue_policy" ADD CONSTRAINT "fatigue_policy_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_job" ADD CONSTRAINT "import_job_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insight" ADD CONSTRAINT "insight_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD CONSTRAINT "loyalty_account_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "loyalty_reconciliation" ADD CONSTRAINT "loyalty_reconciliation_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_connection" ADD CONSTRAINT "panel_connection_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_membership" ADD CONSTRAINT "panel_membership_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "questionnaire_draft" ADD CONSTRAINT "questionnaire_draft_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_identity" ADD CONSTRAINT "source_identity_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_question_mapping" ADD CONSTRAINT "source_question_mapping_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_participation" ADD CONSTRAINT "survey_participation_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_checkpoint" ADD CONSTRAINT "sync_checkpoint_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "verification_evidence" ADD CONSTRAINT "verification_evidence_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "webhook_inbox" ADD CONSTRAINT "webhook_inbox_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
DROP TYPE "public"."panel_code";