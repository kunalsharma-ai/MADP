import { Body, Controller, ForbiddenException, Get, Header, Param, Post, Put, Query, Req } from '@nestjs/common';
import { z } from 'zod';
import {
  ArchiveRun,
  MemberActionReason,
  MemberAlertsChange,
  MemberResponsesQuery,
  type MemberAdminSessions,
  type MemberEmailResult,
  type MemberLoginAs,
  MemberRestore,
  MemberSearch,
  MemberSegmentChange,
  MemberStatusChange,
  MemberUnmask,
  MemberUpdate,
  MemberTypeRules,
  type BrandSelection,
  type PanelCode,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelAdminService } from './panel-admin.service.js';
import { PanelDirectory } from '../panels/panel-directory.js';
import { MemberTypes } from './member-types.js';
import { SegmentDirectory } from '../segments/segment-directory.js';
import { MemberTagStore } from './member-tags.js';

/** Fields of a list row; a member page carries more, which the tag list must not pass on. */
export const LIST_FIELDS = ['id', 'memberId', 'name', 'email', 'phone', 'category', 'segment', 'status', 'country', 'birthYear', 'gender', 'age', 'qualityScore', 'emailVerified', 'signedUpAt', 'lastActivityAt', 'marketingOptIn'] as const;

const MemberId = z.string().regex(/^[a-f0-9]{24}$/i, 'a member id');
const SessionId = z.string().regex(/^[a-f0-9]{24}$/i, 'a session id');
type Row = { id: string; segment?: string; category?: string; types?: Record<string, string[]>; tags?: string[] };
type Change = { before: Record<string, unknown>; after: Record<string, unknown> };

/**
 * Members module (super admin spec module 1) for the brand picked in the switcher. Reads are audited; writes are
 * audited with old and new values (personal data masked) and the admin's reason. Teen records need teen.read.
 */
