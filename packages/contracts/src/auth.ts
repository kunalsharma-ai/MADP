import { z } from 'zod';

import { PanelCode } from './panels.js';

/**
 * Built-in roles, seeded by migration 0009. Roles are rows in the `admin_role` table, so new roles are made in the
 * console without code; these keys are only the ones that always exist. Permissions are granted per brand (panel).
 */
export const SYSTEM_ROLES = [
  // Super admin spec (24 Nov 2026)
  'super_admin',
  'brand_admin',
  'panel_manager',
  'question_bank_editor',
  'rewards_finance',
  'support_agent',
  'teen_safeguarding',
  'read_only_analyst',
  // MADP master prompt governance roles
  'platform_admin',
  'data_steward',
  'privacy_officer',
  'analyst',
  'support',
] as const;
export const AdminRole = z.enum(SYSTEM_ROLES);
export type AdminRole = z.infer<typeof AdminRole>;

/** A role key: built-in or made in the console. Lower case, digits and underscores. */
export const RoleKey = z.string().regex(/^[a-z][a-z0-9_]{1,47}$/);
export type RoleKey = z.infer<typeof RoleKey>;

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
  /** Create and revoke Supply360 service clients and their secrets. */
  'service_clients.manage',
  /** Consent and preference center: read consent state and history. */
  'consent.read',
  /** Record a member's channel opt-out or its lifting. Never grants panel consent. */
  'consent.manage',
  /** Privacy requests: see the queue and each request's trail. */
  'privacy.read',
  /** Log a privacy request received from a member. */
  'privacy.request',
  /** Verify, carry out or reject a privacy request (never one you logged yourself). */
  'privacy.execute',
  /** Verification and data quality center (screen 8): counts, checks and evidence. */
  'verification.read',
  /** Record independent verification evidence, and decide evidence someone else recorded. */
  'verification.review',
  /** AI insights (screen 34): rule-based recommendations. */
  'insights.read',
  /** Accept or dismiss an insight, and refresh them. */
  'insights.review',
  'connectors.read',
  'connectors.run',
  'imports.run',
  'audit.read',
  'users.manage',
  // --- Super admin console (spec of 24 Nov 2026). Checked per brand on brand-scoped routes. ---
  'members.read',
  'members.edit',
  /** Suspend, ban, reactivate, merge. */
  'members.status',
  'segments.manage',
  'quality.manage',
  'surveys.read',
  'surveys.manage',
  'invitations.send',
  'qb.read',
  'qb.edit',
  'qb.publish',
  /** Create, order, switch on or off and assign profiles; points per profile. */
  'profiles.manage',
  'points.read',
  'points.adjust',
  'payouts.approve',
  /** Full payment details (account numbers, UPI ids). */
  'payments.view',
  'rewards.manage',
  'redemptions.manage',
  'support.read',
  'support.reply',
  /** Resend welcome, verification or password-reset e-mails (only once the e-mail switches are on). */
  'members.resend_email',
  'messages.send',
  'teen.read',
  'teen.review',
  'content.manage',
  'data_requests.manage',
  'switches.read',
  /** Money, legal and email switches. Super Admin only by default. */
  'switches.flip',
  'brands.manage',
  'admins.manage',
  'roles.manage',
  /** Unmask email, phone, address, payment details or date of birth; needs a reason and is audited. */
  'pii.view',
  /** "Log in as member". Super Admin only, needs a reason, read-only by default, audited. */
  'members.impersonate',
  'reports.read',
  /** Exports without personal data. */
  'export.read',
  /** Exports with personal data; audited. */
  'export.pii',
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

/** The brand an admin works in. `all` is the side-by-side view, allowed only with the permission on every brand. */
export const BrandSelection = z.union([PanelCode, z.literal('all')]);
export type BrandSelection = z.infer<typeof BrandSelection>;

/** One role held by an admin, on some brands (`null` = every brand, today and any added later). */
export const RoleGrant = z.object({
  role: RoleKey,
  brands: z.array(PanelCode).min(1).nullable(),
});
export type RoleGrant = z.infer<typeof RoleGrant>;

export const RoleDefinition = z.object({
  key: RoleKey,
  name: z.string().min(2).max(80),
  description: z.string().max(500).default(''),
  permissions: z.array(Permission),
  /** Built-in roles cannot be deleted; super_admin cannot be edited. */
  system: z.boolean().default(false),
});
export type RoleDefinition = z.infer<typeof RoleDefinition>;

export const RoleUpsert = RoleDefinition.omit({ system: true, key: true }).extend({
  permissions: z.array(Permission).max(200),
});
export type RoleUpsert = z.infer<typeof RoleUpsert>;

export const AdminCreate = z.object({
  email: z.string().email(),
  displayName: z.string().min(2).max(120),
  grants: z.array(RoleGrant).min(1).max(20),
});
export type AdminCreate = z.infer<typeof AdminCreate>;

export const AdminUpdate = z.object({
  displayName: z.string().min(2).max(120).optional(),
  isActive: z.boolean().optional(),
  grants: z.array(RoleGrant).min(1).max(20).optional(),
  /** Required for every change to another admin. */
  reason: z.string().trim().min(5).max(500),
});
export type AdminUpdate = z.infer<typeof AdminUpdate>;

export const SessionUser = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  displayName: z.string(),
  /** Display label: the first role held (e.g. "super_admin"). Access is decided by `brandPermissions`. */
  role: z.string(),
  grants: z.array(RoleGrant),
  /**
   * Permissions held on every brand. Cross-brand screens check these, so an admin limited to one brand never sees
   * another brand's rows there.
   */
  permissions: z.array(Permission),
  /** Permissions per brand; brand-scoped routes check the selected brand's list. */
  brandPermissions: z.partialRecord(PanelCode, z.array(Permission)),
  /** Brands the admin may pick in the brand switcher. */
  brands: z.array(PanelCode),
  mfaEnabled: z.boolean(),
});
export type SessionUser = z.infer<typeof SessionUser>;
