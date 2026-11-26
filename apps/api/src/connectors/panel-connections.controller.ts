import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import type { ApiEnv } from '@madp/config';
import {
  PANEL_CODES,
  PANEL_CONNECTION_FIELDS,
  PANELS,
  PanelCode,
  PanelConnectionChange,
  PanelConnectionDecision,
  PanelConnectionTest,
  type PanelConnectionField,
  type PanelConnectionView,
} from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { AuthService } from '../auth/auth.service.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import { adminRoleGrants, adminUsers, panelConnections } from '../db/schema.js';
import { FieldCrypto } from '../crypto/field-crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { ConnectorRegistry } from './connector-registry.js';

type Patch = Omit<PanelConnectionChange, 'reason' | 'code'>;
type Row = typeof panelConnections.$inferSelect;

const SECRET_FIELDS: PanelConnectionField[] = ['syncToken', 'adminSecret'];
const hint = (s: string) => `…${s.slice(-4)}`;

/** Holds the Super Admin role on this brand (a grant for every brand counts). */
function isSuperAdminOn(p: Principal, panel: PanelCode) {
  return p.grants.some((g) => g.role === 'super_admin' && (g.brands === null || g.brands.includes(panel)));
}

/**
 * Panel connections: how MADP reaches each panel, set in the console instead of environment variables.
 *
 * Only a Super Admin on the brand changes a connection, and every change needs their authenticator code: a changed
 * base URL could send every signed admin call to another host. When the brand has another active Super Admin, the
 * change waits for that second person (four eyes). Tokens and secrets are field-encrypted, never returned and never
 * written to the audit trail; the screen shows only whether one is set and its last four characters.
 */
