CREATE TABLE "loyalty_account" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"panel_membership_id" uuid NOT NULL,
	"source_member_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "loyalty_reconciliation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"repaired" boolean NOT NULL,
	"report" jsonb NOT NULL,
	"requested_by" uuid,
	"at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reward_ledger" (
	"id" bigserial PRIMARY KEY NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"account_id" uuid NOT NULL,
	"source_kind" text NOT NULL,
	"source_ref" text NOT NULL,
	"seq" integer NOT NULL,
	"bucket" text NOT NULL,
	"points" integer NOT NULL,
	"entry_kind" text NOT NULL,
	"category" text NOT NULL,
	"reference" text,
	"source_status" text,
	"source_updated_at" timestamp with time zone,
	"import_job_id" uuid,
	"decided_by" uuid,
	"note" text,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_participation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"panel_membership_id" uuid NOT NULL,
	"source_response_id" text NOT NULL,
	"survey_slug" text,
	"status" text NOT NULL,
	"points" integer DEFAULT 0 NOT NULL,
	"loi" real,
	"source" text,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"source_updated_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "loyalty_account" ADD CONSTRAINT "loyalty_account_panel_membership_id_panel_membership_id_fk" FOREIGN KEY ("panel_membership_id") REFERENCES "public"."panel_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_ledger" ADD CONSTRAINT "reward_ledger_account_id_loyalty_account_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."loyalty_account"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_participation" ADD CONSTRAINT "survey_participation_panel_membership_id_panel_membership_id_fk" FOREIGN KEY ("panel_membership_id") REFERENCES "public"."panel_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_account_membership_key" ON "loyalty_account" USING btree ("panel_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "loyalty_account_source_key" ON "loyalty_account" USING btree ("data_mode","panel","source_member_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_ledger_source_seq_key" ON "reward_ledger" USING btree ("data_mode","panel","source_kind","source_ref","seq");--> statement-breakpoint
CREATE INDEX "reward_ledger_account_idx" ON "reward_ledger" USING btree ("account_id","recorded_at");--> statement-breakpoint
CREATE INDEX "reward_ledger_panel_bucket_idx" ON "reward_ledger" USING btree ("data_mode","panel","bucket");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_participation_source_key" ON "survey_participation" USING btree ("data_mode","panel","source_response_id");--> statement-breakpoint
CREATE INDEX "survey_participation_membership_idx" ON "survey_participation" USING btree ("panel_membership_id","ended_at");--> statement-breakpoint
-- reward_ledger is append-only: a change at the source is a new line, never an edit.
CREATE OR REPLACE FUNCTION madp_reject_ledger_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'reward_ledger is append-only (% rejected)', TG_OP;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER reward_ledger_append_only BEFORE UPDATE OR DELETE ON reward_ledger
  FOR EACH ROW EXECUTE FUNCTION madp_reject_ledger_mutation();
--> statement-breakpoint
CREATE TRIGGER reward_ledger_no_truncate BEFORE TRUNCATE ON reward_ledger
  FOR EACH STATEMENT EXECUTE FUNCTION madp_reject_ledger_mutation();
