import { Controller, Get, Query } from '@nestjs/common';
import { FreshnessQuery } from '@madp/contracts';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AudienceService } from '../audience/audience.service.js';
import { FreshnessService } from './freshness.service.js';

@Controller('profiles')
export class FreshnessController {
  constructor(
    private readonly freshness: FreshnessService,
    private readonly audience: AudienceService,
  ) {}

  /** Counts only. Special-category (health) questions and attributes are listed only with health.sensitive.read. */
  @RequirePermissions('audience.counts.read')
  @Get('freshness')
  report(@Query(new ZodPipe(FreshnessQuery)) q: FreshnessQuery, @CurrentPrincipal() p: Principal) {
    return this.freshness.report(this.audience.defaultMode(), {
      panel: q.panel,
      staleDays: q.staleDays,
      healthAllowed: p.permissions.includes('health.sensitive.read'),
    });
  }
}
