import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

/** Live activity feed across T2O, MFR and MHO: sign-ups and survey completes, newest first, nothing personal. */
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
let db: pg.Client;
type Item = { kind: string; panel: string; at: string; segments?: string[] };

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '60' });
  token = (await t.adminToken('super_admin')).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set('authorization', `Bearer ${token}`).send({ dryRun: false }).expect(200);
  db = new pg.Client({ connectionString: t.dbUrl });
  await db.connect();
  await db.query(`update source_identity set source_created_at = now() - interval '400 days'`);
  await db.query(`update survey_participation set ended_at = now() - interval '400 days'`);
  // Three fresh sign-ups per panel, one of them a T2O teen, and a few survey completes.
  await db.query(`
    update source_identity set source_created_at = now() - interval '2 hours'
    where id in (select source_identity_id from (select pm.source_identity_id, row_number() over (partition by pm.panel order by pm.id) rn from panel_membership pm) x where rn <= 3)`);
  await db.query(`
    update source_identity set source_created_at = now() - interval '1 hour'
    where id = (select pm.source_identity_id from panel_membership pm join category_membership c on c.master_person_id = pm.master_person_id and c.panel = pm.panel and c.is_minor where pm.panel = 't2o' limit 1)`);
  await db.query(`update survey_participation set status = 'complete', ended_at = now() - interval '30 minutes' where id in (select id from survey_participation order by id limit 4)`);
});
afterAll(async () => {
  await db?.end();
  await t?.stop();
});

describe('activity feed', () => {
  it('lists sign-ups and survey completes from all three panels, newest first, with nothing personal', async () => {
    const r = await request(t.server).get('/api/v1/activity').set('authorization', `Bearer ${token}`).expect(200);
    const items = r.body.items as Item[];
    const signups = items.filter((i) => i.kind === 'signup');
    expect(new Set(signups.map((i) => i.panel))).toEqual(new Set(['t2o', 'mfr', 'mho']));
    expect(signups.some((i) => i.segments?.includes('teen'))).toBe(true);
    const completes = items.filter((i) => i.kind === 'survey_complete');
    expect(completes.length).toBe(Number((await db.query(`select count(*) n from survey_participation where status = 'complete' and ended_at > now() - interval '3 days'`)).rows[0].n));
    expect(items.map((i) => i.at)).toEqual([...items.map((i) => i.at)].sort().reverse());
    expect(JSON.stringify(r.body)).not.toMatch(/@example\.invalid|email|phone|"name"/i);
    // No panel admin API in tests: tickets are missing and the feed says which panels did not answer.
    expect(r.body.unreachable).toEqual(['mfr', 'mho', 't2o']);
  });

  it('shows a brand admin only their panel, without teens when they have no teen access', async () => {
    const pm = (await t.adminToken('panel_manager', 'pm-t2o@example.invalid', ['t2o'])).token;
    const r = await request(t.server).get('/api/v1/activity').set('authorization', `Bearer ${pm}`).expect(200);
    const items = r.body.items as Item[];
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.panel === 't2o')).toBe(true);
    expect(items.some((i) => i.segments?.includes('teen'))).toBe(false);
  });
});
