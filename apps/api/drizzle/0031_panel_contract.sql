ALTER TABLE "panel_connection" ADD COLUMN "contract_version" text;--> statement-breakpoint
ALTER TABLE "panel_connection" ADD COLUMN "contract_implementation" text;--> statement-breakpoint
ALTER TABLE "panel_connection" ADD COLUMN "contract_capabilities" text[];--> statement-breakpoint
ALTER TABLE "panel_connection" ADD COLUMN "contract_brands" text[];--> statement-breakpoint
ALTER TABLE "panel_connection" ADD COLUMN "contract_checked_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "panel_connection" ADD COLUMN "contract_ok" boolean;--> statement-breakpoint
ALTER TABLE "panel_connection" ADD COLUMN "contract_message" text;--> statement-breakpoint
ALTER TABLE "panel_connection" ADD COLUMN "conformance_report" jsonb;--> statement-breakpoint
ALTER TABLE "panel_connection" ADD COLUMN "conformance_at" timestamp with time zone;