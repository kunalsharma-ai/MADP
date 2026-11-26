import { Injectable } from '@nestjs/common';
import { sql, type SQL } from 'drizzle-orm';
import type { DataMode, PanelCode, ParticipationQuery } from '@madp/contracts';
import { Database } from '../db/database.js';

export interface ParticipationRow {
  id: string;
  panel: PanelCode;
  personId: string;
  memberRef: string | null;
  surveySlug: string | null;
  status: string;
  points: number;
  loi: number | null;
  source: string | null;
  startedAt: string | null;
  endedAt: string | null;
}

/** How a member takes part on one panel, worked out from their survey attempts. */
export interface Engagement {
  panel: PanelCode;
  attempts: number;
  completes: number;
  terminates: number;
  /** Completes over attempts that ended (complete, terminate, quota full). Null when nothing has ended. */
  completeRate: number | null;
  points: number;
  last90Days: number;
  lastActivity: string | null;
  /** 0 to 100: recent activity (50), complete rate (30) and how many surveys they have finished (20). */
  score: number;
  band: 'very active' | 'active' | 'cooling' | 'inactive';
}

const ENDED = ['complete', 'terminate', 'quota_full'];

/** MHO is a health panel: its survey names are hidden from admins without health access. */
export const HIDDEN_HEALTH_SURVEY = 'health survey (name hidden)';
const maskSlug = (panel: PanelCode, slug: string | null, health: boolean) =>
  panel === 'mho' && !health && slug !== null ? HIDDEN_HEALTH_SURVEY : slug;

/**
 * Survey participation as the panels report it (the responses feed mirrored by the loyalty sync). Read-only:
 * MADP never changes a panel's response. Rows carry a person id and the panel's own member ref, never a name.
 */
@Injectable()
export class ParticipationService {
  constructor(private readonly database: Database) {}

  private get db() {
    return this.database.db;
  }

  private where(mode: DataMode, q: Pick<ParticipationQuery, 'panel' | 'status' | 'survey' | 'personId'>, health: boolean): SQL {
    const parts: SQL[] = [sql`sp.data_mode = ${mode}`];
    // A survey name can name a condition, so without health access a name search never matches MHO rows.
    if (q.survey && !health) parts.push(sql`sp.panel <> 'mho'`);
    if (q.panel) parts.push(sql`sp.panel = ${q.panel}`);
    if (q.status) parts.push(sql`sp.status = ${q.status}`);
    if (q.survey) parts.push(sql`sp.survey_slug ilike ${'%' + q.survey.replace(/[%_\\]/g, '\\$&') + '%'}`);
    if (q.personId) parts.push(sql`pm.master_person_id = ${q.personId}`);
    return sql.join(parts, sql` and `);
  }

  async list(mode: DataMode, q: ParticipationQuery, health: boolean) {
    const where = this.where(mode, q, health);
    const [{ total }] = (
      await this.db.execute<{ total: string }>(sql`
        select count(*) as total from survey_participation sp
        join panel_membership pm on pm.id = sp.panel_membership_id where ${where}`)
    ).rows as [{ total: string }];
    const rows = await this.db.execute<{
      id: string;
      panel: PanelCode;
      person_id: string;
      member_ref: string | null;
      survey_slug: string | null;
      status: string;
      points: number;
      loi: number | null;
      source: string | null;
      started_at: string | null;
      ended_at: string | null;
    }>(sql`
      select sp.id, sp.panel, pm.master_person_id as person_id,
        coalesce(si.source_respondent_ref, si.source_member_id) as member_ref,
        sp.survey_slug, sp.status, sp.points, sp.loi, sp.source, sp.started_at, sp.ended_at
      from survey_participation sp
      join panel_membership pm on pm.id = sp.panel_membership_id
      left join source_identity si on si.id = pm.source_identity_id
      where ${where}
      order by coalesce(sp.ended_at, sp.started_at, sp.updated_at) desc nulls last, sp.id
      limit ${q.size} offset ${(q.page - 1) * q.size}`);
    const items: ParticipationRow[] = rows.rows.map((r) => ({
      id: r.id,
      panel: r.panel,
      personId: r.person_id,
      memberRef: r.member_ref,
      surveySlug: maskSlug(r.panel, r.survey_slug, health),
      status: r.status,
      points: Number(r.points),
      loi: r.loi === null ? null : Number(r.loi),
      source: r.source,
      startedAt: r.started_at ? new Date(r.started_at).toISOString() : null,
      endedAt: r.ended_at ? new Date(r.ended_at).toISOString() : null,
    }));
    return { dataMode: mode, total: Number(total), page: q.page, size: q.size, items };
  }

