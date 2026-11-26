import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Gender, age and the Type column on the Members table, for T2O, MFR and MHO. A stand-in for the panel's
 * /api/v1/admin/members (kunalsharma-ai/MFR app/admin/members.js, MFR#103) answers only the question keys MADP asks
 * for, as the panel does. MHO answers are special-category: without health.sensitive.read MADP never asks for them.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
const ANSWERS: Record<string, Record<string, string[]>> = {
  b2c: { empstat: ['Employed full-time'] },
  b2b: { jobrole: ['Purchasing manager'] },
  'healthcare professional': { 'doc-expertise': ['Surgeons'], 'specialty-area': ['Orthopaedics'] },
  'care giver': { 'caregiving-situation': ['I provide paid/professional care as part of my work'] },
  patient: { 'primary-health-condition-currently': ['Asthma'] },
};
const CATS: Record<string, string[]> = {
  'www.turn2opinion.com': ['b2c', 'b2b'],
  'www.myfrequentrewards.com': ['b2c', 'b2b'],
  'www.myhealthopinions.com': ['healthcare professional', 'care giver', 'patient'],
};

function fakePanel() {
  const seen: URL[] = [];
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
    seen.push(u);
    if (u.pathname !== '/api/v1/admin/members') return send(404, { status: 'error', code: 'not_found', message: 'Not found' });
    const keys = (u.searchParams.get('typeQuestions') ?? '').split(',').filter(Boolean);
    const items = CATS[h('x-madp-origin')]!.map((category, i) => ({
      id: String(i + 1).repeat(24).slice(0, 24),
      name: `Demo ${i}`,
      category,
      segment: 'consumer',
      status: 'active',
      gender: i % 2 ? 'Male' : 'Female',
      age: 30 + i,
      birthYear: 1996 - i,
      qualityScore: 100,
      signedUpAt: new Date().toISOString(),
      lastActivityAt: null,
      ...(keys.length ? { types: Object.fromEntries(Object.entries(ANSWERS[category] ?? {}).filter(([k]) => keys.includes(k))) } : {}),
    }));
    const sort = u.searchParams.get('sort');
    send(200, { status: 'success', data: { items, total: items.length, page: 1, pageSize: 50, sort: sort ? { by: sort, dir: u.searchParams.get('dir') } : null } });
  });
  return { server, seen };
}

