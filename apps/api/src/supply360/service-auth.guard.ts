import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  HttpException,
  HttpStatus,
  type RawBodyRequest,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { and, eq, lt, sql } from 'drizzle-orm';
import type { DataMode, PanelCode, ServiceScope } from '@madp/contracts';
import type { Request } from 'express';
import { Database } from '../db/database.js';
import { serviceClients, serviceNonces } from '../db/schema.js';
import { FieldCrypto } from '../crypto/field-crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { SERVICE_TOLERANCE_SECONDS, verifyServiceSignature } from './signature.js';

export interface ServicePrincipal {
  id: string;
  clientId: string;
  name: string;
  dataMode: DataMode;
  scopes: ServiceScope[];
  panels: PanelCode[];
}

declare module 'express-serve-static-core' {
  interface Request {
    service?: ServicePrincipal;
  }
}

export const SCOPE_KEY = 'madp:service-scope';
export const RequireScope = (scope: ServiceScope) => SetMetadata(SCOPE_KEY, scope);
export const CurrentService = createParamDecorator(
  (_: unknown, ctx: ExecutionContext): ServicePrincipal => ctx.switchToHttp().getRequest<Request>().service!,
);

/**
 * Signed service-client auth for Supply360 routes: a known, active client; a fresh timestamp; a nonce never
 * seen before; an HMAC over method, path and body; the route's scope; and a per-client rate limit. Every
 * refusal is audited with its reason.
 */
@Injectable()
export class ServiceAuthGuard implements CanActivate {
  private readonly windows = new Map<string, { start: number; n: number }>();

  constructor(
    private readonly reflector: Reflector,
    private readonly database: Database,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<Request>();
    const db = this.database.db;
    const clientId = String(req.headers['x-madp-client'] ?? '');
    const refuse = async (reason: string, client: string | null) => {
      await this.audit.record({
        actorId: client,
        actorType: 'service',
        action: 'service.rejected',
        outcome: 'denied',
        targetType: 'route',
        targetId: `${req.method} ${req.route?.path ?? req.path}`,
        metadata: { reason, clientId: clientId.slice(0, 80) || null },
        ip: req.ip ?? null,
      });
    };
    const c = clientId ? await db.query.serviceClients.findFirst({ where: eq(serviceClients.clientId, clientId) }) : undefined;
    if (!c || c.status !== 'active') {
      await refuse(c ? 'revoked' : 'unknown_client', c?.id ?? null);
      throw new UnauthorizedException('Unknown or revoked service client');
    }
    const v = verifyServiceSignature({
      secret: this.crypto.decrypt(c.secretEnc)!,
      header: req.headers['x-madp-signature'] as string | undefined,
      ts: req.headers['x-madp-timestamp'] as string | undefined,
      nonce: req.headers['x-madp-nonce'] as string | undefined,
      method: req.method,
      path: req.originalUrl.split('?')[0]!,
      rawBody: (req as RawBodyRequest<Request>).rawBody ?? Buffer.alloc(0),
      nowSeconds: Math.floor(Date.now() / 1000),
    });
    if (!v.ok) {
      await refuse(v.reason, c.id);
      throw new UnauthorizedException('Bad request signature');
    }
    // A nonce counts once. Rows older than the window can go: their timestamps would be refused anyway.
    const seen = await db
      .insert(serviceNonces)
      .values({ clientId: c.id, nonce: String(req.headers['x-madp-nonce']) })
      .onConflictDoNothing()
      .returning({ nonce: serviceNonces.nonce });
    if (!seen.length) {
      await refuse('replayed_nonce', c.id);
      throw new UnauthorizedException('This request was already received');
    }
    await db.delete(serviceNonces).where(and(eq(serviceNonces.clientId, c.id), lt(serviceNonces.seenAt, new Date(Date.now() - 2 * SERVICE_TOLERANCE_SECONDS * 1000))));
    const scope = this.reflector.getAllAndOverride<ServiceScope>(SCOPE_KEY, [ctx.getHandler(), ctx.getClass()]);
    if (scope && !c.scopes.includes(scope)) {
      await refuse(`missing_scope:${scope}`, c.id);
      throw new ForbiddenException(`This client does not have the ${scope} scope`);
    }
    // Per-client fixed one-minute window (per API instance).
    const now = Date.now();
    const w = this.windows.get(c.id);
    if (!w || now - w.start >= 60_000) this.windows.set(c.id, { start: now, n: 1 });
    else if (++w.n > c.rateLimitPerMinute) {
      await refuse('rate_limited', c.id);
      throw new HttpException('Rate limit reached for this client', HttpStatus.TOO_MANY_REQUESTS);
    }
    await db.update(serviceClients).set({ lastUsedAt: sql`now()` }).where(eq(serviceClients.id, c.id));
    req.service = {
      id: c.id,
      clientId: c.clientId,
      name: c.name,
      dataMode: c.dataMode,
      scopes: c.scopes as ServiceScope[],
      panels: c.panels as PanelCode[],
    };
    return true;
  }
}
