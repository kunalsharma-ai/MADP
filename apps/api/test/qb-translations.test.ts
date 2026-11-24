import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { TEEN_BLOCKED_WORDS } from '@madp/contracts';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Question translations and the missing-translation report through MADP for T2O, MFR and MHO. A stand-in for the
 * panel's /api/admin/v1 (kunalsharma-ai/MFR app/admin/versions.js, teen check from MFR#66) checks MADP's signature and
 * keeps the same rules: options arrive as { value: label }, English is refused, and a question teens can see can't be
 * translated into wording the teen guardrail blocks (422 teen_guardrail, nothing saved).
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
type Q = { origin: string; name: string; label: string; category: string[]; translations: Record<string, { label?: string; description?: string }> };
type O = { origin: string; question: string; value: string; label: string; translations: Record<string, string> };

function fakePanel() {
  const questions: Q[] = [];
  const options: O[] = [];
  const bodies: unknown[] = [];
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
    const body = raw ? JSON.parse(raw) : {};
    const url = new URL(req.url!, 'http://x');
    const tr = /^\/api\/admin\/v1\/questions\/([^/]+)\/translations$/.exec(url.pathname);
    if (tr && req.method === 'PUT') {
      bodies.push(body);
      const { lang, label, description, options: opts } = body;
      if (!/^[a-z]{2}(-[A-Z]{2})?$/.test(lang ?? '') || lang === 'en') return err(400, 'invalid_value', 'lang is a language code other than en');
      const q = questions.find((x) => x.origin === origin && x.name === decodeURIComponent(tr[1]!));
      if (!q) return err(404, 'not_found', 'Question not found');
      if (q.category.some((c) => c.includes('minor'))) {
        const texts: [string, unknown][] = [['label', label], ['description', description], ...Object.entries(opts ?? {}).map(([v, t]) => [`option ${v}`, t] as [string, unknown])];
        for (const [where, t] of texts) {
          const m = typeof t === 'string' ? t.match(TEEN_BLOCKED_WORDS) : null;
          if (m) return err(422, 'teen_guardrail', `${q.name} is asked of teens, so its ${lang} ${where} can't mention "${m[0]}"`);
        }
      }
      const before = { label: q.translations[lang]?.label ?? null, description: q.translations[lang]?.description ?? null };
      q.translations[lang] = { ...q.translations[lang], ...(label !== undefined ? { label } : {}), ...(description !== undefined ? { description } : {}) };
      let optionsSet = 0;
      for (const [value, text] of Object.entries((opts ?? {}) as Record<string, string>))
        for (const o of options.filter((x) => x.origin === origin && x.question === q.name && x.value === value)) {
          o.translations[lang] = text;
          optionsSet++;
        }
      return ok({ before, after: { label: label ?? before.label, description: description ?? before.description }, optionsSet });
    }
    if (url.pathname === '/api/admin/v1/qb/translations/missing' && req.method === 'GET') {
      const lang = url.searchParams.get('lang')!;
      const cat = url.searchParams.get('category');
      const qs = questions.filter((q) => q.origin === origin && (!cat || q.category.includes(cat)));
      const items = qs
        .map((q) => ({
          name: q.name,
          label: q.label,
          missingLabel: !q.translations[lang]?.label,
          missingOptions: options.filter((o) => o.origin === origin && o.question === q.name && !o.translations[lang]).length,
        }))
        .filter((r) => r.missingLabel || r.missingOptions);
      return ok({ lang, questions: qs.length, complete: qs.length - items.length, missing: items.length, missingOptions: items.reduce((a, r) => a + r.missingOptions, 0), items });
    }
    return err(404, 'not_found', 'Not found');
  });
  return { server, questions, options, bodies };
}

const ORIGIN = { t2o: 'turn2opinion', mfr: 'myfrequentrewards', mho: 'myhealthopinions' } as const;

