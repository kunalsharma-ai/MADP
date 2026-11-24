import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query, Req } from '@nestjs/common';
import {
  CampaignCreate,
  CampaignDecision,
  CampaignRunRequest,
  FatiguePolicyUpdate,
  PanelCode,
  TemplateCreate,
  TemplateReview,
  TemplateVersionCreate,
  TimelineQuery,
} from '@madp/contracts';
import { z } from 'zod';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { AuditService } from '../audit/audit.service.js';
import { EngagementService } from './engagement.service.js';

const PanelQuery = z.object({ panel: PanelCode.optional() });
const actor = (p: Principal, req: Request) => ({ id: p.id, ip: req.ip ?? null });

/** Engagement studio: templates with review, campaigns with approval, dry runs, contact rules and timelines. */
@Controller()
export class EngagementController {
  constructor(
    private readonly engagement: EngagementService,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('communications.read')
  @Get('communications/templates')
  templates(@Query(new ZodPipe(PanelQuery)) q: z.infer<typeof PanelQuery>) {
    return this.engagement.listTemplates(q.panel);
  }

  @RequirePermissions('communications.manage')
  @Post('communications/templates')
  createTemplate(@Body(new ZodPipe(TemplateCreate)) b: TemplateCreate, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.engagement.createTemplate(b, actor(p, req));
  }

  @RequirePermissions('communications.manage')
  @Post('communications/templates/:id/versions')
  addVersion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TemplateVersionCreate)) b: TemplateVersionCreate,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.engagement.addVersion(id, b, actor(p, req));
  }

  @RequirePermissions('communications.manage')
  @Post('communications/template-versions/:id/submit')
  @HttpCode(200)
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.engagement.submitVersion(id, actor(p, req));
  }

  @RequirePermissions('communications.approve')
  @Post('communications/template-versions/:id/review')
  @HttpCode(200)
  review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(TemplateReview)) b: TemplateReview,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.engagement.reviewVersion(id, b.decision, b.note, actor(p, req));
  }

  @RequirePermissions('communications.read')
  @Get('communications/template-versions/:id/preview')
  preview(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.engagement.preview(id);
  }

  @RequirePermissions('communications.read')
  @Get('communications/policies/:panel')
  policy(@Param('panel', new ZodPipe(PanelCode)) panel: PanelCode) {
    return this.engagement.policy(panel);
  }

  @RequirePermissions('communications.approve')
  @Put('communications/policies/:panel')
  setPolicy(
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(FatiguePolicyUpdate)) b: FatiguePolicyUpdate,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.engagement.setPolicy(panel, b, actor(p, req));
  }

  @RequirePermissions('communications.read')
  @Get('communications/campaigns')
  campaigns(@Query(new ZodPipe(PanelQuery)) q: z.infer<typeof PanelQuery>) {
    return this.engagement.listCampaigns(this.audience.defaultMode(), q.panel);
  }

  @RequirePermissions('communications.manage')
  @Post('communications/campaigns')
  createCampaign(@Body(new ZodPipe(CampaignCreate)) b: CampaignCreate, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.engagement.createCampaign(this.audience.defaultMode(), b, actor(p, req));
  }

  @RequirePermissions('communications.approve')
  @Post('communications/campaigns/:id/decision')
  @HttpCode(200)
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CampaignDecision)) b: CampaignDecision,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.engagement.decideCampaign(id, b.decision, actor(p, req));
  }

  @RequirePermissions('communications.manage')
  @Post('communications/campaigns/:id/run')
  @HttpCode(200)
  run(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CampaignRunRequest)) b: CampaignRunRequest,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.engagement.run(id, b.dryRun, actor(p, req));
  }

  @RequirePermissions('communications.read')
  @Get('communications/timeline/:personId')
  async timeline(
    @Param('personId', new ParseUUIDPipe()) personId: string,
    @Query(new ZodPipe(TimelineQuery)) q: TimelineQuery,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const res = await this.engagement.timeline(personId, q);
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'communications.timeline_viewed',
      targetType: 'master_person',
      targetId: personId,
      metadata: { rows: res.items.length, panel: q.panel ?? null },
      ip: req.ip ?? null,
    });
    return res;
  }
}