  /** Totals per panel, and the surveys with the most attempts, for the same filters as the list. */
  async summary(mode: DataMode, q: Pick<ParticipationQuery, 'panel' | 'status' | 'survey'>, health: boolean) {
    const where = this.where(mode, q, health);
    const per = await this.db.execute<{ panel: PanelCode; status: string; n: string; points: string; members: string }>(sql`
      select sp.panel, sp.status, count(*) as n, coalesce(sum(sp.points), 0) as points,
        count(distinct sp.panel_membership_id) as members
      from survey_participation sp join panel_membership pm on pm.id = sp.panel_membership_id
      where ${where} group by sp.panel, sp.status`);
    const members = await this.db.execute<{ panel: PanelCode; members: string; recent: string }>(sql`
      select sp.panel, count(distinct sp.panel_membership_id) as members,
        count(distinct sp.panel_membership_id) filter (
          where coalesce(sp.ended_at, sp.started_at) >= now() - interval '30 days') as recent
      from survey_participation sp join panel_membership pm on pm.id = sp.panel_membership_id
      where ${where} group by sp.panel`);
    const top = await this.db.execute<{ panel: PanelCode; survey_slug: string; attempts: string; completes: string }>(sql`
      select sp.panel, sp.survey_slug, count(*) as attempts, count(*) filter (where sp.status = 'complete') as completes
      from survey_participation sp join panel_membership pm on pm.id = sp.panel_membership_id
      where ${where} and sp.survey_slug is not null
      group by sp.panel, sp.survey_slug order by count(*) desc, sp.survey_slug limit 8`);
    const panels = new Map<PanelCode, { panel: PanelCode; byStatus: Record<string, number>; points: number; members: number; activeLast30Days: number; completeRate: number | null }>();
    for (const r of per.rows) {
      const p = panels.get(r.panel) ?? { panel: r.panel, byStatus: {}, points: 0, members: 0, activeLast30Days: 0, completeRate: null };
      p.byStatus[r.status] = Number(r.n);
      if (r.status === 'complete') p.points += Number(r.points);
      panels.set(r.panel, p);
    }
    for (const r of members.rows) {
      const p = panels.get(r.panel);
      if (!p) continue;
      p.members = Number(r.members);
      p.activeLast30Days = Number(r.recent);
    }
    for (const p of panels.values()) {
      const ended = ENDED.reduce((s, k) => s + (p.byStatus[k] ?? 0), 0);
      p.completeRate = ended ? (p.byStatus.complete ?? 0) / ended : null;
    }
    return {
      dataMode: mode,
      panels: [...panels.values()].sort((a, b) => a.panel.localeCompare(b.panel)),
      topSurveys: top.rows.map((r) => ({
        panel: r.panel,
        surveySlug: maskSlug(r.panel, r.survey_slug, health),
        attempts: Number(r.attempts),
        completes: Number(r.completes),
      })),
    };
  }

  /** One person's engagement on each panel they belong to. */
  async engagement(mode: DataMode, personId: string): Promise<Engagement[]> {
    const rows = await this.db.execute<{
      panel: PanelCode;
      attempts: string;
      completes: string;
      terminates: string;
      ended: string;
      points: string;
      recent: string;
      last: string | null;
    }>(sql`
      select sp.panel, count(*) as attempts,
        count(*) filter (where sp.status = 'complete') as completes,
        count(*) filter (where sp.status = 'terminate') as terminates,
        count(*) filter (where sp.status in ('complete', 'terminate', 'quota_full')) as ended,
        coalesce(sum(sp.points) filter (where sp.status = 'complete'), 0) as points,
        count(*) filter (where coalesce(sp.ended_at, sp.started_at) >= now() - interval '90 days') as recent,
        max(coalesce(sp.ended_at, sp.started_at)) as last
      from survey_participation sp join panel_membership pm on pm.id = sp.panel_membership_id
      where sp.data_mode = ${mode} and pm.master_person_id = ${personId}
      group by sp.panel order by sp.panel`);
    return rows.rows.map((r) => engagementOf(r.panel, {
      attempts: Number(r.attempts),
      completes: Number(r.completes),
      terminates: Number(r.terminates),
      ended: Number(r.ended),
      points: Number(r.points),
      last90Days: Number(r.recent),
      lastActivity: r.last ? new Date(r.last).toISOString() : null,
    }));
  }
}

/** Pure scoring, kept apart so it can be tested without a database. */
export function engagementOf(
  panel: PanelCode,
  c: { attempts: number; completes: number; terminates: number; ended: number; points: number; last90Days: number; lastActivity: string | null },
  now = Date.now(),
): Engagement {
  const completeRate = c.ended ? c.completes / c.ended : null;
  const days = c.lastActivity ? (now - Date.parse(c.lastActivity)) / 86_400_000 : Infinity;
  const recency = days <= 14 ? 1 : days <= 30 ? 0.8 : days <= 90 ? 0.5 : days <= 180 ? 0.2 : 0;
  const score = Math.round(50 * recency + 30 * (completeRate ?? 0) + 20 * Math.min(1, c.completes / 10));
  const band = score >= 70 ? 'very active' : score >= 45 ? 'active' : score >= 20 ? 'cooling' : 'inactive';
  return {
    panel,
    attempts: c.attempts,
    completes: c.completes,
    terminates: c.terminates,
    completeRate,
    points: c.points,
    last90Days: c.last90Days,
    lastActivity: c.lastActivity,
    score,
    band,
  };
}
