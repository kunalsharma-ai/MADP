import { createHash } from 'node:crypto';
import { Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import type {
  ChangeQuery,
  DataMode,
  PanelCode,
  SourceChangePage,
  SourceQuestion,
  SourceQuestionnaire,
  SourceRespondent,
} from '@madp/contracts';
import { ConnectorError, type PanelConnector } from '@madp/connectors';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { Database, type Db } from '../db/database.js';
import {
  categoryMemberships,
  consentRecords,
  erasureHolds,
  deadLetters,
  identityMatchCandidates,
  importJobs,
  masterPersons,
  outbox,
  panelMemberships,
  sourceIdentities,
  sourceQuestionMappings,
  syncCheckpoints,
  verificationEvidence,
} from '../db/schema.js';
import type { AnyBulkWriteOperation, WithId } from 'mongodb';
import {
  Mongo,
  type AnswerHistoryDoc,
  type ProfileAnswerDoc,
  type QuestionVersionDoc,
} from '../mongo/mongo.js';
import { FieldCrypto, maskEmail } from '../crypto/field-crypto.js';
import { AuditService } from '../audit/audit.service.js';
import { LoyaltyService, type LoyaltySyncCounts } from '../loyalty/loyalty.service.js';
import { recomputePerson } from '../identity/precedence.js';
import { DIRECT_IDENTIFIER_QUESTIONS, NAME_SUGGESTIONS, categoryFor, sensitivityFor } from './canonical.js';

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
  /** The wallet mirror (rewards and survey responses), when the panel serves those feeds. */
  loyalty?: LoyaltySyncCounts;
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
  /** Consent records written or refreshed from the source (guardian consent, terms, opt-ins). */
  consentsSynced: number;
  /** Panel admin and integration accounts the source marked as staff: never imported as members. */
  staffSkipped?: number;
  /** Members skipped because a privacy request erased them in MADP and the panel has not deleted them yet. */
  erasureHeld?: number;
}

/** Transient source failures go to the dead-letter queue; refused access or bad payloads fail the job. */
const DEAD_LETTER_KINDS = new Set(['source_error', 'timeout']);

/** What one automatic sync run did. Counts only, no personal data. */
export interface SyncCounts extends ImportCounts {
  /** Where each feed started, for the run report: 'cursor', 'since <ISO>' or 'beginning'. */
  startedFrom: Record<SyncFeed, string>;
  /** Pages read per feed. */
  feedPages: Record<SyncFeed, number>;
  /** True when a feed still had pages after SYNC_MAX_PAGES; the next run continues. */
  capped: boolean;
  membersRemoved: number;
  answerResets: number;
  /** Deletions for members MADP never held (nothing to remove). */
  deletionsUnknown: number;
  /** Answers whose member was not in MADP yet; parked and read again once the member arrives. */
  answersParked: number;
  parkedResolved: number;
  questionsRefreshed: boolean;
}

export type SyncFeed = 'members' | 'answers' | 'deletions';
const SYNC_STREAM: Record<SyncFeed, string> = {
  members: 'changes.members',
  answers: 'changes.answers',
  deletions: 'changes.deletions',
};
const FEED_LIMIT: Record<SyncFeed, number> = { members: 500, answers: 1000, deletions: 1000 };
/** Overlap with the last full import, so a change made while it ran is read again rather than missed. */
const SINCE_OVERLAP_MS = 10 * 60_000;
/** Dead-letter kind for answers that arrived before their member. */
export const MEMBER_NOT_SYNCED = 'member_not_synced';

