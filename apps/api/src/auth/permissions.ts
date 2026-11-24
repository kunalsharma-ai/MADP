import { Permission, type AdminRole } from '@madp/contracts';

const ALL = Permission.options;

/** Permissions only Super Admin holds by default (spec: switches, admin accounts, roles, data export, impersonate). */
export const SUPER_ADMIN_ONLY: Permission[] = [
  'switches.flip',
  'admins.manage',
  'roles.manage',
  'users.manage',
  'brands.manage',
  'members.impersonate',
  'export.pii',
  'service_clients.manage',
];

/**
 * Built-in roles and their starting permissions. Migration 0011 seeds exactly these rows into `admin_role`
 * (test/foundation.test.ts checks they match); after that the database is the source and Kunal edits roles in the console.
 */
export const DEFAULT_ROLES: Record<
  AdminRole,
  { name: string; description: string; permissions: Permission[] }
> = {
  super_admin: {
    name: 'Super Admin',
    description: 'Everything on every brand, including switches, admin accounts, roles and data export.',
    permissions: [...ALL],
  },
  brand_admin: {
    name: 'Brand Admin',
    description: 'Everything inside the assigned brands except switches and admin accounts.',
    permissions: ALL.filter((p) => !SUPER_ADMIN_ONLY.includes(p)),
  },
  panel_manager: {
    name: 'Panel Manager',
    description:
      'Members, segments, quality, surveys, invitations and profiles. No payouts or full payment details.',
    permissions: [
      'dashboard.read',
      'audience.counts.read',
      'panellists.read',
      'members.read',
      'members.edit',
      'members.status',
      'segments.manage',
      'quality.manage',
      'surveys.read',
      'surveys.manage',
      'invitations.send',
      'qb.read',
      'profiles.manage',
      'points.read',
      'support.read',
      'reports.read',
    ],
  },
  question_bank_editor: {
    name: 'Question Bank Editor',
    description:
      'Questions, options, profiles, show-when rules, translations, import and export. No members or points.',
    permissions: [
      'dashboard.read',
      'questions.read',
      'questions.write',
      'qb.read',
      'qb.edit',
      'qb.publish',
      'profiles.manage',
    ],
  },
  rewards_finance: {
    name: 'Rewards and Finance',
    description:
      'Redemption queue, catalogue, offers, points adjustments, holds and payout reports. No questions or surveys.',
    permissions: [
      'dashboard.read',
      'members.read',
      'points.read',
      'points.adjust',
      'payouts.approve',
      'payments.view',
      'rewards.manage',
      'redemptions.manage',
      'loyalty.read',
      'loyalty.reconcile',
      'reports.read',
    ],
  },
  support_agent: {
    name: 'Support Agent',
    description:
      'Tickets, messages, member look-up with masked e-mail and phone, resend e-mails. No points, roles or consent.',
    permissions: [
      'dashboard.read',
      'members.read',
      'support.read',
      'support.reply',
      'members.resend_email',
      'communications.read',
    ],
  },
  teen_safeguarding: {
    name: 'Teen Safeguarding',
    description:
      'Teen registrations, manual review, guardian consent, teen redemptions and teen data requests only.',
    permissions: ['dashboard.read', 'members.read', 'teen.read', 'teen.review'],
  },
  read_only_analyst: {
    name: 'Read Only Analyst',
    description: 'Dashboards and reports, exports without personal data. No writes.',
    permissions: [
      'dashboard.read',
      'audience.counts.read',
      'questions.read',
      'qb.read',
      'surveys.read',
      'points.read',
      'reports.read',
      'export.read',
    ],
  },
  platform_admin: {
    name: 'Platform Admin',
    description: 'MADP connectors, imports, sync and service clients.',
    permissions: [
      'dashboard.read',
      'audience.counts.read',
      'panellists.read',
      'questions.read',
      'connectors.read',
      'connectors.run',
      'imports.run',
      'audit.read',
      'loyalty.read',
      'loyalty.reconcile',
      'service_clients.manage',
    ],
  },
  data_steward: {
    name: 'Data Steward',
    description: 'MADP question registry, mappings and identity review.',
    permissions: [
      'dashboard.read',
      'audience.counts.read',
      'panellists.read',
      'questions.read',
      'questions.write',
      'mappings.review',
      'identity.review',
      'connectors.read',
      'communications.read',
      'communications.manage',
      'loyalty.read',
      'consent.read',
    ],
  },
  privacy_officer: {
    name: 'Privacy Officer',
    description: 'Personal and health data under purpose limits, identity review, audit, approvals.',
    permissions: [
      'dashboard.read',
      'audience.counts.read',
      'panellists.read',
      'panellists.pii.read',
      'health.sensitive.read',
      'identity.review',
      'audit.read',
      'connectors.read',
      'communications.read',
      'communications.approve',
      'loyalty.read',
      'loyalty.approve',
      'consent.read',
      'consent.manage',
      'privacy.read',
      'privacy.request',
      'privacy.execute',
    ],
  },
  analyst: {
    name: 'Analyst',
    description: 'MADP dashboards and counts.',
    permissions: ['dashboard.read', 'audience.counts.read', 'questions.read'],
  },
  support: {
    name: 'Support (MADP)',
    description: 'MADP panellist look-up.',
    permissions: [
      'dashboard.read',
      'panellists.read',
      'panellists.pii.read',
      'communications.read',
      'loyalty.read',
      'consent.read',
      'consent.manage',
      'privacy.read',
      'privacy.request',
    ],
  },
};
