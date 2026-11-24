import { z } from 'zod';

/** Admin roles. Permissions are attached in the API (RBAC) and narrowed further by attribute rules (ABAC). */
export const AdminRole = z.enum([
  'super_admin',
  'platform_admin',
  'data_steward',
  'privacy_officer',
  'analyst',
  'support',
]);
export type AdminRole = z.infer<typeof AdminRole>;

export const Permission = z.enum([
  'dashboard.read',
  'audience.counts.read',
  'panellists.read',
  'panellists.pii.read',
  'health.sensitive.read',
  'questions.read',
  'questions.write',
  'mappings.review',
  'identity.review',
  'communications.read',
  'communications.manage',
  'communications.approve',
  'loyalty.read',
  'loyalty.reconcile',
  'loyalty.approve',
  'connectors.read',
  'connectors.run',
  'imports.run',
  'audit.read',
  'users.manage',
]);
export type Permission = z.infer<typeof Permission>;

export const LoginRequest = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  totp: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const SessionUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  role: AdminRole,
  permissions: z.array(Permission),
  mfaEnabled: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUser>;
