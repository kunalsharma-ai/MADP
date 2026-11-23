CREATE TYPE "public"."admin_role" AS ENUM('super_admin', 'platform_admin', 'data_steward', 'privacy_officer', 'analyst', 'support');--> statement-breakpoint
CREATE TYPE "public"."audience_category" AS ENUM('consumer', 'business_professional', 'healthcare_professional', 'patient', 'caregiver');--> statement-breakpoint
CREATE TYPE "public"."consent_status" AS ENUM('granted', 'denied', 'withdrawn', 'unknown');--> statement-breakpoint
CREATE TYPE "public"."data_mode" AS ENUM('demo', 'live');--> statement-breakpoint
CREATE TYPE "public"."job_status" AS ENUM('queued', 'running', 'succeeded', 'failed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."panel_code" AS ENUM('t2o', 'mfr', 'mho');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'rejected', 'needs_info');--> statement-breakpoint
CREATE TYPE "public"."sensitivity" AS ENUM('standard', 'personal', 'special_category');--> statement-breakpoint
CREATE TYPE "public"."verification_state" AS ENUM('unverified', 'verified', 'rejected');--> statement-breakpoint
CREATE TABLE "admin_user" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"display_name" text NOT NULL,
	"password_hash" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"totp_secret_enc" text,
	"mfa_enabled" boolean DEFAULT false NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"failed_attempts" integer DEFAULT 0 NOT NULL,
	"locked_until" timestamp with time zone,
	"last_login_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "attribute_definition" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"category" "audience_category",
	"value_type" text NOT NULL,
	"sensitivity" "sensitivity" DEFAULT 'standard' NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "audit_event" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"actor_id" uuid,
	"actor_type" text NOT NULL,
	"action" text NOT NULL,
	"target_type" text,
	"target_id" text,
	"outcome" text DEFAULT 'success' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"ip" text
);
--> statement-breakpoint
CREATE TABLE "category_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"master_person_id" uuid NOT NULL,
	"category" "audience_category" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"basis" text NOT NULL,
	"is_minor" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "consent_record" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"master_person_id" uuid NOT NULL,
	"panel" "panel_code" NOT NULL,
	"purpose" text NOT NULL,
	"channel" text,
	"status" "consent_status" NOT NULL,
	"evidence" jsonb NOT NULL,
	"captured_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "identity_match_candidate" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"source_identity_id" uuid NOT NULL,
	"candidate_person_id" uuid NOT NULL,
	"rule" text NOT NULL,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "import_job" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"kind" text NOT NULL,
	"dry_run" boolean DEFAULT false NOT NULL,
	"status" "job_status" DEFAULT 'queued' NOT NULL,
	"requested_by" uuid,
	"counts" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"error" text,
	"started_at" timestamp with time zone,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "master_person" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"country" text,
	"state" text,
	"city" text,
	"birth_year" smallint,
	"gender" text,
	"status" text DEFAULT 'active' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "outbox" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"topic" text NOT NULL,
	"payload" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"published_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "panel_membership" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"master_person_id" uuid NOT NULL,
	"panel" "panel_code" NOT NULL,
	"source_identity_id" uuid NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"joined_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "panel" (
	"code" "panel_code" PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"sensitive" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_identity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"source_member_id" text NOT NULL,
	"source_respondent_ref" text,
	"master_person_id" uuid NOT NULL,
	"source_category" text NOT NULL,
	"email_hash" text,
	"email_enc" text,
	"email_masked" text,
	"phone_enc" text,
	"first_name_enc" text,
	"last_name_enc" text,
	"date_of_birth_enc" text,
	"email_verification" "verification_state" DEFAULT 'unverified' NOT NULL,
	"phone_verification" "verification_state" DEFAULT 'unverified' NOT NULL,
	"quality_score" integer,
	"source_active" boolean DEFAULT true NOT NULL,
	"source_created_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"last_import_job_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "source_question_mapping" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"source_question_id" text NOT NULL,
	"question_version" integer NOT NULL,
	"suggested_attribute_key" text,
	"suggestion_basis" text,
	"attribute_key" text,
	"status" "review_status" DEFAULT 'pending' NOT NULL,
	"value_map" jsonb,
	"notes" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_checkpoint" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"stream" text NOT NULL,
	"cursor" text,
	"last_success_at" timestamp with time zone,
	"last_job_id" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "webhook_inbox" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel" "panel_code" NOT NULL,
	"idempotency_key" text NOT NULL,
	"event_type" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"signature_valid" boolean NOT NULL,
	"payload_ref" text NOT NULL,
	"processed_at" timestamp with time zone,
	"error" text
);
--> statement-breakpoint
ALTER TABLE "category_membership" ADD CONSTRAINT "category_membership_master_person_id_master_person_id_fk" FOREIGN KEY ("master_person_id") REFERENCES "public"."master_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "consent_record" ADD CONSTRAINT "consent_record_master_person_id_master_person_id_fk" FOREIGN KEY ("master_person_id") REFERENCES "public"."master_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_match_candidate" ADD CONSTRAINT "identity_match_candidate_source_identity_id_source_identity_id_fk" FOREIGN KEY ("source_identity_id") REFERENCES "public"."source_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "identity_match_candidate" ADD CONSTRAINT "identity_match_candidate_candidate_person_id_master_person_id_fk" FOREIGN KEY ("candidate_person_id") REFERENCES "public"."master_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_membership" ADD CONSTRAINT "panel_membership_master_person_id_master_person_id_fk" FOREIGN KEY ("master_person_id") REFERENCES "public"."master_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "panel_membership" ADD CONSTRAINT "panel_membership_source_identity_id_source_identity_id_fk" FOREIGN KEY ("source_identity_id") REFERENCES "public"."source_identity"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_identity" ADD CONSTRAINT "source_identity_master_person_id_master_person_id_fk" FOREIGN KEY ("master_person_id") REFERENCES "public"."master_person"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_question_mapping" ADD CONSTRAINT "source_question_mapping_suggested_attribute_key_attribute_definition_key_fk" FOREIGN KEY ("suggested_attribute_key") REFERENCES "public"."attribute_definition"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "source_question_mapping" ADD CONSTRAINT "source_question_mapping_attribute_key_attribute_definition_key_fk" FOREIGN KEY ("attribute_key") REFERENCES "public"."attribute_definition"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_event_at_idx" ON "audit_event" USING btree ("at");--> statement-breakpoint
CREATE INDEX "audit_event_actor_idx" ON "audit_event" USING btree ("actor_id");--> statement-breakpoint
CREATE UNIQUE INDEX "category_membership_key" ON "category_membership" USING btree ("master_person_id","category","panel");--> statement-breakpoint
CREATE INDEX "consent_person_idx" ON "consent_record" USING btree ("master_person_id","panel","purpose");--> statement-breakpoint
CREATE INDEX "master_person_mode_country_idx" ON "master_person" USING btree ("data_mode","country");--> statement-breakpoint
CREATE UNIQUE INDEX "panel_membership_identity_key" ON "panel_membership" USING btree ("source_identity_id");--> statement-breakpoint
CREATE INDEX "panel_membership_person_idx" ON "panel_membership" USING btree ("master_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "source_identity_source_key" ON "source_identity" USING btree ("data_mode","panel","source_member_id");--> statement-breakpoint
CREATE INDEX "source_identity_email_hash_idx" ON "source_identity" USING btree ("data_mode","email_hash");--> statement-breakpoint
CREATE INDEX "source_identity_person_idx" ON "source_identity" USING btree ("master_person_id");--> statement-breakpoint
CREATE UNIQUE INDEX "mapping_question_version_key" ON "source_question_mapping" USING btree ("data_mode","panel","source_question_id","question_version");--> statement-breakpoint
CREATE UNIQUE INDEX "sync_checkpoint_key" ON "sync_checkpoint" USING btree ("data_mode","panel","stream");--> statement-breakpoint
CREATE UNIQUE INDEX "webhook_inbox_idem" ON "webhook_inbox" USING btree ("panel","idempotency_key");