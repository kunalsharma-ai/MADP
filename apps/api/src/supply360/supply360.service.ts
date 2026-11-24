import { randomBytes, createHash } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { ApiEnv } from '@madp/config';
import {
  AUDIENCE_CATEGORIES,
  type ConsentCheck,
  type InvitationAuthorize,
  type MatchRequest,
  type PanelCode,
  type ParticipationEvents,
  type ReservationCreate,
  type ServiceClientCreate,
  type ServiceCountsRequest,
  type SuppressionReason,
} from '@madp/contracts';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import {
  audienceReservations,
  participationEvents,
  reservationMembers,
  serviceClients,
  serviceIdempotency,
  serviceReferences,
  surveyInvitations,
} from '../db/schema.js';
import { FieldCrypto } from '../crypto/field-crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { AudienceService } from '../audience/audience.service.js';
import { EngagementService } from '../engagement/engagement.service.js';
import { contactColumns, gate, type GateRow } from '../engagement/gate.js';
import type { ServicePrincipal } from './service-auth.guard.js';

const MAX_RESERVATION_DAYS = 14;
type Reason = SuppressionReason | 'reserved_elsewhere';
type Row = GateRow & Record<string, unknown> & { membership: string; panel: PanelCode; country: string | null; categories: string[] | null; reserved: boolean };

const newRef = () => `ref_${randomBytes(16).toString('base64url')}`;
const arr = (xs: string[]) => `{${xs.map((x) => `"${x.replace(/["\\]/g, '')}"`).join(',')}}`;

/**
 * What Supply360 may do with MADP: counts, eligibility and pseudonymous references for its projects, holds on
 * members (reservations), invitation authorisation against consent and contact rules, and participation events
 * back. No names, addresses, answers or health data ever leave through here.
 */
@Injectable()
export class Supply360Service {
  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
    private readonly audience: AudienceService,
    private readonly engagement: EngagementService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // --- client admin (MADP admins) ---------------------------------------------------------------------------

  async createClient(mode: 'demo' | 'live', body: ServiceClientCreate, actorId: string) {
    const secret = randomBytes(32).toString('base64url');
    const clientId = `s360_${randomBytes(9).toString('base64url')}`;
    const [row] = await this.db
      .insert(serviceClients)
      .values({
        dataMode: mode,
        name: body.name,
        clientId,
        secretEnc: this.crypto.encrypt(secret)!,
        scopes: body.scopes,
        panels: body.panels,
        rateLimitPerMinute: body.rateLimitPerMinute,
        createdBy: actorId,
      })
      .returning();
    await this.audit.record({
      actorId,
      actorType: 'admin',
      action: 'service_client.created',
      targetType: 'service_client',
      targetId: row!.id,
      metadata: { name: body.name, scopes: body.scopes, panels: body.panels, dataMode: mode },
    });
    return { ...this.publicClient(row!), secret, secretShownOnce: true };
  }

  async listClients() {
    const rows = await this.db.select().from(serviceClients).orderBy(desc(serviceClients.createdAt));
    // Activity per client, as counts only.
    const stats = await this.db.execute<{ id: string; reservations: string; held: string; invitations: string; clicked: string; rejected7d: string }>(sql`
      select sc.id,
        (select count(*) from audience_reservation ar where ar.client_id = sc.id and ar.status = 'active' and ar.expires_at > now()) as reservations,
        (select count(*) from reservation_member rm join audience_reservation ar on ar.id = rm.reservation_id
          where ar.client_id = sc.id and ar.status = 'active' and ar.expires_at > now()) as held,
        (select count(*) from survey_invitation si where si.client_id = sc.id) as invitations,
        (select count(*) from survey_invitation si where si.client_id = sc.id and si.clicked_at is not null) as clicked,
        (select count(*) from audit_event ae where ae.action = 'service.rejected' and ae.actor_id = sc.id
          and ae.at > now() - interval '7 days') as "rejected7d"
      from service_client sc`);
    const by = new Map(stats.rows.map((r) => [r.id, r]));
    return rows.map((r) => {
      const x = by.get(r.id);
      return {
        ...this.publicClient(r),
        activity: {
          activeReservations: Number(x?.reservations ?? 0),
          membersHeld: Number(x?.held ?? 0),
          invitations: Number(x?.invitations ?? 0),
          clicked: Number(x?.clicked ?? 0),
          rejectedLast7Days: Number(x?.rejected7d ?? 0),
        },
      };
    });
  }

