import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import ExcelJS from 'exceljs';
import { REPORT_KEYS } from '@madp/contracts';
import { Database } from '../src/db/database.js';
import { startTestApp } from './helpers.js';

/**
 * Reports and exports (screens 23 and 29) on DEMO data for all three panels: the catalogue follows permissions and
 * the selected brand, rows are per panel and never added across panels, small cells are suppressed, loyalty
 * liability uses each brand's points rate, and CSV/XLSX downloads are labelled DEMO, safe from formula injection
 * and audited.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string, brand?: string) => ({
  authorization: `Bearer ${tok[who]}`,
  ...(brand ? { 'x-madp-brand': brand } : {}),
});
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;
const get = (who: string, path: string, brand?: string) => request(t.server).get(`/api/v1/reports${path}`).set(as(who, brand));
const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '60', MIN_CELL_SIZE: '3' });
  for (const role of ['super_admin', 'analyst', 'read_only_analyst', 'panel_manager'] as const) tok[role] = (await t.adminToken(role)).token;
  tok.mfrFinance = (await t.adminToken('rewards_finance', 'mfr.finance@example.invalid', ['mfr'])).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

describe('reports and exports', () => {
  it('lists every report with what this admin may view and download', async () => {
    const all = await get('super_admin', '').expect(200);
    expect(all.body.reports.map((r: { key: string }) => r.key)).toEqual([...REPORT_KEYS]);
    expect(all.body.reports.every((r: { canView: boolean; canExport: boolean }) => r.canView && r.canExport)).toBe(true);
    const analyst = await get('analyst', '').expect(200);
    const by = (k: string) => analyst.body.reports.find((r: { key: string }) => r.key === k);
    expect(by('audience_by_country')).toMatchObject({ canView: true, canExport: true });
    expect(by('loyalty_liability')).toMatchObject({ canView: false, canExport: false });
    // Panel managers may read reports but not download them.
    const pm = await get('panel_manager', '').expect(200);
    expect(pm.body.reports.find((r: { key: string }) => r.key === 'audience_by_category')).toMatchObject({ canView: true, canExport: false });
  });

  it('gives rows per panel for all three panels, never a total across panels', async () => {
    for (const key of ['audience_by_category', 'audience_by_country', 'consent_funnel', 'data_quality', 'profile_freshness', 'loyalty_liability']) {
      const r = await get('super_admin', `/${key}`).expect(200);
      expect(r.body).toMatchObject({ key, dataMode: 'demo' });
      const panels = new Set(r.body.rows.map((x: { panel: string }) => x.panel));
      expect([...panels].sort(), key).toEqual(['mfr', 'mho', 't2o']);
      for (const c of r.body.columns) expect(Object.keys(r.body.rows[0])).toContain(c.key);
    }
    const one = await get('super_admin', '/consent_funnel?panel=mho').expect(200);
    expect(one.body.rows.map((x: { panel: string }) => x.panel)).toEqual(['mho']);
  });

  it('suppresses small cells in the country breakdown', async () => {
    const r = await get('super_admin', '/audience_by_country').expect(200);
    const rows = r.body.rows as { members: number | null }[];
    expect(rows.every((x) => x.members === null || x.members >= 3)).toBe(true);
    if (rows.some((x) => x.members === null)) expect(r.body.notes.join(' ')).toMatch(/fewer than 3/);
  });

  it('values loyalty liability at each brand’s points rate', async () => {
    await q(sql`update brand_setting set points_per_currency_unit = 500 where panel = 'mho'`);
    const r = await get('super_admin', '/loyalty_liability').expect(200);
    for (const row of r.body.rows as { panel: string; approved: number; pointsPerUnit: number; outstandingValue: number }[]) {
      expect(row.pointsPerUnit).toBe(row.panel === 'mho' ? 500 : 1000);
      expect(row.outstandingValue).toBeCloseTo(row.approved / row.pointsPerUnit, 2);
    }
  });

  it('reports over a period, and checks the period', async () => {
    const r = await get('super_admin', '/sync_health').expect(200);
    expect(r.body.period).toMatchObject({ from: expect.any(String), to: expect.any(String) });
    expect(r.body.rows.filter((x: { kind: string }) => x.kind).map((x: { panel: string }) => x.panel).sort()).toEqual(
      expect.arrayContaining(['mfr', 'mho', 't2o']),
    );
    await get('super_admin', '/sync_health?from=2026-02-01&to=2026-01-01').expect(400);
    const old = await get('super_admin', '/sync_health?from=2020-01-01&to=2020-01-31').expect(200);
    expect(old.body.rows).toEqual([]);
    await get('super_admin', '/communication_delivery').expect(200);
    await get('super_admin', '/privacy_sla').expect(200);
  });

  it('checks each report’s own permission and the selected brand', async () => {
    await get('read_only_analyst', '/consent_funnel').expect(403);
    await get('analyst', '/loyalty_liability').expect(403);
    await get('super_admin', '/nope').expect(404);
    const mfr = await get('mfrFinance', '/loyalty_liability', 'mfr').expect(200);
    expect(mfr.body.rows.map((x: { panel: string }) => x.panel)).toEqual(['mfr']);
    await get('mfrFinance', '/loyalty_liability', 'all').expect(403);
    await get('mfrFinance', '/loyalty_liability?panel=t2o', 'mfr').expect(403);
    await get('mfrFinance', '/loyalty_liability/export', 'mfr').expect(403); // no export.read
    await get('panel_manager', '/audience_by_category/export').expect(403);
  });

  it('downloads CSV labelled DEMO, safe from formula injection, and audited', async () => {
    const [m] = await q<{ id: string }>(sql`select si.id from source_identity si join panel_membership pm on pm.source_identity_id = si.id
      where pm.panel = 't2o' and pm.status = 'active' limit 1`);
    await q(sql`update source_identity set state = '=HYPERLINK("http://x")' where id = ${m!.id}`);
    await t.app.get(Database).db.execute(sql`select 1`);
    const r = await get('analyst', '/audience_by_country/export?format=csv').expect(200);
    expect(r.headers['content-type']).toMatch(/text\/csv/);
    expect(r.headers['content-disposition']).toMatch(/madp-audience_by_country-all-DEMO-\d{4}-\d{2}-\d{2}\.csv/);
    const lines = r.text.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('data_mode,Panel,Country,State or province,Active members');
    expect(lines.slice(1).every((l) => l.startsWith('demo,'))).toBe(true);
    expect(r.text).toContain(`"'=HYPERLINK(""http://x"")"`);
    expect(r.text).not.toMatch(/,=HYPERLINK/);
    const audit = await q<{ metadata: { format: string; rows: number } }>(
      sql`select metadata from audit_event where action = 'report.exported' and target_id = 'audience_by_country'`,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]!.metadata).toMatchObject({ format: 'csv', rows: lines.length - 1 });
  });

  it('downloads XLSX with a DEMO sheet and an About sheet', async () => {
    const r = await get('super_admin', '/loyalty_liability/export?format=xlsx').buffer(true).parse(binary).expect(200);
    expect(r.headers['content-type']).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.body as never); // exceljs types Buffer more narrowly than Node 22 does
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Report (DEMO)', 'About']);
    const sheet = wb.getWorksheet('Report (DEMO)')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Data mode');
    expect(sheet.rowCount).toBe(4); // header + one row per panel
    const about = wb.getWorksheet('About')!;
    expect(String(about.getRow(2).getCell(2).value)).toMatch(/DEMO/);
  });
});
