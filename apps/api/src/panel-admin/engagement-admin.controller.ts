import { Body, Controller, ForbiddenException, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import {
  ApprovalList,
  AudienceCount,
  AudienceSave,
  ExpertDecision,
  ExpertList,
  HoldCreate,
  HoldRelease,
  InviteRun,
  InviteTarget,
  PointsAdjust,
  PointsDecision,
  QualityChange,
  QualityReview,
  Reconcile,
  ReferralFraud,
  ResponseList,
  SegmentUpdate,
  SurveyCreate,
  SurveyList,
  SurveyStatusChange,
  SurveyUpdate,
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
import { Database } from '../db/database.js';
import { brandSettings } from '../db/schema.js';
import { PanelAdminService } from './panel-admin.service.js';

const Id = z.string().regex(/^[a-f0-9]{24}$/i, 'an id');
const SegmentName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_-]{0,39}$/, 'a segment name');
type Change = { before: Record<string, unknown> | null; after: Record<string, unknown> };
type Extra = Partial<Parameters<AuditService['record']>[0]>;

function logger(audit: AuditService) {
  return (
    req: Request,
    brand: PanelCode,
    action: string,
    targetType: string,
    targetId?: string,
    extra: Extra = {},
  ) =>
    audit.record({ ...AuditService.fromRequest(req), action, panel: brand, targetType, targetId, ...extra });
}

/** Segments and saved audiences (super admin spec module 2) for the brand picked in the switcher. */
@Controller('panel')
@BrandScoped()
export class SegmentsController {
  private readonly log;
  constructor(
    private readonly panel: PanelAdminService,
    audit: AuditService,
  ) {
    this.log = logger(audit);
  }

  @RequirePermissions('members.read')
  @Get('segments')
  segments(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.segments);
  }

  @RequirePermissions('segments.manage')
  @Put('segments/:name')
  async updateSegment(
    @Param('name', new ZodPipe(SegmentName)) name: string,
    @Body(new ZodPipe(SegmentUpdate)) body: SegmentUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...patch } = body;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.segment(name), undefined, patch);
    await this.log(req, brand, 'segments.update', 'segment', name, {
      before: r.before,
      after: r.after,
      reason,
    });
    return r;
  }

  /** A live count. Only counts leave the panel, never members. */
  @RequirePermissions('members.read')
  @Post('audiences/count')
  count(
    @Body(new ZodPipe(AudienceCount)) body: AudienceCount,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'POST', R.audienceCount, undefined, body);
  }

  @RequirePermissions('members.read')
  @Get('audiences')
  audiences(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.audiences);
  }

  @RequirePermissions('segments.manage')
  @Post('audiences')
  async createAudience(
    @Body(new ZodPipe(AudienceSave)) body: AudienceSave,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change & { id: string; count: number }>(
      brand,
      p.id,
      'POST',
      R.audiences,
      undefined,
      body,
    );
    await this.log(req, brand, 'audiences.create', 'audience', r.id, {
      after: r.after,
      metadata: { count: r.count },
    });
    return r;
  }

  @RequirePermissions('segments.manage')
  @Put('audiences/:id')
  async updateAudience(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(AudienceSave)) body: AudienceSave,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change & { count: number }>(
      brand,
      p.id,
      'PUT',
      R.audience(id),
      undefined,
      body,
    );
    await this.log(req, brand, 'audiences.update', 'audience', id, {
      before: r.before,
      after: r.after,
      metadata: { count: r.count },
    });
    return r;
  }

  @RequirePermissions('members.read')
  @Post('audiences/:id/count')
  recount(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'POST', R.audienceRecount(id));
  }
}

/** Surveys and invitations (module 5). Invitations never send e-mail: that waits for the e-mail switch. */
@Controller('panel/surveys')
@BrandScoped()
export class SurveysController {
  private readonly log;
  constructor(
    private readonly panel: PanelAdminService,
    audit: AuditService,
  ) {
    this.log = logger(audit);
  }

