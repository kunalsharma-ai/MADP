import { Controller, Get, Param, ParseUUIDPipe, Query, Req } from '@nestjs/common';
import { ParticipationQuery } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ParticipationService } from './participation.service.js';

const health = (p: Principal) => p.permissions.includes('health.sensitive.read');

/** Who took which survey on each panel, read from MADP's mirror of the panels' responses feeds. Read-only. */
@Controller('participation')
export class ParticipationController {
  constructor(
    private readonly participation: ParticipationService,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('loyalty.read')
  @Get()
  async list(@Query(new ZodPipe(ParticipationQuery)) q: ParticipationQuery, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const res = await this.participation.list(this.audience.defaultMode(), q, health(p));
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'participation.viewed',
      targetType: q.personId ? 'master_person' : 'panel',
      targetId: q.personId ?? q.panel ?? 'all',
      metadata: { panel: q.panel ?? null, status: q.status ?? null, page: q.page, rows: res.items.length },
      ip: req.ip ?? null,
    });
    return res;
  }

  @RequirePermissions('loyalty.read')
  @Get('summary')
  summary(@Query(new ZodPipe(ParticipationQuery)) q: ParticipationQuery, @CurrentPrincipal() p: Principal) {
    return this.participation.summary(this.audience.defaultMode(), q, health(p));
  }

  @RequirePermissions('loyalty.read')
  @Get('persons/:personId/engagement')
  async engagement(@Param('personId', new ParseUUIDPipe()) personId: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const panels = await this.participation.engagement(this.audience.defaultMode(), personId);
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'participation.engagement_viewed',
      targetType: 'master_person',
      targetId: personId,
      metadata: { panels: panels.length },
      ip: req.ip ?? null,
    });
    return { dataMode: this.audience.defaultMode(), panels };
  }
}
