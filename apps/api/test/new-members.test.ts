import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

/**
 * New-member bell for all three panels: counts per panel and per segment since the admin's "seen" mark, only for
 * brands the admin may see, teens left out without teen access, and old members from a first import never counted.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
let db: pg.Client;
type Summary = {
  dataMode: string;
  total: number;
  panels: { panel: string; total: number; segments: { key: string; count: number }[]; teensHidden: boolean }[];
  recent: { panel: string; segments: string[]; country: string | null }[];
};
const get = (tok = token) =>
  request(t.server).get('/api/v1/new-members').set('authorization', `Bearer ${tok}`).expect(200);
const seen = (body: object, tok = token) =>
  request(t.server).post('/api/v1/new-members/seen').set('authorization', `Bearer ${tok}`).send(body);

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '60' });
  token = (await t.adminToken('super_admin')).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set('authorization', `Bearer ${token}`).send({ dryRun: false }).expect(200);
  db = new pg.Client({ connectionString: t.dbUrl });
  await db.connect();
  // The DEMO import gives members sign-up dates spread over years. Make a known few look freshly signed up.
  await db.query(`update source_identity set source_created_at = now() - interval '400 days'`);
  await db.query(`
    update source_identity set source_created_at = now() - interval '1 hour'
    where id in (select source_identity_id from panel_membership pm
                 where exists (select 1 from category_membership c where c.master_person_id = pm.master_person_id and c.panel = pm.panel)
                 order by pm.panel, pm.id limit 200)`);
});
afterAll(async () => {
  await db?.end();
  await t?.stop();
});

async function expected(panel: string, teens = true) {
  const r = await db.query<{ n: string }>(
    `select count(*) as n from panel_membership pm join source_identity si on si.id = pm.source_identity_id
     where pm.panel = $1 and pm.status <> 'deleted' and si.source_created_at > now() - interval '7 days'
     ${teens ? '' : `and not exists (select 1 from category_membership t where t.master_person_id = pm.master_person_id and t.panel = pm.panel and (t.is_minor or t.category = 'teen'))`}`,
    [panel],
  );
  return Number(r.rows[0]!.n);
}

describe('new-member alerts', () => {
  it('counts new sign-ups per panel and segment for all three panels, and old members never ring', async () => {
    const r = (await get()).body as Summary;
    expect(r.dataMode).toBe('demo');
    expect(r.panels.map((p) => p.panel).sort()).toEqual(['mfr', 'mho', 't2o']);
    for (const p of r.panels) {
      expect(p.total).toBe(await expected(p.panel));
      expect(p.teensHidden).toBe(false);
      // Every new member has a segment here, so segment counts cover the total.
      expect(p.segments.reduce((a, s) => a + s.count, 0)).toBeGreaterThanOrEqual(p.total);
    }
    expect(r.total).toBe(r.panels.reduce((a, p) => a + p.total, 0));
    expect(r.total).toBeGreaterThan(0);
    expect(r.total).toBeLessThanOrEqual(200);
    expect(r.recent.length).toBeGreaterThan(0);
    // Counts only: nothing personal in the answer.
    const text = JSON.stringify(r);
    expect(text).not.toMatch(/@example\.invalid|email|phone|name/i);
  });

  it('starts a panel from zero once it is marked seen, and counts the next sign-up', async () => {
    const before = (await get()).body as Summary;
    await seen({ panel: 'mfr' }).expect(200);
    const after = (await get()).body as Summary;
    expect(after.panels.find((p) => p.panel === 'mfr')!.total).toBe(0);
    expect(after.panels.find((p) => p.panel === 't2o')!.total).toBe(before.panels.find((p) => p.panel === 't2o')!.total);

    // A member the next sync brings in counts again.
    await db.query(`
      update panel_membership set created_at = now() + interval '1 second'
      where id = (select pm.id from panel_membership pm join source_identity si on si.id = pm.source_identity_id
                  where pm.panel = 'mfr' and si.source_created_at > now() - interval '7 days'
                  and not exists (select 1 from category_membership t where t.master_person_id = pm.master_person_id and t.panel = 'mfr' and t.is_minor)
                  limit 1)`);
    await new Promise((r) => setTimeout(r, 1100));
    const next = (await get()).body as Summary;
    expect(next.panels.find((p) => p.panel === 'mfr')!.total).toBe(1);

    await seen({}).expect(200);
    expect(((await get()).body as Summary).total).toBe(0);
    await seen({ panel: 'nope' }).expect(400);
  });

  it('shows a brand admin only their brand, and leaves teens out without teen access', async () => {
    // One T2O teen (DEMO teens are on T2O) signed up just now.
    const teen = await db.query(`
      update source_identity set source_created_at = now() - interval '5 minutes'
      where id = (select pm.source_identity_id from panel_membership pm
                  join category_membership c on c.master_person_id = pm.master_person_id and c.panel = pm.panel and c.is_minor
                  where pm.panel = 't2o' limit 1)`);
    expect(teen.rowCount).toBe(1);
    await db.query(`update panel_membership set created_at = now() + interval '1 second'`);
    await new Promise((r) => setTimeout(r, 1100));
    const t2oManager = (await t.adminToken('panel_manager', 'pm-t2o@example.invalid', ['t2o'])).token;
    const r = (await get(t2oManager)).body as Summary;
    expect(r.panels.map((p) => p.panel)).toEqual(['t2o']);
    const p = r.panels[0]!;
    // Panel managers have no teen access.
    expect(p.teensHidden).toBe(true);
    expect(p.total).toBe(await expected('t2o', false));
    expect(p.total).toBeLessThan(await expected('t2o', true));
    expect(p.segments.some((s) => s.key === 'teen')).toBe(false);
    expect(r.recent.every((x) => !x.segments.includes('teen'))).toBe(true);
    // Marking seen touches only the admin's own panels and own marks.
    await seen({ panel: 'mfr' }, t2oManager).expect(200);
    const admin = (await get()).body as Summary;
    expect(admin.panels.find((p) => p.panel === 'mfr')!.total).toBeGreaterThan(0);
  });
});
