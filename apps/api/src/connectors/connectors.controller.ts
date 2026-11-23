import { Body, Controller, Get, HttpCode, Param, Post, Req } from '@nestjs/common';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { PANELS, PanelCode } from '@madp/contracts';
import type { Request } from 'express';
import { CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { Database } from '../db/database.js';
import { importJobs, syncCheckpoints } from '../db/schema.js';
import { ConnectorRegistry } from './connector-registry.js';
import { IngestionService } from '../ingestion/ingestion.service.js';
import { AuditService } from '../audit/audit.service.js';

@Controller()
export class ConnectorsController {
  constructor(
    private readonly registry: ConnectorRegistry,
    private readonly ingestion: IngestionService,
    private readonly database: Database,
    private readonly audit: AuditService,
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
          db.query.importJobs.findFirst({ where: eq(importJobs.panel, slot.panel), orderBy: [desc(importJobs.createdAt)] }),
          db.query.syncCheckpoints.findFirst({ where: (c, { and, eq }) => and(eq(c.panel, slot.panel), eq(c.dataMode, slot.dataMode), eq(c.stream, 'respondents')) }),
        ]);
        return {
          panel: slot.panel,
          name: PANELS[slot.panel].name,
          shortName: PANELS[slot.panel].shortName,
          sensitive: PANELS[slot.panel].sensitive,
          sourceRepository: PANELS[slot.panel].sourceRepository,
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
    await this.audit.record({ actorId: p.id, actorType: 'admin', action: 'import.requested', targetType: 'panel', targetId: panel, metadata: { dryRun: body.dryRun, dataMode: this.registry.get(panel).dataMode }, ip: req.ip ?? null });
    return this.ingestion.runImport(panel, { dryRun: body.dryRun, requestedBy: p.id });
  }

  @RequirePermissions('connectors.read')
  @Get('sync-checkpoints')
  async checkpoints() {
    return this.database.db.select().from(syncCheckpoints);
  }
}
