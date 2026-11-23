import type { AdminRole, Permission } from '@madp/contracts';

/**
 * RBAC baseline. ABAC narrows further at query time: e.g. MHO health answers additionally require
 * `health.sensitive.read`, and PII fields require `panellists.pii.read`.
 */
export const ROLE_PERMISSIONS: Record<AdminRole, Permission[]> = {
  super_admin: [
    'dashboard.read',
    'audience.counts.read',
    'panellists.read',
    'panellists.pii.read',
    'health.sensitive.read',
    'questions.read',
    'questions.write',
    'mappings.review',
    'connectors.read',
    'connectors.run',
    'imports.run',
    'audit.read',
    'users.manage',
  ],
  platform_admin: [
    'dashboard.read',
    'audience.counts.read',
    'panellists.read',
    'questions.read',
    'connectors.read',
    'connectors.run',
    'imports.run',
    'audit.read',
  ],
  data_steward: [
    'dashboard.read',
    'audience.counts.read',
    'panellists.read',
    'questions.read',
    'questions.write',
    'mappings.review',
    'connectors.read',
  ],
  privacy_officer: [
    'dashboard.read',
    'audience.counts.read',
    'panellists.read',
    'panellists.pii.read',
    'health.sensitive.read',
    'audit.read',
    'connectors.read',
  ],
  analyst: ['dashboard.read', 'audience.counts.read', 'questions.read'],
  support: ['dashboard.read', 'panellists.read', 'panellists.pii.read'],
};

export const permissionsFor = (role: AdminRole): Permission[] => ROLE_PERMISSIONS[role];
