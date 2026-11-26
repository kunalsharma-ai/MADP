import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signPanelAdmin } from '@madp/connectors';
import { startTestApp } from './helpers.js';

/**
 * Member tags and notes, kept in MADP per brand, for T2O, MFR and MHO. A stand-in for the panel's admin API answers
 * the member page and the list; MADP adds the tags and filters by tag.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const bearer = (t: string, brand: string) => ({ authorization: `Bearer ${t}`, 'x-madp-brand': brand });
const A = 'a'.repeat(24);
const B = 'b'.repeat(24);
const TEEN = 'c'.repeat(24);

function fakePanel() {
  const read = (req: IncomingMessage) =>
    new Promise<string>((r) => {
      let s = '';
      req.on('data', (c) => (s += c));
      req.on('end', () => r(s));
    });
  const row = (id: string) => ({ id, name: `Demo ${id[0]}`, category: id === TEEN ? 'b2c minor' : 'b2c', segment: id === TEEN ? 'teen' : 'consumer', status: 'active', email: 'd***@example.invalid', qualityScore: 100, signedUpAt: new Date().toISOString(), lastActivityAt: null });
  const server: Server = createServer(async (req, res) => {
    const raw = await read(req);
    const h = (k: string) => String(req.headers[k] ?? '');
    const want = await signPanelAdmin(SECRET, { timestamp: h('x-madp-timestamp'), nonce: h('x-madp-nonce'), method: req.method!, path: req.url!, origin: h('x-madp-origin'), actor: h('x-madp-actor'), body: raw });
    const send = (status: number, body: unknown) => {
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (h('x-madp-signature') !== want) return send(401, { status: 'error', code: 'admin_auth', message: 'Bad signature' });
    const p = new URL(req.url!, 'http://x').pathname;
    if (p === '/api/v1/admin/members') return send(200, { status: 'success', data: { items: [row(A), row(B)], total: 2, page: 1, pageSize: 50, sort: null } });
    const m = /^\/api\/v1\/admin\/members\/([a-f0-9]{24})$/.exec(p);
    if (m && [A, B, TEEN].includes(m[1]!)) return send(200, { status: 'success', data: { ...row(m[1]!), fullName: 'Full Secret Name', city: 'boston' } });
    send(404, { status: 'error', code: 'not_found', message: 'Member not found' });
  });
  return { server };
}

describe('member tags and notes', () => {
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
    tok.manager = (await t.adminToken('panel_manager', 'tg.manager@example.invalid')).token;
    tok.manager2 = (await t.adminToken('panel_manager', 'tg.manager2@example.invalid')).token;
    tok.analyst = (await t.adminToken('read_only_analyst', 'tg.reader@example.invalid')).token;
  }, 120_000);
  afterAll(async () => {
    await sql?.end();
    await t?.stop();
    panel?.server.close();
  });

  const audit = async (action: string, brand: string) =>
    (await sql.query('select metadata from audit_event where action = $1 and panel = $2 order by id desc limit 1', [action, brand])).rows[0];

  it('tags members per brand, shows them on the list and filters by tag', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'] as const) {
      const r = await request(t.server).put(`/api/v1/panel/members/${A}/tags`).set(bearer(tok.manager!, brand)).send({ tags: ['VIP', 'check payout', 'vip'] }).expect(200);
      expect(r.body.tags).toEqual(['check payout', 'vip']);
      expect((await audit('members.tags_changed', brand)).metadata).toEqual({ added: ['vip', 'check payout'], removed: [] });
      await request(t.server).put(`/api/v1/panel/members/${B}/tags`).set(bearer(tok.manager!, brand)).send({ tags: ['vip'] }).expect(200);
      const list = await request(t.server).get('/api/v1/panel/members').set(bearer(tok.manager!, brand)).expect(200);
      expect(list.body.items.map((m: { tags: string[] }) => m.tags)).toEqual([['check payout', 'vip'], ['vip']]);
      const tagged = await request(t.server).get('/api/v1/panel/members?tag=check%20payout').set(bearer(tok.manager!, brand)).expect(200);
      expect(tagged.body.total).toBe(1);
      expect(tagged.body.items[0]).toMatchObject({ id: A, tags: ['check payout', 'vip'] });
      // Only list fields come through, never the member page's full name.
      expect(JSON.stringify(tagged.body)).not.toContain('Full Secret Name');
      const all = await request(t.server).get('/api/v1/member-tags').set(bearer(tok.manager!, brand)).expect(200);
      expect(all.body.tags).toEqual([{ tag: 'vip', members: 2 }, { tag: 'check payout', members: 1 }]);
    }
    // Removing a tag on one brand leaves the others alone.
    await request(t.server).put(`/api/v1/panel/members/${A}/tags`).set(bearer(tok.manager!, 'mfr')).send({ tags: ['vip'] }).expect(200);
    expect((await audit('members.tags_changed', 'mfr')).metadata).toEqual({ added: [], removed: ['check payout'] });
    const t2o = await request(t.server).get('/api/v1/panel/members?tag=check%20payout').set(bearer(tok.manager!, 't2o')).expect(200);
    expect(t2o.body.total).toBe(1);
  });

  it('notes: added, listed with author, reads audited, only the author deletes, text kept out of the audit', async () => {
    const add = await request(t.server).post(`/api/v1/panel/members/${A}/notes`).set(bearer(tok.manager!, 'mho')).send({ body: 'Called about a missing payout; resent.', pinned: true }).expect(201);
    await request(t.server).post(`/api/v1/panel/members/${A}/notes`).set(bearer(tok.manager2!, 'mho')).send({ body: 'Second note' }).expect(201);
    const r = await request(t.server).get(`/api/v1/panel/members/${A}/notes`).set(bearer(tok.manager2!, 'mho')).expect(200);
    expect(r.body.notes.map((n: { body: string; mine: boolean; pinned: boolean }) => [n.body, n.mine, n.pinned])).toEqual([
      ['Called about a missing payout; resent.', false, true],
      ['Second note', true, false],
    ]);
    expect((await audit('members.notes_read', 'mho')).metadata).toEqual({ notes: 2 });
    const added = await audit('members.note_added', 'mho');
    expect(JSON.stringify(added)).not.toContain('payout');
    await request(t.server).delete(`/api/v1/panel/members/${A}/notes/${add.body.id}`).set(bearer(tok.manager2!, 'mho')).expect(404);
    await request(t.server).delete(`/api/v1/panel/members/${A}/notes/${add.body.id}`).set(bearer(tok.manager!, 'mho')).expect(200);
    // Notes are per brand.
    expect((await request(t.server).get(`/api/v1/panel/members/${A}/notes`).set(bearer(tok.manager!, 't2o')).expect(200)).body.notes).toEqual([]);
  });

  it('checks permissions, the member, input and teen access', async () => {
    await request(t.server).put(`/api/v1/panel/members/${A}/tags`).set(bearer(tok.analyst!, 'mfr')).send({ tags: ['x'] }).expect(403);
    await request(t.server).put(`/api/v1/panel/members/${'d'.repeat(24)}/tags`).set(bearer(tok.manager!, 'mfr')).send({ tags: ['x'] }).expect(404);
    await request(t.server).put(`/api/v1/panel/members/${A}/tags`).set(bearer(tok.manager!, 'mfr')).send({ tags: ['<script>'] }).expect(400);
    await request(t.server).put(`/api/v1/panel/members/${A}/tags`).set(bearer(tok.manager!, 'mfr')).send({ tags: Array.from({ length: 11 }, (_, i) => `t${i}`) }).expect(400);
    await request(t.server).post(`/api/v1/panel/members/${A}/notes`).set(bearer(tok.manager!, 'mfr')).send({ body: 'x' }).expect(400);
    // panel_manager has no teen access on the built-in role.
    await request(t.server).put(`/api/v1/panel/members/${TEEN}/tags`).set(bearer(tok.manager!, 'mfr')).send({ tags: ['x'] }).expect(403);
  });
});
