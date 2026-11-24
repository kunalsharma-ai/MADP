import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  BASIS_CONSENT,
  BRAND_KITS,
  KIND_BASIS,
  type CampaignCreate,
  type CampaignKind,
  type DataMode,
  type FatiguePolicyUpdate,
  type PanelCode,
  type SuppressionReason,
  type TemplateCreate,
  type TemplateVersionCreate,
  type TimelineQuery,
} from '@madp/contracts';
import { Database } from '../db/database.js';
import {
  campaignRuns,
  campaigns,
  communicationEvents,
  fatiguePolicies,
  messageTemplates,
  messageTemplateVersions,
} from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { lintTemplate, render } from './render.js';
import { nextSendTime } from './schedule.js';
import { fatigueScore } from './fatigue.js';

interface Actor {
  id: string;
  ip: string | null;
}

/** Real delivery states that count towards frequency caps. Dry-run rows never count. */
const CONTACT_STATES = ['queued', 'sent', 'delivered', 'opened', 'clicked'];

const DEFAULT_POLICY = { maxPerWeek: 2, maxPerMonth: 6, quietStartHour: 21, quietEndHour: 8, bands: { high: 60, medium: 30 } };

@Injectable()
export class EngagementService {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // --- templates --------------------------------------------------------------------------------------------

  async createTemplate(body: TemplateCreate, actor: Actor) {
    const [row] = await this.db
      .insert(messageTemplates)
      .values({ ...body, channel: 'email', createdBy: actor.id })
      .onConflictDoNothing()
      .returning();
    if (!row) throw new ConflictException(`A ${body.panel.toUpperCase()} template with key ${body.key} exists`);
    await this.log(actor, 'template.created', 'message_template', row.id, { panel: row.panel, kind: row.kind });
    return row;
  }

  async listTemplates(panel?: PanelCode) {
    const templates = await this.db
      .select()
      .from(messageTemplates)
      .where(panel ? eq(messageTemplates.panel, panel) : sql`true`)
      .orderBy(asc(messageTemplates.panel), asc(messageTemplates.key));
    const versions = await this.db
      .select({
        id: messageTemplateVersions.id,
        templateId: messageTemplateVersions.templateId,
        version: messageTemplateVersions.version,
        language: messageTemplateVersions.language,
        subject: messageTemplateVersions.subject,
        status: messageTemplateVersions.status,
        createdBy: messageTemplateVersions.createdBy,
        reviewedBy: messageTemplateVersions.reviewedBy,
        reviewedAt: messageTemplateVersions.reviewedAt,
        reviewNote: messageTemplateVersions.reviewNote,
        createdAt: messageTemplateVersions.createdAt,
      })
      .from(messageTemplateVersions)
      .orderBy(desc(messageTemplateVersions.version));
    return {
      brandKits: BRAND_KITS,
      items: templates.map((t) => ({ ...t, versions: versions.filter((v) => v.templateId === t.id) })),
    };
  }

  /** New versions start as drafts. Editing an approved version is not possible: add a new version instead. */
  async addVersion(templateId: string, body: TemplateVersionCreate, actor: Actor) {
    const t = await this.db.query.messageTemplates.findFirst({ where: eq(messageTemplates.id, templateId) });
    if (!t) throw new NotFoundException();
    const [{ next } = { next: 1 }] = (
      await this.db.execute<{ next: number }>(
        sql`select coalesce(max(version), 0) + 1 as next from message_template_version where template_id = ${templateId}`,
      )
    ).rows;
    const [row] = await this.db
      .insert(messageTemplateVersions)
      .values({ templateId, version: Number(next), ...body, status: 'draft', createdBy: actor.id })
      .returning();
    await this.log(actor, 'template.version_added', 'message_template_version', row!.id, { version: row!.version });
    return { ...row!, problems: lintTemplate(t.kind as CampaignKind, body) };
  }

  async submitVersion(versionId: string, actor: Actor) {
    const { v, t } = await this.version(versionId);
    if (v.status !== 'draft' && v.status !== 'rejected')
      throw new ConflictException(`Only a draft or rejected version can go to review (this one is ${v.status})`);
    const problems = lintTemplate(t.kind as CampaignKind, v);
    if (problems.length) throw new BadRequestException({ message: 'Fix these before review', problems });
    await this.db.update(messageTemplateVersions).set({ status: 'in_review' }).where(eq(messageTemplateVersions.id, v.id));
    await this.log(actor, 'template.submitted', 'message_template_version', v.id, {});
    return { status: 'in_review' };
  }

