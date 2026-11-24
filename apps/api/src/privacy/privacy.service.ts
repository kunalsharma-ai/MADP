import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, type OnModuleInit } from '@nestjs/common';
import { and, eq, isNull, sql } from 'drizzle-orm';
import type { DataMode, PanelCode, PrivacyRequestCreate } from '@madp/contracts';
import { Database } from '../db/database.js';
import { Mongo } from '../mongo/mongo.js';
import { contactPreferences, erasureHolds, privacyRequestEvents, privacyRequests } from '../db/schema.js';
import { FieldCrypto } from '../crypto/field-crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { IngestionService } from '../ingestion/ingestion.service.js';

interface Actor {
  id: string;
  ip: string | null;
}

/**
 * Retention schedule. Audit, consent and ledger history are kept as evidence and never purged by MADP; the
 * periods marked [Confirm] wait for counsel. Only short-lived technical rows can be purged from here.
 */
const RETENTION = [
  { key: 'service_idempotency', label: 'Supply360 idempotency answers', keepDays: 30, purge: true },
  { key: 'dry_run_events', label: 'Planned messages from dry runs', keepDays: 180, purge: true },
  { key: 'audit_event', label: 'Audit trail', keepDays: null, purge: false, note: '7 years for money entries, 3 years for the rest [Confirm with counsel]' },
  { key: 'consent_event', label: 'Consent history', keepDays: null, purge: false, note: 'Kept as evidence of consent and withdrawal' },
  { key: 'reward_ledger', label: 'Reward ledger', keepDays: null, purge: false, note: 'Kept for reward liabilities' },
] as const;

/**
 * Privacy requests: access, correction, deletion and restriction, each with a due date and an append-only trail.
 * Whoever logs a request cannot verify or carry it out. Panels own the member record: deletion erases MADP's copy,
 * holds the member out of later syncs, and waits for the panel's deletions feed before it is complete.
 */
@Injectable()
export class PrivacyService implements OnModuleInit {
  constructor(
    private readonly database: Database,
    private readonly mongo: Mongo,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
    private readonly ingestion: IngestionService,
  ) {}

  onModuleInit() {
    this.ingestion.onPanelDeleted = (panel, mode, member) => this.panelDeleted(panel, mode, member);
  }

  private get db() {
    return this.database.db;
  }

  private async step(requestId: string, action: string, actorId: string | null, note = '', metadata: Record<string, unknown> = {}) {
    await this.db.insert(privacyRequestEvents).values({ requestId, action, actorId, note, metadata });
  }

  private async memberships(personId: string, mode: DataMode, panels?: PanelCode[]) {
    const rows = (
      await this.db.execute<{ id: string; panel: PanelCode; member: string; status: string }>(sql`
      select pm.id, pm.panel, si.source_member_id as member, pm.status
      from panel_membership pm join source_identity si on si.id = pm.source_identity_id
      where pm.master_person_id = ${personId} and pm.data_mode = ${mode}`)
    ).rows;
    return panels ? rows.filter((r) => panels.includes(r.panel)) : rows;
  }

  async create(mode: DataMode, body: PrivacyRequestCreate, actor: Actor) {
    const ms = await this.memberships(body.personId, mode, body.panels);
    if (!ms.length) throw new NotFoundException('This person has no membership on the panels named');
    const panels = [...new Set(ms.map((m) => m.panel))].sort();
    const open = await this.db.execute(sql`
      select 1 from privacy_request where master_person_id = ${body.personId} and kind = ${body.kind}
        and status in ('received', 'verified', 'awaiting_panel') and panels && ${`{${panels.join(',')}}`}::text[]`);
    if (open.rows.length) throw new ConflictException('An open request of this kind already covers these panels');
    const [r] = await this.db
      .insert(privacyRequests)
      .values({
        dataMode: mode,
        masterPersonId: body.personId,
        kind: body.kind,
        panels,
        reference: body.reference,
        jurisdiction: body.jurisdiction ?? null,
        dueAt: new Date(Date.now() + body.dueInDays * 86_400_000),
        createdBy: actor.id,
      })
      .returning();
    await this.step(r!.id, 'received', actor.id, body.reference, { panels, dueInDays: body.dueInDays });
    await this.record(actor, 'privacy.request_received', r!.id, { kind: body.kind, panels });
    return r!;
  }

  private async record(actor: Actor, action: string, id: string, metadata: Record<string, unknown>) {
    await this.audit.record({ actorId: actor.id, actorType: 'admin', action, targetType: 'privacy_request', targetId: id, metadata, ip: actor.ip });
  }

