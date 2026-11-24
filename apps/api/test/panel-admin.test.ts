import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Super admin step 2 (members, question bank, profiles) through MADP. A stand-in for the panel backend's
 * /api/admin/v1 checks MADP's signature the way the real one does (kunalsharma-ai/MFR#44) and answers with fixed
 * DEMO data, so these tests run without the panel.
 */
type T = Awaited<ReturnType<typeof startTestApp>>;
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand?: string) => ({
  authorization: `Bearer ${t}`,
  ...(brand ? { 'x-madp-brand': brand } : {}),
});
const ADULT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TEEN = 'bbbbbbbbbbbbbbbbbbbbbbbb';

interface Seen {
  method: string;
  path: string;
  origin: string;
  actor: string;
  body: unknown;
}

function fakePanel() {
  const seen: Seen[] = [];
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
    if (h('x-madp-signature') !== want)
      return send(401, { status: 'error', code: 'admin_auth', message: 'Bad signature' });
    const url = new URL(req.url!, 'http://x');
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({
      method: req.method!,
      path: req.url!,
      origin: h('x-madp-origin'),
      actor: h('x-madp-actor'),
      body,
    });
    const ok = (data: unknown) => send(200, { status: 'success', data });
    const p = url.pathname;
    if (p === '/api/admin/v1/members') {
      const items = [
        { id: ADULT, name: 'Demo A.', email: 'd***@example.invalid', segment: 'consumer', status: 'active' },
        { id: TEEN, name: 'Teen T.', email: 't***@example.invalid', segment: 'teen', status: 'active' },
      ].filter((m) => !(url.searchParams.get('noTeens') && m.segment === 'teen'));
      return ok({ items, total: items.length, page: 1, pageSize: 50 });
    }
    if (p === `/api/admin/v1/members/${ADULT}`) {
      if (req.method === 'PUT') return ok({ before: { 'name.first': 'Demo' }, after: body });
      return ok({ id: ADULT, segment: 'consumer', status: 'active', email: 'd***@example.invalid' });
    }
    if (p === `/api/admin/v1/members/${TEEN}`) return ok({ id: TEEN, segment: 'teen', status: 'active' });
    if (p === `/api/admin/v1/members/${ADULT}/status`)
      return ok({ before: { status: 'active' }, after: { status: 'suspended' } });
    if (p === `/api/admin/v1/members/${ADULT}/unmask`)
      return ok({ fields: body.fields, values: { email: 'demo@example.invalid' } });
    if (p === '/api/admin/v1/members/archive-run')
      return ok({ dryRun: body.dryRun, months: 6, checked: 10, archived: 2, activityUpdated: 4, sample: [] });
    if (p === '/api/admin/v1/questions' && req.method === 'POST') {
      if (String(body.label).includes('alcohol'))
        return send(422, {
          status: 'error',
          code: 'teen_guardrail',
          message: `${body.name} cannot be asked of teens`,
        });
      return ok({ before: null, after: body, id: 'cccccccccccccccccccccccc' });
    }
    if (p === '/api/admin/v1/qb/import')
      return ok({
        dryRun: url.searchParams.get('dryRun') !== '0',
        ok: true,
        counts: { questions: 1 },
        questions: { adds: 1 },
      });
    if (p === '/api/admin/v1/qb/export')
      return ok({ counts: { questions: 1 }, Question: [{ name: 'q1' }], Option: [], Profile: [] });
    if (p.startsWith('/api/admin/v1/profiles/') && req.method === 'PUT')
      return ok({ before: { points: null }, after: { points: body.points } });
    return send(404, { status: 'error', code: 'not_found', message: 'Not found' });
  });
  return { server, seen };
}

