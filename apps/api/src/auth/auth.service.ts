import { ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import argon2 from 'argon2';
import { eq, sql } from 'drizzle-orm';
import { SignJWT, jwtVerify } from 'jose';
import * as OTPAuth from 'otpauth';
import type { ApiEnv } from '@madp/config';
import type { AdminRole, LoginRequest, SessionUser } from '@madp/contracts';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import { adminUsers } from '../db/schema.js';
import { FieldCrypto } from '../crypto/field-crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { permissionsFor } from './permissions.js';
import type { Principal } from './auth.types.js';

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const ISSUER = 'madp-api';

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

  async createAdmin(email: string, displayName: string, password: string, role: AdminRole) {
    const [row] = await this.database.db
      .insert(adminUsers)
      .values({
        email: email.toLowerCase(),
        displayName,
        passwordHash: await AuthService.hashPassword(password),
        role,
      })
      .returning({ id: adminUsers.id });
    return row!.id;
  }

  async login(
    req: LoginRequest,
    ip: string | null,
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
      });
      throw new UnauthorizedException('Invalid credentials');
    };
    if (!user || !user.isActive) return fail('unknown_or_inactive');
    if (user.lockedUntil && user.lockedUntil > new Date()) return fail('locked');
    if (!(await argon2.verify(user.passwordHash, req.password))) return fail('bad_password');
    if (user.mfaEnabled) {
      if (!req.totp) return fail('totp_required');
      if (!this.verifyTotp(this.crypto.decrypt(user.totpSecretEnc)!, req.totp)) return fail('bad_totp');
    }
    const mfaSetupRequired = this.env.REQUIRE_MFA && !user.mfaEnabled;
    await this.database.db
      .update(adminUsers)
      .set({ failedAttempts: 0, lockedUntil: null, lastLoginAt: new Date() })
      .where(eq(adminUsers.id, user.id));
    await this.audit.record({
      actorId: user.id,
      actorType: 'admin',
      action: 'auth.login',
      metadata: { mfaSetupRequired },
      ip,
    });
    const principal: Principal = {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: mfaSetupRequired ? [] : permissionsFor(user.role),
      scope: mfaSetupRequired ? 'mfa_setup' : 'full',
    };
    return { token: await this.sign(principal), user: this.toSessionUser(user, principal), mfaSetupRequired };
  }

  private toSessionUser(user: typeof adminUsers.$inferSelect, p: Principal): SessionUser {
    return {
      id: user.id,
      email: user.email,
      displayName: user.displayName,
      role: user.role,
      permissions: p.permissions,
      mfaEnabled: user.mfaEnabled,
    };
  }

  async sign(p: Principal): Promise<string> {
    return new SignJWT({ email: p.email, role: p.role, scope: p.scope })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(p.id)
      .setIssuer(ISSUER)
      .setIssuedAt()
      .setExpirationTime(`${p.scope === 'full' ? this.env.AUTH_TOKEN_TTL_MINUTES : 10}m`)
      .sign(this.secret);
  }

  /** Verifies the token and re-reads the user, so deactivation and role changes apply immediately. */
  async verify(token: string): Promise<Principal> {
    let payload;
    try {
      ({ payload } = await jwtVerify(token, this.secret, { issuer: ISSUER, algorithms: ['HS256'] }));
    } catch {
      throw new UnauthorizedException('Invalid or expired session');
    }
    const user = await this.database.db.query.adminUsers.findFirst({
      where: eq(adminUsers.id, String(payload.sub)),
    });
    if (!user || !user.isActive) throw new UnauthorizedException('Account inactive');
    const scope = payload.scope === 'mfa_setup' && !user.mfaEnabled ? 'mfa_setup' : 'full';
    if (scope === 'full' && this.env.REQUIRE_MFA && !user.mfaEnabled)
      throw new UnauthorizedException('MFA enrolment required');
    return {
      id: user.id,
      email: user.email,
      role: user.role,
      permissions: scope === 'full' ? permissionsFor(user.role) : [],
      scope,
    };
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
    if (!this.verifyTotp(this.crypto.decrypt(user.totpSecretEnc)!, code))
      throw new UnauthorizedException('Invalid code');
    await this.database.db.update(adminUsers).set({ mfaEnabled: true }).where(eq(adminUsers.id, p.id));
    await this.audit.record({ actorId: p.id, actorType: 'admin', action: 'auth.mfa.enabled', ip });
    const full: Principal = { ...p, scope: 'full', permissions: permissionsFor(user.role) };
    return { token: await this.sign(full), user: this.toSessionUser({ ...user, mfaEnabled: true }, full) };
  }

  private verifyTotp(base32: string, code: string): boolean {
    const totp = new OTPAuth.TOTP({ secret: OTPAuth.Secret.fromBase32(base32), digits: 6, period: 30 });
    return totp.validate({ token: code, window: 1 }) !== null;
  }
}
