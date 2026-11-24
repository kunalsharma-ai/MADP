import type { BrandSelection, PanelCode, Permission, RoleGrant } from '@madp/contracts';

export interface Principal {
  id: string;
  email: string;
  /** Role keys held (any brand). For display and the audit trail; access uses the permission fields below. */
  roles: string[];
  grants: RoleGrant[];
  /** Permissions held on every brand: what cross-brand routes check. */
  permissions: Permission[];
  /** Permissions per brand: what brand-scoped routes check. */
  brandPermissions: Partial<Record<PanelCode, Permission[]>>;
  /** Brands with at least one permission. */
  brands: PanelCode[];
  /** 'full' or 'mfa_setup' (may only enrol MFA). */
  scope: 'full' | 'mfa_setup';
  sessionId: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
    /** Brand picked in the console's brand switcher (x-madp-brand), checked against the admin's grants. */
    brand?: BrandSelection;
    requestId?: string;
  }
}