  private async load(id: string) {
    const r = await this.db.query.privacyRequests.findFirst({ where: eq(privacyRequests.id, id) });
    if (!r) throw new NotFoundException('No such request');
    return r;
  }

  private notOwn(r: { createdBy: string }, actor: Actor) {
    if (r.createdBy === actor.id) throw new ForbiddenException('A second person must verify and carry out a request you logged');
  }

  async list(mode: DataMode, q: { status?: string; limit: number }) {
    const rows = await this.db.execute<Record<string, unknown>>(sql`
      select id, master_person_id as "personId", kind, panels, status, reference, jurisdiction,
        received_at as "receivedAt", due_at as "dueAt", completed_at as "completedAt",
        (status in ('received', 'verified', 'awaiting_panel') and due_at < now()) as overdue
      from privacy_request where data_mode = ${mode} ${q.status ? sql`and status = ${q.status}` : sql``}
      order by (status in ('completed', 'rejected')), due_at limit ${q.limit}`);
    const [c] = (
      await this.db.execute<Record<string, string>>(sql`
      select count(*) filter (where status in ('received', 'verified', 'awaiting_panel')) as open,
        count(*) filter (where status in ('received', 'verified', 'awaiting_panel') and due_at < now()) as overdue,
        count(*) filter (where status = 'awaiting_panel') as awaiting_panel
      from privacy_request where data_mode = ${mode}`)
    ).rows;
    return {
      dataMode: mode,
      open: Number(c!.open),
      overdue: Number(c!.overdue),
      awaitingPanel: Number(c!.awaiting_panel),
      requests: rows.rows,
    };
  }

  async get(id: string) {
    const r = await this.load(id);
    const events = await this.db.query.privacyRequestEvents.findMany({
      where: eq(privacyRequestEvents.requestId, id),
      orderBy: (e, { asc }) => [asc(e.at), asc(e.id)],
    });
    const holds = await this.db.query.erasureHolds.findMany({ where: eq(erasureHolds.requestId, id) });
    return { ...r, events, holds: holds.map((h) => ({ panel: h.panel, panelDeletedAt: h.panelDeletedAt })) };
  }

  async verify(id: string, note: string, actor: Actor) {
    const r = await this.load(id);
    this.notOwn(r, actor);
    if (r.status !== 'received') throw new ConflictException(`This request is ${r.status}`);
    await this.db.update(privacyRequests).set({ status: 'verified', verifiedBy: actor.id }).where(eq(privacyRequests.id, id));
    await this.step(id, 'verified', actor.id, note);
    await this.record(actor, 'privacy.request_verified', id, {});
    return this.get(id);
  }

  async reject(id: string, note: string, actor: Actor) {
    const r = await this.load(id);
    this.notOwn(r, actor);
    if (!['received', 'verified'].includes(r.status)) throw new ConflictException(`This request is ${r.status}`);
    await this.db.update(privacyRequests).set({ status: 'rejected', completedAt: new Date() }).where(eq(privacyRequests.id, id));
    await this.step(id, 'rejected', actor.id, note);
    await this.record(actor, 'privacy.request_rejected', id, {});
    return this.get(id);
  }

  /** Carries out a verified request. */
  async execute(id: string, note: string, actor: Actor) {
    const r = await this.load(id);
    this.notOwn(r, actor);
    if (r.status !== 'verified') throw new ConflictException(r.status === 'received' ? 'Verify the requester first' : `This request is ${r.status}`);
    const ms = await this.memberships(r.masterPersonId, r.dataMode, r.panels as PanelCode[]);
    let status = 'completed';
    let result: Record<string, unknown> = {};
    if (r.kind === 'deletion') {
      const erased: string[] = [];
      for (const m of ms) {
        await this.db.insert(erasureHolds).values({ dataMode: r.dataMode, panel: m.panel, sourceMemberId: m.member, requestId: id }).onConflictDoNothing();
        if (await this.ingestion.removeMember(m.panel, r.dataMode, null, m.member, 'privacy_request')) erased.push(m.panel);
      }
      // MADP cannot delete the panel's own record. The step finishes when the panel's deletions feed reports it.
      status = 'awaiting_panel';
      result = { erasedInMadp: erased, panelDeletion: 'pending: the panel must delete the member; its deletions feed confirms it' };
    } else if (r.kind === 'restriction') {
      for (const m of ms)
        await this.db.insert(contactPreferences).values({
          dataMode: r.dataMode,
          panelMembershipId: m.id,
          panel: m.panel,
          channel: 'all',
          status: 'opted_out',
          source: 'privacy_request',
          reason: `Privacy request ${id}`,
          recordedBy: actor.id,
        });
      result = { restrictedMemberships: ms.length };
    } else if (r.kind === 'correction') {
      // The panel owns the member's profile: the correction is made there, and the next sync brings it in.
      status = 'awaiting_panel';
      result = { forwardTo: r.panels };
    } else {
      result = { exportSections: Object.keys(await this.exportData(r.masterPersonId, r.dataMode, r.panels as PanelCode[])) };
    }
    await this.db
      .update(privacyRequests)
      .set({ status, result, completedAt: status === 'completed' ? new Date() : null })
      .where(eq(privacyRequests.id, id));
    await this.step(id, status === 'completed' ? 'completed' : 'carried_out_in_madp', actor.id, note, result);
    await this.record(actor, 'privacy.request_carried_out', id, { kind: r.kind, status });
    return this.get(id);
  }

