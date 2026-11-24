ALTER TABLE "brand_setting" ADD COLUMN "support_email" text;--> statement-breakpoint
-- Kunal's support addresses (24 Nov 2026)
UPDATE "brand_setting" SET "support_email" = 'support@turn2opinion.com' WHERE "panel" = 't2o';--> statement-breakpoint
UPDATE "brand_setting" SET "support_email" = 'support@myfrequentrewards.com' WHERE "panel" = 'mfr';--> statement-breakpoint
UPDATE "brand_setting" SET "support_email" = 'support@myhealthopinions.com' WHERE "panel" = 'mho';
