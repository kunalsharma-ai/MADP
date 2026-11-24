import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  BuilderSource,
  checkDraft,
  planWrites,
  specFromSource,
  type BuilderQuestion,
  type DraftCreate,
  type DraftReview,
  type DraftSpec,
  type DraftUpdate,
  type PanelCode,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import { Database } from '../db/database.js';
import { questionnaireDrafts } from '../db/schema.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { PanelAdminService } from './panel-admin.service.js';

type Row = Record<string, unknown>;
type Draft = typeof questionnaireDrafts.$inferSelect;
const str = (v: unknown) => (v === undefined || v === null ? '' : String(v));
const low = (v: unknown) => str(v).trim().toLowerCase();
/** JSON with sorted keys: Postgres jsonb does not keep key order, so plain JSON.stringify can't compare. */
const stable = (v: unknown): string =>
  Array.isArray(v)
    ? `[${v.map(stable).join(',')}]`
    : v && typeof v === 'object'
      ? `{${Object.keys(v)
          .filter((k) => (v as Row)[k] !== undefined)
          .sort()
          .map((k) => `${JSON.stringify(k)}:${stable((v as Row)[k])}`)
          .join(',')}}`
      : JSON.stringify(v ?? null);

/**
 * Questionnaire builder (spec screens 11 and 12). Reads one panel profile through the panel's admin API (the profile
 * list for its id, the bank export for its pages, questions and options), keeps the change as a MADP draft, and after
 * a second admin's approval writes it with the existing admin routes: question, question options, profile pages.
 * Nothing reaches the panel before approval, and apply refuses a profile that changed since the draft started.
 */