  /** Four eyes: the author of a version cannot approve it. Approving retires the template's previous approved one. */
  async reviewVersion(versionId: string, decision: 'approve' | 'reject', note: string | undefined, actor: Actor) {
    const { v, t } = await this.version(versionId);
    if (v.status !== 'in_review') throw new ConflictException(`This version is ${v.status}, not in review`);
    if (v.createdBy === actor.id) throw new ForbiddenException('Someone other than the author must review a version');
    if (decision === 'approve' && lintTemplate(t.kind as CampaignKind, v).length)
      throw new BadRequestException('This version no longer passes the template checks');
    await this.db.transaction(async (tx) => {
      if (decision === 'approve')
        await tx
          .update(messageTemplateVersions)
          .set({ status: 'retired' })
          .where(and(eq(messageTemplateVersions.templateId, t.id), eq(messageTemplateVersions.status, 'approved')));
      await tx
        .update(messageTemplateVersions)
        .set({
          status: decision === 'approve' ? 'approved' : 'rejected',
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
        })
        .where(eq(messageTemplateVersions.id, v.id));
    });
    await this.log(actor, `template.${decision === 'approve' ? 'approved' : 'rejected'}`, 'message_template_version', v.id, {
      note: note ?? null,
    });
    return { status: decision === 'approve' ? 'approved' : 'rejected' };
  }

  /** Renders a version with sample values only; never with a member's data. */
  async preview(versionId: string) {
    const { v, t } = await this.version(versionId);
    const brand = BRAND_KITS[t.panel];
    const sample = 'https://example.invalid';
    return {
      brand,
      brandWarning: brand.confirmed
        ? null
        : 'Sender, footer, logo and colours for this panel are not confirmed by the panel owner yet.',
      problems: lintTemplate(t.kind as CampaignKind, v),
      ...render(v, {
        firstName: 'Sample',
        panelName: brand.displayName,
        unsubscribeUrl: `${sample}/unsubscribe`,
        preferencesUrl: `${sample}/preferences`,
        profileUrl: `${sample}/profile`,
      }),
    };
  }

  private async version(versionId: string) {
    const v = await this.db.query.messageTemplateVersions.findFirst({
      where: eq(messageTemplateVersions.id, versionId),
    });
    if (!v) throw new NotFoundException();
    const t = (await this.db.query.messageTemplates.findFirst({ where: eq(messageTemplates.id, v.templateId) }))!;
    return { v, t };
  }

  // --- policy -------------------------------------------------------------------------------------------------

  async policy(panel: PanelCode) {
    const row = await this.db.query.fatiguePolicies.findFirst({ where: eq(fatiguePolicies.panel, panel) });
    return row
      ? { ...row, bands: row.bands as { high: number; medium: number } }
      : { panel, ...DEFAULT_POLICY, updatedBy: null, updatedAt: null };
  }

  async setPolicy(panel: PanelCode, body: FatiguePolicyUpdate, actor: Actor) {
    const values = { ...body, updatedBy: actor.id, updatedAt: new Date() };
    await this.db
      .insert(fatiguePolicies)
      .values({ panel, ...values })
      .onConflictDoUpdate({ target: fatiguePolicies.panel, set: values });
    await this.log(actor, 'fatigue_policy.updated', 'panel', panel, { ...body });
    return this.policy(panel);
  }

  // --- campaigns ----------------------------------------------------------------------------------------------

  async createCampaign(mode: DataMode, body: CampaignCreate, actor: Actor) {
    const { v, t } = await this.version(body.templateVersionId);
    if (v.status !== 'approved') throw new BadRequestException('A campaign needs an approved template version');
    const [row] = await this.db
      .insert(campaigns)
      .values({
        dataMode: mode,
        panel: t.panel,
        name: body.name,
        kind: t.kind,
        templateVersionId: v.id,
        audience: body.audience,
        status: 'draft',
        createdBy: actor.id,
      })
      .returning();
    await this.log(actor, 'campaign.created', 'campaign', row!.id, { panel: t.panel, kind: t.kind });
    return row!;
  }

  async listCampaigns(mode: DataMode, panel?: PanelCode) {
    const rows = await this.db
      .select()
      .from(campaigns)
      .where(and(eq(campaigns.dataMode, mode), panel ? eq(campaigns.panel, panel) : sql`true`))
      .orderBy(desc(campaigns.createdAt));
    const runs = await this.db.select().from(campaignRuns).orderBy(desc(campaignRuns.startedAt));
    return {
      dataMode: mode,
      sendingEnabled: false,
      items: rows.map((c) => ({ ...c, lastRun: runs.find((r) => r.campaignId === c.id) ?? null })),
    };
  }

