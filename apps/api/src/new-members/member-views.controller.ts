import { Body, Controller, Delete, ForbiddenException, Get, HttpCode, NotFoundException, Param, Post, Req } from '@nestjs/common';
import { and, desc, eq, or } from 'drizzle-orm';
import { z } from 'zod';
import { MemberViewCreate, MemberViewParams, type BrandSelection, type MemberView } from '@madp/contracts';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { adminUsers, memberSavedViews } from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';

const ViewId = z.string().uuid();
/** Enough for every useful slice of a brand; keeps the chip row readable. */
const MAX_PER_ADMIN = 30;

/**
 * Saved views of the Members table, for the brand picked in the switcher: an admin's own views plus the views others
 * shared on that brand. Filters only, no personal data. Works the same for T2O, MFR, MHO and any added panel.
 */
@Controller('member-views')
@BrandScoped()
export class MemberViewsController {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('members.read')
  @Get()
  async list(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal): Promise<{ views: MemberView[] }> {
    const rows = await this.database.db
      .select({ v: memberSavedViews, author: adminUsers.displayName })
      .from(memberSavedViews)
      .innerJoin(adminUsers, eq(adminUsers.id, memberSavedViews.adminUserId))
      .where(
        and(
          eq(memberSavedViews.panel, b),
          or(eq(memberSavedViews.adminUserId, p.id), eq(memberSavedViews.shared, true)),
        ),
      )
      .orderBy(desc(memberSavedViews.createdAt));
    return {
      views: rows.map(({ v, author }) => ({
        id: v.id,
        panel: v.panel,
        name: v.name,
        // Stored params were validated on save; parse again so a later stricter schema never breaks the list.
        params: MemberViewParams.catch({}).parse(v.params),
        shared: v.shared,
        mine: v.adminUserId === p.id,
        createdBy: author,
        createdAt: v.createdAt.toISOString(),
      })),
    };
  }

  @RequirePermissions('members.read')
  @Post()
  async create(
    @Body(new ZodPipe(MemberViewCreate)) body: MemberViewCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const db = this.database.db;
    const mine = await db
      .select({ id: memberSavedViews.id, name: memberSavedViews.name })
      .from(memberSavedViews)
      .where(and(eq(memberSavedViews.panel, b), eq(memberSavedViews.adminUserId, p.id)));
    if (mine.length >= MAX_PER_ADMIN)
      throw new ForbiddenException(`You can keep ${MAX_PER_ADMIN} views per brand. Delete one first.`);
    if (mine.some((m) => m.name.toLowerCase() === body.name.toLowerCase()))
      throw new ForbiddenException('You already have a view with this name on this brand');
    const [row] = await db
      .insert(memberSavedViews)
      .values({ panel: b, adminUserId: p.id, name: body.name, params: body.params, shared: body.shared })
      .returning({ id: memberSavedViews.id });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.view_saved',
      panel: b,
      targetType: 'member_view',
      targetId: row!.id,
      metadata: { name: body.name, shared: body.shared, filters: Object.keys(body.params) },
    });
    return { id: row!.id };
  }

  /** Only the author deletes a view, shared or not. */
  @RequirePermissions('members.read')
  @Delete(':id')
  @HttpCode(200)
  async remove(
    @Param('id', new ZodPipe(ViewId)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const gone = await this.database.db
      .delete(memberSavedViews)
      .where(and(eq(memberSavedViews.id, id), eq(memberSavedViews.panel, b), eq(memberSavedViews.adminUserId, p.id)))
      .returning({ id: memberSavedViews.id });
    if (!gone.length) throw new NotFoundException('View not found, or it is not yours');
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.view_deleted',
      panel: b,
      targetType: 'member_view',
      targetId: id,
    });
    return { deleted: id };
  }
}
