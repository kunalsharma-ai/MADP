import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import ExcelJS from 'exceljs';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Bulk actions and export on the Members table for T2O, MFR and MHO. A stand-in for the panel's admin API answers
 * the list (paged), the member page and the segment change.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
const ids = Array.from({ length: 60 }, (_, i) => i.toString(16).padStart(24, '0'));
const TEEN = 'f'.repeat(24);

function fakePanel() {
  const segmentCalls: string[] = [];
  const read = (req: IncomingMessage) =>
    new Promise<string>((r) => {
      let s = '';
      req.on('data', (c) => (s += c));
      req.on('end', () => r(s));
    });
  const row = (id: string) => ({
    id,
    memberId: `M-${id.slice(-3)}`,
    name: id === ids[1] ? '=HYPERLINK("x")' : `Demo ${id.slice(-2)}`,
    email: 'd***@example.invalid',
    phone: '+91***00',
    category: id === TEEN ? 'b2c minor' : 'b2c',
    segment: id === TEEN ? 'teen' : 'consumer',
    status: 'active',
    country: 'in',
    gender: 'Female',
    age: 30,
    birthYear: 1996,
    qualityScore: 100,
    signedUpAt: '2026-11-01T00:00:00.000Z',
    lastActivityAt: null,
  });
  const server: Server = createServer(async (req, res) => {
    const raw = await read(req);
    const h = (k: string) => String(req.headers[k] ?? '');
    const want = await signPanelAdmin(SECRET, { timestamp: h('x-madp-timestamp'), nonce: h('x-madp-nonce'), method: req.method!, path: req.url!, origin: h('x-madp-origin'), actor: h('x-madp-actor'), body: raw });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (h('x-madp-signature') !== want) return send(401, { status: 'error', code: 'admin_auth', message: 'Bad signature' });
    const u = new URL(req.url!, 'http://x');
    if (u.pathname === '/api/v1/admin/members') {
      const page = Number(u.searchParams.get('page') ?? 1);
      const all = u.searchParams.get('noTeens') ? ids : [...ids, TEEN];
      return send(200, { status: 'success', data: { items: all.slice((page - 1) * 50, page * 50).map(row), total: all.length, page, pageSize: 50, sort: null } });
    }
    const m = /^\/api\/v1\/admin\/members\/([a-f0-9]{24})(\/segment)?$/.exec(u.pathname);
    if (m && (ids.includes(m[1]!) || m[1] === TEEN)) {
      if (!m[2]) return send(200, { status: 'success', data: { ...row(m[1]!), fullName: 'Full Secret Name' } });
      const body = JSON.parse(raw);
      if (body.category === 'nope') return send(422, { status: 'error', code: 'unknown_segment', message: 'Unknown segment' });
      segmentCalls.push(m[1]!);
      return send(200, { status: 'success', data: { before: { category: 'b2c' }, after: { category: body.category } } });
    }
    send(404, { status: 'error', code: 'not_found', message: 'Member not found' });
  });
  return { server, segmentCalls };
}