  @RequirePermissions('surveys.read')
  @Get()
  list(
    @Query(new ZodPipe(SurveyList)) q: SurveyList,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.surveys, q);
  }

  @RequirePermissions('surveys.read')
  @Get(':id')
  get(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.survey(id));
  }

  @RequirePermissions('surveys.manage')
  @Post()
  async create(
    @Body(new ZodPipe(SurveyCreate)) body: SurveyCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...s } = body;
    const r = await this.panel.call<Change & { id: string }>(brand, p.id, 'POST', R.surveys, undefined, s);
    await this.log(req, brand, 'surveys.create', 'survey', r.id, { after: r.after, reason: reason ?? null });
    return r;
  }

  @RequirePermissions('surveys.manage')
  @Put(':id')
  async update(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(SurveyUpdate)) body: SurveyUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...s } = body;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.survey(id), undefined, s);
    await this.log(req, brand, 'surveys.update', 'survey', id, {
      before: r.before,
      after: r.after,
      reason: reason ?? null,
    });
    return r;
  }

  @RequirePermissions('surveys.manage')
  @Post(':id/status')
  async status(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(SurveyStatusChange)) body: SurveyStatusChange,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.surveyStatus(id), undefined, {
      status: body.status,
    });
    await this.log(req, brand, `surveys.status.${body.status}`, 'survey', id, {
      before: r.before,
      after: r.after,
      reason: body.reason ?? null,
    });
    return r;
  }

  @RequirePermissions('surveys.read')
  @Post(':id/feasibility')
  feasibility(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(InviteTarget)) body: InviteTarget,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'POST', R.surveyFeasibility(id), undefined, body);
  }

  /** Dry run by default (surveys.read). A real run needs invitations.send and a reason. */
  @RequirePermissions('surveys.read')
  @Post(':id/invite')
  async invite(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(InviteRun)) body: InviteRun,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { dryRun, reason, ...target } = body;
    if (!dryRun && !hasOn(p, brand, ['invitations.send'])) PanelAdminService.forbidden();
    if (!dryRun && !reason) PanelAdminService.reasonRequired();
    const r = await this.panel.call<Record<string, unknown>>(
      brand,
      p.id,
      'POST',
      R.surveyInvite(id),
      { dryRun: dryRun ? 1 : 0 },
      target,
    );
    await this.log(req, brand, dryRun ? 'invitations.send.dry_run' : 'invitations.send', 'survey', id, {
      metadata: { ...r, audienceId: target.audienceId ?? null, filter: target.filter ?? null },
      reason: reason ?? null,
    });
    return r;
  }

  /** Member names (first name and initial) appear here, so each read is audited. */
  @RequirePermissions('surveys.read', 'members.read')
  @Get(':id/responses')
  async responses(
    @Param('id', new ZodPipe(Id)) id: string,
    @Query(new ZodPipe(ResponseList)) q: ResponseList,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ total: number; page: number }>(
      brand,
      p.id,
      'GET',
      R.surveyResponses(id),
      q,
    );
    await this.log(req, brand, 'surveys.responses.view', 'survey', id, {
      metadata: { status: q.status ?? null, page: r.page, total: r.total },
    });
    return r;
  }

  @RequirePermissions('surveys.manage')
  @Post(':id/reconcile')
  async reconcile(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(Reconcile)) body: Reconcile,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Record<string, number>>(
      brand,
      p.id,
      'POST',
      R.surveyReconcile(id),
      undefined,
      body,
    );
    await this.log(req, brand, 'surveys.reconcile', 'survey', id, {
      metadata: { ...r, approveIds: body.approve.slice(0, 50), rejectIds: body.reject.slice(0, 50) },
      reason: body.reason,
    });
    return r;
  }
}

/** Points (module 6), quality (module 9) and referral fraud (module 10). */
@Controller('panel')
@BrandScoped()
export class PointsQualityController {
  private readonly log;
  constructor(
    private readonly panel: PanelAdminService,
    private readonly database: Database,
    audit: AuditService,
  ) {
    this.log = logger(audit);
  }

  /** Teen records need teen.read, as on the member screens. */
  private async guardTeen(p: Principal, brand: PanelCode, id: string, req: Request) {
    const m = await this.panel.call<{ segment?: string }>(brand, p.id, 'GET', R.member(id));
    if (m.segment === 'teen' && !hasOn(p, brand, ['teen.read'])) {
      await this.log(req, brand, 'authz.denied', 'member', id, {
        outcome: 'denied',
        metadata: { missing: ['teen.read'] },
      });
      throw new ForbiddenException('Teen records need the teen.read permission');
    }
  }

  private async fourEyesAt(brand: PanelCode): Promise<number> {
    const row = await this.database.db.query.brandSettings.findFirst({
      where: eq(brandSettings.panel, brand),
    });
    return row?.fourEyesPoints ?? 50_000;
  }

