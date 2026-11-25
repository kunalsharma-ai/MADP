import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Duplicate member accounts through MADP for T2O, MFR and MHO. A stand-in for the panel's /api/v1/admin
 * (kunalsharma-ai/MFR#68, app/admin/merge.js) checks MADP's signature and keeps its rules: a merge is a dry run unless
 * ?dryRun=0, applying needs a reason and no blockers, teen accounts are blocked, and an undo happens once.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
const A = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const B = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const TEEN = 'cccccccccccccccccccccccc';
const MERGE = 'dddddddddddddddddddddddd';
const row = (id: string, segment = 'consumer') => ({ id, name: `Demo ${id.slice(0, 1)}.`, email: 'd***@example.invalid', phone: '******1234', segment, status: 'active' });
type Seen = { method: string; url: string; origin: string; body: Record<string, unknown> | undefined };

function fakePanel() {
  const seen: Seen[] = [];
  const undone = new Set<string>();
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
    const body = raw ? JSON.parse(raw) : undefined;
    seen.push({ method: req.method!, url: req.url!, origin: h('x-madp-origin'), body });
    const url = new URL(req.url!, 'http://x');
    const p = url.pathname;
    if (p === '/api/v1/admin/members/duplicates') {
      const by = url.searchParams.get('by');
      if (!['email', 'phone', 'name_dob'].includes(by ?? '')) return err(400, 'invalid_value', 'by is email, phone or name_dob');
      return ok({ by, reason: 'Same e-mail address, ignoring capitals, dots and +tags', groups: 1, more: false, items: [{ reason: 'x', members: [row(A), row(B)] }] });
    }
    if (p === '/api/v1/admin/members/merge') {
      const dryRun = url.searchParams.get('dryRun') !== '0';
      const teen = body.keep === TEEN || body.duplicate === TEEN;
      const report = {
        dryRun,
        keep: row(body.keep), duplicate: row(body.duplicate),
        blockers: teen ? [{ code: 'teen_account', message: 'Teen accounts are never merged here.' }] : [],
        warnings: [],
        collections: { Response: { move: 3, stay: 1 }, Reward: { move: 2, stay: 0 } },
        referrals: 1,
        points: { keep: { earned: 100, available: 80 }, duplicate: { earned: 40, available: 40 } },
      };
      if (dryRun) return ok(report);
      if (teen) return err(409, 'teen_account', 'Teen accounts are never merged here.');
      if (String(body.reason ?? '').trim().length < 5) return err(400, 'reason_required', 'A reason is required');
      return ok({ ...report, mergeId: MERGE, moved: { Response: 3, Reward: 2 }, stayed: { Response: 1, Reward: 0 }, points: { ...report.points, keepAfter: { earned: 140, available: 120 } }, before: { duplicateStatus: 'active' }, after: { duplicateStatus: 'closed', mergedInto: body.keep } });
    }
    if (p === '/api/v1/admin/members/merges')
      return ok([{ id: MERGE, keep: A, duplicate: B, reason: 'Member confirmed both accounts', actor: null, moved: { Response: 3 }, stayed: {}, referrals: 1, createdAt: new Date().toISOString(), undoneAt: null, undoneBy: null }]);
    if (p === `/api/v1/admin/members/merges/${MERGE}/undo`) {
      const key = h('x-madp-origin');
      if (undone.has(key)) return err(409, 'already_undone', 'This merge was already undone');
      undone.add(key);
      return ok({ before: { duplicateStatus: 'closed' }, after: { duplicateStatus: 'active' }, movedBack: { Response: 3 } });
    }
    return err(404, 'not_found', 'Not found');
  });
  return { server, seen };
}

