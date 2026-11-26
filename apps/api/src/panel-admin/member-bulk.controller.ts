import { BadRequestException, Body, Controller, ForbiddenException, HttpCode, Post, Req, Res } from '@nestjs/common';
import {
  MemberBulkAction,
  MemberExport,
  MemberSearch,
  type BrandSelection,
  type MemberBulkResult,
  type PanelCode,
  type ReportResult,
} from '@madp/contracts';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import type { Request, Response } from 'express';
import { BrandScoped, CurrentBrand, CurrentPrincipal, RequirePermissions } from '../auth/decorators.js';
import type { Principal } from '../auth/auth.types.js';
import { hasOn } from '../auth/access.js';
import { ZodPipe } from '../common/zod.pipe.js';
import { AuditService } from '../audit/audit.service.js';
import { toCsv, toXlsx } from '../reports/export-writer.js';
import { PanelAdminService } from './panel-admin.service.js';
import { MemberTagStore } from './member-tags.js';
import { LIST_FIELDS } from './members.controller.js';

type Row = Record<string, unknown> & { id: string; segment?: string };
const MAX_EXPORT = 2000;

/**
 * Bulk actions on ticked Members rows (add or remove a tag, change segment) and export of the list to CSV or Excel,
 * for the brand picked in the switcher. Each needs a reason, which goes to the audit log. Teens are skipped without
 * teen.read. Exports carry masked values only, never the member page's full name or address.
 */
@Controller('member-bulk')
@BrandScoped()
export class MemberBulkController {
  constructor(
    private readonly panel: PanelAdminService,
    private readonly audit: AuditService,
    private readonly tags: MemberTagStore,
  ) {}

  private async listRow(p: Principal, brand: PanelCode, id: string): Promise<Row | null> {
    try {
      const m = await this.panel.call<Record<string, unknown>>(brand, p.id, 'GET', R.member(id));
      return Object.fromEntries(LIST_FIELDS.filter((k) => k in m).map((k) => [k, m[k]])) as Row;
    } catch {
      return null;
    }
  }