  /** Closes a correction once the panel made it. Deletions close themselves when the panel confirms. */
  async complete(id: string, note: string, actor: Actor) {
    const r = await this.load(id);
    this.notOwn(r, actor);
    if (r.status !== 'awaiting_panel' || r.kind !== 'correction')
      throw new ConflictException('Only a correction waiting on the panel can be closed by hand');
    await this.db.update(privacyRequests).set({ status: 'completed', completedAt: new Date() }).where(eq(privacyRequests.id, id));
    await this.step(id, 'completed', actor.id, note);
    await this.record(actor, 'privacy.request_completed', id, {});
    return this.get(id);
  }

  /** Called by ingestion when a panel's feed deletes a member. */
  private async panelDeleted(panel: PanelCode, mode: DataMode, member: string) {
    const [hold] = await this.db
      .update(erasureHolds)
      .set({ panelDeletedAt: new Date() })
      .where(and(eq(erasureHolds.dataMode, mode), eq(erasureHolds.panel, panel), eq(erasureHolds.sourceMemberId, member), isNull(erasureHolds.panelDeletedAt)))
      .returning();
    if (!hold) return;
    await this.step(hold.requestId, 'panel_deleted', null, '', { panel });
    const left = await this.db.execute(sql`select 1 from erasure_hold where request_id = ${hold.requestId} and panel_deleted_at is null`);
    if (!left.rows.length) {
      await this.db
        .update(privacyRequests)
        .set({ status: 'completed', completedAt: new Date() })
        .where(and(eq(privacyRequests.id, hold.requestId), eq(privacyRequests.status, 'awaiting_panel')));
      await this.step(hold.requestId, 'completed', null, 'Every panel confirmed the deletion');
    }
  }

  /** Everything MADP holds about the person on the request's panels, decrypted, for the member. */
  async exportFor(id: string, actor: Actor) {
    const r = await this.load(id);
    if (r.kind !== 'access' || !['verified', 'completed'].includes(r.status))
      throw new BadRequestException('Only a verified access request can be exported');
    const data = await this.exportData(r.masterPersonId, r.dataMode, r.panels as PanelCode[]);
    await this.step(id, 'exported', actor.id);
    await this.record(actor, 'privacy.export_generated', id, { sections: Object.keys(data) });
    return { requestId: id, generatedAt: new Date().toISOString(), dataMode: r.dataMode, ...data };
  }

