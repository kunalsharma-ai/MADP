import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Permission } from '@madp/contracts';
import type { Request } from 'express';
import type { Principal } from './auth.types.js';

export const PERMISSIONS_KEY = 'madp:permissions';
export const PUBLIC_KEY = 'madp:public';
export const MFA_SETUP_KEY = 'madp:mfa-setup-allowed';

export const RequirePermissions = (...p: Permission[]) => SetMetadata(PERMISSIONS_KEY, p);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const AllowMfaSetupScope = () => SetMetadata(MFA_SETUP_KEY, true);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<Request>().principal!;
});
