import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { NewMembersSeen, type FraudAlertPanel, type FraudAlerts, type PanelCode } from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import { CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { adminFraudSeen } from '../db/schema.js';
import { PanelAdminService } from '../panel-admin/panel-admin.service.js';
import { alertPanels } from './new-members.controller.js';

type Rule = 'phone' | 'email' | 'name_dob';
const RULES: Rule[] = ['phone', 'email', 'name_dob'];
/** The panel scans every member for a duplicate check, so one scan per panel and rule serves everyone for a while. */
const CACHE_MS = 10 * 60_000;
const FIRST_LOOK_MS = 7 * 24 * 60 * 60_000;
type Scan = { at: number; groups: { newest: number }[]; more: boolean };

/**
 * The red "possible duplicates" alert: accounts on one panel that share a phone, an e-mail, or a name with a birth
 * date (panel side: MFR#68). Counts and times only, never who. Teens are never listed by the panel. Per admin, an
 * alert is new while a group has an account that signed up since they last looked. No @RequirePermissions: each admin
 * sees only panels where they hold members.read.
 */
@Controller('fraud-alerts')
export class FraudAlertsController {
  private readonly cache = new Map<string, Scan>();

  constructor(
    private readonly database: Database,
    private readonly panel: PanelAdminService,
  ) {}

  private async scan(panel: PanelCode, actor: string, by: Rule): Promise<Scan> {
    const key = `${panel}:${by}`;
    const hit = this.cache.get(key);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit;
    const r = await this.panel.call<{ more: boolean; items: { members: { signedUpAt?: string | null }[] }[] }>(
      panel, actor, 'GET', R.duplicates, { by, limit: 200 },
    );
    const scan: Scan = {
      at: Date.now(),
      more: r.more,
      groups: r.items.map((g) => ({ newest: Math.max(0, ...g.members.map((m) => (m.signedUpAt ? Date.parse(m.signedUpAt) || 0 : 0))) })),
    };
    this.cache.set(key, scan);
    return scan;
  }

  @Get()
  async list(@CurrentPrincipal() p: Principal): Promise<FraudAlerts> {
    const panels = alertPanels(p);
    const seenRows = await this.database.db.execute<{ panel: string; seen_at: string }>(
      sql`select panel, seen_at from admin_fraud_seen where admin_user_id = ${p.id}`,
    );
    const seen = new Map(seenRows.rows.map((r) => [r.panel, new Date(r.seen_at).getTime()]));
    const unreachable: string[] = [];
    const out: FraudAlertPanel[] = [];
    await Promise.all(
      panels.map(async (panel) => {
        try {
          const scans = await Promise.all(RULES.map((by) => this.scan(panel, p.id, by)));
          const since = seen.get(panel) ?? Date.now() - FIRST_LOOK_MS;
          const all = scans.flatMap((s) => s.groups);
          const latest = Math.max(0, ...all.map((g) => g.newest));
          out.push({
            panel,
            groups: Object.fromEntries(RULES.map((by, i) => [by, scans[i]!.groups.length])),
            fresh: all.filter((g) => g.newest > since).length,
            latestAt: latest ? new Date(latest).toISOString() : null,
            more: scans.some((s) => s.more),
          });
        } catch {
          unreachable.push(panel);
        }
      }),
    );
    out.sort((a, b) => panels.indexOf(a.panel) - panels.indexOf(b.panel));
    return { checkedAt: new Date().toISOString(), total: out.reduce((n, x) => n + x.fresh, 0), panels: out, unreachable: unreachable.sort() };
  }

  @Post('seen')
  @HttpCode(200)
  async seen(@Body(new ZodPipe(NewMembersSeen)) body: NewMembersSeen, @CurrentPrincipal() p: Principal) {
    const panels = alertPanels(p).filter((x) => !body.panel || x === body.panel);
    const now = new Date();
    if (panels.length)
      await this.database.db
        .insert(adminFraudSeen)
        .values(panels.map((panel) => ({ adminUserId: p.id, panel, seenAt: now })))
        .onConflictDoUpdate({ target: [adminFraudSeen.adminUserId, adminFraudSeen.panel], set: { seenAt: now } });
    return { seenAt: now.toISOString(), panels };
  }
}
