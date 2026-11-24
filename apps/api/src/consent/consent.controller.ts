import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { ConsentQuery, ContactPreferenceCreate } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ConsentService } from './consent.service.js';

@Controller('consent')
export class ConsentController {
  constructor(
    private readonly consent: ConsentService,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('consent.read')
  @Get('summary')
  summary(@Query(new ZodPipe(ConsentQuery)) q: ConsentQuery) {
    return this.consent.summary(this.audience.defaultMode(), q.panel);
  }

  @RequirePermissions('consent.read')
  @Get('events')
  events(@Query(new ZodPipe(ConsentQuery)) q: ConsentQuery) {
    return this.consent.events(this.audience.defaultMode(), q);
  }

  @RequirePermissions('consent.read')
  @Get('preferences')
  preferences(@Query(new ZodPipe(ConsentQuery)) q: ConsentQuery) {
    return this.consent.preferences(this.audience.defaultMode(), q);
  }

  @RequirePermissions('consent.read')
  @Get('persons/:personId')
  async person(@Param('personId', new ParseUUIDPipe()) personId: string, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const res = await this.consent.person(personId);
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'consent.person_viewed',
      targetType: 'master_person',
      targetId: personId,
      metadata: { records: res.current.length },
      ip: req.ip ?? null,
    });
    return res;
  }

  @RequirePermissions('consent.manage')
  @Post('persons/:personId/preferences')
  record(
    @Param('personId', new ParseUUIDPipe()) personId: string,
    @Body(new ZodPipe(ContactPreferenceCreate)) b: ContactPreferenceCreate,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.consent.recordPreference(this.audience.defaultMode(), personId, b, { id: p.id, ip: req.ip ?? null });
  }
}