  /** At or above the brand's four-eyes amount, the adjustment waits for a second admin. */
  @RequirePermissions('points.adjust')
  @Post('members/:id/points')
  async adjust(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(PointsAdjust)) body: PointsAdjust,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const limit = await this.fourEyesAt(brand);
    const needsApproval = Math.abs(body.points) >= limit;
    const r = await this.panel.call<{
      adjustment: { id: string; status: string };
      before: { available: number };
      after: { available: number };
    }>(brand, p.id, 'POST', R.memberPoints(id), undefined, { ...body, needsApproval });
    await this.log(req, brand, needsApproval ? 'points.adjust.requested' : 'points.adjust', 'member', id, {
      before: r.before,
      after: r.after,
      reason: body.note,
      metadata: {
        adjustment: r.adjustment.id,
        points: body.points,
        reasonCode: body.reasonCode,
        status: r.adjustment.status,
        fourEyesAt: limit,
      },
    });
    return { ...r, fourEyesAt: limit };
  }

  @RequirePermissions('points.read')
  @Get('points/approvals')
  approvals(
    @Query(new ZodPipe(ApprovalList)) q: ApprovalList,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.pointsApprovals, q);
  }

  @RequirePermissions('payouts.approve')
  @Post('points/approvals/:id')
  async decide(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(PointsDecision)) body: PointsDecision,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change & { points: number; member: string }>(
      brand,
      p.id,
      'POST',
      R.pointsApproval(id),
      undefined,
      body,
    );
    await this.log(req, brand, `points.adjust.${body.decision}`, 'points_adjustment', id, {
      before: r.before,
      after: r.after,
      reason: body.note ?? null,
      metadata: { member: r.member, points: r.points },
    });
    return r;
  }

  @RequirePermissions('points.read')
  @Get('points/holds')
  holds(
    @Query(new ZodPipe(z.object({ member: Id.optional() }))) q: { member?: string },
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.holds, q);
  }

  @RequirePermissions('points.adjust')
  @Post('points/holds')
  async hold(
    @Body(new ZodPipe(HoldCreate)) body: HoldCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ id: string; existing: boolean }>(
      brand,
      p.id,
      'POST',
      R.holds,
      undefined,
      body,
    );
    await this.log(req, brand, 'points.hold', 'member', body.member, {
      after: { status: 'on_hold' },
      reason: body.reason,
      metadata: { hold: r.id, existing: r.existing, source: body.source, entry: body.entry },
    });
    return r;
  }

  @RequirePermissions('points.adjust')
  @Post('points/holds/:id/release')
  async release(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(HoldRelease)) body: HoldRelease,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change & { member: string }>(brand, p.id, 'POST', R.holdRelease(id));
    await this.log(req, brand, 'points.hold.release', 'member', r.member, {
      before: r.before,
      after: r.after,
      reason: body.reason,
      metadata: { hold: id },
    });
    return r;
  }

  @RequirePermissions('members.read')
  @Get('quality/tiers')
  tiers(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.qualityTiers);
  }

  @RequirePermissions('members.read', 'quality.manage')
  @Get('quality/review')
  async review(
    @Query(new ZodPipe(QualityReview)) q: QualityReview,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ total: number; page: number }>(brand, p.id, 'GET', R.qualityReview, q);
    await this.log(req, brand, 'quality.review.view', 'member', undefined, {
      metadata: { below: q.below, category: q.category ?? null, total: r.total, page: r.page },
    });
    return r;
  }

  @RequirePermissions('members.read')
  @Get('members/:id/quality')
  async history(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    return this.panel.call(brand, p.id, 'GET', R.memberQuality(id));
  }

  @RequirePermissions('quality.manage')
  @Post('members/:id/quality')
  async changeScore(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(QualityChange)) body: QualityChange,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.memberQuality(id), undefined, body);
    await this.log(req, brand, 'quality.score.change', 'member', id, {
      before: r.before,
      after: r.after,
      reason: body.note,
      metadata: { rule: body.rule, delta: body.delta, survey: body.survey ?? null },
    });
    return r;
  }

  // ---- expert verification queue (Professionals) ------------------------------------------------------------------
  /** The queue shows LinkedIn links and job titles, so every read is audited. The work e-mail stays masked. */
  @RequirePermissions('members.read', 'quality.manage')
  @Get('experts')
  async experts(
    @Query(new ZodPipe(ExpertList)) q: ExpertList,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ total: number; page: number }>(brand, p.id, 'GET', R.experts, q);
    await this.log(req, brand, 'experts.queue.view', 'expert_verification', undefined, {
      metadata: { status: q.status, page: r.page, total: r.total },
    });
    return r;
  }

  @RequirePermissions('members.read', 'quality.manage')
  @Get('experts/:id')
  async expert(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ member?: { id?: string } }>(brand, p.id, 'GET', R.expert(id));
    await this.log(req, brand, 'expert.view', 'expert_verification', id, {
      metadata: { member: r.member?.id ?? null },
    });
    return r;
  }

  @RequirePermissions('quality.manage')
  @Post('experts/:id/decision')
  async decideExpert(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(ExpertDecision)) body: ExpertDecision,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{
      before: { status: string };
      after: { status: string };
      member: string;
    }>(brand, p.id, 'POST', R.expertDecision(id), undefined, {
      decision: body.decision,
      note: body.note,
      adminNote: body.reason,
    });
    await this.log(req, brand, `expert.${body.decision}`, 'expert_verification', id, {
      before: r.before,
      after: r.after,
      reason: body.reason,
      metadata: { member: r.member, noteToMember: body.note ?? null },
    });
    return r;
  }

  @RequirePermissions('members.read', 'quality.manage')
  @Get('referrals/fraud')
  async fraud(
    @Query(new ZodPipe(ReferralFraud)) q: ReferralFraud,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ referrers: unknown[]; sharedPayouts: unknown[] }>(
      brand,
      p.id,
      'GET',
      R.referralFraud,
      q,
    );
    await this.log(req, brand, 'referrals.fraud.view', 'member', undefined, {
      metadata: { referrers: r.referrers.length, sharedPayouts: r.sharedPayouts.length },
    });
    return r;
  }
}
