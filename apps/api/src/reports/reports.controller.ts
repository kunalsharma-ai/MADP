import { Controller, Get, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import { ForbiddenException } from '@nestjs/common';
import { ReportExportQuery, ReportKey, ReportParams, type BrandSelection } from '@madp/contracts';
import type { Request, Response } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { AudienceService } from '../audience/audience.service.js';
import { ReportsService } from './reports.service.js';
import { toCsv, toXlsx } from './export-writer.js';
import { PanelDirectory } from '../panels/panel-directory.js';

const key = (k: string) => {
  const r = ReportKey.safeParse(k);
  if (!r.success) throw new NotFoundException('No such report');
  return r.data;
};

/**
 * Reports, analytics and exports (screens 23 and 29). Works in the brand picked in the brand switcher, or every
 * brand side by side. Each report also needs its own permission; downloads need export.read and are audited.
 */
@Controller('reports')
export class ReportsController {
  constructor(
    private readonly panelDirectory: PanelDirectory,
    private readonly reports: ReportsService,
    private readonly audience: AudienceService,
    private readonly audit: AuditService,
  ) {}

  @RequirePermissions('reports.read')
  @BrandScoped({ allowAll: true })
  @Get()
  catalogue(@CurrentPrincipal() p: Principal, @CurrentBrand() brand: BrandSelection) {
    return { reports: this.reports.catalogue(this.held(p, brand)) };
  }

  @RequirePermissions('reports.read')
  @BrandScoped({ allowAll: true })
  @Get(':key')
  run(
    @Param('key') k: string,
    @Query(new ZodPipe(ReportParams)) q: ReportParams,
    @CurrentPrincipal() p: Principal,
    @CurrentBrand() brand: BrandSelection,
  ) {
    return this.reports.run(
      this.audience.defaultMode(),
      key(k),
      this.panelDirectory.forBrand(brand, q.panel),
      q,
      this.held(p, brand),
      p.id,
    );
  }

  @RequirePermissions('reports.read', 'export.read')
  @BrandScoped({ allowAll: true })
  @Get(':key/export')
  async export(
    @Param('key') k: string,
    @Query(new ZodPipe(ReportParams)) q: ReportParams,
    @Query(new ZodPipe(ReportExportQuery)) e: ReportExportQuery,
    @CurrentPrincipal() p: Principal,
    @CurrentBrand() brand: BrandSelection,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const rk = key(k);
    const held = this.held(p, brand);
    if (this.reports.def(rk).pii && !held.includes('export.pii'))
      throw new ForbiddenException('This export holds personal data and needs export.pii');
    const r = await this.reports.run(
      this.audience.defaultMode(),
      rk,
      this.panelDirectory.forBrand(brand, q.panel),
      q,
      held,
      p.id,
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      panel: brand === 'all' ? null : brand,
      action: 'report.exported',
      targetType: 'report',
      targetId: rk,
      metadata: {
        format: e.format,
        rows: r.rows.length,
        panel: q.panel ?? null,
        brand,
        period: r.period,
        dataMode: r.dataMode,
      },
    });
    const name = `madp-${rk}-${brand}${r.dataMode === 'demo' ? '-DEMO' : ''}-${r.generatedAt.slice(0, 10)}.${e.format}`;
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('cache-control', 'no-store');
    if (e.format === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.send(toCsv(r));
    } else {
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(await toXlsx(r, brand));
    }
  }

  /** Permissions held in the selected brand (every brand for `all`). */
  private held(p: Principal, brand: BrandSelection) {
    return brand === 'all' ? p.permissions : (p.brandPermissions[brand] ?? []);
  }
}
