import { Injectable } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type DataMode, type PanelCode } from '@madp/contracts';
import { Database } from '../db/database.js';
import { Mongo } from '../mongo/mongo.js';
import { PanelDirectory } from '../panels/panel-directory.js';

/** Kunal's rule (super admin spec, 24 Nov 2026): every respondent's data is rechecked every 6 months. */
export const DEFAULT_STALE_DAYS = 180;
const BUCKETS = [0.25, 0.5, 0.75] as const;

/**
 * Missing profile attributes and freshness (screen 13), per panel and never added across panels: how complete
 * profiles are, how old the answers are, which members are due for their 6-month check, which questions are
 * answered least, and how well each canonical attribute is covered through approved mappings. Counts only.
 */
@Injectable()
export class FreshnessService {
  constructor(
    private readonly database: Database,
    private readonly mongo: Mongo,
    private readonly panels: PanelDirectory,
  ) {}

  async report(mode: DataMode, opts: { panel?: PanelCode; staleDays: number; healthAllowed: boolean; now?: Date }) {
    const now = opts.now ?? new Date();
    const staleBefore = new Date(now.getTime() - opts.staleDays * 86_400_000);
    const panels = opts.panel ? [opts.panel] : this.panels.codes();
    const out = [];
    for (const panel of panels) out.push(await this.panel(mode, panel, staleBefore, opts.healthAllowed));
    return { dataMode: mode, staleDays: opts.staleDays, asOf: now.toISOString(), panels: out };
  }

  private async panel(mode: DataMode, panel: PanelCode, staleBefore: Date, healthAllowed: boolean) {
    const [m] = (
      await this.database.db.execute<{ active: string; last_sync: Date | null }>(sql`
      select (select count(*) from panel_membership where data_mode = ${mode} and panel = ${panel} and status = 'active') as active,
        (select max(finished_at) from import_job where data_mode = ${mode} and panel = ${panel} and status = 'succeeded' and not dry_run) as last_sync`)
    ).rows;
    const active = Number(m!.active);
    const questions = await this.mongo.questionVersions
      .aggregate<{ _id: string; label: string; sensitivity: string }>([
        { $match: { panel, dataMode: mode } },
        { $sort: { version: -1 } },
        { $group: { _id: '$sourceQuestionId', label: { $first: '$label' }, sensitivity: { $first: '$sensitivity' } } },
      ])
      .toArray();
    const bank = questions.length;
    const answeredAt = { $ifNull: ['$sourceUpdatedAt', '$ingestedAt'] };

    // Per member: how many questions answered, and when they last answered anything.
    const [members] = await this.mongo.profileAnswers
      .aggregate<{ buckets: { _id: number; n: number }[]; stale: { n: number }[]; total: { n: number }[] }>([
        { $match: { panel, dataMode: mode } },
        { $group: { _id: '$personId', n: { $sum: 1 }, last: { $max: answeredAt } } },
        {
          $facet: {
            total: [{ $count: 'n' }],
            stale: [{ $match: { last: { $lt: staleBefore } } }, { $count: 'n' }],
            buckets: [
              { $project: { share: bank ? { $divide: ['$n', bank] } : 1 } },
              {
                $bucket: {
                  groupBy: '$share',
                  boundaries: [0, ...BUCKETS, 1.000001],
                  default: 2,
                  output: { n: { $sum: 1 } },
                },
              },
            ],
          },
        },
      ])
      .toArray();
    const withAnswers = members?.total[0]?.n ?? 0;
    const bucket = (b: number) => members?.buckets.find((x) => x._id === b)?.n ?? 0;

    // Per question: members who answered it, and how many of those answers are older than the window.
    const perQ = await this.mongo.profileAnswers
      .aggregate<{ _id: string; n: number; stale: number }>([
        { $match: { panel, dataMode: mode } },
        { $group: { _id: '$sourceQuestionId', n: { $sum: 1 }, stale: { $sum: { $cond: [{ $lt: [answeredAt, staleBefore] }, 1, 0] } } } },
      ])
      .toArray();
    const byQ = new Map(perQ.map((q) => [q._id, q]));
    const visible = questions.filter((q) => healthAllowed || q.sensitivity !== 'special_category');
    const leastAnswered = visible
      .map((q) => ({ sourceQuestionId: q._id, label: q.label, answered: byQ.get(q._id)?.n ?? 0, stale: byQ.get(q._id)?.stale ?? 0 }))
      .map((q) => ({ ...q, coverage: active ? q.answered / active : 0 }))
      .sort((a, b) => a.coverage - b.coverage || a.sourceQuestionId.localeCompare(b.sourceQuestionId))
      .slice(0, 10);

    // Canonical attributes through approved mappings only.
    const maps = (
      await this.database.db.execute<{ key: string; label: string; sensitivity: string; qs: string[] }>(sql`
      select ad.key, ad.label, ad.sensitivity::text as sensitivity, array_agg(distinct m.source_question_id) as qs
      from source_question_mapping m join attribute_definition ad on ad.key = m.attribute_key
      where m.data_mode = ${mode} and m.panel = ${panel} and m.status = 'approved'
      group by ad.key, ad.label, ad.sensitivity order by ad.key`)
    ).rows.filter((a) => healthAllowed || a.sensitivity !== 'special_category');
    const attributes = [];
    for (const a of maps) {
      const [r] = await this.mongo.profileAnswers
        .aggregate<{ n: number; stale: number }>([
          { $match: { panel, dataMode: mode, sourceQuestionId: { $in: a.qs } } },
          { $group: { _id: '$personId', last: { $max: answeredAt } } },
          { $group: { _id: null, n: { $sum: 1 }, stale: { $sum: { $cond: [{ $lt: ['$last', staleBefore] }, 1, 0] } } } },
        ])
        .toArray();
      attributes.push({
        key: a.key,
        label: a.label,
        sensitivity: a.sensitivity,
        members: r?.n ?? 0,
        coverage: active ? (r?.n ?? 0) / active : 0,
        stale: r?.stale ?? 0,
      });
    }
    const hidden = questions.length - visible.length;
    return {
      panel,
      activeMemberships: active,
      questionBank: bank,
      membersWithAnswers: withAnswers,
      neverProfiled: Math.max(0, active - withAnswers),
      dueForCheck: members?.stale[0]?.n ?? 0,
      completeness: [
        { band: 'under 25%', members: bucket(0) },
        { band: '25–50%', members: bucket(0.25) },
        { band: '50–75%', members: bucket(0.5) },
        { band: '75% and over', members: bucket(0.75) + bucket(2) },
      ],
      leastAnswered,
      attributes,
      hiddenSensitiveQuestions: hidden,
      lastSync: m!.last_sync,
    };
  }
}