  async revokeClient(id: string, actorId: string) {
    const [row] = await this.db
      .update(serviceClients)
      .set({ status: 'revoked', revokedAt: new Date() })
      .where(and(eq(serviceClients.id, id), eq(serviceClients.status, 'active')))
      .returning();
    if (!row) throw new NotFoundException('No active client with this id');
    await this.audit.record({ actorId, actorType: 'admin', action: 'service_client.revoked', targetType: 'service_client', targetId: id, metadata: {} });
    return this.publicClient(row);
  }

  private publicClient(r: typeof serviceClients.$inferSelect) {
    const { secretEnc: _secret, ...rest } = r;
    void _secret;
    return rest;
  }

  // --- idempotency --------------------------------------------------------------------------------------------

  /** Runs `fn` once per idempotency key: the same key and body return the first answer; another body is 409. */
  async idempotent<T>(svc: ServicePrincipal, key: string | undefined, route: string, body: unknown, fn: () => Promise<T>): Promise<T> {
    if (!key) return fn();
    if (!/^[A-Za-z0-9._:-]{8,100}$/.test(key)) throw new BadRequestException('Invalid idempotency-key');
    const hash = createHash('sha256').update(JSON.stringify(body ?? null)).digest('hex');
    const prior = await this.db.query.serviceIdempotency.findFirst({
      where: and(eq(serviceIdempotency.clientId, svc.id), eq(serviceIdempotency.key, key)),
    });
    if (prior) {
      if (prior.requestHash !== hash || prior.route !== route)
        throw new ConflictException('This idempotency-key was used for a different request');
      return prior.response as T;
    }
    const res = await fn();
    await this.db
      .insert(serviceIdempotency)
      .values({ clientId: svc.id, key, route, requestHash: hash, status: 200, response: res as object })
      .onConflictDoNothing();
    return res;
  }

  private async log(svc: ServicePrincipal, action: string, metadata: Record<string, unknown>, targetId = svc.id) {
    await this.audit.record({ actorId: svc.id, actorType: 'service', action, targetType: 'service_client', targetId, metadata });
  }

  private panelsFor(svc: ServicePrincipal, asked?: PanelCode[]) {
    const panels = asked?.length ? asked : svc.panels;
    const outside = panels.filter((p) => !svc.panels.includes(p));
    if (outside.length) throw new ForbiddenException(`This client may not read ${outside.join(', ')}`);
    return panels;
  }

  // --- catalogue and counts -----------------------------------------------------------------------------------

  async attributes(svc: ServicePrincipal) {
    const rows = await this.db.query.attributeDefinitions.findMany({ orderBy: (a, { asc }) => [asc(a.key)] });
    const health = svc.scopes.includes('health.aggregate');
    return {
      categories: AUDIENCE_CATEGORIES,
      attributes: rows
        .filter((a) => health || a.sensitivity !== 'special_category')
        .map((a) => ({ key: a.key, label: a.label, sensitivity: a.sensitivity })),
    };
  }

  async counts(svc: ServicePrincipal, body: ServiceCountsRequest) {
    const panels = this.panelsFor(svc, body.panels);
    const health = svc.scopes.includes('health.aggregate');
    // Health filters only for study feasibility, and only with the health.aggregate scope.
    if (body.purpose && body.purpose !== 'study_feasibility')
      throw new ForbiddenException('Supply360 may only state study_feasibility');
    const caller = { permissions: health ? ['health.sensitive.read'] : [] };
    const res = await this.audience.counts({ ...body, panels }, svc.dataMode, undefined, caller);
    const sensitive = res.attributeFilters?.some((a) => a.sensitivity === 'special_category') ?? false;
    await this.log(svc, 'service.counts', { panels, uniquePeople: res.uniquePeople, sensitive, purpose: body.purpose ?? null });
    return res;
  }

  // --- match --------------------------------------------------------------------------------------------------

