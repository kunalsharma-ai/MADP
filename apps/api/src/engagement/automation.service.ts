import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { and, asc, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  BASIS_CONSENT,
  KIND_BASIS,
  QUALIFYING_ACTIVITY,
  TRIGGER_KINDS,
  type AUTOMATION_REASONS,
  AutomationConfig,
  type AutomationCreate,
  type AutomationStep,
  type AutomationTrigger,
  type AutomationVersionCreate,
  WELCOME_JOURNEY_NAME,
  WELCOME_JOURNEY_STEPS,
  type WelcomeJourneyPanel,
  type CampaignKind,
  type CelebrationCreate,
  type DataMode,
  type PanelCode,
  type SuppressionReason,
} from '@madp/contracts';
import { Database } from '../db/database.js';
import {
  automationRuns,
  automations,
  automationVersions,
  celebrationDates,
  communicationEvents,
  messageTemplates,
  messageTemplateVersions,
} from '../db/schema.js';
import { AuditService } from '../audit/audit.service.js';
import { FieldCrypto } from '../crypto/field-crypto.js';
import { Mongo } from '../mongo/mongo.js';
import { EngagementService } from './engagement.service.js';
import { CONTACT_STATES, audienceFilter, contactColumns, gate, type GateRow } from './gate.js';
import { isBirthday, localDate, nextSendTime } from './schedule.js';

interface Actor {
  id: string;
  ip: string | null;
}
type Reason = SuppressionReason | (typeof AUTOMATION_REASONS)[number];

const DAY = 86_400_000;
/** A registration step is due from its day until this many days later, so long-standing members are not swept in. */
export const REGISTRATION_WINDOW_DAYS = 7;
/** A birthday automation greets a member at most once in this many days. */
const BIRTHDAY_REPEAT_DAYS = 300;
const contactStates = `{${CONTACT_STATES.join(',')}}`;

type MemberRow = GateRow & Record<string, unknown> & {
  person: string;
  timezone: string | null;
  country: string | null;
  joined_at: Date | string | null;
  dob_enc: string | null;
  last_open_click: Date | string | null;
  last_survey: Date | string | null;
  last_sent: Date | string | null;
  sent_steps: number[] | null;
};

const toDate = (v: Date | string | null | undefined) => (v ? new Date(v) : null);
const daysBetween = (from: Date, to: Date) => Math.floor((to.getTime() - from.getTime()) / DAY);

/** Lifecycle automations (versioned, reviewed, dry runs only) and the celebration calendar. */
@Injectable()
export class AutomationService {
  constructor(
    private readonly database: Database,
    private readonly mongo: Mongo,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
    private readonly engagement: EngagementService,
  ) {}

  private get db() {
    return this.database.db;
  }

  // --- celebration calendar -----------------------------------------------------------------------------------

  async createCelebration(body: CelebrationCreate, actor: Actor) {
    const [row] = await this.db
      .insert(celebrationDates)
      .values({ ...body, note: body.note ?? null, status: 'pending', createdBy: actor.id })
      .returning();
    await this.log(actor, 'celebration.created', 'celebration_date', row!.id, {
      panel: body.panel,
      observance: body.observance,
      onDate: body.onDate,
    });
    return row!;
  }

  async listCelebrations(panel?: PanelCode) {
    const items = await this.db
      .select()
      .from(celebrationDates)
      .where(panel ? eq(celebrationDates.panel, panel) : sql`true`)
      .orderBy(asc(celebrationDates.onDate), asc(celebrationDates.panel));
    return {
      items,
      rule: 'Civic greetings go to members in the listed countries. Religious or cultural greetings go only to members who chose them; religion is never inferred from country.',
    };
  }

  /** Four eyes: whoever added an entry cannot approve it. */
  async reviewCelebration(id: string, decision: 'approve' | 'reject', note: string | undefined, actor: Actor) {
    const c = await this.db.query.celebrationDates.findFirst({ where: eq(celebrationDates.id, id) });
    if (!c) throw new NotFoundException();
    if (c.status !== 'pending') throw new ConflictException(`This entry is ${c.status}, not pending`);
    if (c.createdBy === actor.id) throw new ForbiddenException('Someone other than the author must review an entry');
    const status = decision === 'approve' ? 'approved' : 'rejected';
    await this.db
      .update(celebrationDates)
      .set({ status, reviewedBy: actor.id, reviewedAt: new Date(), reviewNote: note ?? null })
      .where(eq(celebrationDates.id, id));
    await this.log(actor, `celebration.${status}`, 'celebration_date', id, { note: note ?? null });
    return { status };
  }

