import { Body, Controller, Get, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  BuilderQuery,
  DraftCreate,
  DraftReview,
  DraftUpdate,
  type BrandSelection,
  type PanelCode,
  type Permission,
} from '@madp/contracts';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelAdminService } from './panel-admin.service.js';
import { QuestionnaireService } from './questionnaire.service.js';

const Id = z.string().uuid();

/**
 * Questionnaire builder (spec screens 11 and 12) for the brand picked in the switcher. qb.edit drafts and submits;
 * qb.publish reviews (never one's own) and applies. Every step is audited; nothing reaches the panel before an
 * approved draft is applied.
 */
@Controller('questionnaires')
@BrandScoped()
export class QuestionnaireController {
  constructor(
    private readonly drafts: QuestionnaireService,
    private readonly audit: AuditService,
  ) {}

  private log(req: Request, brand: PanelCode, action: string, id: string, extra: Partial<Parameters<AuditService['record']>[0]> = {}) {
    return this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      panel: brand,
      targetType: 'questionnaire_draft',
      targetId: id,
      ...extra,
    });
  }

  private static need(p: Principal, brand: PanelCode, perm: Permission) {
    if (!(p.brandPermissions[brand] ?? []).includes(perm)) PanelAdminService.forbidden();
  }

  @RequirePermissions('qb.read')
  @Get('source')
  source(
    @Query(new ZodPipe(BuilderQuery)) q: z.infer<typeof BuilderQuery>,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.drafts.source(b as PanelCode, p.id, q.category, q.slug);
  }

  @RequirePermissions('qb.read')
  @Get('drafts')
  list(@CurrentBrand() b: BrandSelection) {
    return this.drafts.list(b as PanelCode);
  }

  @RequirePermissions('qb.read')
  @Get('drafts/:id')
  get(@Param('id', new ZodPipe(Id)) id: string, @CurrentBrand() b: BrandSelection) {
    return this.drafts.get(b as PanelCode, id);
  }

  @RequirePermissions('qb.edit')
  @Post('drafts')
  async create(
    @Body(new ZodPipe(DraftCreate)) body: DraftCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const d = await this.drafts.create(brand, p.id, body);
    await this.log(req, brand, 'questionnaire.draft.create', d.id, {
      after: { status: 'draft' },
      metadata: { category: body.category, slug: body.slug },
    });
    return d;
  }

  @RequirePermissions('qb.edit')
  @Put('drafts/:id')
  async update(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(DraftUpdate)) body: DraftUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.drafts.update(brand, id, p.id, body);
    await this.log(req, brand, 'questionnaire.draft.update', id, {
      metadata: { changes: r.view.changes, errors: r.view.errors },
    });
    return r.view;
  }

  @RequirePermissions('qb.edit')
  @Post('drafts/:id/submit')
  async submit(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.drafts.submit(brand, id, p.id);
    await this.log(req, brand, 'questionnaire.draft.submit', id, { before: r.before, after: r.after });
    return r.view;
  }

  @RequirePermissions('qb.edit')
  @Post('drafts/:id/review')
  async review(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(DraftReview)) body: DraftReview,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    QuestionnaireController.need(p, brand, 'qb.publish');
    const r = await this.drafts.review(brand, id, p.id, body);
    await this.log(req, brand, `questionnaire.draft.${body.decision}`, id, {
      before: r.before,
      after: r.after,
      metadata: { note: body.note ?? null },
    });
    return r.view;
  }

  @RequirePermissions('qb.edit')
  @Post('drafts/:id/discard')
  async discard(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.drafts.discard(brand, id);
    await this.log(req, brand, 'questionnaire.draft.discard', id, { before: r.before, after: r.after });
    return r.view;
  }

  @RequirePermissions('qb.edit')
  @Post('drafts/:id/apply')
  async apply(
    @Param('id', new ZodPipe(Id)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    QuestionnaireController.need(p, brand, 'qb.publish');
    const r = await this.drafts.apply(brand, id, p.id);
    await this.log(req, brand, 'questionnaire.draft.apply', id, {
      after: { status: r.ok ? 'applied' : 'approved' },
      outcome: r.ok ? 'success' : 'failure',
      metadata: r.applyResult,
    });
    return r;
  }
}
