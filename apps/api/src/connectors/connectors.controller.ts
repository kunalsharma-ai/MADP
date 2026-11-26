import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  NotFoundException,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { and, count, desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PANELS, PanelCode, isBuiltInPanel } from '@madp/contracts';
import { PanelDirectory } from '../panels/panel-directory.js';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import {
  deadLetters,
  importJobs,
  panelMemberships,
  sourceIdentities,
  sourceQuestionMappings,
  syncCheckpoints,
} from '../db/schema.js';
import { Mongo } from '../mongo/mongo.js';
import { MEMBER_NOT_SYNCED, type ImportCounts } from '../ingestion/ingestion.service.js';
import { ConnectorRegistry } from './connector-registry.js';
import { IngestionService } from '../ingestion/ingestion.service.js';
import { SyncScheduler } from '../ingestion/sync-scheduler.js';
import { AuditService } from '../audit/audit.service.js';

@Controller()
export class ConnectorsController {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly ingestion: IngestionService,
    private readonly database: Database,
    private readonly audit: AuditService,
    private readonly mongo: Mongo,
    private readonly scheduler: SyncScheduler,
    private readonly panels: PanelDirectory,
  ) {}

  /** Proposed Supply360-facing health endpoint (spec section 12): no panel data, only status. */
  @RequirePermissions('connectors.read')
  @Get('integrations/health')
  async health() {
    const checks = await Promise.all(this.registry.all().map((s) => s.connector.health()));
    return { checkedAt: new Date().toISOString(), panels: checks };
  }

  @RequirePermissions('connectors.read')
  @Get('connectors')
  async list() {
    const db = this.database.db;
    return Promise.all(
      this.registry.all().map(async (slot) => {
        const [health, lastJob, checkpoint] = await Promise.all([
          slot.connector.health(),
          db.query.importJobs.findFirst({
            where: eq(importJobs.panel, slot.panel),
            orderBy: [desc(importJobs.createdAt)],
          }),
          db.query.syncCheckpoints.findFirst({
            where: (c, { and, eq }) =>
              and(eq(c.panel, slot.panel), eq(c.dataMode, slot.dataMode), eq(c.stream, 'respondents')),
          }),
        ]);
        return {
          panel: slot.panel,
          name: this.panels.name(slot.panel),
          shortName: this.panels.shortName(slot.panel),
          sensitive: this.panels.sensitive(slot.panel),
          sourceRepository: isBuiltInPanel(slot.panel) ? PANELS[slot.panel].sourceRepository : null,
          dataMode: slot.dataMode,
          reason: slot.reason,
          health,
          capabilities: slot.connector.capabilities(),
          lastJob: lastJob ?? null,
          lastSuccessAt: checkpoint?.lastSuccessAt ?? null,
          pendingCursor: checkpoint?.cursor ?? null,
        };
      }),
    );
  }

  @RequirePermissions('connectors.read')
  @Get('imports')
  async jobs() {
    return this.database.db.select().from(importJobs).orderBy(desc(importJobs.createdAt)).limit(50);
  }

  @RequirePermissions('imports.run')
  @Post('connectors/:panel/import')
  @HttpCode(200)
  async runImport(
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Body(new ZodPipe(z.object({ dryRun: z.boolean().default(true) }))) body: { dryRun: boolean },
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'import.requested',
      targetType: 'panel',
      targetId: panel,
      metadata: { dryRun: body.dryRun, dataMode: this.registry.get(panel).dataMode },
      ip: req.ip ?? null,
    });
    return this.ingestion.runImport(panel, { dryRun: body.dryRun, requestedBy: p.id });
  }

  /**
   * One automatic-sync run now: reads only what changed since the last run (changed members with consent,
   * changed answers, deletions). Answers 409 while another import or sync of the panel is running.
   */
  @RequirePermissions('imports.run')
  @Post('connectors/:panel/sync')
  @HttpCode(200)
  async runSync(
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: 'sync.requested',
      targetType: 'panel',
      targetId: panel,
      metadata: { dataMode: this.registry.get(panel).dataMode },
      ip: req.ip ?? null,
    });
    let res;
    try {
      res = await this.scheduler.runLocked(panel, p.id);
    } catch (e) {
      if (/already running/.test((e as Error).message)) throw new ConflictException((e as Error).message);
      throw e;
    }
    if (!res) throw new ConflictException(`A sync of ${panel} is already running`);
    return res;
  }

  /** Automatic sync status per panel: schedule, feed checkpoints, last run and parked answers. Counts only. */
  @RequirePermissions('connectors.read')
  @Get('sync-status')
  async syncStatus() {
    const db = this.database.db;
    const scheduled = new Set(this.scheduler.panels());
    return {
      intervalMinutes: this.scheduler.intervalMinutes,
      panels: await Promise.all(
        this.registry.all().map(async (slot) => {
          const [lastRun, lastOk, streams, [parked]] = await Promise.all([
            db.query.importJobs.findFirst({
              where: and(eq(importJobs.panel, slot.panel), eq(importJobs.kind, 'sync')),
              orderBy: [desc(importJobs.createdAt)],
            }),
            db.query.importJobs.findFirst({
              where: and(
                eq(importJobs.panel, slot.panel),
                eq(importJobs.kind, 'sync'),
                eq(importJobs.status, 'succeeded'),
              ),
              orderBy: [desc(importJobs.createdAt)],
            }),
            db
              .select({ stream: syncCheckpoints.stream, lastSuccessAt: syncCheckpoints.lastSuccessAt })
              .from(syncCheckpoints)
              .where(and(eq(syncCheckpoints.panel, slot.panel), eq(syncCheckpoints.dataMode, slot.dataMode))),
            db
              .select({ n: count() })
              .from(deadLetters)
              .where(
                and(
                  eq(deadLetters.panel, slot.panel),
                  eq(deadLetters.status, 'open'),
                  eq(deadLetters.errorKind, MEMBER_NOT_SYNCED),
                ),
              ),
          ]);
          const supported = slot.connector
            .capabilities()
            .find((c) => c.capability === 'answers.updatedSince');
          return {
            panel: slot.panel,
            dataMode: slot.dataMode,
            scheduled: scheduled.has(slot.panel),
            feedFinding: supported ?? null,
            lastRun: lastRun
              ? {
                  id: lastRun.id,
                  status: lastRun.status,
                  startedAt: lastRun.startedAt,
                  finishedAt: lastRun.finishedAt,
                  error: lastRun.error,
                  counts: lastRun.counts,
                }
              : null,
            lastSucceededAt: lastOk?.finishedAt ?? null,
            streams: streams.filter((s) => s.stream.startsWith('changes.')),
            parkedAnswerBatches: parked!.n,
          };
        }),
      ),
    };
  }

  @RequirePermissions('connectors.read')
  @Get('sync-checkpoints')
  async checkpoints() {
    return this.database.db.select().from(syncCheckpoints);
  }

  @RequirePermissions('connectors.read')
  @Get('dead-letters')
  async deadLetters(
    @Query(
      new ZodPipe(
        z.object({ panel: PanelCode.optional(), status: z.enum(['open', 'resolved']).default('open') }),
      ),
    )
    q: {
      panel?: PanelCode;
      status: 'open' | 'resolved';
    },
  ) {
    const rows = await this.database.db
      .select()
      .from(deadLetters)
      .where(and(eq(deadLetters.status, q.status), q.panel ? eq(deadLetters.panel, q.panel) : undefined))
      .orderBy(desc(deadLetters.createdAt))
      .limit(200);
    // Member ids are pseudonymous source references; the list shows how many, not which.
    return rows.map(({ sourceMemberIds, ...r }) => ({ ...r, memberCount: sourceMemberIds.length }));
  }

  @RequirePermissions('imports.run')
  @Post('connectors/:panel/dead-letters/retry')
  @HttpCode(200)
  async retryDeadLetters(
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @CurrentPrincipal() p: Principal,
  ) {
    return this.ingestion.retryDeadLetters(panel, p.id);
  }

  /**
   * Reconciliation report for one import: what the source returned vs what MADP holds now, with explicit
   * checks. Counts only - no personal data.
   */
  @RequirePermissions('connectors.read')
  @Get('imports/:id/reconciliation')
  async reconciliation(@Param('id', new ZodPipe(z.string().uuid())) id: string) {
    const db = this.database.db;
    const job = await db.query.importJobs.findFirst({ where: eq(importJobs.id, id) });
    if (!job) throw new NotFoundException('Import job not found');
    const c = job.counts as Partial<ImportCounts>;
    const scope = { dataMode: job.dataMode, panel: job.panel };
    const [[touched], [identities], [memberships], [openDl], [pendingMappings], answers, questions] =
      await Promise.all([
        db.select({ n: count() }).from(sourceIdentities).where(eq(sourceIdentities.lastImportJobId, job.id)),
        db
          .select({ n: count() })
          .from(sourceIdentities)
          .where(and(eq(sourceIdentities.dataMode, scope.dataMode), eq(sourceIdentities.panel, scope.panel))),
        db
          .select({ n: count() })
          .from(panelMemberships)
          .where(and(eq(panelMemberships.dataMode, scope.dataMode), eq(panelMemberships.panel, scope.panel))),
        db
          .select({ n: count() })
          .from(deadLetters)
          .where(and(eq(deadLetters.importJobId, job.id), eq(deadLetters.status, 'open'))),
        db
          .select({ n: count() })
          .from(sourceQuestionMappings)
          .where(
            and(
              eq(sourceQuestionMappings.dataMode, scope.dataMode),
              eq(sourceQuestionMappings.panel, scope.panel),
              eq(sourceQuestionMappings.status, 'pending'),
            ),
          ),
        this.mongo.profileAnswers.countDocuments(scope),
        this.mongo.questionVersions.distinct('sourceQuestionId', scope),
      ]);
    const unknown = Object.values(c.unknownCategories ?? {}).reduce((a, b) => a + b, 0);
    const checks = job.dryRun
      ? [{ check: 'Source categories all recognised', expected: 0, actual: unknown, ok: unknown === 0 }]
      : [
          {
            check: 'Every respondent read from the source was written to MADP',
            expected: c.respondentsSeen ?? 0,
            actual: touched!.n,
            ok: touched!.n === (c.respondentsSeen ?? 0),
          },
          {
            check: 'Every source question is in the registry',
            expected: c.questions ?? 0,
            actual: questions.length,
            ok: questions.length >= (c.questions ?? 0),
          },
          {
            check: 'No answer batches left in the dead-letter queue',
            expected: 0,
            actual: openDl!.n,
            ok: openDl!.n === 0,
          },
          { check: 'Source categories all recognised', expected: 0, actual: unknown, ok: unknown === 0 },
        ];
    return {
      job: { id: job.id, panel: job.panel, dataMode: job.dataMode, dryRun: job.dryRun, status: job.status },
      source: {
        questionnaires: c.questionnaires ?? 0,
        questions: c.questions ?? 0,
        respondents: c.respondentsSeen ?? 0,
        answers: c.answersSeen ?? 0,
      },
      madp: {
        identitiesWrittenByJob: touched!.n,
        identitiesTotal: identities!.n,
        panelMemberships: memberships!.n,
        questionsInRegistry: questions.length,
        currentAnswers: answers,
        pendingMappings: pendingMappings!.n,
        openDeadLetters: openDl!.n,
      },
      checks,
      status:
        job.status !== 'succeeded' ? 'failed' : checks.every((x) => x.ok) ? 'reconciled' : 'discrepancies',
    };
  }
}
