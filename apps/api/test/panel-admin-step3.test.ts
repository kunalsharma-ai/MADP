import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Super admin step 3a (segments, audiences, surveys and invitations, points, quality, referral fraud) and question
 * bank versions through MADP. A stand-in for the panel's /api/v1/admin checks the signature the way the real one
 * does (kunalsharma-ai/MFR#51) and answers with fixed DEMO data.
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
    const V = '/api/v1/admin';
    if (p === `${V}/members/${ADULT}`) return ok({ id: ADULT, segment: 'consumer' });
    if (p === `${V}/members/${TEEN}`) return ok({ id: TEEN, segment: 'teen' });
    if (p === `${V}/segments`)
      return ok([{ name: 'b2c', settings: { signupOpen: true }, members: { active: 3 } }]);
    if (p === `${V}/segments/b2c`)
      return ok({ before: { signupOpen: true }, after: { signupOpen: body.signupOpen } });
    if (p === `${V}/audiences/count`) return ok({ filter: body.filter, count: 42, bySegment: { b2c: 42 } });
    if (p === `${V}/audiences` && req.method === 'POST')
      return ok({ id: 'eeeeeeeeeeeeeeeeeeeeeeee', before: null, after: body, count: 42 });
    if (p === `${V}/surveys` && req.method === 'POST') return ok({ id: SURVEY, before: null, after: body });
    if (p === `${V}/surveys/${SURVEY}/status`)
      return ok({ before: { status: 'draft' }, after: { status: body.status } });
    if (p === `${V}/surveys/${SURVEY}/invite`) {
      const dry = url.searchParams.get('dryRun') !== '0';
      return ok(
        dry
          ? { dryRun: true, wouldInvite: 2, emailSent: false }
          : { dryRun: false, invited: 2, emailSent: false },
      );
    }
    if (p === `${V}/surveys/${SURVEY}/responses`) return ok({ total: 2, page: 1, rows: [] });
    if (p === `${V}/surveys/${SURVEY}/reconcile`)
      return ok({ approved: body.approve.length, rejected: 0, skipped: 0 });
    if (p === `${V}/members/${ADULT}/points`)
      return ok({
        adjustment: { id: ADJ, status: body.needsApproval ? 'pending' : 'applied' },
        before: { available: 100 },
        after: { available: body.needsApproval ? 100 : 100 + body.points },
      });
    if (p === `${V}/points/approvals/${ADJ}`) {
      // the panel refuses the requester, as the real one does
      if (h('x-madp-actor') === requester)
        return send(409, { status: 'error', code: 'four_eyes', message: 'Second admin' });
      return ok({
        before: { status: 'pending' },
        after: { status: 'applied' },
        points: 60000,
        member: ADULT,
      });
    }
    if (p === `${V}/members/${ADULT}/quality` && req.method === 'POST')
      return ok({ before: { score: 100 }, after: { score: 100 + body.delta }, tier: 'silver' });
    if (p === `${V}/quality/review`)
      return ok({ total: 1, page: 1, rows: [{ member: ADULT, name: 'Demo A.', score: 40 }] });
    if (p === `${V}/referrals/fraud`)
      return ok({ signals: [], notTracked: ['signup_ip', 'device'], referrers: [{}], sharedPayouts: [] });
    if (p === `${V}/qb/versions` && req.method === 'POST')
      return ok({ number: 1, status: 'draft', counts: { questions: 2 }, diff: {} });
    if (p.startsWith(`${V}/qb/versions/1/`))
      return ok({
        before: { status: 'review' },
        after: { status: p.split('/').pop() === 'publish' ? 'published' : 'review' },
      });
    return send(404, { status: 'error', code: 'not_found', message: 'Not found' });
  });
  return { server, seen };
}
let requester = '';

