import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { PANEL_CODES, type ContactPreferenceCreate, type DataMode, type PanelCode } from '@madp/contracts';
import { Database } from '../db/database.js';
import { contactPreferences } from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { contactColumns } from '../engagement/gate.js';

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
  ) {}

  private get db() {
    return this.database.db;
  }

  async summary(mode: DataMode, panel?: PanelCode) {
    const panels = panel ? [panel] : [...PANEL_CODES];
    const out = [];
    for (const p of panels) {
      const purposes = (
        await this.db.execute<{ purpose: string; status: string; people: string }>(sql`
        select purpose, status::text as status, count(distinct master_person_id) as people
        from consent_record where data_mode = ${mode} and panel = ${p}
        group by purpose, status order by purpose, status`)
      ).rows;
      const byPurpose: Record<string, Record<string, number>> = {};
      for (const r of purposes) (byPurpose[r.purpose] ??= {})[r.status] = Number(r.people);
      const [f] = (
        await this.db.execute<Record<string, string>>(sql`
        select count(*) as memberships,
          count(*) filter (where c.status = 'active') as active,
          count(*) filter (where c.status = 'active' and not c.minor) as adults,
          count(*) filter (where c.status = 'active' and not c.minor and c.consent = 'granted') as terms,
          count(*) filter (where c.status = 'active' and not c.minor and c.consent = 'granted' and c.has_email and not c.email_rejected) as addressable,
          count(*) filter (where c.status = 'active' and not c.minor and c.consent = 'granted' and c.has_email and not c.email_rejected
            and not c.opted_out) as not_opted_out,
          count(*) filter (where c.status = 'active' and not c.minor and c.consent = 'granted' and c.has_email and not c.email_rejected
            and not c.opted_out and not c.bounced) as reachable
        from (
          select ${contactColumns('terms', new Date())}
          from panel_membership pm join source_identity si on si.id = pm.source_identity_id
          where pm.data_mode = ${mode} and pm.panel = ${p}
        ) c`)
      ).rows;
      const optOuts = (
        await this.db.execute<{ channel: string; n: string }>(sql`
        select channel, count(*) as n from (
          select distinct on (cp.panel_membership_id, cp.channel) cp.channel, cp.status
          from contact_preference cp where cp.data_mode = ${mode} and cp.panel = ${p}
          order by cp.panel_membership_id, cp.channel, cp.recorded_at desc, cp.id
        ) latest where status = 'opted_out' group by channel`)
      ).rows;
      out.push({
        panel: p,
        purposes: byPurpose,
        contactable: {
          memberships: Number(f!.memberships),
          active: Number(f!.active),
          adults: Number(f!.adults),
          termsAccepted: Number(f!.terms),
          usableAddress: Number(f!.addressable),
          notOptedOut: Number(f!.not_opted_out),
          reachable: Number(f!.reachable),
        },
        madpOptOuts: Object.fromEntries(optOuts.map((o) => [o.channel, Number(o.n)])),
        gaps: EXPECTED_PURPOSES.filter((x) => !byPurpose[x]).map(
          (x) => `${p.toUpperCase()} does not report ${x.replace('_', ' ')} consent yet, so messages that need it cannot go out.`,
        ),
      });
    }
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
