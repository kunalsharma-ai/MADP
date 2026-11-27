import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { asc, eq, inArray } from 'drizzle-orm';
import {
  Permission,
  type AdminCreate,
  type AdminPasswordReset,
  type AdminUpdate,
  type RoleDefinition,
  type RoleGrant,
  type RoleUpsert,
} from '@madp/contracts';
import type { Request } from 'express';
import { Database } from '../db/database.js';
import { adminRoleGrants, adminRoles, adminUsers } from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthService } from '../auth/auth.service.js';
import { computeAccess, covers } from '../auth/access.js';
import { PanelDirectory } from '../panels/panel-directory.js';
import type { Principal } from '../auth/auth.types.js';

const KNOWN = new Set<string>(Permission.options);

/** Admin accounts and roles. Admins live only here, never in panel member data, so no member update can make one. */
@Injectable()
export class AdminsService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly panels: PanelDirectory,
  ) {}

  async listRoles(): Promise<(RoleDefinition & { holders: number })[]> {
    const roles = await this.database.db
      .select()
      .from(adminRoles)
      .orderBy(asc(adminRoles.system), asc(adminRoles.name));
    const grants = await this.database.db.select({ role: adminRoleGrants.roleKey }).from(adminRoleGrants);
    const count = new Map<string, number>();
    for (const g of grants) count.set(g.role, (count.get(g.role) ?? 0) + 1);
    return roles.map((r) => ({
      key: r.key,
      name: r.name,
      description: r.description,
      permissions: r.permissions.filter((p): p is Permission => KNOWN.has(p)),
      system: r.system,
      holders: count.get(r.key) ?? 0,
    }));
  }

  private async rolePermissionMap(keys?: string[]) {
    const rows = await this.database.db
      .select()
      .from(adminRoles)
      .where(keys ? inArray(adminRoles.key, keys.length ? keys : ['-']) : undefined);
    return new Map(rows.map((r) => [r.key, r.permissions.filter((p): p is Permission => KNOWN.has(p))]));
  }

  /** You may only hand out what you hold yourself, on the same brands. */
  private async assertCanGrant(actor: Principal, grants: RoleGrant[]) {
    const map = await this.rolePermissionMap(grants.map((g) => g.role));
    const unknown = grants.filter((g) => !map.has(g.role)).map((g) => g.role);
    if (unknown.length) throw new BadRequestException(`Unknown role: ${unknown.join(', ')}`);
    if (new Set(grants.map((g) => g.role)).size !== grants.length)
      throw new BadRequestException('Each role once');
    const known = new Set(this.panels.codes());
    const stray = grants.flatMap((g) => g.brands ?? []).filter((b) => !known.has(b));
    if (stray.length)
      throw new BadRequestException(`Unknown or archived panel: ${[...new Set(stray)].join(', ')}`);
    if (!covers(actor, computeAccess(grants, map, this.panels.codes(), this.panels.explicitGrantCodes())))
      throw new ForbiddenException('You cannot grant permissions or brands you do not hold');
  }

  async createRole(actor: Principal, key: string, body: RoleUpsert, req: Request) {
    if (
      !covers(
        actor,
        computeAccess(
          [{ role: key, brands: null }],
          new Map([[key, body.permissions]]),
          this.panels.codes(),
          this.panels.explicitGrantCodes(),
        ),
      )
    )
      throw new ForbiddenException('You cannot create a role with permissions you do not hold');
    const exists = await this.database.db.query.adminRoles.findFirst({ where: eq(adminRoles.key, key) });
    if (exists) throw new ConflictException('A role with this key exists');
    const permissions = [...new Set(body.permissions)].sort();
    await this.database.db
      .insert(adminRoles)
      .values({ key, name: body.name, description: body.description, permissions });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'roles.create',
      targetType: 'admin_role',
      targetId: key,
      after: { name: body.name, permissions },
    });
    return { key };
  }

  async updateRole(actor: Principal, key: string, body: RoleUpsert & { reason: string }, req: Request) {
    const role = await this.database.db.query.adminRoles.findFirst({ where: eq(adminRoles.key, key) });
    if (!role) throw new NotFoundException();
    if (key === 'super_admin')
      throw new ForbiddenException('The Super Admin role always holds every permission');
    if (
      !covers(
        actor,
        computeAccess(
          [{ role: key, brands: null }],
          new Map([[key, body.permissions]]),
          this.panels.codes(),
          this.panels.explicitGrantCodes(),
        ),
      )
    )
      throw new ForbiddenException('You cannot give a role permissions you do not hold');
    const permissions = [...new Set(body.permissions)].sort();
    await this.database.db
      .update(adminRoles)
      .set({ name: body.name, description: body.description, permissions, updatedAt: new Date() })
      .where(eq(adminRoles.key, key));
    const added = permissions.filter((p) => !role.permissions.includes(p));
    const removed = role.permissions.filter((p) => !permissions.includes(p as Permission));
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'roles.update',
      targetType: 'admin_role',
      targetId: key,
      before: { name: role.name, permissions: role.permissions },
      after: { name: body.name, permissions },
      metadata: { added, removed },
      reason: body.reason,
    });
    return { key };
  }

  async listAdmins() {
    const users = await this.database.db.select().from(adminUsers).orderBy(asc(adminUsers.email));
    const grants = await this.database.db.select().from(adminRoleGrants);
    return users.map((u) => ({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      isActive: u.isActive,
      mfaEnabled: u.mfaEnabled,
      lastLoginAt: u.lastLoginAt,
      lockedUntil: u.lockedUntil,
      grants: grants
        .filter((g) => g.adminId === u.id)
        .map((g) => ({ role: g.roleKey, brands: g.brands?.length ? g.brands : null })),
    }));
  }

  /** New admin with a one-time password, shown once. Two-factor enrolment is forced at first sign-in. */
  async createAdmin(actor: Principal, body: AdminCreate, req: Request) {
    await this.assertCanGrant(actor, body.grants);
    const exists = await this.database.db.query.adminUsers.findFirst({
      where: eq(adminUsers.email, body.email.toLowerCase()),
    });
    if (exists) throw new ConflictException('An admin with this e-mail exists');
    const oneTimePassword = randomBytes(15).toString('base64url');
    const id = await this.auth.createAdminWithGrants(
      body.email,
      body.displayName,
      oneTimePassword,
      body.grants,
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'admins.create',
      targetType: 'admin_user',
      targetId: id,
      after: { email: body.email, displayName: body.displayName, grants: body.grants },
    });
    return { id, oneTimePassword };
  }

  async updateAdmin(actor: Principal, id: string, body: AdminUpdate, req: Request) {
    const user = await this.database.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, id) });
    if (!user) throw new NotFoundException();
    if (id === actor.id && (body.grants || body.isActive === false))
      throw new ForbiddenException('Ask another Super Admin to change your own roles or status');
    const current = await this.auth.accessOf(id);
    // Changing someone who holds more than you is refused, as is granting more than you hold.
    if (!covers(actor, current)) throw new ForbiddenException('This admin holds permissions you do not');
    if (body.grants) await this.assertCanGrant(actor, body.grants);
    const before = { displayName: user.displayName, isActive: user.isActive, grants: current.grants };
    const after = {
      displayName: body.displayName ?? user.displayName,
      isActive: body.isActive ?? user.isActive,
      grants: body.grants ?? current.grants,
    };
    await this.database.db.transaction(async (tx) => {
      await tx
        .update(adminUsers)
        .set({ displayName: after.displayName, isActive: after.isActive, updatedAt: new Date() })
        .where(eq(adminUsers.id, id));
      if (body.grants) {
        await tx.delete(adminRoleGrants).where(eq(adminRoleGrants.adminId, id));
        await tx
          .insert(adminRoleGrants)
          .values(body.grants.map((g) => ({ adminId: id, roleKey: g.role, brands: g.brands })));
      }
      // At least one active Super Admin on every brand must remain.
      const supers = await tx
        .select({ id: adminUsers.id, brands: adminRoleGrants.brands })
        .from(adminRoleGrants)
        .innerJoin(adminUsers, eq(adminUsers.id, adminRoleGrants.adminId))
        .where(eq(adminRoleGrants.roleKey, 'super_admin'));
      if (!supers.some((s) => !s.brands?.length && (s.id !== id || after.isActive)))
        throw new ConflictException('At least one active Super Admin on every brand must remain');
    });
    if (!after.isActive) await this.auth.revokeSessions(id);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'admins.update',
      targetType: 'admin_user',
      targetId: id,
      before,
      after,
      reason: body.reason,
    });
    return { id };
  }

  /**
   * Issue #94: a Super Admin resets another admin's password. A new one-time password is returned once (hand it over
   * in person or by phone, like a new admin's), the account is unlocked and every session ends. Your own password is
   * changed under My account instead, with the current one.
   */
  async resetPassword(actor: Principal, id: string, body: AdminPasswordReset, req: Request) {
    if (id === actor.id) throw new ForbiddenException('Change your own password under My account');
    const user = await this.database.db.query.adminUsers.findFirst({ where: eq(adminUsers.id, id) });
    if (!user) throw new NotFoundException();
    if (!covers(actor, await this.auth.accessOf(id)))
      throw new ForbiddenException('This admin holds permissions you do not');
    const oneTimePassword = randomBytes(15).toString('base64url');
    await this.auth.setPassword(id, oneTimePassword, { resetMfa: body.resetMfa });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'admins.password_reset',
      targetType: 'admin_user',
      targetId: id,
      metadata: {
        resetMfa: body.resetMfa,
        wasLocked: Boolean(user.lockedUntil && user.lockedUntil > new Date()),
      },
      reason: body.reason,
    });
    return { id, oneTimePassword };
  }
}