  @RequirePermissions('members.edit')
  @Post()
  @HttpCode(200)
  async run(
    @Body(new ZodPipe(MemberBulkAction)) body: MemberBulkAction,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
  ): Promise<MemberBulkResult> {
    const brand = b as PanelCode;
    if (body.action === 'segment' && !hasOn(p, brand, ['segments.manage']))
      throw new ForbiddenException('Changing segments needs the segments.manage permission');
    const teens = hasOn(p, brand, ['teen.read']);
    const ids = [...new Set(body.ids)];
    const skipped: MemberBulkResult['skipped'] = [];
    let done = 0;
    // One member at a time: the panel checks each segment change, and a failure never stops the rest.
    for (const id of ids) {
      const m = await this.listRow(p, brand, id);
      if (!m) {
        skipped.push({ id, why: 'Not found on this brand' });
        continue;
      }
      if (m.segment === 'teen' && !teens) {
        skipped.push({ id, why: 'Teen record: needs teen access' });
        continue;
      }
      try {
        if (body.action === 'segment') {
          const r = await this.panel.call<{ before: Record<string, unknown>; after: Record<string, unknown> }>(
            brand, p.id, 'POST', R.memberSegment(id), undefined, { category: body.category, reason: body.reason },
          );
          await this.audit.record({
            ...AuditService.fromRequest(req),
            action: 'members.segment.change',
            panel: brand,
            targetType: 'member',
            targetId: id,
            before: r.before,
            after: r.after,
            reason: body.reason,
            metadata: { bulk: true },
          });
        } else {
          const have = (await this.tags.forMembers(brand, [id])).get(id) ?? [];
          const next = body.action === 'tag_add' ? [...have, body.tag] : have.filter((t) => t !== body.tag);
          if (next.length > 10) throw new Error('Already has 10 tags');
          await this.tags.set(brand, id, next, p.id);
        }
        done++;
      } catch (e) {
        skipped.push({ id, why: (e as Error).message.slice(0, 120) });
      }
    }
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.bulk',
      panel: brand,
      targetType: 'member',
      reason: body.reason,
      metadata: {
        action: body.action,
        ...(body.action === 'segment' ? { category: body.category } : { tag: body.tag }),
        asked: ids.length,
        done,
        skipped: skipped.length,
      },
    });
    return { done, skipped };
  }

  @RequirePermissions('members.read', 'export.read')
  @Post('export')
  @HttpCode(200)
  async export(
    @Body(new ZodPipe(MemberExport)) body: MemberExport,
    @CurrentBrand() b: BrandSelection,
    @CurrentPrincipal() p: Principal,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const brand = b as PanelCode;
    const teens = hasOn(p, brand, ['teen.read']);
    let rows: Row[] = [];
    let truncated = false;
    if (body.ids) {
      rows = (await Promise.all([...new Set(body.ids)].map((id) => this.listRow(p, brand, id)))).filter((r): r is Row => !!r);
    } else {
      const parsed = MemberSearch.safeParse({ ...(body.filters ?? {}), page: 1 });
      if (!parsed.success) throw new BadRequestException('These filters cannot be exported');
      const { tag, ...q } = parsed.data;
      if (tag) {
        const { ids } = await this.tags.page(brand, tag, 1, MAX_EXPORT);
        rows = (await Promise.all(ids.map((id) => this.listRow(p, brand, id)))).filter((r): r is Row => !!r);
      } else {
        const sort = q.sort === 'age' ? { sort: 'born', dir: q.dir === 'asc' ? 'desc' : 'asc' } : {};
        for (let page = 1; rows.length < MAX_EXPORT; page++) {
          const d = await this.panel.call<{ items: Row[]; total: number; pageSize: number }>(brand, p.id, 'GET', R.members, {
            ...q,
            ...sort,
            page,
            ...(teens ? {} : { noTeens: 1 }),
          });
          rows.push(...d.items);
          if (d.items.length < d.pageSize || page * d.pageSize >= d.total) break;
        }
        truncated = rows.length >= MAX_EXPORT;
        rows = rows.slice(0, MAX_EXPORT);
      }
    }
    if (!teens) rows = rows.filter((r) => r.segment !== 'teen');
    const tagsOf = await this.tags.forMembers(brand, rows.map((r) => r.id));
    const mode = this.tags.mode();
    const report: ReportResult = {
      key: 'members' as ReportResult['key'],
      title: `Members of ${brand.toUpperCase()}`,
      dataMode: mode,
      generatedAt: new Date().toISOString(),
      period: null,
      columns: [
        { key: 'memberId', label: 'Member ID', type: 'text' },
        { key: 'name', label: 'Name (short)', type: 'text' },
        { key: 'email', label: 'E-mail (masked)', type: 'text' },
        { key: 'phone', label: 'Phone (masked)', type: 'text' },
        { key: 'category', label: 'Segment', type: 'text' },
        { key: 'country', label: 'Country', type: 'text' },
        { key: 'gender', label: 'Gender', type: 'text' },
        { key: 'age', label: 'Age', type: 'number' },
        { key: 'birthYear', label: 'Born', type: 'number' },
        { key: 'qualityScore', label: 'Quality', type: 'number' },
        { key: 'status', label: 'Status', type: 'text' },
        { key: 'marketing', label: 'Marketing e-mails', type: 'text' },
        { key: 'signedUpAt', label: 'Signed up', type: 'text' },
        { key: 'lastActivityAt', label: 'Last activity', type: 'text' },
        { key: 'tags', label: 'Tags', type: 'text' },
      ] as ReportResult['columns'],
      rows: rows.map((r) => {
        const mk = r.marketingOptIn as { granted?: boolean; asked?: boolean } | undefined;
        const v = (k: string) => (r[k] === undefined || r[k] === null ? null : (r[k] as string | number));
        return {
          memberId: v('memberId') ?? r.id,
          name: v('name'),
          email: v('email'),
          phone: v('phone'),
          category: v('category'),
          country: typeof r.country === 'string' ? r.country.toUpperCase() : null,
          gender: v('gender'),
          age: v('age'),
          birthYear: v('birthYear'),
          qualityScore: v('qualityScore'),
          status: v('status'),
          marketing: !mk?.asked ? 'Not asked' : mk.granted ? 'Opted in' : 'No',
          signedUpAt: typeof r.signedUpAt === 'string' ? r.signedUpAt.slice(0, 10) : null,
          lastActivityAt: typeof r.lastActivityAt === 'string' ? r.lastActivityAt.slice(0, 10) : null,
          tags: (tagsOf.get(r.id) ?? []).join(', ') || null,
        };
      }),
      notes: [
        'E-mail and phone are masked. Full values are never exported from this screen.',
        ...(truncated ? [`Only the first ${MAX_EXPORT} members are in this file. Narrow the filters for the rest.`] : []),
        ...(!teens ? ['Teens are left out: your role has no teen access on this brand.'] : []),
      ],
    };
    await this.audit.record({
      ...AuditService.fromRequest(req),
      action: 'members.export',
      panel: brand,
      targetType: 'member',
      reason: body.reason,
      metadata: {
        format: body.format,
        rows: report.rows.length,
        selected: body.ids ? body.ids.length : null,
        filters: body.filters ? Object.keys(body.filters) : [],
        truncated,
        dataMode: mode,
      },
    });
    const name = `madp-members-${brand}${mode === 'demo' ? '-DEMO' : ''}-${report.generatedAt.slice(0, 10)}.${body.format}`;
    res.setHeader('content-disposition', `attachment; filename="${name}"`);
    res.setHeader('cache-control', 'no-store');
    if (body.format === 'csv') {
      res.setHeader('content-type', 'text/csv; charset=utf-8');
      res.send(toCsv(report));
    } else {
      res.setHeader('content-type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
      res.send(await toXlsx(report, brand));
    }
  }
}
