import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { LoyaltyPanelQuery, PanelCode, ReconcileRequest, SurveyApproval } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { AuditService } from '../audit/audit.service.js';
import { LoyaltyService } from './loyalty.service.js';

const actor = (p: Principal, req: Request) => ({ id: p.id, ip: req.ip ?? null });

/** Read-only wallet mirrors per panel: liability, a person's wallets, survey approvals, reconciliation. */
@Controller('loyalty')
export class LoyaltyController {
  constructor(
    private readonly loyalty: LoyaltyService,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('loyalty.read')
  @Get('liability')
  liability(@Query(new ZodPipe(LoyaltyPanelQuery)) q: LoyaltyPanelQuery) {
    return this.loyalty.liability(this.audience.defaultMode(), q.panel);
  }

  @RequirePermissions('loyalty.read')
  @Get('persons/:personId')
  async person(@Param('personId', new ParseUUIDPipe()) personId: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const res = await this.loyalty.person(personId);
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'loyalty.wallet_viewed',
      targetType: 'master_person',
      targetId: personId,
      metadata: { accounts: res.accounts.length },
      ip: req.ip ?? null,
    });
    return res;
  }

  @RequirePermissions('loyalty.approve')
  @Post(':panel/survey-approvals')
  approve(
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(SurveyApproval)) b: SurveyApproval,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.loyalty.approveSurvey(this.audience.defaultMode(), panel, b.surveySlug, b.note, actor(p, req));
  }

  @RequirePermissions('loyalty.reconcile')
  @Post(':panel/sync')
  @HttpCode(200)
  async sync(@Param('panel', new ZodPipe(PanelCode)) panel: PanelCode, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const res = await this.loyalty.sync(panel, null);
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'loyalty.synced',
      targetType: 'panel',
      targetId: panel,
      metadata: { ...res },
      ip: req.ip ?? null,
    });
    return res;
  }

  @RequirePermissions('loyalty.reconcile')
  @Post(':panel/reconcile')
  @HttpCode(200)
  reconcile(
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(ReconcileRequest)) b: ReconcileRequest,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.loyalty.reconcile(panel, b.repair, actor(p, req));
  }

  @RequirePermissions('loyalty.read')
  @Get('reconciliations')
  reconciliations(@Query(new ZodPipe(LoyaltyPanelQuery)) q: LoyaltyPanelQuery) {
    return this.loyalty.reconciliations(this.audience.defaultMode(), q.panel);
  }
}
