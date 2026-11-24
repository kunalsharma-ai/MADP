import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sql } from 'drizzle-orm';
import type { SourceResponse, SourceReward } from '@madp/contracts';
import type { DemoConnector } from '@madp/connectors';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { Database } from '../src/db/database.js';
import { startTestApp } from './helpers.js';

/**
 * Loyalty mirror on DEMO data for all three panels: wallets per panel membership, never added across panels;
 * survey completes pending until the client's approval is recorded; an append-only ledger that follows the
 * panel's changes; and reconciliation against a full read of the panel's feeds, with repair.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
const tok: Record<string, string> = {};
const as = (who: string) => ({ authorization: `Bearer ${tok[who]}` });
const q = async <R extends Record<string, unknown>>(query: ReturnType<typeof sql>) =>
  (await t.app.get(Database).db.execute<R>(query)).rows;
const demo = (panel: 't2o' | 'mfr' | 'mho') => t.app.get(ConnectorRegistry).get(panel).connector as DemoConnector;
const liability = async () =>
  (await request(t.server).get('/api/v1/loyalty/liability').set(as('support')).expect(200)).body as {
    unit: string;
    panels: { panel: string; accounts: number; approved: number; pending: number; reversed: number; pendingBySurvey: { survey: string; completes: number; points: number }[] }[];
  };
const imports: Record<string, { loyalty: { status: string; linesWritten: number; rewardsSeen: number } }> = {};

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '80' });
  for (const role of ['super_admin', 'data_steward', 'privacy_officer', 'platform_admin', 'support', 'analyst'] as const)
    tok[role] = (await t.adminToken(role)).token;
  for (const panel of ['t2o', 'mfr', 'mho']) {
    const r = await request(t.server).post(`/api/v1/connectors/${panel}/import`).set(as('super_admin')).send({ dryRun: false }).expect(200);
    imports[panel] = r.body.counts;
  }
});
afterAll(async () => t?.stop());

describe('wallet mirror', () => {
  it('mirrors each panel on import, separately, and re-reading books nothing twice', async () => {
    for (const panel of ['t2o', 'mfr', 'mho']) {
      expect(imports[panel]!.loyalty, panel).toMatchObject({ status: 'succeeded' });
      expect(imports[panel]!.loyalty.linesWritten, panel).toBeGreaterThan(0);
    }
    const l = await liability();
    expect(l.unit).toBe('points');
    expect(l.panels.map((p) => p.panel)).toEqual(['mfr', 'mho', 't2o']);
    for (const p of l.panels) {
      expect(p.approved % 50, p.panel).toBe(0); // only 50-point profile credits are approved
      expect(p.pending, p.panel).toBeGreaterThan(0); // survey completes wait for approval
      expect(p.reversed, p.panel).toBe(0);
    }
    const again = await request(t.server).post('/api/v1/loyalty/t2o/sync').set(as('platform_admin')).expect(200);
    expect(again.body).toMatchObject({ status: 'succeeded', linesWritten: 0 });
    const sync = await request(t.server).post('/api/v1/connectors/mfr/sync').set(as('super_admin')).expect(200);
    expect(sync.body.counts.loyalty).toMatchObject({ status: 'succeeded', linesWritten: 0 });
    await request(t.server).post('/api/v1/loyalty/t2o/sync').set(as('data_steward')).expect(403);
    await request(t.server).get('/api/v1/loyalty/liability').set(as('analyst')).expect(403);
  });

  it('keeps one wallet per panel for a person on two panels, and audits the read', async () => {
    const [p] = await q<{ person: string }>(sql`
      select pm.master_person_id as person from loyalty_account la join panel_membership pm on pm.id = la.panel_membership_id
      group by pm.master_person_id having count(distinct la.panel) > 1 limit 1`);
    const r = await request(t.server).get(`/api/v1/loyalty/persons/${p!.person}`).set(as('support')).expect(200);
    expect(r.body.accounts.length).toBeGreaterThan(1);
    expect(new Set(r.body.accounts.map((a: { panel: string }) => a.panel)).size).toBe(r.body.accounts.length);
    expect(r.body).not.toHaveProperty('total');
    for (const a of r.body.accounts) expect(a.lines.every((l: { points: number }) => typeof l.points === 'number')).toBe(true);
    const [audit] = await q<{ n: string }>(sql`select count(*) as n from audit_event where action = 'loyalty.wallet_viewed'`);
    expect(Number(audit!.n)).toBe(1);
  });

  it('moves a survey’s completes to approved only when the client approval is recorded', async () => {
    const before = (await liability()).panels.find((p) => p.panel === 't2o')!;
    const survey = before.pendingBySurvey[0]!;
    await request(t.server)
      .post('/api/v1/loyalty/t2o/survey-approvals')
      .set(as('data_steward'))
      .send({ surveySlug: survey.survey, note: 'Client sign-off' })
      .expect(403);
    const ok = await request(t.server)
      .post('/api/v1/loyalty/t2o/survey-approvals')
      .set(as('privacy_officer'))
      .send({ surveySlug: survey.survey, note: 'Client sign-off 2026-11-24' })
      .expect(201);
    expect(ok.body).toMatchObject({ panel: 't2o', surveySlug: survey.survey, completes: survey.completes, points: survey.points });
    const after = (await liability()).panels.find((p) => p.panel === 't2o')!;
    expect(after.pending).toBe(before.pending - survey.points);
    expect(after.approved).toBe(before.approved + survey.points);
    // Other panels are untouched, and approving again finds nothing pending.
    await request(t.server)
      .post('/api/v1/loyalty/t2o/survey-approvals')
      .set(as('privacy_officer'))
      .send({ surveySlug: survey.survey, note: 'Again' })
      .expect(409);
    // The next mirror run keeps the approval while the panel keeps the complete as it was.
    expect((await request(t.server).post('/api/v1/loyalty/t2o/sync').set(as('platform_admin')).expect(200)).body.linesWritten).toBe(0);
  });

  it('refuses to change or delete ledger lines', async () => {
    await expect(q(sql`update reward_ledger set points = 0 where id = (select min(id) from reward_ledger)`)).rejects.toThrow();
    await expect(q(sql`delete from reward_ledger where id = (select min(id) from reward_ledger)`)).rejects.toThrow();
  });
});

describe('reconciliation', () => {
  it('finds reversals, gone rows and unknown members, and repairs what it can', async () => {
    const c = demo('mho');
    const rewards: SourceReward[] = [];
    const responses: SourceResponse[] = [];
    for (const [feed, out] of [
      [c.rewardChanges.bind(c), rewards],
      [c.responseChanges.bind(c), responses],
    ] as const) {
      let cursor: string | null = null;
      for (;;) {
        const page: { items: unknown[]; cursor: string | null; more: boolean } = await feed({ cursor, since: null, limit: 1000 });
        (out as unknown[]).push(...page.items);
        cursor = page.cursor;
        if (!page.more) break;
      }
    }
    const clean = await request(t.server).post('/api/v1/loyalty/mho/reconcile').set(as('platform_admin')).send({}).expect(200);
    expect(clean.body).toMatchObject({ matches: true, missing: 0, different: 0, onlyInMadp: 0 });
    // MADP holds completes as pending, which the panel counts as earned: the balances agree in total.
    expect(clean.body.balanceDifference).toBe(0);

    const complete = responses.find((r) => r.status === 'complete')!;
    const gone = rewards[1]!;
    c.rewardsOverride = [
      { ...rewards[0]!, status: 'reversed' },
      ...rewards.slice(2),
      { ...rewards[0]!, sourceRewardId: 'demo-rw-unknown', sourceMemberId: 'demo-nobody' },
    ];
    c.responsesOverride = responses.map((r) => (r === complete ? { ...r, status: 'terminate', points: 0 } : r));

    const found = await request(t.server).post('/api/v1/loyalty/mho/reconcile').set(as('platform_admin')).send({}).expect(200);
    expect(found.body).toMatchObject({ matches: false, missing: 0, different: 2, onlyInMadp: 1, unmatched: 1 });
    expect(found.body.samples.different).toEqual(expect.arrayContaining([rewards[0]!.sourceRewardId, complete.sourceResponseId]));
    expect(found.body.samples.onlyInMadp).toEqual([gone.sourceRewardId]);

    const fixed = await request(t.server).post('/api/v1/loyalty/mho/reconcile').set(as('platform_admin')).send({ repair: true }).expect(200);
    expect(fixed.body).toMatchObject({ matches: true, repaired: true, unmatched: 1 });
    expect(fixed.body.repairedLines).toBeGreaterThan(0);
    const mho = (await liability()).panels.find((p) => p.panel === 'mho')!;
    expect(mho.reversed).toBe(50 + 50 + complete.points);
    const lines = await q<{ bucket: string; points: number; seq: number }>(sql`
      select bucket, points, seq from reward_ledger where panel = 'mho' and source_ref = ${rewards[0]!.sourceRewardId} order by seq`);
    expect(lines).toEqual([
      { bucket: 'approved', points: 50, seq: 1 },
      { bucket: 'approved', points: -50, seq: 2 },
      { bucket: 'reversed', points: 50, seq: 3 },
    ]);
    const history = await request(t.server).get('/api/v1/loyalty/reconciliations?panel=mho').set(as('support')).expect(200);
    expect(history.body.map((h: { repaired: boolean }) => h.repaired)).toEqual([true, false, false]);
    c.rewardsOverride = null;
    c.responsesOverride = null;
  });

  it('reports a panel without the feeds instead of failing its sync', async () => {
    const c = demo('t2o') as unknown as { rewardChanges?: unknown };
    const saved = c.rewardChanges;
    c.rewardChanges = undefined;
    try {
      const r = await request(t.server).post('/api/v1/connectors/t2o/sync').set(as('super_admin')).expect(200);
      expect(r.body.status).toBe('succeeded');
      expect(r.body.counts.loyalty).toMatchObject({ status: 'not_supported' });
    } finally {
      c.rewardChanges = saved;
    }
  });
});
