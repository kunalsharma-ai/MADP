import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import pg from 'pg';
import request from 'supertest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Questionnaire builder (spec screens 11 and 12) through MADP, for all three brands. A stand-in for the panel's
 * /api/admin/v1 checks MADP's signature like the real one and keeps a small DEMO profile per brand in memory, so the
 * apply step's writes can be checked.
 */
type T = Awaited<ReturnType<typeof startTestApp>>;
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const PROFILE_ID = 'cccccccccccccccccccccccc';
const PANELS = ['t2o', 'mfr', 'mho'] as const;

interface Seen {
  method: string;
  path: string;
  origin: string;
  body: unknown;
}
type Q = { name: string; label: string; type: string; parent?: string; isRequired?: boolean; category: string[]; topic?: string };
type O = { question: string; value: string; label: string; parentValue: string[]; sortOrder: number };

function bank() {
  const questions: Q[] = [
    { name: 'owns-car', label: 'Do you own a car?', type: 'radio', category: ['b2c'] },
    { name: 'car-brand', label: 'Which brand?', type: 'select', category: ['b2c'] },
    { name: 'car-km', label: 'Kilometres a year', type: 'number', category: ['b2c'] },
    { name: 'pets', label: 'Pets', type: 'checkbox', category: ['b2c'] },
  ];
  const options: O[] = [
    { question: 'owns-car', value: 'yes', label: 'Yes', parentValue: [], sortOrder: 1 },
    { question: 'owns-car', value: 'no', label: 'No', parentValue: [], sortOrder: 2 },
    { question: 'car-brand', value: 'a', label: 'Brand A', parentValue: [], sortOrder: 1 },
    { question: 'car-brand', value: 'b', label: 'Brand B', parentValue: [], sortOrder: 2 },
    { question: 'pets', value: 'dog', label: 'Dog', parentValue: [], sortOrder: 1 },
  ];
  const profile = { slug: 'demo-auto', category: 'b2c', name: 'demo auto', isActive: true, pages: [['Car', 'owns-car', 'car-brand', 'car-km']] };
  return { questions, options, profile };
}

function fakePanel() {
  const seen: Seen[] = [];
  const state = new Map<string, ReturnType<typeof bank>>();
  const of = (origin: string) => {
    if (!state.has(origin)) state.set(origin, bank());
    return state.get(origin)!;
  };
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
    if (h('x-madp-signature') !== want) return send(401, { status: 'error', code: 'admin_auth', message: 'Bad signature' });
    const body = raw ? JSON.parse(raw) : undefined;
    const origin = h('x-madp-origin');
    seen.push({ method: req.method!, path: req.url!, origin, body });
    const ok = (data: unknown) => send(200, { status: 'success', data });
    const b = of(origin);
    const p = new URL(req.url!, 'http://x').pathname;
    if (p === '/api/admin/v1/profiles' && req.method === 'GET')
      return ok([{ id: PROFILE_ID, slug: b.profile.slug, category: b.profile.category, name: b.profile.name, questions: 3 }]);
    if (p === '/api/admin/v1/qb/export')
      return ok({ exportedAt: '2026-11-24T00:00:00Z', Profile: [b.profile], Question: b.questions, Option: b.options });
    const qm = p.match(/^\/api\/admin\/v1\/questions\/([^/]+)(\/options)?$/);
    if (qm) {
      const q = b.questions.find((x) => x.name === decodeURIComponent(qm[1]!));
      if (!q) return send(404, { status: 'error', code: 'not_found', message: 'Question not found' });
      if (req.method === 'GET') return ok({ ...q, options: b.options.filter((o) => o.question === q.name) });
      if (qm[2]) {
        const before = b.options.filter((o) => o.question === q.name).map((o) => o.value);
        b.options = [
          ...b.options.filter((o) => o.question !== q.name),
          ...body.options.map((o: O, i: number) => ({ ...o, question: q.name, sortOrder: i + 1 })),
        ];
        return ok({ before: { options: before }, after: { options: body.options.map((o: O) => o.value) } });
      }
      Object.assign(q, body);
      return ok({ before: {}, after: body });
    }
    if (p === `/api/admin/v1/profiles/${PROFILE_ID}` && req.method === 'PUT') {
      const before = b.profile.pages;
      b.profile.pages = body.pages;
      return ok({ before: { pages: before }, after: { pages: body.pages } });
    }
    if (p === '/api/admin/v1/qb/versions' && req.method === 'POST') return ok({ number: 7, status: 'draft' });
    if (p === '/api/admin/v1/qb/versions/7/review') return ok({ before: { status: 'draft' }, after: { status: 'review' } });
    return send(404, { status: 'error', code: 'not_found', message: 'Not found' });
  });
  return { server, seen, state };
}