@Controller('panel-connections')
export class PanelConnectionsController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly crypto: FieldCrypto,
    private readonly registry: ConnectorRegistry,
    private readonly auth: AuthService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('connectors.read')
  @Get()
  async list(@CurrentPrincipal() p: Principal): Promise<{ panels: PanelConnectionView[] }> {
    const rows = await this.database.db.select().from(panelConnections);
    const byPanel = new Map(rows.map((r) => [r.panel, r]));
    const ids = rows.flatMap((r) => [r.pendingBy, r.liveApprovedBy]).filter((x): x is string => Boolean(x));
    const names = new Map(
      ids.length
        ? (
            await this.database.db
              .select({ id: adminUsers.id, name: adminUsers.displayName })
              .from(adminUsers)
              .where(inArray(adminUsers.id, ids))
          ).map((a) => [a.id, a.name])
        : [],
    );
    return {
      panels: PANEL_CODES.map((panel) => this.view(panel, byPanel.get(panel), p, names)),
    };
  }

  @Put(':panel')
  async change(
    @CurrentPrincipal() p: Principal,
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(PanelConnectionChange)) body: PanelConnectionChange,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, panel, req);
    const { reason, code, ...patch } = body;
    const fields = PANEL_CONNECTION_FIELDS.filter((f) => patch[f] !== undefined);
    if (!fields.length) throw new BadRequestException('Nothing to change');
    this.checkUrls(patch);
    await this.requireCode(p, panel, code, req);
    const row = await this.row(panel);
    if (row?.pendingEnc)
      throw new ConflictException(
        'A change to this panel is waiting for approval. Approve or reject it first.',
      );

    if (await this.otherSuperAdmins(p.id, panel)) {
      await this.database.db
        .insert(panelConnections)
        .values({
          panel,
          pendingEnc: this.crypto.encrypt(JSON.stringify(patch)),
          pendingFields: fields,
          pendingBy: p.id,
          pendingAt: new Date(),
          pendingReason: reason,
          updatedBy: p.id,
        })
        .onConflictDoUpdate({
          target: panelConnections.panel,
          set: {
            pendingEnc: this.crypto.encrypt(JSON.stringify(patch)),
            pendingFields: fields,
            pendingBy: p.id,
            pendingAt: new Date(),
            pendingReason: reason,
          },
        });
      await this.record(req, panel, 'connections.change.proposed', reason, { fields });
      return { status: 'pending' as const, fields };
    }
    await this.applyPatch(panel, patch, p.id, req, reason, null);
    return { status: 'applied' as const, fields };
  }

  @Post(':panel/decision')
  @HttpCode(200)
  async decide(
    @CurrentPrincipal() p: Principal,
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(PanelConnectionDecision)) body: PanelConnectionDecision,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, panel, req);
    const row = await this.row(panel);
    if (!row?.pendingEnc || !row.pendingBy)
      throw new NotFoundException('No change is waiting for this panel');
    // The proposer may withdraw their own change, but only someone else may approve it.
    if (body.decision === 'approve' && row.pendingBy === p.id) {
      await this.record(req, panel, 'authz.denied', body.reason, { missing: ['four_eyes'] }, 'denied');
      throw new ForbiddenException('A second Super Admin approves this change');
    }
    await this.requireCode(p, panel, body.code, req);
    const patch = JSON.parse(this.crypto.decrypt(row.pendingEnc)!) as Patch;
    await this.database.db
      .update(panelConnections)
      .set({ pendingEnc: null, pendingFields: null, pendingBy: null, pendingAt: null, pendingReason: null })
      .where(eq(panelConnections.panel, panel));
    if (body.decision === 'reject') {
      await this.record(req, panel, 'connections.change.rejected', body.reason, {
        fields: row.pendingFields ?? [],
        proposedBy: row.pendingBy,
      });
      return { status: 'rejected' as const };
    }
    await this.applyPatch(panel, patch, p.id, req, body.reason, row.pendingBy);
    return { status: 'applied' as const, fields: row.pendingFields ?? [] };
  }

  /**
   * Checks that MADP can reach the panel's changes feed with the given (or saved) address and token. Super Admin
   * only, because it makes MADP call an address the admin typed. Nothing is saved except the result.
   */
  @Post(':panel/test')
  @HttpCode(200)
  async test(
    @CurrentPrincipal() p: Principal,
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(PanelConnectionTest)) body: PanelConnectionTest,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, panel, req);
    this.checkUrls(body);
    const cur = this.registry.connection(panel);
    const url = body.syncBaseUrl ?? cur.syncBaseUrl;
    const token = body.syncToken ?? cur.syncToken;
    if (!url || !token) throw new BadRequestException('Enter the panel address and its token first');
    const health = await this.registry.liveConnector(panel, url, token).health();
    const ok = health.state === 'healthy';
    const message = ok
      ? `Reached in ${health.latencyMs} ms`
      : (health.message ?? 'Not reachable').slice(0, 300);
    await this.database.db
      .insert(panelConnections)
      .values({ panel, lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message })
      .onConflictDoUpdate({
        target: panelConnections.panel,
        set: { lastTestAt: new Date(), lastTestOk: ok, lastTestMessage: message },
      });
    await this.record(req, panel, 'connections.test', undefined, { ok, host: new URL(url).host });
    return { ok, message, latencyMs: health.latencyMs };
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  private view(
    panel: PanelCode,
    row: Row | undefined,
    p: Principal,
    names: Map<string, string>,
  ): PanelConnectionView {
    const eff = this.registry.connection(panel);
    const slot = this.registry.get(panel);
    const envHint = (s: string | undefined) => (s ? hint(s) : null);
    return {
      panel,
      name: PANELS[panel].name,
      syncBaseUrl: { value: eff.syncBaseUrl ?? null, source: eff.source.syncBaseUrl },
      syncToken: {
        set: Boolean(eff.syncToken),
        hint: eff.source.syncToken === 'console' ? (row?.syncTokenHint ?? null) : envHint(eff.syncToken),
        source: eff.source.syncToken,
      },
      adminBaseUrl: { value: eff.adminBaseUrl ?? null, source: eff.source.adminBaseUrl },
      adminSecret: {
        set: Boolean(eff.adminSecret),
        hint:
          eff.source.adminSecret === 'console' ? (row?.adminSecretHint ?? null) : envHint(eff.adminSecret),
        source: eff.source.adminSecret,
      },
      syncIntervalMinutes: { value: eff.syncIntervalMinutes, source: eff.source.syncIntervalMinutes },
      liveApproved: {
        value: eff.liveApproved,
        source: eff.source.liveApproved,
        by: row?.liveApprovedBy ? (names.get(row.liveApprovedBy) ?? null) : null,
        at: row?.liveApprovedAt?.toISOString() ?? null,
      },
      dataMode: slot.dataMode,
      reason: slot.reason,
      pending:
        row?.pendingEnc && row.pendingBy && row.pendingAt
          ? {
              fields: row.pendingFields ?? [],
              by: row.pendingBy,
              byName: names.get(row.pendingBy) ?? null,
              at: row.pendingAt.toISOString(),
              reason: row.pendingReason,
            }
          : null,
      lastTest: row?.lastTestAt
        ? { at: row.lastTestAt.toISOString(), ok: Boolean(row.lastTestOk), message: row.lastTestMessage }
        : null,
      canChange: isSuperAdminOn(p, panel),
    };
  }

  private async row(panel: PanelCode) {
    return this.database.db.query.panelConnections.findFirst({ where: eq(panelConnections.panel, panel) });
  }

  private async applyPatch(
    panel: PanelCode,
    patch: Patch,
    actor: string,
    req: Request,
    reason: string,
    proposedBy: string | null,
  ) {
    const set: Partial<typeof panelConnections.$inferInsert> = { updatedBy: actor, updatedAt: new Date() };
    if (patch.syncBaseUrl !== undefined) set.syncBaseUrl = patch.syncBaseUrl;
    if (patch.adminBaseUrl !== undefined) set.adminBaseUrl = patch.adminBaseUrl;
    if (patch.syncIntervalMinutes !== undefined) set.syncIntervalMinutes = patch.syncIntervalMinutes;
    if (patch.syncToken !== undefined) {
      set.syncTokenEnc = patch.syncToken === null ? null : this.crypto.encrypt(patch.syncToken);
      set.syncTokenHint = patch.syncToken === null ? null : hint(patch.syncToken);
    }
    if (patch.adminSecret !== undefined) {
      set.adminSecretEnc = patch.adminSecret === null ? null : this.crypto.encrypt(patch.adminSecret);
      set.adminSecretHint = patch.adminSecret === null ? null : hint(patch.adminSecret);
    }
    if (patch.liveApproved !== undefined) {
      set.liveApproved = patch.liveApproved;
      set.liveApprovedBy = patch.liveApproved ? (proposedBy ?? actor) : null;
      set.liveApprovedAt = patch.liveApproved ? new Date() : null;
    }
    const before = this.registry.connection(panel);
    await this.database.db
      .insert(panelConnections)
      .values({ panel, ...set })
      .onConflictDoUpdate({ target: panelConnections.panel, set });
    await this.registry.reload();
    const after = this.registry.connection(panel);
    // URLs, interval and the live switch are shown as values; secrets only as "changed" or "cleared".
    const shown = (c: typeof before) => ({
      syncBaseUrl: c.syncBaseUrl ?? null,
      adminBaseUrl: c.adminBaseUrl ?? null,
      syncIntervalMinutes: c.syncIntervalMinutes,
      liveApproved: c.liveApproved,
    });
    const secrets = Object.fromEntries(
      SECRET_FIELDS.filter((f) => patch[f] !== undefined).map((f) => [
        f,
        patch[f] === null ? 'cleared' : 'changed',
      ]),
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'connections.change.applied',
      panel,
      targetType: 'panel_connection',
      targetId: panel,
      before: shown(before),
      after: { ...shown(after), ...secrets },
      reason,
      metadata: { proposedBy, dataMode: this.registry.get(panel).dataMode },
    });
  }

  /** https only; plain http is allowed outside production, for the local preview. */
  private checkUrls(patch: {
    syncBaseUrl?: string | null | undefined;
    adminBaseUrl?: string | null | undefined;
  }) {
    for (const u of [patch.syncBaseUrl, patch.adminBaseUrl]) {
      if (!u) continue;
      if (this.env.NODE_ENV === 'production' && !u.startsWith('https://'))
        throw new BadRequestException('Use an https:// address');
    }
  }

  private async otherSuperAdmins(self: string, panel: PanelCode): Promise<boolean> {
    const rows = await this.database.db
      .select({ id: adminUsers.id, brands: adminRoleGrants.brands })
      .from(adminRoleGrants)
      .innerJoin(adminUsers, eq(adminUsers.id, adminRoleGrants.adminId))
      .where(
        and(
          eq(adminRoleGrants.roleKey, 'super_admin'),
          eq(adminUsers.isActive, true),
          eq(adminUsers.mfaEnabled, true),
        ),
      );
    return rows.some((r) => r.id !== self && (!r.brands?.length || r.brands.includes(panel)));
  }

  private async requireSuperAdmin(p: Principal, panel: PanelCode, req: Request) {
    if (isSuperAdminOn(p, panel)) return;
    await this.record(req, panel, 'authz.denied', undefined, { missing: ['role:super_admin'] }, 'denied');
    throw new ForbiddenException('Only a Super Admin on this brand can change its connection');
  }

  private async requireCode(p: Principal, panel: PanelCode, code: string, req: Request) {
    if (await this.auth.confirmCode(p.id, code)) return;
    await this.record(req, panel, 'authz.denied', undefined, { missing: ['authenticator_code'] }, 'denied');
    throw new ForbiddenException({
      code: 'bad_code',
      message: 'That authenticator code is wrong or already used',
    });
  }

  private async record(
    req: Request,
    panel: PanelCode,
    action: string,
    reason: string | undefined,
    metadata: Record<string, unknown>,
    outcome?: 'denied',
  ) {
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action,
      ...(outcome ? { outcome } : {}),
      panel,
      targetType: 'panel_connection',
      targetId: panel,
      ...(reason ? { reason } : {}),
      metadata,
    });
  }
}
