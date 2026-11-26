import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { type ContactPreferenceCreate, type DataMode, type PanelCode } from '@madp/contracts';
import { Database } from '../db/database.js';
import { contactPreferences } from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { PanelDirectory } from '../panels/panel-directory.js';

/** Purposes a panel would have to report before MADP could send that kind of message. */
const EXPECTED_PURPOSES = ['terms', 'email_marketing'] as const;

/**
 * Consent and preference center. Panels own consent: this shows what they report, with its history, how many
 * members MADP may contact, and the channel opt-outs members asked MADP for. Nothing here grants consent.
 */
@Injectable()
export class ConsentService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
    private readonly panels: PanelDirectory,
  ) {}

  private get db() {
    return this.database.db;
  }

  async summary(mode: DataMode, panel?: PanelCode) {
    const panels = panel ? [panel] : this.panels.codes();
    const list = sql`${`{${panels.join(',')}}`}::text[]`;
    // One set-based pass per question for every panel at once. The engagement gate's per-member subqueries
    // (contactColumns in engagement/gate.ts) also count recent contacts for frequency caps, which this summary does not need.
    const [purposes, funnel, optOuts] = await Promise.all([
      this.db.execute<{ panel: string; purpose: string; status: string; people: string }>(sql`
        select panel::text as panel, purpose, status::text as status, count(distinct master_person_id) as people
        from consent_record where data_mode = ${mode} and panel::text = any(${list})
        group by panel, purpose, status order by panel, purpose, status`),
      this.db.execute<Record<string, string>>(sql`
        with members as (
          select pm.id, pm.panel, pm.master_person_id, pm.status,
            coalesce(si.email_enc is not null and si.email_verification <> 'rejected', false) as usable_email
          from panel_membership pm join source_identity si on si.id = pm.source_identity_id
          where pm.data_mode = ${mode} and pm.panel::text = any(${list})
        ),
        minors as (select distinct master_person_id, panel from category_membership where is_minor),
        terms as (select master_person_id, panel from consent_record
          where data_mode = ${mode} and purpose = 'terms' and status = 'granted'),
        event_opt_outs as (select distinct master_person_id, panel from communication_event
          where not dry_run and state = 'opted_out' and occurred_at <= now()),
        bounced as (select distinct master_person_id, panel from communication_event
          where not dry_run and state in ('bounced', 'complained') and occurred_at <= now()),
        latest_pref as (select distinct on (panel_membership_id) panel_membership_id, status from contact_preference
          where channel in ('email', 'all') and recorded_at <= now()
          order by panel_membership_id, recorded_at desc, id)
        select m.panel::text as panel, count(*) as memberships,
          count(*) filter (where m.status = 'active') as active,
          count(*) filter (where m.status = 'active' and mi.master_person_id is null) as adults,
          count(*) filter (where m.status = 'active' and mi.master_person_id is null and t.master_person_id is not null) as terms,
          count(*) filter (where m.status = 'active' and mi.master_person_id is null and t.master_person_id is not null and m.usable_email) as addressable,
          count(*) filter (where m.status = 'active' and mi.master_person_id is null and t.master_person_id is not null and m.usable_email
            and eo.master_person_id is null and lp.status is distinct from 'opted_out') as not_opted_out,
          count(*) filter (where m.status = 'active' and mi.master_person_id is null and t.master_person_id is not null and m.usable_email
            and eo.master_person_id is null and lp.status is distinct from 'opted_out' and b.master_person_id is null) as reachable
        from members m
        left join minors mi on mi.master_person_id = m.master_person_id and mi.panel = m.panel
        left join terms t on t.master_person_id = m.master_person_id and t.panel = m.panel
        left join event_opt_outs eo on eo.master_person_id = m.master_person_id and eo.panel = m.panel
        left join bounced b on b.master_person_id = m.master_person_id and b.panel = m.panel
        left join latest_pref lp on lp.panel_membership_id = m.id
        group by m.panel`),
      this.db.execute<{ panel: string; channel: string; n: string }>(sql`
        select panel::text as panel, channel, count(*) as n from (
          select distinct on (cp.panel_membership_id, cp.channel) cp.panel, cp.channel, cp.status
          from contact_preference cp where cp.data_mode = ${mode} and cp.panel::text = any(${list})
          order by cp.panel_membership_id, cp.channel, cp.recorded_at desc, cp.id
        ) latest where status = 'opted_out' group by panel, channel`),
    ]);
    const out = panels.map((p) => {
      const byPurpose: Record<string, Record<string, number>> = {};
      for (const r of purposes.rows.filter((x) => x.panel === p)) (byPurpose[r.purpose] ??= {})[r.status] = Number(r.people);
      const f = funnel.rows.find((x) => x.panel === p) ?? {};
      const n = (k: string) => Number(f[k] ?? 0);
      return {
        panel: p,
        purposes: byPurpose,
        contactable: {
          memberships: n('memberships'),
          active: n('active'),
          adults: n('adults'),
          termsAccepted: n('terms'),
          usableAddress: n('addressable'),
          notOptedOut: n('not_opted_out'),
          reachable: n('reachable'),
        },
        madpOptOuts: Object.fromEntries(optOuts.rows.filter((o) => o.panel === p).map((o) => [o.channel, Number(o.n)])),
        gaps: EXPECTED_PURPOSES.filter((x) => !byPurpose[x]).map(
          (x) => `${p.toUpperCase()} does not report ${x.replace('_', ' ')} consent yet, so messages that need it cannot go out.`,
        ),
      };
    });
    return {
      dataMode: mode,
      note: 'Consent comes from each panel. MADP keeps its history and the channel opt-outs members ask MADP for, and never grants consent.',
      panels: out,
    };
  }

  async events(mode: DataMode, q: { panel?: PanelCode; purpose?: string; limit: number }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      select id, master_person_id as "personId", panel, purpose, previous_status as "previousStatus", status,
        evidence->>'source' as source, evidence->>'field' as field, captured_at as "capturedAt", at
      from consent_event
      where data_mode = ${mode}
        ${q.panel ? sql`and panel = ${q.panel}` : sql``}
        ${q.purpose ? sql`and purpose = ${q.purpose}` : sql``}
      order by at desc, id desc limit ${q.limit}`);
    return rows.rows;
  }

  async preferences(mode: DataMode, q: { panel?: PanelCode; limit: number }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      select cp.id, pm.master_person_id as "personId", cp.panel, cp.channel, cp.status, cp.source, cp.reason,
        cp.recorded_by as "recordedBy", cp.recorded_at as "recordedAt"
      from contact_preference cp join panel_membership pm on pm.id = cp.panel_membership_id
      where cp.data_mode = ${mode} ${q.panel ? sql`and cp.panel = ${q.panel}` : sql``}
      order by cp.recorded_at desc limit ${q.limit}`);
    return rows.rows;
  }

  /** A person's consent per panel, its full history (including records that moved in through a merge), and preferences. */
  async person(personId: string) {
    const exists = await this.db.execute(sql`select 1 from master_person where id = ${personId}`);
    if (!exists.rows.length) throw new NotFoundException('No such person');
    const current = await this.db.execute<Record<string, unknown>>(sql`
      select panel, purpose, status::text as status, evidence, captured_at as "capturedAt"
      from consent_record where master_person_id = ${personId} order by panel, purpose`);
    const history = await this.db.execute<Record<string, unknown>>(sql`
      select panel, purpose, previous_status as "previousStatus", status, evidence, captured_at as "capturedAt", at
      from consent_event where master_person_id = ${personId}
        or master_person_id in (select from_person_id from identity_link_event where to_person_id = ${personId})
      order by at desc, id desc limit 500`);
    const prefs = await this.db.execute<Record<string, unknown>>(sql`
      select cp.panel, cp.channel, cp.status, cp.source, cp.reason, cp.recorded_at as "recordedAt"
      from contact_preference cp join panel_membership pm on pm.id = cp.panel_membership_id
      where pm.master_person_id = ${personId} order by cp.recorded_at desc`);
    const latest = new Map<string, string>();
    for (const p of [...prefs.rows].reverse()) latest.set(`${p.panel}:${p.channel}`, String(p.status));
    return {
      personId,
      current: current.rows,
      history: history.rows,
      preferences: prefs.rows,
      optedOut: [...latest.entries()].filter(([, v]) => v === 'opted_out').map(([k]) => k),
    };
  }

  async recordPreference(mode: DataMode, personId: string, body: ContactPreferenceCreate, actor: { id: string; ip: string | null }) {
    const [m] = (
      await this.db.execute<{ id: string }>(sql`
      select id from panel_membership where master_person_id = ${personId} and panel = ${body.panel} and data_mode = ${mode}
        and status <> 'deleted' order by created_at limit 1`)
    ).rows;
    if (!m) throw new NotFoundException(`This person has no ${body.panel} membership`);
    const [last] = (
      await this.db.execute<{ status: string }>(sql`
      select status from contact_preference where panel_membership_id = ${m.id} and channel = ${body.channel}
      order by recorded_at desc, id limit 1`)
    ).rows;
    if (body.status === 'opted_out' && last?.status === 'opted_out') throw new ConflictException('Already opted out of this channel');
    if (body.status === 'resumed' && last?.status !== 'opted_out')
      throw new ConflictException('There is no MADP opt-out on this channel to lift. Consent itself is granted only at the panel.');
    const [row] = await this.db
      .insert(contactPreferences)
      .values({
        dataMode: mode,
        panelMembershipId: m.id,
        panel: body.panel,
        channel: body.channel,
        status: body.status,
        source: body.source,
        reason: body.reason,
        recordedBy: actor.id,
      })
      .returning();
    await this.audit.record({
      actorId: actor.id,
      actorType: 'admin',
      action: 'consent.preference_recorded',
      targetType: 'master_person',
      targetId: personId,
      metadata: { panel: body.panel, channel: body.channel, status: body.status, source: body.source },
      ip: actor.ip,
    });
    return row;
  }
}
