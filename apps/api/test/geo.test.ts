import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

/**
 * Geography explorer and overlap (screens 2 to 4) on DEMO data for all three panels: unique people per country,
 * state and city that add up without double counting, small cells hidden, panel combinations and the category
 * matrix, and the same purpose rules for health filters as the counts.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
let analyst: string;
const post = (path: string, body: object, tok = token) =>
  request(t.server).post(`/api/v1/audience/${path}`).set('authorization', `Bearer ${tok}`).send(body);
type Row = { key: string; uniquePeople: number | null; byPanel: Record<string, number | null>; suppressed: boolean };

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '80', MIN_CELL_SIZE: '0' });
  token = (await t.adminToken('super_admin')).token;
  analyst = (await t.adminToken('analyst')).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set('authorization', `Bearer ${token}`).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

describe('geography explorer', () => {
  it('drills from country to state to city, counting each person once', async () => {
    const counts = await post('counts', {}).expect(200);
    const world = await post('geo', {}, analyst).expect(200);
    expect(world.body.level).toBe('country');
    expect(world.body.uniquePeople).toBe(counts.body.uniquePeople);
    const rows = world.body.rows as Row[];
    // A person has one country, so the rows add up to the unique people.
    expect(rows.reduce((a, r) => a + (r.uniquePeople ?? 0), 0)).toBe(world.body.uniquePeople);
    // Every panel appears somewhere.
    for (const p of ['t2o', 'mfr', 'mho']) expect(rows.some((r) => (r.byPanel[p] ?? 0) > 0)).toBe(true);
    // A person in two panels is one person but appears in both panel columns.
    for (const r of rows) expect(r.uniquePeople!).toBeLessThanOrEqual((r.byPanel.t2o ?? 0) + (r.byPanel.mfr ?? 0) + (r.byPanel.mho ?? 0));
    expect(world.body.timezones.length).toBeGreaterThan(0);

    const top = rows.find((r) => r.key !== 'unknown')!;
    const country = await post('geo', { country: top.key.toUpperCase() }).expect(200);
    expect(country.body).toMatchObject({ level: 'state', country: top.key, uniquePeople: top.uniquePeople });
    const state = (country.body.rows as Row[])[0]!;
    const city = await post('geo', { country: top.key, state: state.key }).expect(200);
    expect(city.body).toMatchObject({ level: 'city', state: state.key, uniquePeople: state.uniquePeople, timezones: [] });
    expect((city.body.rows as Row[]).reduce((a, r) => a + (r.uniquePeople ?? 0), 0)).toBe(state.uniquePeople);

    const panelOnly = await post('geo', { panels: ['mho'] }).expect(200);
    expect(panelOnly.body.uniquePeople).toBe((await post('counts', { panels: ['mho'] }).expect(200)).body.uniquePeople);
    await post('geo', { state: 'X' }).expect(400);
  });

  it('hides small cells', async () => {
    const t2 = await startTestApp({ DEMO_POPULATION_SIZE: '30', MIN_CELL_SIZE: '1000' });
    try {
      const tok = (await t2.adminToken('super_admin')).token;
      await request(t2.server).post('/api/v1/connectors/t2o/import').set('authorization', `Bearer ${tok}`).send({ dryRun: false }).expect(200);
      const r = await request(t2.server).post('/api/v1/audience/geo').set('authorization', `Bearer ${tok}`).send({}).expect(200);
      for (const row of r.body.rows as Row[]) {
        expect(row).toMatchObject({ uniquePeople: null, suppressed: true });
        expect(Object.values(row.byPanel).every((v) => v === null || v === 0)).toBe(true);
      }
    } finally {
      await t2.stop();
    }
  });
});

describe('panel and category overlap', () => {
  it('splits people by exact panel combination and shows the category matrix', async () => {
    const counts = await post('counts', {}).expect(200);
    const o = await post('overlap', {}, analyst).expect(200);
    const combos = o.body.panelCombinations as { panels: string[]; people: number }[];
    expect(combos.reduce((a, c) => a + c.people, 0)).toBe(counts.body.uniquePeople);
    expect(combos.some((c) => c.panels.length > 1)).toBe(true);
    for (const p of ['t2o', 'mfr', 'mho'])
      expect(combos.filter((c) => c.panels.includes(p)).reduce((a, c) => a + c.people, 0)).toBe(
        counts.body.byPanel.find((b: { key: string }) => b.key === p).value,
      );
    const m = o.body.categoryMatrix as { a: string; b: string; people: number }[];
    const diag = m.filter((x) => x.a === x.b);
    for (const d of diag) expect(d.people).toBe(counts.body.byCategory.find((c: { key: string }) => c.key === d.a).value);
    for (const x of m) expect(x.people).toBe(m.find((y) => y.a === x.b && y.b === x.a)!.people);
  });

  it('applies the health purpose rule', async () => {
    await post('overlap', { attributes: [{ key: 'demographics.religion', values: ['x'] }] }, analyst).expect(403);
    await post('geo', { attributes: [{ key: 'demographics.religion', values: ['x'] }] }).expect(403);
    const ok = await post('geo', { attributes: [{ key: 'demographics.religion', values: ['x'] }], purpose: 'study_feasibility' }).expect(200);
    expect(ok.body.minimumCellSize).toBeGreaterThanOrEqual(10);
  });
});
