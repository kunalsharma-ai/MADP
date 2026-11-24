import { Controller, Get, Header, Query, Req, Res } from '@nestjs/common';
import { and, desc, eq, gte, like, lt, lte, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import type { BrandSelection } from '@madp/contracts';
import type { Request, Response } from 'express';
import { BrandScoped, CurrentBrand, RequirePermissions } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { auditEvents } from '../db/schema.js';
import { AuditService } from './audit.service.js';

const Filters = z.object({
  before: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  actorId: z.string().uuid().optional(),
  /** Exact action, or a prefix ending in "." (e.g. "points."). */
  action: z
    .string()
    .regex(/^[a-z0-9_.]{2,80}$/)
    .optional(),
  targetType: z
    .string()
    .regex(/^[a-z0-9_]{2,60}$/)
    .optional(),
  targetId: z.string().max(200).optional(),
  outcome: z.enum(['success', 'denied', 'failure']).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
type Filters = z.infer<typeof Filters>;

const CSV_COLUMNS = [
  'id',
  'at',
  'actorId',
  'actorType',
  'actorRole',
  'panel',
  'action',
  'targetType',
  'targetId',
  'outcome',
  'reason',
  'before',
  'after',
  'metadata',
  'ip',
  'userAgent',
  'requestId',
  'prevHash',
  'hash',
] as const;

function csvCell(v: unknown): string {
  if (v == null) return '';
  const s = v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v);
  // Neutralise spreadsheet formulas, then quote.
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/** Audit screen: filters by admin, member (target), action, brand and date; CSV export; hash chain check. */
@Controller('audit')
export class AuditController {
  constructor(
    private readonly database: Database,
    private readonly audit: AuditService,
  ) {}

  private where(q: Filters, brand: BrandSelection): SQL | undefined {
    const c: (SQL | undefined)[] = [
      q.before ? lt(auditEvents.id, q.before) : undefined,
      brand === 'all' ? undefined : eq(auditEvents.panel, brand),
      q.actorId ? eq(auditEvents.actorId, q.actorId) : undefined,
      q.action
        ? q.action.endsWith('.')
          ? like(auditEvents.action, `${q.action}%`)
          : eq(auditEvents.action, q.action)
        : undefined,
      q.targetType ? eq(auditEvents.targetType, q.targetType) : undefined,
      q.targetId ? eq(auditEvents.targetId, q.targetId) : undefined,
      q.outcome ? eq(auditEvents.outcome, q.outcome) : undefined,
      q.from ? gte(auditEvents.at, q.from) : undefined,
      q.to ? lte(auditEvents.at, q.to) : undefined,
    ];
    return and(...c.filter(Boolean));
  }

  @RequirePermissions('audit.read')
  @BrandScoped({ allowAll: true })
  @Get()
  async list(@Query(new ZodPipe(Filters)) q: Filters, @CurrentBrand() brand: BrandSelection) {
    const rows = await this.database.db
      .select()
      .from(auditEvents)
      .where(this.where(q, brand))
      .orderBy(desc(auditEvents.id))
      .limit(q.limit);
    return { items: rows, nextBefore: rows.length === q.limit ? (rows.at(-1)?.id ?? null) : null };
  }

  /** Recomputes the whole hash chain. Needs audit.read on every brand. */
  @RequirePermissions('audit.read')
  @Get('verify')
  async verify(@Req() req: Request) {
    const result = await this.audit.verifyChain();
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'audit.verify',
      outcome: result.ok ? 'success' : 'failure',
      metadata: { checked: result.checked, firstBrokenId: result.firstBrokenId, problem: result.problem },
    });
    return result;
  }

  @RequirePermissions('audit.read')
  @BrandScoped({ allowAll: true })
  @Get('export')
  @Header('content-type', 'text/csv; charset=utf-8')
  async export(
    @Query(
      new ZodPipe(
        Filters.omit({ limit: true }).extend({
          limit: z.coerce.number().int().min(1).max(50_000).default(10_000),
        }),
      ),
    )
    q: Filters,
    @CurrentBrand() brand: BrandSelection,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ) {
    const rows = await this.database.db
      .select()
      .from(auditEvents)
      .where(this.where(q, brand))
      .orderBy(desc(auditEvents.id))
      .limit(q.limit);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'audit.export',
      panel: brand === 'all' ? null : brand,
      metadata: {
        rows: rows.length,
        filters: { ...q, from: q.from?.toISOString(), to: q.to?.toISOString() },
      },
    });
    res.setHeader(
      'content-disposition',
      `attachment; filename="madp-audit-${brand}-${new Date().toISOString().slice(0, 10)}.csv"`,
    );
    const lines = [CSV_COLUMNS.join(',')];
    for (const r of rows) lines.push(CSV_COLUMNS.map((k) => csvCell(r[k])).join(','));
    return `${lines.join('\r\n')}\r\n`;
  }
}