describe('questionnaire builder: draft, second-admin approval, apply', () => {
  let t: T;
  let panel: ReturnType<typeof fakePanel>;
  let sql: pg.Client;
  let author: string;
  let reviewer: string;
  let analyst: string;
  const auth = (tok: string, brand: string) => ({ authorization: `Bearer ${tok}`, 'x-madp-brand': brand });

  beforeAll(async () => {
    panel = fakePanel();
    await new Promise<void>((r) => panel.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(panel.server.address() as AddressInfo).port}`;
    t = await startTestApp({
      PANEL_ADMIN_API_SECRET: SECRET,
      T2O_ADMIN_API_BASE_URL: base,
      MFR_ADMIN_API_BASE_URL: base,
      MHO_ADMIN_API_BASE_URL: base,
    });
    sql = new pg.Client({ connectionString: t.dbUrl });
    await sql.connect();
    author = (await t.adminToken('question_bank_editor', 'qb-author@example.invalid', [...PANELS])).token;
    reviewer = (await t.adminToken('question_bank_editor', 'qb-reviewer@example.invalid', [...PANELS])).token;
    analyst = (await t.adminToken('read_only_analyst', 'qb-analyst@example.invalid', [...PANELS])).token;
  }, 120_000);

  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  describe.each(PANELS)('%s', (brand) => {
    let id: string;

    it('reads the profile from the panel and starts a draft that changes nothing yet', async () => {
      const src = await request(t.server).get('/api/v1/questionnaires/source?category=b2c&slug=demo-auto').set(auth(analyst, brand)).expect(200);
      expect(src.body.pages).toEqual([{ title: 'Car', questions: ['owns-car', 'car-brand', 'car-km'] }]);
      expect(src.body.bank.map((q: { name: string }) => q.name)).toEqual(['pets']);
      await request(t.server).post('/api/v1/questionnaires/drafts').set(auth(analyst, brand)).send({ category: 'b2c', slug: 'demo-auto' }).expect(403);
      const d = await request(t.server).post('/api/v1/questionnaires/drafts').set(auth(author, brand)).send({ category: 'b2c', slug: 'demo-auto' }).expect(201);
      id = d.body.id;
      expect(d.body).toMatchObject({ status: 'draft', changes: 0, errors: 0, panel: brand });
      // One open draft per profile.
      await request(t.server).post('/api/v1/questionnaires/drafts').set(auth(reviewer, brand)).send({ category: 'b2c', slug: 'demo-auto' }).expect(409);
      await request(t.server).post(`/api/v1/questionnaires/drafts/${id}/submit`).set(auth(author, brand)).expect(400);
    });

    it('checks the logic and refuses to submit a draft with errors', async () => {
      const bad = await request(t.server)
        .put(`/api/v1/questionnaires/drafts/${id}`)
        .set(auth(author, brand))
        .send({
          spec: {
            pages: [{ title: 'Car', questions: ['owns-car', 'car-brand', 'car-km'] }],
            rules: { 'car-km': { parent: 'owns-car', values: ['yes'] } },
          },
        })
        .expect(200);
      expect(bad.body.problems.map((p: { code: string }) => p.code)).toContain('typed_values');
      const r = await request(t.server).post(`/api/v1/questionnaires/drafts/${id}/submit`).set(auth(author, brand)).expect(400);
      expect(r.body.code).toBe('draft_errors');
    });

    it('adds a bank question, sets show logic, and nothing reaches the panel before approval', async () => {
      const mark = panel.seen.length;
      const d = await request(t.server)
        .put(`/api/v1/questionnaires/drafts/${id}`)
        .set(auth(author, brand))
        .send({
          note: 'Ask the brand only of car owners',
          spec: {
            pages: [
              { title: 'Car', questions: ['owns-car', 'car-brand', 'car-km'] },
              { title: 'Pets', questions: ['pets'] },
            ],
            rules: { 'car-brand': { parent: 'owns-car', values: ['yes'] }, 'car-km': { parent: 'owns-car', values: [] } },
            required: { 'car-km': false },
          },
        })
        .expect(200);
      expect(d.body.errors).toBe(0);
      expect(d.body.base.questions.pets.options.map((o: { value: string }) => o.value)).toEqual(['dog']);
      expect(d.body.writes.map((w: { kind: string; target: string }) => `${w.kind}:${w.target}`)).toEqual([
        'question:car-brand',
        'options:car-brand',
        'question:car-km',
        'profile_pages:demo-auto',
      ]);
      const sub = await request(t.server).post(`/api/v1/questionnaires/drafts/${id}/submit`).set(auth(author, brand)).expect(201);
      expect(sub.body.status).toBe('review');
      await request(t.server).put(`/api/v1/questionnaires/drafts/${id}`).set(auth(author, brand)).send({ spec: d.body.spec }).expect(409);
      await request(t.server).post(`/api/v1/questionnaires/drafts/${id}/apply`).set(auth(reviewer, brand)).expect(409);
      expect(panel.seen.slice(mark).filter((s) => s.method !== 'GET')).toEqual([]);
    });

    it('needs a second admin to approve, then applies in order and opens a panel version for review', async () => {
      const seenBefore = panel.seen.length;
      const own = await request(t.server).post(`/api/v1/questionnaires/drafts/${id}/review`).set(auth(author, brand)).send({ decision: 'approve' }).expect(403);
      expect(own.body.code ?? own.body.message).toBeTruthy();
      await request(t.server).post(`/api/v1/questionnaires/drafts/${id}/review`).set(auth(analyst, brand)).send({ decision: 'approve' }).expect(403);
      expect(panel.seen.slice(seenBefore).filter((s) => s.method !== 'GET')).toEqual([]);
      const ok = await request(t.server).post(`/api/v1/questionnaires/drafts/${id}/review`).set(auth(reviewer, brand)).send({ decision: 'approve', note: 'Looks right' }).expect(201);
      expect(ok.body.status).toBe('approved');

      const applied = await request(t.server).post(`/api/v1/questionnaires/drafts/${id}/apply`).set(auth(reviewer, brand)).expect(201);
      expect(applied.body.ok).toBe(true);
      expect(applied.body.applyResult.panelVersion).toBe(7);
      const writes = panel.seen.slice(seenBefore).filter((s) => s.method !== 'GET');
      const origin = writes[0]!.origin;
      expect(writes.every((w) => w.origin === origin)).toBe(true);
      expect(writes.map((w) => `${w.method} ${w.path}`)).toEqual([
        'PUT /api/admin/v1/questions/car-brand',
        'PUT /api/admin/v1/questions/car-brand/options',
        'PUT /api/admin/v1/questions/car-km',
        `PUT /api/admin/v1/profiles/${PROFILE_ID}`,
        'POST /api/admin/v1/qb/versions',
        'POST /api/admin/v1/qb/versions/7/review',
      ]);
      expect(writes[0]!.body).toEqual({ parent: 'owns-car' });
      expect(writes[1]!.body).toEqual({
        options: [
          { value: 'a', label: 'Brand A', parentValue: ['yes'] },
          { value: 'b', label: 'Brand B', parentValue: ['yes'] },
        ],
      });
      expect(writes[2]!.body).toEqual({ parent: 'owns-car', isRequired: false });
      expect(writes[3]!.body).toEqual({ pages: [['Car', 'owns-car', 'car-brand', 'car-km'], ['Pets', 'pets']] });
      // The panel now has the logic MADP previewed.
      const b = panel.state.get(origin)!;
      expect(b.questions.find((q) => q.name === 'car-brand')!.parent).toBe('owns-car');
      expect(b.options.filter((o) => o.question === 'car-brand').every((o) => o.parentValue.join() === 'yes')).toBe(true);

      const done = await request(t.server).get(`/api/v1/questionnaires/drafts/${id}`).set(auth(analyst, brand)).expect(200);
      expect(done.body.status).toBe('applied');
      const audit = (await sql.query("select action from audit_event where target_id = $1 order by id", [id])).rows.map((r) => r.action);
      expect(audit).toEqual(
        expect.arrayContaining([
          'questionnaire.draft.create',
          'questionnaire.draft.update',
          'questionnaire.draft.submit',
          'questionnaire.draft.approve',
          'questionnaire.draft.apply',
        ]),
      );
    });

    it('refuses to apply over a profile that changed on the panel since the draft started', async () => {
      const d = await request(t.server).post('/api/v1/questionnaires/drafts').set(auth(author, brand)).send({ category: 'b2c', slug: 'demo-auto' }).expect(201);
      const spec = { ...d.body.spec, required: { pets: false } };
      await request(t.server).put(`/api/v1/questionnaires/drafts/${d.body.id}`).set(auth(author, brand)).send({ spec }).expect(200);
      await request(t.server).post(`/api/v1/questionnaires/drafts/${d.body.id}/submit`).set(auth(author, brand)).expect(201);
      await request(t.server).post(`/api/v1/questionnaires/drafts/${d.body.id}/review`).set(auth(reviewer, brand)).send({ decision: 'approve' }).expect(201);
      // Someone edits the question on the panel directly in the meantime.
      const origin = panel.seen.filter((s) => s.path.startsWith('/api/admin/v1/profiles')).at(-1)!.origin;
      panel.state.get(origin)!.questions.find((q) => q.name === 'pets')!.label = 'Pets at home';
      const r = await request(t.server).post(`/api/v1/questionnaires/drafts/${d.body.id}/apply`).set(auth(reviewer, brand)).expect(409);
      expect(r.body.code).toBe('profile_changed');
      await request(t.server).post(`/api/v1/questionnaires/drafts/${d.body.id}/discard`).set(auth(author, brand)).expect(201);
    });
  });

  it('keeps each brand on its own panel hostname and its own drafts', async () => {
    const origins = new Set(panel.seen.map((s) => s.origin));
    expect(origins.size).toBe(3);
    for (const brand of PANELS) {
      const list = await request(t.server).get('/api/v1/questionnaires/drafts').set(auth(analyst, brand)).expect(200);
      expect(list.body.every((d: { panel: string }) => d.panel === brand)).toBe(true);
      expect(list.body.map((d: { status: string }) => d.status).sort()).toEqual(['applied', 'discarded']);
    }
    await request(t.server).get('/api/v1/questionnaires/drafts').set({ authorization: `Bearer ${analyst}` }).expect(400);
  });
});
