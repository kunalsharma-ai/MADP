import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  DataMode,
  PanelCode,
  SourceQuestion,
  SourceQuestionnaire,
  SourceRespondent,
} from '@madp/contracts';
import { ConnectorError } from '@madp/connectors';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { Database, type Db } from '../db/database.js';
import {
  categoryMemberships,
  deadLetters,
  identityMatchCandidates,
  importJobs,
  masterPersons,
  outbox,
  panelMemberships,
  sourceIdentities,
  sourceQuestionMappings,
  syncCheckpoints,
} from '../db/schema.js';
import { Mongo, type QuestionVersionDoc } from '../mongo/mongo.js';
import { FieldCrypto, maskEmail } from '../crypto/field-crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { NAME_SUGGESTIONS, categoryFor, sensitivityFor } from './canonical.js';

/** Location reference lists (tens of thousands of options) are not copied into the question registry. */
const REFERENCE_LISTS = new Set([
  'city',
  'state',
  'zipcode',
  'org-city',
  'org-state',
  'org-zipcode',
  'state_of_practice',
  'jobrole',
  'employment-jobrole',
  'patient-jobrole',
]);
const PAGE_SIZE = 200;

export interface ImportCounts {
  questionnaires: number;
  questions: number;
  questionVersionsCreated: number;
  mappingsQueued: number;
  respondentsSeen: number;
  identitiesCreated: number;
  identitiesUpdated: number;
  personsCreated: number;
  autoLinked: number;
  matchCandidates: number;
  unknownCategories: Record<string, number>;
  answersSeen: number;
  answersChanged: number;
  pages: number;
  resumedFromCursor: string | null;
  /** Answer batches parked in the dead-letter queue after retries were exhausted. */
  deadLettered: number;
  deadLetteredMembers: number;
}

/** Transient source failures go to the dead-letter queue; refused access or bad payloads fail the job. */
const DEAD_LETTER_KINDS = new Set(['source_error', 'timeout']);

export interface ImportOptions {
  dryRun?: boolean;
  requestedBy?: string | null;
}

const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex');

