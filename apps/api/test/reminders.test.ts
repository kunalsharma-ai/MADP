import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Database } from '../src/db/database.js';
import { startTestApp } from './helpers.js';

/**
 * Auto reminders and WhatsApp / SMS providers on T2O, MFR and MHO. A stand-in for the panel's admin API (MFR#105)
 * keeps settings per origin; MADP passes them through, audits every change, and never logs or returns a provider key.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
const KEY = 'sk_live_this-must-never-be-logged-9876';
let t: Awaited<ReturnType<typeof startTestApp>>;
let panel: Server;
const seen: { method: string; path: string; body: string }[] = [];
const tok: Record<string, string> = {};
const as = (who: string, brand: string) => ({ authorization: `Bearer ${tok[who]}`, 'x-madp-brand': brand });

const CASES = ['password', 'terms', 'no_profiles', 'partial', 'surveys', 'first_survey', 'redeem', 'streak'];
type State = {
  minGapDays: number;
  cases: Record<string, { enabled: boolean; everyDays: number; max: number }>;
  channels: Record<string, unknown>;
};
const state = new Map<string, State>();
const fresh = (): State => ({
  minGapDays: 3,
  cases: Object.fromEntries(CASES.map((k) => [k, { enabled: false, everyDays: 10, max: 3 }])),
  channels: {},
});

beforeAll(async () => {
  panel = createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      const u = new URL(req.url!, 'http://x');
      const origin = String(req.headers['x-madp-origin'] ?? '');
      seen.push({ method: req.method!, path: u.pathname, body: raw });
      const s = state.get(origin) ?? fresh();
      state.set(origin, s);
      const send = (body: unknown, status = 200) => {
        res.writeHead(status, { 'content-type': 'application/json' });
        res.end(JSON.stringify(status < 300 ? { status: 'success', data: body } : body));
      };
      const view = () => ({
        saved: true,
        minGapDays: s.minGapDays,
        updatedAt: null,
        updatedBy: null,
        cases: CASES.map((key) => ({
          key,
          group: 'profile',
          label: key,
          kind: 'marketing',
          ...s.cases[key],
        })),
        switches: { email_reminders: false, push: false, whatsapp: false, sms: false },
        channels: ['whatsapp', 'sms'].map((channel) => ({ channel, setup: s.channels[channel] ?? null })),
      });
      const body = raw ? JSON.parse(raw) : {};
      const p = u.pathname;
      if (p === '/api/v1/admin/reminders' && req.method === 'GET') return send(view());
      if (p === '/api/v1/admin/reminders' && req.method === 'PUT') {
        for (const [k, v] of Object.entries(body.cases ?? {})) Object.assign(s.cases[k]!, v);
        if (body.minGapDays) s.minGapDays = body.minGapDays;
        return send(view());
      }
      if (p === '/api/v1/admin/reminders/preview')
        return send({
          checked: 120,
          due: 7,
          byCase: { partial: 5, password: 2 },
          skipped: {},
          limited: false,
          switchOn: false,
        });
      if (p === '/api/v1/admin/channels')
        return send({ providers: { whatsapp: {}, sms: {} }, channels: view().channels });
      const m = p.match(/^\/api\/v1\/admin\/channels\/(whatsapp|sms)(\/check|\/remove)?$/);
      if (m && req.method === 'PUT') {
        const key = String(Object.values(body.credentials ?? {})[0] ?? '');
        s.channels[m[1]!] = {
          channel: m[1],
          provider: body.provider,
          providerLabel: body.provider,
          keyHint: key.slice(-4),
          sender: body.sender ?? '',
          templates: body.templates ?? {},
        };
        return send(s.channels[m[1]!]);
      }
      if (m?.[2] === '/check') return send({ ok: true, message: 'Connected' });
      if (m?.[2] === '/remove') {
        const removed = Boolean(s.channels[m[1]!]);
        delete s.channels[m[1]!];
        return send({ removed });
      }
      send({ status: 'error', code: 'not_found', message: 'Not found' }, 404);
    });
  });
  await new Promise<void>((r) => panel.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
  t = await startTestApp({
    PANEL_ADMIN_API_SECRET: SECRET,
    T2O_ADMIN_API_BASE_URL: base,
    MFR_ADMIN_API_BASE_URL: base,
    MHO_ADMIN_API_BASE_URL: base,
  });
  for (const role of ['super_admin', 'data_steward', 'read_only_analyst'] as const)
    tok[role] = (await t.adminToken(role, `rem.${role}@example.invalid`)).token;
}, 120_000);
afterAll(async () => {
  await t?.stop();
  panel?.close();
});

const audit = async (action: string, brand: string) =>
  (
    await t.app
      .get(Database)
      .db.execute<{ metadata: Record<string, unknown> }>(
        sql`select metadata from audit_event where action = ${action} and panel = ${brand} order by id desc limit 1`,
      )
  ).rows[0];

describe('auto reminders', () => {
  it('saves days and limits per case on every brand, with the reason in the audit log', async () => {
    for (const brand of ['t2o', 'mfr', 'mho']) {
      const v = await request(t.server)
        .get('/api/v1/panel/reminders')
        .set(as('data_steward', brand))
        .expect(200);
      expect(v.body).toMatchObject({ canEdit: true, canSetUpChannels: false, minGapDays: 3 });
      expect(v.body.cases).toHaveLength(8);

      const r = await request(t.server)
        .put('/api/v1/panel/reminders')
        .set(as('data_steward', brand))
        .send({
          reason: 'Profile nudges every 12 days',
          minGapDays: 5,
          cases: { partial: { enabled: true, everyDays: 12, max: 4 } },
        });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      expect(r.body.cases.find((c: { key: string }) => c.key === 'partial')).toMatchObject({
        enabled: true,
        everyDays: 12,
        max: 4,
      });
      const a = await audit('reminders.settings_changed', brand);
      expect(a!.metadata).toMatchObject({
        reason: 'Profile nudges every 12 days',
        minGapDays: { before: 3, after: 5 },
      });
      expect((a!.metadata.changed as { key: string }[]).map((c) => c.key)).toEqual(['partial']);

      const pv = await request(t.server)
        .post('/api/v1/panel/reminders/preview')
        .set(as('data_steward', brand))
        .send({})
        .expect(200);
      expect(pv.body).toMatchObject({ checked: 120, due: 7 });
    }
    // each brand kept its own settings on its own panel origin
    expect(state.size).toBe(3);
  });

  it('checks the input and the permission', async () => {
    await request(t.server)
      .put('/api/v1/panel/reminders')
      .set(as('data_steward', 'mfr'))
      .send({ cases: {} })
      .expect(400); // no reason
    await request(t.server)
      .put('/api/v1/panel/reminders')
      .set(as('data_steward', 'mfr'))
      .send({ reason: 'too often', cases: { partial: { everyDays: 0 } } })
      .expect(400);
    await request(t.server)
      .put('/api/v1/panel/reminders')
      .set(as('data_steward', 'mfr'))
      .send({ reason: 'not a real case', cases: { birthday: { enabled: true } } })
      .expect(400);
    const viewer = await request(t.server).get('/api/v1/panel/reminders').set(as('read_only_analyst', 'mfr'));
    if (viewer.status === 200) expect(viewer.body.canEdit).toBe(false);
    await request(t.server)
      .put('/api/v1/panel/reminders')
      .set(as('read_only_analyst', 'mfr'))
      .send({ reason: 'should not pass', cases: {} })
      .expect(403);
  });
});

describe('message channels', () => {
  it('lets Super Admin set up, check and remove WhatsApp and SMS on every brand, and never logs the key', async () => {
    for (const brand of ['t2o', 'mfr', 'mho']) {
      await request(t.server)
        .put('/api/v1/panel/channels/sms')
        .set(as('data_steward', brand))
        .send({ provider: 'msg91', credentials: { authKey: KEY }, reason: 'Set up SMS' })
        .expect(403);
      const s = await request(t.server)
        .put('/api/v1/panel/channels/whatsapp')
        .set(as('super_admin', brand))
        .send({
          provider: 'meta',
          credentials: { phoneNumberId: '1234', accessToken: KEY },
          sender: '+911234567890',
          templates: { partial: 'profile_nudge' },
          language: 'en',
          reason: 'Set up WhatsApp',
        });
      expect(s.status, JSON.stringify(s.body)).toBe(200);
      expect(s.body.keyHint).toBe('1234');
      const sent = seen.filter((x) => x.method === 'PUT' && x.path.endsWith('/whatsapp')).at(-1)!;
      expect(JSON.parse(sent.body)).not.toHaveProperty('reason');

      const c = await request(t.server)
        .post('/api/v1/panel/channels/whatsapp/check')
        .set(as('super_admin', brand))
        .send({})
        .expect(200);
      expect(c.body.ok).toBe(true);
      const list = await request(t.server)
        .get('/api/v1/panel/channels')
        .set(as('super_admin', brand))
        .expect(200);
      expect(
        list.body.channels.find((x: { channel: string }) => x.channel === 'whatsapp').setup,
      ).toBeTruthy();

      await request(t.server)
        .post('/api/v1/panel/channels/whatsapp/remove')
        .set(as('super_admin', brand))
        .send({})
        .expect(400); // reason
      const r = await request(t.server)
        .post('/api/v1/panel/channels/whatsapp/remove')
        .set(as('super_admin', brand))
        .send({ reason: 'Moving to Twilio' })
        .expect(200);
      expect(r.body.removed).toBe(true);
      expect((await audit('channels.provider_removed', brand))!.metadata).toMatchObject({
        reason: 'Moving to Twilio',
      });
    }
    await request(t.server)
      .put('/api/v1/panel/channels/email')
      .set(as('super_admin', 'mfr'))
      .send({ provider: 'meta', reason: 'Not a channel' })
      .expect(400);
    const all = await t.app
      .get(Database)
      .db.execute(sql`select metadata::text as m from audit_event where action like 'channels.%'`);
    expect(all.rows.length).toBeGreaterThanOrEqual(9);
    expect(JSON.stringify(all.rows)).not.toContain(KEY);
  });
});