  /**
   * Eligible members for a project as pseudonymous references, with panel, categories and country for quotas.
   * Eligible means an active adult membership with the panel's terms, a usable address, no opt-out or bounce,
   * room under the panel's contact caps, and no hold by another active reservation. Fewer eligible members than
   * the minimum cell returns no references. Health (special-category) criteria are refused here.
   */
  async match(svc: ServicePrincipal, body: MatchRequest) {
    const panels = this.panelsFor(svc, body.panels);
    const attr = await this.audience.resolveAttributes(svc.dataMode, body.attributes ?? [], { permissions: [] });
    const rows = await this.eligibilityRows(svc, sql`${this.audience.where(svc.dataMode, { ...body, panels }, attr?.personIds ?? null)}`, body.projectRef);
    const { eligible, reasons } = await this.split(rows);
    const min = this.env.MIN_CELL_SIZE;
    const enough = eligible.length >= min;
    const picked = enough ? eligible.slice(0, body.limit) : [];
    const refs = await this.refsFor(svc, picked.map((r) => r.membership));
    const out = {
      dataMode: svc.dataMode,
      projectRef: body.projectRef,
      eligible: enough ? eligible.length : null,
      suppressed: !enough,
      minimumCellSize: min,
      returned: picked.length,
      excluded: reasons,
      members: picked.map((r) => ({
        ref: refs.get(r.membership)!,
        panel: r.panel,
        categories: r.categories ?? [],
        country: r.country,
      })),
    };
    await this.log(svc, 'service.match', { projectRef: body.projectRef, panels, eligible: out.eligible, returned: out.returned });
    return out;
  }

  /** Members with everything the contact gate needs, in a stable per-project order. */
  private async eligibilityRows(svc: ServicePrincipal, where: ReturnType<typeof sql>, projectRef: string, now = new Date()) {
    return (
      await this.db.execute<Row>(sql`
      select pm.id as membership, pm.panel, mp.country, ${contactColumns('terms', now)},
        (select array_agg(distinct cm.category::text) from category_membership cm
          where cm.master_person_id = pm.master_person_id and cm.panel = pm.panel) as categories,
        exists (select 1 from reservation_member rm join audience_reservation ar on ar.id = rm.reservation_id
          where rm.panel_membership_id = pm.id and ar.status = 'active' and ar.expires_at > ${now}
            and not (ar.client_id = ${svc.id} and ar.project_ref = ${projectRef})) as reserved
      from panel_membership pm
      join master_person mp on mp.id = pm.master_person_id
      join source_identity si on si.id = pm.source_identity_id
      where ${where}
      order by md5(pm.id::text || ${projectRef})`)
    ).rows;
  }

  private async split(rows: Row[]) {
    const policies = new Map<PanelCode, { maxPerWeek: number; maxPerMonth: number }>();
    const eligible: Row[] = [];
    const reasons: Partial<Record<Reason, number>> = {};
    for (const r of rows) {
      if (!policies.has(r.panel)) policies.set(r.panel, await this.engagement.policy(r.panel));
      const reason: Reason | null = gate(r, 'onboarding', 'terms', policies.get(r.panel)!) ?? (r.reserved ? 'reserved_elsewhere' : null);
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
      else eligible.push(r);
    }
    return { eligible, reasons };
  }

  private async refsFor(svc: ServicePrincipal, memberships: string[]) {
    const out = new Map<string, string>();
    if (!memberships.length) return out;
    for (let i = 0; i < memberships.length; i += 1000) {
      const chunk = memberships.slice(i, i + 1000);
      await this.db
        .insert(serviceReferences)
        .values(chunk.map((m) => ({ ref: newRef(), clientId: svc.id, dataMode: svc.dataMode, panelMembershipId: m })))
        .onConflictDoNothing();
      const rows = await this.db.execute<{ ref: string; m: string }>(sql`
        select ref, panel_membership_id as m from service_reference
        where client_id = ${svc.id} and panel_membership_id = any(${arr(chunk)}::uuid[])`);
      for (const r of rows.rows) out.set(r.m, r.ref);
    }
    return out;
  }

  /** This client's references, resolved to memberships. Unknown references are listed, never guessed. */
  private async resolve(svc: ServicePrincipal, refs: string[]) {
    const rows = await this.db.execute<{ ref: string; m: string; panel: PanelCode }>(sql`
      select sr.ref, sr.panel_membership_id as m, pm.panel from service_reference sr
      join panel_membership pm on pm.id = sr.panel_membership_id
      where sr.client_id = ${svc.id} and sr.ref = any(${arr(refs)}::text[])`);
    const known = new Map(rows.rows.map((r) => [r.ref, { membership: r.m, panel: r.panel }]));
    return { known, unknown: refs.filter((r) => !known.has(r)) };
  }

  // --- reservations -------------------------------------------------------------------------------------------

