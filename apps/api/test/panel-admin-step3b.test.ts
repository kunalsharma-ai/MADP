import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Super admin step 3b (ticket desk, portal messages, help centre) through MADP. A stand-in for the panel's /api/admin/v1 checks the signature the way the real one
 * does (kunalsharma-ai/MFR#52) and answers with fixed DEMO data.
 */
type T = Awaited<ReturnType<typeof startTestApp>>;
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand?: string) => ({
  authorization: `Bearer ${t}`,
  ...(brand ? { 'x-madp-brand': brand } : {}),
});
const ADULT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TEEN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const SURVEY = 'cccccccccccccccccccccccc';
const ADJ = 'dddddddddddddddddddddddd';

interface Seen {
  method: string;
  path: string;
  origin: string;
  actor: string;
  body: Record<string, unknown> | undefined;
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
      return send(401, { status: 'error', code: 'admin_auth', message: 'Bad' });
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
    const V = '/api/admin/v1';
    if (p === `${V}/tickets`) return ok({ items: [], total: 2, page: 1, pageSize: 50, counts: { new: 2 } });
    if (p === `${V}/tickets/${ADULT}`)
      return ok({ id: ADULT, no: 'MFR-T-1', member: { id: 'x', segment: 'b2c' } });
    if (p === `${V}/tickets/${TEEN}`)
      return ok({ id: TEEN, no: 'MFR-T-2', member: { id: 'y', segment: 'teen' } });
    if (p === `${V}/tickets/${ADULT}/reply`)
      return ok({ id: 'c1', internal: body.internal, status: 'pending', emailSent: false });
    if (p === `${V}/tickets/${ADULT}/status`)
      return ok({ before: { status: 'pending' }, after: { status: body.status } });
    if (p === `${V}/messages` && req.method === 'POST') return ok({ id: MSG, before: null, after: body });
    if (p === `${V}/messages/${MSG}/preview`) return ok({ recipients: 10, teens: teensInPreview });
    if (p === `${V}/messages/${MSG}/send`)
      return ok({ before: { status: 'draft' }, after: { status: 'sent' }, recipients: 10, emailSent: false });
    if (p === `${V}/help` && req.method === 'POST') {
      if (JSON.stringify(body).includes('PayPal') && !body.types)
        return send(422, {
          status: 'error',
          code: 'teen_guardrail',
          message: 'Teen help never mentions money',
        });
      return ok({ id: HELP, before: null, after: body });
    }
    if (p === `${V}/help/${HELP}/status`)
      return ok({ before: { status: 'draft' }, after: { status: body.status } });
    return send(404, { status: 'error', code: 'not_found', message: 'Not found' });
  });
  return { server, seen };
}
const MSG = 'eeeeeeeeeeeeeeeeeeeeeeee';
const HELP = 'ffffffffffffffffffffffff';
let teensInPreview = 0;

