CREATE TABLE "admin_alert_rule" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"panel" text,
	"metric" text NOT NULL,
	"segment" text,
	"comparator" text NOT NULL,
	"threshold" integer NOT NULL,
	"window" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"muted_until" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "admin_alert_rule" ADD CONSTRAINT "admin_alert_rule_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_alert_rule" ADD CONSTRAINT "admin_alert_rule_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "admin_alert_rule_admin_idx" ON "admin_alert_rule" USING btree ("admin_user_id");