  async reserve(svc: ServicePrincipal, body: ReservationCreate) {
    const expiresAt = new Date(body.expiresAt);
    if (expiresAt.getTime() <= Date.now() || expiresAt.getTime() > Date.now() + MAX_RESERVATION_DAYS * 86_400_000)
      throw new BadRequestException(`expiresAt must be in the future and at most ${MAX_RESERVATION_DAYS} days ahead`);
    const { known, unknown } = await this.resolve(svc, [...new Set(body.refs)]);
    const ids = [...known.values()].map((k) => k.membership);
    const held = ids.length
      ? (
          await this.db.execute<{ m: string }>(sql`
          select distinct rm.panel_membership_id as m from reservation_member rm
          join audience_reservation ar on ar.id = rm.reservation_id
          where rm.panel_membership_id = any(${arr(ids)}::uuid[]) and ar.status = 'active' and ar.expires_at > now()
            and not (ar.client_id = ${svc.id} and ar.project_ref = ${body.projectRef})`)
        ).rows.map((r) => r.m)
      : [];
    const heldSet = new Set(held);
    const free = [...known.entries()].filter(([, k]) => !heldSet.has(k.membership));
    const res = await this.db.transaction(async (tx) => {
      const [r] = await tx
        .insert(audienceReservations)
        .values({ dataMode: svc.dataMode, clientId: svc.id, projectRef: body.projectRef, expiresAt })
        .returning();
      if (free.length)
        await tx.insert(reservationMembers).values(free.map(([ref, k]) => ({ reservationId: r!.id, panelMembershipId: k.membership, ref })));
      return r!;
    });
    const out = {
      reservationId: res.id,
      projectRef: body.projectRef,
      expiresAt: res.expiresAt.toISOString(),
      held: free.length,
      refused: [
        ...unknown.map((ref) => ({ ref, reason: 'unknown_ref' })),
        ...[...known.entries()].filter(([, k]) => heldSet.has(k.membership)).map(([ref]) => ({ ref, reason: 'reserved_elsewhere' })),
      ],
    };
    await this.log(svc, 'service.reservation_created', { projectRef: body.projectRef, held: out.held, refused: out.refused.length }, res.id);
    return out;
  }

  private async reservation(svc: ServicePrincipal, id: string) {
    const r = await this.db.query.audienceReservations.findFirst({
      where: and(eq(audienceReservations.id, id), eq(audienceReservations.clientId, svc.id)),
    });
    if (!r) throw new NotFoundException('No such reservation for this client');
    const status = r.status === 'active' && r.expiresAt.getTime() <= Date.now() ? 'expired' : r.status;
    return { ...r, status };
  }

  async getReservation(svc: ServicePrincipal, id: string) {
    const r = await this.reservation(svc, id);
    const [n] = (await this.db.execute<{ n: string }>(sql`select count(*) as n from reservation_member where reservation_id = ${id}`)).rows;
    return { reservationId: r.id, projectRef: r.projectRef, status: r.status, expiresAt: r.expiresAt.toISOString(), held: Number(n!.n) };
  }

  async release(svc: ServicePrincipal, id: string) {
    const r = await this.reservation(svc, id);
    if (r.status !== 'active') throw new ConflictException(`This reservation is ${r.status}`);
    await this.db.update(audienceReservations).set({ status: 'released', releasedAt: new Date() }).where(eq(audienceReservations.id, id));
    await this.log(svc, 'service.reservation_released', { projectRef: r.projectRef }, id);
    return { reservationId: id, status: 'released' };
  }

  // --- invitations --------------------------------------------------------------------------------------------

  /**
   * Checks each reserved member again against consent and contact rules, and records an invitation for those who
   * pass. MADP does not send anything here and hands out no address: delivery goes through MADP's own messaging
   * once sending is approved.
   */
  async authorize(svc: ServicePrincipal, body: InvitationAuthorize) {
    const r = await this.reservation(svc, body.reservationId);
    if (r.status !== 'active') throw new ConflictException(`This reservation is ${r.status}`);
    const refs = [...new Set(body.refs)];
    const members = await this.db.execute<{ ref: string; m: string }>(sql`
      select ref, panel_membership_id as m from reservation_member where reservation_id = ${r.id} and ref = any(${arr(refs)}::text[])`);
    const inRes = new Map(members.rows.map((x) => [x.m, x.ref]));
    const rows = inRes.size
      ? await this.eligibilityRows(svc, sql`pm.id = any(${arr([...inRes.keys()])}::uuid[])`, r.projectRef)
      : [];
    const refused: { ref: string; reason: string }[] = refs.filter((x) => ![...inRes.values()].includes(x)).map((ref) => ({ ref, reason: 'not_in_reservation' }));
    const ok: Row[] = [];
    const policies = new Map<PanelCode, { maxPerWeek: number; maxPerMonth: number }>();
    for (const row of rows) {
      if (!policies.has(row.panel)) policies.set(row.panel, await this.engagement.policy(row.panel));
      const reason = gate(row, 'onboarding', 'terms', policies.get(row.panel)!);
      if (reason) refused.push({ ref: inRes.get(row.membership)!, reason });
      else ok.push(row);
    }
    if (ok.length)
      await this.db
        .insert(surveyInvitations)
        .values(
          ok.map((row) => ({
            dataMode: svc.dataMode,
            panel: row.panel,
            panelMembershipId: row.membership,
            clientId: svc.id,
            reservationId: r.id,
            projectRef: r.projectRef,
            ref: inRes.get(row.membership)!,
          })),
        )
        .onConflictDoNothing();
    const inv = ok.length
      ? await this.db.execute<{ id: string; ref: string }>(sql`
          select id, ref from survey_invitation where reservation_id = ${r.id} and panel_membership_id = any(${arr(ok.map((o) => o.membership))}::uuid[])`)
      : { rows: [] };
    const out = {
      reservationId: r.id,
      authorized: inv.rows.map((i) => ({ ref: i.ref, invitationId: i.id })),
      refused,
      delivery: 'MADP sends invitations itself once sending is approved; no address is shared.',
    };
    await this.log(svc, 'service.invitations_authorized', { projectRef: r.projectRef, authorized: out.authorized.length, refused: refused.length }, r.id);
    return out;
  }

