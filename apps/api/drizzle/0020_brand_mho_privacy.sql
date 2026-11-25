-- MHO's privacy policy, given by Kunal on 2026-11-25. Only fills an empty value, so an admin's edit in Brands & settings wins.
UPDATE "brand_setting" SET "privacy_url" = 'https://www.myhealthopinions.com/privacy/' WHERE "panel" = 'mho' AND "privacy_url" IS NULL;
