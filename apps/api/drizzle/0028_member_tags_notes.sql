CREATE TABLE "member_note" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"panel" text NOT NULL,
	"member_id" text NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"body" text NOT NULL,
	"pinned" boolean DEFAULT false NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "member_tag" (
	"panel" text NOT NULL,
	"member_id" text NOT NULL,
	"tag" text NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "member_tag_panel_data_mode_member_id_tag_pk" PRIMARY KEY("panel","data_mode","member_id","tag")
);
--> statement-breakpoint
ALTER TABLE "member_note" ADD CONSTRAINT "member_note_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_note" ADD CONSTRAINT "member_note_created_by_admin_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."admin_user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "member_tag" ADD CONSTRAINT "member_tag_panel_panel_code_fk" FOREIGN KEY ("panel") REFERENCES "public"."panel"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "member_note_member_idx" ON "member_note" USING btree ("panel","data_mode","member_id");--> statement-breakpoint
CREATE INDEX "member_tag_by_tag_idx" ON "member_tag" USING btree ("panel","data_mode","tag");