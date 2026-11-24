-- The old single-role column becomes text first, so its enum type (also called admin_role) can go before the
-- admin_role table is created. Grants are copied from it further down, then the column is dropped.
ALTER TABLE "admin_user" ALTER COLUMN "role" TYPE text;
--> statement-breakpoint
DROP TYPE "public"."admin_role";
--> statement-breakpoint
CREATE TABLE "admin_role_grant" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"role_key" text NOT NULL,
	"brands" "panel_code"[],
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_role" (
	"key" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"permissions" text[] DEFAULT '{}'::text[] NOT NULL,
	"system" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "admin_session" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"ip" text,
	"user_agent" text
);
--> statement-breakpoint
CREATE TABLE "brand_setting" (
	"panel" "panel_code" PRIMARY KEY NOT NULL,
	"display_name" text NOT NULL,
	"origins" text[] NOT NULL,
	"languages" text[] DEFAULT '{en}'::text[] NOT NULL,
	"currency" text DEFAULT 'USD' NOT NULL,
	"points_per_currency_unit" integer DEFAULT 1000 NOT NULL,
	"min_redemption_points" integer DEFAULT 15000 NOT NULL,
	"four_eyes_points" integer DEFAULT 50000 NOT NULL,
	"profile_review_months" smallint DEFAULT 6 NOT NULL,
	"archive_after_months" smallint DEFAULT 6 NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "actor_role" text;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "panel" "panel_code";--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "before" jsonb;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "after" jsonb;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "reason" text;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "user_agent" text;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "request_id" text;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "prev_hash" text;--> statement-breakpoint
ALTER TABLE "audit_event" ADD COLUMN "hash" text;--> statement-breakpoint
ALTER TABLE "admin_role_grant" ADD CONSTRAINT "admin_role_grant_admin_id_admin_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_role_grant" ADD CONSTRAINT "admin_role_grant_role_key_admin_role_key_fk" FOREIGN KEY ("role_key") REFERENCES "public"."admin_role"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_session" ADD CONSTRAINT "admin_session_admin_id_admin_user_id_fk" FOREIGN KEY ("admin_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "admin_role_grant_uq" ON "admin_role_grant" USING btree ("admin_id","role_key");--> statement-breakpoint
CREATE INDEX "admin_role_grant_role_idx" ON "admin_role_grant" USING btree ("role_key");--> statement-breakpoint
CREATE INDEX "admin_session_admin_idx" ON "admin_session" USING btree ("admin_id");--> statement-breakpoint
CREATE INDEX "audit_event_action_idx" ON "audit_event" USING btree ("action");--> statement-breakpoint
CREATE INDEX "audit_event_panel_idx" ON "audit_event" USING btree ("panel");--> statement-breakpoint
CREATE INDEX "audit_event_target_idx" ON "audit_event" USING btree ("target_type","target_id");--> statement-breakpoint
-- Built-in roles (generated from src/auth/permissions.ts DEFAULT_ROLES; test/roles.test.ts checks they match).
INSERT INTO "admin_role" ("key", "name", "description", "permissions", "system") VALUES
  ('super_admin', 'Super Admin', 'Everything on every brand, including switches, admin accounts, roles and data export.', ARRAY['dashboard.read', 'audience.counts.read', 'panellists.read', 'panellists.pii.read', 'health.sensitive.read', 'questions.read', 'questions.write', 'mappings.review', 'identity.review', 'communications.read', 'communications.manage', 'communications.approve', 'loyalty.read', 'loyalty.reconcile', 'loyalty.approve', 'service_clients.manage', 'consent.read', 'consent.manage', 'privacy.read', 'privacy.request', 'privacy.execute', 'connectors.read', 'connectors.run', 'imports.run', 'audit.read', 'users.manage', 'members.read', 'members.edit', 'members.status', 'segments.manage', 'quality.manage', 'surveys.read', 'surveys.manage', 'invitations.send', 'qb.read', 'qb.edit', 'qb.publish', 'profiles.manage', 'points.read', 'points.adjust', 'payouts.approve', 'payments.view', 'rewards.manage', 'redemptions.manage', 'support.read', 'support.reply', 'members.resend_email', 'messages.send', 'teen.read', 'teen.review', 'content.manage', 'data_requests.manage', 'switches.read', 'switches.flip', 'brands.manage', 'admins.manage', 'roles.manage', 'pii.view', 'members.impersonate', 'reports.read', 'export.read', 'export.pii']::text[], true),
  ('brand_admin', 'Brand Admin', 'Everything inside the assigned brands except switches and admin accounts.', ARRAY['dashboard.read', 'audience.counts.read', 'panellists.read', 'panellists.pii.read', 'health.sensitive.read', 'questions.read', 'questions.write', 'mappings.review', 'identity.review', 'communications.read', 'communications.manage', 'communications.approve', 'loyalty.read', 'loyalty.reconcile', 'loyalty.approve', 'consent.read', 'consent.manage', 'privacy.read', 'privacy.request', 'privacy.execute', 'connectors.read', 'connectors.run', 'imports.run', 'audit.read', 'members.read', 'members.edit', 'members.status', 'segments.manage', 'quality.manage', 'surveys.read', 'surveys.manage', 'invitations.send', 'qb.read', 'qb.edit', 'qb.publish', 'profiles.manage', 'points.read', 'points.adjust', 'payouts.approve', 'payments.view', 'rewards.manage', 'redemptions.manage', 'support.read', 'support.reply', 'members.resend_email', 'messages.send', 'teen.read', 'teen.review', 'content.manage', 'data_requests.manage', 'switches.read', 'pii.view', 'reports.read', 'export.read']::text[], true),
  ('panel_manager', 'Panel Manager', 'Members, segments, quality, surveys, invitations and profiles. No payouts or full payment details.', ARRAY['dashboard.read', 'audience.counts.read', 'panellists.read', 'members.read', 'members.edit', 'members.status', 'segments.manage', 'quality.manage', 'surveys.read', 'surveys.manage', 'invitations.send', 'qb.read', 'profiles.manage', 'points.read', 'support.read', 'reports.read']::text[], true),
  ('question_bank_editor', 'Question Bank Editor', 'Questions, options, profiles, show-when rules, translations, import and export. No members or points.', ARRAY['dashboard.read', 'questions.read', 'questions.write', 'qb.read', 'qb.edit', 'qb.publish', 'profiles.manage']::text[], true),
  ('rewards_finance', 'Rewards and Finance', 'Redemption queue, catalogue, offers, points adjustments, holds and payout reports. No questions or surveys.', ARRAY['dashboard.read', 'members.read', 'points.read', 'points.adjust', 'payouts.approve', 'payments.view', 'rewards.manage', 'redemptions.manage', 'loyalty.read', 'loyalty.reconcile', 'reports.read']::text[], true),
  ('support_agent', 'Support Agent', 'Tickets, messages, member look-up with masked e-mail and phone, resend e-mails. No points, roles or consent.', ARRAY['dashboard.read', 'members.read', 'support.read', 'support.reply', 'members.resend_email', 'communications.read']::text[], true),
  ('teen_safeguarding', 'Teen Safeguarding', 'Teen registrations, manual review, guardian consent, teen redemptions and teen data requests only.', ARRAY['dashboard.read', 'members.read', 'teen.read', 'teen.review']::text[], true),
  ('read_only_analyst', 'Read Only Analyst', 'Dashboards and reports, exports without personal data. No writes.', ARRAY['dashboard.read', 'audience.counts.read', 'questions.read', 'qb.read', 'surveys.read', 'points.read', 'reports.read', 'export.read']::text[], true),
  ('platform_admin', 'Platform Admin', 'MADP connectors, imports, sync and service clients.', ARRAY['dashboard.read', 'audience.counts.read', 'panellists.read', 'questions.read', 'connectors.read', 'connectors.run', 'imports.run', 'audit.read', 'loyalty.read', 'loyalty.reconcile', 'service_clients.manage']::text[], true),
  ('data_steward', 'Data Steward', 'MADP question registry, mappings and identity review.', ARRAY['dashboard.read', 'audience.counts.read', 'panellists.read', 'questions.read', 'questions.write', 'mappings.review', 'identity.review', 'connectors.read', 'communications.read', 'communications.manage', 'loyalty.read', 'consent.read']::text[], true),
  ('privacy_officer', 'Privacy Officer', 'Personal and health data under purpose limits, identity review, audit, approvals.', ARRAY['dashboard.read', 'audience.counts.read', 'panellists.read', 'panellists.pii.read', 'health.sensitive.read', 'identity.review', 'audit.read', 'connectors.read', 'communications.read', 'communications.approve', 'loyalty.read', 'loyalty.approve', 'consent.read', 'consent.manage', 'privacy.read', 'privacy.request', 'privacy.execute']::text[], true),
  ('analyst', 'Analyst', 'MADP dashboards and counts.', ARRAY['dashboard.read', 'audience.counts.read', 'questions.read']::text[], true),
  ('support', 'Support (MADP)', 'MADP panellist look-up.', ARRAY['dashboard.read', 'panellists.read', 'panellists.pii.read', 'communications.read', 'loyalty.read', 'consent.read', 'consent.manage', 'privacy.read', 'privacy.request']::text[], true);
--> statement-breakpoint
-- Every existing admin keeps the role they had, on every brand.
INSERT INTO "admin_role_grant" ("admin_id", "role_key", "brands")
  SELECT "id", "role", NULL FROM "admin_user";
--> statement-breakpoint
ALTER TABLE "admin_user" DROP COLUMN "role";
--> statement-breakpoint
-- Brand settings. Origins are the hostnames the shared panel backend stores in `origin` (to confirm on a live read).
INSERT INTO "brand_setting" ("panel", "display_name", "origins") VALUES
  ('t2o', 'Turn2Opinion', ARRAY['www.turn2opinion.com', 'turn2opinion.com']),
  ('mfr', 'MyFrequentRewards', ARRAY['www.myfrequentrewards.com', 'myfrequentrewards.com']),
  ('mho', 'MyHealthOpinions', ARRAY['www.myhealthopinions.com', 'myhealthopinions.com']);
--> statement-breakpoint
-- Hash chain. The hash covers every column, as a JSON array so no separator can be forged.
CREATE OR REPLACE FUNCTION madp_audit_hash(prev text, e audit_event) RETURNS text AS $$
  SELECT encode(sha256(convert_to(jsonb_build_array(
    coalesce(prev, ''), e.id, (extract(epoch FROM e.at) * 1000000)::bigint, e.actor_id, e.actor_type, e.actor_role,
    e.panel, e.action, e.target_type, e.target_id, e.outcome, e.metadata, e.before, e.after, e.reason, e.ip,
    e.user_agent, e.request_id
  )::text, 'UTF8')), 'hex');
$$ LANGUAGE sql STABLE;
--> statement-breakpoint
-- Entries are chained in commit order: the lock serialises writers, and the id is taken after the lock so ids
-- follow the chain.
CREATE OR REPLACE FUNCTION madp_audit_chain() RETURNS trigger AS $$
DECLARE
  prev text;
BEGIN
  PERFORM pg_advisory_xact_lock(724300901);
  NEW.id := nextval(pg_get_serial_sequence('audit_event', 'id'));
  SELECT "hash" INTO prev FROM audit_event ORDER BY id DESC LIMIT 1;
  NEW.prev_hash := prev;
  NEW.hash := madp_audit_hash(prev, NEW);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
-- Chain the entries written before this migration, oldest first.
ALTER TABLE audit_event DISABLE TRIGGER audit_event_append_only;
--> statement-breakpoint
DO $$
DECLARE
  r audit_event;
  prev text := NULL;
BEGIN
  FOR r IN SELECT * FROM audit_event ORDER BY id LOOP
    UPDATE audit_event SET prev_hash = prev, "hash" = madp_audit_hash(prev, r) WHERE id = r.id;
    prev := madp_audit_hash(prev, r);
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE audit_event ENABLE TRIGGER audit_event_append_only;
--> statement-breakpoint
ALTER TABLE "audit_event" ALTER COLUMN "hash" SET NOT NULL;
--> statement-breakpoint
CREATE TRIGGER audit_event_chain BEFORE INSERT ON audit_event
  FOR EACH ROW EXECUTE FUNCTION madp_audit_chain();