describe('super admin step 3a through the panel admin API', () => {
  let t: T;
  let panel: ReturnType<typeof fakePanel>;
  let sql: pg.Client;
  let superToken: string;
  let manager: string;
  let finance: string;
  let finance2: string;
  let qbEditor: string;

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
    finance = (await t.adminToken('rewards_finance', 'fin@example.invalid', ['mfr'])).token;
    finance2 = (await t.adminToken('rewards_finance', 'fin2@example.invalid', ['mfr'])).token;
    qbEditor = (await t.adminToken('question_bank_editor', 'qb@example.invalid', ['mfr'])).token;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string) =>
    (await sql.query('select * from audit_event where action = $1 order by id desc', [action])).rows;
  const meId = async (token: string) =>
    (await request(t.server).get('/api/v1/auth/me').set(bearer(token)).expect(200)).body.id as string;

  it('segments: settings changes need segments.manage and a reason, and are audited', async () => {
    await request(t.server).get('/api/v1/panel/segments').set(bearer(manager, 'mfr')).expect(200);
    await request(t.server)
      .put('/api/v1/panel/segments/b2c')
      .set(bearer(finance, 'mfr'))
      .send({ signupOpen: false, reason: 'Pausing sign-ups' })
      .expect(403);
    await request(t.server)
      .put('/api/v1/panel/segments/b2c')
      .set(bearer(manager, 'mfr'))
      .send({ signupOpen: false })
      .expect(400);
    await request(t.server)
      .put('/api/v1/panel/segments/b2c')
      .set(bearer(manager, 'mfr'))
      .send({ signupOpen: false, reason: 'Pausing sign-ups for the audit' })
      .expect(200);
    expect(panel.seen.at(-1)!.body).toEqual({ signupOpen: false });
    const [row] = await audit('segments.update');
    expect(row.after).toEqual({ signupOpen: false });
    expect(row.panel).toBe('mfr');
  });

  it('audiences: counts and saves go to the brand picked, unknown filter keys are refused', async () => {
    const c = await request(t.server)
      .post('/api/v1/panel/audiences/count')
      .set(bearer(manager, 'mho'))
      .send({ filter: { countries: ['us'] } });
    expect(c.status).toBe(403); // the panel manager only holds MFR
    const ok = await request(t.server)
      .post('/api/v1/panel/audiences/count')
      .set(bearer(superToken, 'mho'))
      .send({ filter: { countries: ['us'] } })
      .expect(201);
    expect(ok.body.count).toBe(42);
    expect(panel.seen.at(-1)!.origin).toBe('www.myhealthopinions.com');
    await request(t.server)
      .post('/api/v1/panel/audiences/count')
      .set(bearer(manager, 'mfr'))
      .send({ filter: { illness: ['diabetes'] } })
      .expect(400);
    await request(t.server)
      .post('/api/v1/panel/audiences')
      .set(bearer(manager, 'mfr'))
      .send({ name: 'US members', filter: { countries: ['us'] } })
      .expect(201);
    expect((await audit('audiences.create'))[0].metadata).toEqual({ count: 42 });
  });

  it('surveys: create, go live, invitations are dry runs unless asked; a real run needs invitations.send and a reason', async () => {
    await request(t.server)
      .post('/api/v1/panel/surveys')
      .set(bearer(manager, 'mfr'))
      .send({ name: 'Pet food', slug: 'pet-food', category: 'b2c', source: 'demo', points: 120, loi: 10 })
      .expect(201);
    await request(t.server)
      .post(`/api/v1/panel/surveys/${SURVEY}/status`)
      .set(bearer(manager, 'mfr'))
      .send({ status: 'active' })
      .expect(201);
    expect((await audit('surveys.status.active')).length).toBe(1);
    const dry = await request(t.server)
      .post(`/api/v1/panel/surveys/${SURVEY}/invite`)
      .set(bearer(manager, 'mfr'))
      .send({})
      .expect(201);
    expect(dry.body).toEqual({ dryRun: true, wouldInvite: 2, emailSent: false });
    await request(t.server)
      .post(`/api/v1/panel/surveys/${SURVEY}/invite`)
      .set(bearer(finance, 'mfr'))
      .send({ dryRun: false, reason: 'Launch wave one' })
      .expect(403); // finance has no surveys.read
    await request(t.server)
      .post(`/api/v1/panel/surveys/${SURVEY}/invite`)
      .set(bearer(manager, 'mfr'))
      .send({ dryRun: false })
      .expect(400);
    const live = await request(t.server)
      .post(`/api/v1/panel/surveys/${SURVEY}/invite`)
      .set(bearer(manager, 'mfr'))
      .send({ dryRun: false, reason: 'Launch wave one' })
      .expect(201);
    expect(live.body.emailSent).toBe(false);
    expect(panel.seen.at(-1)!.path).toContain('dryRun=0');
    const [inv] = await audit('invitations.send');
    expect(inv.reason).toBe('Launch wave one');
    await request(t.server)
      .get(`/api/v1/panel/surveys/${SURVEY}/responses`)
      .set(bearer(manager, 'mfr'))
      .expect(200);
    expect((await audit('surveys.responses.view')).length).toBe(1);
    await request(t.server)
      .post(`/api/v1/panel/surveys/${SURVEY}/reconcile`)
      .set(bearer(manager, 'mfr'))
      .send({ approve: [ADULT], reason: 'Client final list' })
      .expect(201);
    expect((await audit('surveys.reconcile'))[0].metadata.approved).toBe(1);
  });

  it('points: under the brand amount applies at once; at or over it waits, and a second admin decides', async () => {
    await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/points`)
      .set(bearer(manager, 'mfr'))
      .send({ points: 50, reasonCode: 'goodwill', note: 'Broken survey link' })
      .expect(403); // panel managers don't adjust points
    const small = await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/points`)
      .set(bearer(finance, 'mfr'))
      .send({ points: 50, reasonCode: 'goodwill', note: 'Broken survey link' })
      .expect(201);
    expect(panel.seen.at(-1)!.body!.needsApproval).toBe(false);
    expect(small.body.fourEyesAt).toBe(50000);
    const big = await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/points`)
      .set(bearer(finance, 'mfr'))
      .send({ points: 60000, reasonCode: 'migration', note: 'Carried over from the old panel' })
      .expect(201);
    expect(big.body.adjustment.status).toBe('pending');
    expect((await audit('points.adjust.requested'))[0].metadata.fourEyesAt).toBe(50000);
    requester = await meId(finance);
    const self = await request(t.server)
      .post(`/api/v1/panel/points/approvals/${ADJ}`)
      .set(bearer(finance, 'mfr'))
      .send({ decision: 'approve' })
      .expect(409);
    expect(self.body.code).toBe('four_eyes');
    await request(t.server)
      .post(`/api/v1/panel/points/approvals/${ADJ}`)
      .set(bearer(finance2, 'mfr'))
      .send({ decision: 'approve', note: 'Checked against the export' })
      .expect(201);
    const [a] = await audit('points.adjust.approve');
    expect(a.after).toEqual({ status: 'applied' });
    // teen records need teen.read
    await request(t.server)
      .post(`/api/v1/panel/members/${TEEN}/points`)
      .set(bearer(finance, 'mfr'))
      .send({ points: 10, reasonCode: 'goodwill', note: 'Broken survey link' })
      .expect(403);
  });

  it('quality and referral fraud: changes and reads are audited', async () => {
    await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/quality`)
      .set(bearer(finance, 'mfr'))
      .send({ rule: 'speeding', delta: -20, note: 'Two-minute complete' })
      .expect(403);
    await request(t.server)
      .post(`/api/v1/panel/members/${ADULT}/quality`)
      .set(bearer(manager, 'mfr'))
      .send({ rule: 'speeding', delta: -20, note: 'Two-minute complete' })
      .expect(201);
    const [q] = await audit('quality.score.change');
    expect(q.before).toEqual({ score: 100 });
    expect(q.after).toEqual({ score: 80 });
    await request(t.server)
      .get('/api/v1/panel/quality/review?below=60')
      .set(bearer(manager, 'mfr'))
      .expect(200);
    await request(t.server).get('/api/v1/panel/referrals/fraud').set(bearer(manager, 'mfr')).expect(200);
    expect((await audit('quality.review.view')).length).toBe(1);
    expect((await audit('referrals.fraud.view')).length).toBe(1);
  });

  it('question bank versions: review with qb.edit, publish needs qb.publish', async () => {
    await request(t.server)
      .post('/api/v1/panel/qb/versions')
      .set(bearer(manager, 'mfr'))
      .send({})
      .expect(403);
    await request(t.server)
      .post('/api/v1/panel/qb/versions')
      .set(bearer(qbEditor, 'mfr'))
      .send({ note: 'First release' })
      .expect(201);
    await request(t.server)
      .post('/api/v1/panel/qb/versions/1/review')
      .set(bearer(qbEditor, 'mfr'))
      .expect(201);
    await request(t.server).post('/api/v1/panel/qb/versions/1/ship').set(bearer(qbEditor, 'mfr')).expect(400);
    await request(t.server)
      .post('/api/v1/panel/qb/versions/1/publish')
      .set(bearer(superToken, 'mfr'))
      .expect(201);
    expect((await audit('qb.version.publish'))[0].after).toEqual({ status: 'published' });
  });
});