describe('duplicate members through the panel admin API', () => {
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
    tok.super = (await t.adminToken('super_admin', 'dup.super@example.invalid')).token;
    tok.support = (await t.adminToken('support_agent', 'dup.support@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });
  const audit = async (action: string, brand: string) =>
    (await sql.query('select target_id, reason, before, after, metadata from audit_event where action = $1 and panel = $2 order by id desc limit 1', [action, brand])).rows[0];

  it('finds duplicates, dry-runs, merges with a reason and undoes once, on every brand', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'] as const) {
      const found = await request(t.server).get('/api/v1/panel/duplicates?by=phone').set(bearer(tok.super!, brand)).expect(200);
      expect(found.body.items[0].members.map((m: { id: string }) => m.id)).toEqual([A, B]);
      expect((await audit('members.duplicates.search', brand)).metadata).toEqual({ by: 'phone', groups: 1, more: false });

      const dry = await request(t.server).post('/api/v1/panel/duplicates/merge').set(bearer(tok.super!, brand)).send({ keep: A, duplicate: B }).expect(201);
      expect(dry.body).toMatchObject({ dryRun: true, blockers: [] });
      expect(panel.seen.at(-1)!.url).toBe('/api/v1/admin/members/merge');
      expect((await audit('members.merge.dry_run', brand)).target_id).toBe(B);

      const done = await request(t.server).post('/api/v1/panel/duplicates/merge').set(bearer(tok.super!, brand)).send({ keep: A, duplicate: B, apply: true, reason: 'Member confirmed both accounts' }).expect(201);
      expect(done.body).toMatchObject({ dryRun: false, mergeId: MERGE });
      expect(panel.seen.at(-1)!.url).toBe('/api/v1/admin/members/merge?dryRun=0');
      const a = await audit('members.merge', brand);
      expect(a).toMatchObject({ target_id: B, reason: 'Member confirmed both accounts', after: { duplicateStatus: 'closed', mergedInto: A } });
      expect(a.metadata).toMatchObject({ keep: A, mergeId: MERGE, moved: { Response: 3, Reward: 2 } });
      expect(JSON.stringify(a)).not.toContain('example.invalid');

      const list = await request(t.server).get(`/api/v1/panel/duplicates/merges?member=${A}`).set(bearer(tok.super!, brand)).expect(200);
      expect(list.body.items[0]).toMatchObject({ id: MERGE });
      await request(t.server).post(`/api/v1/panel/duplicates/merges/${MERGE}/undo`).set(bearer(tok.super!, brand)).send({}).expect(400);
      await request(t.server).post(`/api/v1/panel/duplicates/merges/${MERGE}/undo`).set(bearer(tok.super!, brand)).send({ reason: 'Wrong pair, member has two people' }).expect(201);
      expect((await audit('members.merge.undo', brand)).reason).toBe('Wrong pair, member has two people');
      const again = await request(t.server).post(`/api/v1/panel/duplicates/merges/${MERGE}/undo`).set(bearer(tok.super!, brand)).send({ reason: 'Wrong pair, member has two people' }).expect(409);
      expect(again.body).toMatchObject({ code: 'already_undone' });
    }
  });

  it('refuses a merge without a reason or of one account with itself before asking the panel, and passes the teen refusal on', async () => {
    const before = panel.seen.length;
    await request(t.server).post('/api/v1/panel/duplicates/merge').set(bearer(tok.super!, 'mfr')).send({ keep: A, duplicate: B, apply: true }).expect(400);
    await request(t.server).post('/api/v1/panel/duplicates/merge').set(bearer(tok.super!, 'mfr')).send({ keep: A, duplicate: A }).expect(400);
    await request(t.server).post('/api/v1/panel/duplicates/merge').set(bearer(tok.super!, 'mfr')).send({ keep: A, duplicate: 'x' }).expect(400);
    await request(t.server).get('/api/v1/panel/duplicates?by=address').set(bearer(tok.super!, 'mfr')).expect(400);
    expect(panel.seen.length).toBe(before);
    const dry = await request(t.server).post('/api/v1/panel/duplicates/merge').set(bearer(tok.super!, 'mho')).send({ keep: A, duplicate: TEEN }).expect(201);
    expect(dry.body.blockers[0].code).toBe('teen_account');
    const r = await request(t.server).post('/api/v1/panel/duplicates/merge').set(bearer(tok.super!, 'mho')).send({ keep: A, duplicate: TEEN, apply: true, reason: 'Member confirmed both accounts' }).expect(409);
    expect(r.body).toMatchObject({ code: 'teen_account' });
  });

  it('needs members.status to merge or undo, and one brand', async () => {
    await request(t.server).get('/api/v1/panel/duplicates').set(bearer(tok.support!, 'mfr')).expect(200);
    await request(t.server).post('/api/v1/panel/duplicates/merge').set(bearer(tok.support!, 'mfr')).send({ keep: A, duplicate: B }).expect(403);
    await request(t.server).post(`/api/v1/panel/duplicates/merges/${MERGE}/undo`).set(bearer(tok.support!, 'mfr')).send({ reason: 'Wrong pair of accounts' }).expect(403);
    await request(t.server).get('/api/v1/panel/duplicates').set(bearer(tok.super!, 'all')).expect(400);
  });
});
