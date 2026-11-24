import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { BrandSelection, type Permission } from '@madp/contracts';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import {
  BRAND_KEY,
  MFA_SETUP_KEY,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  type BrandScopeOptions,
} from './decorators.js';
import { hasOn } from './access.js';
import { AuditService } from '../audit/audit.service.js';

export const BRAND_HEADER = 'x-madp-brand';

/**
 * Global guard: every route needs a valid admin session unless marked @Public(); then checks permissions.
 * Cross-brand routes need the permission on every brand. @BrandScoped routes take the brand from the x-madp-brand
 * header (never from the hostname) and need the permission on that brand; a missing header means `all`, the
 * strictest check.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC_KEY, targets)) return true;
    const req = ctx.switchToHttp().getRequest<Request>();
    const header = req.headers.authorization ?? '';
    const token = header.startsWith('Bearer ')
      ? header.slice(7)
      : (req.cookies as Record<string, string> | undefined)?.madp_session;
    if (!token) throw new UnauthorizedException('Sign in required');
    const principal = await this.auth.verify(token);
    req.principal = principal;
    if (
      principal.scope === 'mfa_setup' &&
      !this.reflector.getAllAndOverride<boolean>(MFA_SETUP_KEY, targets)
    ) {
      throw new ForbiddenException('Enrol MFA to continue');
    }
    const needed = this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, targets) ?? [];
    const scoped = this.reflector.getAllAndOverride<BrandScopeOptions | undefined>(BRAND_KEY, targets);
    let brand: BrandSelection = 'all';
    if (scoped) {
      const raw = req.headers[BRAND_HEADER];
      const parsed = BrandSelection.safeParse(Array.isArray(raw) ? raw[0] : (raw ?? 'all'));
      if (!parsed.success) throw new BadRequestException(`${BRAND_HEADER} must be t2o, mfr, mho or all`);
      brand = parsed.data;
      if (brand === 'all' && !scoped.allowAll)
        throw new BadRequestException(`Pick a brand (${BRAND_HEADER})`);
      req.brand = brand;
    }
    if (!hasOn(principal, brand, needed)) {
      await this.audit.record({
        ...AuditService.fromRequest(req),
        action: 'authz.denied',
        outcome: 'denied',
        panel: brand === 'all' ? null : brand,
        targetType: 'route',
        targetId: `${req.method} ${req.route?.path ?? req.path}`,
        metadata: { missing: needed, brand },
      });
      throw new ForbiddenException(
        scoped && brand !== 'all' && !principal.brands.includes(brand)
          ? 'Not permitted on this brand'
          : 'Not permitted',
      );
    }
    return true;
  }
}
