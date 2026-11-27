import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Database } from '../src/db/database.js';
import { startTestApp } from './helpers.js';

/**
 * The win-back journey on T2O, MFR and MHO: inactive counts for 30, 60 and 90 days from the panel's member search,
 * one-click drafts of the three mailers, and a journey that needs approved templates and a second admin. A stand-in
 * panel answers the search (MHO plays a panel that is down). Nothing is ever sent.
 */
const SECRET = 'demo-panel-admin-secret-0123456789abcdef0123';
let t: Awaited<ReturnType<typeof startTestApp>>;
let panel: Server;
const asked: { origin: string; inactiveSince: string | null; noTeens: string | null }[] = [];
const tok: Record<string, string> = {};
const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });

beforeAll(async () => {
  panel = createServer((req, res) => {
    req.resume();
    const u = new URL(req.url!, 'http://x');
    const origin = String(req.headers['x-madp-origin'] ?? '');
    res.setHeader('content-type', 'application/json');
    if (origin.includes('myhealthopinions')) {
      res.statusCode = 503;
      return res.end(JSON.stringify({ status: 'error', code: 'down', message: 'Down' }));
    }
    const since = u.searchParams.get('inactiveSince');
    asked.push({ origin, inactiveSince: since, noTeens: u.searchParams.get('noTeens') });
    // older cut-off date, fewer members: 30 days -> 40, 60 -> 25, 90 -> 10
    const age = since ? Math.round((Date.now() - Date.parse(since)) / 86_400_000) : 0;
    const total = age >= 89 ? 10 : age >= 59 ? 25 : 40;
    res.end(JSON.stringify({ status: 'success', data: { items: [], total, page: 1, pageSize: 25 } }));
  });
  await new Promise<void>((r) => panel.listen(0, '127.0.0.1', () => r()));
  const base = `http://127.0.0.1:${(panel.address() as AddressInfo).port}`;
  t = await startTestApp({ PANEL_ADMIN_API_SECRET: SECRET, T2O_ADMIN_API_BASE_URL: base, MFR_ADMIN_API_BASE_URL: base, MHO_ADMIN_API_BASE_URL: base });
  for (const role of ['super_admin', 'data_steward', 'privacy_officer'] as const) tok[role] = (await t.adminToken(role)).token;
}, 120_000);
afterAll(async () => {
  await t?.stop();
  panel?.close();
});

const get = async (who = 'super_admin') =>
  (await request(t.server).get('/api/v1/communications/automations/win-back').set(as(who)).expect(200)).body as {
    panel: string;
    inactive: Record<string, number> | null;
    since: Record<string, string>;
    automation: { status: string; versionStatus: string | null } | null;
    steps: { atDays: number; key: string; template: { id: string } | null; approved: { versionId: string } | null; latestStatus: string | null }[];
  }[];

describe('win-back journey', () => {
  it('counts members inactive for 30, 60 and 90 days per panel, teens left out, and survives a panel that is down', async () => {
    const r = await get();
    expect(r.map((p) => p.panel).sort()).toEqual(['mfr', 'mho', 't2o']);
    const t2o = r.find((p) => p.panel === 't2o')!;
    expect(t2o.inactive).toEqual({ '30': 40, '60': 25, '90': 10 });
    expect(r.find((p) => p.panel === 'mho')!.inactive).toBeNull();
    expect(t2o.since['90']! < t2o.since['60']! && t2o.since['60']! < t2o.since['30']!).toBe(true);
    expect(asked.every((a) => a.noTeens === '1' && a.inactiveSince)).toBe(true);
    // counts are cached: a second look does not search the panel again
    const n = asked.length;
    await get();
    expect(asked.length).toBe(n);
    // without members.read the journey still shows, but no counts
    const steward = await get('data_steward');
    expect(steward.every((p) => p.inactive === null)).toBe(true);
  });

  it('drafts the three mailers in one click, then sets up the journey once they are approved', async () => {
    for (const code of ['t2o', 'mfr', 'mho']) {
      // nothing to set up before the templates are approved
      const early = await request(t.server).post('/api/v1/communications/automations/win-back').set(as('data_steward')).send({ panel: code });
      expect(early.status).toBe(400);
      expect(early.body.problems).toHaveLength(3);

      const d = await request(t.server).post('/api/v1/communications/automations/win-back/drafts').set(as('data_steward')).send({ panel: code });
      expect(d.status, JSON.stringify(d.body)).toBe(201);
      expect(d.body.created).toEqual(['win-back-30', 'win-back-60', 'win-back-90']);
      // a second click drafts nothing new
      const again = await request(t.server).post('/api/v1/communications/automations/win-back/drafts').set(as('data_steward')).send({ panel: code });
      expect(again.body.created).toEqual([]);

      const steps = (await get()).find((p) => p.panel === code)!.steps;
      expect(steps.map((s) => s.latestStatus)).toEqual(['draft', 'draft', 'draft']);
      // the drafts pass the template checks (unsubscribe and preference links), so they can go to review and be approved
      const versions = (await request(t.server).get(`/api/v1/communications/templates?panel=${code}`).set(as('data_steward')).expect(200)).body;
      for (const s of steps) {
        const tpl = (versions.items ?? versions).find((x: { id: string }) => x.id === s.template!.id);
        const vId = (tpl.versions ?? [])[0]?.id;
        expect(vId, JSON.stringify(tpl)).toBeTruthy();
        await request(t.server).post(`/api/v1/communications/template-versions/${vId}/submit`).set(as('data_steward')).expect(200);
        await request(t.server).post(`/api/v1/communications/template-versions/${vId}/review`).set(as('privacy_officer')).send({ decision: 'approve' }).expect(200);
      }

      const made = await request(t.server).post('/api/v1/communications/automations/win-back').set(as('data_steward')).send({ panel: code });
      expect(made.status, JSON.stringify(made.body)).toBe(201);
      expect(made.body).toMatchObject({ panel: code, trigger: 'inactivity', name: 'Win-back journey' });
      const v = made.body.versions[0];
      expect(v.status).toBe('in_review');
      expect(v.steps.map((s: { atDays: number }) => s.atDays)).toEqual([30, 60, 90]);
      await request(t.server).post(`/api/v1/communications/automation-versions/${v.id}/review`).set(as('data_steward')).send({ decision: 'approve' }).expect(403);
      await request(t.server).post(`/api/v1/communications/automation-versions/${v.id}/review`).set(as('privacy_officer')).send({ decision: 'approve' }).expect(200);
      await request(t.server).post('/api/v1/communications/automations/win-back').set(as('data_steward')).send({ panel: code }).expect(409);
      await request(t.server).post(`/api/v1/communications/automations/${made.body.id}/run`).set(as('data_steward')).send({ dryRun: false }).expect(403);
    }
    for (const p of await get()) expect(p.automation).toMatchObject({ status: 'active', versionStatus: 'approved' });
    const audit = (
      await t.app.get(Database).db.execute<{ n: number }>(sql`select count(*)::int as n from audit_event where action = 'automation.win_back_drafted'`)
    ).rows[0]!.n;
    expect(audit).toBe(6);
  });

  it('needs communications.manage to draft or set up', async () => {
    const viewer = (await t.adminToken('read_only_analyst', 'wb.viewer@example.invalid')).token;
    await request(t.server).post('/api/v1/communications/automations/win-back/drafts').set({ authorization: `Bearer ${viewer}` }).send({ panel: 't2o' }).expect(403);
  });
});