describe('question translations through the panel admin API', () => {
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
    tok.editor = (await t.adminToken('question_bank_editor', 'qb.translator@example.invalid')).token;
    tok.analyst = (await t.adminToken('read_only_analyst', 'qb.reader@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  it('sets wording and option labels for T2O, MFR and MHO, sending options as the panel’s { value: label } map', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'] as const) {
      // Seed under the origin MADP actually signs for this brand.
      const origin = await originOf(brand);
      panel.questions.push({ origin, name: 'gender', label: 'Gender', category: ['b2c'], translations: {} });
      panel.questions.push({ origin, name: 'teen-drinks', label: 'Favourite drink', category: ['b2c-minor'], translations: {} });
      for (const [value, label] of [['1', 'Male'], ['2', 'Female']]) panel.options.push({ origin, question: 'gender', value: value!, label: label!, translations: {} });
      const r = await request(t.server)
        .put('/api/v1/panel/questions/gender/translations')
        .set(bearer(tok.editor!, brand))
        .send({ lang: 'hi', label: 'लिंग', options: [{ value: '1', label: 'पुरुष' }, { value: '2', label: 'महिला' }] })
        .expect(200);
      expect(r.body).toMatchObject({ after: { label: 'लिंग' }, optionsSet: 2 });
      expect(panel.bodies.at(-1)).toEqual({ lang: 'hi', label: 'लिंग', options: { '1': 'पुरुष', '2': 'महिला' } });
      expect(panel.options.filter((x) => x.origin === origin).map((x) => x.translations.hi)).toEqual(['पुरुष', 'महिला']);
      const [a] = (await sql.query("select actor_id, before, after, metadata from audit_event where action = 'qb.translation.set' and panel = $1 order by id desc limit 1", [brand])).rows;
      expect(a.metadata).toEqual({ lang: 'hi', options: 2, optionsSet: 2 });
      expect(a.after).toMatchObject({ label: 'लिंग' });
    }
  });

  it('passes the panel’s teen guardrail refusal through as it is, with nothing saved', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'] as const) {
      const r = await request(t.server)
        .put('/api/v1/panel/questions/teen-drinks/translations')
        .set(bearer(tok.editor!, brand))
        .send({ lang: 'es', label: 'Bebida favorita', options: [{ value: '1', label: 'Wine' }] })
        .expect(422);
      expect(r.body).toMatchObject({ code: 'teen_guardrail' });
      expect(r.body.message).toContain('option 1 can\'t mention "Wine"');
      const q = panel.questions.find((x) => x.origin === (originCache[brand] ?? '') && x.name === 'teen-drinks')!;
      expect(q.translations.es).toBeUndefined();
    }
  });

  it('reports missing translations per language and segment', async () => {
    const r = await request(t.server).get('/api/v1/panel/qb/translations/missing?lang=hi&category=B2C').set(bearer(tok.analyst!, 'mfr')).expect(200);
    expect(r.body).toMatchObject({ lang: 'hi', questions: 1, missing: 0 });
    const all = await request(t.server).get('/api/v1/panel/qb/translations/missing?lang=es').set(bearer(tok.analyst!, 'mho')).expect(200);
    expect(all.body.items.map((i: { name: string }) => i.name).sort()).toEqual(['gender', 'teen-drinks']);
  });

  it('refuses English, bad codes and bad sizes before anything reaches the panel', async () => {
    const before = panel.bodies.length;
    const put = (b: object) => request(t.server).put('/api/v1/panel/questions/gender/translations').set(bearer(tok.editor!, 'mfr')).send(b);
    await put({ lang: 'en', label: 'Gender' }).expect(400);
    await put({ lang: 'hindi', label: 'x' }).expect(400);
    await put({ lang: 'hi', label: 'x'.repeat(501) }).expect(400);
    await put({ lang: 'hi', options: [{ value: '1', label: '' }] }).expect(400);
    await request(t.server).get('/api/v1/panel/qb/translations/missing?lang=en').set(bearer(tok.editor!, 'mfr')).expect(400);
    expect(panel.bodies.length).toBe(before);
  });

  it('needs qb.edit to write, qb.read to report, and one brand', async () => {
    await request(t.server).put('/api/v1/panel/questions/gender/translations').set(bearer(tok.analyst!, 'mfr')).send({ lang: 'hi', label: 'x' }).expect(403);
    await request(t.server).put('/api/v1/panel/questions/gender/translations').set(bearer(tok.editor!, 'all')).send({ lang: 'hi', label: 'x' }).expect(400);
  });

  const originCache: Record<string, string> = {};
  async function originOf(brand: 't2o' | 'mfr' | 'mho') {
    if (originCache[brand]) return originCache[brand]!;
    const seen = new Promise<string>((resolve) => panel.server.once('request', (req: IncomingMessage) => resolve(String(req.headers['x-madp-origin']))));
    await request(t.server).get('/api/v1/panel/qb/translations/missing?lang=fr').set(bearer(tok.editor!, brand));
    const o = await seen;
    expect(o).toContain(ORIGIN[brand]);
    return (originCache[brand] = o);
  }
});
