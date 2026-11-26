import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import type { ApiEnv } from '@madp/config';
import type {
  DataMode,
  PanelCode,
  Permission,
  ReportColumn,
  ReportKey,
  ReportParams,
  ReportResult,
} from '@madp/contracts';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import { ConsentService } from '../consent/consent.service.js';
import { VerificationService } from '../verification/verification.service.js';
import { FreshnessService, DEFAULT_STALE_DAYS } from '../profiles/freshness.service.js';
import { LoyaltyService } from '../loyalty/loyalty.service.js';
import { PanelAdminService } from '../panel-admin/panel-admin.service.js';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';

type Row = Record<string, string | number | null>;
interface Ctx {
  mode: DataMode;
  panels: PanelCode[];
  from: Date;
  to: Date;
  /** Exclusive upper bound: the day after `to`. */
  toExclusive: Date;
  permissions: Permission[];
  /** The admin asking, passed to the panel admin API for its own log. */
  actor: string;
}
interface ReportDef {
  key: ReportKey;
  title: string;
  description: string;
  group: 'Audience' | 'Data' | 'Governance' | 'Engagement' | 'Loyalty' | 'Operations';
  /** Needed on top of reports.read to view, and export.read to download. */
  permission: Permission;
  /** Holds personal data: downloading it also needs export.pii. */
  pii: boolean;
  /** Uses the from/to period. */
  period: boolean;
  columns: ReportColumn[];
  run: (ctx: Ctx) => Promise<{ rows: Row[]; notes?: string[] }>;
}

const col = (key: string, label: string, type: ReportColumn['type'] = 'number'): ReportColumn => ({
  key,
  label,
  type,
});
const panelCol = col('panel', 'Panel', 'text');
const n = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));
const iso = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The report registry. Each report is one table, per panel and never added across panels. Other modules add a
 * report by adding an entry here with its own permission. Counts below the minimum cell size are suppressed where a
 * breakdown could single people out.
 */
