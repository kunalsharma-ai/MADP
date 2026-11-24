ALTER TABLE "brand_setting" ADD COLUMN "legal_name" text;--> statement-breakpoint
ALTER TABLE "brand_setting" ADD COLUMN "postal_address" text;--> statement-breakpoint
ALTER TABLE "brand_setting" ADD COLUMN "privacy_url" text;--> statement-breakpoint
-- Kunal's legal details (24 Nov 2026). MHO's privacy link is still to come, so it stays null.
UPDATE "brand_setting" SET "legal_name" = 'Frequent Research Fieldwork Solutions Private Limited', "postal_address" = '70/1/2 Mangolpur Kalan, First Floor, West Enclave, Pitampura, Delhi 110085';--> statement-breakpoint
UPDATE "brand_setting" SET "privacy_url" = 'https://www.turn2opinion.com/privacy/' WHERE "panel" = 't2o';--> statement-breakpoint
UPDATE "brand_setting" SET "privacy_url" = 'https://www.myfrequentrewards.com/privacy' WHERE "panel" = 'mfr';
