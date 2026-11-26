import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

/** Saved Members-table views: per brand, own plus shared, filters only, author-only delete. */
let t: Awaited<ReturnType<typeof startTestApp>>;
let admin: string;
let other: string;
let mfrOnly: string;
const call = (method: 'get' | 'post' | 'delete', path: string, tok: string, brand: string, body?: object) => {
  const r = request(t.server)[method](`/api/v1/member-views${path}`).set('authorization', `Bearer ${tok}`).set('x-madp-brand', brand);
  return body ? r.send(body) : r;
};

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '10' });
  admin = (await t.adminToken('super_admin')).token;
  other = (await t.adminToken('super_admin', 'second@example.invalid')).token;
  mfrOnly = (await t.adminToken('panel_manager', 'pm@example.invalid', ['mfr'])).token;
});
afterAll(async () => t?.stop());

describe('saved member views', () => {
  it('saves a view per brand for all three panels and lists own plus shared views', async () => {
    for (const brand of ['t2o', 'mfr', 'mho'])
      await call('post', '', admin, brand, {
        name: `New consumers ${brand}`,
        params: { category: 'b2c', country: 'in', lastDays: 7, sort: 'signedUp', dir: 'desc' },
      }).expect(201);
    await call('post', '', admin, 'mfr', { name: 'High quality', params: { qualityMin: 120 }, shared: true }).expect(201);
    const mine = (await call('get', '', admin, 'mfr').expect(200)).body.views;
    expect(mine.map((v: { name: string }) => v.name).sort()).toEqual(['High quality', 'New consumers mfr']);
    expect(mine[0].mine).toBe(true);
    // Another admin sees only the shared one, and can't delete it.
    const seen = (await call('get', '', other, 'mfr').expect(200)).body.views;
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ name: 'High quality', shared: true, mine: false });
    await call('delete', `/${seen[0].id}`, other, 'mfr').expect(404);
    // Views stay on their brand.
    expect((await call('get', '', admin, 'mho').expect(200)).body.views).toHaveLength(1);
    expect((await call('get', '', other, 't2o').expect(200)).body.views).toHaveLength(0);
  });

  it('never saves a search for one person, and refuses brands the admin was not given', async () => {
    await call('post', '', admin, 'mfr', { name: 'One person', params: { q: 'asha@example.invalid' } }).expect(400);
    await call('post', '', admin, 'mfr', { name: 'x', params: {} }).expect(400);
    await call('post', '', admin, 'mfr', { name: 'High quality', params: { qualityMin: 1 } }).expect(403);
    await call('get', '', mfrOnly, 't2o').expect(403);
    expect((await call('get', '', mfrOnly, 'mfr').expect(200)).body.views).toHaveLength(1);
  });

  it('lets the author delete their view', async () => {
    const v = (await call('get', '', admin, 't2o').expect(200)).body.views[0];
    await call('delete', `/${v.id}`, admin, 't2o').expect(200);
    expect((await call('get', '', admin, 't2o').expect(200)).body.views).toHaveLength(0);
  });
});