export interface SyncOptions {
  requestedBy?: string | null;
  /** Most pages per feed in this run (default 100). */
  maxPages?: number;
}

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
    private readonly loyalty: LoyaltyService,
  ) {}

  /** Wallet mirror after an import or sync. A failure there is reported in the counts, not as a failed sync. */
  private async syncLoyalty(panel: PanelCode, jobId: string, fromStart: boolean): Promise<LoyaltySyncCounts> {
    try {
      return await this.loyalty.sync(panel, jobId, { fromStart });
    } catch (e) {
      this.log.error(`Loyalty mirror for ${panel} (job ${jobId}): ${(e as Error).message}`);
      return { status: 'failed', rewardsSeen: 0, responsesSeen: 0, linesWritten: 0, unmatchedMembers: 0, unknownStatuses: 0, message: (e as Error).message };
    }
  }

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
      consentsSynced: 0,
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
      // Direct identifiers are never requested as answers (see DIRECT_IDENTIFIER_QUESTIONS).
      const questionIds = questions
        .map((q) => q.sourceQuestionId)
        .filter((id) => !DIRECT_IDENTIFIER_QUESTIONS.has(id));
      do {
        const raw = await connector.listRespondents(cursor, PAGE_SIZE);
        const page = { ...raw, items: raw.items.filter((r) => !r.isStaff) };
        counts.staffSkipped = (counts.staffSkipped ?? 0) + raw.items.length - page.items.length;
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
        counts.loyalty = await this.syncLoyalty(panel, jobId, true);
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
   * Automatic sync for one panel from its changed-since feeds: changed members (with consent), then changed
   * answers, then deletions. Each feed resumes from its own checkpoint, so a run reads only what changed since the
   * last one; a feed's first run starts where the last full import started (minus an overlap), or from the
   * beginning if there was none. Never runs at the same time as an import of the same panel.
   */
  async runSync(panel: PanelCode, opts: SyncOptions = {}) {
    const { connector, dataMode } = this.registry.get(panel);
    if (!connector.memberChanges || !connector.answerChanges || !connector.deletions)
      return {
        jobId: null,
        dataMode,
        status: 'not_supported' as const,
        error: `${panel} connector has no changes feed`,
      };
    if (this.running.has(panel)) throw new Error(`An import or sync for ${panel} is already running`);
    this.running.add(panel);
    const db = this.database.db;
    const maxPages = opts.maxPages ?? 100;
    const [job] = await db
      .insert(importJobs)
      .values({
        panel,
        dataMode,
        kind: 'sync',
        dryRun: false,
        status: 'running',
        requestedBy: opts.requestedBy ?? null,
        startedAt: new Date(),
      })
      .returning();
    const jobId = job!.id;
    const counts: SyncCounts = {
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
      consentsSynced: 0,
      startedFrom: { members: 'beginning', answers: 'beginning', deletions: 'beginning' },
      feedPages: { members: 0, answers: 0, deletions: 0 },
      capped: false,
      membersRemoved: 0,
      answerResets: 0,
      deletionsUnknown: 0,
      answersParked: 0,
      parkedResolved: 0,
      questionsRefreshed: false,
    };
    try {
      let versions = await this.latestVersions(panel, dataMode);
      if (versions.size === 0) {
        // No question registry yet (no import has run): build it first, as a full import would.
        const questionnaires = await connector.listQuestionnaires();
        const questions = await connector.listQuestions();
        counts.questionnaires = questionnaires.length;
        counts.questions = questions.length;
        versions = await this.syncQuestions(panel, dataMode, jobId, questionnaires, questions, counts, false);
        counts.questionsRefreshed = true;
      }
      const since = await this.syncStart(panel, dataMode);

      await this.readFeed(
        panel,
        dataMode,
        jobId,
        'members',
        since,
        maxPages,
        counts,
        (q) => connector.memberChanges!(q),
        async (all) => {
          const items = all.filter((r) => !r.isStaff);
          counts.staffSkipped = (counts.staffSkipped ?? 0) + all.length - items.length;
          counts.respondentsSeen += items.length;
          await this.ingestRespondents(panel, dataMode, jobId, items, counts);
          for (const r of items.filter((x) => x.isDeleted)) {
            if (await this.removeMember(panel, dataMode, jobId, r.sourceMemberId, 'soft_deleted'))
              counts.membersRemoved++;
          }
        },
      );
      counts.parkedResolved += await this.retryParked(panel, dataMode, connector, versions);

      await this.readFeed(
        panel,
        dataMode,
        jobId,
        'answers',
        since,
        maxPages,
        counts,
        (q) => connector.answerChanges!(q),
        async (items) => {
          counts.answersSeen += items.length;
          const personByMember = await this.personsFor(
            panel,
            dataMode,
            items.map((a) => a.sourceMemberId),
          );
          const unknown = [...new Set(items.map((a) => a.sourceMemberId))].filter(
            (m) => !personByMember.has(m),
          );
          if (unknown.length) {
            await db.insert(deadLetters).values({
              dataMode,
              panel,
              importJobId: jobId,
              stream: 'answers',
              sourceMemberIds: unknown,
              errorKind: MEMBER_NOT_SYNCED,
              error: 'Answers arrived before their member; read again once the member is synced',
            });
            counts.answersParked += items.filter((a) => !personByMember.has(a.sourceMemberId)).length;
          }
          counts.answersChanged += await this.ingestAnswers(
            panel,
            dataMode,
            jobId,
            items,
            personByMember,
            versions,
          );
        },
      );

      await this.readFeed(
        panel,
        dataMode,
        jobId,
        'deletions',
        since,
        maxPages,
        counts,
        (q) => connector.deletions!(q),
        async (items) => {
          for (const d of items) {
            if (d.kind === 'member') {
              const done = await this.removeMember(panel, dataMode, jobId, d.sourceMemberId, 'deleted');
              if (done) counts.membersRemoved++;
              else counts.deletionsUnknown++;
            } else {
              counts.answerResets++;
              counts.answersChanged += await this.resetAnswers(panel, dataMode, d.sourceMemberId);
            }
          }
        },
      );

      counts.loyalty = await this.syncLoyalty(panel, jobId, false);
      const changed =
        counts.identitiesCreated + counts.identitiesUpdated + counts.answersChanged + counts.membersRemoved;
      if (changed > 0)
        await db
          .insert(outbox)
          .values({ topic: 'audience.counts.invalidated', payload: { panel, dataMode, syncJobId: jobId } });
      await db
        .update(importJobs)
        .set({ status: 'succeeded', counts, finishedAt: new Date() })
        .where(eq(importJobs.id, jobId));
      await this.audit.record({
        actorId: opts.requestedBy ?? null,
        actorType: opts.requestedBy ? 'admin' : 'system',
        action: 'sync.completed',
        targetType: 'import_job',
        targetId: jobId,
        metadata: {
          panel,
          dataMode,
          members: counts.respondentsSeen,
          answersChanged: counts.answersChanged,
          membersRemoved: counts.membersRemoved,
        },
      });
      return { jobId, dataMode, status: 'succeeded' as const, counts };
    } catch (e) {
      const message = (e as Error).message;
      const notSupported = e instanceof ConnectorError && e.kind === 'not_supported';
      this.log[notSupported ? 'warn' : 'error'](`Sync ${jobId} for ${panel}: ${message}`);
      await db
        .update(importJobs)
        .set({
          status: notSupported ? 'cancelled' : 'failed',
          counts,
          error: message,
          finishedAt: new Date(),
        })
        .where(eq(importJobs.id, jobId));
      await this.audit.record({
        actorId: opts.requestedBy ?? null,
        actorType: 'system',
        action: 'sync.failed',
        outcome: 'failure',
        targetType: 'import_job',
        targetId: jobId,
        metadata: { panel, notSupported },
      });
      return {
        jobId,
        dataMode,
        status: notSupported ? ('not_supported' as const) : ('failed' as const),
        counts,
        error: message,
      };
    } finally {
      this.running.delete(panel);
    }
  }

  /** Reads one feed page by page from its checkpoint, saving the cursor after each page is stored. */
  private async readFeed<T>(
    panel: PanelCode,
    dataMode: DataMode,
    jobId: string,
    feed: SyncFeed,
    since: string | null,
    maxPages: number,
    counts: SyncCounts,
    read: (q: ChangeQuery) => Promise<SourceChangePage<T>>,
    store: (items: T[]) => Promise<void>,
  ) {
    const stream = SYNC_STREAM[feed];
    const cp = await this.database.db.query.syncCheckpoints.findFirst({
      where: and(
        eq(syncCheckpoints.dataMode, dataMode),
        eq(syncCheckpoints.panel, panel),
        eq(syncCheckpoints.stream, stream),
      ),
    });
    let cursor = cp?.cursor ?? null;
    counts.startedFrom[feed] = cursor ? 'cursor' : since ? `since ${since}` : 'beginning';
    for (let page = 0; ; page++) {
      if (page >= maxPages) {
        counts.capped = true;
        break;
      }
      const res = await read({ cursor, since: cursor ? null : since, limit: FEED_LIMIT[feed] });
      counts.pages++;
      counts.feedPages[feed]++;
      if (res.items.length) await store(res.items);
      cursor = res.cursor;
      await this.saveStreamCheckpoint(dataMode, panel, stream, cursor, jobId, !res.more);
      if (!res.more) break;
    }
  }

  /** Where feeds without a checkpoint start: the last successful full import's start, minus an overlap. */
  private async syncStart(panel: PanelCode, dataMode: DataMode): Promise<string | null> {
    const last = await this.database.db.query.importJobs.findFirst({
      where: and(
        eq(importJobs.panel, panel),
        eq(importJobs.dataMode, dataMode),
        eq(importJobs.kind, 'backfill'),
        eq(importJobs.dryRun, false),
        eq(importJobs.status, 'succeeded'),
      ),
      orderBy: [desc(importJobs.startedAt)],
    });
    return last?.startedAt ? new Date(last.startedAt.getTime() - SINCE_OVERLAP_MS).toISOString() : null;
  }

  private async latestVersions(panel: PanelCode, dataMode: DataMode) {
    const latest = await this.mongo.questionVersions
      .aggregate<{ _id: string; version: number }>([
        { $match: { panel, dataMode } },
        { $group: { _id: '$sourceQuestionId', version: { $max: '$version' } } },
      ])
      .toArray();
    return new Map(latest.map((v) => [v._id, v.version]));
  }

  private async personsFor(panel: PanelCode, dataMode: DataMode, memberIds: string[]) {
    const ids = [...new Set(memberIds)];
    if (!ids.length) return new Map<string, string>();
    // Deactivated members still count; members the panel deleted do not (nothing is stored for them again).
    const rows = await this.database.db
      .select({ member: sourceIdentities.sourceMemberId, person: sourceIdentities.masterPersonId })
      .from(sourceIdentities)
      .innerJoin(panelMemberships, eq(panelMemberships.sourceIdentityId, sourceIdentities.id))
      .where(
        and(
          eq(sourceIdentities.dataMode, dataMode),
          eq(sourceIdentities.panel, panel),
          ne(panelMemberships.status, 'deleted'),
          inArray(sourceIdentities.sourceMemberId, ids),
        ),
      );
    return new Map(rows.map((r) => [r.member, r.person]));
  }

  /**
   * Parked answers (dead letters of kind member_not_synced) whose members have now arrived: read those members'
   * current answers and resolve the entry. Members still missing stay parked.
   */
  private async retryParked(
    panel: PanelCode,
    dataMode: DataMode,
    connector: PanelConnector,
    versions: Map<string, number>,
  ) {
    const db = this.database.db;
    const open = await db.query.deadLetters.findMany({
      where: and(
        eq(deadLetters.dataMode, dataMode),
        eq(deadLetters.panel, panel),
        eq(deadLetters.status, 'open'),
        eq(deadLetters.errorKind, MEMBER_NOT_SYNCED),
      ),
    });
    const questionIds = [...versions.keys()].filter((id) => !DIRECT_IDENTIFIER_QUESTIONS.has(id));
    let resolved = 0;
    for (const entry of open) {
      const persons = await this.personsFor(panel, dataMode, entry.sourceMemberIds);
      const known = entry.sourceMemberIds.filter((m) => persons.has(m));
      if (!known.length) continue;
      const answers = await connector.listAnswers(known, questionIds);
      await this.ingestAnswers(panel, dataMode, entry.importJobId ?? entry.id, answers, persons, versions);
      const rest = entry.sourceMemberIds.filter((m) => !persons.has(m));
      await db
        .update(deadLetters)
        .set(
          rest.length
            ? { sourceMemberIds: rest, attempts: entry.attempts + 1, lastAttemptAt: new Date() }
            : {
                status: 'resolved',
                resolvedAt: new Date(),
                lastAttemptAt: new Date(),
                attempts: entry.attempts + 1,
              },
        )
        .where(eq(deadLetters.id, entry.id));
      if (!rest.length) resolved++;
    }
    return resolved;
  }

  /**
   * The panel removed a member: MADP keeps only the pseudonymous source id. The encrypted contact details and
   * e-mail hash are cleared, the panel membership is marked deleted (so audiences leave the member out), this
   * panel's consents are withdrawn, and this panel's answers and answer history are removed. Other panels'
   * data for the same person is not touched. Returns false when MADP never held the member.
   */
  async removeMember(
    panel: PanelCode,
    dataMode: DataMode,
    jobId: string | null,
    sourceMemberId: string,
    reason: 'deleted' | 'soft_deleted' | 'privacy_request',
  ): Promise<boolean> {
    const db = this.database.db;
    const identity = await db.query.sourceIdentities.findFirst({
      where: and(
        eq(sourceIdentities.dataMode, dataMode),
        eq(sourceIdentities.panel, panel),
        eq(sourceIdentities.sourceMemberId, sourceMemberId),
      ),
    });
    if (!identity) return false;
    await db.transaction(async (tx) => {
      await tx
        .update(sourceIdentities)
        .set({
          sourceActive: false,
          emailHash: null,
          emailEnc: null,
          emailMasked: null,
          phoneEnc: null,
          firstNameEnc: null,
          lastNameEnc: null,
          dateOfBirthEnc: null,
          country: null,
          state: null,
          city: null,
          gender: null,
          birthYear: null,
          timezone: null,
          lastImportJobId: jobId,
          updatedAt: new Date(),
        })
        .where(eq(sourceIdentities.id, identity.id));
      // Verification evidence is about this membership only, so it goes with it.
      await tx
        .delete(verificationEvidence)
        .where(
          inArray(
            verificationEvidence.panelMembershipId,
            tx.select({ id: panelMemberships.id }).from(panelMemberships).where(eq(panelMemberships.sourceIdentityId, identity.id)),
          ),
        );
      await tx
        .update(panelMemberships)
        .set({ status: 'deleted', updatedAt: new Date() })
        .where(eq(panelMemberships.sourceIdentityId, identity.id));
      await tx
        .update(consentRecords)
        .set({
          status: 'withdrawn',
          channel: 'panel_sync',
          capturedAt: new Date(),
          evidence: {
            source: 'panel_deletion',
            field: 'member',
            value: reason,
            version: null,
            importJobId: jobId,
          },
        })
        .where(
          and(
            eq(consentRecords.dataMode, dataMode),
            eq(consentRecords.masterPersonId, identity.masterPersonId),
            eq(consentRecords.panel, panel),
          ),
        );
      await recomputePerson(tx, identity.masterPersonId);
    });
    const key = { panel, dataMode, sourceMemberId };
    await this.mongo.profileAnswers.deleteMany(key);
    await this.mongo.answerHistory.deleteMany(key);
    const memberships = await db
      .select({ id: panelMemberships.id })
      .from(panelMemberships)
      .where(eq(panelMemberships.sourceIdentityId, identity.id));
    for (const m of memberships) await this.loyalty.forgetParticipation(m.id);
    await this.audit.record({
      actorId: null,
      actorType: 'system',
      action: 'panel_member.removed',
      targetType: 'master_person',
      targetId: identity.masterPersonId,
      metadata: { panel, dataMode, reason, syncJobId: jobId },
    });
    // The panel deleted a member that a privacy request erased in MADP: the request's panel step is done.
    if (reason !== 'privacy_request') await this.onPanelDeleted?.(panel, dataMode, sourceMemberId);
    return true;
  }

  /** Set by PrivacyService, which owns erasure holds (avoids a circular constructor dependency). */
  onPanelDeleted?: (panel: PanelCode, dataMode: DataMode, sourceMemberId: string) => Promise<void>;

  /** Members erased on request: syncs must not bring them back while the panel still holds them. */
  private async heldMembers(panel: PanelCode, dataMode: DataMode, ids: string[]) {
    if (!ids.length) return new Set<string>();
    const rows = await this.database.db
      .select({ m: erasureHolds.sourceMemberId })
      .from(erasureHolds)
      .where(and(eq(erasureHolds.dataMode, dataMode), eq(erasureHolds.panel, panel), inArray(erasureHolds.sourceMemberId, ids)));
    return new Set(rows.map((r) => r.m));
  }

  /** The panel removed all of a member's answers (T2O refresh): the current ones move to history. */
  private async resetAnswers(panel: PanelCode, dataMode: DataMode, sourceMemberId: string) {
    const key = { panel, dataMode, sourceMemberId };
    const current = await this.mongo.profileAnswers.find(key).toArray();
    if (!current.length) return 0;
    const now = new Date();
    await this.mongo.answerHistory.insertMany(
      current.map(({ _id, ...rest }) => ({ ...rest, supersededAt: now })),
      { ordered: false },
    );
    await this.mongo.profileAnswers.deleteMany(key);
    return current.length;
  }

  private async saveStreamCheckpoint(
    dataMode: DataMode,
    panel: PanelCode,
    stream: string,
    cursor: string | null,
    jobId: string,
    caughtUp: boolean,
  ) {
    await this.database.db
      .insert(syncCheckpoints)
      .values({
        dataMode,
        panel,
        stream,
        cursor,
        lastJobId: jobId,
        lastSuccessAt: caughtUp ? new Date() : null,
      })
      .onConflictDoUpdate({
        target: [syncCheckpoints.dataMode, syncCheckpoints.panel, syncCheckpoints.stream],
        set: {
          cursor,
          lastJobId: jobId,
          updatedAt: new Date(),
          ...(caughtUp ? { lastSuccessAt: new Date() } : {}),
        },
      });
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
    const questionIds = [...versions.keys()].filter((id) => !DIRECT_IDENTIFIER_QUESTIONS.has(id));
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
        if (entry.errorKind === MEMBER_NOT_SYNCED && personByMember.size === 0) {
          // Parked answers whose members have not arrived yet: resolving would lose them.
          await db
            .update(deadLetters)
            .set({ attempts: entry.attempts + 1, lastAttemptAt: new Date() })
            .where(eq(deadLetters.id, entry.id));
          stillOpen++;
          continue;
        }
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
    const held = await this.heldMembers(panel, dataMode, items.map((r) => r.sourceMemberId));
    if (held.size) counts.erasureHeld = (counts.erasureHeld ?? 0) + items.filter((r) => held.has(r.sourceMemberId)).length;
    await this.database.db.transaction(async (tx) => {
      for (const r of items) {
        if (held.has(r.sourceMemberId)) continue;
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
      country: r.country ?? null,
      state: r.state ?? null,
      city: r.city ?? null,
      gender: r.gender ?? null,
      birthYear: r.dateOfBirth ? Number.parseInt(r.dateOfBirth.slice(0, 4), 10) || null : null,
      timezone: r.timezone ?? null,
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
    // Consent: one current record per person, panel and purpose, refreshed on every sync. Evidence holds the
    // source field, its status value and the version only; guardian contact details and IPs never leave the panel.
    for (const c of r.consents ?? []) {
      const evidence = {
        source: 'panel_sync',
        field: c.evidence.field,
        value: c.evidence.value,
        version: c.evidence.version,
        importJobId: jobId,
      };
      const capturedAt = c.capturedAt ? new Date(c.capturedAt) : null;
      await tx
        .insert(consentRecords)
        .values({
          dataMode,
          masterPersonId: personId,
          panel,
          purpose: c.purpose,
          channel: 'panel_sync',
          status: c.status,
          evidence,
          capturedAt,
        })
        .onConflictDoUpdate({
          target: [
            consentRecords.dataMode,
            consentRecords.masterPersonId,
            consentRecords.panel,
            consentRecords.purpose,
          ],
          set: { status: c.status, evidence, capturedAt, channel: 'panel_sync' },
        });
      counts.consentsSynced++;
    }
    // Person-level location and demographics: chosen from all of the person's identities by source precedence.
    await recomputePerson(tx, personId);
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
    // One read and one bulk write per page instead of two round trips per answer.
    const memberIds = [...new Set(answers.map((a) => a.sourceMemberId))];
    const existing = await this.mongo.profileAnswers
      .find({ panel, dataMode, sourceMemberId: { $in: memberIds } })
      .toArray();
    const prevByKey = new Map(existing.map((d) => [`${d.sourceMemberId}\u0000${d.sourceQuestionId}`, d]));
    const now = new Date();
    const history: AnswerHistoryDoc[] = [];
    const writes: AnyBulkWriteOperation<ProfileAnswerDoc>[] = [];
    for (const a of answers) {
      // Defence in depth: a source that returns more than was asked for still cannot store identifiers.
      if (DIRECT_IDENTIFIER_QUESTIONS.has(a.sourceQuestionId)) continue;
      const personId = personByMember.get(a.sourceMemberId);
      if (!personId) continue;
      const questionVersion = versions.get(a.sourceQuestionId) ?? 0;
      const values = [...a.values].sort();
      const key = { panel, dataMode, sourceMemberId: a.sourceMemberId, sourceQuestionId: a.sourceQuestionId };
      const prev = prevByKey.get(`${a.sourceMemberId}\u0000${a.sourceQuestionId}`);
      if (prev && JSON.stringify(prev.values) === JSON.stringify(values)) continue;
      if (prev) {
        const { _id, ...rest } = prev;
        history.push({ ...rest, supersededAt: now });
      }
      const doc: ProfileAnswerDoc = {
        ...key,
        personId,
        questionVersion,
        values,
        sensitivity:
          sens.get(`${a.sourceQuestionId}@${questionVersion}`) ??
          sensitivityFor(panel, a.sourceQuestionId, []),
        sourceUpdatedAt: a.sourceUpdatedAt ? new Date(a.sourceUpdatedAt) : null,
        ingestedAt: now,
        importJobId: jobId,
      };
      writes.push({ updateOne: { filter: key, update: { $set: doc }, upsert: true } });
      // A repeated answer in the same batch compares against this one, not the stored one.
      prevByKey.set(`${a.sourceMemberId}\u0000${a.sourceQuestionId}`, doc as WithId<ProfileAnswerDoc>);
      changed++;
    }
    if (history.length) await this.mongo.answerHistory.insertMany(history, { ordered: false });
    if (writes.length) await this.mongo.profileAnswers.bulkWrite(writes, { ordered: false });
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
