CREATE TABLE "admin_fraud_seen" (
	"admin_user_id" uuid NOT NULL,
	"panel" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_fraud_seen_admin_user_id_panel_pk" PRIMARY KEY("admin_user_id","panel")
);
--> statement-breakpoint
ALTER TABLE "admin_fraud_seen" ADD CONSTRAINT "admin_fraud_seen_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "admin_fraud_seen" ADD CONSTRAINT "admin_fraud_seen_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;