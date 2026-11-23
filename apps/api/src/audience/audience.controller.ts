import { Body, Controller, Get, HttpCode, Post, Query } from '@nestjs/common';
import { CountsRequest, DataMode, AUDIENCE_CATEGORIES, AUDIENCE_CATEGORY_LABELS } from '@madp/contracts';
import { AudienceService } from './audience.service.js';
import { RequirePermissions } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';

@Controller('audience')
export class AudienceController {
  constructor(
    private readonly audience: AudienceService,
    private readonly database: Database,
  ) {}

  @RequirePermissions('audience.counts.read')
  @Post('counts')
  @HttpCode(200)
  counts(@Body(new ZodPipe(CountsRequest)) body: CountsRequest, @Query('mode', new ZodPipe(DataMode.optional())) mode?: DataMode) {
    return this.audience.counts(body, mode);
  }

  /** Canonical attribute catalogue (Supply360 sees only an authorised subset later; M6). */
  @RequirePermissions('questions.read')
  @Get('attributes')
  async attributes() {
    const rows = await this.database.db.query.attributeDefinitions.findMany({ orderBy: (a, { asc }) => [asc(a.key)] });
    return { categories: AUDIENCE_CATEGORIES.map((c) => ({ key: c, label: AUDIENCE_CATEGORY_LABELS[c] })), attributes: rows };
  }
}
