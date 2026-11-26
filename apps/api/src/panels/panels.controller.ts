import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { eq, sql } from 'drizzle-orm';
import { PanelCode, PanelCreate, PanelReason, PanelUpdate, type PanelInfo } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { brandSettings, panelConnections, panels } from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { PanelDirectory } from './panel-directory.js';

/** Super Admin on every brand: the only role that may add, archive, restore or delete a panel. */
function isSuperAdminEverywhere(p: Principal) {
  return p.grants.some((g) => g.role === 'super_admin' && g.brands === null);
}

/** Tables whose rows count as "this panel holds data" (members, answers, consent, messages, rewards, audit). */
const DATA_TABLES = [
  'panel_membership',
  'source_identity',
  'consent_record',
  'communication_event',
  'reward_ledger',
  'import_job',
] as const;

/**
 * Panels screen: T2O, MFR and MHO are built in (mandatory; they can't be archived or deleted, and MHO stays
 * sensitive). A Super Admin adds other panels that run on the shared panel backend, edits them, archives one (its
 * sync stops and its screens are hidden; nothing is deleted), restores it, or deletes it while it holds no data.
 */
@Controller('panels')
export class PanelsController {
  constructor(
    private readonly database: Database,
    private readonly directory: PanelDirectory,
    private readonly registry: ConnectorRegistry,
    private readonly audit: AuditService,
  ) {}

  /** Every signed-in admin sees the active panels (the brand switcher needs them); archived ones need connectors.read. */
  @Get()
  async list(@CurrentPrincipal() p: Principal): Promise<{ panels: (PanelInfo & { hasData: boolean })[] }> {
    await this.directory.reload();
    const all = this.directory.all();
    const seeArchived = p.permissions.includes('connectors.read');
    const shown = all.filter((x) => x.status === 'active' || seeArchived);
    return {
      panels: await Promise.all(shown.map(async (x) => ({ ...x, hasData: await this.hasData(x.code) }))),
    };
  }