@Injectable()
export class QuestionnaireService {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly database: Database,
    private readonly registry: ConnectorRegistry,
  ) {}

  private mode(panel: PanelCode) {
    return this.registry.get(panel).dataMode;
  }

  /** The profile as the panel has it now. */
  async source(panel: PanelCode, actor: string, category: string, slug: string): Promise<BuilderSource> {
    const [profiles, bank] = await Promise.all([
      this.panel.call<Row[]>(panel, actor, 'GET', R.profiles, { category }),
      this.panel.call<{ exportedAt?: string; Profile?: Row[]; Question?: Row[]; Option?: Row[] }>(panel, actor, 'GET', R.qbExport),
    ]);
    const listed = profiles.find((p) => low(p.slug) === slug && low(p.category) === category);
    const prof = (bank.Profile ?? []).find((p) => low(p.slug) === slug && low(p.category) === category);
    if (!listed || !prof) throw new NotFoundException({ code: 'not_found', message: `No ${category} profile ${slug} on ${panel.toUpperCase()}` });
    const pages = (Array.isArray(prof.pages) ? prof.pages : [])
      .filter((pg): pg is unknown[] => Array.isArray(pg) && pg.length >= 1)
      .map((pg) => ({ title: str(pg[0]), questions: pg.slice(1).map(low) }));
    const inCat = (q: Row) => (Array.isArray(q.category) ? q.category.map(low) : [low(q.category)]).includes(category);
    // A question key is unique per category set; the profile asks the one in its own category.
    const byName = new Map<string, Row>();
    for (const q of bank.Question ?? []) {
      const n = low(q.name);
      if (!byName.has(n) || inCat(q)) byName.set(n, q);
    }
    const optionsOf = new Map<string, Row[]>();
    for (const o of bank.Option ?? []) {
      const n = low(o.question);
      optionsOf.set(n, [...(optionsOf.get(n) ?? []), o]);
    }
    const asked = new Set(pages.flatMap((p) => p.questions));
    // The questions the profile asks, and the parents they depend on (which may be asked elsewhere).
    const wanted = new Set(asked);
    for (const n of asked) {
      const parent = low(byName.get(n)?.parent);
      if (parent) wanted.add(parent);
    }
    const questions: Record<string, BuilderQuestion> = {};
    for (const n of wanted) {
      const q = byName.get(n);
      if (q) questions[n] = this.question(q, optionsOf.get(n) ?? []);
    }
    const bankList = [...byName.values()]
      .filter((q) => inCat(q) && !asked.has(low(q.name)) && q.isActive !== false)
      .map((q) => ({ name: low(q.name), label: str(q.label), type: low(q.type) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return BuilderSource.parse({
      panel,
      profileId: str(listed.id),
      slug,
      category,
      name: str(prof.name),
      isActive: prof.isActive !== false,
      pages,
      questions,
      bank: bankList,
      exportedAt: bank.exportedAt ?? null,
    });
  }

  private question(q: Row, options: Row[]): BuilderQuestion {
    return {
      name: low(q.name),
      label: str(q.label),
      type: low(q.type),
      parent: low(q.parent) || null,
      isRequired: q.isRequired !== false,
      category: Array.isArray(q.category) ? q.category.map(low) : [low(q.category)],
      topic: low(q.topic) || null,
      options: options
        .slice()
        .sort((a, b) => Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0))
        .map((o) => ({
          value: str(o.value),
          label: str(o.label ?? o.value),
          parentValue: Array.isArray(o.parentValue) ? o.parentValue.map(str) : [],
          ...(typeof o.isExclusive === 'boolean' ? { isExclusive: o.isExclusive } : {}),
          ...(o.describeLabel ? { describeLabel: str(o.describeLabel) } : {}),
          ...(Array.isArray(o.countries) && o.countries.length ? { countries: o.countries.map(low) } : {}),
        })),
    };
  }

  async list(panel: PanelCode) {
    const rows = await this.database.db
      .select()
      .from(questionnaireDrafts)
      .where(and(eq(questionnaireDrafts.dataMode, this.mode(panel)), eq(questionnaireDrafts.panel, panel)))
      .orderBy(desc(questionnaireDrafts.updatedAt))
      .limit(200);
    return rows.map((d) => this.view(d, false));
  }

  async get(panel: PanelCode, id: string) {
    return this.view(await this.row(panel, id), true);
  }

  private async row(panel: PanelCode, id: string): Promise<Draft> {
    const [d] = await this.database.db
      .select()
      .from(questionnaireDrafts)
      .where(and(eq(questionnaireDrafts.id, id), eq(questionnaireDrafts.panel, panel), eq(questionnaireDrafts.dataMode, this.mode(panel))));
    if (!d) throw new NotFoundException('Draft not found');
    return d;
  }

  private view(d: Draft, full: boolean) {
    const base = d.base as BuilderSource;
    const spec = d.spec as DraftSpec;
    const problems = checkDraft(base, spec);
    const writes = planWrites(base, spec);
    return {
      id: d.id,
      dataMode: d.dataMode,
      panel: d.panel,
      category: d.category,
      slug: d.slug,
      name: base.name,
      note: d.note,
      status: d.status,
      createdBy: d.createdBy,
      submittedBy: d.submittedBy,
      submittedAt: d.submittedAt,
      reviewedBy: d.reviewedBy,
      reviewedAt: d.reviewedAt,
      reviewNote: d.reviewNote,
      appliedBy: d.appliedBy,
      appliedAt: d.appliedAt,
      createdAt: d.createdAt,
      updatedAt: d.updatedAt,
      errors: problems.filter((p) => p.level === 'error').length,
      warnings: problems.filter((p) => p.level === 'warning').length,
      changes: writes.length,
      ...(full ? { base, spec, problems, writes: writes.map(({ kind, target, summary }) => ({ kind, target, summary })), applyResult: d.applyResult } : {}),
    };
  }

  async create(panel: PanelCode, actor: string, body: DraftCreate) {
    const base = await this.source(panel, actor, body.category, body.slug);
    try {
      const [d] = await this.database.db
        .insert(questionnaireDrafts)
        .values({
          dataMode: this.mode(panel),
          panel,
          category: body.category,
          slug: body.slug,
          profileId: base.profileId,
          note: body.note ?? null,
          base,
          spec: body.spec ?? specFromSource(base),
          createdBy: actor,
        })
        .returning();
      return this.view(d!, true);
    } catch (e) {
      if (String((e as { code?: string }).code ?? (e as { cause?: { code?: string } }).cause?.code) === '23505')
        throw new ConflictException({ code: 'open_draft', message: 'This profile already has an open draft. Finish or discard it first.' });
      throw e;
    }
  }

  async update(panel: PanelCode, id: string, actor: string, body: DraftUpdate) {
    const d = await this.row(panel, id);
    if (d.status !== 'draft') throw new ConflictException({ code: 'not_editable', message: `A draft in ${d.status} can't be edited.` });
    const base = await this.withAdded(panel, actor, d.base as BuilderSource, body.spec);
    const [u] = await this.database.db
      .update(questionnaireDrafts)
      .set({ spec: body.spec, base, ...(body.note !== undefined ? { note: body.note } : {}), updatedAt: new Date() })
      .where(eq(questionnaireDrafts.id, d.id))
      .returning();
    return { before: { spec: d.spec }, view: this.view(u!, true) };
  }

  /**
   * A question added from the bank (or named as a parent) joins the draft's base with its definition as the panel
   * has it now (GET /questions/:name), so the checks, the preview and the apply step see its type and options.
   */
  private async withAdded(panel: PanelCode, actor: string, base: BuilderSource, spec: DraftSpec): Promise<BuilderSource> {
    const names = new Set([...spec.pages.flatMap((p) => p.questions), ...Object.values(spec.rules).map((r) => r.parent ?? '')]);
    const questions = { ...base.questions };
    for (let round = 0; round < 2; round++)
      for (const n of [...names]) {
        if (!n || questions[n] || Object.keys(questions).length > 1000) continue;
        try {
          const q = await this.panel.call<Row & { options?: Row[] }>(panel, actor, 'GET', R.question(n));
          questions[n] = this.question(q, q.options ?? []);
          if (questions[n]!.parent) names.add(questions[n]!.parent!);
        } catch (e) {
          if (!(e instanceof NotFoundException)) throw e;
        }
      }
    return { ...base, questions };
  }

  /** draft -> review. Refused while the checks find errors, or when nothing would change. */
  async submit(panel: PanelCode, id: string, actor: string) {
    const d = await this.row(panel, id);
    if (d.status !== 'draft') throw new ConflictException({ code: 'bad_transition', message: `Can't submit a draft in ${d.status}.` });
    const base = d.base as BuilderSource;
    const spec = d.spec as DraftSpec;
    const errors = checkDraft(base, spec).filter((p) => p.level === 'error');
    if (errors.length) throw new BadRequestException({ code: 'draft_errors', message: `Fix ${errors.length} problem(s) first.`, problems: errors });
    if (!planWrites(base, spec).length) throw new BadRequestException({ code: 'no_changes', message: 'The draft changes nothing.' });
    return this.move(d, 'review', { submittedBy: actor, submittedAt: new Date() });
  }

  /** review -> approved | rejected, by someone other than the author and the submitter. */
  async review(panel: PanelCode, id: string, actor: string, body: DraftReview) {
    const d = await this.row(panel, id);
    if (d.status !== 'review') throw new ConflictException({ code: 'bad_transition', message: `Can't review a draft in ${d.status}.` });
    if (d.createdBy === actor || d.submittedBy === actor)
      throw new ForbiddenException({ code: 'four_eyes', message: 'A second admin must review this draft.' });
    return this.move(d, body.decision === 'approve' ? 'approved' : 'rejected', {
      reviewedBy: actor,
      reviewedAt: new Date(),
      reviewNote: body.note ?? null,
    });
  }

  async discard(panel: PanelCode, id: string) {
    const d = await this.row(panel, id);
    if (!['draft', 'review', 'approved'].includes(d.status))
      throw new ConflictException({ code: 'bad_transition', message: `Can't discard a draft in ${d.status}.` });
    return this.move(d, 'discarded', {});
  }

  private async move(d: Draft, status: string, set: Partial<Draft>) {
    const [u] = await this.database.db
      .update(questionnaireDrafts)
      .set({ ...set, status, updatedAt: new Date() })
      .where(and(eq(questionnaireDrafts.id, d.id), inArray(questionnaireDrafts.status, [d.status])))
      .returning();
    if (!u) throw new ConflictException({ code: 'moved_on', message: 'Someone else changed this draft. Reload it.' });
    return { before: { status: d.status }, after: { status }, view: this.view(u, true) };
  }

  /**
   * approved -> applied. Re-reads the profile first and refuses if anything the draft touches changed on the panel
   * since the draft started. Then writes question by question, options, and the pages last, and opens a panel
   * question bank version for review so the change is in the panel's own history too.
   */
  async apply(panel: PanelCode, id: string, actor: string) {
    const d = await this.row(panel, id);
    if (d.status !== 'approved') throw new ConflictException({ code: 'bad_transition', message: `Only an approved draft can be applied (this one is ${d.status}).` });
    const base = d.base as BuilderSource;
    const spec = d.spec as DraftSpec;
    const now = await this.withAdded(panel, actor, await this.source(panel, actor, d.category, d.slug), spec);
    const writes = planWrites(base, spec);
    const touched = new Set(writes.filter((w) => w.kind !== 'profile_pages').map((w) => w.target));
    const drift: string[] = [];
    if (stable(now.pages) !== stable(base.pages)) drift.push('the profile pages');
    for (const n of touched) if (stable(now.questions[n] ?? null) !== stable(base.questions[n] ?? null)) drift.push(n);
    if (drift.length)
      throw new ConflictException({
        code: 'profile_changed',
        message: `Changed on the panel since this draft started: ${drift.slice(0, 10).join(', ')}. Start a new draft.`,
      });
    const reason = `MADP questionnaire draft ${d.id.slice(0, 8)}`;
    const steps: { kind: string; target: string; ok: boolean; error?: string }[] = [];
    for (const w of writes) {
      try {
        if (w.kind === 'question') await this.panel.call(panel, actor, 'PUT', R.question(w.target), undefined, w.body);
        else if (w.kind === 'options') await this.panel.call(panel, actor, 'PUT', R.questionOptions(w.target), undefined, w.body);
        else await this.panel.call(panel, actor, 'PUT', R.profile(d.profileId), undefined, w.body);
        steps.push({ kind: w.kind, target: w.target, ok: true });
      } catch (e) {
        steps.push({ kind: w.kind, target: w.target, ok: false, error: (e as Error).message.slice(0, 300) });
        break;
      }
    }
    const failed = steps.find((s) => !s.ok);
    let version: { number: number } | null = null;
    let versionError: string | null = null;
    if (!failed)
      try {
        version = await this.panel.call<{ number: number }>(panel, actor, 'POST', R.qbVersions, undefined, { note: reason });
        await this.panel.call(panel, actor, 'POST', R.qbVersionAction(version.number, 'review'));
      } catch (e) {
        versionError = (e as Error).message.slice(0, 300);
      }
    const applyResult = { steps, panelVersion: version?.number ?? null, versionError, at: new Date().toISOString() };
    const [u] = await this.database.db
      .update(questionnaireDrafts)
      .set({
        applyResult,
        updatedAt: new Date(),
        ...(failed ? {} : { status: 'applied', appliedBy: actor, appliedAt: new Date() }),
      })
      .where(eq(questionnaireDrafts.id, d.id))
      .returning();
    return { ok: !failed, applyResult, view: this.view(u!, true) };
  }
}
