import { createServer, type IncomingMessage, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PANEL_ADMIN_ROUTES as R } from '@madp/connectors';
import { CORE_CAPABILITIES, createReferencePanel } from '@madp/panel-contract';
import { PanelAdminService } from '../src/panel-admin/panel-admin.service.js';
import { startTestApp } from './helpers.js';

const TOKEN = 'demo-contract-token-0000-abcd';
const SECRET = 'demo-contract-secret-000000-wxyz';

/** Serves a contract `fetch` function (the reference panel) over real HTTP, as MADP calls a panel. */
function serve(handler: typeof fetch): Promise<{ server: Server; url: string }> {
  const server = createServer(async (req: IncomingMessage, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers[k] = v;
    const body = Buffer.concat(chunks).toString('utf8');
    const answer = await handler(`http://${req.headers.host}${req.url}`, {
      method: req.method ?? 'GET',
      headers,
      ...(body ? { body } : {}),
    });
    res.writeHead(answer.status, {
      'content-type': answer.headers.get('content-type') ?? 'application/json',
    });
    res.end(await answer.text());
  });
  return new Promise((r) =>
    server.listen(0, '127.0.0.1', () =>
      r({ server, url: `http://127.0.0.1:${(server.address() as AddressInfo).port}` }),
    ),
  );
}

/**
 * The MADP Panel API Contract from the console: "Check contract" saves what the panel declares, MADP then calls only
 * those capabilities, and "Run conformance" runs the read-only kit, without personal data until live sync is approved.
 */