describe('super admin step 2: members and question bank through the panel admin API', () => {
  let t: T;
  let panel: ReturnType<typeof fakePanel>;
  let sql: pg.Client;
  let superToken: string;
  let manager: string;
  let qbEditor: string;
  let mfrOnly: string;

  beforeAll(async () => {
    panel = fakePanel();
    await new Promise<void>((r) => panel.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(panel.server.address() as AddressInfo).port}`;
    t = await startTestApp({
      PANEL_ADMIN_API_SECRET: SECRET,
      MFR_ADMIN_API_BASE_URL: base,
      MHO_ADMIN_API_BASE_URL: base,
    });
    sql = new pg.Client({ connectionString: t.dbUrl });
    await sql.connect();
    superToken = (await t.adminToken('super_admin')).token;
    manager = (await t.adminToken('panel_manager', 'pm@example.invalid', ['mfr'])).token;
    qbEditor = (await t.adminToken('question_bank_editor', 'qb@example.invalid', ['mfr'])).token;
    mfrOnly = (await t.adminToken('brand_admin', 'mfr-ba@example.invalid', ['mfr'])).token;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string) =>
    (await sql.query('select * from audit_event where action = $1 order by id desc', [action])).rows;

  it('signs every call with the brand hostname from Brands & settings and the admin id', async () => {
    const res = await request(t.server)
      .get('/api/v1/panel/members?q=demo')
      .set(bearer(superToken, 'mfr'))
      .expect(200);
    expect(res.body.total).toBe(2);
    const last = panel.seen.at(-1)!;
    expect(last.origin).toBe('www.myfrequentrewards.com');
    const me = await request(t.server).get('/api/v1/auth/me').set(bearer(superToken)).expect(200);
    expect(last.actor).toBe(me.body.id);
    // The search is audited without the search text.
    const [row] = await audit('members.search');
    expect(row.panel).toBe('mfr');
    expect(JSON.stringify(row.metadata)).not.toContain('demo');
  });

  it('needs a single brand, and a brand the admin holds; an unconnected brand says so', async () => {
    await request(t.server).get('/api/v1/panel/members').set(bearer(superToken)).expect(400);
    await request(t.server).get('/api/v1/panel/members').set(bearer(mfrOnly, 't2o')).expect(403);
    const t2o = await request(t.server)
      .get('/api/v1/panel/members')
      .set(bearer(superToken, 't2o'))
      .expect(503);
    expect(t2o.body.code).toBe('panel_admin_not_configured');
  });

  it('hides teens from admins without teen.read, in search and on the member page', async () => {
    const res = await request(t.server).get('/api/v1/panel/members').set(bearer(manager, 'mfr')).expect(200);
    expect(res.body.items.map((m: { id: string }) => m.id)).toEqual([ADULT]);
    expect(res.body.teensHidden).toBe(true);
    expect(panel.seen.at(-1)!.path).toContain('noTeens=1');
    await request(t.server).get(`/api/v1/panel/members/${TEEN}`).set(bearer(manager, 'mfr')).expect(403);
    await request(t.server).get(`/api/v1/panel/members/${TEEN}`).set(bearer(superToken, 'mfr')).expect(200);
    const denied = await audit('authz.denied');
    expect(denied.some((d) => d.target_id === TEEN)).toBe(true);
  });

  it('audits edits and status changes with old and new values and the reason', async () => {
    await request(t.server)
      .put(`/api/v1/panel/members/${ADULT}`)
      .set(bearer(manager, 'mfr'))
      .send({ 'name.first': 'Demi' })
      .expect(400);
    await request(t.server)
      .put(`/api/v1/panel/members/${ADULT}`)
      .set(bearer(manager, 'mfr'))
      .send({ 'name.first': 'Demi', reason: 'Typo in first name' })
      .expect(200);
    expect(panel.seen.at(-1)!.body).toEqual({ 'name.first': 'Demi' });
    const [edit] = await audit('members.edit');
    expect(edit.reason).toBe('Typo in first name');
    expect(edit.before).toBeTruthy();
    expect(edit.after).toBeTruthy();
    await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/status`)
      .set(bearer(manager, 'mfr'))
      .send({ action: 'suspend', reason: 'Duplicate account check' })
      .expect(201);
    const [s] = await audit('members.suspend');
    expect(s.after).toEqual({ status: 'suspended' });
  });

  it('unmask needs pii.view and a reason, and logs the fields, never the values', async () => {
    await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/unmask`)
      .set(bearer(manager, 'mfr'))
      .send({ fields: ['email'], reason: 'Member called support' })
      .expect(403);
    await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/unmask`)
      .set(bearer(superToken, 'mfr'))
      .send({ fields: ['email'] })
      .expect(400);
    const r = await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/unmask`)
      .set(bearer(superToken, 'mfr'))
      .send({ fields: ['email'], reason: 'Member called support' })
      .expect(201);
    expect(r.body.values.email).toBe('demo@example.invalid');
    const [u] = await audit('members.unmask');
    expect(u.metadata).toEqual({ fields: ['email'] });
    expect(JSON.stringify(u)).not.toContain('demo@example.invalid');
  });

  it('archive run is a dry run unless asked, and a real run needs a reason', async () => {
    const dry = await request(t.server)
      .post('/api/v1/panel/members/archive-run')
      .set(bearer(manager, 'mfr'))
      .send({})
      .expect(201);
    expect(dry.body.dryRun).toBe(true);
    await request(t.server)
      .post('/api/v1/panel/members/archive-run')
      .set(bearer(manager, 'mfr'))
      .send({ dryRun: false })
      .expect(403);
    await request(t.server)
      .post('/api/v1/panel/members/archive-run')
      .set(bearer(manager, 'mfr'))
      .send({ dryRun: false, reason: 'Monthly six-month check' })
      .expect(201);
    expect((await audit('members.archive_run')).length).toBe(1);
    expect((await audit('members.archive_run.dry_run')).length).toBe(1);
  });

  it('question bank: editor rights, teen guardrail refusal passed through, import writes need qb.publish', async () => {
    await request(t.server)
      .post('/api/v1/panel/questions')
      .set(bearer(manager, 'mfr'))
      .send({ name: 'q1', label: 'Q', type: 'radio', category: ['b2c'] })
      .expect(403);
    const refused = await request(t.server)
      .post('/api/v1/panel/questions')
      .set(bearer(qbEditor, 'mfr'))
      .send({ name: 'teen_drink', label: 'Do you drink alcohol?', type: 'radio', category: ['b2c-minor'] })
      .expect(422);
    expect(refused.body.code).toBe('teen_guardrail');
    await request(t.server)
      .post('/api/v1/panel/questions')
      .set(bearer(qbEditor, 'mfr'))
      .send({ name: 'q1', label: 'Q', type: 'radio', category: ['b2c'] })
      .expect(201);
    expect((await audit('qb.question.create')).length).toBe(1);
    const file = { Question: [{ name: 'q1', label: 'Q', type: 'radio', category: ['b2c'] }] };
    const dry = await request(t.server)
      .post('/api/v1/panel/qb/import')
      .set(bearer(manager, 'mfr'))
      .send(file);
    expect(dry.status).toBe(403); // panel managers don't edit the bank
    const d = await request(t.server)
      .post('/api/v1/panel/qb/import')
      .set(bearer(qbEditor, 'mfr'))
      .send(file)
      .expect(201);
    expect(d.body.dryRun).toBe(true);
    await request(t.server)
      .post('/api/v1/panel/qb/import?dryRun=0')
      .set(bearer(qbEditor, 'mfr'))
      .send(file)
      .expect(201);
    expect((await audit('qb.import')).length).toBe(1);
    await request(t.server).get('/api/v1/panel/qb/export').set(bearer(qbEditor, 'mfr')).expect(200);
    await request(t.server)
      .put('/api/v1/panel/profiles/dddddddddddddddddddddddd')
      .set(bearer(manager, 'mfr'))
      .send({ points: 80, reason: 'Longer profile now' })
      .expect(200);
    const [p] = await audit('qb.profile.update');
    expect(p.after).toEqual({ points: 80 });
  });

  it('accepts a bank file bigger than the default 100 kB limit on import only', async () => {
    const big = {
      Question: Array.from({ length: 3000 }, (_, i) => ({
        name: `q${i}`,
        label: `Question number ${i} with some wording`,
        type: 'radio',
        category: ['b2c'],
      })),
    };
    expect(JSON.stringify(big).length).toBeGreaterThan(200_000);
    await request(t.server)
      .post('/api/v1/panel/qb/import')
      .set(bearer(qbEditor, 'mfr'))
      .send(big)
      .expect(201);
    await request(t.server)
      .put(`/api/v1/panel/members/${ADULT}`)
      .set(bearer(superToken, 'mfr'))
      .send({ 'name.first': 'x'.repeat(10), reason: 'y'.repeat(200_000) })
      .expect(413);
  });
});
