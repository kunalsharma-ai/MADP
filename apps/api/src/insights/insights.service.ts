import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { DataMode, InsightDecision, InsightQuery, InsightRule, PanelCode } from '@madp/contracts';
import { Database } from '../db/database.js';
import { insights } from '../db/schema.js';
import { AuditService, type AuditEntry } from '../audit/audit.service.js';
import { ConsentService } from '../consent/consent.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { DEFAULT_STALE_DAYS, FreshnessService } from '../profiles/freshness.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';

type Severity = 'info' | 'warning' | 'critical';
interface Finding {
  rule: InsightRule;
  severity: Severity;
  title: string;
  detail: string;
  recommendation: string;
  link: string | null;
  evidence: Record<string, number | string | null>;
}
type Actor = Pick<AuditEntry, 'actorId' | 'actorType' | 'actorRole' | 'ip' | 'userAgent' | 'requestId'>;

/** A decided insight is not raised again for this long, unless it is resolved and fires anew later. */
const QUIET_DAYS = 7;
const share = (n: number, d: number) => (d ? n / d : 0);
const pct = (x: number) => `${Math.round(x * 100)}%`;

/**
 * Rule-based insights (screen 34). Each rule reads MADP's own per-panel counts and, when it fires, proposes one
 * action with the numbers behind it. Nothing is acted on automatically, no AI model is called, and no personal data
 * is stored: evidence holds counts and shares only.
 */
