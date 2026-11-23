import {
  BadRequestException,
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { PanelCode } from '@madp/contracts';
import type { Request } from 'express';
import { RequirePermissions, CurrentPrincipal } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { attributeDefinitions, sourceQuestionMappings } from '../db/schema.js';
import { Mongo } from '../mongo/mongo.js';
import { AudienceService } from '../audience/audience.service.js';
import { AuditService } from '../audit/audit.service.js';

const QuestionQuery = z.object({ panel: PanelCode.optional(), search: z.string().max(100).optional() });
const ReviewQuery = z.object({
  panel: PanelCode.optional(),
  status: z.enum(['pending', 'approved', 'rejected', 'needs_info']).default('pending'),
});
const Decision = z.object({
  decision: z.enum(['approve', 'reject', 'needs_info']),
  attributeKey: z.string().optional(),
  /** Source option value -> canonical value. Source values must exist in this question version's options. */
  valueMap: z
    .record(z.string().min(1).max(200), z.string().min(1).max(200))
    .refine((m) => Object.keys(m).length <= 500, 'At most 500 value map entries')
    .optional(),
  notes: z.string().max(1000).optional(),
});

@Controller()
export class RegistryController {
  constructor(
    private readonly database: Database,
    private readonly mongo: Mongo,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  /** Latest version of every source question, per panel, with its mapping state. */
  @RequirePermissions('questions.read')
  @Get('questions')
  async questions(@Query(new ZodPipe(QuestionQuery)) q: z.infer<typeof QuestionQuery>) {
    const mode = this.audience.defaultMode();
    const match: Record<string, unknown> = { dataMode: mode, ...(q.panel ? { panel: q.panel } : {}) };
    if (q.search)
      match.$or = [
        { sourceQuestionId: { $regex: escapeRe(q.search), $options: 'i' } },
        { label: { $regex: escapeRe(q.search), $options: 'i' } },
      ];
    const latest = await this.mongo.questionVersions
      .aggregate<{ _id: { panel: string; q: string }; doc: Record<string, unknown>; versions: number }>([
        { $match: match },
        { $sort: { version: -1 } },
        {
          $group: {
            _id: { panel: '$panel', q: '$sourceQuestionId' },
            doc: { $first: '$$ROOT' },
            versions: { $sum: 1 },
          },
        },
        { $sort: { '_id.panel': 1, '_id.q': 1 } },
      ])
      .toArray();
    const mappings = await this.database.db
      .select()
      .from(sourceQuestionMappings)
      .where(eq(sourceQuestionMappings.dataMode, mode));
    const byKey = new Map(mappings.map((m) => [`${m.panel}|${m.sourceQuestionId}|${m.questionVersion}`, m]));
    return {
      dataMode: mode,
      items: latest.map(({ doc, versions }) => {
        const m = byKey.get(`${doc.panel}|${doc.sourceQuestionId}|${doc.version}`);
        const options = (doc.options as unknown[]) ?? [];
        return {
          panel: doc.panel,
          sourceQuestionId: doc.sourceQuestionId,
          label: doc.label,
          type: doc.type,
          parent: doc.parent,
          sourceCategories: doc.sourceCategories,
          questionnaires: doc.questionnaires,
          sensitivity: doc.sensitivity,
          version: doc.version,
          versions,
          optionCount: options.length,
          firstSeenAt: doc.firstSeenAt,
          mapping: m
            ? {
                id: m.id,
                status: m.status,
                attributeKey: m.attributeKey,
                suggestedAttributeKey: m.suggestedAttributeKey,
              }
            : null,
        };
      }),
    };
  }

  @RequirePermissions('questions.read')
  @Get('questions/:panel/:sourceQuestionId')
  async question(
    @Param('panel', new ZodPipe(PanelCode)) panel: PanelCode,
    @Param('sourceQuestionId') id: string,
  ) {
    const versions = await this.mongo.questionVersions
      .find(
        { panel, dataMode: this.audience.defaultMode(), sourceQuestionId: id },
        { projection: { _id: 0 } },
      )
      .sort({ version: -1 })
      .toArray();
    if (!versions.length) throw new NotFoundException();
    return { versions };
  }

  @RequirePermissions('mappings.review')
  @Get('mappings/review')
  async reviewQueue(@Query(new ZodPipe(ReviewQuery)) q: z.infer<typeof ReviewQuery>) {
    const mode = this.audience.defaultMode();
    const rows = await this.database.db
      .select()
      .from(sourceQuestionMappings)
      .where(
        and(
          eq(sourceQuestionMappings.dataMode, mode),
          eq(sourceQuestionMappings.status, q.status),
          q.panel ? eq(sourceQuestionMappings.panel, q.panel) : sql`true`,
        ),
      )
      .orderBy(
        asc(sourceQuestionMappings.panel),
        asc(sourceQuestionMappings.sourceQuestionId),
        desc(sourceQuestionMappings.questionVersion),
      )
      .limit(500);
    const labels = new Map(
      (
        await this.mongo.questionVersions
          .find(
            { dataMode: mode },
            {
              projection: {
                panel: 1,
                sourceQuestionId: 1,
                version: 1,
                label: 1,
                sensitivity: 1,
                options: { $slice: 6 },
              },
            },
          )
          .toArray()
      ).map((d) => [`${d.panel}|${d.sourceQuestionId}|${d.version}`, d]),
    );
    const totals = await this.database.db.execute<{ status: string; n: string }>(
      sql`select status::text, count(*) as n from source_question_mapping where data_mode = ${mode} group by 1`,
    );
    return {
      dataMode: mode,
      totals: Object.fromEntries(totals.rows.map((r) => [r.status, Number(r.n)])),
      items: rows.map((r) => {
        const d = labels.get(`${r.panel}|${r.sourceQuestionId}|${r.questionVersion}`);
        return {
          ...r,
          label: d?.label ?? null,
          sensitivity: d?.sensitivity ?? null,
          sampleOptions: d?.options ?? [],
        };
      }),
    };
  }

  @RequirePermissions('mappings.review')
  @Post('mappings/:id/decision')
  async decide(
    @Param('id', new ParseUUIDPipe()) id: string,
    @Body(new ZodPipe(Decision)) body: z.infer<typeof Decision>,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ) {
    const row = await this.database.db.query.sourceQuestionMappings.findFirst({
      where: eq(sourceQuestionMappings.id, id),
    });
    if (!row) throw new NotFoundException();
    let attributeKey: string | null = null;
    if (body.decision === 'approve') {
      attributeKey = body.attributeKey ?? row.suggestedAttributeKey;
      if (!attributeKey)
        throw new BadRequestException('Choose a canonical attribute to approve this mapping');
      const attr = await this.database.db.query.attributeDefinitions.findFirst({
        where: eq(attributeDefinitions.key, attributeKey),
      });
      if (!attr) throw new BadRequestException('Unknown canonical attribute');
      if (body.valueMap && Object.keys(body.valueMap).length) {
        const version = await this.mongo.questionVersions.findOne({
          panel: row.panel,
          dataMode: row.dataMode,
          sourceQuestionId: row.sourceQuestionId,
          version: row.questionVersion,
        });
        const known = new Set((version?.options ?? []).map((o) => o.value));
        // Reference lists (cities, states...) are not stored as options, so their values cannot be checked.
        const unknown = known.size ? Object.keys(body.valueMap).filter((v) => !known.has(v)) : [];
        if (unknown.length)
          throw new BadRequestException(
            `Not options of this question version: ${unknown.slice(0, 5).join(', ')}`,
          );
      }
    }
    const status =
      body.decision === 'approve' ? 'approved' : body.decision === 'reject' ? 'rejected' : 'needs_info';
    const [updated] = await this.database.db
      .update(sourceQuestionMappings)
      .set({
        status,
        attributeKey,
        valueMap: body.decision === 'approve' && body.valueMap ? body.valueMap : null,
        notes: body.notes ?? null,
        decidedBy: p.id,
        decidedAt: new Date(),
      })
      .where(eq(sourceQuestionMappings.id, id))
      .returning();
    await this.audit.record({
      actorId: p.id,
      actorType: 'admin',
      action: `mapping.${body.decision}`,
      targetType: 'source_question_mapping',
      targetId: id,
      metadata: {
        panel: row.panel,
        sourceQuestionId: row.sourceQuestionId,
        version: row.questionVersion,
        attributeKey,
        valueMapEntries: body.valueMap ? Object.keys(body.valueMap).length : 0,
      },
      ip: req.ip ?? null,
    });
    return updated;
  }
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
