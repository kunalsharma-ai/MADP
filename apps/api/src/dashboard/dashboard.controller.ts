import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { RequirePermissions } from '../auth/decorators.js';
import { Database } from '../db/database.js';
import { AudienceService } from '../audience/audience.service.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { Mongo } from '../mongo/mongo.js';

@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly database: Database,
    private readonly audience: AudienceService,
    private readonly registry: ConnectorRegistry,
    private readonly mongo: Mongo,
  ) {}

  @RequirePermissions('dashboard.read')
  @Get('summary')
  async summary() {
    const mode = this.audience.defaultMode();
    const counts = await this.audience.counts({}, mode);
    const db = this.database.db;
    const one = async (q: ReturnType<typeof sql>) =>
      Number((await db.execute<{ n: string }>(q)).rows[0]?.n ?? 0);
    const [pendingMappings, pendingMatches, verifiedPeople, multiPanelPeople, newLast30] = await Promise.all([
      one(
        sql`select count(*) as n from source_question_mapping where data_mode = ${mode} and status = 'pending'`,
      ),
      one(
        sql`select count(*) as n from identity_match_candidate where data_mode = ${mode} and status = 'pending'`,
      ),
      one(
        sql`select count(distinct master_person_id) as n from source_identity where data_mode = ${mode} and email_verification = 'verified'`,
      ),
      one(
        sql`select count(*) as n from (select master_person_id from panel_membership where data_mode = ${mode} group by 1 having count(*) > 1) x`,
      ),
      one(
        sql`select count(*) as n from source_identity where data_mode = ${mode} and source_created_at > now() - interval '30 days'`,
      ),
    ]);
    const growth = await db.execute<{ month: string; panel: string; n: string }>(sql`
      select to_char(date_trunc('month', source_created_at), 'YYYY-MM') as month, panel::text, count(*) as n
      from source_identity where data_mode = ${mode} and source_created_at is not null
      group by 1, 2 order by 1`);
    const questions = await this.mongo.questionVersions
      .aggregate<{ _id: string; n: number }>([
        { $match: { dataMode: mode } },
        { $group: { _id: '$panel', n: { $addToSet: '$sourceQuestionId' } } },
        { $project: { n: { $size: '$n' } } },
      ])
      .toArray();
    const answers = await this.mongo.profileAnswers
      .aggregate<{ _id: string; n: number }>([
        { $match: { dataMode: mode } },
        { $group: { _id: '$panel', n: { $sum: 1 } } },
      ])
      .toArray();
    return {
      dataMode: mode,
      connectors: this.registry
        .all()
        .map((s) => ({ panel: s.panel, dataMode: s.dataMode, reason: s.reason })),
      counts,
      kpis: {
        verifiedPeople,
        multiPanelPeople,
        newRegistrationsLast30Days: newLast30,
        pendingMappings,
        pendingIdentityMatches: pendingMatches,
      },
      questionsByPanel: Object.fromEntries(questions.map((q) => [q._id, q.n])),
      answersByPanel: Object.fromEntries(answers.map((a) => [a._id, a.n])),
      registrationsByMonth: growth.rows.map((r) => ({ month: r.month, panel: r.panel, n: Number(r.n) })),
    };
  }
}
