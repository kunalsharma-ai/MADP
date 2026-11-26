import { Body, Controller, ForbiddenException, Get, HttpCode, Param, ParseUUIDPipe, Post, Query, Req } from '@nestjs/common';
import {
  EvidenceCreate,
  EvidenceDecision,
  EvidenceQuery,
  EvidenceRevoke,
  QualityDrillQuery,
  QualityQuery,
  type BrandSelection,
} from '@madp/contracts';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, RequirePermissions } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { AudienceService } from '../audience/audience.service.js';
import { VerificationService } from './verification.service.js';
import { PanelDirectory } from '../panels/panel-directory.js';

/**
 * Verification and data quality center (screen 8). Works in the brand picked in the brand switcher, or every brand
 * side by side (which needs the permission on every brand).
 */
@Controller('verification')
export class VerificationController {
  constructor(
    private readonly panelDirectory: PanelDirectory,
    private readonly verification: VerificationService,
    private readonly audience: AudienceService,
  ) {}

  @RequirePermissions('verification.read')
  @BrandScoped({ allowAll: true })
  @Get('summary')
  summary(@Query(new ZodPipe(QualityQuery)) q: QualityQuery, @CurrentBrand() brand: BrandSelection) {
    return this.verification.summary(this.audience.defaultMode(), this.panelDirectory.forBrand(brand, q.panel));
  }

  /** The members failing one check: person ids and masked panel ids, so it also needs panellists.read. */
  @RequirePermissions('verification.read', 'panellists.read')
  @BrandScoped({ allowAll: true })
  @Get('checks')
  drill(@Query(new ZodPipe(QualityDrillQuery)) q: QualityDrillQuery, @CurrentBrand() brand: BrandSelection) {
    this.panelDirectory.forBrand(brand, q.panel);
    return this.verification.drill(this.audience.defaultMode(), q.panel, q.check, q.limit);
  }

  @RequirePermissions('verification.read')
  @BrandScoped({ allowAll: true })
  @Get('evidence')
  list(@Query(new ZodPipe(EvidenceQuery)) q: EvidenceQuery, @CurrentBrand() brand: BrandSelection) {
    return this.verification.list(this.audience.defaultMode(), this.panelDirectory.forBrand(brand, q.panel), q);
  }

  @RequirePermissions('verification.review')
  @BrandScoped({ allowAll: true })
  @Post('evidence')
  create(@Body(new ZodPipe(EvidenceCreate)) b: EvidenceCreate, @CurrentBrand() brand: BrandSelection, @Req() req: Request) {
    this.panelDirectory.forBrand(brand, b.panel);
    return this.verification.create(this.audience.defaultMode(), b, actor(req));
  }

  @RequirePermissions('verification.review')
  @BrandScoped({ allowAll: true })
  @Post('evidence/:id/decision')
  @HttpCode(200)
  decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(EvidenceDecision)) b: EvidenceDecision,
    @CurrentBrand() brand: BrandSelection,
    @Req() req: Request,
  ) {
    return this.verification.decide(id, this.panelDirectory.forBrand(brand), b, actor(req));
  }

  @RequirePermissions('verification.review')
  @BrandScoped({ allowAll: true })
  @Post('evidence/:id/revoke')
  @HttpCode(200)
  revoke(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(EvidenceRevoke)) b: EvidenceRevoke,
    @CurrentBrand() brand: BrandSelection,
    @Req() req: Request,
  ) {
    return this.verification.revoke(id, this.panelDirectory.forBrand(brand), b.note, actor(req));
  }
}

function actor(req: Request) {
  const a = AuditService.fromRequest(req);
  if (!a.actorId) throw new ForbiddenException();
  return { ...a, actorId: a.actorId };
}
