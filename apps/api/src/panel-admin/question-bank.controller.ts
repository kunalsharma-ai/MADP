import { Body, Controller, Get, Header, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  BankFile,
  OptionsSet,
  ProfileUpdate,
  QuestionCreate,
  QuestionUpdate,
  type BrandSelection,
  type PanelCode,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelAdminService } from './panel-admin.service.js';

const QuestionName = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{0,79}$/, 'a question key');
const ProfileId = z.string().regex(/^[a-f0-9]{24}$/i, 'a profile id');
const ListQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
const ImportQuery = z.object({ dryRun: z.enum(['0', '1']).default('1') });
type Change = { before: Record<string, unknown> | null; after: Record<string, unknown> };

/**
 * Question bank and profiles (super admin spec modules 3 and 4) for the brand picked in the switcher. Every write is
 * audited with old and new values. Imports are dry runs unless dryRun=0 (qb.publish); teen guardrails are enforced by
 * the panel backend and its refusal comes back as 422.
 */
@Controller('panel')
@BrandScoped()
export class QuestionBankController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly audit: AuditService,
  ) {}

  private log(
    req: Request,
    brand: PanelCode,
    action: string,
    targetType: string,
    targetId: string | undefined,
    extra: Partial<Parameters<AuditService['record']>[0]> = {},
  ) {
    return this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      panel: brand,
      targetType,
      targetId,
      ...extra,
    });
  }

  @RequirePermissions('qb.read')
  @Get('questions')
  questions(
    @Query(new ZodPipe(ListQuery)) q: z.infer<typeof ListQuery>,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.questions, q);
  }

  @RequirePermissions('qb.read')
  @Get('questions/:name')
  question(
    @Param('name', new ZodPipe(QuestionName)) name: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.question(name));
  }

  @RequirePermissions('qb.edit')
  @Post('questions')
  async createQuestion(
    @Body(new ZodPipe(QuestionCreate)) body: QuestionCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...q } = body;
    const r = await this.panel.call<Change & { id: string }>(brand, p.id, 'POST', R.questions, undefined, q);
    await this.log(req, brand, 'qb.question.create', 'question', q.name, {
      after: r.after,
      reason: reason ?? null,
    });
    return r;
  }

  @RequirePermissions('qb.edit')
  @Put('questions/:name')
  async updateQuestion(
    @Param('name', new ZodPipe(QuestionName)) name: string,
    @Body(new ZodPipe(QuestionUpdate)) body: QuestionUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...patch } = body;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.question(name), undefined, patch);
    await this.log(req, brand, 'qb.question.update', 'question', name, {
      before: r.before,
      after: r.after,
      reason: reason ?? null,
    });
    return r;
  }

  @RequirePermissions('qb.edit')
  @Put('questions/:name/options')
  async setOptions(
    @Param('name', new ZodPipe(QuestionName)) name: string,
    @Body(new ZodPipe(OptionsSet)) body: OptionsSet,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change & { added: number; retired: number }>(
      brand,
      p.id,
      'PUT',
      R.questionOptions(name),
      undefined,
      { options: body.options },
    );
    await this.log(req, brand, 'qb.options.set', 'question', name, {
      before: r.before,
      after: r.after,
      reason: body.reason ?? null,
      metadata: { added: r.added, retired: r.retired },
    });
    return r;
  }

  @RequirePermissions('qb.read')
  @Get('qb/rules/check')
  rules(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.qbRulesCheck);
  }

  /** The whole bank as JSON, in today's Profile / Question / Option export shape. */
  @RequirePermissions('qb.read')
  @Get('qb/export')
  @Header('cache-control', 'no-store')
  async export(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ counts: unknown }>(brand, p.id, 'GET', R.qbExport);
    await this.log(req, brand, 'qb.export', 'question_bank', brand, { metadata: { counts: r.counts } });
    return r;
  }

  /** Dry run (qb.edit) shows adds, changes, duplicates and refusals; writing (dryRun=0) needs qb.publish. */
  @RequirePermissions('qb.edit')
  @Post('qb/import')
  async import(
    @Query(new ZodPipe(ImportQuery)) q: z.infer<typeof ImportQuery>,
    @Body(new ZodPipe(BankFile)) body: BankFile,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const write = q.dryRun === '0';
    if (write && !(p.brandPermissions[brand] ?? []).includes('qb.publish')) PanelAdminService.forbidden();
    const r = await this.panel.call<Record<string, unknown>>(
      brand,
      p.id,
      'POST',
      R.qbImport,
      { dryRun: write ? 0 : 1 },
      body,
    );
    await this.log(req, brand, write ? 'qb.import' : 'qb.import.dry_run', 'question_bank', brand, {
      metadata: {
        counts: r.counts,
        questions: r.questions,
        options: r.options,
        profiles: r.profiles,
        ok: r.ok,
      },
    });
    return r;
  }

  @RequirePermissions('qb.read')
  @Get('profiles')
  profiles(
    @Query(new ZodPipe(z.object({ category: z.string().trim().max(40).optional() })))
    q: { category?: string },
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.profiles, q);
  }

  @RequirePermissions('qb.read')
  @Get('profiles/completion')
  completion(
    @Query(new ZodPipe(z.object({ category: z.string().trim().max(40).optional() })))
    q: { category?: string },
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.profileCompletion, q);
  }

  @RequirePermissions('profiles.manage')
  @Put('profiles/:id')
  async updateProfile(
    @Param('id', new ZodPipe(ProfileId)) id: string,
    @Body(new ZodPipe(ProfileUpdate)) body: ProfileUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const { reason, ...patch } = body;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.profile(id), undefined, patch);
    await this.log(req, brand, 'qb.profile.update', 'profile', id, {
      before: r.before,
      after: r.after,
      reason: reason ?? null,
    });
    return r;
  }
}
