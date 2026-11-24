import { SetMetadata, createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { BrandSelection, Permission } from '@madp/contracts';
import type { Request } from 'express';
import type { Principal } from './auth.types.js';

export const PERMISSIONS_KEY = 'madp:permissions';
export const PUBLIC_KEY = 'madp:public';
export const MFA_SETUP_KEY = 'madp:mfa-setup-allowed';
export const BRAND_KEY = 'madp:brand-scoped';

export interface BrandScopeOptions {
  /** Accept `all` (every brand side by side); the permissions are then needed on every brand. */
  allowAll?: boolean;
}

export const RequirePermissions = (...p: Permission[]) => SetMetadata(PERMISSIONS_KEY, p);
export const Public = () => SetMetadata(PUBLIC_KEY, true);
export const AllowMfaSetupScope = () => SetMetadata(MFA_SETUP_KEY, true);
/**
 * The route works in one brand, picked by the `x-madp-brand` header (the console's brand switcher), never the request
 * hostname. The guard checks the route's permissions on that brand and refuses brands the admin was not granted.
 */
export const BrandScoped = (o: BrandScopeOptions = {}) => SetMetadata(BRAND_KEY, o);

export const CurrentPrincipal = createParamDecorator((_: unknown, ctx: ExecutionContext): Principal => {
  return ctx.switchToHttp().getRequest<Request>().principal!;
});
export const CurrentBrand = createParamDecorator((_: unknown, ctx: ExecutionContext): BrandSelection => {
  return ctx.switchToHttp().getRequest<Request>().brand!;
});
