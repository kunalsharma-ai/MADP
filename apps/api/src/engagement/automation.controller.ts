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
  WinBackStart,
  WIN_BACK_STEPS,
  type WinBackPanel,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import { z } from 'zod';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { AutomationService } from './automation.service.js';
import { PanelDirectory } from '../panels/panel-directory.js';
import { PanelAdminService } from '../panel-admin/panel-admin.service.js';
import { alertPanels } from '../new-members/new-members.controller.js';

const PanelQuery = z.object({ panel: PanelCode.optional() });
const actor = (p: Principal, req: Request) => ({ id: p.id, ip: req.ip ?? null });
const DAY = 86_400_000;
/** Inactive counts come from a panel member search; one per panel and list serves everyone for a while. */
const COUNT_MS = 10 * 60_000;
type Bucket = '30' | '60' | '90';

/** Lifecycle automations (versioned, reviewed, dry runs) and the reviewed celebration calendar. */
@Controller('communications')
export class AutomationController {
  constructor(
    private readonly automations: AutomationService,
    private readonly audience: AudienceService,
    private readonly panels: PanelDirectory,
    private readonly panelAdmin: PanelAdminService,
  ) {}

  private readonly counts = new Map<string, { at: number; total: number }>();

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

  /**
   * The ready-made win-back journey (30, 60 and 90 days without activity) for every active panel, with how many
   * members are in each inactive list. The counts need members.read on that panel; they are totals only.
   */
  @RequirePermissions('communications.read')
  @Get('automations/win-back')
  async winBack(@CurrentPrincipal() p: Principal): Promise<WinBackPanel[]> {
    const codes = this.panels.codes();
    const canSee = new Set(alertPanels(p));
    const today = new Date(new Date().toISOString().slice(0, 10)).getTime();
    const since = Object.fromEntries(
      WIN_BACK_STEPS.map((s) => [String(s.atDays), new Date(today - s.atDays * DAY).toISOString().slice(0, 10)]),
    ) as Record<Bucket, string>;
    const rows = await this.automations.winBack(this.audience.defaultMode(), codes);
    return Promise.all(
      rows.map(async (r) => {
        let inactive: Record<Bucket, number> | null = null;
        if (canSee.has(r.panel as PanelCode))
          try {
            const totals = await Promise.all(
              (Object.keys(since) as Bucket[]).map((b) => this.inactiveCount(r.panel as PanelCode, p.id, since[b])),
            );
            inactive = { '30': totals[0]!, '60': totals[1]!, '90': totals[2]! };
          } catch {
            inactive = null; // the panel did not answer: the journey card still shows
          }
        return { ...r, inactive, since };
      }),
    );
  }

  private async inactiveCount(panel: PanelCode, actorId: string, since: string) {
    const key = `${panel}:${since}`;
    const hit = this.counts.get(key);
    if (hit && Date.now() - hit.at < COUNT_MS) return hit.total;
    const r = await this.panelAdmin.call<{ total: number }>(panel, actorId, 'GET', R.members, {
      inactiveSince: since,
      noTeens: 1,
    });
    this.counts.set(key, { at: Date.now(), total: r.total });
    return r.total;
  }

  /** One click: drafts the panel's three win-back mailers for an admin to edit and a second admin to approve. */
  @RequirePermissions('communications.manage')
  @Post('automations/win-back/drafts')
  draftWinBack(@Body(new ZodPipe(WinBackStart)) b: WinBackStart, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.automations.draftWinBack(this.audience.defaultMode(), b.panel, actor(p, req));
  }

  @RequirePermissions('communications.manage')
  @Post('automations/win-back')
  startWinBack(@Body(new ZodPipe(WinBackStart)) b: WinBackStart, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    return this.automations.startWinBack(this.audience.defaultMode(), b.panel, actor(p, req));
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