  @RequirePermissions('connectors.read')
  @Post()
  async create(
    @CurrentPrincipal() p: Principal,
    @Body(new ZodPipe(PanelCreate)) body: PanelCreate,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, body.code);
    if (this.directory.get(body.code)) throw new ConflictException('A panel with that code already exists');
    const taken = await this.database.db.execute<{ panel: string }>(
      sql`select panel from brand_setting where origins && ${`{${body.origins.join(',')}}`}::text[]`,
    );
    if (taken.rows.length)
      throw new ConflictException(
        `Those hostnames already belong to ${taken.rows.map((r) => r.panel).join(', ')}`,
      );
    const maxSort = Math.max(0, ...this.directory.all().map((x) => x.sort));
    await this.database.db.transaction(async (tx) => {
      await tx.insert(panels).values({
        code: body.code,
        name: body.name,
        shortName: body.shortName,
        siteUrl: body.siteUrl ?? null,
        description: body.description ?? '',
        sensitive: body.sensitive,
        builtIn: false,
        status: 'active',
        sort: maxSort + 1,
        createdBy: p.id,
      });
      await tx.insert(brandSettings).values({
        panel: body.code,
        displayName: body.name,
        origins: body.origins,
        updatedBy: p.id,
      });
    });
    await this.refresh();
    await this.record(req, body.code, 'panels.create', body.reason, {
      after: { name: body.name, shortName: body.shortName, sensitive: body.sensitive, origins: body.origins },
    });
    return this.directory.get(body.code);
  }

  @RequirePermissions('connectors.read')
  @Put(':code')
  async update(
    @CurrentPrincipal() p: Principal,
    @Param('code', new ZodPipe(PanelCode)) code: string,
    @Body(new ZodPipe(PanelUpdate)) body: PanelUpdate,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, code);
    const cur = this.mustGet(code);
    const { reason, ...patch } = body;
    if (patch.sensitive === false && cur.sensitive) {
      if (code === 'mho') throw new BadRequestException('MHO holds health data and stays sensitive');
      if (await this.hasData(code))
        throw new ConflictException('This panel already holds data, so it stays sensitive');
    }
    const set = Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined));
    if (!Object.keys(set).length) return cur;
    await this.database.db
      .update(panels)
      .set({ ...set, updatedAt: new Date() })
      .where(eq(panels.code, code));
    if (patch.name)
      await this.database.db
        .update(brandSettings)
        .set({ displayName: patch.name })
        .where(eq(brandSettings.panel, code));
    await this.refresh();
    const before = Object.fromEntries(
      Object.keys(set).map((k) => [k, (cur as unknown as Record<string, unknown>)[k]]),
    );
    await this.record(req, code, 'panels.update', reason, { before, after: set });
    return this.directory.get(code);
  }

  /** Stops the panel's sync and hides its screens. Nothing is deleted; restore brings it back as it was. */
  @RequirePermissions('connectors.read')
  @Post(':code/archive')
  @HttpCode(200)
  async archive(
    @CurrentPrincipal() p: Principal,
    @Param('code', new ZodPipe(PanelCode)) code: string,
    @Body(new ZodPipe(PanelReason)) body: PanelReason,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, code);
    const cur = this.mustGet(code);
    if (cur.builtIn) throw new BadRequestException(`${cur.shortName} is built in and can't be archived`);
    if (cur.status === 'archived') return cur;
    await this.database.db
      .update(panels)
      .set({ status: 'archived', archivedAt: new Date(), archivedBy: p.id, updatedAt: new Date() })
      .where(eq(panels.code, code));
    await this.refresh();
    await this.record(req, code, 'panels.archive', body.reason, {
      before: { status: 'active' },
      after: { status: 'archived' },
    });
    return this.directory.get(code);
  }

  @RequirePermissions('connectors.read')
  @Post(':code/restore')
  @HttpCode(200)
  async restore(
    @CurrentPrincipal() p: Principal,
    @Param('code', new ZodPipe(PanelCode)) code: string,
    @Body(new ZodPipe(PanelReason)) body: PanelReason,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, code);
    const cur = this.mustGet(code);
    if (cur.status === 'active') return cur;
    await this.database.db
      .update(panels)
      .set({ status: 'active', archivedAt: null, archivedBy: null, updatedAt: new Date() })
      .where(eq(panels.code, code));
    await this.refresh();
    await this.record(req, code, 'panels.restore', body.reason, {
      before: { status: 'archived' },
      after: { status: 'active' },
    });
    return this.directory.get(code);
  }

  /** Deletes a panel that holds no data. A panel with members, answers or history is archived instead. */
  @RequirePermissions('connectors.read')
  @Delete(':code')
  async remove(
    @CurrentPrincipal() p: Principal,
    @Param('code', new ZodPipe(PanelCode)) code: string,
    @Body(new ZodPipe(PanelReason)) body: PanelReason,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, code);
    const cur = this.mustGet(code);
    if (cur.builtIn) throw new BadRequestException(`${cur.shortName} is built in and can't be deleted`);
    if (await this.hasData(code))
      throw new ConflictException('This panel holds data. Archive it instead, so nothing is lost.');
    // Record first: once the panel row is gone, an audit entry can no longer name it.
    await this.record(req, code, 'panels.delete', body.reason, {
      before: { name: cur.name, status: cur.status },
    });
    try {
      await this.database.db.transaction(async (tx) => {
        await tx.execute(
          sql`update admin_role_grant set brands = array_remove(brands, ${code}) where ${code} = any(brands)`,
        );
        await tx.delete(panelConnections).where(eq(panelConnections.panel, code));
        await tx.delete(brandSettings).where(eq(brandSettings.panel, code));
        await tx.delete(panels).where(eq(panels.code, code));
      });
    } catch (e) {
      // A row somewhere else (the audit trail included) still points at this panel.
      if (
        (e as { code?: string; cause?: { code?: string } }).cause?.code === '23503' ||
        (e as { code?: string }).code === '23503'
      )
        throw new ConflictException(
          'Other records still refer to this panel (for example its audit history). Archive it instead.',
        );
      throw e;
    }
    await this.refresh();
    return { deleted: code };
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  private mustGet(code: string): PanelInfo {
    const cur = this.directory.get(code);
    if (!cur) throw new NotFoundException('No such panel');
    return cur;
  }

  private async hasData(code: string): Promise<boolean> {
    for (const t of DATA_TABLES) {
      const r = await this.database.db.execute<{ x: number }>(
        sql`select 1 as x from ${sql.identifier(t)} where panel = ${code} limit 1`,
      );
      if (r.rows.length) return true;
    }
    return false;
  }

  private async refresh() {
    await this.directory.reload();
    await this.registry.reload();
  }

  private async requireSuperAdmin(p: Principal, req: Request, code: string) {
    if (isSuperAdminEverywhere(p)) return;
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'authz.denied',
      outcome: 'denied',
      targetType: 'panel',
      targetId: code,
      metadata: { missing: ['role:super_admin on every brand'] },
    });
    throw new ForbiddenException('Only a Super Admin on every brand can add or change panels');
  }

  private async record(
    req: Request,
    code: string,
    action: string,
    reason: string,
    diff: { before?: Record<string, unknown>; after?: Record<string, unknown> },
  ) {
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      // The panel column points at the panel row; a panel that is being deleted is named in targetId only.
      ...(action === 'panels.delete' ? {} : { panel: code }),
      targetType: 'panel',
      targetId: code,
      ...diff,
      reason,
    });
  }
}