describe('panel API contract', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let db: pg.Client;
  let boss: { token: string; totp: { generate(): string } | null };
  const servers: Server[] = [];
  let origin: string;

  async function code() {
    await db.query('update admin_user set totp_last_step = null');
    return boss.totp!.generate();
  }

  beforeAll(async () => {
    t = await startTestApp();
    db = new pg.Client({ connectionString: t.dbUrl });
    await db.connect();
    boss = await t.adminToken('super_admin', 'contract-boss@example.invalid');
    const r = await db.query<{ origins: string[] }>(`select origins from brand_setting where panel = 't2o'`);
    origin = r.rows[0]!.origins[0]!;
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await t?.stop();
    for (const s of servers) s.close();
  });

  it('assumes the shared backend until checked, then calls only what the panel declares', async () => {
    const panel = await serve(
      createReferencePanel({
        brands: [origin],
        syncToken: TOKEN,
        adminSecret: SECRET,
        capabilities: [...CORE_CAPABILITIES, 'admin.members'],
      }),
    );
    servers.push(panel.server);
    await request(t.server)
      .put('/api/v1/panel-connections/t2o')
      .set('authorization', `Bearer ${boss.token}`)
      .send({
        syncBaseUrl: panel.url,
        syncToken: TOKEN,
        adminBaseUrl: panel.url,
        adminSecret: SECRET,
        reason: 'connect the reference panel',
        code: await code(),
      })
      .expect(200);

    const before = await request(t.server)
      .get('/api/v1/panel-connections')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    const t2o = before.body.panels.find((p: { panel: string }) => p.panel === 't2o');
    expect(t2o.contract.source).toBe('assumed');
    expect(t2o.contract.capabilities).toContain('admin.tickets');
    expect(t2o.contract.lastCheck).toBeNull();

    const check = await request(t.server)
      .post('/api/v1/panel-connections/t2o/contract-check')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    expect(check.body.ok).toBe(true);
    expect(check.body.version).toBe('1.0.0');
    expect(check.body.capabilities).toContain('admin.members');
    expect(check.body.capabilities).not.toContain('admin.tickets');

    const after = await request(t.server)
      .get('/api/v1/panel-connections')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    const c = after.body.panels.find((p: { panel: string }) => p.panel === 't2o').contract;
    expect(c.source).toBe('discovered');
    expect(c.implementation).toBe('madp-reference-panel');
    expect(c.brands).toEqual([origin]);
    expect(c.capabilities).not.toContain('admin.tickets');

    const svc = t.app.get(PanelAdminService);
    await expect(svc.call('t2o', 'a0000000-0000-4000-8000-000000000001', 'GET', R.members)).resolves.toEqual(
      [],
    );
    await expect(
      svc.call('t2o', 'a0000000-0000-4000-8000-000000000001', 'GET', R.tickets),
    ).rejects.toMatchObject({
      status: 501,
      response: { code: 'capability_not_supported', capability: 'admin.tickets' },
    });
    // a route outside the contract is a programming error, refused before anything is sent
    await expect(
      svc.call('t2o', 'a0000000-0000-4000-8000-000000000001', 'GET', '/api/v1/admin/invented'),
    ).rejects.toMatchObject({
      status: 500,
    });

    const audit = await db.query(
      `select metadata from audit_event where action = 'connections.contract.check' and panel = 't2o'`,
    );
    expect(audit.rows[0].metadata).toMatchObject({ ok: true, version: '1.0.0' });
  });

  it('runs the conformance kit without personal data until live sync is approved', async () => {
    const r = await request(t.server)
      .post('/api/v1/panel-connections/t2o/conformance')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    expect(r.body.conformant).toBe(true);
    expect(r.body.personalDataProbed).toBe(false);
    const byId = Object.fromEntries(
      r.body.results.map((x: { id: string; status: string }) => [x.id, x.status]),
    );
    expect(byId['auth.signed.replay']).toBe('pass');
    expect(byId['sync.question']).toBe('pass');
    expect(byId['sync.changesMembers']).toBe('skip');
    expect(byId['admin.members']).toBe('skip');
    expect(byId['admin.tickets']).toBe('skip');
    expect(JSON.stringify(r.body)).not.toContain('@example.invalid');
    const list = await request(t.server)
      .get('/api/v1/panel-connections')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    expect(
      list.body.panels.find((p: { panel: string }) => p.panel === 't2o').contract.conformance.conformant,
    ).toBe(true);
  });

  it('a panel without the discovery route stays on the shared backend capabilities', async () => {
    const legacy = await serve((async (u: URL | string) =>
      String(u).includes('/api/v1/contract')
        ? new Response(JSON.stringify({ status: 'error', message: 'Not found' }), { status: 404 })
        : new Response(JSON.stringify({ status: 'success', data: [] }), { status: 200 })) as typeof fetch);
    servers.push(legacy.server);
    await request(t.server)
      .put('/api/v1/panel-connections/mho')
      .set('authorization', `Bearer ${boss.token}`)
      .send({
        syncBaseUrl: legacy.url,
        syncToken: TOKEN,
        reason: 'connect a legacy panel',
        code: await code(),
      })
      .expect(200);
    const r = await request(t.server)
      .post('/api/v1/panel-connections/mho/contract-check')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    expect(r.body.ok).toBe(false);
    expect(r.body.message).toMatch(/does not serve GET \/api\/v1\/contract yet/);
    const list = await request(t.server)
      .get('/api/v1/panel-connections')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    const mho = list.body.panels.find((p: { panel: string }) => p.panel === 'mho').contract;
    expect(mho.source).toBe('assumed');
    expect(mho.capabilities).toContain('admin.members');
    expect(mho.lastCheck.ok).toBe(false);
  });

  it('a panel whose sync routes and admin API run on different backends declares the union of both', async () => {
    const r = await db.query<{ origins: string[] }>(`select origins from brand_setting where panel = 'mfr'`);
    const mfrOrigin = r.rows[0]!.origins[0]!;
    const sync = await serve(
      createReferencePanel({ brands: [mfrOrigin], syncToken: TOKEN, capabilities: [...CORE_CAPABILITIES] }),
    );
    const admin = await serve(
      createReferencePanel({
        brands: [mfrOrigin],
        adminSecret: SECRET,
        capabilities: ['contract.discovery', 'admin.members', 'admin.tickets'],
      }),
    );
    servers.push(sync.server, admin.server);
    await request(t.server)
      .put('/api/v1/panel-connections/mfr')
      .set('authorization', `Bearer ${boss.token}`)
      .send({
        syncBaseUrl: sync.url,
        syncToken: TOKEN,
        adminBaseUrl: admin.url,
        adminSecret: SECRET,
        reason: 'connect a split panel',
        code: await code(),
      })
      .expect(200);
    const check = await request(t.server)
      .post('/api/v1/panel-connections/mfr/contract-check')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    expect(check.body.ok).toBe(true);
    expect(check.body.capabilities).toEqual(
      expect.arrayContaining([...CORE_CAPABILITIES, 'admin.members', 'admin.tickets']),
    );
    expect(check.body.capabilities).not.toContain('admin.rewards');
    const conf = await request(t.server)
      .post('/api/v1/panel-connections/mfr/conformance')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    expect(conf.body.conformant).toBe(true);
    const ids = conf.body.results.map((x: { id: string }) => x.id);
    expect(ids).toContain('sync:sync.question');
    expect(ids).toContain('admin:auth.signed.replay');
  });

  it('only a Super Admin checks a contract or runs the kit', async () => {
    const ba = await t.adminToken('brand_admin', 'contract-ba@example.invalid');
    await request(t.server)
      .post('/api/v1/panel-connections/t2o/contract-check')
      .set('authorization', `Bearer ${ba.token}`)
      .expect(403);
    await request(t.server)
      .post('/api/v1/panel-connections/t2o/conformance')
      .set('authorization', `Bearer ${ba.token}`)
      .expect(403);
  });
});
