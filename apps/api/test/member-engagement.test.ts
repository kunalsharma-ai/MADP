import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Member engagement through MADP for T2O, MFR and MHO: what the member sees in their member area, their survey records,
 * alert settings and payout method. A stand-in for the panel's /api/v1/admin (kunalsharma-ai/MFR#101,
 * app/admin/memberengagement.js) checks MADP's signature and keeps the same rules.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
const ADULT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TEEN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
type Seen = { method: string; path: string; origin: string; actor: string; body: unknown };

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
    const want = await signPanelAdmin(SECRET, { timestamp: h('x-madp-timestamp'), nonce: h('x-madp-nonce'), method: req.method!, path: req.url!, origin: h('x-madp-origin'), actor: h('x-madp-actor'), body: raw });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const ok = (data: unknown) => send(200, { status: 'success', data });
    const err = (status: number, code: string, message: string) => send(status, { status: 'error', code, message });
    if (h('x-madp-signature') !== want) return err(401, 'admin_auth', 'Bad signature');
    const origin = h('x-madp-origin');
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ method: req.method!, path: req.url!, origin, actor: h('x-madp-actor'), body });
    const p = new URL(req.url!, 'http://x').pathname;
    const m = /^\/api\/v1\/admin\/members\/([a-f0-9]{24})(\/.*)?$/.exec(p);
    if (!m) return err(404, 'not_found', 'Not found');
    const [, id, rest = ''] = m;
    if (id !== ADULT && id !== TEEN) return err(404, 'not_found', 'Member not found');
    if (!rest) return ok({ id, segment: id === TEEN ? 'teen' : 'consumer', status: 'active' });
    if (rest === '/engagement')
      return ok({ member: { id }, surveys: { byStatus: { complete: 3, terminate: 1 }, completeRate: 0.75, points: 900 }, streak: { current: 4, best: 9 }, payout: { current: 'upi', used: [] } });
    if (rest === '/responses')
      return ok({ total: 1, page: 1, size: 25, items: [{ id: 'r1', survey: 'Living with asthma', slug: 'asthma-2026', status: 'complete', points: 300 }] });
    if (rest === '/alerts' && req.method === 'PUT') return ok({ notifications: { email: body.notifications?.email ?? true }, survey: {} });
    if (rest === '/payout/clear') return ok({ cleared: true, was: 'upi' });
    return err(404, 'not_found', 'Not found');
  });
  return { server, seen };
}

describe('member engagement through the panel admin API', () => {
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
    tok.super = (await t.adminToken('super_admin', 'me.super@example.invalid')).token;
    tok.support = (await t.adminToken('support_agent', 'me.support@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string, brand: string) =>
    (await sql.query('select reason, metadata, before, after from audit_event where action = $1 and panel = $2 order by id desc limit 1', [action, brand])).rows[0];

  it('shows engagement and survey records on every brand, and audits each read', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'] as const) {
      const e = await request(t.server).get(`/api/v1/panel/members/${ADULT}/engagement`).set(bearer(tok.support!, brand)).expect(200);
      expect(e.body).toMatchObject({ surveys: { completeRate: 0.75 }, streak: { current: 4 } });
      expect(await audit('members.engagement.view', brand)).toBeTruthy();
      const r = await request(t.server).get(`/api/v1/panel/members/${ADULT}/responses?status=complete`).set(bearer(tok.super!, brand)).expect(200);
      expect(r.body.items[0].survey).toBe('Living with asthma');
      expect(panel.seen.at(-1)!.path).toContain('status=complete');
      expect((await audit('members.responses.view', brand)).metadata).toMatchObject({ status: 'complete', total: 1 });
    }
  });

  it('hides health survey names from admins without health access', async () => {
    const r = await request(t.server).get(`/api/v1/panel/members/${ADULT}/responses`).set(bearer(tok.support!, 'mho')).expect(200);
    expect(r.body.items[0]).toMatchObject({ survey: 'Health survey (name hidden)', slug: null });
    const mfr = await request(t.server).get(`/api/v1/panel/members/${ADULT}/responses`).set(bearer(tok.support!, 'mfr')).expect(200);
    expect(mfr.body.items[0].survey).toBe('Living with asthma');
  });

  it('changes alerts and clears a payout method with a reason, for admins who may edit members', async () => {
    await request(t.server).put(`/api/v1/panel/members/${ADULT}/alerts`).set(bearer(tok.super!, 'mfr')).send({ notifications: { email: false } }).expect(400);
    await request(t.server).put(`/api/v1/panel/members/${ADULT}/alerts`).set(bearer(tok.super!, 'mfr')).send({ notifications: { quietHours: { start: '25:00' } }, reason: 'Member asked by phone' }).expect(400);
    await request(t.server).put(`/api/v1/panel/members/${ADULT}/alerts`).set(bearer(tok.support!, 'mfr')).send({ notifications: { email: false }, reason: 'Member asked by phone' }).expect(403);
    const a = await request(t.server).put(`/api/v1/panel/members/${ADULT}/alerts`).set(bearer(tok.super!, 'mfr')).send({ notifications: { email: false }, reason: 'Member asked by phone' }).expect(200);
    expect(a.body.notifications.email).toBe(false);
    const aa = await audit('members.alerts.change', 'mfr');
    expect(aa.reason).toBe('Member asked by phone');
    expect(aa.after).toMatchObject({ notifications: { email: false } });

    await request(t.server).post(`/api/v1/panel/members/${ADULT}/payout/clear`).set(bearer(tok.super!, 't2o')).send({}).expect(400);
    const c = await request(t.server).post(`/api/v1/panel/members/${ADULT}/payout/clear`).set(bearer(tok.super!, 't2o')).send({ reason: 'Suspected takeover, ticket 4411' }).expect(201);
    expect(c.body).toEqual({ cleared: true, was: 'upi' });
    const ca = await audit('members.payout.clear', 't2o');
    expect(ca.before).toEqual({ method: 'upi' });
    expect(ca.reason).toBe('Suspected takeover, ticket 4411');
  });

  it('keeps teens behind teen.read', async () => {
    await request(t.server).get(`/api/v1/panel/members/${TEEN}/engagement`).set(bearer(tok.support!, 'mfr')).expect(403);
    await request(t.server).get(`/api/v1/panel/members/${TEEN}/engagement`).set(bearer(tok.super!, 'mfr')).expect(200);
  });
});
