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

type Row = Record<string, string | number | null>;
interface Ctx {
  mode: DataMode;
  panels: PanelCode[];
  from: Date;
  to: Date;
  /** Exclusive upper bound: the day after `to`. */
  toExclusive: Date;
  permissions: Permission[];
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

const col = (key: string, label: string, type: ReportColumn['type'] = 'number'): ReportColumn => ({ key, label, type });
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
  ) {
    const q = async <R extends Row>(query: ReturnType<typeof sql>) =>
      (await this.database.db.execute<R>(query)).rows;
    const minCell = this.env.MIN_CELL_SIZE;
    this.defs = [
      {
        key: 'audience_by_category',
        title: 'Audience by category',
        description: 'Active panel accounts and the five audience categories, per panel. A person can be in several categories.',
        group: 'Audience',
        permission: 'audience.counts.read',
        pii: false,
        period: false,
        columns: [panelCol, col('category', 'Category', 'text'), col('people', 'Active people'), col('minors', 'Of whom minors')],
        run: async (c) => ({
          rows: await q(sql`select cm.panel::text as panel, cm.category::text as category,
              count(distinct cm.master_person_id)::int as people,
              count(distinct cm.master_person_id) filter (where cm.is_minor)::int as minors
            from category_membership cm
            join panel_membership pm on pm.master_person_id = cm.master_person_id and pm.panel = cm.panel and pm.status = 'active'
            where cm.data_mode = ${c.mode} and cm.panel = any(${`{${c.panels.join(',')}}`}::panel_code[])
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
        columns: [panelCol, col('country', 'Country', 'text'), col('state', 'State or province', 'text'), col('members', 'Active members')],
        run: async (c) => {
          const rows = await q<{ panel: string; country: string; state: string; members: number }>(sql`
            select pm.panel::text as panel, coalesce(nullif(si.country, ''), 'Unknown') as country,
              coalesce(nullif(si.state, ''), 'Unknown') as state, count(*)::int as members
            from panel_membership pm join source_identity si on si.id = pm.source_identity_id
            where pm.data_mode = ${c.mode} and pm.status = 'active' and pm.panel = any(${`{${c.panels.join(',')}}`}::panel_code[])
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
            notes: hidden ? [`${hidden} rows with fewer than ${minCell} members are left blank so nobody can be singled out.`] : [],
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
            rows.push({ panel: p, ...x.contactable, madpOptOuts: Object.values(x.madpOptOuts).reduce((a, b) => a + b, 0) });
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
        columns: [panelCol, col('check', 'Check', 'text'), col('members', 'Members'), col('share', 'Share of active (%)')],
        run: async (c) => {
          const s = await this.verification.summary(c.mode, c.panels);
          const rows: Row[] = [];
          for (const p of s.panels) {
            const share = (x: number) => (p.members ? Math.round((x / p.members) * 1000) / 10 : null);
            rows.push({ panel: p.panel, check: 'E-mail verified (panel)', members: p.sourceReported.email.verified, share: share(p.sourceReported.email.verified) });
            rows.push({ panel: p.panel, check: 'Phone verified (panel)', members: p.sourceReported.phone.verified, share: share(p.sourceReported.phone.verified) });
            for (const ch of s.checks) rows.push({ panel: p.panel, check: ch.label, members: p.checks[ch.key] ?? 0, share: share(p.checks[ch.key] ?? 0) });
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
        description: 'Points owed per panel and their value at each brand’s points rate. Wallets are never added across panels.',
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
            notes: [l.note, 'Values use each brand’s points rate from Brands & settings (1,000 points = 1 USD unless changed).'],
          };
        },
      },
      {
        key: 'communication_delivery',
        title: 'Campaign delivery',
        description: 'Messages per campaign or automation and their delivery states in the period. Dry runs are shown apart.',
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
            where ce.data_mode = ${c.mode} and ce.panel = any(${`{${c.panels.join(',')}}`}::panel_code[])
              and ce.occurred_at >= ${c.from} and ce.occurred_at < ${c.toExclusive}
            group by 1, 2, 3, 4 order by 1, 2, 3, 4`),
          notes: ['No e-mail provider is connected yet, so only dry runs and suppressions appear until sending is approved.'],
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
        columns: [panelCol, col('kind', 'Kind', 'text'), col('status', 'Status', 'text'), col('requests', 'Requests'), col('overdue', 'Overdue')],
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
            from import_job where data_mode = ${c.mode} and not dry_run and panel = any(${`{${c.panels.join(',')}}`}::panel_code[])
              and coalesce(started_at, finished_at) >= ${c.from} and coalesce(started_at, finished_at) < ${c.toExclusive}
            group by 1, 2 order by 1, 2`),
        }),
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
      canExport: permissions.includes(d.permission) && permissions.includes('export.read') && (!d.pii || permissions.includes('export.pii')),
    }));
  }

  async run(mode: DataMode, key: ReportKey, panels: PanelCode[], p: ReportParams, permissions: Permission[]): Promise<ReportResult> {
    const d = this.def(key);
    if (!permissions.includes(d.permission)) throw new ForbiddenException(`This report needs ${d.permission}`);
    const today = new Date(`${iso(new Date())}T00:00:00Z`);
    const to = p.to ? new Date(`${p.to}T00:00:00Z`) : today;
    const from = p.from ? new Date(`${p.from}T00:00:00Z`) : new Date(to.getTime() - 29 * 86_400_000);
    const toExclusive = new Date(to.getTime() + 86_400_000);
    const r = await d.run({ mode, panels, from, to, toExclusive, permissions });
    return {
      key,
      title: d.title,
      dataMode: mode,
      generatedAt: new Date().toISOString(),
      period: d.period ? { from: iso(from), to: iso(to) } : null,
      columns: d.columns,
      rows: r.rows,
      notes: r.notes ?? [],
    };
  }
}
