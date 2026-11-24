import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  ArchiveRun,
  MemberRestore,
  MemberSearch,
  MemberSegmentChange,
  MemberStatusChange,
  MemberUnmask,
  MemberUpdate,
  type BrandSelection,
  type PanelCode,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelAdminService } from './panel-admin.service.js';

const MemberId = z.string().regex(/^[a-f0-9]{24}$/i, 'a member id');
type Row = { id: string; segment?: string };
type Change = { before: Record<string, unknown>; after: Record<string, unknown> };

/**
 * Members module (super admin spec module 1) for the brand picked in the switcher. Reads are audited; writes are
 * audited with old and new values (personal data masked) and the admin's reason. Teen records need teen.read.
 */
@Controller('panel/members')
@BrandScoped()
export class MembersController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly audit: AuditService,
  ) {}

  private async deny(req: Request, brand: PanelCode, targetId: string, missing: string[]): Promise<never> {
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'authz.denied',
      outcome: 'denied',
      panel: brand,
      targetType: 'member',
      targetId,
      metadata: { missing },
    });
    throw new ForbiddenException('Teen records need the teen.read permission');
  }

  /** Loads the member for a write and refuses teen records to admins without teen.read. */
  private async guardTeen(p: Principal, brand: PanelCode, id: string, req: Request) {
    const m = await this.panel.call<Row>(brand, p.id, 'GET', R.member(id));
    if (m.segment === 'teen' && !hasOn(p, brand, ['teen.read']))
      await this.deny(req, brand, id, ['teen.read']);
    return m;
  }

  @RequirePermissions('members.read')
  @Get()
  async search(
    @Query(new ZodPipe(MemberSearch)) q: MemberSearch,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const teens = hasOn(p, brand, ['teen.read']);
    if (q.segment === 'teen' && !teens) await this.deny(req, brand, 'search', ['teen.read']);
    const data = await this.panel.call<{ items: Row[]; total: number; page: number; pageSize: number }>(
      brand,
      p.id,
      'GET',
      R.members,
      { ...q, ...(teens ? {} : { noTeens: 1 }) },
    );
    if (!teens) data.items = data.items.filter((r) => r.segment !== 'teen');
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.search',
      panel: brand,
      targetType: 'member',
      metadata: {
        filters: Object.keys(q).filter((k) => q[k as keyof MemberSearch] !== undefined),
        total: data.total,
        page: data.page,
      },
    });
    return { ...data, teensHidden: !teens };
  }

  @RequirePermissions('members.read')
  @Get(':id')
  async detail(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const m = await this.guardTeen(p, brand, id, req);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.view',
      panel: brand,
      targetType: 'member',
      targetId: id,
    });
    return { ...m, canUnmask: hasOn(p, brand, ['pii.view']) };
  }

  @RequirePermissions('members.read', 'points.read')
  @Get(':id/ledger')
  async ledger(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const data = await this.panel.call<unknown>(brand, p.id, 'GET', R.memberLedger(id));
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.ledger.view',
      panel: brand,
      targetType: 'member',
      targetId: id,
    });
    return data;
  }

  @RequirePermissions('members.edit')
  @Put(':id')
  async update(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberUpdate)) body: MemberUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const { reason, ...patch } = body;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.member(id), undefined, patch);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.edit',
      panel: brand,
      targetType: 'member',
      targetId: id,
      before: r.before,
      after: r.after,
      reason,
    });
    return r;
  }

  @RequirePermissions('members.status')
  @Post(':id/status')
  async status(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberStatusChange)) body: MemberStatusChange,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.memberStatus(id), undefined, body);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: `members.${body.action}`,
      panel: brand,
      targetType: 'member',
      targetId: id,
      before: r.before,
      after: r.after,
      reason: body.reason,
    });
    return r;
  }

  @RequirePermissions('members.edit', 'segments.manage')
  @Post(':id/segment')
  async segment(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberSegmentChange)) body: MemberSegmentChange,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.memberSegment(id), undefined, body);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.segment.change',
      panel: brand,
      targetType: 'member',
      targetId: id,
      before: r.before,
      after: r.after,
      reason: body.reason,
    });
    return r;
  }

  /** Full values of masked fields. Needs pii.view and a reason; the audit entry names the fields, never the values. */
  @RequirePermissions('members.read', 'pii.view')
  @Post(':id/unmask')
  async unmask(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberUnmask)) body: MemberUnmask,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    // Logged before the values are fetched, so a failed call still shows the attempt.
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.unmask',
      panel: brand,
      targetType: 'member',
      targetId: id,
      metadata: { fields: body.fields },
      reason: body.reason,
    });
    return this.panel.call<unknown>(brand, p.id, 'POST', R.memberUnmask(id), undefined, {
      fields: body.fields,
    });
  }

  /** Six-month activity check. Dry run by default; a real run needs a reason. */
  @RequirePermissions('members.status')
  @Post('archive-run')
  async archiveRun(
    @Body(new ZodPipe(ArchiveRun)) body: ArchiveRun,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    if (!body.dryRun && !body.reason) throw new ForbiddenException('A real archive run needs a reason');
    const r = await this.panel.call<Record<string, unknown>>(brand, p.id, 'POST', R.archiveRun, undefined, {
      months: body.months,
      dryRun: body.dryRun,
    });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: body.dryRun ? 'members.archive_run.dry_run' : 'members.archive_run',
      panel: brand,
      targetType: 'member',
      metadata: {
        months: r.months,
        checked: r.checked,
        archived: r.archived,
        activityUpdated: r.activityUpdated,
      },
      reason: body.reason ?? null,
    });
    return r;
  }

  @RequirePermissions('members.status')
  @Post('restore')
  async restore(
    @Body(new ZodPipe(MemberRestore)) body: MemberRestore,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ asked: number; restored: number }>(
      brand,
      p.id,
      'POST',
      R.restore,
      undefined,
      body,
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.restore',
      panel: brand,
      targetType: 'member',
      metadata: { ...r, ids: body.ids.slice(0, 50) },
      reason: body.reason,
    });
    return r;
  }
}