  // --- automations and versions -------------------------------------------------------------------------------

  async create(mode: DataMode, body: AutomationCreate, actor: Actor) {
    await this.check(body.panel, body.trigger, body, false);
    const row = await this.db.transaction(async (tx) => {
      const [a] = await tx
        .insert(automations)
        .values({ dataMode: mode, panel: body.panel, name: body.name, trigger: body.trigger, createdBy: actor.id })
        .returning();
      await tx.insert(automationVersions).values({
        automationId: a!.id,
        version: 1,
        config: body.config,
        steps: body.steps,
        status: 'draft',
        createdBy: actor.id,
      });
      return a!;
    });
    await this.log(actor, 'automation.created', 'automation', row.id, { panel: body.panel, trigger: body.trigger });
    return this.get(row.id);
  }

  async list(mode: DataMode, panel?: PanelCode) {
    const rows = await this.db
      .select()
      .from(automations)
      .where(and(eq(automations.dataMode, mode), panel ? eq(automations.panel, panel) : sql`true`))
      .orderBy(asc(automations.panel), asc(automations.name));
    const ids = rows.map((r) => r.id);
    const runs = ids.length
      ? await this.db
          .select()
          .from(automationRuns)
          .where(inArray(automationRuns.automationId, ids))
          .orderBy(desc(automationRuns.startedAt))
      : [];
    const versions = ids.length
      ? await this.db
          .select()
          .from(automationVersions)
          .where(inArray(automationVersions.automationId, ids))
          .orderBy(desc(automationVersions.version))
      : [];
    return {
      dataMode: mode,
      sendingEnabled: false,
      qualifyingActivity: QUALIFYING_ACTIVITY,
      items: rows.map((a) => ({
        ...a,
        versions: versions.filter((v) => v.automationId === a.id),
        lastRun: runs.find((r) => r.automationId === a.id) ?? null,
      })),
    };
  }

  async get(id: string) {
    const a = await this.db.query.automations.findFirst({ where: eq(automations.id, id) });
    if (!a) throw new NotFoundException();
    const versions = await this.db
      .select()
      .from(automationVersions)
      .where(eq(automationVersions.automationId, id))
      .orderBy(desc(automationVersions.version));
    const runs = await this.db
      .select()
      .from(automationRuns)
      .where(eq(automationRuns.automationId, id))
      .orderBy(desc(automationRuns.startedAt))
      .limit(50);
    return { ...a, versions, runs };
  }

  async addVersion(id: string, body: AutomationVersionCreate, actor: Actor, restoredFrom: string | null = null) {
    const a = await this.db.query.automations.findFirst({ where: eq(automations.id, id) });
    if (!a) throw new NotFoundException();
    if (a.status === 'archived') throw new ConflictException('This automation is archived');
    await this.check(a.panel, a.trigger as AutomationTrigger, body, false);
    const [{ next } = { next: 1 }] = (
      await this.db.execute<{ next: number }>(
        sql`select coalesce(max(version), 0) + 1 as next from automation_version where automation_id = ${id}`,
      )
    ).rows;
    const [row] = await this.db
      .insert(automationVersions)
      .values({
        automationId: id,
        version: Number(next),
        config: body.config,
        steps: body.steps,
        status: 'draft',
        restoredFrom,
        createdBy: actor.id,
      })
      .returning();
    await this.log(actor, restoredFrom ? 'automation.version_restored' : 'automation.version_added', 'automation_version', row!.id, {
      version: row!.version,
      restoredFrom,
    });
    return row!;
  }

  /** Rollback: copies an earlier version into a new draft, which goes through review like any other. */
  async restore(versionId: string, actor: Actor) {
    const v = await this.version(versionId);
    return this.addVersion(
      v.automationId,
      { config: v.config as AutomationConfig, steps: v.steps as AutomationStep[] },
      actor,
      v.id,
    );
  }

  async submit(versionId: string, actor: Actor) {
    const v = await this.version(versionId);
    if (v.status !== 'draft' && v.status !== 'rejected')
      throw new ConflictException(`Only a draft or rejected version can go to review (this one is ${v.status})`);
    const a = (await this.db.query.automations.findFirst({ where: eq(automations.id, v.automationId) }))!;
    await this.check(a.panel, a.trigger as AutomationTrigger, this.body(v), true);
    await this.db.update(automationVersions).set({ status: 'in_review' }).where(eq(automationVersions.id, v.id));
    await this.log(actor, 'automation.submitted', 'automation_version', v.id, {});
    return { status: 'in_review' };
  }

