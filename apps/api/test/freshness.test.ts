import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Mongo } from '../src/mongo/mongo.js';
import { startTestApp } from './helpers.js';

/**
 * Missing attributes and freshness on DEMO data for all three panels: completeness bands, members due for the
 * 6-month check, least-answered questions, attribute coverage through approved mappings only, and health
 * questions hidden without health access.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
type Panel = {
  panel: string;
  activeMemberships: number;
  questionBank: number;
  membersWithAnswers: number;
  neverProfiled: number;
  dueForCheck: number;
  completeness: { band: string; members: number }[];
  leastAnswered: { sourceQuestionId: string; coverage: number }[];
  attributes: { key: string; members: number; coverage: number }[];
  hiddenSensitiveQuestions: number;
};
const report = async (who: string, qs = '') =>
  (await request(t.server).get(`/api/v1/profiles/freshness${qs}`).set(as(who)).expect(200)).body as { staleDays: number; panels: Panel[] };

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '90' });
  for (const role of ['super_admin', 'data_steward', 'analyst', 'privacy_officer'] as const) tok[role] = (await t.adminToken(role)).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
});
afterAll(async () => t?.stop());

describe('profile freshness', () => {
  it('reports each panel separately, with completeness bands that add up', async () => {
    const r = await report('analyst');
    expect(r.staleDays).toBe(180);
    expect(r.panels.map((p) => p.panel)).toEqual(['t2o', 'mfr', 'mho']);
    for (const p of r.panels) {
      expect(p.activeMemberships, p.panel).toBeGreaterThan(0);
      expect(p.questionBank, p.panel).toBeGreaterThan(0);
      expect(p.membersWithAnswers, p.panel).toBeGreaterThan(0);
      expect(p.completeness.reduce((s, b) => s + b.members, 0), p.panel).toBe(p.membersWithAnswers);
      expect(p.leastAnswered.length, p.panel).toBeGreaterThan(0);
      for (const q of p.leastAnswered) expect(q.coverage).toBeLessThanOrEqual(1);
      expect(p.attributes, p.panel).toEqual([]); // nothing approved yet: pending mappings never count
    }
    await request(t.server).get('/api/v1/profiles/freshness?staleDays=3').set(as('analyst')).expect(400);
  });

  it('counts a member as due for the 6-month check once all their answers are older than the window', async () => {
    // DEMO answer dates are spread over years: start from a panel whose answers are all recent.
    const recent = new Date(Date.now() - 86_400_000);
    await t.app.get(Mongo).profileAnswers.updateMany({ panel: 'mfr' }, { $set: { sourceUpdatedAt: recent, ingestedAt: recent } });
    const before = (await report('analyst', '?panel=mfr')).panels[0]!;
    expect(before.dueForCheck).toBe(0);
    const one = await t.app.get(Mongo).profileAnswers.findOne({ panel: 'mfr' });
    await t.app.get(Mongo).profileAnswers.updateMany(
      { panel: 'mfr', personId: one!.personId },
      { $set: { sourceUpdatedAt: new Date(Date.now() - 400 * 86_400_000), ingestedAt: new Date(Date.now() - 400 * 86_400_000) } },
    );
    const after = (await report('analyst', '?panel=mfr')).panels[0]!;
    expect(after.dueForCheck).toBe(before.dueForCheck + 1);
    const wide = (await report('analyst', '?panel=mfr&staleDays=730')).panels[0]!;
    expect(wide.dueForCheck).toBe(0);
  });

  it('shows attribute coverage once a mapping is approved', async () => {
    const q = await request(t.server).get('/api/v1/mappings/review?panel=t2o').set(as('data_steward')).expect(200);
    const items = (q.body.items ?? q.body) as { id: string; sourceQuestionId: string }[];
    const m = items.find((i) => i.sourceQuestionId === 'gender')!;
    await request(t.server)
      .post(`/api/v1/mappings/${m.id}/decision`)
      .set(as('data_steward'))
      .send({ decision: 'approve', attributeKey: 'demographics.gender', valueMap: { Female: 'female', Male: 'male' } })
      .expect(201);
    const t2o = (await report('analyst', '?panel=t2o')).panels[0]!;
    expect(t2o.attributes).toEqual([expect.objectContaining({ key: 'demographics.gender' })]);
    expect(t2o.attributes[0]!.members).toBeGreaterThan(0);
    expect(t2o.attributes[0]!.coverage).toBeLessThanOrEqual(1);
  });

  it('hides health questions from anyone without health access', async () => {
    const plain = (await report('analyst', '?panel=mho')).panels[0]!;
    expect(plain.hiddenSensitiveQuestions).toBeGreaterThan(0);
    const health = (await report('privacy_officer', '?panel=mho')).panels[0]!;
    expect(health.hiddenSensitiveQuestions).toBe(0);
    const sensitive = new Set(
      (await t.app.get(Mongo).questionVersions.find({ panel: 'mho', sensitivity: 'special_category' }).toArray()).map((x) => x.sourceQuestionId),
    );
    expect(plain.leastAnswered.some((x) => sensitive.has(x.sourceQuestionId))).toBe(false);
  });
});
