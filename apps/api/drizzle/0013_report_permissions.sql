-- Custom SQL migration.
-- Reports and exports on the built-in MADP roles (matches src/auth/permissions.ts DEFAULT_ROLES).
UPDATE "admin_role" SET "permissions" = "permissions" || ARRAY['reports.read', 'export.read']::text[]
  WHERE "system" AND "key" IN ('analyst', 'data_steward', 'privacy_officer') AND NOT ('reports.read' = ANY("permissions"));--> statement-breakpoint
UPDATE "admin_role" SET "permissions" = "permissions" || ARRAY['reports.read']::text[]
  WHERE "system" AND "key" = 'platform_admin' AND NOT ('reports.read' = ANY("permissions"));
