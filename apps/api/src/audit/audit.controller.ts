import { Controller, Get, Query } from '@nestjs/common';
import { desc, lt } from 'drizzle-orm';
import { z } from 'zod';
import { RequirePermissions } from '../auth/decorators.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { auditEvents } from '../db/schema.js';

@Controller('audit')
export class AuditController {
  constructor(private readonly database: Database) {}

  @RequirePermissions('audit.read')
  @Get()
  async list(@Query(new ZodPipe(z.object({ before: z.coerce.number().int().optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }))) q: { before?: number; limit: number }) {
    const rows = await this.database.db
      .select()
      .from(auditEvents)
      .where(q.before ? lt(auditEvents.id, q.before) : undefined)
      .orderBy(desc(auditEvents.id))
      .limit(q.limit);
    return { items: rows, nextBefore: rows.length === q.limit ? (rows.at(-1)?.id ?? null) : null };
  }
}