  async decideCampaign(id: string, decision: 'approve' | 'pause' | 'resume' | 'archive', actor: Actor) {
    const c = await this.db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
    if (!c) throw new NotFoundException();
    const next: Record<string, { from: string[]; to: string }> = {
      approve: { from: ['draft'], to: 'approved' },
      pause: { from: ['approved'], to: 'paused' },
      resume: { from: ['paused'], to: 'approved' },
      archive: { from: ['draft', 'approved', 'paused'], to: 'archived' },
    };
    const rule = next[decision]!;
    if (!rule.from.includes(c.status)) throw new ConflictException(`Cannot ${decision} a ${c.status} campaign`);
    if (decision === 'approve' && c.createdBy === actor.id)
      throw new ForbiddenException('Someone other than the author must approve a campaign');
    if (decision === 'approve') {
      const { v } = await this.version(c.templateVersionId);
      if (v.status !== 'approved') throw new ConflictException('Its template version is no longer approved');
    }
    await this.db
      .update(campaigns)
      .set({
        status: rule.to,
        updatedAt: new Date(),
        ...(decision === 'approve' ? { approvedBy: actor.id, approvedAt: new Date() } : {}),
      })
      .where(eq(campaigns.id, id));
    await this.log(actor, `campaign.${decision}`, 'campaign', id, {});
    return { status: rule.to };
  }

  /**
   * Works out, for every member of the campaign's panel and audience, whether they would get the message and when,
   * or which rule would stop it. Writes one dry-run timeline line per member. Sending is not built yet.
   */
  async run(id: string, dryRun: boolean, actor: Actor, now = new Date()) {
    if (!dryRun)
      throw new ForbiddenException(
        'Sending is off: no message provider is configured and the owner has not approved sending. Use a dry run.',
      );
    const c = await this.db.query.campaigns.findFirst({ where: eq(campaigns.id, id) });
    if (!c) throw new NotFoundException();
    if (c.status !== 'approved') throw new ConflictException(`Only an approved campaign can run (this one is ${c.status})`);
    const policy = await this.policy(c.panel);
    const basis = KIND_BASIS[c.kind as CampaignKind];
    const consent = BASIS_CONSENT[basis];
    const audience = c.audience as { categories?: string[]; countries?: string[] };
    const conds = [sql`pm.data_mode = ${c.dataMode}`, sql`pm.panel = ${c.panel}`];
    if (audience.categories?.length)
      conds.push(sql`exists (select 1 from category_membership cm where cm.master_person_id = pm.master_person_id
        and cm.panel = pm.panel and cm.category::text = any(${`{${audience.categories.join(',')}}`}::text[]))`);
    if (audience.countries?.length)
      conds.push(sql`mp.country = any(${`{${audience.countries.join(',')}}`}::text[])`);
    const rows = await this.db.execute<{
      person: string;
      status: string;
      has_email: boolean;
      email_rejected: boolean;
      timezone: string | null;
      minor: boolean;
      consent: string | null;
      week: string;
      month: string;
      opted_out: boolean;
      bounced: boolean;
      already: boolean;
    }>(sql`
      select pm.master_person_id as person, pm.status, si.email_enc is not null as has_email,
        si.email_verification = 'rejected' as email_rejected, si.timezone,
        exists (select 1 from category_membership cm where cm.master_person_id = pm.master_person_id and cm.panel = pm.panel and cm.is_minor) as minor,
        (select cr.status::text from consent_record cr where cr.master_person_id = pm.master_person_id and cr.panel = pm.panel
          and cr.purpose = ${consent ?? ''} limit 1) as consent,
        (select count(*) from communication_event e where e.master_person_id = pm.master_person_id and e.panel = pm.panel
          and not e.dry_run and e.state = any(${`{${CONTACT_STATES.join(',')}}`}::text[]) and e.occurred_at > ${new Date(now.getTime() - 7 * 86_400_000)}) as week,
        (select count(*) from communication_event e where e.master_person_id = pm.master_person_id and e.panel = pm.panel
          and not e.dry_run and e.state = any(${`{${CONTACT_STATES.join(',')}}`}::text[]) and e.occurred_at > ${new Date(now.getTime() - 30 * 86_400_000)}) as month,
        exists (select 1 from communication_event e where e.master_person_id = pm.master_person_id and e.panel = pm.panel
          and not e.dry_run and e.state = 'opted_out') as opted_out,
        exists (select 1 from communication_event e where e.master_person_id = pm.master_person_id and e.panel = pm.panel
          and not e.dry_run and e.state in ('bounced', 'complained')) as bounced,
        exists (select 1 from communication_event e where e.master_person_id = pm.master_person_id and e.campaign_id = ${c.id}
          and not e.dry_run and e.state = any(${`{${CONTACT_STATES.join(',')}}`}::text[])) as already
      from panel_membership pm
      join source_identity si on si.id = pm.source_identity_id
      join master_person mp on mp.id = pm.master_person_id
      where ${sql.join(conds, sql` and `)}`);
    const [run] = await this.db
      .insert(campaignRuns)
      .values({ campaignId: c.id, dryRun: true, requestedBy: actor.id })
      .returning({ id: campaignRuns.id });
    const reasons: Partial<Record<SuppressionReason, number>> = {};
    const events: (typeof communicationEvents.$inferInsert)[] = [];
    let planned = 0;
    let delayedByQuietHours = 0;
    for (const r of rows.rows) {
      let reason: SuppressionReason | null = null;
      if (r.status !== 'active') reason = 'membership_not_active';
      else if (r.minor && basis !== 'service') reason = 'minor_excluded';
      else if (r.opted_out && basis !== 'service') reason = 'opted_out';
      else if (consent && r.consent !== 'granted') reason = 'no_consent';
      else if (!r.has_email || r.email_rejected) reason = 'no_email';
      else if (r.bounced) reason = 'bounced_or_complained';
      else if (r.already) reason = 'already_sent';
      else if (basis !== 'service' && Number(r.week) >= policy.maxPerWeek) reason = 'frequency_cap_week';
      else if (basis !== 'service' && Number(r.month) >= policy.maxPerMonth) reason = 'frequency_cap_month';
      const plannedFor = reason ? null : nextSendTime(now, r.timezone, policy.quietStartHour, policy.quietEndHour);
      if (reason) reasons[reason] = (reasons[reason] ?? 0) + 1;
      else {
        planned++;
        if (plannedFor!.getTime() !== now.getTime()) delayedByQuietHours++;
      }
      events.push({
        dataMode: c.dataMode,
        masterPersonId: r.person,
        panel: c.panel,
        campaignId: c.id,
        runId: run!.id,
        channel: 'email',
        state: reason ? 'suppressed' : 'planned',
        reason,
        dryRun: true,
        plannedFor,
        occurredAt: now,
      });
    }
    for (let i = 0; i < events.length; i += 1000) await this.db.insert(communicationEvents).values(events.slice(i, i + 1000));
    const counts = {
      audience: rows.rows.length,
      planned,
      suppressed: rows.rows.length - planned,
      delayedByQuietHours,
      reasons,
      consentRequired: consent,
      basis,
    };
    await this.db.update(campaignRuns).set({ counts, finishedAt: new Date() }).where(eq(campaignRuns.id, run!.id));
    await this.log(actor, 'campaign.dry_run', 'campaign', c.id, { runId: run!.id, ...counts });
    return { runId: run!.id, dryRun: true, ...counts };
  }

