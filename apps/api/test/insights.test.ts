import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import { Database } from '../src/db/database.js';
import { startTestApp } from './helpers.js';

/**
 * Rule-based insights (screen 34) on DEMO data for all three panels: rules fire per panel with counts only, a
 * refresh updates instead of duplicating, resolves what no longer fires, keeps decided insights quiet, and a person
 * accepts or dismisses each one.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string, brand?: string) => ({ authorization: `Bearer ${tok[who]}`, ...(brand ? { 'x-madp-brand': brand } : {}) });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;
type Insight = { id: string; panel: string; rule: string; status: string; severity: string; evidence: Record<string, unknown> };
const list = async (who = 'data_steward', qs = '', brand?: string) =>
  (await request(t.server).get(`/api/v1/insights${qs}`).set(as(who, brand)).expect(200)).body as { items: Insight[]; rules: Record<string, string>; lastRefreshedAt: string | null };
const refresh = (who = 'data_steward', brand?: string) => request(t.server).post('/api/v1/insights/refresh').set(as(who, brand));

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '40' });
  for (const role of ['super_admin', 'data_steward', 'analyst', 'support'] as const) tok[role] = (await t.adminToken(role)).token;
  tok.mhoManager = (await t.adminToken('panel_manager', 'mho.manager@example.invalid', ['mho'])).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

describe('insights', () => {
  it('raises per-panel insights with counts only, for all three panels', async () => {
    expect((await list()).items).toEqual([]);
    const r = await refresh().expect(200);
    expect(r.body.raised).toBeGreaterThan(0);
    const l = await list();
    expect(new Set(l.items.map((i) => i.panel))).toEqual(new Set(['t2o', 'mfr', 'mho']));
    // Every panel has pending mappings after a fresh import.
    for (const p of ['t2o', 'mfr', 'mho']) expect(l.items.some((i) => i.panel === p && i.rule === 'pending_mappings')).toBe(true);
    expect(l.lastRefreshedAt).not.toBeNull();
    expect(Object.keys(l.rules)).toContain('privacy_overdue');
    const text = JSON.stringify(l.items);
    expect(text).not.toMatch(/@example\.invalid|email_hash/);
    for (const i of l.items) for (const v of Object.values(i.evidence)) expect(v === null || typeof v === 'number' || typeof v === 'string').toBe(true);
  });

  it('updates on refresh instead of duplicating, and resolves what no longer fires', async () => {
    const before = await list('data_steward', '?status=open');
    const again = await refresh().expect(200);
    expect(again.body.raised).toBe(0);
    expect(again.body.updated).toBe(before.items.length);
    expect((await list('data_steward', '?status=open')).items).toHaveLength(before.items.length);

    // Clear the T2O mapping queue: its insight resolves.
    await q(sql`update source_question_mapping set status = 'rejected' where panel = 't2o' and status = 'pending'`);
    const r = await refresh().expect(200);
    expect(r.body.resolved).toBeGreaterThanOrEqual(1);
    const all = await list('data_steward', '?panel=t2o');
    expect(all.items.find((i) => i.rule === 'pending_mappings')?.status).toBe('resolved');
  });

  it('raises a critical insight for an overdue privacy request', async () => {
    const [p] = await q<{ person: string }>(sql`select master_person_id as person from panel_membership where panel = 'mfr' and status = 'active' limit 1`);
    const r = await request(t.server)
      .post('/api/v1/privacy/requests')
      .set(as('support'))
      .send({ personId: p!.person, kind: 'access', panels: ['mfr'], reference: 'Ticket 77' })
      .expect(201);
    await q(sql`update privacy_request set due_at = now() - interval '1 day' where id = ${r.body.id}`);
    await refresh().expect(200);
    const i = (await list('data_steward', '?panel=mfr&status=open')).items.find((x) => x.rule === 'privacy_overdue');
    expect(i).toMatchObject({ severity: 'critical', evidence: { overdue: 1 } });
  });

  it('a person accepts or dismisses each insight, and decided ones stay quiet', async () => {
    const open = (await list('data_steward', '?panel=mho&status=open')).items;
    const target = open.find((i) => i.rule === 'pending_mappings')!;
    await request(t.server).post(`/api/v1/insights/${target.id}/decision`).set(as('analyst')).send({ decision: 'dismissed', note: 'Not now' }).expect(403);
    const d = await request(t.server)
      .post(`/api/v1/insights/${target.id}/decision`)
      .set(as('data_steward'))
      .send({ decision: 'dismissed', note: 'Mappings are planned for next week' })
      .expect(200);
    expect(d.body.status).toBe('dismissed');
    await request(t.server).post(`/api/v1/insights/${target.id}/decision`).set(as('data_steward')).send({ decision: 'accepted', note: 'Again' }).expect(409);
    await refresh().expect(200);
    const after = (await list('data_steward', '?panel=mho')).items.filter((i) => i.rule === 'pending_mappings');
    expect(after.map((i) => i.status)).toEqual(['dismissed']);
    const audit = await q<{ action: string }>(sql`select action from audit_event where action like 'insight%'`);
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['insights.refreshed', 'insight.dismissed']));
  });

  it('checks permissions and the selected brand', async () => {
    await request(t.server).get('/api/v1/insights').set(as('support')).expect(403);
    expect((await list('analyst')).items.length).toBeGreaterThan(0);
    await refresh('analyst').expect(403);
    const mho = await list('mhoManager', '', 'mho');
    expect(new Set(mho.items.map((i) => i.panel))).toEqual(new Set(['mho']));
    await request(t.server).get('/api/v1/insights').set(as('mhoManager', 'all')).expect(403);
    const t2o = (await list('data_steward', '?panel=t2o&status=open')).items[0];
    if (t2o) await request(t.server).post(`/api/v1/insights/${t2o.id}/decision`).set(as('mhoManager', 'mho')).send({ decision: 'accepted', note: 'Mine' }).expect(404);
  });
});
