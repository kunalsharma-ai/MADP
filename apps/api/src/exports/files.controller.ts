import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import { z } from 'zod';
import {
  EXPORT_SCREENS,
  FileParseRequest,
  TableExportRequest,
  type BrandSelection,
  type DataMode,
  type Permission,
} from '@madp/contracts';
import type { Request, Response } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { CONTENT_TYPE, documentToDocx, documentToPdf, fileName, writeTable } from './writers.js';
import { FileProblem, parseDocx, parseTable } from './parse.js';

const Text = (max: number) => z.string().trim().min(1).max(max);
const List = z.array(Text(5000)).min(1).max(100);
/** The panel content block shape (see ContentBlock in contracts), for pages and help articles. */
const Block = z.union([
  Text(5000),
  z.object({ h2: Text(200) }).strict(),
  z.object({ h3: Text(200) }).strict(),
  z.object({ note: Text(5000) }).strict(),
  z.object({ ul: List }).strict(),
  z.object({ ol: List }).strict(),
  z
    .object({
      table: z
        .object({
          head: z.array(z.string().max(5000)).min(1).max(12),
          rows: z.array(z.array(z.string().max(1000))).max(300),
        })
        .strict(),
    })
    .strict(),
]);
const DocumentExportRequest = z.object({
  screen: z.enum(['content_page', 'help_centre', 'mailers', 'questionnaire']),
  format: z.enum(['pdf', 'docx']),
  title: Text(200),
  subtitle: z.string().trim().max(400).optional(),
  blocks: z.array(Block).min(1).max(400),
});
type DocumentExportRequest = z.infer<typeof DocumentExportRequest>;

/**
 * Downloads and uploads for every console screen. Downloads write the table (or page) the admin is looking at into
 * Excel, CSV, PDF or Word: the rows are exactly what the screen showed, so masking, teen hiding and MHO health rules
 * still apply; the data mode comes from the brand's connector, not the browser. Every download is audited (screen,
 * format, row count and columns, never the values). Upload parsing only reads the file and writes nothing.
 */
@Controller('files')
export class FilesController {
  constructor(
    private readonly audit: AuditService,
    private readonly registry: ConnectorRegistry,
  ) {}

  /** DEMO when the brand (or, for every brand, any brand) is not live yet. */
  private mode(brand: BrandSelection): DataMode {
    if (brand !== 'all') {
      try {
        return this.registry.get(brand).dataMode;
      } catch {
        return 'demo';
      }
    }
    return this.registry.all().every((s) => s.dataMode === 'live') ? 'live' : 'demo';
  }

  private async check(
    p: Principal,
    brand: BrandSelection,
    screen: keyof typeof EXPORT_SCREENS,
    req: Request,
  ) {
    const s = EXPORT_SCREENS[screen];
    const needed: Permission[] = [...(s.pii ? (['export.pii'] as const) : []), ...(s.needs ? [s.needs] : [])];
    if (hasOn(p, brand, needed)) return;
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'authz.denied',
      outcome: 'denied',
      panel: brand === 'all' ? null : brand,
      targetType: 'screen',
      targetId: screen,
      metadata: { missing: needed.filter((x) => !hasOn(p, brand, [x])), brand, what: 'download' },
    });
    throw new ForbiddenException(
      s.pii && !hasOn(p, brand, ['export.pii'])
        ? 'This download holds personal data and needs the "export with personal data" permission'
        : 'Not permitted',
    );
  }

  private send(res: Response, format: keyof typeof CONTENT_TYPE, name: string, body: Buffer) {
    res.setHeader('content-type', CONTENT_TYPE[format]);
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('cache-control', 'no-store');
    res.setHeader('x-content-type-options', 'nosniff');
    res.send(body);
  }

  @RequirePermissions('export.read')
  @BrandScoped({ allowAll: true })
  @Post('export/table')
  @HttpCode(200)
  async table(
    @Body(new ZodPipe(TableExportRequest)) body: z.infer<typeof TableExportRequest>,
    @CurrentPrincipal() p: Principal,
    @CurrentBrand() brand: BrandSelection,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.check(p, brand, body.screen, req);
    const dataMode = this.mode(brand);
    const generatedAt = new Date().toISOString();
    const file = await writeTable(
      {
        title: body.title,
        subtitle: body.subtitle,
        brand,
        dataMode,
        generatedAt,
        columns: body.columns,
        rows: body.rows,
      },
      body.format,
    );
    await this.audit.record({
      ...AuditService.fromRequest(req),
      panel: brand === 'all' ? null : brand,
      action: 'screen.exported',
      targetType: 'screen',
      targetId: body.screen,
      metadata: {
        format: body.format,
        rows: body.rows.length,
        columns: body.columns.map((c) => c.key),
        scope: body.subtitle ?? null,
        brand,
        dataMode,
        pii: EXPORT_SCREENS[body.screen].pii,
      },
    });
    this.send(res, body.format, fileName(body.screen, brand, dataMode, generatedAt, body.format), file);
  }

  @RequirePermissions('export.read')
  @BrandScoped({ allowAll: true })
  @Post('export/document')
  @HttpCode(200)
  async document(
    @Body(new ZodPipe(DocumentExportRequest)) body: DocumentExportRequest,
    @CurrentPrincipal() p: Principal,
    @CurrentBrand() brand: BrandSelection,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    await this.check(p, brand, body.screen, req);
    const dataMode = this.mode(brand);
    const generatedAt = new Date().toISOString();
    const d = {
      title: body.title,
      subtitle: body.subtitle,
      brand,
      dataMode,
      generatedAt,
      blocks: body.blocks,
    };
    const file = body.format === 'pdf' ? await documentToPdf(d) : await documentToDocx(d);
    await this.audit.record({
      ...AuditService.fromRequest(req),
      panel: brand === 'all' ? null : brand,
      action: 'screen.exported',
      targetType: 'screen',
      targetId: body.screen,
      metadata: { format: body.format, blocks: body.blocks.length, title: body.title, brand, dataMode },
    });
    this.send(res, body.format, fileName(body.title, brand, dataMode, generatedAt, body.format), file);
  }

  /** Reads an uploaded spreadsheet or Word file and returns its rows or blocks for a preview. Writes nothing. */
  @BrandScoped({ allowAll: true })
  @Post('parse')
  @HttpCode(200)
  async parse(@Body(new ZodPipe(FileParseRequest)) body: FileParseRequest) {
    const file = Buffer.from(body.data, 'base64');
    if (!file.length) throw new BadRequestException('The file is empty');
    try {
      if (body.kind === 'table') return await parseTable(body.name, file);
      if (!/\.docx$/i.test(body.name))
        throw new FileProblem(
          'Upload a Word (.docx) file. Old .doc files: open in Word and "Save as" .docx.',
        );
      return await parseDocx(file);
    } catch (e) {
      if (e instanceof FileProblem) throw new BadRequestException(e.message);
      throw e;
    }
  }
}
