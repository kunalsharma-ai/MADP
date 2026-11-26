import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import {
  NewMembersSeen,
  type NewMembersPanel,
  type NewMembersRecent,
  type NewMembersSummary,
  type PanelCode,
} from '@madp/contracts';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { adminNewMemberSeen } from '../db/schema.js';
import { AudienceService } from '../audience/audience.service.js';

/** With no "seen" mark yet, sign-ups from the last day count as new. */
const FIRST_LOOK_MS = 24 * 60 * 60_000;
/**
 * Only members who signed up on the panel in the last week can ring the bell, so the first sync of a panel with years
 * of history does not show every old member as new.
 */
const RECENT_SIGNUP = sql`interval '7 days'`;
const RECENT_ITEMS = 12;

/** Panels where this admin may see members (members.read on that brand). */
export function alertPanels(p: Pick<Principal, 'brands' | 'brandPermissions' | 'permissions'>): PanelCode[] {
  return p.brands.filter((b) => hasOn(p, b, ['members.read']));
}

/**
 * New member sign-ups on T2O, MFR, MHO and any added panel, for the console's bell and badges. Counts members that
 * MADP's sync brought in since the admin last marked the panel seen. Counts, segments, country and times only: no
 * names, e-mails or member ids, so nothing personal is read. Teens are left out where the admin has no teen.read.
 * No @RequirePermissions: each admin sees only the panels where they hold members.read.
 */
@Controller('new-members')
export class NewMembersController {
  constructor(
    private readonly database: Database,
    private readonly audience: AudienceService,
  ) {}

  @Get()
  async summary(@CurrentPrincipal() p: Principal): Promise<NewMembersSummary> {
    const mode = this.audience.defaultMode();
    const db = this.database.db;
    const panels = alertPanels(p);
    const checkedAt = new Date();
    if (!panels.length) return { dataMode: mode, checkedAt: checkedAt.toISOString(), total: 0, panels: [], recent: [] };
    const seenRows = await db.execute<{ panel: string; seen_at: string }>(
      sql`select panel, seen_at from admin_new_member_seen where admin_user_id = ${p.id}`,
    );
    const seen = new Map(seenRows.rows.map((r) => [r.panel, new Date(r.seen_at)]));
    const out: NewMembersPanel[] = [];
    const recent: NewMembersRecent[] = [];
    for (const panel of panels) {
      const since = seen.get(panel) ?? new Date(checkedAt.getTime() - FIRST_LOOK_MS);
      const teens = hasOn(p, panel, ['teen.read']);
      const noTeens = teens
        ? sql``
        : sql` and not exists (select 1 from category_membership t where t.master_person_id = pm.master_person_id and t.panel = pm.panel and (t.is_minor or t.category = 'teen'))`;
      const from = sql`
        from panel_membership pm
        join source_identity si on si.id = pm.source_identity_id`;
      const where = sql`
        where pm.data_mode = ${mode} and pm.panel = ${panel} and pm.status <> 'deleted'
          and pm.created_at > ${since.toISOString()}
          and coalesce(si.source_created_at, pm.created_at) > now() - ${RECENT_SIGNUP}${noTeens}`;
      const [total, bySeg, items] = await Promise.all([
        db.execute<{ n: string }>(sql`select count(*) as n ${from} ${where}`),
        db.execute<{ category: string; n: string }>(sql`
          select cm.category, count(distinct pm.id) as n ${from}
          join category_membership cm on cm.master_person_id = pm.master_person_id and cm.panel = pm.panel
          ${where}
          group by cm.category`),
        db.execute<{ segments: string[] | null; country: string | null; signed_up_at: string | null; arrived_at: string }>(sql`
          select (select array_agg(c.category order by c.category) from category_membership c
                   where c.master_person_id = pm.master_person_id and c.panel = pm.panel) as segments,
                 si.country, si.source_created_at as signed_up_at, pm.created_at as arrived_at
          ${from} ${where}
          order by pm.created_at desc
          limit ${RECENT_ITEMS}`),
      ]);
      const n = Number(total.rows[0]?.n ?? 0);
      out.push({
        panel,
        since: since.toISOString(),
        total: n,
        segments: bySeg.rows
          .map((r) => ({ key: r.category, count: Number(r.n) }))
          .filter((s) => teens || s.key !== 'teen')
          .sort((a, b) => b.count - a.count),
        teensHidden: !teens,
      });
      for (const r of items.rows)
        recent.push({
          panel,
          segments: (r.segments ?? []).filter((s) => teens || s !== 'teen'),
          country: r.country,
          signedUpAt: r.signed_up_at ? new Date(r.signed_up_at).toISOString() : null,
          arrivedAt: new Date(r.arrived_at).toISOString(),
        });
    }
    recent.sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
    return {
      dataMode: mode,
      checkedAt: checkedAt.toISOString(),
      total: out.reduce((s, x) => s + x.total, 0),
      panels: out,
      recent: recent.slice(0, RECENT_ITEMS),
    };
  }

  /** Marks one panel (or every panel the admin may see) as seen: its count starts again from zero. */
  @Post('seen')
  @HttpCode(200)
  async markSeen(@Body(new ZodPipe(NewMembersSeen)) body: NewMembersSeen, @CurrentPrincipal() p: Principal) {
    const allowed = alertPanels(p);
    const panels = body.panel ? allowed.filter((x) => x === body.panel) : allowed;
    const now = new Date();
    for (const panel of panels)
      await this.database.db
        .insert(adminNewMemberSeen)
        .values({ adminUserId: p.id, panel, seenAt: now })
        .onConflictDoUpdate({
          target: [adminNewMemberSeen.adminUserId, adminNewMemberSeen.panel],
          set: { seenAt: now },
        });
    return { seen: panels, at: now.toISOString() };
  }
}