describe('super admin step 3b through the panel admin API', () => {
  let t: T;
  let panel: ReturnType<typeof fakePanel>;
  let sql: pg.Client;
  let superToken: string;
  let agent: string;
  let manager: string;
  let brandAdmin: string;

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
    agent = (await t.adminToken('support_agent', 'agent@example.invalid', ['mfr'])).token;
    manager = (await t.adminToken('panel_manager', 'pm@example.invalid', ['mfr'])).token;
    brandAdmin = (await t.adminToken('brand_admin', 'ba@example.invalid', ['mfr'])).token;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string) =>
    (await sql.query('select * from audit_event where action = $1 order by id desc', [action])).rows;

  it('tickets: agents list and reply, teens are hidden without teen.read, nothing is e-mailed', async () => {
    const l = await request(t.server).get('/api/v1/panel/tickets').set(bearer(agent, 'mfr')).expect(200);
    expect(l.body.teensHidden).toBe(true);
    expect(panel.seen.at(-1)!.path).toContain('noTeens=1');
    await request(t.server).get(`/api/v1/panel/tickets/${TEEN}`).set(bearer(agent, 'mfr')).expect(403);
    await request(t.server).get(`/api/v1/panel/tickets/${TEEN}`).set(bearer(superToken, 'mfr')).expect(200);
    const r = await request(t.server)
      .post(`/api/v1/panel/tickets/${ADULT}/reply`)
      .set(bearer(agent, 'mfr'))
      .send({ message: 'We have asked the client to confirm.' })
      .expect(201);
    expect(r.body.emailSent).toBe(false);
    expect(String(panel.seen.at(-1)!.body!.agentName)).toContain('(support team)');
    const [a] = await audit('support.ticket.reply');
    expect(JSON.stringify(a)).not.toContain('asked the client'); // the text stays in the panel, not the audit log
    await request(t.server)
      .post(`/api/v1/panel/tickets/${ADULT}/reply`)
      .set(bearer(agent, 'mfr'))
      .send({ message: 'Internal: dropout in the ledger', internal: true })
      .expect(201);
    expect((await audit('support.ticket.note')).length).toBe(1);
    await request(t.server)
      .post(`/api/v1/panel/tickets/${ADULT}/status`)
      .set(bearer(agent, 'mfr'))
      .send({ status: 'resolved' })
      .expect(201);
    expect((await audit('support.ticket.status'))[0].after).toEqual({ status: 'resolved' });
  });

  it('messages: need messages.send and a reason; a message reaching teens needs teen.read', async () => {
    await request(t.server)
      .post('/api/v1/panel/messages')
      .set(bearer(agent, 'mfr'))
      .send({ title: 'New surveys', body: 'Three new studies' })
      .expect(403);
    await request(t.server)
      .post('/api/v1/panel/messages')
      .set(bearer(brandAdmin, 'mfr'))
      .send({ title: 'New surveys', body: 'Three new studies', cta: 'https://evil.example' })
      .expect(400);
    await request(t.server)
      .post('/api/v1/panel/messages')
      .set(bearer(brandAdmin, 'mfr'))
      .send({ title: 'New surveys', body: 'Three new studies', cta: '/member/surveys' })
      .expect(201);
    await request(t.server)
      .post(`/api/v1/panel/messages/${MSG}/send`)
      .set(bearer(brandAdmin, 'mfr'))
      .send({})
      .expect(400);
    teensInPreview = 3;
    const pm = await request(t.server)
      .post(`/api/v1/panel/messages/${MSG}/send`)
      .set(bearer(manager, 'mfr'))
      .send({ reason: 'Weekly survey round-up' });
    expect(pm.status).toBe(403); // panel managers don't send messages
    teensInPreview = 0;
    const s = await request(t.server)
      .post(`/api/v1/panel/messages/${MSG}/send`)
      .set(bearer(brandAdmin, 'mfr'))
      .send({ reason: 'Weekly survey round-up' })
      .expect(201);
    expect(s.body.emailSent).toBe(false);
    const [row] = await audit('messages.send');
    expect(row.metadata.recipients).toBe(10);
    expect(row.reason).toBe('Weekly survey round-up');
  });

  it('help centre: content.manage, the teen money guardrail comes back as 422', async () => {
    const entry = {
      slug: 'paypal-time',
      topic: 'rewards',
      title: 'When does PayPal arrive?',
      body: ['Within 5 days.'],
    };
    await request(t.server).post('/api/v1/panel/help').set(bearer(agent, 'mfr')).send(entry).expect(403);
    const g = await request(t.server)
      .post('/api/v1/panel/help')
      .set(bearer(brandAdmin, 'mfr'))
      .send(entry)
      .expect(422);
    expect(g.body.code).toBe('teen_guardrail');
    await request(t.server)
      .post('/api/v1/panel/help')
      .set(bearer(brandAdmin, 'mfr'))
      .send({ ...entry, types: ['consumer'] })
      .expect(201);
    await request(t.server)
      .post(`/api/v1/panel/help/${HELP}/status`)
      .set(bearer(brandAdmin, 'mfr'))
      .send({ status: 'published' })
      .expect(201);
    expect((await audit('content.help.published')).length).toBe(1);
  });
});
