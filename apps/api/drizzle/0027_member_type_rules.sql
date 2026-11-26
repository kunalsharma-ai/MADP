CREATE TABLE "member_type_rules" (
	"panel" text PRIMARY KEY NOT NULL,
	"rules" jsonb NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "member_type_rules" ADD CONSTRAINT "member_type_rules_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;