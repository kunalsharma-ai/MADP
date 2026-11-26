import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { and, eq, isNull, lt, or, sql } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import * as OTPAuth from 'otpauth';
import type { ApiEnv } from '@madp/config';
import { Permission, type AdminRole, type LoginRequest, type RoleGrant, type SessionUser } from '@madp/contracts';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import { adminRoleGrants, adminRoles, adminSessions, adminUsers } from '../db/schema.js';
import { FieldCrypto } from '../crypto/field-crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { computeAccess, type Access } from './access.js';
import type { Principal } from './auth.types.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const ISSUER = 'madp-api';
// Checked when the e-mail is unknown, so a wrong e-mail takes as long as a wrong password (no way to find out by timing
// which addresses have an account).
const DUMMY_HASH = argon2.hash('not-a-real-password-0000', { type: argon2.argon2id });

@Injectable()
export class AuthService {
  private readonly secret: Uint8Array;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
  ) {
    this.secret = new TextEncoder().encode(env.AUTH_JWT_SECRET);
  }

  static hashPassword(password: string) {
    if (password.length < 12) throw new Error('Password must be at least 12 characters');
    return argon2.hash(password, { type: argon2.argon2id });
  }

  /** Creates an admin holding `role` on every brand (scripts and tests). The console uses AdminsService. */
  async createAdmin(email: string, displayName: string, password: string, role: AdminRole | string) {
    return this.createAdminWithGrants(email, displayName, password, [{ role, brands: null }]);
  }

  async createAdminWithGrants(email: string, displayName: string, password: string, grants: RoleGrant[]) {
    const passwordHash = await AuthService.hashPassword(password);
    return this.database.db.transaction(async (tx) => {
      const [row] = await tx
        .insert(adminUsers)
        .values({ email: email.toLowerCase(), displayName, passwordHash })
        .returning({ id: adminUsers.id });
      await tx
        .insert(adminRoleGrants)
        .values(grants.map((g) => ({ adminId: row!.id, roleKey: g.role, brands: g.brands })));
      return row!.id;
    });
  }

  /** Role grants and what they allow, read fresh so role and grant changes apply on the next request. */
  async accessOf(adminId: string): Promise<{ grants: RoleGrant[]; roles: string[] } & Access> {
    const rows = await this.database.db
      .select({ role: adminRoleGrants.roleKey, brands: adminRoleGrants.brands, permissions: adminRoles.permissions })
      .from(adminRoleGrants)
      .innerJoin(adminRoles, eq(adminRoles.key, adminRoleGrants.roleKey))
      .where(eq(adminRoleGrants.adminId, adminId))
      .orderBy(adminRoleGrants.createdAt);
    const grants: RoleGrant[] = rows.map((r) => ({ role: r.role, brands: r.brands?.length ? r.brands : null }));
    const known = new Set<string>(Permission.options);
    const map = new Map(rows.map((r) => [r.role, r.permissions.filter((p): p is Permission => known.has(p))]));
    return { grants, roles: grants.map((g) => g.role), ...computeAccess(grants, map) };
  }

  async login(
    req: LoginRequest,
    ip: string | null,
    userAgent: string | null = null,
  ): Promise<{ token: string; user: SessionUser; mfaSetupRequired: boolean }> {
    const email = req.email.toLowerCase();
    const user = await this.database.db.query.adminUsers.findFirst({ where: eq(adminUsers.email, email) });
    const fail = async (reason: string) => {
      if (user) {
        await this.database.db
          .update(adminUsers)
          .set({
            failedAttempts: sql`${adminUsers.failedAttempts} + 1`,
            lockedUntil:
              user.failedAttempts + 1 >= MAX_FAILED
                ? new Date(Date.now() + LOCK_MINUTES * 60_000)
                : user.lockedUntil,
          })
          .where(eq(adminUsers.id, user.id));
      }
      await this.audit.record({
        actorId: user?.id ?? null,
        actorType: 'admin',
        action: 'auth.login',
        outcome: 'denied',
        metadata: { reason },
        ip,
        userAgent,
      });
      throw new UnauthorizedException('Invalid credentials');
    };
    if (!user || !user.isActive) {
      await argon2.verify(await DUMMY_HASH, req.password).catch(() => false);
      return fail('unknown_or_inactive');
    }
    if (user.lockedUntil && user.lockedUntil > new Date()) return fail('locked');
    if (!(await argon2.verify(user.passwordHash, req.password))) return fail('bad_password');
    if (user.mfaEnabled) {
      if (!req.totp) return fail('totp_required');
      if (!(await this.useTotp(user, req.totp))) return fail('bad_totp');
    }
    const mfaSetupRequired = this.env.REQUIRE_MFA && !user.mfaEnabled;
    await this.database.db
      .update(adminUsers)
      .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(adminUsers.id, user.id));
    const [session] = await this.database.db
      .insert(adminSessions)
      .values({ adminId: user.id, ip, userAgent: userAgent?.slice(0, 300) ?? null })
      .returning({ id: adminSessions.id });
    const access = await this.accessOf(user.id);
    await this.audit.record({
      actorId: user.id,
      actorType: 'admin',
      actorRole: access.roles.join(','),
      action: 'auth.login',
      metadata: { mfaSetupRequired },
      ip,
      userAgent,
    });
    const principal = this.toPrincipal(user, access, mfaSetupRequired ? 'mfa_setup' : 'full', session!.id);
    return { token: await this.sign(principal), user: this.toSessionUser(user, principal), mfaSetupRequired };
  }

  async logout(p: Principal, ip: string | null) {
    await this.database.db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessions.id, p.sessionId), isNull(adminSessions.revokedAt)));
    await this.audit.record({ actorId: p.id, actorType: 'admin', actorRole: p.roles.join(','), action: 'auth.logout', ip });
  }

  /** Ends every session of an admin (deactivation, password or role change by a Super Admin). */
  async revokeSessions(adminId: string) {
    await this.database.db
      .update(adminSessions)
      .set({ revokedAt: new Date() })
      .where(and(eq(adminSessions.adminId, adminId), isNull(adminSessions.revokedAt)));
  }

  private toPrincipal(
    user: typeof adminUsers.$inferSelect,
    access: Awaited<ReturnType<AuthService['accessOf']>>,
    scope: Principal['scope'],
    sessionId: string,
  ): Principal {
    const full = scope === 'full';
    return {
      id: user.id,
      email: user.email,
      roles: access.roles,
      grants: access.grants,
      permissions: full ? access.permissions : [],
      brandPermissions: full ? access.brandPermissions : {},
      brands: full ? access.brands : [],
      scope,
      sessionId,
    };
  }

  private toSessionUser(user: typeof adminUsers.$inferSelect, p: Principal): SessionUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: p.roles[0] ?? 'none',
      grants: p.grants,
      permissions: p.permissions,
      brandPermissions: p.brandPermissions,
      brands: p.brands,
      mfaEnabled: user.mfaEnabled,
    };
  }

  async sign(p: Principal): Promise<string> {
    return new SignJWT({ email: p.email, scope: p.scope, sid: p.sessionId })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(p.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${p.scope === 'full' ? this.env.AUTH_TOKEN_TTL_MINUTES : 10}m`)
      .sign(this.secret);
  }

  /**
   * Verifies the token, the server-side session (30 minutes idle by default) and re-reads the user and their grants,
   * so sign-out, deactivation and role changes apply immediately.
   */
  async verify(token: string): Promise<Principal> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, algorithms: ['HS256'] }));
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
    const sid = typeof payload.sid === 'string' ? payload.sid : '';
    if (!/^[0-9a-f-]{36}$/i.test(sid)) throw new UnauthorizedException('Invalid or expired session');
    const session = await this.database.db.query.adminSessions.findFirst({ where: eq(adminSessions.id, sid) });
    const idleMs = this.env.ADMIN_IDLE_MINUTES * 60_000;
    if (!session || session.adminId !== payload.sub || session.revokedAt)
      throw new UnauthorizedException('Session ended');
    if (Date.now() - session.lastSeenAt.getTime() > idleMs) {
      await this.database.db.update(adminSessions).set({ revokedAt: new Date() }).where(eq(adminSessions.id, sid));
      throw new UnauthorizedException('Session ended after inactivity');
    }
    if (Date.now() - session.lastSeenAt.getTime() > 30_000)
      await this.database.db.update(adminSessions).set({ lastSeenAt: new Date() }).where(eq(adminSessions.id, sid));
    const user = await this.database.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, String(payload.sub)),
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Account inactive');
    const scope = payload.scope === 'mfa_setup' && !user.mfaEnabled ? 'mfa_setup' : 'full';
    if (scope === 'full' && this.env.REQUIRE_MFA && !user.mfaEnabled)
      throw new UnauthorizedException('MFA enrolment required');
    return this.toPrincipal(user, await this.accessOf(user.id), scope, sid);
  }

  async me(p: Principal): Promise<SessionUser> {
    const user = await this.database.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, p.id) });
    return this.toSessionUser(user!, p);
  }

  /** Step 1 of MFA enrolment: store a new (unconfirmed) secret, return the otpauth URI for the authenticator app. */
  async beginMfa(p: Principal): Promise<{ otpauthUri: string }> {
    const user = await this.database.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, p.id) });
    if (!user) throw new UnauthorizedException();
    if (user.mfaEnabled) throw new ForbiddenException('MFA already enabled');
    const secret = new OTPAuth.Secret({ size: 20 });
    await this.database.db
      .update(adminUsers)
      .set({ totpSecretEnc: this.crypto.encrypt(secret.base32) })
      .where(eq(adminUsers.id, p.id));
    const totp = new OTPAuth.TOTP({ issuer: 'MADP', label: user.email, secret, digits: 6, period: 30 });
    return { otpauthUri: totp.toString() };
  }

  /** Step 2: confirm with a code; then issue a full-scope session. */
  async confirmMfa(
    p: Principal,
    code: string,
    ip: string | null,
  ): Promise<{ token: string; user: SessionUser }> {
    const user = await this.database.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, p.id) });
    if (!user?.totpSecretEnc) throw new ForbiddenException('Start MFA enrolment first');
    if (!(await this.useTotp(user, code))) throw new UnauthorizedException('Invalid code');
    await this.database.db.update(adminUsers).set({ mfaEnabled: true }).where(eq(adminUsers.id, p.id));
    await this.audit.record({ actorId: p.id, actorType: 'admin', action: 'auth.mfa.enabled', ip });
    const full = this.toPrincipal({ ...user, mfaEnabled: true }, await this.accessOf(user.id), 'full', p.sessionId);
    return { token: await this.sign(full), user: this.toSessionUser({ ...user, mfaEnabled: true }, full) };
  }

  /** Step-up check for a sensitive change: the signed-in admin's current authenticator code, used up once. */
  async confirmCode(adminId: string, code: string): Promise<boolean> {
    const user = await this.database.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, adminId) });
    if (!user?.isActive || !user.mfaEnabled) return false;
    return this.useTotp(user, code);
  }

  /**
   * Checks an authenticator code and uses it up: a code (and any older one) is accepted once, so a code seen over
   * someone's shoulder or copied from a captured sign-in can't be used again in the same 90 seconds.
   */
  private async useTotp(user: typeof adminUsers.$inferSelect, code: string): Promise<boolean> {
    if (!user.totpSecretEnc) return false;
    const totp = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(this.crypto.decrypt(user.totpSecretEnc)!),
      digits: 6,
      period: 30,
    });
    const now = Date.now();
    const delta = totp.validate({ token: code, window: 1, timestamp: now });
    if (delta === null) return false;
    const step = Math.floor(now / 30_000) + delta;
    const used = await this.database.db
      .update(adminUsers)
      .set({ totpLastStep: step })
      .where(
        and(
          eq(adminUsers.id, user.id),
          or(isNull(adminUsers.totpLastStep), lt(adminUsers.totpLastStep, step)),
        ),
      )
      .returning({ id: adminUsers.id });
    return used.length === 1;
  }
}
