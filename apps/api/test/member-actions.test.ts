import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Member actions through MADP for T2O, MFR and MHO: e-mail a password reset link, send the welcome again, and log in
 * as the member. A stand-in for the panel's /api/v1/admin (kunalsharma-ai/MFR app/admin/memberactions.js) checks
 * MADP's signature and keeps the same rules: nothing is sent while email_admin_actions is off, teens are refused, a
 * member of another brand is not found, and the one-use link is for a 15-minute admin session.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
const ADULT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TEEN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const SID = 'cccccccccccccccccccccccc';
const TICKET = 'T'.repeat(43);
type Seen = { method: string; path: string; origin: string; actor: string; body: unknown };

function fakePanel() {
  const seen: Seen[] = [];
  const switchOn = new Set<string>();
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
    if (id === TEEN && /reset-password|resend-welcome|login-as/.test(rest)) return err(409, 'teen_member', 'Teen accounts are managed in the Teen module');
    if (rest === '/reset-password' || rest === '/resend-welcome') {
      const reset = rest === '/reset-password';
      const brand = origin.includes('turn2opinion') ? 'Turn2Opinion' : origin.includes('myhealthopinions') ? 'MyHealthOpinions' : 'MyFrequentRewards';
      return ok({
        sent: switchOn.has(origin),
        switch: 'email_admin_actions',
        wouldSend: { template: reset ? 'register/forgot-password' : 'register/welcome', to: 'd***@example.invalid', brand: origin, subject: reset ? `${brand}: Forgot Password` : `Your ${brand} account is active` },
      });
    }
    if (rest === '/login-as')
      return ok({ sessionId: SID, url: `https://${origin}/api/v1/user/admin-session?ticket=${TICKET}`, redeemBy: new Date(Date.now() + 120_000).toISOString(), expiresAt: new Date(Date.now() + 900_000).toISOString(), refused: ['password', 'payout details'] });
    if (rest === '/admin-sessions')
      return ok({ items: [{ id: SID, actor: h('x-madp-actor'), reason: 'Member says the dashboard is empty', issuedAt: new Date().toISOString(), usedAt: null, expiresAt: new Date(Date.now() + 900_000).toISOString(), endedAt: null, state: 'waiting' }] });
    if (rest === `/admin-sessions/${SID}/end`) return ok({ id: SID, endedAt: new Date().toISOString() });
    return err(404, 'not_found', 'Not found');
  });
  return { server, seen, switchOn };
}

describe('member actions through the panel admin API', () => {
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
    tok.super = (await t.adminToken('super_admin', 'ma.super@example.invalid')).token;
    tok.support = (await t.adminToken('support_agent', 'ma.support@example.invalid')).token;
    tok.analyst = (await t.adminToken('read_only_analyst', 'ma.reader@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string, brand: string) =>
    (await sql.query('select actor_id, reason, metadata from audit_event where action = $1 and panel = $2 order by id desc limit 1', [action, brand])).rows[0];

  it('reset and welcome say what would be sent while the switch is off, on every brand, and audit the reason', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'] as const) {
      for (const [path, action, template] of [['reset-password', 'members.reset_password', 'register/forgot-password'], ['resend-welcome', 'members.resend_welcome', 'register/welcome']] as const) {
        const r = await request(t.server).post(`/api/v1/panel/members/${ADULT}/${path}`).set(bearer(tok.support!, brand)).send({ reason: 'Member phoned the help desk' }).expect(201);
        expect(r.body).toMatchObject({ sent: false, switch: 'email_admin_actions', wouldSend: { template } });
        expect(JSON.stringify(r.body)).not.toMatch(/password"\s*:/);
        const a = await audit(action, brand);
        expect(a.reason).toBe('Member phoned the help desk');
        expect(a.metadata).toEqual({ sent: false, template, switch: 'email_admin_actions' });
        expect(JSON.stringify(a)).not.toContain('example.invalid');
      }
      expect(panel.seen.at(-1)!.origin).toMatch(/turn2opinion|myfrequentrewards|myhealthopinions/);
    }
  });

  it('log in as member: Super Admin only, a reason, a one-use link, and the link never reaches the audit trail', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'] as const) {
      await request(t.server).post(`/api/v1/panel/members/${ADULT}/login-as`).set(bearer(tok.support!, brand)).send({ reason: 'Member says the dashboard is empty' }).expect(403);
      await request(t.server).post(`/api/v1/panel/members/${ADULT}/login-as`).set(bearer(tok.super!, brand)).send({}).expect(400);
      const r = await request(t.server).post(`/api/v1/panel/members/${ADULT}/login-as`).set(bearer(tok.super!, brand)).send({ reason: 'Member says the dashboard is empty' }).expect(201);
      expect(r.headers['cache-control']).toContain('no-store');
      expect(r.body.url).toContain('/api/v1/user/admin-session?ticket=');
      expect(new Date(r.body.expiresAt).getTime() - Date.now()).toBeLessThanOrEqual(15 * 60_000);
      const asked = await audit('members.login_as.requested', brand);
      const done = await audit('members.login_as', brand);
      expect(asked.reason).toBe('Member says the dashboard is empty');
      expect(done.metadata).toMatchObject({ sessionId: SID });
      const all = (await sql.query("select metadata::text as m, coalesce(reason,'') as r from audit_event")).rows.map((x) => x.m + x.r).join();
      expect(all).not.toContain(TICKET);
      const list = await request(t.server).get(`/api/v1/panel/members/${ADULT}/admin-sessions`).set(bearer(tok.super!, brand)).expect(200);
      expect(list.body.items[0]).toMatchObject({ id: SID, state: 'waiting' });
      await request(t.server).post(`/api/v1/panel/members/${ADULT}/admin-sessions/${SID}/end`).set(bearer(tok.super!, brand)).expect(201);
      expect((await audit('members.login_as.ended', brand)).metadata).toEqual({ sessionId: SID });
    }
  });

  it('refuses teens before asking the panel, passes the panel’s refusals through, and checks permissions', async () => {
    const before = panel.seen.filter((s) => s.path.endsWith('/login-as')).length;
    await request(t.server).post(`/api/v1/panel/members/${TEEN}/login-as`).set(bearer(tok.super!, 'mfr')).send({ reason: 'Checking the account' }).expect(403);
    expect(panel.seen.filter((s) => s.path.endsWith('/login-as')).length).toBe(before);
    const r = await request(t.server).post(`/api/v1/panel/members/${TEEN}/reset-password`).set(bearer(tok.super!, 'mho')).send({ reason: 'Checking the account' }).expect(409);
    expect(r.body).toMatchObject({ code: 'teen_member' });
    await request(t.server).post(`/api/v1/panel/members/${'d'.repeat(24)}/reset-password`).set(bearer(tok.super!, 't2o')).send({ reason: 'Checking the account' }).expect(404);
    await request(t.server).post(`/api/v1/panel/members/${ADULT}/reset-password`).set(bearer(tok.analyst!, 'mfr')).send({ reason: 'Checking the account' }).expect(403);
    await request(t.server).post(`/api/v1/panel/members/${ADULT}/reset-password`).set(bearer(tok.super!, 'all')).send({ reason: 'Checking the account' }).expect(400);
    await request(t.server).post(`/api/v1/panel/members/${ADULT}/reset-password`).set(bearer(tok.super!, 'mfr')).send({ reason: 'ok', password: 'x' }).expect(400);
  });
});