@Injectable()
export class ReportsService {
  readonly defs: ReportDef[];

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly consent: ConsentService,
    private readonly verification: VerificationService,
    private readonly freshness: FreshnessService,
    private readonly loyalty: LoyaltyService,
    private readonly panelAdmin: PanelAdminService,
  ) {
    const q = async <R extends Row>(query: ReturnType<typeof sql>) =>
      (await this.database.db.execute<R>(query)).rows;
    const minCell = this.env.MIN_CELL_SIZE;
    /**
     * A report read from each panel's admin API (GET /reports/:name). One block of rows per panel, never added
     * across panels. Rows broken down by country have counts below the minimum cell size blanked.
     */
    const fromPanels =
      (
        name: string,
        opts: { countryCounts?: string[]; value?: (rows: Row[], panel: PanelCode) => Promise<Row[]> } = {},
      ) =>
      async (c: Ctx) => {
        const rows: Row[] = [];
        const notes: string[] = [];
        for (const panel of c.panels) {
          if (!this.panelAdmin.configured(panel)) {
            notes.push(
              `${panel.toUpperCase()}: the panel admin API is not connected yet, so there are no rows for it.`,
            );
            continue;
          }
          try {
            const r = await this.panelAdmin.call<{ rows: Row[] }>(panel, c.actor, 'GET', R.report(name), {
              from: iso(c.from),
              to: iso(c.to),
            });
            // A null from the panel means "no value" (for example no guardian replies yet). Only MADP's own small-cell
            // rule below sets null, which the console shows as suppressed.
            let list: Row[] = r.rows.map((x) => ({
              panel,
              ...Object.fromEntries(Object.entries(x).map(([k, v]) => [k, v === null ? '' : v])),
            }));
            if (opts.value) list = await opts.value(list, panel);
            for (const row of list) {
              if (row.country && opts.countryCounts)
                for (const k of opts.countryCounts) if (n(row[k]) > 0 && n(row[k]) < minCell) row[k] = null;
              rows.push(row);
            }
          } catch (e) {
            notes.push(`${panel.toUpperCase()}: the panel did not answer (${(e as Error).message}).`);
          }
        }
        if (opts.countryCounts) notes.push(`Counts below ${minCell} in a country row are left blank.`);
        return { rows, notes };
      };
    const seg = [col('segmentLabel', 'Segment', 'text')];
    this.defs = [
      {
        key: 'audience_by_category',
        title: 'Audience by category',
        description:
          'Active panel accounts and the five audience categories, per panel. A person can be in several categories.',
        group: 'Audience',
        permission: 'audience.counts.read',
        pii: false,
        period: false,
        columns: [
          panelCol,
          col('category', 'Category', 'text'),
          col('people', 'Active people'),
          col('minors', 'Of whom minors'),
        ],
        run: async (c) => ({
          rows: await q(sql`select cm.panel::text as panel, cm.category::text as category,
              count(distinct cm.master_person_id)::int as people,
              count(distinct cm.master_person_id) filter (where cm.is_minor)::int as minors
            from category_membership cm
            join panel_membership pm on pm.master_person_id = cm.master_person_id and pm.panel = cm.panel and pm.status = 'active'
            where cm.data_mode = ${c.mode} and cm.panel = any(${`{${c.panels.join(',')}}`}::text[])
            group by 1, 2 order by 1, 2`),
          notes: ['Categories overlap, so the rows of one panel are not added together.'],
        }),
      },
      {
        key: 'audience_by_country',
        title: 'Audience by country and state',
        description: 'Active members per panel, country and state or province, with small cells suppressed.',
        group: 'Audience',
        permission: 'audience.counts.read',
        pii: false,
        period: false,
        columns: [
          panelCol,
          col('country', 'Country', 'text'),
          col('state', 'State or province', 'text'),
          col('members', 'Active members'),
        ],
        run: async (c) => {
          const rows = await q<{ panel: string; country: string; state: string; members: number }>(sql`
            select pm.panel::text as panel, coalesce(nullif(si.country, ''), 'Unknown') as country,
              coalesce(nullif(si.state, ''), 'Unknown') as state, count(*)::int as members
            from panel_membership pm join source_identity si on si.id = pm.source_identity_id
            where pm.data_mode = ${c.mode} and pm.status = 'active' and pm.panel = any(${`{${c.panels.join(',')}}`}::text[])
            group by 1, 2, 3 order by 1, 4 desc, 2, 3`);
          let hidden = 0;
          const out = rows.map((r) => {
            if (minCell > 0 && r.members < minCell) {
              hidden++;
              return { ...r, members: null };
            }
            return r;
          });
          return {
            rows: out,
            notes: hidden
              ? [
                  `${hidden} rows with fewer than ${minCell} members are left blank so nobody can be singled out.`,
                ]
              : [],
          };
        },
      },
      {
        key: 'consent_funnel',
        title: 'Consent and reachability funnel',
        description: 'Who MADP may e-mail today, step by step, and the opt-outs members asked MADP for.',
        group: 'Governance',
        permission: 'consent.read',
        pii: false,
        period: false,
        columns: [
          panelCol,
          col('memberships', 'Panel accounts'),
          col('active', 'Active'),
          col('adults', 'Adults'),
          col('termsAccepted', 'Terms accepted'),
          col('usableAddress', 'Usable e-mail'),
          col('notOptedOut', 'Not opted out'),
          col('reachable', 'Reachable'),
          col('madpOptOuts', 'Opt-outs recorded in MADP'),
        ],
        run: async (c) => {
          const rows: Row[] = [];
          const notes: string[] = [];
          for (const p of c.panels) {
            const s = await this.consent.summary(c.mode, p);
            const x = s.panels[0]!;
            rows.push({
              panel: p,
              ...x.contactable,
              madpOptOuts: Object.values(x.madpOptOuts).reduce((a, b) => a + b, 0),
            });
            notes.push(...x.gaps);
          }
          return { rows, notes };
        },
      },
      {
        key: 'data_quality',
        title: 'Data quality checks',
        description: 'MADP checks on active members and source-reported verification, per panel.',
        group: 'Data',
        permission: 'verification.read',
        pii: false,
        period: false,
        columns: [
          panelCol,
          col('check', 'Check', 'text'),
          col('members', 'Members'),
          col('share', 'Share of active (%)'),
        ],
        run: async (c) => {
          const s = await this.verification.summary(c.mode, c.panels);
          const rows: Row[] = [];
          for (const p of s.panels) {
            const share = (x: number) => (p.members ? Math.round((x / p.members) * 1000) / 10 : null);
            rows.push({
              panel: p.panel,
              check: 'E-mail verified (panel)',
              members: p.sourceReported.email.verified,
              share: share(p.sourceReported.email.verified),
            });
            rows.push({
              panel: p.panel,
              check: 'Phone verified (panel)',
              members: p.sourceReported.phone.verified,
              share: share(p.sourceReported.phone.verified),
            });
            for (const ch of s.checks)
              rows.push({
                panel: p.panel,
                check: ch.label,
                members: p.checks[ch.key] ?? 0,
                share: share(p.checks[ch.key] ?? 0),
              });
          }
          return { rows };
        },
      },
      {
        key: 'profile_freshness',
        title: 'Profile completion and freshness',
        description: 'Profiling coverage and members due for their 6-month check, per panel.',
        group: 'Data',
        permission: 'audience.counts.read',
        pii: false,
        period: false,
        columns: [
          panelCol,
          col('activeMemberships', 'Active accounts'),
          col('questionBank', 'Questions in bank'),
          col('membersWithAnswers', 'With any answer'),
          col('neverProfiled', 'Never profiled'),
          col('dueForCheck', `Due for check (${DEFAULT_STALE_DAYS} days)`),
        ],
        run: async (c) => {
          const r = await this.freshness.report(c.mode, {
            staleDays: DEFAULT_STALE_DAYS,
            healthAllowed: c.permissions.includes('health.sensitive.read'),
          });
          return {
            rows: r.panels
              .filter((p) => c.panels.includes(p.panel))
              .map((p) => ({
                panel: p.panel,
                activeMemberships: p.activeMemberships,
                questionBank: p.questionBank,
                membersWithAnswers: p.membersWithAnswers,
                neverProfiled: p.neverProfiled,
                dueForCheck: p.dueForCheck,
              })),
          };
        },
      },
      {
        key: 'loyalty_liability',
        title: 'Loyalty liability',
        description:
          'Points owed per panel and their value at each brand’s points rate. Wallets are never added across panels.',
        group: 'Loyalty',
        permission: 'loyalty.read',
        pii: false,
        period: false,
        columns: [
          panelCol,
          col('accounts', 'Wallets'),
          col('approved', 'Approved points'),
          col('pending', 'Pending points'),
          col('redeemed', 'Redeemed points'),
          col('pointsPerUnit', 'Points per currency unit'),
          col('currency', 'Currency', 'text'),
          col('outstandingValue', 'Outstanding value', 'money'),
        ],
        run: async (c) => {
          const l = await this.loyalty.liability(c.mode);
          const rates = await q<{ panel: string; currency: string; rate: number }>(sql`
            select panel::text as panel, currency, points_per_currency_unit as rate from brand_setting`);
          return {
            rows: c.panels.map((p) => {
              const x = l.panels.find((y) => y.panel === p);
              const r = rates.find((y) => y.panel === p);
              const rate = r?.rate ?? 1000;
              const approved = x?.approved ?? 0;
              return {
                panel: p,
                accounts: x?.accounts ?? 0,
                approved,
                pending: x?.pending ?? 0,
                redeemed: x?.redeemed ?? 0,
                pointsPerUnit: rate,
                currency: r?.currency ?? 'USD',
                outstandingValue: Math.round((approved / rate) * 100) / 100,
              };
            }),
            notes: [
              l.note,
              'Values use each brand’s points rate from Brands & settings (1,000 points = 1 USD unless changed).',
            ],
          };
        },
      },
      {
        key: 'communication_delivery',
        title: 'Campaign delivery',
        description:
          'Messages per campaign or automation and their delivery states in the period. Dry runs are shown apart.',
        group: 'Engagement',
        permission: 'communications.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          col('source', 'Campaign or automation', 'text'),
          col('channel', 'Channel', 'text'),
          col('dryRun', 'Dry run', 'text'),
          col('planned', 'Planned'),
          col('suppressed', 'Suppressed'),
          col('sent', 'Sent'),
          col('delivered', 'Delivered'),
          col('bounced', 'Bounced'),
          col('opened', 'Opened'),
          col('clicked', 'Clicked'),
          col('optedOut', 'Opted out'),
        ],
        run: async (c) => ({
          rows: await q(sql`select ce.panel::text as panel,
              coalesce(cp.name, a.name, 'Other') as source, ce.channel,
              case when ce.dry_run then 'yes' else 'no' end as "dryRun",
              count(*) filter (where ce.state = 'planned')::int as planned,
              count(*) filter (where ce.state = 'suppressed')::int as suppressed,
              count(*) filter (where ce.state = 'sent')::int as sent,
              count(*) filter (where ce.state = 'delivered')::int as delivered,
              count(*) filter (where ce.state = 'bounced')::int as bounced,
              count(*) filter (where ce.state = 'opened')::int as opened,
              count(*) filter (where ce.state = 'clicked')::int as clicked,
              count(*) filter (where ce.state = 'opted_out')::int as "optedOut"
            from communication_event ce
            left join campaign cp on cp.id = ce.campaign_id
            left join automation a on a.id = ce.automation_id
            where ce.data_mode = ${c.mode} and ce.panel = any(${`{${c.panels.join(',')}}`}::text[])
              and ce.occurred_at >= ${c.from} and ce.occurred_at < ${c.toExclusive}
            group by 1, 2, 3, 4 order by 1, 2, 3, 4`),
          notes: [
            'No e-mail provider is connected yet, so only dry runs and suppressions appear until sending is approved.',
          ],
        }),
      },
      {
        key: 'privacy_sla',
        title: 'Privacy requests and deadlines',
        description: 'Requests received in the period by kind and status, with those past their due date.',
        group: 'Governance',
        permission: 'privacy.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          col('kind', 'Kind', 'text'),
          col('status', 'Status', 'text'),
          col('requests', 'Requests'),
          col('overdue', 'Overdue'),
        ],
        run: async (c) => ({
          rows: await q(sql`select p.panel, r.kind, r.status, count(*)::int as requests,
              count(*) filter (where r.status not in ('completed', 'rejected') and r.due_at < now())::int as overdue
            from privacy_request r cross join lateral unnest(r.panels) as p(panel)
            where r.data_mode = ${c.mode} and p.panel = any(${`{${c.panels.join(',')}}`}::text[])
              and r.received_at >= ${c.from} and r.received_at < ${c.toExclusive}
            group by 1, 2, 3 order by 1, 2, 3`),
          notes: ['A request that covers two panels appears under each of them.'],
        }),
      },
      {
        key: 'sync_health',
        title: 'Sync and import health',
        description: 'Import and sync runs per panel in the period, failures, and the last successful run.',
        group: 'Operations',
        permission: 'connectors.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          col('kind', 'Run', 'text'),
          col('runs', 'Runs'),
          col('succeeded', 'Succeeded'),
          col('failed', 'Failed'),
          col('lastSuccess', 'Last success', 'date'),
        ],
        run: async (c) => ({
          rows: await q(sql`select panel::text as panel, kind, count(*)::int as runs,
              count(*) filter (where status = 'succeeded')::int as succeeded,
              count(*) filter (where status = 'failed')::int as failed,
              to_char(max(finished_at) filter (where status = 'succeeded') at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as "lastSuccess"
            from import_job where data_mode = ${c.mode} and not dry_run and panel = any(${`{${c.panels.join(',')}}`}::text[])
              and coalesce(started_at, finished_at) >= ${c.from} and coalesce(started_at, finished_at) < ${c.toExclusive}
            group by 1, 2 order by 1, 2`),
        }),
      },
      // ---- step 5: the super admin spec's reports, from each panel ----------------------------------------------
      {
        key: 'panel_health',
        title: 'Panel health',
        description:
          'Members, active in the last 30 days, new sign-ups in the period and archived, by segment and country.',
        group: 'Audience',
        permission: 'reports.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          ...seg,
          col('country', 'Country', 'text'),
          col('total', 'Members'),
          col('active30', 'Active in 30 days'),
          col('newInPeriod', 'New in period'),
          col('archived', 'Archived'),
        ],
        run: fromPanels('panel_health', { countryCounts: ['total', 'active30', 'newInPeriod', 'archived'] }),
      },
      {
        key: 'signup_funnel',
        title: 'Sign-up funnel',
        description:
          'Members who registered in the period and how many verified their e-mail, gave consent, finished a first profile and a first survey.',
        group: 'Audience',
        permission: 'reports.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          ...seg,
          col('source', 'Source', 'text'),
          col('registered', 'Registered'),
          col('verifiedEmail', 'Verified e-mail'),
          col('consent', 'Consent'),
          col('firstProfile', 'First profile'),
          col('firstSurvey', 'First survey'),
        ],
        run: fromPanels('signup_funnel'),
      },
      {
        key: 'teen_pipeline',
        title: 'Teen pipeline',
        description:
          'Teen registrations at each of the eleven statuses, now and for those started in the period, with the median guardian reply time.',
        group: 'Governance',
        permission: 'teen.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          col('status', 'Status', 'text'),
          col('now', 'Now'),
          col('startedInPeriod', 'Started in period'),
          col('medianGuardianReplyHours', 'Median guardian reply (hours)'),
          col('guardianReplies', 'Guardian replies'),
        ],
        run: fromPanels('teen_pipeline'),
      },
      {
        key: 'profile_completion',
        title: 'Profile completion',
        description:
          'Per profile: members who started and finished it, and the question where most members stop.',
        group: 'Data',
        permission: 'reports.read',
        pii: false,
        period: false,
        columns: [
          panelCol,
          col('name', 'Profile', 'text'),
          col('segment', 'Segment', 'text'),
          col('questions', 'Questions'),
          col('started', 'Started'),
          col('finished', 'Finished'),
          col('completionRate', 'Finished (%)'),
          col('dropOffQuestion', 'Drop-off question', 'text'),
          col('dropOffMembers', 'Members lost there'),
        ],
        run: fromPanels('profile_completion'),
      },
      {
        key: 'survey_performance',
        title: 'Survey performance',
        description:
          'Per survey with activity in the period: invites, starts, completes, screen-outs, over quota, incidence and length.',
        group: 'Operations',
        permission: 'reports.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          col('name', 'Survey', 'text'),
          col('status', 'Status', 'text'),
          col('invites', 'Invites'),
          col('starts', 'Starts'),
          col('completes', 'Completes'),
          col('screenOuts', 'Screen-outs'),
          col('overQuota', 'Over quota'),
          col('incidence', 'Incidence (%)'),
          col('loi', 'LOI (min)'),
          col('pointsPaid', 'Points paid'),
        ],
        run: fromPanels('survey_performance'),
      },
      {
        key: 'points_by_segment',
        title: 'Points and liability by segment',
        description:
          'Points issued and redeemed each month, and what is still unspent at month end with its value at the brand’s points rate.',
        group: 'Loyalty',
        permission: 'reports.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          ...seg,
          col('month', 'Month', 'text'),
          col('issued', 'Issued'),
          col('redeemed', 'Redeemed'),
          col('unspentAtMonthEnd', 'Unspent at month end'),
          col('unspentValue', 'Unspent value', 'money'),
          col('currency', 'Currency', 'text'),
          col('entriesOnHoldNow', 'Entries on hold now'),
        ],
        run: fromPanels('points_liability', {
          value: async (rows, panel) => {
            const [r] = await q<{ currency: string; rate: number }>(sql`
              select currency, points_per_currency_unit as rate from brand_setting where panel = ${panel}`);
            const rate = r?.rate ?? 1000;
            return rows.map((x) => ({
              ...x,
              unspentValue: Math.round((n(x.unspentAtMonthEnd) / rate) * 100) / 100,
              currency: r?.currency ?? 'USD',
            }));
          },
        }),
      },
      {
        key: 'redemptions',
        title: 'Redemptions',
        description:
          'Redemptions requested in the period by payout method and country: approved, paid, rejected and average days to pay.',
        group: 'Loyalty',
        permission: 'reports.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          col('method', 'Method', 'text'),
          col('country', 'Country', 'text'),
          col('requested', 'Requested'),
          col('approved', 'Approved'),
          col('paid', 'Paid'),
          col('rejected', 'Rejected'),
          col('waiting', 'Waiting'),
          col('points', 'Points'),
          col('avgDaysToPay', 'Average days to pay'),
        ],
        run: fromPanels('redemptions', {
          countryCounts: ['requested', 'approved', 'paid', 'rejected', 'waiting'],
        }),
      },
      {
        key: 'quality',
        title: 'Quality',
        description: 'Quality score spread (0 to 200), and members flagged below 60, by segment and country.',
        group: 'Data',
        permission: 'reports.read',
        pii: false,
        period: false,
        columns: [
          panelCol,
          ...seg,
          col('country', 'Country', 'text'),
          col('members', 'Members'),
          col('score0to49', 'Score 0-49'),
          col('score50to99', 'Score 50-99'),
          col('score100to149', 'Score 100-149'),
          col('score150to200', 'Score 150-200'),
          col('flaggedBelow60', 'Flagged (below 60)'),
        ],
        run: fromPanels('quality', {
          countryCounts: [
            'members',
            'score0to49',
            'score50to99',
            'score100to149',
            'score150to200',
            'flaggedBelow60',
          ],
        }),
      },
      {
        key: 'referrals',
        title: 'Referrals',
        description:
          'Members who joined from a referral each month, how many verified and finished a first survey, and referrers that look suspicious now.',
        group: 'Engagement',
        permission: 'reports.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          col('month', 'Month', 'text'),
          col('joins', 'Joins'),
          col('verifiedEmail', 'Verified e-mail'),
          col('firstSurvey', 'First survey'),
          col('referrers', 'Referrers'),
          col('suspectedReferrersNow', 'Suspected referrers now'),
        ],
        run: fromPanels('referrals'),
      },
      {
        key: 'support',
        title: 'Support',
        description:
          'Tickets opened in the period by topic and agent: still open, resolved and average first reply time.',
        group: 'Operations',
        permission: 'reports.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          col('topic', 'Topic', 'text'),
          col('agent', 'Agent', 'text'),
          col('opened', 'Opened'),
          col('open', 'Still open'),
          col('resolved', 'Resolved'),
          col('replied', 'Replied'),
          col('avgFirstReplyHours', 'Average first reply (hours)'),
        ],
        run: fromPanels('support'),
      },
      {
        key: 'engagement',
        title: 'Engagement',
        description:
          'Daily poll answers, members with streak days and monthly challenges done, by segment and month.',
        group: 'Engagement',
        permission: 'reports.read',
        pii: false,
        period: true,
        columns: [
          panelCol,
          ...seg,
          col('month', 'Month', 'text'),
          col('pollAnswers', 'Poll answers'),
          col('membersWithStreakDays', 'Members with streak days'),
          col('streakDays', 'Streak days'),
          col('challengesDone', 'Challenges done'),
          col('challengePoints', 'Challenge points'),
        ],
        run: fromPanels('engagement'),
      },
    ];
  }

  def(key: ReportKey) {
    return this.defs.find((d) => d.key === key)!;
  }

  /** The catalogue, with whether this admin may view and download each report. */
  catalogue(permissions: Permission[]) {
    return this.defs.map((d) => ({
      key: d.key,
      title: d.title,
      description: d.description,
      group: d.group,
      period: d.period,
      pii: d.pii,
      canView: permissions.includes(d.permission),
      canExport:
        permissions.includes(d.permission) &&
        permissions.includes('export.read') &&
        (!d.pii || permissions.includes('export.pii')),
    }));
  }

  async run(
    mode: DataMode,
    key: ReportKey,
    panels: PanelCode[],
    p: ReportParams,
    permissions: Permission[],
    actor = 'madp-reports',
  ): Promise<ReportResult> {
    const d = this.def(key);
    if (!permissions.includes(d.permission))
      throw new ForbiddenException(`This report needs ${d.permission}`);
    const today = new Date(`${iso(new Date())}T00:00:00Z`);
    const to = p.to ? new Date(`${p.to}T00:00:00Z`) : today;
    const from = p.from ? new Date(`${p.from}T00:00:00Z`) : new Date(to.getTime() - 29 * 86_400_000);
    const toExclusive = new Date(to.getTime() + 86_400_000);
    const r = await d.run({ mode, panels, from, to, toExclusive, permissions, actor });
    return {
      key,
      title: d.title,
      dataMode: mode,
      generatedAt: new Date().toISOString(),
      period: d.period ? { from: iso(from), to: iso(to) } : null,
      columns: d.columns,
      // A field a row does not carry is empty, not suppressed: only a null means "too few people to show".
      rows: r.rows.map((row) => {
        const out = { ...row };
        for (const c of d.columns) if (out[c.key] === undefined) out[c.key] = '';
        return out;
      }),
      notes: r.notes ?? [],
    };
  }
}