  /**
   * Four eyes: the author of a version cannot approve it. Approving makes it the version that runs, supersedes the
   * previous approved one, and turns a draft automation on (a paused one stays paused).
   */
  async review(versionId: string, decision: 'approve' | 'reject', note: string | undefined, actor: Actor) {
    const v = await this.version(versionId);
    if (v.status !== 'in_review') throw new ConflictException(`This version is ${v.status}, not in review`);
    if (v.createdBy === actor.id) throw new ForbiddenException('Someone other than the author must review a version');
    const a = (await this.db.query.automations.findFirst({ where: eq(automations.id, v.automationId) }))!;
    if (decision === 'approve') await this.check(a.panel, a.trigger as AutomationTrigger, this.body(v), true);
    await this.db.transaction(async (tx) => {
      if (decision === 'approve') {
        await tx
          .update(automationVersions)
          .set({ status: 'superseded' })
          .where(and(eq(automationVersions.automationId, a.id), eq(automationVersions.status, 'approved')));
        await tx
          .update(automations)
          .set({ currentVersionId: v.id, status: a.status === 'draft' ? 'active' : a.status, updatedAt: new Date() })
          .where(eq(automations.id, a.id));
      }
      await tx
        .update(automationVersions)
        .set({
          status: decision === 'approve' ? 'approved' : 'rejected',
          reviewedBy: actor.id,
          reviewedAt: new Date(),
          reviewNote: note ?? null,
        })
        .where(eq(automationVersions.id, v.id));
    });
    await this.log(actor, `automation.version_${decision === 'approve' ? 'approved' : 'rejected'}`, 'automation_version', v.id, {
      note: note ?? null,
    });
    return { status: decision === 'approve' ? 'approved' : 'rejected' };
  }

  async decide(id: string, decision: 'pause' | 'resume' | 'archive', actor: Actor) {
    const a = await this.db.query.automations.findFirst({ where: eq(automations.id, id) });
    if (!a) throw new NotFoundException();
    const rules = {
      pause: { from: ['active'], to: 'paused' },
      resume: { from: ['paused'], to: 'active' },
      archive: { from: ['draft', 'active', 'paused'], to: 'archived' },
    }[decision];
    if (!rules.from.includes(a.status)) throw new ConflictException(`Cannot ${decision} a ${a.status} automation`);
    await this.db.update(automations).set({ status: rules.to, updatedAt: new Date() }).where(eq(automations.id, id));
    await this.log(actor, `automation.${decision}`, 'automation', id, {});
    return { status: rules.to };
  }

  private body(v: typeof automationVersions.$inferSelect) {
    return { config: v.config as AutomationConfig, steps: v.steps as AutomationStep[] };
  }

  private async version(versionId: string) {
    const v = await this.db.query.automationVersions.findFirst({ where: eq(automationVersions.id, versionId) });
    if (!v) throw new NotFoundException();
    return v;
  }

