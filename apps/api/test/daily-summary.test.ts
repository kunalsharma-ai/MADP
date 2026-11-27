import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

/**
 * The daily summary for T2O, MFR and MHO: sign-ups, completes and points for one India-time day, the day before, the
 * week's average and a 14-day trend, counts only.
 */
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
let db: pg.Client;
const IST = `'Asia/Kolkata'`;
// noon India time yesterday and the day before, so the test passes at any hour
const Y = `(date_trunc('day', now() at time zone ${IST}) - interval '12 hours') at time zone ${IST}`;
const Y2 = `(date_trunc('day', now() at time zone ${IST}) - interval '36 hours') at time zone ${IST}`;
const yesterday = new Date(Date.now() - 86_400_000 + 5.5 * 3600_000).toISOString().slice(0, 10);
const istToday = new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);
const day = (d: string, n: number) =>
  new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '60' });
  token = (await t.adminToken('super_admin')).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server)
      .post(`/api/v1/connectors/${panel}/import`)
      .set('authorization', `Bearer ${token}`)
      .send({ dryRun: false })
      .expect(200);
  db = new pg.Client({ connectionString: t.dbUrl });
  await db.connect();
  await db.query(`update source_identity set source_created_at = now() - interval '400 days'`);
  await db.query(`update survey_participation set ended_at = now() - interval '400 days'`);
  // Per panel: 3 sign-ups yesterday and 1 the day before (India time).
  await db.query(`
    update source_identity set source_created_at = ${Y}
    where id in (select source_identity_id from (select pm.source_identity_id, row_number() over (partition by pm.panel order by pm.id) rn from panel_membership pm) x where rn <= 3)`);
  await db.query(`
    update source_identity set source_created_at = ${Y2}
    where id in (select source_identity_id from (select pm.source_identity_id, row_number() over (partition by pm.panel order by pm.id) rn from panel_membership pm) x where rn = 4)`);
  // 2 completes per panel yesterday, worth 50 points each.
  await db.query(`
    update survey_participation set status = 'complete', points = 50, ended_at = ${Y}
    where id in (select id from (select id, row_number() over (partition by panel order by id) rn from survey_participation) x where rn <= 2)`);
});
afterAll(async () => {
  await db?.end();
  await t?.stop();
});

describe('daily summary', () => {
  it('counts yesterday per panel against the day before, with segments, points and a 14-day trend', async () => {
    const r = await request(t.server)
      .get('/api/v1/daily-summary')
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(r.body.day).toBe(yesterday);
    expect(r.body.timeZone).toBe('Asia/Kolkata');
    expect(r.body.panels.map((p: { panel: string }) => p.panel).sort()).toEqual(['mfr', 'mho', 't2o']);
    for (const p of r.body.panels) {
      expect(p).toMatchObject({ signups: 3, signupsBefore: 1, completes: 2, pointsEarned: 100 });
      expect(p.activeMembers).toBeGreaterThanOrEqual(1);
      expect(p.signupsAvg7).toBeCloseTo(1 / 7, 1);
      expect(p.bySegment.reduce((n: number, s: { n: number }) => Math.max(n, s.n), 0)).toBeLessThanOrEqual(3);
      expect(p.trend).toHaveLength(14);
      expect(p.trend.at(-1)).toEqual({ day: yesterday, signups: 3, completes: 2 });
      expect(p.redemptions).toMatchObject({ n: 0 });
    }
    expect(r.body.totals).toMatchObject({ signups: 9, signupsBefore: 3, completes: 6, pointsEarned: 300 });
    expect(JSON.stringify(r.body)).not.toMatch(/@example\.invalid|email|phone|"name"/i);

    // The day before shows its own numbers.
    const before = await request(t.server)
      .get(`/api/v1/daily-summary?day=${day(yesterday, -1)}`)
      .set('authorization', `Bearer ${token}`)
      .expect(200);
    expect(before.body.totals.signups).toBe(3);
  });

  it('refuses a day in the future and shows a brand admin only their panel', async () => {
    await request(t.server)
      .get(`/api/v1/daily-summary?day=${day(istToday, 1)}`)
      .set('authorization', `Bearer ${token}`)
      .expect(400);
    await request(t.server)
      .get('/api/v1/daily-summary?day=yesterday')
      .set('authorization', `Bearer ${token}`)
      .expect(400);
    const pm = (await t.adminToken('panel_manager', 'ds-mfr@example.invalid', ['mfr'])).token;
    const r = await request(t.server)
      .get('/api/v1/daily-summary')
      .set('authorization', `Bearer ${pm}`)
      .expect(200);
    expect(r.body.panels.map((p: { panel: string }) => p.panel)).toEqual(['mfr']);
    const analyst = (await t.adminToken('analyst', 'ds-analyst@example.invalid')).token;
    expect(
      (
        await request(t.server)
          .get('/api/v1/daily-summary')
          .set('authorization', `Bearer ${analyst}`)
          .expect(200)
      ).body.panels,
    ).toEqual([]);
  });
});