@Controller('panel/members')
@BrandScoped()
export class MembersController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly audit: AuditService,
    private readonly types: MemberTypes,
    private readonly directory: PanelDirectory,
    private readonly segments: SegmentDirectory,
    private readonly tagStore: MemberTagStore,
  ) {}

  /** Members with a MADP tag: one page of tagged ids, each read from the panel (gone or other-brand ids skipped). */
  private async tagged(p: Principal, brand: PanelCode, tag: string, page: number) {
    const size = 50;
    const { ids, total } = await this.tagStore.page(brand, tag, page, size);
    const rows = await Promise.all(
      ids.map((id) =>
        this.panel
          .call<Record<string, unknown>>(brand, p.id, 'GET', R.member(id))
          .then((m) => Object.fromEntries(LIST_FIELDS.filter((k) => k in m).map((k) => [k, m[k]])) as Row)
          .catch(() => null),
      ),
    );
    return { items: rows.filter((r): r is Row => !!r), total, page, pageSize: size, sort: null };
  }

  /** Rules the admin may see: on a sensitive panel (MHO) every answer needs health.sensitive.read. */
  private async visibleTypeRules(p: Principal, brand: PanelCode) {
    const { rules } = await this.types.rules(brand);
    const health = hasOn(p, brand, ['health.sensitive.read']);
    const panelSensitive = this.directory.sensitive(brand);
    const shown = rules.filter((r) => health || !(r.sensitive || panelSensitive));
    return { shown, hidden: rules.length - shown.length, sensitive: shown.some((r) => r.sensitive || panelSensitive) };
  }

  private async deny(req: Request, brand: PanelCode, targetId: string, missing: string[]): Promise<never> {
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'authz.denied',
      outcome: 'denied',
      panel: brand,
      targetType: 'member',
      targetId,
      metadata: { missing },
    });
    throw new ForbiddenException('Teen records need the teen.read permission');
  }

  /** Loads the member for a write and refuses teen records to admins without teen.read. */
  private async guardTeen(p: Principal, brand: PanelCode, id: string, req: Request) {
    const m = await this.panel.call<Row>(brand, p.id, 'GET', R.member(id));
    if (m.segment === 'teen' && !hasOn(p, brand, ['teen.read']))
      await this.deny(req, brand, id, ['teen.read']);
    return m;
  }

  @RequirePermissions('members.read')
  @Get()
  async search(
    @Query(new ZodPipe(MemberSearch)) q: MemberSearch,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const teens = hasOn(p, brand, ['teen.read']);
    if (q.segment === 'teen' && !teens) await this.deny(req, brand, 'search', ['teen.read']);
    const types = await this.visibleTypeRules(p, brand);
    const keys = [...new Set(types.shown.flatMap((r) => r.questions))];
    // Age sorts by date of birth the other way round (youngest first = latest birth date first).
    const sort = q.sort === 'age' ? { sort: 'born', dir: q.dir === 'asc' ? 'desc' : 'asc' } : {};
    const { tag, ...panelQuery } = q;
    const data: { items: Row[]; total: number; page: number; pageSize: number; sort?: { by: string; dir: 'asc' | 'desc' } | null } = tag
      ? await this.tagged(p, brand, tag, q.page)
      : await this.panel.call(brand, p.id, 'GET', R.members, {
          ...panelQuery,
          ...sort,
          ...(teens ? {} : { noTeens: 1 }),
          ...(keys.length ? { typeQuestions: keys.join(',') } : {}),
        });
    if (!teens) data.items = data.items.filter((r) => r.segment !== 'teen');
    if (q.sort === 'age' && data.sort?.by === 'born') data.sort = { by: 'age', dir: q.dir === 'asc' ? 'asc' : 'desc' };
    MemberTypes.annotate(data.items, types.shown);
    const tagsOf = await this.tagStore.forMembers(brand, data.items.map((r) => r.id));
    for (const r of data.items) r.tags = tagsOf.get(r.id) ?? [];
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.search',
      panel: brand,
      targetType: 'member',
      metadata: {
        filters: Object.keys(q).filter((k) => q[k as keyof MemberSearch] !== undefined),
        total: data.total,
        page: data.page,
        ...(keys.length ? { typeAnswers: keys, specialCategory: types.sensitive } : {}),
      },
    });
    return { ...data, teensHidden: !teens, typesHidden: types.hidden };
  }

  /** The Type column rules of this brand (which question-bank answers show for which segment). */
  @RequirePermissions('members.read')
  @Get('type-columns')
  async typeColumns(@CurrentBrand() b: BrandSelection) {
    const brand = b as PanelCode;
    // The panel's own category values (for the Segment filter), each with the MADP segments it joins.
    const byValue = new Map<string, { value: string; segments: string[]; minor: boolean }>();
    for (const r of this.segments.rules()) {
      if (r.panel !== brand || r.status !== 'active') continue;
      const c = byValue.get(r.sourceValue) ?? { value: r.sourceValue, segments: [], minor: false };
      c.segments.push(this.segments.label(r.segment));
      c.minor ||= r.minor;
      byValue.set(r.sourceValue, c);
    }
    return {
      ...(await this.types.rules(brand)),
      sensitivePanel: this.directory.sensitive(brand),
      categories: [...byValue.values()].sort((a, b) => Number(a.minor) - Number(b.minor) || a.value.localeCompare(b.value)),
    };
  }

  @RequirePermissions('segments.manage')
  @Put('type-columns')
  async saveTypeColumns(
    @Body(new ZodPipe(MemberTypeRules)) body: MemberTypeRules,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const before = await this.types.rules(brand);
    await this.types.save(brand, body.rules, p.id);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.type_columns_changed',
      panel: brand,
      targetType: 'member_type_rules',
      targetId: brand,
      metadata: { before: before.rules, after: body.rules },
    });
    return { rules: body.rules, saved: true };
  }

  @RequirePermissions('members.read')
  @Get(':id')
  async detail(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const m = await this.guardTeen(p, brand, id, req);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.view',
      panel: brand,
      targetType: 'member',
      targetId: id,
    });
    return {
      ...m,
      canUnmask: hasOn(p, brand, ['pii.view']),
      canResendEmail: hasOn(p, brand, ['members.resend_email']),
      canLoginAs: hasOn(p, brand, ['members.impersonate']),
    };
  }

  @RequirePermissions('members.read', 'points.read')
  @Get(':id/ledger')
  async ledger(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const data = await this.panel.call<unknown>(brand, p.id, 'GET', R.memberLedger(id));
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.ledger.view',
      panel: brand,
      targetType: 'member',
      targetId: id,
    });
    return data;
  }

  @RequirePermissions('members.edit')
  @Put(':id')
  async update(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberUpdate)) body: MemberUpdate,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const { reason, ...patch } = body;
    const r = await this.panel.call<Change>(brand, p.id, 'PUT', R.member(id), undefined, patch);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.edit',
      panel: brand,
      targetType: 'member',
      targetId: id,
      before: r.before,
      after: r.after,
      reason,
    });
    return r;
  }

  @RequirePermissions('members.status')
  @Post(':id/status')
  async status(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberStatusChange)) body: MemberStatusChange,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.memberStatus(id), undefined, body);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: `members.${body.action}`,
      panel: brand,
      targetType: 'member',
      targetId: id,
      before: r.before,
      after: r.after,
      reason: body.reason,
    });
    return r;
  }

  @RequirePermissions('members.edit', 'segments.manage')
  @Post(':id/segment')
  async segment(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberSegmentChange)) body: MemberSegmentChange,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<Change>(brand, p.id, 'POST', R.memberSegment(id), undefined, body);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.segment.change',
      panel: brand,
      targetType: 'member',
      targetId: id,
      before: r.before,
      after: r.after,
      reason: body.reason,
    });
    return r;
  }

  /** Full values of masked fields. Needs pii.view and a reason; the audit entry names the fields, never the values. */
  @RequirePermissions('members.read', 'pii.view')
  @Post(':id/unmask')
  async unmask(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberUnmask)) body: MemberUnmask,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    // Logged before the values are fetched, so a failed call still shows the attempt.
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.unmask',
      panel: brand,
      targetType: 'member',
      targetId: id,
      metadata: { fields: body.fields },
      reason: body.reason,
    });
    return this.panel.call<unknown>(brand, p.id, 'POST', R.memberUnmask(id), undefined, {
      fields: body.fields,
    });
  }

  /** Six-month activity check. Dry run by default; a real run needs a reason. */
  @RequirePermissions('members.status')
  @Post('archive-run')
  async archiveRun(
    @Body(new ZodPipe(ArchiveRun)) body: ArchiveRun,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    if (!body.dryRun && !body.reason) throw new ForbiddenException('A real archive run needs a reason');
    const r = await this.panel.call<Record<string, unknown>>(brand, p.id, 'POST', R.archiveRun, undefined, {
      months: body.months,
      dryRun: body.dryRun,
    });
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: body.dryRun ? 'members.archive_run.dry_run' : 'members.archive_run',
      panel: brand,
      targetType: 'member',
      metadata: {
        months: r.months,
        checked: r.checked,
        archived: r.archived,
        activityUpdated: r.activityUpdated,
      },
      reason: body.reason ?? null,
    });
    return r;
  }

  @RequirePermissions('members.status')
  @Post('restore')
  async restore(
    @Body(new ZodPipe(MemberRestore)) body: MemberRestore,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ asked: number; restored: number }>(
      brand,
      p.id,
      'POST',
      R.restore,
      undefined,
      body,
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.restore',
      panel: brand,
      targetType: 'member',
      metadata: { ...r, ids: body.ids.slice(0, 50) },
      reason: body.reason,
    });
    return r;
  }

  // ---- Member actions -------------------------------------------------------------------------------------------
  // The panel sends nothing unless the brand's email_admin_actions switch is on; while it is off the answer says what
  // would be sent. The audit entry names the template and whether it went, never the address.

  private async email(
    kind: 'reset_password' | 'resend_welcome',
    id: string,
    body: MemberActionReason,
    b: BrandSelection,
    p: Principal,
    req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const path = kind === 'reset_password' ? R.memberResetPassword(id) : R.memberResendWelcome(id);
    const r = await this.panel.call<MemberEmailResult>(brand, p.id, 'POST', path, undefined, body);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: `members.${kind}`,
      panel: brand,
      targetType: 'member',
      targetId: id,
      metadata: { sent: r.sent, template: r.wouldSend.template, switch: r.switch },
      reason: body.reason,
    });
    return r;
  }

  /** E-mail the member's own forgot-password link. The console never sees or sets a password. */
  @RequirePermissions('members.read', 'members.resend_email')
  @Post(':id/reset-password')
  resetPassword(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberActionReason)) body: MemberActionReason,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.email('reset_password', id, body, b, p, req);
  }

  @RequirePermissions('members.read', 'members.resend_email')
  @Post(':id/resend-welcome')
  resendWelcome(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberActionReason)) body: MemberActionReason,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    return this.email('resend_welcome', id, body, b, p, req);
  }

  /**
   * "Log in as member": a one-use link for a 15-minute member session the panel marks as an admin session (no
   * password, e-mail, payout or reward changes; no answers on MHO). Teens are refused by the panel. The attempt is
   * audited before the panel is asked, and the link itself is never stored or logged.
   */
  @RequirePermissions('members.read', 'members.impersonate')
  @Post(':id/login-as')
  @Header('Cache-Control', 'no-store')
  async loginAs(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberActionReason)) body: MemberActionReason,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const m = await this.guardTeen(p, brand, id, req);
    if (m.segment === 'teen') throw new ForbiddenException('Admins can’t sign in as a teen member');
    const base = { ...AuditService.fromRequest(req), panel: brand, targetType: 'member', targetId: id, reason: body.reason };
    await this.audit.record({ ...base, action: 'members.login_as.requested' });
    const r = await this.panel.call<MemberLoginAs>(brand, p.id, 'POST', R.memberLoginAs(id), undefined, body);
    await this.audit.record({
      ...base,
      action: 'members.login_as',
      metadata: { sessionId: r.sessionId, expiresAt: r.expiresAt, redeemBy: r.redeemBy },
    });
    return r;
  }

  @RequirePermissions('members.read', 'members.impersonate')
  @Get(':id/admin-sessions')
  async adminSessions(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    return this.panel.call<MemberAdminSessions>(brand, p.id, 'GET', R.memberAdminSessions(id));
  }

  /** End an admin session early, or cancel a link nobody has opened. */
  @RequirePermissions('members.read', 'members.impersonate')
  @Post(':id/admin-sessions/:sid/end')
  async endAdminSession(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Param('sid', new ZodPipe(SessionId)) sid: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    const r = await this.panel.call<{ id: string; endedAt: string }>(brand, p.id, 'POST', R.memberAdminSessionEnd(id, sid));
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.login_as.ended',
      panel: brand,
      targetType: 'member',
      targetId: id,
      metadata: { sessionId: sid },
    });
    return r;
  }

  // --- member engagement (MFR#101): what the member sees in their member area ---------------------------------------

  /** Survey names on the health panel can name a condition, so they are hidden without health access. */
  private maskHealth<T extends { survey: string | null; slug: string | null }>(p: Principal, brand: PanelCode, rows: T[]): T[] {
    if (brand !== 'mho' || hasOn(p, brand, ['health.sensitive.read'])) return rows;
    return rows.map((r) => ({ ...r, survey: r.survey === null ? null : 'Health survey (name hidden)', slug: null }));
  }

  @RequirePermissions('members.read')
  @Get(':id/engagement')
  async engagement(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const data = await this.panel.call<unknown>(brand, p.id, 'GET', R.memberEngagement(id));
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.engagement.view',
      panel: brand,
      targetType: 'member',
      targetId: id,
    });
    return data;
  }

  @RequirePermissions('members.read')
  @Get(':id/responses')
  async responses(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Query(new ZodPipe(MemberResponsesQuery)) q: MemberResponsesQuery,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const data = await this.panel.call<{
      total: number;
      page: number;
      size: number;
      items: { survey: string | null; slug: string | null }[];
    }>(brand, p.id, 'GET', R.memberResponses(id), q);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.responses.view',
      panel: brand,
      targetType: 'member',
      targetId: id,
      metadata: { status: q.status ?? null, page: q.page, total: data.total },
    });
    return { ...data, items: this.maskHealth(p, brand, data.items) };
  }

  @RequirePermissions('members.edit')
  @Put(':id/alerts')
  async alerts(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberAlertsChange)) body: MemberAlertsChange,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const r = await this.panel.call<unknown>(brand, p.id, 'PUT', R.memberAlerts(id), undefined, body);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.alerts.change',
      panel: brand,
      targetType: 'member',
      targetId: id,
      after: { notifications: body.notifications ?? null, survey: body.survey ?? null },
      reason: body.reason,
    });
    return r;
  }

  @RequirePermissions('members.edit')
  @Post(':id/payout/clear')
  async clearPayout(
    @Param('id', new ZodPipe(MemberId)) id: string,
    @Body(new ZodPipe(MemberActionReason)) body: MemberActionReason,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const brand = b as PanelCode;
    await this.guardTeen(p, brand, id, req);
    const r = await this.panel.call<{ cleared: boolean; was: string | null }>(brand, p.id, 'POST', R.memberPayoutClear(id), undefined, body);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.payout.clear',
      panel: brand,
      targetType: 'member',
      targetId: id,
      before: { method: r.was },
      after: { method: null },
      reason: body.reason,
    });
    return r;
  }
}
