import { Body, Controller, Get, HttpCode, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  ContentAction,
  ContentCreate,
  ContentListQuery,
  ContentUpdate,
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

const Id = z.string().regex(/^[a-f0-9]{24}$/i, 'a page id');
const Version = z.coerce.number().int().min(1).max(1_000_000);
type Change = { before: Record<string, unknown> | null; after: Record<string, unknown> };
type Moved = Change & { key: string; lang: string };

/**
 * Site and legal pages of the brand picked in the switcher (privacy, terms, GDPR, cookies and other pages). The panel
 * keeps the pages: MADP edits a draft, asks for review and publishes through the signed admin API, with the admin's
 * own id as the actor. Legal pages need four eyes, enforced by the panel: a second admin, who neither asked for review
 * nor made the last edit, publishes. Bodies are blocks, never HTML. Every write is audited with old and new values.
 */
@Controller('panel/content')
@BrandScoped()
export class ContentAdminController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly audit: AuditService,
  ) {}

  private log(req: Request, brand: PanelCode, action: string, id: string, extra: Partial<Parameters<AuditService['record']>[0]>) {
    return this.audit.record({ ...AuditService.fromRequest(req), action, panel: brand, targetType: 'content_page', targetId: id, ...extra });
  }

  @RequirePermissions('content.manage')
  @Get()
  list(@Query(new ZodPipe(ContentListQuery)) q: ContentListQuery, @CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.content, q);
  }

  @RequirePermissions('content.manage')
  @Post()
  async create(@Body(new ZodPipe(ContentCreate)) body: ContentCreate, @CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal, @Req() req: Request) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change & { id: string }>(brand, p.id, 'POST', R.content, undefined, body);
    await this.log(req, brand, 'content.page.create', r.id, {
      after: { key: body.key, lang: body.lang ?? 'en', kind: (r.after as { kind?: string }).kind ?? body.kind ?? 'page', title: body.title },
    });
    return r;
  }

  @RequirePermissions('content.manage')
  @Get(':id')
  get(@Param('id', new ZodPipe(Id)) id: string, @CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.contentPage(id));
  }

  @RequirePermissions('content.manage')
  @Put(':id')
  async update(
    @Param('id', new ZodPipe(Id)) id: string,
    @Body(new ZodPipe(ContentUpdate)) body: ContentUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.contentPage(id), undefined, body);
    await this.log(req, brand, 'content.page.update', id, { before: r.before, after: r.after });
    return r;
  }

  /** review: editing to review. publish: the draft goes live as the next version. discard: drop the draft. */
  @RequirePermissions('content.manage')
  @Post(':id/:action')
  @HttpCode(200)
  async move(
    @Param('id', new ZodPipe(Id)) id: string,
    @Param('action', new ZodPipe(ContentAction)) action: ContentAction,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Moved>(brand, p.id, 'POST', R.contentAction(id, action));
    await this.log(req, brand, `content.page.${action}`, id, {
      before: r.before,
      after: r.after,
      metadata: { key: r.key, lang: r.lang },
    });
    return r;
  }

  @RequirePermissions('content.manage')
  @Get(':id/revisions')
  revisions(@Param('id', new ZodPipe(Id)) id: string, @CurrentBrand() b: BrandSelection, @CurrentPrincipal() p: Principal) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.contentRevisions(id));
  }

  @RequirePermissions('content.manage')
  @Get(':id/revisions/:version')
  revision(
    @Param('id', new ZodPipe(Id)) id: string,
    @Param('version', new ZodPipe(Version)) version: number,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.panel.call(b as PanelCode, p.id, 'GET', R.contentRevision(id, version));
  }

  /** Copies an old published version into the draft; rolling back is then an ordinary review and publish. */
  @RequirePermissions('content.manage')
  @Post(':id/revisions/:version/restore')
  @HttpCode(200)
  async restore(
    @Param('id', new ZodPipe(Id)) id: string,
    @Param('version', new ZodPipe(Version)) version: number,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.contentRestore(id, version));
    await this.log(req, brand, 'content.page.restore', id, { before: r.before, after: r.after, metadata: { version } });
    return r;
  }
}
