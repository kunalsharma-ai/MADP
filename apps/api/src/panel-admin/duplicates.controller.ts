import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  DuplicateSearch,
  MemberMergeRequest,
  MergeHistoryQuery,
  MergeUndo,
  type BrandSelection,
  type PanelCode,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelAdminService } from './panel-admin.service.js';

const MergeId = z.string().regex(/^[a-f0-9]{24}$/i, 'a merge id');
type Counts = Record<string, { move: number; stay: number }>;
interface MergeReport {
  dryRun: boolean;
  keep: { id: string };
  duplicate: { id: string };
  blockers: { code: string; message: string }[];
  warnings: string[];
  collections: Counts;
  referrals: number;
  points: Record<string, unknown>;
  mergeId?: string;
  moved?: Record<string, number>;
  stayed?: Record<string, number>;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
}

/**
 * Duplicate member accounts for the brand picked in the switcher (panel side: MFR#68). Finding them shows masked rows
 * only; the matching value is never returned. A merge is always a dry run first: applying needs members.status, a
 * reason and no blockers, and it moves points and history to the kept account and closes the duplicate. Undo is its
 * own action with its own reason. Teen accounts are never merged (the panel refuses them).
 */
@Controller('panel/duplicates')
@BrandScoped()
export class DuplicatesController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('members.read')
  @Get()
  async find(
    @Query(new ZodPipe(DuplicateSearch)) q: DuplicateSearch,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ by: string; groups: number; more: boolean; items: unknown[] }>(
      brand,
      p.id,
      'GET',
      R.duplicates,
      { by: q.by, limit: q.limit },
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.duplicates.search',
      panel: brand,
      targetType: 'member',
      metadata: { by: q.by, groups: r.groups, more: r.more },
    });
    return r;
  }

  @RequirePermissions('members.read', 'members.status')
  @Post('merge')
  async merge(
    @Body(new ZodPipe(MemberMergeRequest)) body: MemberMergeRequest,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<MergeReport>(
      brand,
      p.id,
      'POST',
      R.merge,
      body.apply ? { dryRun: 0 } : undefined,
      { keep: body.keep, duplicate: body.duplicate, ...(body.reason ? { reason: body.reason } : {}) },
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: r.dryRun ? 'members.merge.dry_run' : 'members.merge',
      panel: brand,
      targetType: 'member',
      targetId: body.duplicate,
      metadata: r.dryRun
        ? { keep: body.keep, blockers: r.blockers.map((x) => x.code), collections: r.collections }
        : { keep: body.keep, mergeId: r.mergeId, moved: r.moved, stayed: r.stayed, referrals: r.referrals, points: r.points },
      ...(r.dryRun ? {} : { before: r.before, after: r.after, reason: body.reason }),
    });
    return r;
  }

  @RequirePermissions('members.read')
  @Get('merges')
  async merges(
    @Query(new ZodPipe(MergeHistoryQuery)) q: MergeHistoryQuery,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    const items = await this.panel.call<unknown[]>(b as PanelCode, p.id, 'GET', R.merges, { member: q.member });
    return { items };
  }

  @RequirePermissions('members.read', 'members.status')
  @Post('merges/:id/undo')
  async undo(
    @Param('id', new ZodPipe(MergeId)) id: string,
    @Body(new ZodPipe(MergeUndo)) body: MergeUndo,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ before: Record<string, unknown>; after: Record<string, unknown>; movedBack: Record<string, number> }>(
      brand,
      p.id,
      'POST',
      R.mergeUndo(id),
      undefined,
      body,
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.merge.undo',
      panel: brand,
      targetType: 'member_merge',
      targetId: id,
      before: r.before,
      after: r.after,
      metadata: { movedBack: r.movedBack },
      reason: body.reason,
    });
    return r;
  }
}
