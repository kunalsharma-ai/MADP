import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import pg from 'pg';
import request from 'supertest';
import type * as OTPAuth from 'otpauth';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { PanelAdminService } from '../src/panel-admin/panel-admin.service.js';
import { startTestApp } from './helpers.js';

const TOKEN = 'demo-integration-token-0000-abcd';
const SECRET = 'demo-admin-secret-0000000000-wxyz';

/**
 * Panel connections are set in the console: Super Admin only, an authenticator code on every change, four eyes when
 * a second Super Admin exists, and tokens never returned or audited.
 */
describe('panel connections', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let fake: Server;
  let fakeUrl: string;
  let seenAuth: string | undefined;
  let db: pg.Client;
  let boss: { token: string; totp: OTPAuth.TOTP | null };

  /** A code for the next step-up. Tests run faster than 30 seconds, so the last used step is cleared first. */
  async function code(totp: OTPAuth.TOTP | null) {
    await db.query('update admin_user set totp_last_step = null');
    return totp!.generate();
  }

  beforeAll(async () => {
    fake = createServer((req, res) => {
      seenAuth = req.headers.authorization;
      const ok = req.headers.authorization === `Bearer ${TOKEN}`;
      res.writeHead(ok ? 200 : 401, { 'content-type': 'application/json' });
      res.end(ok ? '{"status":"success","data":[]}' : '{"status":"error","message":"no"}');
    });
    await new Promise<void>((r) => fake.listen(0, '127.0.0.1', r));
    fakeUrl = `http://127.0.0.1:${(fake.address() as AddressInfo).port}`;
    t = await startTestApp();
    db = new pg.Client({ connectionString: t.dbUrl });
    await db.connect();
    boss = await t.adminToken('super_admin', 'boss@example.invalid');
  }, 120_000);

  afterAll(async () => {
    await db?.end();
    await t?.stop();
    fake?.close();
  });

  it('lists all three panels on DEMO with nothing set', async () => {
    const r = await request(t.server)
      .get('/api/v1/panel-connections')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    expect(r.body.panels.map((p: { panel: string }) => p.panel)).toEqual(['t2o', 'mfr', 'mho']);
    for (const p of r.body.panels) {
      expect(p.dataMode).toBe('demo');
      expect(p.syncToken).toEqual({ set: false, hint: null, source: 'none' });
      expect(p.canChange).toBe(true);
    }
  });

  it('refuses a Brand Admin and a wrong authenticator code', async () => {
    const ba = await t.adminToken('brand_admin', 'ba@example.invalid');
    await request(t.server)
      .put('/api/v1/panel-connections/mfr')
      .set('authorization', `Bearer ${ba.token}`)
      .send({ syncBaseUrl: fakeUrl, reason: 'connect MFR', code: '123456' })
      .expect(403);
    await request(t.server)
      .put('/api/v1/panel-connections/mfr')
      .set('authorization', `Bearer ${boss.token}`)
      .send({ syncBaseUrl: fakeUrl, reason: 'connect MFR', code: '000000' })
      .expect(403);
    await request(t.server)
      .put('/api/v1/panel-connections/mfr')
      .set('authorization', `Bearer ${boss.token}`)
      .send({ syncBaseUrl: 'ftp://x.example', reason: 'connect MFR', code: '000000' })
      .expect(400);
  });

  it('tests the address and token, then a lone Super Admin connects MFR live without a restart', async () => {
    const bad = await request(t.server)
      .post('/api/v1/panel-connections/mfr/test')
      .set('authorization', `Bearer ${boss.token}`)
      .send({ syncBaseUrl: fakeUrl, syncToken: 'a-wrong-token-that-is-long-enough' })
      .expect(200);
    expect(bad.body.ok).toBe(false);
    const good = await request(t.server)
      .post('/api/v1/panel-connections/mfr/test')
      .set('authorization', `Bearer ${boss.token}`)
      .send({ syncBaseUrl: fakeUrl, syncToken: TOKEN })
      .expect(200);
    expect(good.body.ok).toBe(true);
    expect(seenAuth).toBe(`Bearer ${TOKEN}`);

    const r = await request(t.server)
      .put('/api/v1/panel-connections/mfr')
      .set('authorization', `Bearer ${boss.token}`)
      .send({
        syncBaseUrl: `${fakeUrl}/`,
        syncToken: TOKEN,
        adminBaseUrl: fakeUrl,
        adminSecret: SECRET,
        syncIntervalMinutes: 15,
        liveApproved: true,
        reason: 'Kunal connects MFR for the first real sync',
        code: await code(boss.totp),
      })
      .expect(200);
    expect(r.body.status).toBe('applied');

    const slot = t.app.get(ConnectorRegistry).get('mfr');
    expect(slot.dataMode).toBe('live');
    expect(t.app.get(ConnectorRegistry).connection('mfr').syncBaseUrl).toBe(fakeUrl);
    expect(t.app.get(PanelAdminService).configured('mfr')).toBe(true);
    expect(t.app.get(PanelAdminService).configured('t2o')).toBe(false);

    const list = await request(t.server)
      .get('/api/v1/panel-connections')
      .set('authorization', `Bearer ${boss.token}`)
      .expect(200);
    const raw = JSON.stringify(list.body);
    expect(raw).not.toContain(TOKEN);
    expect(raw).not.toContain(SECRET);
    const mfr = list.body.panels.find((p: { panel: string }) => p.panel === 'mfr');
    expect(mfr.syncToken).toEqual({ set: true, hint: '…abcd', source: 'console' });
    expect(mfr.adminSecret).toEqual({ set: true, hint: '…wxyz', source: 'console' });
    expect(mfr.liveApproved.value).toBe(true);
    expect(mfr.liveApproved.by).toBe('super_admin');
    expect(mfr.dataMode).toBe('live');
    expect(mfr.syncIntervalMinutes).toEqual({ value: 15, source: 'console' });
    // The other two panels are untouched.
    expect(list.body.panels.filter((p: { dataMode: string }) => p.dataMode === 'live')).toHaveLength(1);

    const stored = await db.query('select sync_token_enc, admin_secret_enc from panel_connection');
    expect(JSON.stringify(stored.rows)).not.toContain(TOKEN);
    const audit = await db.query("select * from audit_event where target_type = 'panel_connection'");
    const auditRaw = JSON.stringify(audit.rows);
    expect(auditRaw).not.toContain(TOKEN);
    expect(auditRaw).not.toContain(SECRET);
    expect(audit.rows.some((a) => a.action === 'connections.change.applied')).toBe(true);
  });

  it('with a second Super Admin, a change waits for that person', async () => {
    const other = await t.adminToken('super_admin', 'second@example.invalid');
    const r = await request(t.server)
      .put('/api/v1/panel-connections/mfr')
      .set('authorization', `Bearer ${boss.token}`)
      .send({ liveApproved: false, reason: 'pause MFR live reads', code: await code(boss.totp) })
      .expect(200);
    expect(r.body).toEqual({ status: 'pending', fields: ['liveApproved'] });
    expect(t.app.get(ConnectorRegistry).get('mfr').dataMode).toBe('live');

    await request(t.server)
      .put('/api/v1/panel-connections/mfr')
      .set('authorization', `Bearer ${other.token}`)
      .send({ syncIntervalMinutes: 5, reason: 'a second change', code: await code(other.totp) })
      .expect(409);
    await request(t.server)
      .post('/api/v1/panel-connections/mfr/decision')
      .set('authorization', `Bearer ${boss.token}`)
      .send({ decision: 'approve', reason: 'approving my own', code: await code(boss.totp) })
      .expect(403);
    const ok = await request(t.server)
      .post('/api/v1/panel-connections/mfr/decision')
      .set('authorization', `Bearer ${other.token}`)
      .send({ decision: 'approve', reason: 'checked with Kunal', code: await code(other.totp) })
      .expect(200);
    expect(ok.body.status).toBe('applied');
    expect(t.app.get(ConnectorRegistry).get('mfr').dataMode).toBe('demo');
  });
});