  // --- timeline -----------------------------------------------------------------------------------------------

  async timeline(personId: string, q: TimelineQuery) {
    const rows = await this.db
      .select({
        id: communicationEvents.id,
        panel: communicationEvents.panel,
        channel: communicationEvents.channel,
        state: communicationEvents.state,
        reason: communicationEvents.reason,
        dryRun: communicationEvents.dryRun,
        plannedFor: communicationEvents.plannedFor,
        occurredAt: communicationEvents.occurredAt,
        campaignId: communicationEvents.campaignId,
        campaign: campaigns.name,
        kind: campaigns.kind,
      })
      .from(communicationEvents)
      .leftJoin(campaigns, eq(campaigns.id, communicationEvents.campaignId))
      .where(
        and(
          eq(communicationEvents.masterPersonId, personId),
          q.panel ? eq(communicationEvents.panel, q.panel) : sql`true`,
          q.includeDryRuns === 'true' ? sql`true` : eq(communicationEvents.dryRun, false),
        ),
      )
      .orderBy(desc(communicationEvents.occurredAt))
      .limit(q.limit);
    // Fatigue per panel, from real contacts only.
    const panels = [...new Set(rows.map((r) => r.panel))];
    const fatigue = [];
    for (const panel of panels) {
      const [f] = (
        await this.db.execute<{ m: string; u: string; c: string; o: boolean }>(sql`
          select
            count(*) filter (where state = any(${`{${CONTACT_STATES.join(',')}}`}::text[]) and occurred_at > now() - interval '30 days') as m,
            count(*) filter (where state in ('sent', 'delivered') and occurred_at > now() - interval '30 days') as u,
            count(*) filter (where state = 'complained') as c,
            bool_or(state = 'opted_out') as o
          from communication_event where master_person_id = ${personId} and panel = ${panel} and not dry_run`)
      ).rows;
      const policy = await this.policy(panel);
      fatigue.push({
        panel,
        ...fatigueScore(
          { messages30d: Number(f?.m ?? 0), unanswered30d: Number(f?.u ?? 0), complaints: Number(f?.c ?? 0), optedOut: Boolean(f?.o) },
          policy.bands,
        ),
      });
    }
    return { items: rows, fatigue };
  }

  private async log(actor: Actor, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
    await this.audit.record({ actorId: actor.id, actorType: 'admin', action, targetType, targetId, metadata, ip: actor.ip });
  }
}
