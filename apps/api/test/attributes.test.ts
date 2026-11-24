import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

let t: Awaited<ReturnType<typeof startTestApp>>;
let steward: string;
let privacy: string;
const as = (tok: string) => ({ authorization: `Bearer ${tok}` });

async function mappingFor(panel: string, sourceQuestionId: string) {
  const r = await request(t.server)
    .get(`/api/v1/mappings/review?panel=${panel}`)
    .set(as(steward))
    .expect(200);
  const items = (r.body.items ?? r.body) as { id: string; sourceQuestionId: string }[];
  const m = items.find((i) => i.sourceQuestionId === sourceQuestionId);
  if (!m) throw new Error(`no pending mapping for ${panel}/${sourceQuestionId}`);
  return m.id;
}

const counts = (tok: string, body: object) =>
  request(t.server).post('/api/v1/audience/counts').set(as(tok)).send(body);

beforeAll(async () => {
  t = await startTestApp({ MIN_CELL_SIZE: '0' });
  const sa = (await t.adminToken('super_admin')).token;
  steward = (await t.adminToken('data_steward')).token;
  privacy = (await t.adminToken('privacy_officer')).token;
  for (const panel of ['t2o', 'mho'])
    await request(t.server)
      .post(`/api/v1/connectors/${panel}/import`)
      .set(as(sa))
      .send({ dryRun: false })
      .expect(200);
});
afterAll(async () => t?.stop());

describe('attribute-level audience filters', () => {
  it('a pending mapping never affects counts', async () => {
    const r = await counts(steward, {
      attributes: [{ key: 'demographics.gender', values: ['female'] }],
    }).expect(200);
    expect(r.body.uniquePeople).toBe(0);
    expect(r.body.attributeFilters).toEqual([
      { key: 'demographics.gender', sensitivity: expect.any(String), approvedMappings: 0, panels: [] },
    ]);
  });

  it('rejects a value map that names values the question does not have', async () => {
    const id = await mappingFor('t2o', 'gender');
    const r = await request(t.server)
      .post(`/api/v1/mappings/${id}/decision`)
      .set(as(steward))
      .send({ decision: 'approve', attributeKey: 'demographics.gender', valueMap: { Martian: 'other' } })
      .expect(400);
    expect(r.body.message).toMatch(/Martian/);
  });

  it('counts people through an approved mapping and its value map', async () => {
    const all = await counts(steward, { panels: ['t2o'] }).expect(200);
    const id = await mappingFor('t2o', 'gender');
    await request(t.server)
      .post(`/api/v1/mappings/${id}/decision`)
      .set(as(steward))
      .send({
        decision: 'approve',
        attributeKey: 'demographics.gender',
        valueMap: { Female: 'female', Male: 'male' },
      })
      .expect(201);
    const female = await counts(steward, {
      attributes: [{ key: 'demographics.gender', values: ['female'] }],
    }).expect(200);
    const male = await counts(steward, {
      attributes: [{ key: 'demographics.gender', values: ['male'] }],
    }).expect(200);
    const either = await counts(steward, {
      attributes: [{ key: 'demographics.gender', values: ['female', 'male'] }],
    }).expect(200);
    expect(female.body.uniquePeople).toBeGreaterThan(0);
    expect(male.body.uniquePeople).toBeGreaterThan(0);
    // OR within a filter; people who answered with an unmapped code (e.g. "Prefer not to say") are excluded.
    expect(either.body.uniquePeople).toBe(female.body.uniquePeople + male.body.uniquePeople);
    expect(either.body.uniquePeople).toBeLessThanOrEqual(all.body.uniquePeople);
    expect(female.body.attributeFilters[0]).toMatchObject({ approvedMappings: 1, panels: ['t2o'] });
    // Source codes are not canonical values.
    const raw = await counts(steward, {
      attributes: [{ key: 'demographics.gender', values: ['Female'] }],
    }).expect(200);
    expect(raw.body.uniquePeople).toBe(0);
  });

  it('ANDs filters together with the other audience filters', async () => {
    const female = await counts(steward, {
      attributes: [{ key: 'demographics.gender', values: ['female'] }],
    }).expect(200);
    const femaleMho = await counts(steward, {
      panels: ['mho'],
      attributes: [{ key: 'demographics.gender', values: ['female'] }],
    }).expect(200);
    // The mapping is approved for T2O only, so only MHO members who are also linked T2O members can match.
    expect(femaleMho.body.uniquePeople).toBeLessThanOrEqual(female.body.uniquePeople);
    const twoFilters = await counts(steward, {
      attributes: [
        { key: 'demographics.gender', values: ['female'] },
        { key: 'demographics.gender', values: ['male'] },
      ],
    }).expect(200);
    expect(twoFilters.body.uniquePeople).toBe(0);
  });

  it('special-category filters need health.sensitive.read, and their use is audited', async () => {
    await counts(steward, { attributes: [{ key: 'demographics.religion', values: ['x'] }] }).expect(403);
    await counts(privacy, { attributes: [{ key: 'demographics.religion', values: ['x'] }] }).expect(403);
    const ok = await counts(privacy, {
      attributes: [{ key: 'demographics.religion', values: ['x'] }],
      purpose: 'study_feasibility',
    }).expect(200);
    expect(ok.body.minimumCellSize).toBe(10);
    expect(ok.body.attributeFilters[0].sensitivity).toBe('special_category');
    const audit = await request(t.server).get('/api/v1/audit').set(as(privacy)).expect(200);
    const rows = (audit.body.items ?? audit.body) as { action: string; targetId: string }[];
    expect(
      rows.some(
        (e) => e.action === 'audience.sensitive_filter_used' && e.targetId === 'demographics.religion',
      ),
    ).toBe(true);
  });

  it('unknown attributes are a 404, not a silent zero', async () => {
    await counts(steward, { attributes: [{ key: 'nope.nothing', values: ['x'] }] }).expect(404);
  });
});
