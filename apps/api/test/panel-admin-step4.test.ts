import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Super admin step 4 (feature switches, rewards, engagement, teens, data requests) through MADP. A stand-in for the
 * panel's /api/admin/v1 checks the signature the way the real one does (kunalsharma-ai/MFR#53) and answers with DEMO data.
 */
type T = Awaited<ReturnType<typeof startTestApp>>;
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand?: string) => ({
  authorization: `Bearer ${t}`,
  ...(brand ? { 'x-madp-brand': brand } : {}),
});
const ADULT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const TEEN = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const RED = 'cccccccccccccccccccccccc';
const BIG = 'dddddddddddddddddddddddd';
const TEENRED = 'eeeeeeeeeeeeeeeeeeeeeeee';
const DR = 'ffffffffffffffffffffffff';

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
    const sw = (k: string, on: boolean) => ({
      key: k,
      group: 'money',
      label: k,
      default: false,
      effective: on,
      set: on,
      reason: null,
      changedBy: null,
      changedAt: null,
    });
    if (p === `${V}/switches`)
      return ok({ killed: false, kill: sw('kill', false), switches: [sw('redemptions', false)] });
    if (p.startsWith(`${V}/switches/`))
      return ok({ key: p.split('/').pop(), before: null, on: body.on, board: {} });
    const red = (id: string, points: number, teen: boolean, history: { status: string; by: string }[]) => ({
      id,
      reference: `R-${id.slice(0, 4)}`,
      points,
      status: history.at(-1)!.status,
      member: { id: 'm', teen },
      history,
    });
    if (p === `${V}/redemptions`)
      return ok({
        items: [
          red(RED, 15000, false, [{ status: 'requested', by: 'member' }]),
          red(TEENRED, 6000, true, [{ status: 'guardian_pending', by: 'member' }]),
        ],
        counts: {},
      });
    if (p === `${V}/redemptions/${RED}`)
      return ok(red(RED, 15000, false, [{ status: 'requested', by: 'member' }]));
    if (p === `${V}/redemptions/${TEENRED}`)
      return ok(red(TEENRED, 6000, true, [{ status: 'guardian_pending', by: 'member' }]));
    if (p === `${V}/redemptions/${BIG}`)
      return ok(
        red(BIG, 60000, false, [
          { status: 'requested', by: 'member' },
          { status: 'approved', by: `madp:${approverId}` },
        ]),
      );
    if (p.endsWith('/decision') && p.startsWith(`${V}/redemptions/`))
      return ok({ before: 'requested', after: body.status, pointsReturned: 0 });
    if (p === `${V}/draws/${RED}/run`) return ok({ id: RED, status: 'drawn', entries: 4, winners: ['x'] });
    if (p === `${V}/offers` && req.method === 'POST') return ok({ id: RED, ...body });
    if (p === `${V}/engagement/ideas`) return ok([{ id: RED, text: 'An idea', status: 'submitted' }]);
    if (p === `${V}/teens/${TEEN}/graduate`)
      return ok({
        dryRun: url.searchParams.get('dryRun') !== '0',
        from: 'b2c-minor',
        to: 'b2c',
        guardianLinksToStop: 1,
        rewardRequestsToCancel: 0,
      });
    if (p === `${V}/teens/registrations`)
      return ok({
        counts: { manual_review: 1, expired: 1 },
        items: [
          { id: RED, reference: 'TR-DEMO-0001', status: 'manual_review', actions: ['approve', 'cancel'] },
        ],
        query: url.search,
      });
    if (p.startsWith(`${V}/teens/registrations/${RED}/`))
      return ok({
        id: RED,
        reference: 'TR-DEMO-0001',
        status: p.endsWith('/approve') ? 'pending_consent' : 'cancelled',
      });
    if (p === `${V}/teens/${TEEN}/close`)
      return ok({ closed: true, pointsLapsed: 3000, deleteRequestOpened: true });
    if (p === `${V}/data-requests/${DR}/decision`)
      return ok({ before: 'requested', after: body.status, id: DR });
    return send(404, { status: 'error', code: 'not_found', message: 'Not found' });
  });
  return { server, seen };
}
let approverId = '';

