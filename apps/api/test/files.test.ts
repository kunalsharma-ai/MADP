import JSZip from 'jszip';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

/** Console downloads and upload parsing: permissions, DEMO labels, audit, and nothing written by a parse. */
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
let db: pg.Client;
const table = (screen: string, format = 'csv') => ({
  screen,
  format,
  title: 'Ticket desk',
  subtitle: 'Status: open',
  columns: [
    { key: 'no', label: 'Ticket' },
    { key: 'email', label: 'E-mail' },
  ],
  rows: [{ no: 'demo-T1', email: 'demo-a@example.invalid' }],
});
const binary = (res: request.Response, cb: (e: Error | null, b: Buffer) => void) => {
  const chunks: Buffer[] = [];
  res.on('data', (c: Buffer) => chunks.push(c));
  res.on('end', () => cb(null, Buffer.concat(chunks)));
};

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '20' });
  token = (await t.adminToken('super_admin')).token;
  db = new pg.Client({ connectionString: t.dbUrl });
  await db.connect();
});
afterAll(async () => {
  await db?.end();
  await t?.stop();
});

describe('console downloads', () => {
  it('writes CSV with the data mode on every row and audits the download (no values in the audit)', async () => {
    const r = await request(t.server)
      .post('/api/v1/files/export/table')
      .set('authorization', `Bearer ${token}`)
      .set('x-madp-brand', 'mfr')
      .send(table('tickets'))
      .expect(200);
    expect(r.headers['content-disposition']).toMatch(/madp-tickets-mfr-DEMO-\d{4}-\d{2}-\d{2}\.csv/);
    expect(r.text).toContain('demo,demo-T1');
    const a = await db.query(
      `select metadata from audit_event where action = 'screen.exported' order by id desc limit 1`,
    );
    expect(a.rows[0].metadata).toMatchObject({
      format: 'csv',
      rows: 1,
      columns: ['no', 'email'],
      dataMode: 'demo',
      brand: 'mfr',
      pii: true,
    });
    expect(JSON.stringify(a.rows[0].metadata)).not.toContain('example.invalid');
  });

  it('writes Excel, PDF and Word', async () => {
    for (const [f, magic] of [
      ['xlsx', 'PK'],
      ['docx', 'PK'],
      ['pdf', '%PDF'],
    ] as const) {
      const r = await request(t.server)
        .post('/api/v1/files/export/table')
        .set('authorization', `Bearer ${token}`)
        .set('x-madp-brand', 'all')
        .send(table('tickets', f))
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect((r.body as Buffer).subarray(0, magic.length).toString()).toBe(magic);
    }
  });

  it('refuses personal-data screens without export.pii, audits the refusal, and allows screens without personal data', async () => {
    const analyst = (await t.adminToken('analyst', 'analyst-files@example.invalid')).token;
    const r = await request(t.server)
      .post('/api/v1/files/export/table')
      .set('authorization', `Bearer ${analyst}`)
      .set('x-madp-brand', 'all')
      .send(table('panellists'))
      .expect(403);
    expect(r.body.message).toMatch(/personal data/);
    const a = await db.query(
      `select metadata from audit_event where action = 'authz.denied' and target_id = 'panellists' order by id desc limit 1`,
    );
    expect(a.rows[0].metadata.missing).toContain('export.pii');
    await request(t.server)
      .post('/api/v1/files/export/table')
      .set('authorization', `Bearer ${analyst}`)
      .set('x-madp-brand', 'all')
      .send(table('geo'))
      .expect(200);
    const support = (await t.adminToken('support_agent', 'support-files@example.invalid')).token;
    await request(t.server)
      .post('/api/v1/files/export/table')
      .set('authorization', `Bearer ${support}`)
      .set('x-madp-brand', 'all')
      .send(table('geo'))
      .expect(403);
  });

  it('refuses unknown screens and oversized requests', async () => {
    await request(t.server)
      .post('/api/v1/files/export/table')
      .set('authorization', `Bearer ${token}`)
      .send({ ...table('tickets'), screen: 'nope' })
      .expect(400);
    await request(t.server)
      .post('/api/v1/files/export/table')
      .set('authorization', `Bearer ${token}`)
      .send({ ...table('tickets'), rows: Array.from({ length: 10_001 }, () => ({ no: 'x' })) })
      .expect(400);
  });

  it('downloads a page as Word and reads it back into the same blocks, writing nothing', async () => {
    const blocks = [{ h2: 'Who we are' }, 'DEMO text.', { ul: ['One', 'Two'] }];
    const before = (await db.query(`select count(*)::int n from audit_event`)).rows[0].n as number;
    const w = await request(t.server)
      .post('/api/v1/files/export/document')
      .set('authorization', `Bearer ${token}`)
      .set('x-madp-brand', 'mho')
      .send({ screen: 'content_page', format: 'docx', title: 'About us', blocks })
      .buffer(true)
      .parse(binary)
      .expect(200);
    expect((await JSZip.loadAsync(w.body as Buffer)).file('word/document.xml')).toBeTruthy();
    const p = await request(t.server)
      .post('/api/v1/files/parse')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'about.docx', kind: 'document', data: (w.body as Buffer).toString('base64') })
      .expect(200);
    expect(p.body).toMatchObject({ kind: 'document', title: 'About us', blocks });
    // the download is audited, the parse is not a write
    expect((await db.query(`select count(*)::int n from audit_event`)).rows[0].n).toBe(before + 1);
    await request(t.server)
      .post('/api/v1/files/parse')
      .set('authorization', `Bearer ${token}`)
      .send({ name: 'x.pdf', kind: 'document', data: 'aGVsbG8=' })
      .expect(400);
    await request(t.server)
      .post('/api/v1/files/parse')
      .send({ name: 'x.csv', kind: 'table', data: 'aGVsbG8=' })
      .expect(401);
  });

  it('reports download as PDF and Word too', async () => {
    for (const f of ['pdf', 'docx']) {
      const r = await request(t.server)
        .get(`/api/v1/reports/audience_by_category/export?format=${f}`)
        .set('authorization', `Bearer ${token}`)
        .buffer(true)
        .parse(binary)
        .expect(200);
      expect(r.headers['content-disposition']).toContain(`.${f}`);
    }
  });
});
