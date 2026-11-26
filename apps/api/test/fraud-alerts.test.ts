import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * The red possible-duplicates alert for T2O, MFR and MHO. A stand-in for the panel's duplicate finder (MFR#68)
 * answers each rule; MADP returns counts only and remembers per admin what was seen.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string) => ({ authorization: `Bearer ${t}` });

function fakePanel() {
  let calls = 0;
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
    if (h('x-madp-signature') !== want) return send(401, { status: 'error', code: 'admin_auth', message: 'Bad signature' });
    const u = new URL(req.url!, 'http://x');
    if (h('x-madp-origin').includes('myhealthopinions')) return send(503, { status: 'error', code: 'down', message: 'Down' });
    if (u.pathname !== '/api/v1/admin/members/duplicates') return send(404, { status: 'error', code: 'not_found', message: 'Not found' });
    calls++;
    const by = u.searchParams.get('by');
    const items =
      by === 'phone'
        ? [
            { reason: 'Same phone', members: [{ id: 'a', email: 'a***@example.invalid', signedUpAt: '2020-01-01T00:00:00Z' }, { id: 'b', signedUpAt: new Date().toISOString() }] },
            { reason: 'Same phone', members: [{ id: 'c', signedUpAt: '2020-01-01T00:00:00Z' }, { id: 'd', signedUpAt: '2020-02-01T00:00:00Z' }] },
          ]
        : by === 'email'
          ? [{ reason: 'Same e-mail', members: [{ id: 'e', signedUpAt: new Date(Date.now() - 3600_000).toISOString() }, { id: 'f', signedUpAt: null }] }]
          : [];
    send(200, { status: 'success', data: { by, groups: items.length, more: false, items } });
  });
  return { server, calls: () => calls };
}

describe('possible duplicate alerts', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let panel: ReturnType<typeof fakePanel>;
  const tok: Record<string, string> = {};

  beforeAll(async () => {
    panel = fakePanel();
    await new Promise<void>((r) => panel.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(panel.server.address() as AddressInfo).port}`;
    t = await startTestApp({ PANEL_ADMIN_API_SECRET: SECRET, T2O_ADMIN_API_BASE_URL: base, MFR_ADMIN_API_BASE_URL: base, MHO_ADMIN_API_BASE_URL: base });
    tok.manager = (await t.adminToken('panel_manager', 'fa.manager@example.invalid')).token;
    tok.manager2 = (await t.adminToken('panel_manager', 'fa.manager2@example.invalid')).token;
    tok.analyst = (await t.adminToken('analyst', 'fa.analyst@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await t?.stop();
    panel?.server.close();
  });

  it('counts groups per panel and rule, new ones since last look, and lists a panel that does not answer', async () => {
    const r = await request(t.server).get('/api/v1/fraud-alerts').set(bearer(tok.manager!)).expect(200);
    expect(r.body.unreachable).toEqual(['mho']);
    const t2o = r.body.panels.find((x: { panel: string }) => x.panel === 't2o');
    expect(t2o).toMatchObject({ groups: { phone: 2, email: 1, name_dob: 0 }, fresh: 2, more: false });
    expect(r.body.total).toBe(4); // t2o 2 + mfr 2
    expect(JSON.stringify(r.body)).not.toContain('example.invalid');
    await request(t.server).post('/api/v1/fraud-alerts/seen').set(bearer(tok.manager!)).send({ panel: 't2o' }).expect(200);
    const after = await request(t.server).get('/api/v1/fraud-alerts').set(bearer(tok.manager!)).expect(200);
    expect(after.body.panels.find((x: { panel: string }) => x.panel === 't2o').fresh).toBe(0);
    expect(after.body.total).toBe(2);
    // Another admin still sees them as new; the panel was scanned once per rule and panel, not per request.
    expect((await request(t.server).get('/api/v1/fraud-alerts').set(bearer(tok.manager2!)).expect(200)).body.total).toBe(4);
    expect(panel.calls()).toBe(6);
  });

  it('shows nothing to admins without member access', async () => {
    const r = await request(t.server).get('/api/v1/fraud-alerts').set(bearer(tok.analyst!)).expect(200);
    expect(r.body).toMatchObject({ total: 0, panels: [] });
    await request(t.server).post('/api/v1/fraud-alerts/seen').set(bearer(tok.analyst!)).send({ panel: 'xx' }).expect(400);
  });
});
