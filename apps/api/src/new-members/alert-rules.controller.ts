import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Req,
} from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  AlertRuleInput,
  AlertRuleMute,
  type AlertRuleView,
  type AlertRules,
  type PanelCode,
} from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { Database } from '../db/database.js';
import { adminAlertRule } from '../db/schema.js';
import { AudienceService } from '../audience/audience.service.js';
import { alertPanels } from './new-members.controller.js';

const MAX_RULES = 30;
type Rule = typeof adminAlertRule.$inferSelect;

/**
 * Alert rules each admin sets for themself: "tell me when new sign-ups on MHO in the last hour go above 20", "when
 * survey completes on T2O in the last day drop below 50". Checked against MADP's synced data each time the console
 * asks (the header polls every two minutes). Counts only. A rule only covers panels where the admin can see members,
 * teens only with teen.read, and redemption rules only with points.read. Nothing is sent outside the console.
 * No @RequirePermissions (like the bell): members.read is checked per brand, and an admin without it on any brand
 * is refused here.
 */
@Controller('alert-rules')
export class AlertRulesController {
  constructor(
    private readonly database: Database,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  private async count(
    p: Principal,
    panel: PanelCode,
    r: Pick<Rule, 'metric' | 'segment' | 'window'>,
  ): Promise<number | null> {
    const mode = this.audience.defaultMode();
    const since = r.window === 'hour' ? sql`now() - interval '1 hour'` : sql`now() - interval '1 day'`;
    const noTeens = hasOn(p, panel, ['teen.read'])
      ? sql``
      : sql` and not exists (select 1 from category_membership t where t.master_person_id = pm.master_person_id and t.panel = pm.panel and (t.is_minor or t.category = 'teen'))`;
    const db = this.database.db;
    if (r.metric === 'signups') {
      const seg = r.segment
        ? sql` and exists (select 1 from category_membership c where c.master_person_id = pm.master_person_id and c.panel = pm.panel and c.category = ${r.segment})`
        : sql``;
      const x = await db.execute<{ n: string }>(sql`
        select count(*) as n from panel_membership pm join source_identity si on si.id = pm.source_identity_id
        where pm.data_mode = ${mode} and pm.panel = ${panel} and pm.status <> 'deleted'
          and coalesce(si.source_created_at, pm.created_at) > ${since}${seg}${noTeens}`);
      return Number(x.rows[0]?.n ?? 0);
    }
    if (r.metric === 'completes') {
      const x = await db.execute<{ n: string }>(sql`
        select count(*) as n from survey_participation sp join panel_membership pm on pm.id = sp.panel_membership_id
        where sp.data_mode = ${mode} and sp.panel = ${panel} and sp.status = 'complete' and sp.ended_at > ${since}${noTeens}`);
      return Number(x.rows[0]?.n ?? 0);
    }
    if (!hasOn(p, panel, ['points.read'])) return null;
    const x = await db.execute<{ n: string; pts: string }>(sql`
      select count(*) as n, coalesce(sum(abs(rl.points)), 0) as pts
      from reward_ledger rl join loyalty_account la on la.id = rl.account_id
      join panel_membership pm on pm.id = la.panel_membership_id
      where rl.data_mode = ${mode} and rl.panel = ${panel} and rl.bucket = 'redeemed' and rl.recorded_at > ${since}${noTeens}`);
    return Number(r.metric === 'redemptions' ? x.rows[0]?.n : x.rows[0]?.pts) || 0;
  }

  private async view(p: Principal, r: Rule): Promise<AlertRuleView> {
    const mine = alertPanels(p);
    const panels = r.panel ? mine.filter((x) => x === r.panel) : mine;
    const live = r.enabled && !(r.mutedUntil && r.mutedUntil.getTime() > Date.now());
    const current = await Promise.all(
      panels.map(async (panel) => {
        const value = await this.count(p, panel, r);
        const hit = value !== null && (r.comparator === 'above' ? value > r.threshold : value < r.threshold);
        return { panel, value, firing: live && hit };
      }),
    );
    return {
      id: r.id,
      name: r.name,
      panel: r.panel,
      metric: r.metric as AlertRuleView['metric'],
      segment: r.segment,
      comparator: r.comparator as AlertRuleView['comparator'],
      threshold: r.threshold,
      window: r.window as AlertRuleView['window'],
      enabled: r.enabled,
      mutedUntil: r.mutedUntil?.toISOString() ?? null,
      updatedAt: r.updatedAt.toISOString(),
      current,
    };
  }

  private allowed(p: Principal) {
    if (!alertPanels(p).length)
      throw new ForbiddenException('Alert rules need members access on at least one panel');
  }

  private async mine(p: Principal, id: string): Promise<Rule> {
    this.allowed(p);
    const [r] = await this.database.db
      .select()
      .from(adminAlertRule)
      .where(and(eq(adminAlertRule.id, id), eq(adminAlertRule.adminUserId, p.id)));
    if (!r) throw new NotFoundException('No such alert rule');
    return r;
  }

  private check(p: Principal, b: AlertRuleInput) {
    this.allowed(p);
    if (b.panel && !alertPanels(p).includes(b.panel))
      throw new BadRequestException('You cannot see members on that panel');
    if (b.segment && b.metric !== 'signups')
      throw new BadRequestException('A segment only applies to sign-up rules');
  }

  @Get()
  async list(@CurrentPrincipal() p: Principal): Promise<AlertRules> {
    this.allowed(p);
    const rows = await this.database.db
      .select()
      .from(adminAlertRule)
      .where(eq(adminAlertRule.adminUserId, p.id))
      .orderBy(adminAlertRule.createdAt);
    const rules = await Promise.all(rows.map((r) => this.view(p, r)));
    return {
      checkedAt: new Date().toISOString(),
      dataMode: this.audience.defaultMode(),
      rules,
      firing: rules.flatMap((r) =>
        r.current
          .filter((c) => c.firing)
          .map((c) => ({
            ruleId: r.id,
            name: r.name,
            panel: c.panel,
            metric: r.metric,
            value: c.value ?? 0,
            threshold: r.threshold,
            comparator: r.comparator,
            window: r.window,
          })),
      ),
    };
  }

  @Post()
  async create(
    @Body(new ZodPipe(AlertRuleInput)) b: AlertRuleInput,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    this.check(p, b);
    const [{ n }] = (
      await this.database.db.execute<{ n: string }>(
        sql`select count(*) as n from admin_alert_rule where admin_user_id = ${p.id}`,
      )
    ).rows as [{ n: string }];
    if (Number(n) >= MAX_RULES)
      throw new BadRequestException(`You can have at most ${MAX_RULES} alert rules`);
    const [r] = await this.database.db
      .insert(adminAlertRule)
      .values({
        adminUserId: p.id,
        name: b.name,
        panel: b.panel ?? null,
        metric: b.metric,
        segment: b.segment ?? null,
        comparator: b.comparator,
        threshold: b.threshold,
        window: b.window,
        enabled: b.enabled ?? true,
      })
      .returning();
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'alert_rule.created',
      targetType: 'alert_rule',
      targetId: r!.id,
      panel: b.panel ?? undefined,
      metadata: { ...b },
    });
    return this.view(p, r!);
  }

  @Put(':id')
  async update(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AlertRuleInput)) b: AlertRuleInput,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const before = await this.mine(p, id);
    this.check(p, b);
    const [r] = await this.database.db
      .update(adminAlertRule)
      .set({
        name: b.name,
        panel: b.panel ?? null,
        metric: b.metric,
        segment: b.segment ?? null,
        comparator: b.comparator,
        threshold: b.threshold,
        window: b.window,
        enabled: b.enabled ?? before.enabled,
        updatedAt: new Date(),
      })
      .where(eq(adminAlertRule.id, id))
      .returning();
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'alert_rule.changed',
      targetType: 'alert_rule',
      targetId: id,
      metadata: { before: { ...before, adminUserId: undefined }, after: { ...b } },
    });
    return this.view(p, r!);
  }

  /** Mute a rule for some hours (0 unmutes). */
  @Post(':id/mute')
  @HttpCode(200)
  async mute(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(AlertRuleMute)) b: AlertRuleMute,
    @CurrentPrincipal() p: Principal,
  ) {
    await this.mine(p, id);
    const [r] = await this.database.db
      .update(adminAlertRule)
      .set({ mutedUntil: b.hours ? new Date(Date.now() + b.hours * 3600_000) : null })
      .where(eq(adminAlertRule.id, id))
      .returning();
    return this.view(p, r!);
  }

  @Post(':id/remove')
  @HttpCode(200)
  async remove(
    @Param('id', new ParseUUIDPipe()) id: string,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const r = await this.mine(p, id);
    await this.database.db.delete(adminAlertRule).where(eq(adminAlertRule.id, id));
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'alert_rule.removed',
      targetType: 'alert_rule',
      targetId: id,
      metadata: { name: r.name },
    });
    return { removed: true };
  }
}
