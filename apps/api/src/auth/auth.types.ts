import type { AdminRole, Permission } from '@madp/contracts';

export interface Principal {
  id: string;
  email: string;
  role: AdminRole;
  permissions: Permission[];
  /** 'full' or 'mfa_setup' (may only enrol MFA). */
  scope: 'full' | 'mfa_setup';
}

declare module 'express-serve-static-core' {
  interface Request {
    principal?: Principal;
  }
}
