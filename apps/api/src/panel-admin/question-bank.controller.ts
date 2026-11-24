import { BadRequestException, Body, Controller, Get, Header, Param, Post, Put, Query, Req, Res } from '@nestjs/common';
import { z } from 'zod';
import {
  BankFile,
  MissingTranslations,
  OptionsSet,
  TranslationSet,
  VersionAction,
  VersionCreate,
  ProfileUpdate,
  QuestionCreate,
  QuestionUpdate,
  type BrandSelection,
  type PanelCode,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request, Response } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelAdminService } from './panel-admin.service.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { bankToXlsx, xlsxToBank } from './bank-workbook.js';

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
const VersionNumber = z.coerce.number().int().min(1).max(1_000_000);
const ImportQuery = z.object({ dryRun: z.enum(['0', '1']).default('1') });
/** An .xlsx file, base64 in JSON (the import route's large-body parser allows 25 MB). */
const WorkbookUpload = z.object({ file: z.string().max(25 * 1024 * 1024).regex(/^[A-Za-z0-9+/]+={0,2}$/, 'base64') });
const XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
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
    private readonly registry: ConnectorRegistry,
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

  // ---- versions: draft -> review -> published by a second admin (four eyes is enforced by the panel) ---------------
  @RequirePermissions('qb.read')
  @Get('qb/versions')
  versions(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.qbVersions);
  }

  @RequirePermissions('qb.read')
  @Get('qb/versions/:number')
  version(
    @Param('number', new ZodPipe(VersionNumber)) n: number,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.qbVersion(n));
  }

  @RequirePermissions('qb.edit')
  @Post('qb/versions')
  async createVersion(
    @Body(new ZodPipe(VersionCreate)) body: VersionCreate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ number: number; counts?: unknown; diff?: unknown }>(
      brand,
      p.id,
      'POST',
      R.qbVersions,
      undefined,
      body,
    );
    await this.log(req, brand, 'qb.version.create', 'qb_version', String(r.number), {
      after: { status: 'draft' },
      metadata: { counts: r.counts, diff: r.diff, note: body.note ?? null },
    });
    return r;
  }

  /** review needs qb.edit; publish and discard need qb.publish. The admin who drafted or reviewed can't publish. */
  @RequirePermissions('qb.edit')
  @Post('qb/versions/:number/:action')
  async moveVersion(
    @Param('number', new ZodPipe(VersionNumber)) n: number,
    @Param('action', new ZodPipe(VersionAction)) action: VersionAction,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    if (action !== 'review' && !(p.brandPermissions[brand] ?? []).includes('qb.publish'))
      PanelAdminService.forbidden();
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.qbVersionAction(n, action));
    await this.log(req, brand, `qb.version.${action}`, 'qb_version', String(n), {
      before: r.before,
      after: r.after,
    });
    return r;
  }

  @RequirePermissions('qb.edit')
  @Put('questions/:name/translations')
  async translate(
    @Param('name', new ZodPipe(QuestionName)) name: string,
    @Body(new ZodPipe(TranslationSet)) body: TranslationSet,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    // The panel takes options as { value: label }; it refuses teen guardrail words on questions teens can see (422).
    const { options, ...rest } = body;
    const r = await this.panel.call<Change & { optionsSet?: number }>(
      brand,
      p.id,
      'PUT',
      R.questionTranslations(name),
      undefined,
      { ...rest, ...(options ? { options: Object.fromEntries(options.map((o) => [o.value, o.label])) } : {}) },
    );
    await this.log(req, brand, 'qb.translation.set', 'question', name, {
      before: r.before,
      after: r.after,
      metadata: { lang: body.lang, options: options?.length ?? 0, optionsSet: r.optionsSet ?? 0 },
    });
    return r;
  }

  @RequirePermissions('qb.read')
  @Get('qb/translations/missing')
  missing(
    @Query(new ZodPipe(MissingTranslations)) q: MissingTranslations,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.missingTranslations, q);
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

  /** The same export as an Excel workbook (Profile, Question and Option sheets, plus About). Audited like the JSON. */
  @RequirePermissions('qb.read')
  @Get('qb/export/xlsx')
  async exportXlsx(@CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal, @Req() req: Request, @Res() res: Response) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ exportedAt?: string; counts?: unknown; Profile?: Record<string, unknown>[]; Question?: Record<string, unknown>[]; Option?: Record<string, unknown>[] }>(
      brand,
      p.id,
      'GET',
      R.qbExport,
    );
    const dataMode = this.registry.get(brand).dataMode;
    await this.log(req, brand, 'qb.export', 'question_bank', brand, { metadata: { counts: r.counts, format: 'xlsx', dataMode } });
    const name = `question-bank-${brand}${dataMode === 'demo' ? '-DEMO' : ''}-${new Date().toISOString().slice(0, 10)}.xlsx`;
    res.setHeader('content-type', XLSX);
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('cache-control', 'no-store');
    res.send(await bankToXlsx(r, { brand, dataMode }));
  }

  /** Dry run (qb.edit) shows adds, changes, duplicates and refusals; writing (dryRun=0) needs qb.publish. */
  @RequirePermissions('qb.edit')
  @Post('qb/import')
  import(
    @Query(new ZodPipe(ImportQuery)) q: z.infer<typeof ImportQuery>,
    @Body(new ZodPipe(BankFile)) body: BankFile,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.runImport(b as PanelCode, q.dryRun === '0', body, p, req, 'json');
  }

  /**
   * The same import from an Excel workbook (as exported above). The workbook is read in MADP and goes to the panel's
   * import as the same JSON, so the dry run, guardrails and qb.publish rule are the same. A file with problems
   * (formulas, broken JSON cells) is refused before anything reaches the panel.
   */
  @RequirePermissions('qb.edit')
  @Post('qb/import/xlsx')
  async importXlsx(
    @Query(new ZodPipe(ImportQuery)) q: z.infer<typeof ImportQuery>,
    @Body(new ZodPipe(WorkbookUpload)) body: z.infer<typeof WorkbookUpload>,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const { bank, problems } = await xlsxToBank(Buffer.from(body.file, 'base64'));
    if (problems.length) throw new BadRequestException({ message: 'The workbook needs fixing before import', problems: problems.slice(0, 50) });
    const parsed = BankFile.safeParse(bank);
    if (!parsed.success) throw new BadRequestException({ message: 'The workbook is not in the bank shape', problems: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`) });
    return this.runImport(b as PanelCode, q.dryRun === '0', parsed.data, p, req, 'xlsx');
  }

  private async runImport(brand: PanelCode, write: boolean, body: BankFile, p: Principal, req: Request, format: 'json' | 'xlsx') {
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
        format,
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