  /**
   * Checks a version's rules against its trigger: templates of the right kind from the same panel (approved ones
   * when `strict`, i.e. for review), one day-0 step for birthdays and festivals, and an approved calendar entry of
   * the same panel for festivals.
   */
  private async check(panel: PanelCode, trigger: AutomationTrigger, body: AutomationVersionCreate, strict: boolean) {
    const problems: string[] = [];
    const ids = body.steps.map((s) => s.templateVersionId);
    const found = await this.db
      .select({ id: messageTemplateVersions.id, status: messageTemplateVersions.status, panel: messageTemplates.panel, kind: messageTemplates.kind })
      .from(messageTemplateVersions)
      .innerJoin(messageTemplates, eq(messageTemplates.id, messageTemplateVersions.templateId))
      .where(inArray(messageTemplateVersions.id, ids));
    for (const s of body.steps) {
      const t = found.find((f) => f.id === s.templateVersionId);
      if (!t) problems.push(`Step ${s.atDays}: template version not found`);
      else {
        if (t.panel !== panel) problems.push(`Step ${s.atDays}: the template belongs to another panel`);
        if (!TRIGGER_KINDS[trigger].includes(t.kind as CampaignKind))
          problems.push(`Step ${s.atDays}: a ${trigger} automation needs a ${TRIGGER_KINDS[trigger].join(' or ')} template`);
        if (strict && t.status !== 'approved') problems.push(`Step ${s.atDays}: the template version is ${t.status}, not approved`);
      }
      if (s.onlyIfIncomplete && trigger !== 'registration') problems.push('Only registration steps can depend on the profile');
    }
    if ((trigger === 'birthday' || trigger === 'festival') && (body.steps.length !== 1 || body.steps[0]!.atDays !== 0))
      problems.push(`A ${trigger} automation has one step, on the day`);
    if (trigger !== 'incomplete_profile' && body.config.requiredQuestionIds.length)
      problems.push('Required questions only apply to incomplete-profile automations');
    if (trigger === 'festival') {
      const c = body.config.celebrationId
        ? await this.db.query.celebrationDates.findFirst({ where: eq(celebrationDates.id, body.config.celebrationId) })
        : null;
      if (!c) problems.push('A festival automation needs a calendar entry');
      else if (c.panel !== panel) problems.push('The calendar entry belongs to another panel');
      else if (strict && c.status !== 'approved') problems.push(`The calendar entry is ${c.status}, not approved`);
    } else if (body.config.celebrationId) problems.push('Only festival automations use a calendar entry');
    if (problems.length) throw new BadRequestException({ message: 'Fix these first', problems });
  }

  // --- welcome journey ------------------------------------------------------------------------------------------

  /** Newest approved template version per kind on a panel. */
  private async approvedTemplates(panel: PanelCode) {
    const rows = await this.db
      .select({
        versionId: messageTemplateVersions.id,
        name: messageTemplates.name,
        kind: messageTemplates.kind,
        version: messageTemplateVersions.version,
      })
      .from(messageTemplateVersions)
      .innerJoin(messageTemplates, eq(messageTemplates.id, messageTemplateVersions.templateId))
      .where(and(eq(messageTemplates.panel, panel), eq(messageTemplateVersions.status, 'approved')))
      .orderBy(desc(messageTemplateVersions.version));
    const byKind = new Map<string, { versionId: string; name: string }>();
    for (const r of rows) if (!byKind.has(r.kind)) byKind.set(r.kind, { versionId: r.versionId, name: r.name });
    return byKind;
  }

  /** Where each panel's welcome journey stands: set up or not, and which step still needs an approved template. */
  async welcomeJourney(mode: DataMode, panels: PanelCode[]): Promise<WelcomeJourneyPanel[]> {
    const out: WelcomeJourneyPanel[] = [];
    for (const panel of panels) {
      const templates = await this.approvedTemplates(panel);
      const a = await this.db.query.automations.findFirst({
        where: and(
          eq(automations.dataMode, mode),
          eq(automations.panel, panel),
          eq(automations.trigger, 'registration'),
          eq(automations.name, WELCOME_JOURNEY_NAME),
          sql`${automations.status} <> 'archived'`,
        ),
      });
      const latest = a
        ? await this.db.query.automationVersions.findFirst({
            where: eq(automationVersions.automationId, a.id),
            orderBy: desc(automationVersions.version),
          })
        : null;
      out.push({
        panel,
        automation: a ? { id: a.id, status: a.status, versionStatus: latest?.status ?? null } : null,
        steps: WELCOME_JOURNEY_STEPS.map((s) => ({
          atDays: s.atDays,
          kind: s.kind,
          label: s.label,
          template: templates.get(s.kind) ?? null,
        })),
      });
    }
    return out;
  }

  /**
   * Sets up a panel's welcome journey from its approved templates and sends it for review: a second admin approves it
   * before it is active. Nothing is sent while sending is off; runs stay dry runs.
   */
  async startWelcomeJourney(mode: DataMode, panel: PanelCode, actor: Actor) {
    const [status] = await this.welcomeJourney(mode, [panel]);
    if (status!.automation) throw new ConflictException('This panel already has a welcome journey');
    const missing = status!.steps.filter((s) => !s.template);
    if (missing.length)
      throw new BadRequestException({
        message: 'Approve these templates first (Messages, Templates)',
        problems: missing.map((s) => `Day ${s.atDays}: a ${s.kind.replace('_', ' ')} template for ${panel.toUpperCase()}`),
      });
    const created = await this.create(
      mode,
      {
        panel,
        name: WELCOME_JOURNEY_NAME,
        trigger: 'registration',
        config: AutomationConfig.parse({ minDaysBetween: 1 }),
        steps: status!.steps.map((s, i) => ({
          atDays: s.atDays,
          templateVersionId: s.template!.versionId,
          onlyIfIncomplete: WELCOME_JOURNEY_STEPS[i]!.onlyIfIncomplete,
        })),
      },
      actor,
    );
    await this.submit(created.versions[0]!.id, actor);
    return this.get(created.id);
  }

