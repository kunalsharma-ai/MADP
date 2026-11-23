import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Permission } from '@madp/contracts';
import type { Request } from 'express';
import { AuthService } from './auth.service.js';
import { MFA_SETUP_KEY, PERMISSIONS_KEY, PUBLIC_KEY } from './decorators.js';
import { AuditService } from '../audit/audit.service.js';

/** Global guard: every route needs a valid admin session unless marked @Public(); then checks permissions. */
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
    const missing = needed.filter((p) => !principal.permissions.includes(p));
    if (missing.length) {
      await this.audit.record({
        actorId: principal.id,
        actorType: 'admin',
        action: 'authz.denied',
        outcome: 'denied',
        targetType: 'route',
        targetId: `${req.method} ${req.route?.path ?? req.path}`,
        metadata: { missing },
        ip: req.ip ?? null,
      });
      throw new ForbiddenException('Not permitted');
    }
    return true;
  }
}