describe('Members table: gender, age and Type column', () => {
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
    tok.super = (await t.adminToken('super_admin', 'mt.super@example.invalid')).token;
    tok.manager = (await t.adminToken('panel_manager', 'mt.manager@example.invalid')).token;
    tok.analyst = (await t.adminToken('read_only_analyst', 'mt.reader@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string, brand: string) =>
    (await sql.query('select metadata from audit_event where action = $1 and panel = $2 order by id desc limit 1', [action, brand])).rows[0];

  it('shows gender, age and the type answers on T2O and MFR, with short words', async () => {
    for (const brand of ['t2o', 'mfr'] as const) {
      const r = await request(t.server).get('/api/v1/panel/members').set(bearer(tok.manager!, brand)).expect(200);
      expect(panel.seen.at(-1)!.searchParams.get('typeQuestions')).toBe('empstat,jobrole');
      const [c, b] = r.body.items;
      expect(c).toMatchObject({ gender: 'Female', age: 30, typeValues: [{ label: 'Work', values: ['Employed full-time'] }] });
      expect(b).toMatchObject({ gender: 'Male', age: 31, typeValues: [{ label: 'Designation', values: ['Purchasing manager'] }] });
      expect(c.types).toBeUndefined();
      expect(r.body.typesHidden).toBe(0);
      expect((await audit('members.search', brand)).metadata).toMatchObject({ typeAnswers: ['empstat', 'jobrole'], specialCategory: false });
    }
  });

  it('MHO answers need health access: never asked for without it, shown and audited with it', async () => {
    const no = await request(t.server).get('/api/v1/panel/members').set(bearer(tok.manager!, 'mho')).expect(200);
    expect(panel.seen.at(-1)!.searchParams.has('typeQuestions')).toBe(false);
    expect(no.body.typesHidden).toBe(4);
    expect(no.body.items.every((m: { typeValues: unknown[] }) => m.typeValues.length === 0)).toBe(true);
    const yes = await request(t.server).get('/api/v1/panel/members').set(bearer(tok.super!, 'mho')).expect(200);
    const [hcp, cg, pt] = yes.body.items;
    expect(hcp.typeValues).toEqual([
      { label: 'HCP type', values: ['Surgeons'] },
      { label: 'Specialty', values: ['Orthopaedics'] },
    ]);
    expect(cg.typeValues).toEqual([{ label: 'Caregiver type', values: ['Professional caregiver'] }]);
    expect(pt.typeValues).toEqual([{ label: 'Condition', values: ['Asthma'] }]);
    expect((await audit('members.search', 'mho')).metadata).toMatchObject({ specialCategory: true });
  });

  it('age sorts by date of birth the other way round, and gender and age filters reach the panel', async () => {
    const r = await request(t.server).get('/api/v1/panel/members?sort=age&dir=asc&gender=Male&ageMin=20&ageMax=40').set(bearer(tok.manager!, 'mfr')).expect(200);
    const q = panel.seen.at(-1)!.searchParams;
    expect([q.get('sort'), q.get('dir'), q.get('gender'), q.get('ageMin'), q.get('ageMax')]).toEqual(['born', 'desc', 'Male', '20', '40']);
    expect(r.body.sort).toEqual({ by: 'age', dir: 'asc' });
    await request(t.server).get('/api/v1/panel/members?gender=Unknown').set(bearer(tok.manager!, 'mfr')).expect(400);
  });

  it('type rules are edited per brand by segment managers, checked and audited', async () => {
    const d = await request(t.server).get('/api/v1/panel/members/type-columns').set(bearer(tok.manager!, 'mho')).expect(200);
    expect(d.body).toMatchObject({ saved: false, sensitivePanel: true });
    expect(d.body.rules.map((x: { label: string }) => x.label)).toEqual(['HCP type', 'Specialty', 'Caregiver type', 'Condition']);
    // The Segment filter lists MHO's own categories, not T2O's b2c and b2b.
    const values = d.body.categories.map((c: { value: string }) => c.value);
    expect(values).toEqual(expect.arrayContaining(['healthcare professional', 'patient', 'care giver']));
    expect(values).not.toContain('b2b');
    const rules = [{ category: 'b2b', label: 'Job level', questions: ['JobRole', 'experience'] }];
    await request(t.server).put('/api/v1/panel/members/type-columns').set(bearer(tok.analyst!, 't2o')).send({ rules }).expect(403);
    await request(t.server).put('/api/v1/panel/members/type-columns').set(bearer(tok.manager!, 't2o')).send({ rules: [{ ...rules[0], questions: ['bad key!'] }] }).expect(400);
    const many = Array.from({ length: 3 }, (_, i) => ({ category: `c${i}`, label: 'Too many', questions: [`a${i}`, `b${i}`, `c${i}`] }));
    await request(t.server).put('/api/v1/panel/members/type-columns').set(bearer(tok.manager!, 't2o')).send({ rules: many }).expect(400);
    await request(t.server).put('/api/v1/panel/members/type-columns').set(bearer(tok.manager!, 't2o')).send({ rules }).expect(200);
    expect((await audit('members.type_columns_changed', 't2o')).metadata.after).toEqual([{ category: 'b2b', label: 'Job level', questions: ['jobrole', 'experience'], sensitive: false }]);
    await request(t.server).get('/api/v1/panel/members').set(bearer(tok.manager!, 't2o')).expect(200);
    expect(panel.seen.at(-1)!.searchParams.get('typeQuestions')).toBe('jobrole,experience');
    // MFR still has its own defaults.
    await request(t.server).get('/api/v1/panel/members').set(bearer(tok.manager!, 'mfr')).expect(200);
    expect(panel.seen.at(-1)!.searchParams.get('typeQuestions')).toBe('empstat,jobrole');
  });
});