  // --- participation ------------------------------------------------------------------------------------------

  /**
   * Participation events for invitations of this client. Each event id counts once. A click marks the invitation
   * clicked, which stops invitation reminders. Events never credit rewards: the panel's ledger does that.
   */
  async participation(svc: ServicePrincipal, body: ParticipationEvents) {
    const ids = [...new Set(body.events.map((e) => e.invitationId))];
    const own = await this.db.execute<{ id: string }>(sql`
      select id from survey_invitation where client_id = ${svc.id} and id = any(${arr(ids)}::uuid[])`);
    const mine = new Set(own.rows.map((r) => r.id));
    const valid = body.events.filter((e) => mine.has(e.invitationId));
    const written = valid.length
      ? await this.db
          .insert(participationEvents)
          .values(valid.map((e) => ({ clientId: svc.id, eventId: e.eventId, invitationId: e.invitationId, event: e.event, occurredAt: new Date(e.occurredAt) })))
          .onConflictDoNothing()
          .returning({ invitationId: participationEvents.invitationId })
      : [];
    for (const id of new Set(written.map((w) => w.invitationId)))
      await this.db.execute(sql`
        update survey_invitation si set
          status = (select pe.event from participation_event pe where pe.invitation_id = si.id order by pe.occurred_at desc, pe.created_at desc limit 1),
          clicked_at = coalesce(si.clicked_at, (select min(pe.occurred_at) from participation_event pe where pe.invitation_id = si.id
            and pe.event in ('click', 'start', 'partial', 'complete', 'terminate', 'quota_full', 'quality_fail'))),
          updated_at = now()
        where si.id = ${id}`);
    const out = { accepted: written.length, duplicates: valid.length - written.length, unknownInvitations: body.events.length - valid.length };
    await this.log(svc, 'service.participation_received', out);
    return out;
  }

  // --- consent ------------------------------------------------------------------------------------------------

  async consentCheck(svc: ServicePrincipal, body: ConsentCheck) {
    const { known, unknown } = await this.resolve(svc, [...new Set(body.refs)]);
    const purpose = body.purpose === 'survey_invitation' ? 'terms' : 'email_marketing';
    const ids = [...known.values()].map((k) => k.membership);
    const rows = ids.length
      ? (
          await this.db.execute<{ m: string; status: string; minor: boolean; consent: string | null; opted_out: boolean }>(sql`
          select pm.id as m, pm.status, ${contactColumns(purpose, new Date())}
          from panel_membership pm join source_identity si on si.id = pm.source_identity_id
          where pm.id = any(${arr(ids)}::uuid[])`)
        ).rows
      : [];
    const byM = new Map(rows.map((r) => [r.m, r]));
    const results = [...known.entries()].map(([ref, k]) => {
      const r = byM.get(k.membership)!;
      const consent = (r.consent ?? 'unknown') as string;
      const eligible = r.status === 'active' && !r.minor && !r.opted_out && consent === 'granted';
      return { ref, panel: k.panel, consent, eligible };
    });
    await this.log(svc, 'service.consent_checked', { purpose: body.purpose, refs: body.refs.length });
    return { purpose: body.purpose, results, unknownRefs: unknown };
  }
}