describe('Members bulk actions and export', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let panel: ReturnType<typeof fakePanel>;
  let sql: pg.Client;
  const tok: Record<string, string> = {};

  beforeAll(async () => {
    panel = fakePanel();
    await new Promise<void>((r) => panel.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(panel.server.address() as AddressInfo).port}`;
    t = await startTestApp({ PANEL_ADMIN_API_SECRET: SECRET, T2O_ADMIN_API_BASE_URL: base, MFR_ADMIN_API_BASE_URL: base, MHO_ADMIN_API_BASE_URL: base });
    sql = new pg.Client({ connectionString: t.dbUrl });
    await sql.connect();
    tok.super = (await t.adminToken('super_admin', 'bk.super@example.invalid')).token;
    tok.manager = (await t.adminToken('panel_manager', 'bk.manager@example.invalid')).token;
    tok.support = (await t.adminToken('support_agent', 'bk.support@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string, brand: string) =>
    (await sql.query('select reason, metadata from audit_event where action = $1 and panel = $2 order by id desc limit 1', [action, brand])).rows[0];
  const reason = 'Follow-up list for the payout check';

  it('adds and removes a tag on many members, skipping teens and unknown ids, with one audit entry', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'] as const) {
      const r = await request(t.server).post('/api/v1/member-bulk').set(bearer(tok.manager!, brand))
        .send({ action: 'tag_add', ids: [ids[0], ids[2], TEEN, 'e'.repeat(24)], tag: 'payout', reason }).expect(200);
      expect(r.body.done).toBe(2);
      expect(r.body.skipped.map((s: { why: string }) => s.why)).toEqual(['Teen record: needs teen access', 'Not found on this brand']);
      expect(await audit('members.bulk', brand)).toMatchObject({ reason, metadata: { action: 'tag_add', tag: 'payout', asked: 4, done: 2, skipped: 2 } });
      const list = await request(t.server).get('/api/v1/panel/members?tag=payout').set(bearer(tok.manager!, brand)).expect(200);
      expect(list.body.total).toBe(2);
      await request(t.server).post('/api/v1/member-bulk').set(bearer(tok.manager!, brand)).send({ action: 'tag_remove', ids: [ids[0]], tag: 'payout', reason }).expect(200);
      expect((await request(t.server).get('/api/v1/panel/members?tag=payout').set(bearer(tok.manager!, brand))).body.total).toBe(1);
    }
  });

  it('changes segment member by member, keeps going after a refusal, audits each change', async () => {
    const r = await request(t.server).post('/api/v1/member-bulk').set(bearer(tok.manager!, 'mfr'))
      .send({ action: 'segment', ids: [ids[3], ids[4]], category: 'b2b', reason }).expect(200);
    expect(r.body).toEqual({ done: 2, skipped: [] });
    expect(panel.segmentCalls.slice(-2)).toEqual([ids[3], ids[4]]);
    expect(await audit('members.segment.change', 'mfr')).toMatchObject({ reason, metadata: { bulk: true } });
    const bad = await request(t.server).post('/api/v1/member-bulk').set(bearer(tok.manager!, 'mfr'))
      .send({ action: 'segment', ids: [ids[5]], category: 'nope', reason }).expect(200);
    expect(bad.body.done).toBe(0);
    // Support agents may edit members but not change segments.
    await request(t.server).post('/api/v1/member-bulk').set(bearer(tok.support!, 'mfr')).send({ action: 'segment', ids: [ids[3]], category: 'b2b', reason }).expect(403);
    await request(t.server).post('/api/v1/member-bulk').set(bearer(tok.manager!, 'mfr')).send({ action: 'segment', ids: [ids[3]], category: 'b2b', reason: 'x' }).expect(400);
    await request(t.server).post('/api/v1/member-bulk').set(bearer(tok.manager!, 'mfr')).send({ action: 'segment', ids: Array(101).fill(ids[3]), category: 'b2b', reason }).expect(400);
  });

  it('exports ticked members or the whole filtered list as CSV or Excel, masked, with a reason in the audit', async () => {
    await request(t.server).post('/api/v1/member-bulk/export').set(bearer(tok.manager!, 't2o')).send({ format: 'csv', reason, ids: [ids[0]] }).expect(403);
    await request(t.server).post('/api/v1/member-bulk/export').set(bearer(tok.super!, 't2o')).send({ format: 'csv', ids: [ids[0]] }).expect(400);
    const csv = await request(t.server).post('/api/v1/member-bulk/export').set(bearer(tok.super!, 't2o')).send({ format: 'csv', reason, ids: [ids[1], ids[2]] }).expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/madp-members-t2o.*\.csv/);
    const lines = csv.text.trim().split('\r\n');
    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('E-mail (masked)');
    expect(lines[0]).toContain('Health score');
    expect(csv.text).toContain("'=HYPERLINK"); // formula injection is neutralised
    expect(csv.text).toContain('payout');
    expect(csv.text).not.toContain('Full Secret Name');
    expect(await audit('members.export', 't2o')).toMatchObject({ reason, metadata: { format: 'csv', rows: 2, selected: 2 } });

    const x = await request(t.server).post('/api/v1/member-bulk/export').set(bearer(tok.super!, 'mho'))
      .send({ format: 'xlsx', reason, filters: { country: 'in', sort: 'age', dir: 'asc' } })
      .buffer(true).parse((res, cb) => { const c: Buffer[] = []; res.on('data', (d: Buffer) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); })
      .expect(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.body as never);
    expect(wb.worksheets[0]!.rowCount).toBe(1 + 61); // header + every page, teen included for super admin
    expect(await audit('members.export', 'mho')).toMatchObject({ metadata: { format: 'xlsx', rows: 61, filters: ['country', 'sort', 'dir'] } });
    await request(t.server).post('/api/v1/member-bulk/export').set(bearer(tok.super!, 'mho')).send({ format: 'csv', reason, filters: { gender: 'Nope' } }).expect(400);
  });
});