  // --- dry runs -----------------------------------------------------------------------------------------------

  /**
   * Works out which members the automation's approved version would message as of `asOf`, at which step and
   * when, and which rule stops the rest. Writes one dry-run timeline line per member it reaches. A failed run is
   * recorded with its error and can simply be run again.
   */
  async run(id: string, dryRun: boolean, asOf: Date, actor: Actor) {
    if (!dryRun)
      throw new ForbiddenException(
        'Sending is off: no message provider is configured and the owner has not approved sending. Use a dry run.',
      );
    const a = await this.db.query.automations.findFirst({ where: eq(automations.id, id) });
    if (!a) throw new NotFoundException();
    if (a.status !== 'active' || !a.currentVersionId)
      throw new ConflictException(`Only an active automation with an approved version can run (this one is ${a.status})`);
    const v = await this.version(a.currentVersionId);
    const [run] = await this.db
      .insert(automationRuns)
      .values({ automationId: a.id, versionId: v.id, dryRun: true, asOf, requestedBy: actor.id })
      .returning({ id: automationRuns.id });
    try {
      const counts = await this.evaluate(a, v, run!.id, asOf);
      await this.db.update(automationRuns).set({ counts, finishedAt: new Date() }).where(eq(automationRuns.id, run!.id));
      await this.log(actor, 'automation.dry_run', 'automation', a.id, { runId: run!.id, version: v.version, ...counts });
      return { runId: run!.id, dryRun: true, version: v.version, ...counts };
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e);
      await this.db.update(automationRuns).set({ error, finishedAt: new Date() }).where(eq(automationRuns.id, run!.id));
      throw e;
    }
  }

  private async evaluate(
    a: typeof automations.$inferSelect,
    v: typeof automationVersions.$inferSelect,
    runId: string,
    asOf: Date,
  ) {
    const trigger = a.trigger as AutomationTrigger;
    const { config, steps } = this.body(v);
    const policy = await this.engagement.policy(a.panel);

    // Templates can be retired after the version was approved; their steps are skipped and reported.
    const tv = await this.db
      .select({ id: messageTemplateVersions.id, status: messageTemplateVersions.status, kind: messageTemplates.kind })
      .from(messageTemplateVersions)
      .innerJoin(messageTemplates, eq(messageTemplates.id, messageTemplateVersions.templateId))
      .where(inArray(messageTemplateVersions.id, steps.map((s) => s.templateVersionId)));
    const live = steps
      .filter((s) => tv.find((t) => t.id === s.templateVersionId)?.status === 'approved')
      .sort((x, y) => x.atDays - y.atDays);
    const stepsSkipped = steps.filter((s) => !live.includes(s)).map((s) => s.atDays);
    const kindOf = (s: AutomationStep) => tv.find((t) => t.id === s.templateVersionId)!.kind as CampaignKind;

    const celebration =
      trigger === 'festival' && config.celebrationId
        ? await this.db.query.celebrationDates.findFirst({ where: eq(celebrationDates.id, config.celebrationId) })
        : null;
    if (trigger === 'festival' && celebration?.status !== 'approved')
      throw new ConflictException('Its calendar entry is no longer approved');

    // One consent lookup per basis the steps use.
    const bases = [...new Set(live.map((s) => KIND_BASIS[kindOf(s)]))];
    const consentFor = (s: AutomationStep) => BASIS_CONSENT[KIND_BASIS[kindOf(s)]];
    const consents = [...new Set(bases.map((b) => BASIS_CONSENT[b]))];
    const rows = (
      await this.db.execute<MemberRow & { consent_by: Record<string, string | null> }>(sql`
      select pm.master_person_id as person, si.timezone, mp.country, pm.joined_at, si.date_of_birth_enc as dob_enc,
        ${contactColumns(null, asOf)},
        (select coalesce(jsonb_object_agg(cr.purpose, cr.status::text), '{}'::jsonb) from consent_record cr
          where cr.master_person_id = pm.master_person_id and cr.panel = pm.panel) as consent_by,
        (select max(e.occurred_at) from communication_event e where e.master_person_id = pm.master_person_id
          and e.panel = pm.panel and not e.dry_run and e.state in ('opened', 'clicked') and e.occurred_at <= ${asOf}) as last_open_click,
        (select max(coalesce(sp.ended_at, sp.started_at)) from survey_participation sp where sp.panel_membership_id = pm.id
          and coalesce(sp.ended_at, sp.started_at) <= ${asOf}) as last_survey,
        (select max(e.occurred_at) from communication_event e where e.master_person_id = pm.master_person_id
          and e.automation_id = ${a.id} and not e.dry_run and e.state = any(${contactStates}::text[]) and e.occurred_at <= ${asOf}) as last_sent,
        (select array_agg(distinct e.step) from communication_event e where e.master_person_id = pm.master_person_id
          and e.automation_id = ${a.id} and not e.dry_run and e.state = any(${contactStates}::text[]) and e.occurred_at <= ${asOf}) as sent_steps
      from panel_membership pm
      join source_identity si on si.id = pm.source_identity_id
      join master_person mp on mp.id = pm.master_person_id
      where ${audienceFilter(a.dataMode, a.panel, config.audience as { categories?: string[]; countries?: string[] })}`)
    ).rows;

    const needsProfile = trigger === 'inactivity' || trigger === 'incomplete_profile' || trigger === 'registration';
    const profile = needsProfile ? await this.profiles(a.panel, a.dataMode, config.requiredQuestionIds) : null;
    const bank = needsProfile ? await this.bankSize(a.panel, a.dataMode) : 0;
    const incomplete = (person: string) => {
      const p = profile!.get(person);
      const share = bank ? (p?.answered ?? 0) / bank : 1;
      const missing = config.requiredQuestionIds.filter((q) => !p?.required.has(q));
      return { incomplete: share < config.completionThreshold || missing.length > 0, missing, share };
    };

    const reasons: Partial<Record<Reason, number>> = {};
    const byStep: Record<number, { planned: number; suppressed: number }> = {};
    const missingTally: Record<string, number> = {};
    const events: (typeof communicationEvents.$inferInsert)[] = [];
    let planned = 0;
    let delayedByQuietHours = 0;
    let notDue = 0;
    let unknownActivity = 0;

    for (const r of rows) {
      const joined = toDate(r.joined_at);
      let step: AutomationStep | undefined;
      let preReason: Reason | null = null;
      if (trigger === 'inactivity') {
        const last = [joined, profile!.get(r.person)?.lastAnswer ?? null, toDate(r.last_survey), toDate(r.last_open_click)]
          .filter((d): d is Date => !!d)
          .sort((x, y) => y.getTime() - x.getTime())[0];
        if (!last) {
          unknownActivity++;
          continue;
        }
        const idle = daysBetween(last, asOf);
        step = [...live].reverse().find((s) => s.atDays <= idle);
        // Reactivated since the last message: the earlier steps no longer apply.
        const sentAt = toDate(r.last_sent);
        if (step && sentAt && last > sentAt) r.sent_steps = [];
      } else if (trigger === 'incomplete_profile') {
        const p = incomplete(r.person);
        if (!p.incomplete || !joined) {
          notDue++;
          continue;
        }
        step = [...live].reverse().find((s) => s.atDays <= daysBetween(joined, asOf));
        if (step) for (const q of p.missing.slice(0, 3)) missingTally[q] = (missingTally[q] ?? 0) + 1;
      } else if (trigger === 'registration') {
        if (!joined) {
          notDue++;
          continue;
        }
        const since = daysBetween(joined, asOf);
        step = live.find((s) => since >= s.atDays && since < s.atDays + REGISTRATION_WINDOW_DAYS);
        if (step?.onlyIfIncomplete && !incomplete(r.person).incomplete) step = undefined;
      } else if (trigger === 'birthday') {
        step = live[0];
        const dob = r.dob_enc ? this.crypto.decrypt(r.dob_enc) : null;
        if (!dob || !/^\d{4}-\d{2}-\d{2}/.test(dob)) preReason = 'no_birth_date';
        else if (!isBirthday(dob, localDate(asOf, r.timezone))) step = undefined;
      } else if (trigger === 'festival') {
        step = live[0];
        if (!r.country || !celebration!.countries.includes(r.country)) step = undefined;
        else if (localDate(asOf, r.timezone) !== celebration!.onDate) step = undefined;
        else if (celebration!.observance === 'religious_cultural') preReason = 'no_greeting_preference';
      }
      if (!step) {
        notDue++;
        continue;
      }
      const kind = kindOf(step);
      const basis = KIND_BASIS[kind];
      const purpose = consentFor(step);
      const gateRow = { ...r, consent: purpose ? (r.consent_by?.[purpose] ?? null) : null };
      const lastSent = toDate(r.last_sent);
      const already =
        trigger === 'birthday'
          ? !!lastSent && daysBetween(lastSent, asOf) < BIRTHDAY_REPEAT_DAYS
          : trigger === 'festival'
            ? !!lastSent
            : (r.sent_steps ?? []).includes(step.atDays);
      let reason: Reason | null = preReason ?? gate(gateRow, basis, purpose, policy, already);
      if (!reason && lastSent && daysBetween(lastSent, asOf) < config.minDaysBetween) reason = 'too_soon';
      const plannedFor = reason ? null : nextSendTime(asOf, r.timezone, policy.quietStartHour, policy.quietEndHour);
      const s = (byStep[step.atDays] ??= { planned: 0, suppressed: 0 });
      if (reason) {
        reasons[reason] = (reasons[reason] ?? 0) + 1;
        s.suppressed++;
      } else {
        planned++;
        s.planned++;
        if (plannedFor!.getTime() !== asOf.getTime()) delayedByQuietHours++;
      }
      events.push({
        dataMode: a.dataMode,
        masterPersonId: r.person,
        panel: a.panel,
        automationId: a.id,
        automationRunId: runId,
        step: step.atDays,
        channel: 'email',
        state: reason ? 'suppressed' : 'planned',
        reason,
        dryRun: true,
        plannedFor,
        occurredAt: asOf,
      });
    }
    for (let i = 0; i < events.length; i += 1000) await this.db.insert(communicationEvents).values(events.slice(i, i + 1000));
    return {
      trigger,
      asOf: asOf.toISOString(),
      members: rows.length,
      due: events.length,
      notDue,
      unknownActivity,
      planned,
      suppressed: events.length - planned,
      delayedByQuietHours,
      reasons,
      byStep,
      stepsSkipped,
      consentsRequired: consents.filter(Boolean),
      ...(trigger === 'inactivity' ? { qualifyingActivity: QUALIFYING_ACTIVITY } : {}),
      ...(trigger === 'incomplete_profile' || trigger === 'registration'
        ? { questionBank: bank, completionThreshold: config.completionThreshold }
        : {}),
      ...(trigger === 'incomplete_profile'
        ? {
            topMissingQuestions: Object.entries(missingTally)
              .sort((x, y) => y[1] - x[1])
              .slice(0, 10)
              .map(([questionId, members]) => ({ questionId, members })),
          }
        : {}),
      ...(celebration ? { celebration: { name: celebration.name, onDate: celebration.onDate, observance: celebration.observance } } : {}),
    };
  }

  /** Per person: how many questions they answered on this panel, when an answer last changed, and which required ones. */
  private async profiles(panel: PanelCode, dataMode: DataMode, required: string[]) {
    const out = new Map<string, { answered: number; lastAnswer: Date | null; required: Set<string> }>();
    const cursor = this.mongo.profileAnswers.aggregate<{ _id: string; n: number; last: Date | null; req: string[] }>([
      { $match: { panel, dataMode } },
      {
        $group: {
          _id: '$personId',
          n: { $sum: 1 },
          last: { $max: '$sourceUpdatedAt' },
          req: { $addToSet: { $cond: [{ $in: ['$sourceQuestionId', required] }, '$sourceQuestionId', null] } },
        },
      },
    ]);
    for await (const d of cursor)
      out.set(d._id, { answered: d.n, lastAnswer: d.last ? new Date(d.last) : null, required: new Set(d.req.filter(Boolean)) });
    return out;
  }

  private async bankSize(panel: PanelCode, dataMode: DataMode) {
    return (await this.mongo.questionVersions.distinct('sourceQuestionId', { panel, dataMode })).length;
  }

  private async log(actor: Actor, action: string, targetType: string, targetId: string, metadata: Record<string, unknown>) {
    await this.audit.record({ actorId: actor.id, actorType: 'admin', action, targetType, targetId, metadata, ip: actor.ip });
  }
}
