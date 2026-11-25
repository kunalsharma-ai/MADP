import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Question bank Excel export and import, for T2O, MFR and MHO (one panel backend serves all three). The workbook is
 * read in MADP and reaches the panel's import as the same JSON as a .json upload, so the dry run, the panel's teen
 * guardrails and the qb.publish rule apply unchanged. A stand-in panel checks MADP's signature like the real one.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};
const BANK = {
  exportedAt: '2026-11-24T00:00:00.000Z',
  counts: { questions: 2 },
  Profile: [{ slug: 'demo-household', category: 'b2c', name: 'household', pages: [['Household', 'demo-size', 'demo-kids']] }],
  Question: [
    { name: 'demo-size', label: 'How many people live in your household?', type: 'radio', category: ['b2c'] },
    { name: 'demo-kids', label: 'How many children?', type: 'number', parent: 'demo-size', category: ['b2c'] },
  ],
  Option: [
    { question: 'demo-size', value: '1', label: '1', parentValue: [], sortOrder: 1 },
    { question: 'demo-size', value: '2', label: '2', parentValue: [], sortOrder: 2 },
  ],
};

function fakePanel() {
  const imports: { origin: string; dryRun: string | null; body: Record<string, unknown> }[] = [];
  const read = (req: IncomingMessage) =>
    new Promise<string>((r) => {
      let s = '';
      req.on('data', (c) => (s += c));
      req.on('end', () => r(s));
    });
  const server: Server = createServer(async (req, res) => {
    const raw = await read(req);
    const h = (k: string) => String(req.headers[k] ?? '');
    const want = await signPanelAdmin(SECRET, {
      timestamp: h('x-madp-timestamp'),
      nonce: h('x-madp-nonce'),
      method: req.method!,
      path: req.url!,
      origin: h('x-madp-origin'),
      actor: h('x-madp-actor'),
      body: raw,
    });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (h('x-madp-signature') !== want) return send(401, { status: 'error', code: 'admin_auth', message: 'Bad signature' });
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/v1/admin/qb/export') return send(200, { status: 'success', data: BANK });
    if (url.pathname === '/api/v1/admin/qb/import') {
      imports.push({ origin: h('x-madp-origin'), dryRun: url.searchParams.get('dryRun'), body: JSON.parse(raw) });
      return send(200, { status: 'success', data: { dryRun: url.searchParams.get('dryRun') !== '0', ok: true, counts: { questions: 2 } } });
    }
    return send(404, { status: 'error', code: 'not_found', message: 'Not found' });
  });
  return { server, imports };
}

describe('question bank Excel export and import', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let panel: ReturnType<typeof fakePanel>;
  let sql: pg.Client;
  let editor: string;
  let manager: string;
  let reader: string;

  beforeAll(async () => {
    panel = fakePanel();
    await new Promise<void>((r) => panel.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(panel.server.address() as AddressInfo).port}`;
    t = await startTestApp({
      PANEL_ADMIN_API_SECRET: SECRET,
      T2O_ADMIN_API_BASE_URL: base,
      MFR_ADMIN_API_BASE_URL: base,
      MHO_ADMIN_API_BASE_URL: base,
    });
    sql = new pg.Client({ connectionString: t.dbUrl });
    await sql.connect();
    editor = (await t.adminToken('question_bank_editor', 'qb.xlsx@example.invalid')).token;
    manager = (await t.adminToken('panel_manager', 'pm.xlsx@example.invalid')).token;
    reader = (await t.adminToken('analyst')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  for (const brand of ['t2o', 'mfr', 'mho'] as const)
    it(`${brand}: exports a labelled workbook that imports back as the same bank`, async () => {
      const x = await request(t.server).get('/api/v1/panel/qb/export/xlsx').set(bearer(editor, brand)).buffer(true).parse(binary).expect(200);
      expect(x.headers['content-type']).toContain('spreadsheetml');
      expect(x.headers['content-disposition']).toMatch(new RegExp(`question-bank-${brand}-DEMO-\\d{4}-\\d{2}-\\d{2}\\.xlsx`));
      const wb = new ExcelJS.Workbook();
      await wb.xlsx.load(x.body as ArrayBuffer);
      expect(wb.worksheets.map((w) => w.name)).toEqual(['_columns', 'Profile', 'Question', 'Option', 'About']);

      const before = panel.imports.length;
      const d = await request(t.server)
        .post('/api/v1/panel/qb/import/xlsx')
        .set(bearer(editor, brand))
        .send({ file: (x.body as Buffer).toString('base64') })
        .expect(201);
      expect(d.body.dryRun).toBe(true);
      const sent = panel.imports[before]!;
      expect(sent.dryRun).toBe('1');
      expect(sent.body).toEqual({ Profile: BANK.Profile, Question: BANK.Question, Option: BANK.Option });
      const [audit] = (
        await sql.query("select metadata from audit_event where action = 'qb.import.dry_run' and panel = $1 order by id desc limit 1", [brand])
      ).rows;
      expect(audit.metadata.format).toBe('xlsx');
    });

  it('only bank editors import, writing is audited, and a workbook with problems never reaches the panel', async () => {
    const x = await request(t.server).get('/api/v1/panel/qb/export/xlsx').set(bearer(editor, 'mfr')).buffer(true).parse(binary).expect(200);
    const file = (x.body as Buffer).toString('base64');
    // A panel manager reads the bank but may not import it, not even as a dry run.
    await request(t.server).post('/api/v1/panel/qb/import/xlsx').set(bearer(manager, 'mfr')).send({ file }).expect(403);
    const w = await request(t.server).post('/api/v1/panel/qb/import/xlsx?dryRun=0').set(bearer(editor, 'mfr')).send({ file }).expect(201);
    expect(w.body.dryRun).toBe(false);
    expect(panel.imports.at(-1)!.dryRun).toBe('0');
    expect((await sql.query("select count(*)::int as n from audit_event where action = 'qb.import' and panel = 'mfr'")).rows[0].n).toBe(1);

    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as ArrayBuffer);
    wb.getWorksheet('Question')!.getRow(2).getCell(2).value = { formula: '1+1', result: 2 };
    const bad = Buffer.from(await wb.xlsx.writeBuffer()).toString('base64');
    const before = panel.imports.length;
    const r = await request(t.server).post('/api/v1/panel/qb/import/xlsx').set(bearer(editor, 'mfr')).send({ file: bad }).expect(400);
    expect(r.body.problems).toEqual(['Question row 2, label: formulas are not imported; type the value.']);
    await request(t.server).post('/api/v1/panel/qb/import/xlsx').set(bearer(editor, 'mfr')).send({ file: 'bm90IGEgemlw' }).expect(400);
    expect(panel.imports.length).toBe(before);
  });

  it('checks the permission and needs one brand', async () => {
    await request(t.server).get('/api/v1/panel/qb/export/xlsx').set(bearer(reader, 'mfr')).expect(403);
    await request(t.server).get('/api/v1/panel/qb/export/xlsx').set(bearer(editor, 'all')).expect(400);
  });
});
