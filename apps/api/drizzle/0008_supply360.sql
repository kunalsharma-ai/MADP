CREATE TABLE "audience_reservation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"client_id" uuid NOT NULL,
	"project_ref" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"released_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "participation_event" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"client_id" uuid NOT NULL,
	"event_id" text NOT NULL,
	"invitation_id" uuid NOT NULL,
	"event" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reservation_member" (
	"reservation_id" uuid NOT NULL,
	"panel_membership_id" uuid NOT NULL,
	"ref" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_client" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"name" text NOT NULL,
	"client_id" text NOT NULL,
	"secret_enc" text NOT NULL,
	"scopes" text[] NOT NULL,
	"panels" text[] NOT NULL,
	"rate_limit_per_minute" integer DEFAULT 120 NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"last_used_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "service_idempotency" (
	"client_id" uuid NOT NULL,
	"key" text NOT NULL,
	"route" text NOT NULL,
	"request_hash" text NOT NULL,
	"status" integer NOT NULL,
	"response" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_nonce" (
	"client_id" uuid NOT NULL,
	"nonce" text NOT NULL,
	"seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "service_reference" (
	"ref" text PRIMARY KEY NOT NULL,
	"client_id" uuid NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel_membership_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "survey_invitation" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"data_mode" "data_mode" NOT NULL,
	"panel" "panel_code" NOT NULL,
	"panel_membership_id" uuid NOT NULL,
	"client_id" uuid NOT NULL,
	"reservation_id" uuid NOT NULL,
	"project_ref" text NOT NULL,
	"ref" text NOT NULL,
	"status" text DEFAULT 'authorized' NOT NULL,
	"authorized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"clicked_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audience_reservation" ADD CONSTRAINT "audience_reservation_client_id_service_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."service_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_event" ADD CONSTRAINT "participation_event_client_id_service_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."service_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "participation_event" ADD CONSTRAINT "participation_event_invitation_id_survey_invitation_id_fk" FOREIGN KEY ("invitation_id") REFERENCES "public"."survey_invitation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_member" ADD CONSTRAINT "reservation_member_reservation_id_audience_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."audience_reservation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reservation_member" ADD CONSTRAINT "reservation_member_panel_membership_id_panel_membership_id_fk" FOREIGN KEY ("panel_membership_id") REFERENCES "public"."panel_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_idempotency" ADD CONSTRAINT "service_idempotency_client_id_service_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."service_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_nonce" ADD CONSTRAINT "service_nonce_client_id_service_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."service_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reference" ADD CONSTRAINT "service_reference_client_id_service_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."service_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "service_reference" ADD CONSTRAINT "service_reference_panel_membership_id_panel_membership_id_fk" FOREIGN KEY ("panel_membership_id") REFERENCES "public"."panel_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_panel_membership_id_panel_membership_id_fk" FOREIGN KEY ("panel_membership_id") REFERENCES "public"."panel_membership"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_client_id_service_client_id_fk" FOREIGN KEY ("client_id") REFERENCES "public"."service_client"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "survey_invitation" ADD CONSTRAINT "survey_invitation_reservation_id_audience_reservation_id_fk" FOREIGN KEY ("reservation_id") REFERENCES "public"."audience_reservation"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audience_reservation_client_idx" ON "audience_reservation" USING btree ("client_id","project_ref");--> statement-breakpoint
CREATE UNIQUE INDEX "participation_event_key" ON "participation_event" USING btree ("client_id","event_id");--> statement-breakpoint
CREATE INDEX "participation_event_invitation_idx" ON "participation_event" USING btree ("invitation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reservation_member_key" ON "reservation_member" USING btree ("reservation_id","panel_membership_id");--> statement-breakpoint
CREATE INDEX "reservation_member_membership_idx" ON "reservation_member" USING btree ("panel_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_client_client_id_key" ON "service_client" USING btree ("client_id");--> statement-breakpoint
CREATE UNIQUE INDEX "service_idempotency_key" ON "service_idempotency" USING btree ("client_id","key");--> statement-breakpoint
CREATE UNIQUE INDEX "service_nonce_key" ON "service_nonce" USING btree ("client_id","nonce");--> statement-breakpoint
CREATE INDEX "service_nonce_seen_idx" ON "service_nonce" USING btree ("seen_at");--> statement-breakpoint
CREATE UNIQUE INDEX "service_reference_member_key" ON "service_reference" USING btree ("client_id","panel_membership_id");--> statement-breakpoint
CREATE UNIQUE INDEX "survey_invitation_member_key" ON "survey_invitation" USING btree ("reservation_id","panel_membership_id");--> statement-breakpoint
CREATE INDEX "survey_invitation_membership_idx" ON "survey_invitation" USING btree ("panel_membership_id");