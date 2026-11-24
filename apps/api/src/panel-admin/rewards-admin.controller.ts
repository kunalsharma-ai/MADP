import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  CatalogueCreate,
  CatalogueUpdate,
  DataRequestDecision,
  DataRequestList,
  DrawAction,
  DrawCreate,
  IdeaDecision,
  OfferCreate,
  RedemptionDecision,
  RedemptionList,
  StoryCreate,
  StoryUpdate,
  SwitchKey,
  SwitchSet,
  TaskCreate,
  TaskUpdate,
  TeenGraduate,
  TeenList,
  TeenReason,
  type BrandSelection,
  type PanelCode,
  type SwitchBoard,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { Database } from '../db/database.js';
import { brandSettings } from '../db/schema.js';
import { PanelAdminService } from './panel-admin.service.js';

const Id = z.string().regex(/^[a-f0-9]{24}$/i, 'an id');
const Key = z.string().regex(/^[a-z0-9-]{2,60}$/, 'a catalogue key');
type Extra = Partial<Parameters<AuditService['record']>[0]>;
type Redemption = {
  id: string;
  reference: string;
  points: number;
  status: string;
  member: { id: string; teen: boolean } | null;
  history?: { status: string; by: string }[];
};

/** Holds the Super Admin role on this brand (a grant for every brand counts). */
export function isSuperAdminOn(p: Principal, brand: PanelCode) {
  return p.grants.some((g) => g.role === 'super_admin' && (g.brands === null || g.brands.includes(brand)));
}

/**
 * Feature switches, rewards, engagement, the Teen Panel and data requests (super admin spec, step 4) for the brand
 * picked in the switcher. Money, legal and e-mail switches are flipped by Super Admin only, always with a reason.
 */
