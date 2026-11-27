import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startTestApp } from './helpers.js';

/** Admin alert rules on T2O, MFR and MHO: each admin's own thresholds, checked against synced counts. */
let t: Awaited<ReturnType<typeof startTestApp>>;
let token: string;
let db: pg.Client;
const as = (tk: string) => ({ authorization: `Bearer ${tk}` });

beforeAll(async () => {
  t = await startTestApp({ DEMO_POPULATION_SIZE: '60' });
  token = (await t.adminToken('super_admin')).token;
  for (const panel of ['t2o', 'mfr', 'mho'])
    await request(t.server)
      .post(`/api/v1/connectors/${panel}/import`)
      .set(as(token))
      .send({ dryRun: false })
      .expect(200);
  db = new pg.Client({ connectionString: t.dbUrl });
  await db.connect();
  await db.query(`update source_identity set source_created_at = now() - interval '400 days'`);
  await db.query(`update survey_participation set ended_at = now() - interval '400 days'`);
  // 5 sign-ups per panel in the last half hour; 2 survey completes per panel 5 hours ago.
  await db.query(`
    update source_identity set source_created_at = now() - interval '30 minutes'
    where id in (select source_identity_id from (select pm.source_identity_id, row_number() over (partition by pm.panel order by pm.id) rn from panel_membership pm) x where rn <= 5)`);
  await db.query(`
    update survey_participation set status = 'complete', ended_at = now() - interval '5 hours'
    where id in (select id from (select id, row_number() over (partition by panel order by id) rn from survey_participation) x where rn <= 2)`);
});
afterAll(async () => {
  await db?.end();
  await t?.stop();
});

describe('admin alert rules', () => {
  it('fires per panel when a count crosses the threshold, and can be muted', async () => {
    const many = await request(t.server)
      .post('/api/v1/alert-rules')
      .set(as(token))
      .send({ name: 'Sign-up spike', metric: 'signups', comparator: 'above', threshold: 3, window: 'hour' });
    expect(many.status, JSON.stringify(many.body)).toBe(201);
    expect(many.body.current.map((c: { panel: string }) => c.panel).sort()).toEqual(['mfr', 'mho', 't2o']);
    expect(
      many.body.current.every((c: { value: number; firing: boolean }) => c.value === 5 && c.firing),
    ).toBe(true);

    const quiet = await request(t.server)
      .post('/api/v1/alert-rules')
      .set(as(token))
      .send({
        name: 'Too few completes on MFR',
        panel: 'mfr',
        metric: 'completes',
        comparator: 'below',
        threshold: 3,
        window: 'day',
      })
      .expect(201);
    expect(quiet.body.current).toEqual([{ panel: 'mfr', value: 2, firing: true }]);
    // the last hour had no completes, the last day had 2: the window matters
    await request(t.server)
      .put(`/api/v1/alert-rules/${quiet.body.id}`)
      .set(as(token))
      .send({
        name: 'Too few completes on MFR',
        panel: 'mfr',
        metric: 'completes',
        comparator: 'below',
        threshold: 2,
        window: 'day',
      })
      .expect(200)
      .expect((r) => expect(r.body.current[0]).toMatchObject({ value: 2, firing: false }));

    let all = (await request(t.server).get('/api/v1/alert-rules').set(as(token)).expect(200)).body;
    expect(all.rules).toHaveLength(2);
    expect(all.firing).toHaveLength(3);
    expect(all.firing[0]).toMatchObject({
      name: 'Sign-up spike',
      value: 5,
      threshold: 3,
      comparator: 'above',
      window: 'hour',
    });

    await request(t.server)
      .post(`/api/v1/alert-rules/${many.body.id}/mute`)
      .set(as(token))
      .send({ hours: 4 })
      .expect(200);
    all = (await request(t.server).get('/api/v1/alert-rules').set(as(token)).expect(200)).body;
    expect(all.firing).toHaveLength(0);
    await request(t.server)
      .post(`/api/v1/alert-rules/${many.body.id}/mute`)
      .set(as(token))
      .send({ hours: 0 })
      .expect(200);
    expect((await request(t.server).get('/api/v1/alert-rules').set(as(token))).body.firing).toHaveLength(3);
    expect(JSON.stringify(all)).not.toMatch(/@example\.invalid|email|phone/i);
  });

  it('keeps rules per admin and per panel access, checks the input, and audits changes', async () => {
    const pm = (await t.adminToken('panel_manager', 'ar-mho@example.invalid', ['mho'])).token;
    expect((await request(t.server).get('/api/v1/alert-rules').set(as(pm)).expect(200)).body.rules).toEqual(
      [],
    );
    await request(t.server)
      .post('/api/v1/alert-rules')
      .set(as(pm))
      .send({
        name: 'Not my panel',
        panel: 't2o',
        metric: 'signups',
        comparator: 'above',
        threshold: 1,
        window: 'day',
      })
      .expect(400);
    await request(t.server)
      .post('/api/v1/alert-rules')
      .set(as(pm))
      .send({
        name: 'Segment on completes',
        metric: 'completes',
        segment: 'patient',
        comparator: 'above',
        threshold: 1,
        window: 'day',
      })
      .expect(400);
    await request(t.server)
      .post('/api/v1/alert-rules')
      .set(as(pm))
      .send({ name: 'x', metric: 'signups', comparator: 'above', threshold: -1, window: 'week' })
      .expect(400);
    const own = await request(t.server)
      .post('/api/v1/alert-rules')
      .set(as(pm))
      .send({
        name: 'Patients',
        metric: 'signups',
        segment: 'patient',
        comparator: 'above',
        threshold: 0,
        window: 'hour',
      })
      .expect(201);
    expect(own.body.current.map((c: { panel: string }) => c.panel)).toEqual(['mho']);
    // another admin's rule cannot be changed or removed
    const other = (await request(t.server).get('/api/v1/alert-rules').set(as(token))).body.rules[0].id;
    await request(t.server).post(`/api/v1/alert-rules/${other}/remove`).set(as(pm)).expect(404);
    await request(t.server).post(`/api/v1/alert-rules/${own.body.id}/remove`).set(as(pm)).expect(200);
    const audit = await db.query(
      `select action from audit_event where action like 'alert_rule.%' order by id`,
    );
    expect(audit.rows.map((r) => r.action)).toEqual([
      'alert_rule.created',
      'alert_rule.created',
      'alert_rule.changed',
      'alert_rule.created',
      'alert_rule.removed',
    ]);
    const analyst = (await t.adminToken('analyst', 'ar-analyst@example.invalid')).token;
    await request(t.server).get('/api/v1/alert-rules').set(as(analyst)).expect(403);
  });
});
