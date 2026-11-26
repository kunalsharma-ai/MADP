import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Header,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Request } from 'express';
import { z } from 'zod';
import type { ApiEnv } from '@madp/config';
import {
  NETWORK_BATCH_ID,
  NETWORK_FILE_COLUMNS,
  NetworkFileKind,
  NetworkPush,
  NetworkUpload,
  PanelCode,
  type NetworkStatus,
  type NetworkUploadResult,
} from '@madp/contracts';
import { CurrentPrincipal, Public, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { AuthService } from '../auth/auth.service.js';
import { API_ENV } from '../common/tokens.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AbuseService } from '../common/abuse.service.js';
import { AuditService } from '../audit/audit.service.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { PanelDirectory } from '../panels/panel-directory.js';
import { verifyWebhook } from '../webhooks/signature.js';
import { InboxService } from './inbox.service.js';
import { parseCsv, parseXlsx, readRows } from './file-parse.js';

const KeyChange = z
  .object({
    reason: z.string().trim().min(5).max(500),
    code: z.string().regex(/^\d{6}$/, 'the 6-digit code from your authenticator app'),
  })
  .strict();
type KeyChange = z.infer<typeof KeyChange>;

const EMPTY = { members: [], answers: [], questions: [], deletions: [] };

/**
 * Networks screen and push API: bring in a panel network that runs on other software. Its members arrive by a CSV
 * or Excel upload here, or by the network's own system calling the signed push API. Both land in the panel's
 * encrypted inbox and the normal sync reads it. Nothing is accepted until live sync is approved for the panel on
 * Panel connections, because the files hold real personal data.
 */
@Controller('networks')
export class NetworksController {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly inbox: InboxService,
    private readonly panels: PanelDirectory,
    private readonly registry: ConnectorRegistry,
    private readonly audit: AuditService,
    private readonly auth: AuthService,
    private readonly abuse: AbuseService,
  ) {}

  @RequirePermissions('connectors.read')
  @Get()
  async list(): Promise<{ networks: NetworkStatus[] }> {
    await this.registry.reload();
    const codes = this.panels.all().filter((p) => p.sourceType === 'inbox' && p.status === 'active');
    return {
      networks: await Promise.all(
        codes.map((p) => this.inbox.status(p.code, p.name, this.registry.connection(p.code).liveApproved)),
      ),
    };
  }

  /** An empty file with the right column names, plus one DEMO example row. */
  @RequirePermissions('connectors.read')
  @Get('template/:kind')
  @Header('content-type', 'text/csv; charset=utf-8')
  template(@Param('kind', new ZodPipe(NetworkFileKind)) kind: NetworkFileKind) {
    const cols = NETWORK_FILE_COLUMNS[kind];
    const example: Record<string, string> = {
      memberId: 'demo-1001',
      category: 'b2c',
      email: 'demo-1001@example.invalid',
      firstName: 'Demo',
      lastName: 'Member',
      gender: 'female',
      dateOfBirth: '1990-04-12',
      country: 'IN',
      city: 'Delhi',
      emailVerified: 'yes',
      active: 'yes',
      marketingConsent: 'granted',
      questionId: 'household_size',
      values: '3',
      label: 'How many people live in your household?',
      type: 'single',
      options: '1=One|2=Two|3=Three|4=Four or more',
    };
    const q = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
    return `${cols.map((c) => c.aliases[0] ?? c.field).join(',')}\n${cols.map((c) => q(example[c.field] ?? '')).join(',')}\n`;
  }

  @RequirePermissions('connectors.read')
  @Post(':panel/upload')
  @HttpCode(200)
  async upload(
    @CurrentPrincipal() p: Principal,
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(NetworkUpload)) body: NetworkUpload,
    @Req() req: Request,
  ): Promise<NetworkUploadResult> {
    await this.requireSuperAdmin(p, req, panel);
    this.requireOpenInbox(panel);
    const buf = Buffer.from(body.file, 'base64');
    const table = body.format === 'csv' ? parseCsv(buf.toString('utf8')) : await parseXlsx(buf);
    if (!table) throw new BadRequestException('That file is not an Excel workbook (.xlsx).');
    if (table.length < 2) throw new BadRequestException('The file has no rows under its header.');
    if (table.length > 50_001) throw new BadRequestException('Upload at most 50,000 rows per file; split larger files.');
    const read = readRows(body.kind, table);
    const result: NetworkUploadResult = {
      dryRun: body.dryRun,
      kind: body.kind,
      rows: read.rows,
      accepted: read.items.length,
      problems: read.problems,
      columns: read.columns,
      batch: null,
    };
    if (body.dryRun) return result;
    if (read.problems.length)
      throw new BadRequestException({
        message: `Fix the rows with problems first (${read.problems.length}${read.problems.length >= 50 ? '+' : ''}); nothing was saved`,
        problems: read.problems.slice(0, 10).map((x) => `row ${x.row}: ${x.message}`),
      });
    const batch = `upload-${new Date().toISOString().replace(/[:.]/g, '')}-${randomBytes(3).toString('hex')}`;
    const saved = await this.inbox.store(panel, batch, 'upload', { ...EMPTY, [body.kind]: read.items } as NetworkPush, p.id);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'networks.upload',
      panel,
      targetType: 'panel',
      targetId: panel,
      reason: body.reason,
      // Counts only: the file itself holds personal data.
      metadata: { batch, kind: body.kind, format: body.format, rows: read.rows, records: saved.records },
    });
    return { ...result, batch };
  }

  /** Makes a new push key (the old one stops working). Needs your authenticator code; the key is shown once. */
  @RequirePermissions('connectors.read')
  @Post(':panel/push-key')
  async newKey(
    @CurrentPrincipal() p: Principal,
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(KeyChange)) body: KeyChange,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, panel);
    if (!this.panels.isInbox(panel)) throw new BadRequestException('Only a network on other software has a push key');
    await this.requireCode(p, panel, body.code, req);
    const key = await this.inbox.newPushKey(panel, p.id);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'networks.push_key.create',
      panel,
      targetType: 'panel',
      targetId: panel,
      reason: body.reason,
      metadata: { hint: `…${key.slice(-4)}` },
    });
    return { key, hint: `…${key.slice(-4)}` };
  }

  @RequirePermissions('connectors.read')
  @Delete(':panel/push-key')
  async revokeKey(
    @CurrentPrincipal() p: Principal,
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(KeyChange)) body: KeyChange,
    @Req() req: Request,
  ) {
    await this.requireSuperAdmin(p, req, panel);
    await this.requireCode(p, panel, body.code, req);
    await this.inbox.revokePushKey(panel);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'networks.push_key.revoke',
      panel,
      targetType: 'panel',
      targetId: panel,
      reason: body.reason,
    });
    return { revoked: true };
  }

  /**
   * Signed push API for the network's own system. Headers: `x-madp-batch` (a unique batch id), `x-madp-timestamp`
   * (Unix seconds) and `x-madp-signature: v1=<hex HMAC-SHA256 of "<timestamp>.<batch>.<raw body>" with the push key>`.
   * A batch already accepted answers 200 with `duplicate: true`, so a retry is safe.
   */
  @Public()
  @Post(':panel/push')
  @HttpCode(202)
  async push(@Param('panel', new ZodPipe(PanelCode)) panel: PanelCode, @Req() req: RawBodyRequest<Request>) {
    this.abuse.check('network_push', req.ip);
    const secret = this.panels.isInbox(panel) && this.panels.isActive(panel) ? await this.inbox.pushKey(panel) : null;
    // No key means pushes are off for this panel: answer as if the route did not exist.
    if (!secret) throw new NotFoundException();
    const batch = String(req.header('x-madp-batch') ?? '');
    const raw = req.rawBody ?? Buffer.alloc(0);
    const reject = async (reason: string) => {
      const a = this.abuse.fail('network_push', req.ip);
      if (a.audit)
        await this.audit.record({
          actorId: null,
          actorType: 'system',
          action: 'networks.push.rejected',
          panel,
          targetType: 'panel',
          targetId: panel,
          metadata: { reason, bytes: raw.length, ...(a.blocked ? { addressBlocked: true } : {}) },
          ip: req.ip ?? null,
        });
      return new UnauthorizedException('Push rejected');
    };
    if (!NETWORK_BATCH_ID.test(batch)) throw await reject('bad_batch_id');
    const v = verifyWebhook({
      secrets: [secret],
      header: req.header('x-madp-signature'),
      timestamp: req.header('x-madp-timestamp'),
      eventId: batch,
      rawBody: raw,
      nowSeconds: Math.floor(Date.now() / 1000),
      toleranceSeconds: this.env.WEBHOOK_TOLERANCE_SECONDS,
    });
    if (!v.ok) throw await reject(v.reason);
    this.requireOpenInbox(panel);
    let json: unknown;
    try {
      json = JSON.parse(raw.toString('utf8'));
    } catch {
      throw new BadRequestException('Body is not valid JSON');
    }
    const parsed = NetworkPush.safeParse(json);
    if (!parsed.success)
      throw new BadRequestException({
        message: 'Not a valid push body',
        // Paths and messages only: values may be personal data.
        problems: parsed.error.issues.slice(0, 20).map((i) => `${i.path.join('.')}: ${i.message}`),
      });
    const saved = await this.inbox.store(panel, batch, 'push', parsed.data, null);
    await this.audit.record({
      actorId: null,
      actorType: 'system',
      action: saved.stored ? 'networks.push' : 'networks.push.duplicate',
      panel,
      targetType: 'panel',
      targetId: panel,
      metadata: {
        batch,
        members: parsed.data.members.length,
        answers: parsed.data.answers.length,
        questions: parsed.data.questions.length,
        deletions: parsed.data.deletions.length,
      },
      ip: req.ip ?? null,
    });
    return { batch, records: saved.records, duplicate: !saved.stored };
  }

  // ---- helpers ------------------------------------------------------------------------------------------------------

  /** The panel must be an active network with live sync approved: uploads and pushes hold real personal data. */
  private requireOpenInbox(panel: PanelCode) {
    if (!this.panels.isInbox(panel)) throw new BadRequestException('That panel runs on the shared panel backend, not an inbox');
    if (!this.panels.isActive(panel)) throw new ConflictException('That panel is archived');
    if (!this.registry.connection(panel).liveApproved)
      throw new ConflictException('Turn on live sync for this panel on Panel connections first');
  }

  private async requireCode(p: Principal, panel: PanelCode, code: string, req: Request) {
    if (await this.auth.confirmCode(p.id, code)) return;
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'authz.denied',
      outcome: 'denied',
      panel,
      targetType: 'panel',
      targetId: panel,
      metadata: { missing: ['authenticator_code'] },
    });
    throw new ForbiddenException({ code: 'bad_code', message: 'That authenticator code is wrong or already used' });
  }

  private async requireSuperAdmin(p: Principal, req: Request, panel: string) {
    if (p.grants.some((g) => g.role === 'super_admin' && g.brands === null)) return;
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'authz.denied',
      outcome: 'denied',
      targetType: 'panel',
      targetId: panel,
      metadata: { missing: ['role:super_admin on every brand'] },
    });
    throw new ForbiddenException('Only a Super Admin on every brand can bring in network data');
  }
}
