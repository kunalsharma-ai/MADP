import { BadRequestException, Controller, Get, Query } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { DailySummary, DailySummaryPanel, PanelCode } from '@madp/contracts';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { AudienceService } from '../audience/audience.service.js';
import { alertPanels } from './new-members.controller.js';

/** The team works in India, so a "day" runs midnight to midnight India time. */
const TZ = 'Asia/Kolkata';
const TREND_DAYS = 14;
const DayQuery = z.object({
  day: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
});

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date());
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * The daily summary: per panel, sign-ups (by segment and country), survey completes, active members, points earned
 * and redemptions for one day, compared with the day before and the week before, plus a 14-day trend. Built from
 * MADP's synced copy of each panel, so it is as fresh as the last sync. Counts only, nothing personal. Like the bell,
 * each admin sees only panels where they hold members.read, teens only with teen.read, and redemptions only with
 * points.read.
 */
@Controller('daily-summary')
export class DailySummaryController {
  constructor(
    private readonly database: Database,
    private readonly audience: AudienceService,
  ) {}

  @Get()
  async get(
    @Query(new ZodPipe(DayQuery)) q: z.infer<typeof DayQuery>,
    @CurrentPrincipal() p: Principal,
  ): Promise<DailySummary> {
    const now = today();
    const day = q.day ?? addDays(now, -1);
    if (Number.isNaN(Date.parse(day)) || day > now)
      throw new BadRequestException('Pick today or a day before it.');
    const mode = this.audience.defaultMode();
    const db = this.database.db;
    const first = addDays(day, -(TREND_DAYS - 1));
    const localDay = (col: SQL) => sql`(${col} at time zone ${TZ})::date`;
    const panels: DailySummaryPanel[] = [];

    for (const panel of alertPanels(p) as PanelCode[]) {
      const noTeens = hasOn(p, panel, ['teen.read'])
        ? sql``
        : sql` and not exists (select 1 from category_membership t where t.master_person_id = pm.master_person_id and t.panel = pm.panel and (t.is_minor or t.category = 'teen'))`;
      const signedUp = localDay(sql`coalesce(si.source_created_at, pm.created_at)`);
      const members = sql`
        from panel_membership pm join source_identity si on si.id = pm.source_identity_id
        where pm.data_mode = ${mode} and pm.panel = ${panel} and pm.status <> 'deleted'${noTeens}`;
      const ended = localDay(sql`sp.ended_at`);
      const completes = sql`
        from survey_participation sp join panel_membership pm on pm.id = sp.panel_membership_id
        where sp.data_mode = ${mode} and sp.panel = ${panel} and sp.status = 'complete'${noTeens}`;

      const [signupDays, segs, countries, completeDays, active, redeemed] = await Promise.all([
        db.execute<{ d: string; n: string }>(sql`
          select ${signedUp}::text as d, count(*) as n ${members}
            and ${signedUp} between ${addDays(first, -7)}::date and ${day}::date
          group by 1`),
        db.execute<{ segment: string; n: string }>(sql`
          select cm.category as segment, count(distinct pm.id) as n ${sql`
            from panel_membership pm join source_identity si on si.id = pm.source_identity_id
            join category_membership cm on cm.master_person_id = pm.master_person_id and cm.panel = pm.panel
            where pm.data_mode = ${mode} and pm.panel = ${panel} and pm.status <> 'deleted'${noTeens}`}
            and ${signedUp} = ${day}::date
          group by 1 order by 2 desc`),
        db.execute<{ country: string; n: string }>(sql`
          select coalesce(si.country, 'unknown') as country, count(*) as n ${members}
            and ${signedUp} = ${day}::date
          group by 1 order by 2 desc limit 8`),
        db.execute<{ d: string; n: string; pts: string }>(sql`
          select ${ended}::text as d, count(*) as n, coalesce(sum(sp.points), 0) as pts ${completes}
            and ${ended} between ${first}::date and ${day}::date
          group by 1`),
        db.execute<{ n: string }>(sql`
          select count(distinct sp.panel_membership_id) as n ${completes} and ${ended} = ${day}::date`),
        hasOn(p, panel, ['points.read'])
          ? db.execute<{ n: string; pts: string }>(sql`
              select count(*) as n, coalesce(sum(abs(rl.points)), 0) as pts
              from reward_ledger rl
              join loyalty_account la on la.id = rl.account_id
              join panel_membership pm on pm.id = la.panel_membership_id
              where rl.data_mode = ${mode} and rl.panel = ${panel} and rl.bucket = 'redeemed'
                and ${localDay(sql`rl.recorded_at`)} = ${day}::date${noTeens}`)
          : Promise.resolve(null),
      ]);

      const s = new Map(signupDays.rows.map((r) => [r.d, Number(r.n)]));
      const c = new Map(completeDays.rows.map((r) => [r.d, { n: Number(r.n), pts: Number(r.pts) }]));
      const week = Array.from({ length: 7 }, (_, i) => s.get(addDays(day, -(i + 1))) ?? 0);
      panels.push({
        panel,
        signups: s.get(day) ?? 0,
        signupsBefore: s.get(addDays(day, -1)) ?? 0,
        signupsAvg7: Math.round((week.reduce((a, b) => a + b, 0) / 7) * 10) / 10,
        bySegment: segs.rows.map((r) => ({ segment: r.segment, n: Number(r.n) })),
        byCountry: countries.rows.map((r) => ({ country: r.country, n: Number(r.n) })),
        completes: c.get(day)?.n ?? 0,
        completesBefore: c.get(addDays(day, -1))?.n ?? 0,
        activeMembers: Number(active.rows[0]?.n ?? 0),
        pointsEarned: c.get(day)?.pts ?? 0,
        redemptions: redeemed
          ? { n: Number(redeemed.rows[0]?.n ?? 0), points: Number(redeemed.rows[0]?.pts ?? 0) }
          : null,
        trend: Array.from({ length: TREND_DAYS }, (_, i) => {
          const d = addDays(first, i);
          return { day: d, signups: s.get(d) ?? 0, completes: c.get(d)?.n ?? 0 };
        }),
      });
    }

    const sum = (
      k: 'signups' | 'signupsBefore' | 'completes' | 'completesBefore' | 'activeMembers' | 'pointsEarned',
    ) => panels.reduce((n, x) => n + x[k], 0);
    return {
      dataMode: mode,
      day,
      timeZone: TZ,
      checkedAt: new Date().toISOString(),
      totals: {
        signups: sum('signups'),
        signupsBefore: sum('signupsBefore'),
        completes: sum('completes'),
        completesBefore: sum('completesBefore'),
        activeMembers: sum('activeMembers'),
        pointsEarned: sum('pointsEarned'),
      },
      panels,
    };
  }
}
