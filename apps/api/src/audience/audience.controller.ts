import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CountsRequest, DataMode, AUDIENCE_CATEGORIES, AUDIENCE_CATEGORY_LABELS } from '@madp/contracts';
import { AudienceService } from './audience.service.js';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { AuditService } from '../audit/audit.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';

@Controller('audience')
export class AudienceController {
  constructor(
    private readonly audience: AudienceService,
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('audience.counts.read')
  @Post('counts')
  @HttpCode(200)
  async counts(
    @Body(new ZodPipe(CountsRequest)) body: CountsRequest,
    @CurrentPrincipal() p: Principal,
    @Query('mode', new ZodPipe(DataMode.optional())) mode?: DataMode,
  ) {
    const result = await this.audience.counts(body, mode, undefined, p);
    // Purpose-limited access: every count that used a special-category attribute is audited.
    const sensitive = result.attributeFilters?.filter((a) => a.sensitivity === 'special_category') ?? [];
    if (sensitive.length) {
      await this.audit.record({
        actorId: p.id,
        actorType: 'admin',
        action: 'audience.sensitive_filter_used',
        targetType: 'attribute',
        targetId: sensitive.map((a) => a.key).join(','),
        metadata: { dataMode: result.dataMode, uniquePeople: result.uniquePeople, purpose: body.purpose ?? null },
      });
    }
    return result;
  }

  /** Canonical attribute catalogue (Supply360 sees only an authorised subset later; M6). */
  @RequirePermissions('questions.read')
  @Get('attributes')
  async attributes() {
    const rows = await this.database.db.query.attributeDefinitions.findMany({
      orderBy: (a, { asc }) => [asc(a.key)],
    });
    return {
      categories: AUDIENCE_CATEGORIES.map((c) => ({ key: c, label: AUDIENCE_CATEGORY_LABELS[c] })),
      attributes: rows,
    };
  }
}
