import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ContentBody } from '@madp/contracts';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Content and legal pages through MADP for T2O, MFR and MHO. A stand-in for the panel's /api/v1/admin/content
 * (kunalsharma-ai/MFR#64 app/admin/content.js) checks MADP's signature and keeps the same rules: legal keys are always
 * legal, a legal page publishes only from review and only by an admin who neither asked for review nor made the last
 * edit, and every publish is kept as a revision.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
type Draft = { title: string; body: unknown[]; state: string; updatedBy: string; updatedAt: number; reviewRequestedBy: string | null };
type Page = { id: string; origin: string; key: string; lang: string; kind: string; version: number; live: { title: string; body: unknown[]; version: number } | null; draft: Draft | null };

function fakePanel() {
  const pages: Page[] = [];
  const revisions: { page: string; version: number; title: string; body: unknown[]; publishedBy: string }[] = [];
  const actors: string[] = [];
  let n = 0;
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
    const actor = h('x-madp-actor');
    actors.push(actor);
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url!, 'http://x');
    const parts = url.pathname.replace('/api/v1/admin/content', '').split('/').filter(Boolean);
    const page = parts[0] ? pages.find((p) => p.id === parts[0] && p.origin === origin) : undefined;
    if (parts[0] && !page) return err(404, 'not_found', 'Page not found');
    if (!parts.length && req.method === 'GET') return ok(pages.filter((p) => p.origin === origin && (!url.searchParams.get('kind') || p.kind === url.searchParams.get('kind'))));
    if (!parts.length && req.method === 'POST') {
      if (!ContentBody.safeParse(body.body).success) return err(400, 'invalid_value', 'body is 1 to 400 blocks');
      const lang = body.lang ?? 'en';
      if (pages.some((p) => p.origin === origin && p.key === body.key && p.lang === lang)) return err(409, 'duplicate', `A ${body.key} page in ${lang} already exists`);
      const kind = ['privacy', 'terms', 'gdpr', 'cookies'].includes(body.key) ? 'legal' : (body.kind ?? 'page');
      const p: Page = { id: (++n).toString(16).padStart(24, 'c'), origin, key: body.key, lang, kind, version: 0, live: null, draft: { title: body.title, body: body.body, state: 'editing', updatedBy: actor, updatedAt: Date.now(), reviewRequestedBy: null } };
      pages.push(p);
      return ok({ id: p.id, before: null, after: p });
    }
    const p = page!;
    if (parts.length === 1 && req.method === 'GET') return ok(p);
    if (parts.length === 1 && req.method === 'PUT') {
      const before = p.draft;
      p.draft = { title: body.title ?? p.draft?.title ?? p.live!.title, body: body.body ?? p.draft?.body ?? p.live!.body, state: 'editing', updatedBy: actor, updatedAt: Date.now(), reviewRequestedBy: null };
      return ok({ before: before && { title: before.title, state: before.state }, after: { title: p.draft.title, state: 'editing' } });
    }
    if (parts[1] === 'revisions' && parts.length === 2) return ok(revisions.filter((r) => r.page === p.id).map(({ body: _b, ...r }) => r));
    if (parts[1] === 'revisions' && parts[3] === 'restore') {
      const r = revisions.find((x) => x.page === p.id && x.version === Number(parts[2]));
      if (!r) return err(404, 'not_found', 'Version not found');
      p.draft = { title: r.title, body: r.body, state: 'editing', updatedBy: actor, updatedAt: Date.now(), reviewRequestedBy: null };
      return ok({ before: null, after: { title: r.title, state: 'editing', basedOn: r.version } });
    }
    const action = parts[1];
    const d = p.draft;
    if (!d) return err(409, 'no_draft', `There is no draft to ${action}`);
    if (action === 'discard') return (p.draft = null), ok({ before: { state: d.state }, after: { state: null }, key: p.key, lang: p.lang });
    if (action === 'review') {
      if (d.state !== 'editing') return err(409, 'bad_transition', 'This draft is already in review');
      d.state = 'review';
      d.reviewRequestedBy = actor;
      return ok({ before: { state: 'editing' }, after: { state: 'review' }, key: p.key, lang: p.lang });
    }
    if (p.kind === 'legal') {
      if (d.state !== 'review') return err(409, 'bad_transition', 'A legal page is published from review. Ask for review first.');
      if (actor === d.reviewRequestedBy || actor === d.updatedBy) return err(409, 'four_eyes', 'A second admin, who did not edit this draft, must publish a legal page');
    }
    p.version += 1;
    p.live = { title: d.title, body: d.body, version: p.version };
    p.draft = null;
    revisions.push({ page: p.id, version: p.version, title: d.title, body: d.body, publishedBy: actor });
    return ok({ before: { version: p.version - 1, state: d.state }, after: { version: p.version, state: 'published' }, key: p.key, lang: p.lang });
  });
  return { server, pages, actors };
}

