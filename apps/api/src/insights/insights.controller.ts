import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import { InsightDecision, InsightQuery, PanelCode, type BrandSelection } from '@madp/contracts';
import { z } from 'zod';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, RequirePermissions } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { AudienceService } from '../audience/audience.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { InsightsService } from './insights.service.js';

const RefreshQuery = z.object({ panel: PanelCode.optional() });

/** AI insights and reviewable recommendations (screen 34). Rule-based; a person decides each one. */
@Controller('insights')
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly audience: AudienceService,
  ) {}

  @RequirePermissions('insights.read')
  @BrandScoped({ allowAll: true })
  @Get()
  list(@Query(new ZodPipe(InsightQuery)) q: InsightQuery, @CurrentBrand() brand: BrandSelection) {
    return this.insights.list(this.audience.defaultMode(), VerificationService.panelsFor(brand, q.panel), q);
  }

  @RequirePermissions('insights.review')
  @BrandScoped({ allowAll: true })
  @Post('refresh')
  @HttpCode(200)
  refresh(@Query(new ZodPipe(RefreshQuery)) q: z.infer<typeof RefreshQuery>, @CurrentBrand() brand: BrandSelection, @Req() req: Request) {
    return this.insights.refresh(this.audience.defaultMode(), VerificationService.panelsFor(brand, q.panel), AuditService.fromRequest(req));
  }

  @RequirePermissions('insights.review')
  @BrandScoped({ allowAll: true })
  @Post(':id/decision')
  @HttpCode(200)
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(InsightDecision)) b: InsightDecision,
    @CurrentBrand() brand: BrandSelection,
    @Req() req: Request,
  ) {
    return this.insights.decide(id, VerificationService.panelsFor(brand), b, AuditService.fromRequest(req));
  }
}
