import { Controller, Get, Query } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import type { ActivityItem, ActivityFeed, PanelCode } from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { AudienceService } from '../audience/audience.service.js';
import { PanelAdminService } from '../panel-admin/panel-admin.service.js';

const FeedQuery = z.object({ limit: z.coerce.number().int().min(5).max(100).default(40) });
/** The feed looks back this far; older events are on their own screens. */
const LOOKBACK = sql`interval '3 days'`;

/**
 * One live list of what is happening on T2O, MFR, MHO and any added panel: sign-ups, survey completes, redemptions
 * (from MADP's synced copy) and new support tickets (from each panel's admin API). Times, panel, segment, country,
 * survey and points only: no names, e-mails or ticket text. Each kind shows only on panels where the admin may see it,
 * and teens only with teen access.
 */
@Controller('activity')
export class ActivityController {
  constructor(
    private readonly database: Database,
    private readonly audience: AudienceService,
    private readonly panel: PanelAdminService,
  ) {}

  @Get()
  async feed(@Query(new ZodPipe(FeedQuery)) q: z.infer<typeof FeedQuery>, @CurrentPrincipal() p: Principal): Promise<ActivityFeed> {
    const mode = this.audience.defaultMode();
    const db = this.database.db;
    const can = (b: PanelCode, perm: Parameters<typeof hasOn>[2]) => hasOn(p, b, perm);
    const members = p.brands.filter((b) => can(b, ['members.read']));
    const points = p.brands.filter((b) => can(b, ['members.read', 'points.read']));
    const support = p.brands.filter((b) => can(b, ['support.read']));
    const teenOk = new Set(p.brands.filter((b) => can(b, ['teen.read'])));
    const arr = (xs: string[]) => `{${xs.join(',')}}`;
    // Members flagged as minors on a panel where this admin has no teen access are left out.
    const allTeens = teenOk.size === p.brands.length;
    const notHiddenTeen = (alias: 'pm', panelCol: 'pm.panel') =>
      allTeens
        ? sql`true`
        : sql`not exists (select 1 from category_membership t where t.master_person_id = ${sql.raw(alias)}.master_person_id
            and t.panel = ${sql.raw(panelCol)} and (t.is_minor or t.category = 'teen')
            and not (t.panel = any(${arr([...teenOk])}::text[])))`;
    const items: ActivityItem[] = [];

    if (members.length) {
      const signups = await db.execute<{ id: string; panel: string; at: string; country: string | null; segments: string[] | null }>(sql`
        select pm.id, pm.panel, coalesce(si.source_created_at, pm.created_at) as at, si.country,
               (select array_agg(c.category order by c.category) from category_membership c
                 where c.master_person_id = pm.master_person_id and c.panel = pm.panel) as segments
        from panel_membership pm join source_identity si on si.id = pm.source_identity_id
        where pm.data_mode = ${mode} and pm.panel = any(${arr(members)}::text[]) and pm.status <> 'deleted'
          and coalesce(si.source_created_at, pm.created_at) > now() - ${LOOKBACK} and ${notHiddenTeen('pm', 'pm.panel')}
        order by at desc limit ${q.limit}`);
      for (const r of signups.rows)
        items.push({ id: `signup:${r.id}`, kind: 'signup', panel: r.panel, at: new Date(r.at).toISOString(), segments: r.segments ?? [], country: r.country });

      const completes = await db.execute<{ id: string; panel: string; at: string; survey: string | null; points: number; country: string | null }>(sql`
        select sp.id, sp.panel, sp.ended_at as at, sp.survey_slug as survey, sp.points, si.country
        from survey_participation sp
        join panel_membership pm on pm.id = sp.panel_membership_id
        join source_identity si on si.id = pm.source_identity_id
        where sp.data_mode = ${mode} and sp.panel = any(${arr(members)}::text[]) and sp.status = 'complete'
          and sp.ended_at > now() - ${LOOKBACK} and ${notHiddenTeen('pm', 'pm.panel')}
        order by sp.ended_at desc limit ${q.limit}`);
      for (const r of completes.rows)
        items.push({ id: `complete:${r.id}`, kind: 'survey_complete', panel: r.panel, at: new Date(r.at).toISOString(), survey: r.survey, points: r.points, country: r.country });
    }

    if (points.length) {
      const redeemed = await db.execute<{ id: string; panel: string; at: string; points: number }>(sql`
        select rl.id::text as id, rl.panel, rl.recorded_at as at, abs(rl.points) as points
        from reward_ledger rl
        join loyalty_account la on la.id = rl.account_id
        join panel_membership pm on pm.id = la.panel_membership_id
        where rl.data_mode = ${mode} and rl.panel = any(${arr(points)}::text[]) and rl.bucket = 'redeemed'
          and rl.recorded_at > now() - ${LOOKBACK}
          and ${notHiddenTeen('pm', 'pm.panel')}
        order by rl.recorded_at desc limit ${q.limit}`);
      for (const r of redeemed.rows)
        items.push({ id: `redeem:${r.id}`, kind: 'redemption', panel: r.panel, at: new Date(r.at).toISOString(), points: Number(r.points) });
    }

    // New tickets come straight from each panel; a panel that does not answer is listed, not fatal.
    const unreachable: string[] = [];
    await Promise.all(
      support.map(async (b) => {
        try {
          const r = await this.panel.call<{ items: { id: string; no: string | number; category: string; priority: string; status: string; createdAt: string }[] }>(
            b, p.id, 'GET', R.tickets, { status: 'open_all', ...(teenOk.has(b) ? {} : { noTeens: 1 }) },
          );
          const since = Date.now() - 3 * 86_400_000;
          for (const t of r.items.filter((x) => new Date(x.createdAt).getTime() > since).slice(0, q.limit))
            items.push({ id: `ticket:${b}:${t.id}`, kind: 'ticket', panel: b, at: new Date(t.createdAt).toISOString(), ticketNo: String(t.no), category: t.category || null, priority: t.priority, status: t.status });
        } catch {
          unreachable.push(b);
        }
      }),
    );

    items.sort((a, b) => b.at.localeCompare(a.at));
    return { dataMode: mode, checkedAt: new Date().toISOString(), items: items.slice(0, q.limit), unreachable: unreachable.sort() };
  }
}