@Controller('panel')
@BrandScoped()
export class RewardsAdminController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private log(
    req: Request,
    brand: PanelCode,
    action: string,
    targetType: string,
    targetId?: string,
    extra: Extra = {},
  ) {
    return this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      panel: brand,
      targetType,
      targetId,
      ...extra,
    });
  }

  private async deny(
    req: Request,
    brand: PanelCode,
    targetType: string,
    id: string | undefined,
    missing: string[],
    msg: string,
  ): Promise<never> {
    await this.log(req, brand, 'authz.denied', targetType, id, { outcome: 'denied', metadata: { missing } });
    throw new ForbiddenException(msg);
  }

  // ---- switches ---------------------------------------------------------------------------------------------------
  @RequirePermissions('switches.read')
  @Get('switches')
  async switches(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    const brand = b as PanelCode;
    const board = await this.panel.call<SwitchBoard>(brand, p.id, 'GET', R.switches);
    return { ...board, canFlip: hasOn(p, brand, ['switches.flip']) && isSuperAdminOn(p, brand) };
  }

  @RequirePermissions('switches.flip')
  @Put('switches/:key')
  async flip(
    @Param('key', new ZodPipe(SwitchKey)) key: SwitchKey,
    @Body(new ZodPipe(SwitchSet)) body: SwitchSet,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    // the permission can be given to a custom role, but the spec keeps the switches with Super Admin
    if (!isSuperAdminOn(p, brand))
      await this.deny(
        req,
        brand,
        'switch',
        key,
        ['role:super_admin'],
        'Only Super Admin can change switches',
      );
    const r = await this.panel.call<{ key: string; before: boolean | null; on: boolean; board: SwitchBoard }>(
      brand,
      p.id,
      'PUT',
      R.switch(key),
      undefined,
      body,
    );
    await this.log(req, brand, key === 'kill' ? 'switch.kill' : 'switch.flip', 'switch', key, {
      before: { on: r.before },
      after: { on: r.on },
      reason: body.reason,
    });
    return r;
  }

  // ---- catalogue --------------------------------------------------------------------------------------------------
  @RequirePermissions('rewards.manage')
  @Get('rewards/catalogue')
  catalogue(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.catalogue);
  }

  @RequirePermissions('rewards.manage')
  @Post('rewards/catalogue')
  async createItem(
    @Body(new ZodPipe(CatalogueCreate)) body: CatalogueCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ key: string; points: number }>(
      brand,
      p.id,
      'POST',
      R.catalogue,
      undefined,
      body,
    );
    await this.log(req, brand, 'rewards.catalogue.create', 'catalogue_item', r.key, { after: r });
    return r;
  }

  @RequirePermissions('rewards.manage')
  @Put('rewards/catalogue/:key')
  async updateItem(
    @Param('key', new ZodPipe(Key)) key: string,
    @Body(new ZodPipe(CatalogueUpdate)) body: CatalogueUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...change } = body;
    const r = await this.panel.call<{ before: Record<string, unknown>; item: Record<string, unknown> }>(
      brand,
      p.id,
      'PUT',
      R.catalogueItem(key),
      undefined,
      change,
    );
    await this.log(req, brand, 'rewards.catalogue.update', 'catalogue_item', key, {
      before: r.before,
      after: r.item,
      reason,
    });
    return r;
  }

  // ---- redemptions ------------------------------------------------------------------------------------------------
  @RequirePermissions('redemptions.manage')
  @Get('redemptions')
  async redemptions(
    @Query(new ZodPipe(RedemptionList)) q: RedemptionList,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ items: Redemption[] }>(brand, p.id, 'GET', R.redemptions, q);
    const teens = hasOn(p, brand, ['teen.read']);
    const items = teens ? r.items : r.items.filter((x) => !x.member?.teen);
    await this.log(req, brand, 'redemptions.search', 'redemption', undefined, {
      metadata: { status: q.status ?? null, shown: items.length },
    });
    return { ...r, items, teensHidden: !teens };
  }

  private async redemption(p: Principal, brand: PanelCode, id: string, req: Request) {
    const r = await this.panel.call<Redemption & Record<string, unknown>>(
      brand,
      p.id,
      'GET',
      R.redemption(id),
    );
    if (r.member?.teen && !hasOn(p, brand, ['teen.read']))
      await this.deny(
        req,
        brand,
        'redemption',
        id,
        ['teen.read'],
        'Teen requests need the teen.read permission',
      );
    return r;
  }

  @RequirePermissions('redemptions.manage')
  @Get('redemptions/:id')
  async getRedemption(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.redemption(p, brand, id, req);
    await this.log(req, brand, 'redemption.view', 'redemption', id, { metadata: { reference: r.reference } });
    return r;
  }

  /**
   * Approve, reject or mark paid. Marking paid needs payouts.approve; at or above the brand's four-eyes amount the
   * admin who approved can't also mark it paid. The panel refuses approve and paid while the money switch is off.
   */
  @RequirePermissions('redemptions.manage')
  @Post('redemptions/:id/decision')
  async decide(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(RedemptionDecision)) body: RedemptionDecision,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const cur = await this.redemption(p, brand, id, req);
    if (body.status === 'fulfilled') {
      if (!hasOn(p, brand, ['payouts.approve']))
        await this.deny(
          req,
          brand,
          'redemption',
          id,
          ['payouts.approve'],
          'Marking a payout as paid needs payouts.approve',
        );
      const row = await this.database.db.query.brandSettings.findFirst({
        where: eq(brandSettings.panel, brand),
      });
      const limit = row?.fourEyesPoints ?? 50_000;
      const approver = [...(cur.history ?? [])].reverse().find((h) => h.status === 'approved')?.by;
      if (cur.points >= limit && approver === `madp:${p.id}`)
        await this.deny(
          req,
          brand,
          'redemption',
          id,
          ['four_eyes'],
          `At ${limit} points or more, a second admin marks it paid`,
        );
    }
    const r = await this.panel.call<{ before: string; after: string; pointsReturned: number }>(
      brand,
      p.id,
      'POST',
      R.redemptionDecision(id),
      undefined,
      body,
    );
    await this.log(req, brand, `redemption.${body.status}`, 'redemption', id, {
      before: { status: r.before },
      after: { status: r.after },
      reason: body.reason,
      metadata: { reference: cur.reference, points: cur.points, pointsReturned: r.pointsReturned },
    });
    return r;
  }

  // ---- draws and offers -------------------------------------------------------------------------------------------
  @RequirePermissions('rewards.manage')
  @Get('draws')
  draws(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.draws);
  }

  @RequirePermissions('rewards.manage')
  @Post('draws')
  async createDraw(
    @Body(new ZodPipe(DrawCreate)) body: DrawCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ id: string }>(brand, p.id, 'POST', R.draws, undefined, body);
    await this.log(req, brand, 'draw.create', 'draw', r.id, { after: r });
    return r;
  }

  @RequirePermissions('rewards.manage')
  @Post('draws/:id/run')
  runDraw(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(DrawAction)) body: DrawAction,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.drawAction('run', id, body, b as PanelCode, p, req);
  }

  @RequirePermissions('rewards.manage')
  @Post('draws/:id/cancel')
  cancelDraw(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(DrawAction)) body: DrawAction,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.drawAction('cancel', id, body, b as PanelCode, p, req);
  }

  private async drawAction(
    action: 'run' | 'cancel',
    id: string,
    body: DrawAction,
    brand: PanelCode,
    p: Principal,
    req: Request,
  ) {
    const r = await this.panel.call<Record<string, unknown>>(
      brand,
      p.id,
      'POST',
      action === 'run' ? R.drawRun(id) : R.drawCancel(id),
    );
    // winners are member ids: kept in the panel, the audit records how many
    await this.log(req, brand, `draw.${action}`, 'draw', id, {
      reason: body.reason,
      metadata: {
        status: r.status,
        entries: r.entries ?? null,
        winners: Array.isArray(r.winners) ? r.winners.length : null,
      },
    });
    return r;
  }

  @RequirePermissions('rewards.manage')
  @Get('offers')
  offers(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.offers);
  }

  @RequirePermissions('rewards.manage')
  @Post('offers')
  async createOffer(
    @Body(new ZodPipe(OfferCreate)) body: OfferCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...offer } = body;
    const r = await this.panel.call<{ id: string }>(brand, p.id, 'POST', R.offers, undefined, offer);
    await this.log(req, brand, 'offer.create', 'offer', r.id, { after: r, reason });
    return r;
  }

  @RequirePermissions('rewards.manage')
  @Post('offers/:id/end')
  async endOffer(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(DrawAction)) body: DrawAction,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call(brand, p.id, 'POST', R.offerEnd(id));
    await this.log(req, brand, 'offer.end', 'offer', id, { reason: body.reason });
    return r;
  }

  // ---- engagement -------------------------------------------------------------------------------------------------
  @RequirePermissions('content.manage')
  @Get('engagement/tasks')
  tasks(
    @Query('kind') kind: string | undefined,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.tasks, kind ? { kind } : undefined);
  }

  @RequirePermissions('content.manage')
  @Post('engagement/tasks')
  async createTask(
    @Body(new ZodPipe(TaskCreate)) body: TaskCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ id: string }>(brand, p.id, 'POST', R.tasks, undefined, body);
    await this.log(req, brand, 'engagement.task.create', 'task', r.id, { after: r });
    return r;
  }

  @RequirePermissions('content.manage')
  @Put('engagement/tasks/:id')
  async updateTask(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(TaskUpdate)) body: TaskUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Record<string, unknown>>(brand, p.id, 'PUT', R.task(id), undefined, body);
    await this.log(req, brand, 'engagement.task.update', 'task', id, { after: r });
    return r;
  }

  /** Teen ideas are a teen's own words: reading and moderating them needs teen.review. */
  @RequirePermissions('content.manage', 'teen.review')
  @Get('engagement/ideas')
  async ideas(
    @Query('status') status: string | undefined,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<unknown[]>(
      brand,
      p.id,
      'GET',
      R.ideas,
      status === 'all' ? { status } : undefined,
    );
    await this.log(req, brand, 'engagement.ideas.view', 'task_entry', undefined, {
      metadata: { shown: r.length },
    });
    return r;
  }

  @RequirePermissions('content.manage', 'teen.review')
  @Post('engagement/ideas/:id')
  async moderate(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(IdeaDecision)) body: IdeaDecision,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call(brand, p.id, 'POST', R.idea(id), undefined, body);
    await this.log(req, brand, `engagement.idea.${body.status}`, 'task_entry', id, {
      after: { status: body.status },
    });
    return r;
  }

  @RequirePermissions('content.manage')
  @Get('engagement/stories')
  stories(
    @Query('type') type: string | undefined,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.stories, type ? { type } : undefined);
  }

  @RequirePermissions('content.manage')
  @Post('engagement/stories')
  async createStory(
    @Body(new ZodPipe(StoryCreate)) body: StoryCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ id: string }>(brand, p.id, 'POST', R.stories, undefined, body);
    await this.log(req, brand, 'engagement.story.create', 'story', r.id, {
      after: { title: body.title, type: body.type },
    });
    return r;
  }

  @RequirePermissions('content.manage')
  @Put('engagement/stories/:id')
  async updateStory(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(StoryUpdate)) body: StoryUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ published: boolean }>(brand, p.id, 'PUT', R.story(id), undefined, body);
    await this.log(
      req,
      brand,
      body.published !== undefined
        ? body.published
          ? 'engagement.story.publish'
          : 'engagement.story.unpublish'
        : 'engagement.story.update',
      'story',
      id,
      { after: { published: r.published } },
    );
    return r;
  }

  @RequirePermissions('content.manage')
  @Get('engagement/streaks')
  streaks(
    @Query('days') days: string | undefined,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.streaks, days ? { days } : undefined);
  }

  // ---- Teen Panel -------------------------------------------------------------------------------------------------
  @RequirePermissions('teen.read')
  @Get('teens')
  async teens(
    @Query(new ZodPipe(TeenList)) q: TeenList,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ total: number; due: number }>(brand, p.id, 'GET', R.teens, q);
    await this.log(req, brand, 'teens.search', 'member', undefined, {
      metadata: { turning18: q.turning18 ?? null, total: r.total },
    });
    return r;
  }

  @RequirePermissions('teen.read')
  @Get('teens/:id')
  async teen(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call(brand, p.id, 'GET', R.teen(id));
    await this.log(req, brand, 'teen.view', 'member', id);
    return r;
  }

  @RequirePermissions('teen.review')
  @Post('teens/:id/revoke-links')
  async revoke(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(TeenReason)) body: TeenReason,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ revoked: number }>(
      brand,
      p.id,
      'POST',
      R.teenRevokeLinks(id),
      undefined,
      body,
    );
    await this.log(req, brand, 'teen.guardian_links.revoke', 'member', id, {
      reason: body.reason,
      metadata: r,
    });
    return r;
  }

  /** Turning 18: a dry run shows what would change; the real move needs a reason and is audited. */
  @RequirePermissions('teen.review', 'segments.manage')
  @Post('teens/:id/graduate')
  async graduate(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(TeenGraduate)) body: TeenGraduate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ dryRun: boolean; from: string; to: string } & Record<string, unknown>>(
      brand,
      p.id,
      'POST',
      R.teenGraduate(id),
      { dryRun: body.dryRun ? undefined : 0 },
      { reason: body.reason },
    );
    if (!r.dryRun)
      await this.log(req, brand, 'teen.graduate', 'member', id, {
        before: { segment: r.from },
        after: { segment: r.to },
        reason: body.reason ?? null,
        metadata: {
          guardianLinksStopped: r.guardianLinksToStop,
          rewardRequestsCancelled: r.rewardRequestsToCancel,
        },
      });
    return r;
  }

  // ---- data requests ----------------------------------------------------------------------------------------------
  @RequirePermissions('data_requests.manage')
  @Get('data-requests')
  async dataRequests(
    @Query(new ZodPipe(DataRequestList)) q: DataRequestList,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ total: number }>(brand, p.id, 'GET', R.dataRequests, q);
    await this.log(req, brand, 'data_requests.search', 'data_request', undefined, {
      metadata: { status: q.status ?? 'open', total: r.total },
    });
    return r;
  }

  @RequirePermissions('data_requests.manage')
  @Get('data-requests/:id')
  async dataRequest(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call(brand, p.id, 'GET', R.dataRequest(id));
    await this.log(req, brand, 'data_request.view', 'data_request', id);
    return r;
  }

  @RequirePermissions('data_requests.manage')
  @Post('data-requests/:id/decision')
  async decideData(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(DataRequestDecision)) body: DataRequestDecision,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ before: string; after: string }>(
      brand,
      p.id,
      'POST',
      R.dataRequestDecision(id),
      undefined,
      body,
    );
    await this.log(req, brand, `data_request.${body.status}`, 'data_request', id, {
      before: { status: r.before },
      after: { status: r.after },
      reason: body.reason,
    });
    return r;
  }
}