@Injectable()
export class IngestionService {
  private readonly log = new Logger(IngestionService.name);
  private readonly running = new Set<PanelCode>();

  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly database: Database,
    private readonly mongo: Mongo,
    private readonly crypto: FieldCrypto,
    private readonly audit: AuditService,
  ) {}

  /**
   * Initial backfill / reconciliation run for one panel: questionnaires -> question registry (versioned)
   * -> mapping review queue -> respondents -> identities/persons/memberships -> answers. Resumable from the
   * respondents checkpoint; idempotent (re-running with unchanged source data changes nothing).
   */
  async runImport(panel: PanelCode, opts: ImportOptions = {}) {
    if (this.running.has(panel)) throw new Error(`An import for ${panel} is already running`);
    this.running.add(panel);
    const { connector, dataMode } = this.registry.get(panel);
    const db = this.database.db;
    const [job] = await db
      .insert(importJobs)
      .values({
        panel,
        dataMode,
        kind: 'backfill',
        dryRun: Boolean(opts.dryRun),
        status: 'running',
        requestedBy: opts.requestedBy ?? null,
        startedAt: new Date(),
      })
      .returning();
    const jobId = job!.id;
    const counts: ImportCounts = {
      questionnaires: 0,
      questions: 0,
      questionVersionsCreated: 0,
      mappingsQueued: 0,
      respondentsSeen: 0,
      identitiesCreated: 0,
      identitiesUpdated: 0,
      personsCreated: 0,
      autoLinked: 0,
      matchCandidates: 0,
      unknownCategories: {},
      answersSeen: 0,
      answersChanged: 0,
      pages: 0,
      resumedFromCursor: null,
      deadLettered: 0,
      deadLetteredMembers: 0,
    };
    try {
      const questionnaires = await connector.listQuestionnaires();
      counts.questionnaires = questionnaires.length;
      const questions = await connector.listQuestions();
      counts.questions = questions.length;
      const versions = await this.syncQuestions(
        panel,
        dataMode,
        jobId,
        questionnaires,
        questions,
        counts,
        Boolean(opts.dryRun),
      );

      const checkpoint = await db.query.syncCheckpoints.findFirst({
        where: and(
          eq(syncCheckpoints.dataMode, dataMode),
          eq(syncCheckpoints.panel, panel),
          eq(syncCheckpoints.stream, 'respondents'),
        ),
      });
      let cursor: string | null = opts.dryRun ? null : (checkpoint?.cursor ?? null);
      counts.resumedFromCursor = cursor;
      const questionIds = questions.map((q) => q.sourceQuestionId);
      do {
        const page = await connector.listRespondents(cursor, PAGE_SIZE);
        counts.pages++;
        counts.respondentsSeen += page.items.length;
        if (!opts.dryRun) {
          const personByMember = await this.ingestRespondents(panel, dataMode, jobId, page.items, counts);
          const memberIds = page.items.map((r) => r.sourceMemberId);
          let answers: Awaited<ReturnType<typeof connector.listAnswers>> = [];
          try {
            answers = await connector.listAnswers(memberIds, questionIds);
          } catch (e) {
            if (!(e instanceof ConnectorError) || !DEAD_LETTER_KINDS.has(e.kind)) throw e;
            await db.insert(deadLetters).values({
              dataMode,
              panel,
              importJobId: jobId,
              stream: 'answers',
              sourceMemberIds: memberIds,
              errorKind: e.kind,
              error: e.message.slice(0, 500),
            });
            counts.deadLettered++;
            counts.deadLetteredMembers += memberIds.length;
          }
          counts.answersSeen += answers.length;
          counts.answersChanged += await this.ingestAnswers(
            panel,
            dataMode,
            jobId,
            answers,
            personByMember,
            versions,
          );
          await this.saveCheckpoint(dataMode, panel, page.nextCursor, jobId, false);
        } else {
          for (const r of page.items) {
            if (!categoryFor(panel, r.sourceCategory))
              counts.unknownCategories[r.sourceCategory] =
                (counts.unknownCategories[r.sourceCategory] ?? 0) + 1;
          }
        }
        cursor = page.nextCursor;
      } while (cursor);

      if (!opts.dryRun) {
        await this.saveCheckpoint(dataMode, panel, null, jobId, true);
        await db
          .insert(outbox)
          .values({ topic: 'audience.counts.invalidated', payload: { panel, dataMode, importJobId: jobId } });
      }
      await db
        .update(importJobs)
        .set({ status: 'succeeded', counts, finishedAt: new Date() })
        .where(eq(importJobs.id, jobId));
      await this.audit.record({
        actorId: opts.requestedBy ?? null,
        actorType: opts.requestedBy ? 'admin' : 'system',
        action: 'import.completed',
        targetType: 'import_job',
        targetId: jobId,
        metadata: { panel, dataMode, dryRun: Boolean(opts.dryRun), respondents: counts.respondentsSeen },
      });
      return { jobId, dataMode, status: 'succeeded' as const, counts };
    } catch (e) {
      const message = (e as Error).message;
      this.log.error(`Import ${jobId} for ${panel} failed: ${message}`);
      await db
        .update(importJobs)
        .set({ status: 'failed', counts, error: message, finishedAt: new Date() })
        .where(eq(importJobs.id, jobId));
      await this.audit.record({
        actorId: opts.requestedBy ?? null,
        actorType: 'system',
        action: 'import.failed',
        outcome: 'failure',
        targetType: 'import_job',
        targetId: jobId,
        metadata: { panel },
      });
      return { jobId, dataMode, status: 'failed' as const, counts, error: message };
    } finally {
      this.running.delete(panel);
    }
  }

  /**
   * Re-reads answers for open dead-letter entries of one panel. Entries that succeed are resolved; failures
   * stay open with the attempt count raised. Uses the current question versions from the registry.
   */
  async retryDeadLetters(panel: PanelCode, requestedBy: string | null = null) {
    const { connector, dataMode } = this.registry.get(panel);
    const db = this.database.db;
    const open = await db.query.deadLetters.findMany({
      where: and(
        eq(deadLetters.dataMode, dataMode),
        eq(deadLetters.panel, panel),
        eq(deadLetters.status, 'open'),
      ),
    });
    const latest = await this.mongo.questionVersions
      .aggregate<{ _id: string; version: number }>([
        { $match: { panel, dataMode } },
        { $group: { _id: '$sourceQuestionId', version: { $max: '$version' } } },
      ])
      .toArray();
    const versions = new Map(latest.map((v) => [v._id, v.version]));
    const questionIds = [...versions.keys()];
    let resolved = 0;
    let stillOpen = 0;
    let answersChanged = 0;
    for (const entry of open) {
      try {
        const answers = await connector.listAnswers(entry.sourceMemberIds, questionIds);
        const identities = await db
          .select({ member: sourceIdentities.sourceMemberId, person: sourceIdentities.masterPersonId })
          .from(sourceIdentities)
          .where(
            and(
              eq(sourceIdentities.dataMode, dataMode),
              eq(sourceIdentities.panel, panel),
              inArray(sourceIdentities.sourceMemberId, entry.sourceMemberIds),
            ),
          );
        const personByMember = new Map(identities.map((i) => [i.member, i.person]));
        answersChanged += await this.ingestAnswers(
          panel,
          dataMode,
          entry.importJobId ?? entry.id,
          answers,
          personByMember,
          versions,
        );
        await db
          .update(deadLetters)
          .set({
            status: 'resolved',
            resolvedAt: new Date(),
            lastAttemptAt: new Date(),
            attempts: entry.attempts + 1,
          })
          .where(eq(deadLetters.id, entry.id));
        resolved++;
      } catch (e) {
        if (!(e instanceof ConnectorError) || !DEAD_LETTER_KINDS.has(e.kind)) throw e;
        await db
          .update(deadLetters)
          .set({ attempts: entry.attempts + 1, lastAttemptAt: new Date(), error: e.message.slice(0, 500) })
          .where(eq(deadLetters.id, entry.id));
        stillOpen++;
      }
    }
    if (answersChanged > 0) {
      await db.insert(outbox).values({
        topic: 'audience.counts.invalidated',
        payload: { panel, dataMode, reason: 'dead_letter_retry' },
      });
    }
    await this.audit.record({
      actorId: requestedBy,
      actorType: requestedBy ? 'admin' : 'system',
      action: 'dead_letters.retried',
      targetType: 'panel',
      targetId: panel,
      metadata: { dataMode, attempted: open.length, resolved, stillOpen, answersChanged },
    });
    return { panel, dataMode, attempted: open.length, resolved, stillOpen, answersChanged };
  }

  private async syncQuestions(
    panel: PanelCode,
    dataMode: DataMode,
    jobId: string,
    questionnaires: SourceQuestionnaire[],
    questions: SourceQuestion[],
    counts: ImportCounts,
    dryRun: boolean,
  ): Promise<Map<string, number>> {
    const { connector } = this.registry.get(panel);
    const versions = new Map<string, number>();
    const inQuestionnaires = new Map<string, string[]>();
    for (const qn of questionnaires) {
      for (const name of qn.pages.flatMap((p) => p.slice(1)))
        inQuestionnaires.set(name, [...(inQuestionnaires.get(name) ?? []), qn.slug]);
      if (!dryRun) await this.storeEvent(panel, dataMode, 'questionnaire', qn.slug, qn, jobId);
    }
    for (const q of questions) {
      const options = REFERENCE_LISTS.has(q.sourceQuestionId)
        ? []
        : await connector.listOptions(q.sourceQuestionId);
      const def = {
        label: q.label,
        type: q.type,
        parent: q.parent,
        sourceCategories: [...q.categories].sort(),
        options: options
          .map((o) => ({
            value: o.value,
            label: o.label,
            parentValues: [...o.parentValues].sort(),
            isExclusive: o.isExclusive,
          }))
          .sort((a, b) => (a.value + a.parentValues.join()).localeCompare(b.value + b.parentValues.join())),
      };
      const contentHash = hash(def);
      const latest = await this.mongo.questionVersions
        .find({ panel, dataMode, sourceQuestionId: q.sourceQuestionId })
        .sort({ version: -1 })
        .limit(1)
        .next();
      let version = latest?.version ?? 0;
      if (!latest || latest.contentHash !== contentHash) {
        version += 1;
        counts.questionVersionsCreated++;
        if (!dryRun) {
          const doc: QuestionVersionDoc = {
            panel,
            dataMode,
            sourceQuestionId: q.sourceQuestionId,
            version,
            contentHash,
            ...def,
            questionnaires: inQuestionnaires.get(q.sourceQuestionId) ?? [],
            sensitivity: sensitivityFor(panel, q.sourceQuestionId, q.categories),
            firstSeenAt: new Date(),
            importJobId: jobId,
          };
          await this.mongo.questionVersions.insertOne(doc);
          await this.storeEvent(panel, dataMode, 'question', q.sourceQuestionId, { ...q, options }, jobId);
        }
      }
      versions.set(q.sourceQuestionId, version);
      if (!dryRun) {
        const suggestion = NAME_SUGGESTIONS[q.sourceQuestionId] ?? null;
        const inserted = await this.database.db
          .insert(sourceQuestionMappings)
          .values({
            dataMode,
            panel,
            sourceQuestionId: q.sourceQuestionId,
            questionVersion: version,
            suggestedAttributeKey: suggestion,
            suggestionBasis: suggestion ? 'exact source question name (needs review)' : null,
          })
          .onConflictDoNothing()
          .returning({ id: sourceQuestionMappings.id });
        counts.mappingsQueued += inserted.length;
      }
    }
    return versions;
  }

  private async storeEvent(
    panel: PanelCode,
    dataMode: DataMode,
    kind: 'questionnaire' | 'question' | 'respondent' | 'answer',
    sourceKey: string,
    payload: unknown,
    jobId: string,
  ) {
    const contentHash = hash(payload);
    await this.mongo.sourceEvents.updateOne(
      { panel, dataMode, kind, sourceKey, contentHash },
      {
        $setOnInsert: {
          panel,
          dataMode,
          kind,
          sourceKey,
          contentHash,
          payload,
          importJobId: jobId,
          receivedAt: new Date(),
        },
      },
      { upsert: true },
    );
  }

  private async ingestRespondents(
    panel: PanelCode,
    dataMode: DataMode,
    jobId: string,
    items: SourceRespondent[],
    counts: ImportCounts,
  ) {
    const personByMember = new Map<string, string>();
    await this.database.db.transaction(async (tx) => {
      for (const r of items) {
        // Staging keeps a reference and a content hash only - no personal data is copied into MongoDB.
        await this.storeEvent(
          panel,
          dataMode,
          'respondent',
          r.sourceMemberId,
          { ref: r.sourceMemberId, hash: hash(r), sourceUpdatedAt: r.sourceUpdatedAt },
          jobId,
        );
        const personId = await this.upsertIdentity(tx, panel, dataMode, jobId, r, counts);
        personByMember.set(r.sourceMemberId, personId);
      }
    });
    return personByMember;
  }

  private async upsertIdentity(
    tx: Db,
    panel: PanelCode,
    dataMode: DataMode,
    jobId: string,
    r: SourceRespondent,
    counts: ImportCounts,
  ): Promise<string> {
    const emailHash = this.crypto.emailHash(r.email);
    const fields = {
      sourceRespondentRef: r.sourceRespondentRef,
      sourceCategory: r.sourceCategory,
      emailHash,
      emailEnc: this.crypto.encrypt(r.email),
      emailMasked: maskEmail(r.email),
      phoneEnc: this.crypto.encrypt(r.phone),
      firstNameEnc: this.crypto.encrypt(r.firstName),
      lastNameEnc: this.crypto.encrypt(r.lastName),
      dateOfBirthEnc: this.crypto.encrypt(r.dateOfBirth),
      emailVerification: r.emailVerification,
      phoneVerification: r.phoneVerification,
      qualityScore: r.qualityScore,
      sourceActive: r.isActive,
      sourceCreatedAt: r.sourceCreatedAt ? new Date(r.sourceCreatedAt) : null,
      sourceUpdatedAt: r.sourceUpdatedAt ? new Date(r.sourceUpdatedAt) : null,
      lastImportJobId: jobId,
      updatedAt: new Date(),
    };
    const existing = await tx.query.sourceIdentities.findFirst({
      where: and(
        eq(sourceIdentities.dataMode, dataMode),
        eq(sourceIdentities.panel, panel),
        eq(sourceIdentities.sourceMemberId, r.sourceMemberId),
      ),
    });
    let identityId: string;
    let personId: string;
    if (existing) {
      await tx.update(sourceIdentities).set(fields).where(eq(sourceIdentities.id, existing.id));
      identityId = existing.id;
      personId = existing.masterPersonId;
      counts.identitiesUpdated++;
    } else {
      // Identity resolution: exact keyed-hash e-mail match with a *different* panel's identity.
      // Auto-link only when both sides have a verified e-mail; otherwise create a review candidate.
      const match = emailHash
        ? await tx.query.sourceIdentities.findFirst({
            where: and(
              eq(sourceIdentities.dataMode, dataMode),
              eq(sourceIdentities.emailHash, emailHash),
              ne(sourceIdentities.panel, panel),
            ),
          })
        : undefined;
      const autoLink = Boolean(
        match && match.emailVerification === 'verified' && r.emailVerification === 'verified',
      );
      if (match && autoLink) {
        personId = match.masterPersonId;
        counts.autoLinked++;
      } else {
        const [p] = await tx.insert(masterPersons).values({ dataMode }).returning({ id: masterPersons.id });
        personId = p!.id;
        counts.personsCreated++;
      }
      const [row] = await tx
        .insert(sourceIdentities)
        .values({ dataMode, panel, sourceMemberId: r.sourceMemberId, masterPersonId: personId, ...fields })
        .returning({ id: sourceIdentities.id });
      identityId = row!.id;
      counts.identitiesCreated++;
      if (match) {
        await tx.insert(identityMatchCandidates).values({
          dataMode,
          sourceIdentityId: identityId,
          candidatePersonId: match.masterPersonId,
          rule: 'exact_email_keyed_hash',
          status: autoLink ? 'approved' : 'pending',
        });
        if (!autoLink) counts.matchCandidates++;
      }
    }
    await tx
      .insert(panelMemberships)
      .values({
        dataMode,
        masterPersonId: personId,
        panel,
        sourceIdentityId: identityId,
        status: r.isActive ? 'active' : 'inactive',
        joinedAt: fields.sourceCreatedAt,
      })
      .onConflictDoUpdate({
        target: panelMemberships.sourceIdentityId,
        set: { status: r.isActive ? 'active' : 'inactive', updatedAt: new Date() },
      });
    const cat = categoryFor(panel, r.sourceCategory);
    if (cat) {
      await tx
        .insert(categoryMemberships)
        .values({
          dataMode,
          masterPersonId: personId,
          category: cat.category,
          panel,
          basis: `source_category:${r.sourceCategory}`,
          isMinor: cat.minor,
        })
        .onConflictDoNothing();
    } else {
      counts.unknownCategories[r.sourceCategory] = (counts.unknownCategories[r.sourceCategory] ?? 0) + 1;
    }
    // Person-level location/demographics: fill gaps only, never overwrite another panel's value (source precedence = first seen).
    const birthYear = r.dateOfBirth ? Number.parseInt(r.dateOfBirth.slice(0, 4), 10) : null;
    await tx
      .update(masterPersons)
      .set({
        country: sql`coalesce(${masterPersons.country}, ${r.country})`,
        state: sql`coalesce(${masterPersons.state}, ${r.state})`,
        city: sql`coalesce(${masterPersons.city}, ${r.city})`,
        gender: sql`coalesce(${masterPersons.gender}, ${r.gender})`,
        birthYear: sql`coalesce(${masterPersons.birthYear}, ${birthYear})`,
        updatedAt: new Date(),
      })
      .where(eq(masterPersons.id, personId));
    return personId;
  }

  private async ingestAnswers(
    panel: PanelCode,
    dataMode: DataMode,
    jobId: string,
    answers: {
      sourceMemberId: string;
      sourceQuestionId: string;
      values: string[];
      sourceUpdatedAt: string | null;
    }[],
    personByMember: Map<string, string>,
    versions: Map<string, number>,
  ): Promise<number> {
    let changed = 0;
    const versionDocs = await this.mongo.questionVersions
      .find({ panel, dataMode })
      .project<{ sourceQuestionId: string; version: number; sensitivity: 'standard' | 'special_category' }>({
        sourceQuestionId: 1,
        version: 1,
        sensitivity: 1,
      })
      .toArray();
    const sens = new Map(versionDocs.map((d) => [`${d.sourceQuestionId}@${d.version}`, d.sensitivity]));
    for (const a of answers) {
      const personId = personByMember.get(a.sourceMemberId);
      if (!personId) continue;
      const questionVersion = versions.get(a.sourceQuestionId) ?? 0;
      const values = [...a.values].sort();
      const key = { panel, dataMode, sourceMemberId: a.sourceMemberId, sourceQuestionId: a.sourceQuestionId };
      const prev = await this.mongo.profileAnswers.findOne(key);
      if (prev && JSON.stringify(prev.values) === JSON.stringify(values)) continue;
      if (prev) {
        const { _id, ...rest } = prev;
        await this.mongo.answerHistory.insertOne({ ...rest, supersededAt: new Date() });
      }
      await this.mongo.profileAnswers.updateOne(
        key,
        {
          $set: {
            ...key,
            personId,
            questionVersion,
            values,
            sensitivity:
              sens.get(`${a.sourceQuestionId}@${questionVersion}`) ??
              sensitivityFor(panel, a.sourceQuestionId, []),
            sourceUpdatedAt: a.sourceUpdatedAt ? new Date(a.sourceUpdatedAt) : null,
            ingestedAt: new Date(),
            importJobId: jobId,
          },
        },
        { upsert: true },
      );
      changed++;
    }
    return changed;
  }

  private async saveCheckpoint(
    dataMode: DataMode,
    panel: PanelCode,
    cursor: string | null,
    jobId: string,
    success: boolean,
  ) {
    await this.database.db
      .insert(syncCheckpoints)
      .values({
        dataMode,
        panel,
        stream: 'respondents',
        cursor,
        lastJobId: jobId,
        lastSuccessAt: success ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [syncCheckpoints.dataMode, syncCheckpoints.panel, syncCheckpoints.stream],
        set: {
          cursor,
          lastJobId: jobId,
          updatedAt: new Date(),
          ...(success ? { lastSuccessAt: new Date() } : {}),
        },
      });
  }
}
