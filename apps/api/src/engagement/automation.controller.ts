import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  AutomationCreate,
  AutomationDecision,
  AutomationReview,
  AutomationRunRequest,
  AutomationVersionCreate,
  CelebrationCreate,
  CelebrationReview,
  PanelCode,
  WelcomeJourneyStart,
} from '@madp/contracts';
import { z } from 'zod';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { AutomationService } from './automation.service.js';
import { PanelDirectory } from '../panels/panel-directory.js';

const PanelQuery = z.object({ panel: PanelCode.optional() });
const actor = (p: Principal, req: Request) => ({ id: p.id, ip: req.ip ?? null });

/** Lifecycle automations (versioned, reviewed, dry runs) and the reviewed celebration calendar. */
@Controller('communications')
export class AutomationController {
  constructor(
    private readonly automations: AutomationService,
    private readonly audience: AudienceService,
    private readonly panels: PanelDirectory,
  ) {}

  @RequirePermissions('communications.read')
  @Get('calendar')
  calendar(@Query(new ZodPipe(PanelQuery)) q: z.infer<typeof PanelQuery>) {
    return this.automations.listCelebrations(q.panel);
  }

  @RequirePermissions('communications.manage')
  @Post('calendar')
  addCelebration(@Body(new ZodPipe(CelebrationCreate)) b: CelebrationCreate, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.automations.createCelebration(b, actor(p, req));
  }

  @RequirePermissions('communications.approve')
  @Post('calendar/:id/review')
  @HttpCode(200)
  reviewCelebration(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(CelebrationReview)) b: CelebrationReview,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.automations.reviewCelebration(id, b.decision, b.note, actor(p, req));
  }

  @RequirePermissions('communications.read')
  @Get('automations')
  list(@Query(new ZodPipe(PanelQuery)) q: z.infer<typeof PanelQuery>) {
    return this.automations.list(this.audience.defaultMode(), q.panel);
  }

  @RequirePermissions('communications.manage')
  @Post('automations')
  create(@Body(new ZodPipe(AutomationCreate)) b: AutomationCreate, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.automations.create(this.audience.defaultMode(), b, actor(p, req));
  }

  /** The ready-made welcome journey (day 1, 3 and 7) for every active panel. */
  @RequirePermissions('communications.read')
  @Get('automations/welcome-journey')
  welcomeJourney() {
    return this.automations.welcomeJourney(this.audience.defaultMode(), this.panels.codes());
  }

  @RequirePermissions('communications.manage')
  @Post('automations/welcome-journey')
  startWelcomeJourney(@Body(new ZodPipe(WelcomeJourneyStart)) b: WelcomeJourneyStart, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.automations.startWelcomeJourney(this.audience.defaultMode(), b.panel, actor(p, req));
  }

  @RequirePermissions('communications.read')
  @Get('automations/:id')
  get(@Param('id', new ParseUUIDPipe()) id: string) {
    return this.automations.get(id);
  }

  @RequirePermissions('communications.manage')
  @Post('automations/:id/versions')
  addVersion(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AutomationVersionCreate)) b: AutomationVersionCreate,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.automations.addVersion(id, b, actor(p, req));
  }

  @RequirePermissions('communications.manage')
  @Post('automation-versions/:id/restore')
  restore(@Param('id', new ParseUUIDPipe()) id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.automations.restore(id, actor(p, req));
  }

  @RequirePermissions('communications.manage')
  @Post('automation-versions/:id/submit')
  @HttpCode(200)
  submit(@Param('id', new ParseUUIDPipe()) id: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.automations.submit(id, actor(p, req));
  }

  @RequirePermissions('communications.approve')
  @Post('automation-versions/:id/review')
  @HttpCode(200)
  review(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AutomationReview)) b: AutomationReview,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.automations.review(id, b.decision, b.note, actor(p, req));
  }

  @RequirePermissions('communications.approve')
  @Post('automations/:id/decision')
  @HttpCode(200)
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AutomationDecision)) b: AutomationDecision,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.automations.decide(id, b.decision, actor(p, req));
  }

  @RequirePermissions('communications.manage')
  @Post('automations/:id/run')
  @HttpCode(200)
  run(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AutomationRunRequest)) b: AutomationRunRequest,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.automations.run(id, b.dryRun, b.asOf ? new Date(b.asOf) : new Date(), actor(p, req));
  }
}
