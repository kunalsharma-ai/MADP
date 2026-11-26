import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  AudienceCategory,
  AudienceSegmentCreate,
  AudienceSegmentUpdate,
  PanelReason,
  SegmentRuleCreate,
  type AudienceSegmentInfo,
  type SegmentRuleInfo,
} from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { audienceSegments, segmentRules } from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelDirectory } from '../panels/panel-directory.js';
import { SegmentDirectory } from './segment-directory.js';

/**
 * Audience segments screen. MADP's segments (Consumers, Business Professionals, Healthcare Professionals, Patients,
 * Caregivers, Teens, and any a Super Admin adds) and the rules that put a panel's members into them. A Super Admin on
 * every brand adds and edits segments, archives one (sync stops adding members; nothing is deleted), restores it, or
 * deletes one that has no members. Built-in segments can't be deleted, and Teens always stays a minors segment.
 */
@Controller('audience-segments')
export class AudienceSegmentsController {
  constructor(
    private readonly database: Database,
    private readonly directory: SegmentDirectory,
    private readonly panels: PanelDirectory,
    private readonly audit: AuditService,
  ) {}

  /** Every signed-in admin sees the segments (filters need the labels). Archived ones and rules need connectors.read. */
  @Get()
  async list(
    @CurrentPrincipal() p: Principal,
  ): Promise<{ segments: (AudienceSegmentInfo & { hasMembers: boolean })[]; rules: SegmentRuleInfo[] }> {
    await this.directory.reload();
    const full = p.permissions.includes('connectors.read');
    const used = await this.database.db.execute<{ category: string }>(
      sql`select distinct category from category_membership`,
    );
    const withMembers = new Set(used.rows.map((r) => r.category));
    return {
      segments: this.directory
        .all()
        .filter((s) => s.status === 'active' || full)
        .map((s) => ({ ...s, hasMembers: withMembers.has(s.key) })),
      rules: full ? this.directory.rules() : [],
    };
  }

