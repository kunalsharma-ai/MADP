CREATE TABLE "member_saved_view" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel" text NOT NULL,
	"admin_user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"params" jsonb NOT NULL,
	"shared" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_saved_view" ADD CONSTRAINT "member_saved_view_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_saved_view" ADD CONSTRAINT "member_saved_view_admin_user_id_admin_user_id_fk" FOREIGN KEY ("admin_user_id") REFERENCES "public"."admin_user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_saved_view_panel_idx" ON "member_saved_view" USING btree ("panel","admin_user_id");