  private async exportData(personId: string, mode: DataMode, panels: PanelCode[]) {
    const list = `{${panels.join(',')}}`;
    const identities = (
      await this.db.execute<Record<string, string | null>>(sql`
      select si.panel, si.source_member_id, si.email_enc, si.phone_enc, si.first_name_enc, si.last_name_enc, si.date_of_birth_enc,
        si.country, si.state, si.city, si.gender, si.timezone, pm.status as membership_status, pm.joined_at
      from source_identity si join panel_membership pm on pm.source_identity_id = si.id
      where pm.master_person_id = ${personId} and pm.data_mode = ${mode} and si.panel = any(${list}::panel_code[])`)
    ).rows.map((i) => ({
      panel: i.panel,
      memberId: i.source_member_id,
      status: i.membership_status,
      joinedAt: i.joined_at,
      email: this.crypto.decrypt(i.email_enc),
      phone: this.crypto.decrypt(i.phone_enc),
      firstName: this.crypto.decrypt(i.first_name_enc),
      lastName: this.crypto.decrypt(i.last_name_enc),
      dateOfBirth: this.crypto.decrypt(i.date_of_birth_enc),
      country: i.country,
      state: i.state,
      city: i.city,
      gender: i.gender,
      timezone: i.timezone,
    }));
    const q = async (query: ReturnType<typeof sql>) => (await this.db.execute<Record<string, unknown>>(query)).rows;
    const answers = await this.mongo.profileAnswers
      .find({ dataMode: mode, panel: { $in: panels }, sourceMemberId: { $in: identities.map((i) => String(i.memberId)) } }, { projection: { _id: 0 } })
      .toArray();
    return {
      identities,
      categories: await q(sql`select panel, category, is_minor as "isMinor" from category_membership
        where master_person_id = ${personId} and panel = any(${list}::panel_code[])`),
      consents: await q(sql`select panel, purpose, status, captured_at as "capturedAt" from consent_record
        where master_person_id = ${personId} and data_mode = ${mode} and panel = any(${list}::panel_code[])`),
      consentHistory: await q(sql`select panel, purpose, previous_status as "previousStatus", status, at from consent_event
        where master_person_id = ${personId} and data_mode = ${mode} and panel = any(${list}::panel_code[]) order by at`),
      contactPreferences: await q(sql`select cp.panel, cp.channel, cp.status, cp.recorded_at as "recordedAt" from contact_preference cp
        join panel_membership pm on pm.id = cp.panel_membership_id where pm.master_person_id = ${personId} and cp.panel = any(${list}::panel_code[])`),
      verificationEvidence: await q(sql`select ve.panel, ve.claim, ve.method, ve.status, ve.expires_on as "expiresOn",
        ve.created_at as "recordedAt", ve.decided_at as "decidedAt" from verification_evidence ve
        join panel_membership pm on pm.id = ve.panel_membership_id
        where pm.master_person_id = ${personId} and ve.data_mode = ${mode} and ve.panel = any(${list}::panel_code[])`),
      answers,
      communications: await q(sql`select panel, channel, state, occurred_at as "occurredAt" from communication_event
        where master_person_id = ${personId} and data_mode = ${mode} and not dry_run and panel = any(${list}::panel_code[]) order by occurred_at`),
      surveyParticipation: await q(sql`select sp.panel, sp.survey_slug as survey, sp.status, sp.points, sp.ended_at as "endedAt"
        from survey_participation sp join panel_membership pm on pm.id = sp.panel_membership_id
        where pm.master_person_id = ${personId} and sp.panel = any(${list}::panel_code[])`),
      rewards: await q(sql`select rl.panel, rl.bucket, rl.points, rl.entry_kind as kind, rl.category, rl.recorded_at as at
        from reward_ledger rl join loyalty_account la on la.id = rl.account_id join panel_membership pm on pm.id = la.panel_membership_id
        where pm.master_person_id = ${personId} and rl.panel = any(${list}::panel_code[]) order by rl.recorded_at, rl.seq`),
    };
  }

  /** The schedule, and how many rows each purgeable rule would remove today. */
  async retention(mode: DataMode) {
    const out = [];
    for (const r of RETENTION) {
      let eligible: number | null = null;
      if (r.key === 'service_idempotency')
        eligible = Number((await this.db.execute<{ n: string }>(sql`select count(*) as n from service_idempotency where created_at < now() - interval '30 days'`)).rows[0]!.n);
      if (r.key === 'dry_run_events')
        eligible = Number(
          (await this.db.execute<{ n: string }>(sql`select count(*) as n from communication_event where data_mode = ${mode} and dry_run and occurred_at < now() - interval '180 days'`)).rows[0]!.n,
        );
      out.push({ ...r, eligible });
    }
    return { dataMode: mode, rules: out };
  }

  async purge(mode: DataMode, key: string, actor: Actor) {
    const rule = RETENTION.find((r) => r.key === key);
    if (!rule) throw new NotFoundException('No such retention rule');
    if (!rule.purge) throw new ForbiddenException(`${rule.label} is kept as evidence and is never purged from MADP`);
    const res =
      key === 'service_idempotency'
        ? await this.db.execute(sql`delete from service_idempotency where created_at < now() - interval '30 days'`)
        : await this.db.execute(sql`delete from communication_event where data_mode = ${mode} and dry_run and occurred_at < now() - interval '180 days'`);
    await this.audit.record({ actorId: actor.id, actorType: 'admin', action: 'privacy.retention_purged', targetType: 'retention_rule', targetId: key, metadata: { rows: res.rowCount ?? 0 }, ip: actor.ip });
    return { key, removed: res.rowCount ?? 0 };
  }
}
