import { Body, Controller, Get, HttpCode, Param, Post, Put, Req } from '@nestjs/common';
import { z } from 'zod';
import { AdminCreate, AdminPasswordReset, AdminUpdate, RoleKey, RoleUpsert } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AdminsService } from './admins.service.js';

const Uuid = z.string().uuid();
const Reason = z.object({ reason: z.string().trim().min(5).max(500) });

/** Admin accounts and roles (super admin spec: GET/POST/PUT /admins and /roles). Super Admin only by default. */
@Controller()
export class AdminsController {
  constructor(private readonly admins: AdminsService) {}

  @RequirePermissions('admins.manage')
  @Get('admins')
  list() {
    return this.admins.listAdmins();
  }

  @RequirePermissions('admins.manage')
  @Post('admins')
  create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(AdminCreate)) body: AdminCreate,
    @Req() req: Request,
  ) {
    return this.admins.createAdmin(p, body, req);
  }

  @RequirePermissions('admins.manage')
  @Put('admins/:id')
  update(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ZodPipe(Uuid)) id: string,
    @Body(new ZodPipe(AdminUpdate)) body: AdminUpdate,
    @Req() req: Request,
  ) {
    return this.admins.updateAdmin(p, id, body, req);
  }

  /** Issue #94: a new one-time password for another admin, shown once. Unlocks the account and ends its sessions. */
  @RequirePermissions('admins.manage')
  @Post('admins/:id/reset-password')
  @HttpCode(200)
  resetPassword(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ZodPipe(Uuid)) id: string,
    @Body(new ZodPipe(AdminPasswordReset)) body: AdminPasswordReset,
    @Req() req: Request,
  ) {
    return this.admins.resetPassword(p, id, body, req);
  }

  @RequirePermissions('roles.manage')
  @Get('roles')
  roles() {
    return this.admins.listRoles();
  }

  @RequirePermissions('roles.manage')
  @Post('roles')
  createRole(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(RoleUpsert.extend({ key: RoleKey }))) body: RoleUpsert & { key: string },
    @Req() req: Request,
  ) {
    return this.admins.createRole(p, body.key, body, req);
  }

  @RequirePermissions('roles.manage')
  @Put('roles/:key')
  updateRole(
    @CurrentPrincipal() p: Principal,
    @Param('key', new ZodPipe(RoleKey)) key: string,
    @Body(new ZodPipe(RoleUpsert.merge(Reason))) body: RoleUpsert & { reason: string },
    @Req() req: Request,
  ) {
    return this.admins.updateRole(p, key, body, req);
  }
}