  @RequirePermissions('connectors.read')
  @Post()
  async create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(AudienceSegmentCreate)) body: AudienceSegmentCreate,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, body.key);
    if (this.directory.get(body.key)) throw new ConflictException('A segment with that key already exists');
    if (this.directory.all().some((s) => s.label.toLowerCase() === body.label.toLowerCase()))
      throw new ConflictException('A segment with that name already exists');
    const maxSort = Math.max(0, ...this.directory.all().map((s) => s.sort));
    await this.database.db.insert(audienceSegments).values({
      key: body.key,
      label: body.label,
      description: body.description ?? '',
      minors: body.minors,
      builtIn: false,
      status: 'active',
      sort: maxSort + 1,
      createdBy: p.id,
    });
    await this.directory.reload();
    await this.record(req, body.key, 'segments.create', body.reason, {
      after: { label: body.label, minors: body.minors },
    });
    return this.directory.get(body.key);
  }

  @RequirePermissions('connectors.read')
  @Put(':key')
  async update(
    @CurrentPrincipal() p: Principal,
    @Param('key', new ZodPipe(AudienceCategory)) key: string,
    @Body(new ZodPipe(AudienceSegmentUpdate)) body: AudienceSegmentUpdate,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, key);
    const cur = this.mustGet(key);
    const { reason, ...patch } = body;
    if (patch.minors !== undefined && patch.minors !== cur.minors) {
      if (key === 'teen') throw new BadRequestException('Teens always stays a minors segment');
      if (await this.hasMembers(key))
        throw new ConflictException('This segment already has members, so whether it holds minors stays as it is');
    }
    if (
      patch.label &&
      this.directory.all().some((s) => s.key !== key && s.label.toLowerCase() === patch.label!.toLowerCase())
    )
      throw new ConflictException('A segment with that name already exists');
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (!Object.keys(set).length) return cur;
    await this.database.db
      .update(audienceSegments)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(audienceSegments.key, key));
    if (patch.minors === true)
      await this.database.db.update(segmentRules).set({ minor: true, updatedAt: new Date() }).where(eq(segmentRules.segment, key));
    await this.directory.reload();
    const before = Object.fromEntries(
      Object.keys(set).map((k) => [k, (cur as unknown as Record<string, unknown>)[k]]),
    );
    await this.record(req, key, 'segments.update', reason, { before, after: set });
    return this.directory.get(key);
  }

  /** Sync stops adding members to the segment and it is hidden from filters. Existing memberships stay. */
  @RequirePermissions('connectors.read')
  @Post(':key/archive')
  @HttpCode(200)
  async archive(
    @CurrentPrincipal() p: Principal,
    @Param('key', new ZodPipe(AudienceCategory)) key: string,
    @Body(new ZodPipe(PanelReason)) body: PanelReason,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, key);
    const cur = this.mustGet(key);
    if (cur.status === 'archived') return cur;
    await this.database.db
      .update(audienceSegments)
      .set({ status: 'archived', archivedAt: new Date(), archivedBy: p.id, updatedAt: new Date() })
      .where(eq(audienceSegments.key, key));
    await this.directory.reload();
    await this.record(req, key, 'segments.archive', body.reason, {
      before: { status: 'active' },
      after: { status: 'archived' },
    });
    return this.directory.get(key);
  }

  @RequirePermissions('connectors.read')
  @Post(':key/restore')
  @HttpCode(200)
  async restore(
    @CurrentPrincipal() p: Principal,
    @Param('key', new ZodPipe(AudienceCategory)) key: string,
    @Body(new ZodPipe(PanelReason)) body: PanelReason,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, key);
    const cur = this.mustGet(key);
    if (cur.status === 'active') return cur;
    await this.database.db
      .update(audienceSegments)
      .set({ status: 'active', archivedAt: null, archivedBy: null, updatedAt: new Date() })
      .where(eq(audienceSegments.key, key));
    await this.directory.reload();
    await this.record(req, key, 'segments.restore', body.reason, {
      before: { status: 'archived' },
      after: { status: 'active' },
    });
    return this.directory.get(key);
  }

  /** Deletes a segment that has no members, with its rules. A segment with members is archived instead. */
  @RequirePermissions('connectors.read')
  @Delete(':key')
  async remove(
    @CurrentPrincipal() p: Principal,
    @Param('key', new ZodPipe(AudienceCategory)) key: string,
    @Body(new ZodPipe(PanelReason)) body: PanelReason,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, key);
    const cur = this.mustGet(key);
    if (cur.builtIn) throw new BadRequestException(`${cur.label} is built in and can't be deleted`);
    if (await this.hasMembers(key))
      throw new ConflictException('This segment has members. Archive it instead, so nothing is lost.');
    try {
      await this.database.db.transaction(async (tx) => {
        await tx.delete(segmentRules).where(eq(segmentRules.segment, key));
        await tx.delete(audienceSegments).where(eq(audienceSegments.key, key));
      });
    } catch (e) {
      const code = (e as { code?: string; cause?: { code?: string } }).cause?.code ?? (e as { code?: string }).code;
      if (code === '23503')
        throw new ConflictException('Other records still refer to this segment (for example an attribute). Archive it instead.');
      throw e;
    }
    await this.directory.reload();
    await this.record(req, key, 'segments.delete', body.reason, { before: { label: cur.label, status: cur.status } });
    return { deleted: key };
  }

  // ---- rules: a panel's category value -> segment -------------------------------------------------------------

  /** New members whose panel category matches join the segment at their next sync. Existing members are not moved. */
  @RequirePermissions('connectors.read')
  @Post('rules')
  async addRule(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(SegmentRuleCreate)) body: SegmentRuleCreate,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, body.segment);
    const seg = this.mustGet(body.segment);
    if (seg.status !== 'active') throw new BadRequestException('Restore the segment before adding rules to it');
    if (!this.panels.isActive(body.panel)) throw new BadRequestException('That panel is archived');
    const minor = seg.minors || body.minor;
    const [row] = await this.database.db
      .insert(segmentRules)
      .values({
        panel: body.panel,
        sourceValue: body.sourceValue,
        segment: body.segment,
        minor,
        evidence: body.evidence ?? '',
        createdBy: p.id,
      })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException('That rule already exists');
    await this.directory.reload();
    await this.record(req, body.segment, 'segments.rule.create', body.reason, {
      after: { panel: body.panel, sourceValue: body.sourceValue, segment: body.segment, minor },
    });
    return this.directory.rules().find((r) => r.id === row.id);
  }

  @RequirePermissions('connectors.read')
  @Post('rules/:id/:action')
  @HttpCode(200)
  async ruleState(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Param('action') action: string,
    @Body(new ZodPipe(PanelReason)) body: PanelReason,
    @Req() req: Request,
  ) {
    if (action !== 'archive' && action !== 'restore') throw new NotFoundException();
    const rule = this.mustGetRule(id);
    await this.requireSuperAdmin(p, req, rule.segment);
    const status = action === 'archive' ? 'archived' : 'active';
    await this.database.db
      .update(segmentRules)
      .set({ status, updatedAt: new Date() })
      .where(eq(segmentRules.id, id));
    await this.directory.reload();
    await this.record(req, rule.segment, `segments.rule.${action}`, body.reason, {
      before: { rule: id, status: rule.status },
      after: { rule: id, status },
    });
    return this.directory.rules().find((r) => r.id === id);
  }

  @RequirePermissions('connectors.read')
  @Delete('rules/:id')
  async removeRule(
    @CurrentPrincipal() p: Principal,
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(PanelReason)) body: PanelReason,
    @Req() req: Request,
  ) {
    const rule = this.mustGetRule(id);
    await this.requireSuperAdmin(p, req, rule.segment);
    await this.database.db.delete(segmentRules).where(and(eq(segmentRules.id, id)));
    await this.directory.reload();
    await this.record(req, rule.segment, 'segments.rule.delete', body.reason, {
      before: { panel: rule.panel, sourceValue: rule.sourceValue, segment: rule.segment, minor: rule.minor },
    });
    return { deleted: id };
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  private mustGet(key: string): AudienceSegmentInfo {
    const cur = this.directory.get(key);
    if (!cur) throw new NotFoundException('No such segment');
    return cur;
  }

  private mustGetRule(id: string): SegmentRuleInfo {
    const r = this.directory.rules().find((x) => x.id === id);
    if (!r) throw new NotFoundException('No such rule');
    return r;
  }

  private async hasMembers(key: string) {
    const r = await this.database.db.execute(sql`select 1 from category_membership where category = ${key} limit 1`);
    return r.rows.length > 0;
  }

  private async requireSuperAdmin(p: Principal, req: Request, key: string) {
    if (p.grants.some((g) => g.role === 'super_admin' && g.brands === null)) return;
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'authz.denied',
      outcome: 'denied',
      targetType: 'audience_segment',
      targetId: key,
      metadata: { missing: ['role:super_admin on every brand'] },
    });
    throw new ForbiddenException('Only a Super Admin on every brand can add or change segments');
  }

  private async record(
    req: Request,
    key: string,
    action: string,
    reason: string,
    diff: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ) {
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      targetType: 'audience_segment',
      targetId: key,
      ...diff,
      reason,
    });
  }
}