describe('super admin step 4 through the panel admin API', () => {
  let t: T;
  let panel: ReturnType<typeof fakePanel>;
  let sql: pg.Client;
  let superToken: string;
  let brandAdmin: string;
  let finance: string;
  let finance2: string;
  let safeguard: string;

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
    brandAdmin = (await t.adminToken('brand_admin', 'ba@example.invalid', ['mfr'])).token;
    const f = await t.adminToken('rewards_finance', 'fin@example.invalid', ['mfr']);
    finance = f.token;
    approverId = (await sql.query("select id from admin_user where email = 'fin@example.invalid'")).rows[0]
      .id;
    finance2 = (await t.adminToken('rewards_finance', 'fin2@example.invalid', ['mfr'])).token;
    safeguard = (await t.adminToken('teen_safeguarding', 'safe@example.invalid', ['mfr'])).token;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string) =>
    (await sql.query('select * from audit_event where action = $1 order by id desc', [action])).rows;

  it('switches: brand admins can see the board but only Super Admin flips, with a reason, audited', async () => {
    const seen = await request(t.server)
      .get('/api/v1/panel/switches')
      .set(bearer(brandAdmin, 'mfr'))
      .expect(200);
    expect(seen.body.canFlip).toBe(false);
    await request(t.server)
      .put('/api/v1/panel/switches/redemptions')
      .set(bearer(brandAdmin, 'mfr'))
      .send({ on: true, reason: 'want it on' })
      .expect(403);
    await request(t.server)
      .put('/api/v1/panel/switches/redemptions')
      .set(bearer(superToken, 'mfr'))
      .send({ on: true })
      .expect(400);
    await request(t.server)
      .put('/api/v1/panel/switches/whatever')
      .set(bearer(superToken, 'mfr'))
      .send({ on: true, reason: 'want it on' })
      .expect(400);
    const n = panel.seen.length;
    const r = await request(t.server)
      .put('/api/v1/panel/switches/redemptions')
      .set(bearer(superToken, 'mfr'))
      .send({ on: true, reason: 'Payout route agreed' })
      .expect(200);
    expect(r.body.on).toBe(true);
    expect(panel.seen.length).toBe(n + 1);
    expect(panel.seen.at(-1)!.origin).toBeTruthy();
    const [a] = await audit('switch.flip');
    expect(a.reason).toBe('Payout route agreed');
    expect(a.after).toEqual({ on: true });
    await request(t.server)
      .put('/api/v1/panel/switches/kill')
      .set(bearer(superToken, 'mfr'))
      .send({ on: true, reason: 'Incident drill' })
      .expect(200);
    expect((await audit('switch.kill')).length).toBe(1);
  });

  it('redemptions: finance approves; teen requests need teen.read; paying out at the four-eyes amount needs a second admin', async () => {
    const l = await request(t.server)
      .get('/api/v1/panel/redemptions')
      .set(bearer(finance, 'mfr'))
      .expect(200);
    expect(l.body.items).toHaveLength(1);
    expect(l.body.teensHidden).toBe(true);
    await request(t.server)
      .get(`/api/v1/panel/redemptions/${TEENRED}`)
      .set(bearer(finance, 'mfr'))
      .expect(403);
    await request(t.server)
      .post(`/api/v1/panel/redemptions/${RED}/decision`)
      .set(bearer(finance, 'mfr'))
      .send({ status: 'approved' })
      .expect(400);
    await request(t.server)
      .post(`/api/v1/panel/redemptions/${RED}/decision`)
      .set(bearer(finance, 'mfr'))
      .send({ status: 'approved', reason: 'Ledger checked' })
      .expect(201);
    expect((await audit('redemption.approved'))[0].reason).toBe('Ledger checked');
    await request(t.server)
      .post(`/api/v1/panel/redemptions/${BIG}/decision`)
      .set(bearer(finance, 'mfr'))
      .send({ status: 'fulfilled', reason: 'Paid by hand' })
      .expect(403);
    await request(t.server)
      .post(`/api/v1/panel/redemptions/${BIG}/decision`)
      .set(bearer(finance2, 'mfr'))
      .send({ status: 'fulfilled', reason: 'Paid by hand' })
      .expect(201);
    expect((await audit('redemption.fulfilled')).length).toBe(1);
  });

  it('draws and offers need a reason; teen ideas need teen.review', async () => {
    await request(t.server)
      .post(`/api/v1/panel/draws/${RED}/run`)
      .set(bearer(finance, 'mfr'))
      .send({})
      .expect(400);
    const d = await request(t.server)
      .post(`/api/v1/panel/draws/${RED}/run`)
      .set(bearer(finance, 'mfr'))
      .send({ reason: 'Month closed' })
      .expect(201);
    expect(d.body.status).toBe('drawn');
    const [a] = await audit('draw.run');
    expect(a.metadata.winners).toBe(1);
    expect(JSON.stringify(a)).not.toContain('"x"');
    await request(t.server)
      .post('/api/v1/panel/offers')
      .set(bearer(finance, 'mfr'))
      .send({
        title: 'Double',
        multiplier: 2,
        startsAt: '2026-12-05T00:00:00Z',
        endsAt: '2026-12-01T00:00:00Z',
        reason: 'Christmas push',
      })
      .expect(400);
    await request(t.server)
      .post('/api/v1/panel/offers')
      .set(bearer(finance, 'mfr'))
      .send({
        title: 'Double',
        multiplier: 2,
        startsAt: '2026-12-05T00:00:00Z',
        endsAt: '2026-12-07T00:00:00Z',
        reason: 'Christmas push',
      })
      .expect(201);
    await request(t.server).get('/api/v1/panel/engagement/ideas').set(bearer(finance, 'mfr')).expect(403);
    await request(t.server).get('/api/v1/panel/engagement/ideas').set(bearer(brandAdmin, 'mfr')).expect(200);
  });

  it('teens: a dry run is not audited as a change; the real move needs a reason and segments.manage', async () => {
    await request(t.server)
      .post(`/api/v1/panel/teens/${TEEN}/graduate`)
      .set(bearer(safeguard, 'mfr'))
      .send({})
      .expect(403);
    const dry = await request(t.server)
      .post(`/api/v1/panel/teens/${TEEN}/graduate`)
      .set(bearer(brandAdmin, 'mfr'))
      .send({})
      .expect(201);
    expect(dry.body.dryRun).toBe(true);
    expect(await audit('teen.graduate')).toHaveLength(0);
    const go = await request(t.server)
      .post(`/api/v1/panel/teens/${TEEN}/graduate`)
      .set(bearer(brandAdmin, 'mfr'))
      .send({ dryRun: false, reason: 'Turned 18, DOB checked' })
      .expect(201);
    expect(go.body.dryRun).toBe(false);
    expect(panel.seen.at(-1)!.path).toContain('dryRun=0');
    const [a] = await audit('teen.graduate');
    expect([a.before, a.after]).toEqual([{ segment: 'b2c-minor' }, { segment: 'b2c' }]);
  });

  it('teen pipeline: safeguarding reads and decides with a reason; finance cannot; close is audited', async () => {
    await request(t.server).get('/api/v1/panel/teens/registrations').set(bearer(finance, 'mfr')).expect(403);
    const board = await request(t.server)
      .get('/api/v1/panel/teens/registrations?status=manual_review')
      .set(bearer(safeguard, 'mfr'))
      .expect(200);
    expect(board.body.counts.manual_review).toBe(1);
    expect(panel.seen.at(-1)!.path).toContain('status=manual_review');
    await request(t.server)
      .get('/api/v1/panel/teens/registrations?status=nope')
      .set(bearer(safeguard, 'mfr'))
      .expect(400);
    await request(t.server)
      .post(`/api/v1/panel/teens/registrations/${RED}/approve`)
      .set(bearer(safeguard, 'mfr'))
      .send({})
      .expect(400);
    await request(t.server)
      .post(`/api/v1/panel/teens/registrations/${RED}/delete`)
      .set(bearer(safeguard, 'mfr'))
      .send({ reason: 'Not an action' })
      .expect(400);
    const ok = await request(t.server)
      .post(`/api/v1/panel/teens/registrations/${RED}/approve`)
      .set(bearer(safeguard, 'mfr'))
      .send({ reason: 'Spoke to the mother on the phone' })
      .expect(201);
    expect(ok.body.status).toBe('pending_consent');
    const [a] = await audit('teen.registration.approve');
    expect(a.after).toEqual({ status: 'pending_consent' });
    await request(t.server)
      .post(`/api/v1/panel/teens/registrations/${RED}/cancel`)
      .set(bearer(finance, 'mfr'))
      .send({ reason: 'Duplicate sign-up' })
      .expect(403);

    await request(t.server)
      .post(`/api/v1/panel/teens/${TEEN}/close`)
      .set(bearer(finance, 'mfr'))
      .send({ reason: 'No reply after 60 days' })
      .expect(403);
    const c = await request(t.server)
      .post(`/api/v1/panel/teens/${TEEN}/close`)
      .set(bearer(safeguard, 'mfr'))
      .send({ reason: 'No reply after three calls' })
      .expect(201);
    expect(c.body.pointsLapsed).toBe(3000);
    expect((await audit('teen.close')).length).toBe(1);

    // move now passes the chosen adult segment through
    await request(t.server)
      .post(`/api/v1/panel/teens/${TEEN}/graduate`)
      .set(bearer(brandAdmin, 'mfr'))
      .send({ segment: 'b2b' })
      .expect(201);
    expect(panel.seen.at(-1)!.body).toMatchObject({ segment: 'b2b' });
  });

  it('data requests: decided with a reason; MHO calls carry the MHO origin', async () => {
    await request(t.server)
      .post(`/api/v1/panel/data-requests/${DR}/decision`)
      .set(bearer(brandAdmin, 'mfr'))
      .send({ status: 'approved', reason: 'Checked with the member' })
      .expect(201);
    expect((await audit('data_request.approved')).length).toBe(1);
    await request(t.server)
      .post(`/api/v1/panel/data-requests/${DR}/decision`)
      .set(bearer(finance, 'mfr'))
      .send({ status: 'approved', reason: 'Checked with the member' })
      .expect(403);
    await request(t.server).get('/api/v1/panel/switches').set(bearer(superToken, 'mho')).expect(200);
    const mfrOrigin = panel.seen.find((s) => s.path.endsWith('/switches/redemptions'))!.origin;
    expect(panel.seen.at(-1)!.origin).not.toBe(mfrOrigin);
  });
});