const BODY = [
  { h2: 'What we collect' },
  'Your answers to surveys and the profile you fill in. Write to support@example.invalid with questions.',
  { ul: ['Answers', 'Profile'] },
  { table: { head: ['Data', 'Kept for'], rows: [['Answers', '3 years'], ['Profile', 'While you are a member']] } },
];

describe('content and legal pages through the panel admin API', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let panel: ReturnType<typeof fakePanel>;
  let sql: pg.Client;
  const tok: Record<string, string> = {};
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    panel = fakePanel();
    await new Promise<void>((r) => panel.server.listen(0, '127.0.0.1', () => r()));
    const base = `http://127.0.0.1:${(panel.server.address() as AddressInfo).port}`;
    t = await startTestApp({ PANEL_ADMIN_API_SECRET: SECRET, T2O_ADMIN_API_BASE_URL: base, MFR_ADMIN_API_BASE_URL: base, MHO_ADMIN_API_BASE_URL: base });
    sql = new pg.Client({ connectionString: t.dbUrl });
    await sql.connect();
    const a = await t.adminToken('brand_admin', 'editor.content@example.invalid');
    const b = await t.adminToken('super_admin');
    tok.editor = a.token;
    tok.second = b.token;
    tok.manager = (await t.adminToken('panel_manager', 'pm.content@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });
  const audit = async (action: string, brand: string) =>
    (await sql.query('select actor_id, before, after, metadata from audit_event where action = $1 and panel = $2 order by id', [action, brand])).rows;

  for (const brand of ['t2o', 'mfr', 'mho'] as const)
    it(`${brand}: a legal page needs a second admin to publish, and every step is audited`, async () => {
      const c = await request(t.server).post('/api/v1/panel/content').set(bearer(tok.editor!, brand)).send({ key: 'privacy', kind: 'page', title: 'Privacy policy', body: BODY }).expect(201);
      const id = (ids[brand] = c.body.id);
      expect(c.body.after.kind).toBe('legal'); // privacy is legal whatever kind is sent
      await request(t.server).post(`/api/v1/panel/content/${id}/publish`).set(bearer(tok.second!, brand)).expect(409);
      await request(t.server).post(`/api/v1/panel/content/${id}/review`).set(bearer(tok.editor!, brand)).expect(200);
      const own = await request(t.server).post(`/api/v1/panel/content/${id}/publish`).set(bearer(tok.editor!, brand)).expect(409);
      expect(own.body.code).toBe('four_eyes');
      const pub = await request(t.server).post(`/api/v1/panel/content/${id}/publish`).set(bearer(tok.second!, brand)).expect(200);
      expect(pub.body.after).toEqual({ version: 1, state: 'published' });
      const page = panel.pages.find((p) => p.id === id)!;
      expect(page.origin).toContain(brand === 't2o' ? 'turn2opinion' : brand === 'mfr' ? 'myfrequentrewards' : 'myhealthopinions');
      expect(page.live!.body).toEqual(BODY);
      // The admin's own MADP id is the actor the panel compares.
      const me = await request(t.server).get('/api/v1/auth/me').set(bearer(tok.second!, brand)).expect(200);
      const [published] = await audit('content.page.publish', brand);
      expect(published.actor_id).toBe(me.body.id);
      expect(published.metadata).toMatchObject({ key: 'privacy', lang: 'en' });
      expect((await audit('content.page.create', brand))[0].after).toMatchObject({ key: 'privacy', kind: 'legal' });
      expect((await audit('content.page.review', brand)).length).toBe(1);
    });

  it('edits, history and restore go through the same draft', async () => {
    const id = ids.mfr!;
    const r = request(t.server);
    await r.put(`/api/v1/panel/content/${id}`).set(bearer(tok.editor!, 'mfr')).send({ title: 'Privacy policy (2027)' }).expect(200);
    const revs = await r.get(`/api/v1/panel/content/${id}/revisions`).set(bearer(tok.editor!, 'mfr')).expect(200);
    expect(revs.body).toEqual([expect.objectContaining({ version: 1, title: 'Privacy policy' })]);
    const back = await r.post(`/api/v1/panel/content/${id}/revisions/1/restore`).set(bearer(tok.editor!, 'mfr')).expect(200);
    expect(back.body.after).toMatchObject({ basedOn: 1, state: 'editing' });
    await r.post(`/api/v1/panel/content/${id}/discard`).set(bearer(tok.editor!, 'mfr')).expect(200);
    const update = await audit('content.page.update', 'mfr');
    expect(update[0].after).toMatchObject({ title: 'Privacy policy (2027)' });
    expect((await audit('content.page.restore', 'mfr'))[0].metadata).toEqual({ version: 1 });
  });

  it('an ordinary page publishes without review', async () => {
    const c = await request(t.server).post('/api/v1/panel/content').set(bearer(tok.editor!, 'mho')).send({ key: 'about-us', title: 'About us', body: ['Who we are.'] }).expect(201);
    await request(t.server).post(`/api/v1/panel/content/${c.body.id}/publish`).set(bearer(tok.editor!, 'mho')).expect(200);
    const list = await request(t.server).get('/api/v1/panel/content?kind=page').set(bearer(tok.editor!, 'mho')).expect(200);
    expect(list.body.map((p: { key: string }) => p.key)).toEqual(['about-us']);
  });

  it('refuses HTML, unknown blocks and bad keys before anything reaches the panel', async () => {
    const before = panel.actors.length;
    const send = (b: object) => request(t.server).post('/api/v1/panel/content').set(bearer(tok.editor!, 'mfr')).send(b);
    await send({ key: 'terms', title: 'Terms', body: [{ script: 'x' }] }).expect(400);
    await send({ key: 'terms', title: 'Terms', body: [{ h2: 'a', h3: 'b' }] }).expect(400);
    await send({ key: 'terms', title: 'Terms', body: [{ table: { head: ['a', 'b'], rows: [['1']] } }] }).expect(400);
    await send({ key: 'Terms!', title: 'Terms', body: ['x'] }).expect(400);
    await send({ key: 'terms', title: 'Terms', body: [] }).expect(400);
    await request(t.server).put(`/api/v1/panel/content/${ids.mfr}`).set(bearer(tok.editor!, 'mfr')).send({}).expect(400);
    await request(t.server).post(`/api/v1/panel/content/${ids.mfr}/delete`).set(bearer(tok.editor!, 'mfr')).expect(400);
    await request(t.server).get('/api/v1/panel/content/not-an-id').set(bearer(tok.editor!, 'mfr')).expect(400);
    expect(panel.actors.length).toBe(before);
  });

  it('needs content.manage and one brand, and a brand only sees its own pages', async () => {
    await request(t.server).get('/api/v1/panel/content').set(bearer(tok.manager!, 'mfr')).expect(403);
    await request(t.server).get('/api/v1/panel/content').set(bearer(tok.editor!, 'all')).expect(400);
    await request(t.server).get(`/api/v1/panel/content/${ids.mfr}`).set(bearer(tok.editor!, 't2o')).expect(404);
  });
});