@Injectable()
export class InsightsService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
    private readonly consent: ConsentService,
    private readonly verification: VerificationService,
    private readonly freshness: FreshnessService,
    private readonly loyalty: LoyaltyService,
  ) {}

  /** Thresholds, shown on the screen so every insight can be explained. */
  static readonly RULES: Record<InsightRule, string> = {
    low_reachability: 'Fewer than 50% of active members can be e-mailed today.',
    profiles_due_for_check: `More than 40% of profiled members have answers older than ${DEFAULT_STALE_DAYS} days.`,
    never_profiled: 'More than 10% of active members have no profile answers.',
    quality_below_default: 'More than 25% of active members have a quality score below 100.',
    shared_emails: 'Two or more members of the same panel share an e-mail address.',
    identity_review_backlog: 'Identity matches are waiting for a person to review them.',
    pending_mappings: 'Source questions are waiting for a mapping decision.',
    pending_survey_points: 'More points are pending client approval than are approved.',
    sync_stale: 'No successful sync in the last 24 hours.',
    sync_failures: 'A sync or import failed in the last 7 days.',
    privacy_overdue: 'A privacy request is past its due date.',
    evidence_expiring: 'Verified evidence expires within 30 days.',
  };

  async findings(mode: DataMode, panel: PanelCode): Promise<Finding[]> {
    const out: Finding[] = [];
    const db = this.database.db;
    const one = async <R extends Record<string, unknown>>(q: ReturnType<typeof sql>) => (await db.execute<R>(q)).rows[0]!;

    const consent = (await this.consent.summary(mode, panel)).panels[0]!.contactable;
    const reach = share(consent.reachable, consent.active);
    if (consent.active > 0 && reach < 0.5)
      out.push({
        rule: 'low_reachability',
        severity: reach < 0.25 ? 'critical' : 'warning',
        title: `Only ${pct(reach)} of active members can be e-mailed`,
        detail: `${consent.reachable} of ${consent.active} active members are adults with accepted terms, a usable address, no opt-out and no bounce.`,
        recommendation: 'Check which funnel step loses the most members in Consent & preferences, and ask the panel to collect the missing consent.',
        link: '/consent',
        evidence: { active: consent.active, reachable: consent.reachable, termsAccepted: consent.termsAccepted, usableAddress: consent.usableAddress },
      });

    const fresh = (await this.freshness.report(mode, { panel, staleDays: DEFAULT_STALE_DAYS, healthAllowed: false })).panels[0]!;
    const due = share(fresh.dueForCheck, fresh.membersWithAnswers);
    if (fresh.membersWithAnswers > 0 && due > 0.4)
      out.push({
        rule: 'profiles_due_for_check',
        severity: due > 0.7 ? 'critical' : 'warning',
        title: `${pct(due)} of profiles are due for their 6-month check`,
        detail: `${fresh.dueForCheck} of ${fresh.membersWithAnswers} profiled members last answered more than ${DEFAULT_STALE_DAYS} days ago.`,
        recommendation: 'Schedule a "Still true?" profile review for these members from the super admin console, then watch Profile freshness.',
        link: '/freshness',
        evidence: { dueForCheck: fresh.dueForCheck, membersWithAnswers: fresh.membersWithAnswers, staleDays: DEFAULT_STALE_DAYS },
      });
    const never = share(fresh.neverProfiled, fresh.activeMemberships);
    if (fresh.activeMemberships > 0 && never > 0.1)
      out.push({
        rule: 'never_profiled',
        severity: 'info',
        title: `${pct(never)} of active members were never profiled`,
        detail: `${fresh.neverProfiled} of ${fresh.activeMemberships} active members have no profile answers, so they cannot be targeted by attribute.`,
        recommendation: 'Plan a welcome-profile reminder for these members in Lifecycle automations (dry run first).',
        link: '/communications/automations',
        evidence: { neverProfiled: fresh.neverProfiled, active: fresh.activeMemberships },
      });

    const v = (await this.verification.summary(mode, [panel])).panels[0]!;
    const low = share(v.checks.quality_below_default ?? 0, v.members);
    if (v.members > 0 && low > 0.25)
      out.push({
        rule: 'quality_below_default',
        severity: 'warning',
        title: `${pct(low)} of members have a quality score below 100`,
        detail: `${v.checks.quality_below_default} of ${v.members} active members lost quality points on the panel.`,
        recommendation: 'Review the lowest scores in Verification & quality and decide with the panel whether to exclude them from invitations.',
        link: `/verification?panel=${panel}&check=quality_below_default#members`,
        evidence: { below: v.checks.quality_below_default ?? 0, members: v.members },
      });
    if ((v.checks.shared_email_in_panel ?? 0) > 0)
      out.push({
        rule: 'shared_emails',
        severity: 'warning',
        title: `${v.checks.shared_email_in_panel} members share an e-mail address with another member`,
        detail: 'Two accounts with one address in the same panel are often duplicates and can be invited twice.',
        recommendation: 'Look at these members in Verification & quality and ask the panel to merge or close duplicates.',
        link: `/verification?panel=${panel}&check=shared_email_in_panel#members`,
        evidence: { members: v.checks.shared_email_in_panel ?? 0 },
      });
    if (v.identityReviewOpen > 0)
      out.push({
        rule: 'identity_review_backlog',
        severity: v.identityReviewOpen > 50 ? 'warning' : 'info',
        title: `${v.identityReviewOpen} identity matches wait for review`,
        detail: 'Until they are decided, the same person may be counted twice across panels.',
        recommendation: 'Work through the queue in Identity review.',
        link: '/identity',
        evidence: { pending: v.identityReviewOpen },
      });

    const m = await one<{ n: string }>(sql`select count(*) as n from source_question_mapping
      where data_mode = ${mode} and panel = ${panel} and status = 'pending'`);
    if (Number(m.n) > 0)
      out.push({
        rule: 'pending_mappings',
        severity: 'info',
        title: `${m.n} source questions wait for a mapping decision`,
        detail: 'Unmapped questions cannot be used in attribute filters or Supply360 counts.',
        recommendation: 'Decide them in the Mapping workbench. Suggestions never count until a person approves them.',
        link: `/mappings?panel=${panel}`,
        evidence: { pending: Number(m.n) },
      });

    const l = (await this.loyalty.liability(mode, panel)).panels.find((x) => x.panel === panel);
    if (l && l.pending > l.approved && l.pending > 0)
      out.push({
        rule: 'pending_survey_points',
        severity: 'info',
        title: 'More survey points are pending than approved',
        detail: `${l.pending} points wait for client approval against ${l.approved} approved.`,
        recommendation: 'Chase the client approvals listed in the Loyalty ledger; members see pending points as unpaid.',
        link: '/loyalty',
        evidence: { pending: l.pending, approved: l.approved },
      });

    const s = await one<{ last_ok: Date | null; failed: string }>(sql`
      select max(finished_at) filter (where status = 'succeeded') as last_ok,
        count(*) filter (where status = 'failed' and coalesce(finished_at, started_at) > now() - interval '7 days') as failed
      from import_job where data_mode = ${mode} and panel = ${panel} and not dry_run`);
    const hours = s.last_ok ? (Date.now() - new Date(s.last_ok).getTime()) / 3_600_000 : null;
    if (hours === null || hours > 24)
      out.push({
        rule: 'sync_stale',
        severity: hours === null || hours > 72 ? 'critical' : 'warning',
        title: hours === null ? 'This panel has never synced' : `Last successful sync was ${Math.round(hours)} hours ago`,
        detail: 'Counts, consent and opt-outs may be out of date until the next successful sync.',
        recommendation: 'Check the connector health and run a sync from Connectors & sync.',
        link: '/connectors',
        evidence: { hoursSinceSuccess: hours === null ? null : Math.round(hours) },
      });
    if (Number(s.failed) > 0)
      out.push({
        rule: 'sync_failures',
        severity: 'warning',
        title: `${s.failed} sync or import runs failed this week`,
        detail: 'Failed runs leave changes from the panel unapplied until a later run succeeds.',
        recommendation: 'Open Connectors & sync to read the errors and retry dead letters.',
        link: '/connectors',
        evidence: { failed: Number(s.failed) },
      });

    const p = await one<{ n: string }>(sql`select count(*) as n from privacy_request
      where data_mode = ${mode} and ${panel} = any(panels) and status not in ('completed', 'rejected') and due_at < now()`);
    if (Number(p.n) > 0)
      out.push({
        rule: 'privacy_overdue',
        severity: 'critical',
        title: `${p.n} privacy requests are past their due date`,
        detail: 'Answering late can breach the deadline counsel set for the jurisdiction.',
        recommendation: 'Verify and carry out these requests in Privacy requests today.',
        link: '/privacy',
        evidence: { overdue: Number(p.n) },
      });

    const e = await one<{ n: string }>(sql`select count(*) as n from verification_evidence
      where data_mode = ${mode} and panel = ${panel} and status = 'verified'
        and expires_on >= current_date and expires_on < current_date + 30`);
    if (Number(e.n) > 0)
      out.push({
        rule: 'evidence_expiring',
        severity: 'info',
        title: `${e.n} verified checks expire within 30 days`,
        detail: 'Expired licence or identity checks stop counting as independently verified.',
        recommendation: 'Ask these members for renewed proof and record the new check in Verification & quality.',
        link: '/verification',
        evidence: { expiring: Number(e.n) },
      });
    return out;
  }

  /** Recomputes every rule for the panels and stores the result. Returns what changed. */
  async refresh(mode: DataMode, panels: PanelCode[], actor: Actor) {
    const db = this.database.db;
    let raised = 0;
    let updated = 0;
    let resolved = 0;
    for (const panel of panels) {
      const found = await this.findings(mode, panel);
      const fired = new Set(found.map((f) => f.rule));
      for (const f of found) {
        const [open] = await db
          .select({ id: insights.id })
          .from(insights)
          .where(and(eq(insights.dataMode, mode), eq(insights.panel, panel), eq(insights.rule, f.rule), eq(insights.status, 'open')));
        if (open) {
          await db
            .update(insights)
            .set({ severity: f.severity, title: f.title, detail: f.detail, recommendation: f.recommendation, link: f.link, evidence: f.evidence, lastSeenAt: new Date() })
            .where(eq(insights.id, open.id));
          updated++;
          continue;
        }
        const [recent] = await db
          .select({ id: insights.id })
          .from(insights)
          .where(
            and(
              eq(insights.dataMode, mode),
              eq(insights.panel, panel),
              eq(insights.rule, f.rule),
              inArray(insights.status, ['accepted', 'dismissed']),
              sql`${insights.decidedAt} > now() - make_interval(days => ${QUIET_DAYS})`,
            ),
          )
          .limit(1);
        if (recent) continue;
        await db.insert(insights).values({ dataMode: mode, panel, ...f });
        raised++;
      }
      const stale = await db
        .update(insights)
        .set({ status: 'resolved', decidedAt: new Date(), decisionNote: 'The rule no longer fires.' })
        .where(
          and(
            eq(insights.dataMode, mode),
            eq(insights.panel, panel),
            eq(insights.status, 'open'),
            fired.size ? sql`${insights.rule} <> all(${`{${[...fired].join(',')}}`}::text[])` : sql`true`,
          ),
        )
        .returning({ id: insights.id });
      resolved += stale.length;
    }
    await this.audit.record({ ...actor, action: 'insights.refreshed', metadata: { panels, raised, updated, resolved } });
    return { raised, updated, resolved };
  }

  async list(mode: DataMode, panels: PanelCode[], q: InsightQuery) {
    const where = [eq(insights.dataMode, mode), inArray(insights.panel, panels)];
    if (q.status) where.push(eq(insights.status, q.status));
    const items = await this.database.db
      .select()
      .from(insights)
      .where(and(...where))
      .orderBy(
        sql`(${insights.status} = 'open') desc`,
        sql`case ${insights.severity} when 'critical' then 0 when 'warning' then 1 else 2 end`,
        desc(insights.lastSeenAt),
      )
      .limit(q.limit);
    const [last] = (
      await this.database.db.execute<{ at: Date | null }>(sql`select max(at) as at from audit_event where action = 'insights.refreshed'`)
    ).rows;
    return { dataMode: mode, lastRefreshedAt: last?.at ?? null, rules: InsightsService.RULES, items };
  }

  async decide(id: string, panels: PanelCode[], b: InsightDecision, actor: Actor) {
    const [row] = await this.database.db.select().from(insights).where(eq(insights.id, id));
    if (!row || !panels.includes(row.panel)) throw new NotFoundException('No such insight');
    const [done] = await this.database.db
      .update(insights)
      .set({ status: b.decision, decidedBy: actor.actorId, decidedAt: new Date(), decisionNote: b.note })
      .where(and(eq(insights.id, id), eq(insights.status, 'open')))
      .returning();
    if (!done) throw new ConflictException(`Already ${row.status}`);
    await this.audit.record({
      ...actor,
      panel: row.panel,
      action: `insight.${b.decision}`,
      targetType: 'insight',
      targetId: id,
      before: { status: 'open' },
      after: { status: b.decision },
      metadata: { rule: row.rule },
    });
    return done;
  }
}
