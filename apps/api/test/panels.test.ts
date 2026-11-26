import { randomBytes } from 'node:crypto';
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import request from 'supertest';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { ConnectorRegistry } from '../src/connectors/connector-registry.js';
import { SyncScheduler } from '../src/ingestion/sync-scheduler.js';
import { runMigrations } from '../src/scripts/migrate.js';
import { TEST_PG, startTestApp } from './helpers.js';

const DRIZZLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** Panels are data: a Super Admin adds, edits, archives, restores and deletes them; the built-in three are fixed. */
describe('panels', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let boss: string;
  let brandAdmin: string;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await startTestApp();
    boss = (await t.adminToken('super_admin', 'boss@example.invalid')).token;
    brandAdmin = (await t.adminToken('brand_admin', 'ba@example.invalid')).token;
  }, 120_000);
  afterAll(async () => t?.stop());

  it('lists the three built-in panels in screen order', async () => {
    const r = await request(t.server).get('/api/v1/panels').set(as(boss)).expect(200);
    expect(r.body.panels.map((p: { code: string }) => p.code)).toEqual(['t2o', 'mfr', 'mho']);
    expect(r.body.panels.every((p: { builtIn: boolean }) => p.builtIn)).toBe(true);
    expect(r.body.panels.find((p: { code: string }) => p.code === 'mho').sensitive).toBe(true);
  });

  it('refuses to archive, delete or un-flag the built-in panels', async () => {
    await request(t.server).post('/api/v1/panels/mfr/archive').set(as(boss)).send({ reason: 'try it' }).expect(400);
    await request(t.server).delete('/api/v1/panels/t2o').set(as(boss)).send({ reason: 'try it' }).expect(400);
    await request(t.server).put('/api/v1/panels/mho').set(as(boss)).send({ sensitive: false, reason: 'try it' }).expect(400);
  });

  it('only a Super Admin on every brand adds a panel', async () => {
    const body = {
      code: 'kidz',
      name: 'Demo Kidz Panel',
      shortName: 'KDZ',
      origins: ['www.kidz.example.invalid'],
      reason: 'new brand on the shared backend',
    };
    await request(t.server).post('/api/v1/panels').set(as(brandAdmin)).send(body).expect(403);
    await request(t.server).post('/api/v1/panels').set(as(boss)).send({ ...body, code: 'Bad Code' }).expect(400);
    await request(t.server)
      .post('/api/v1/panels')
      .set(as(boss))
      .send({ ...body, origins: ['www.myfrequentrewards.com'] })
      .expect(409);
    const r = await request(t.server).post('/api/v1/panels').set(as(boss)).send(body).expect(201);
    expect(r.body).toMatchObject({ code: 'kidz', builtIn: false, status: 'active', sensitive: false });
    await request(t.server).post('/api/v1/panels').set(as(boss)).send(body).expect(409);

    // The new panel shows up everywhere panels are listed, on DEMO until it is connected.
    const brands = await request(t.server).get('/api/v1/brands').set(as(boss)).expect(200);
    expect(brands.body.brands.map((b: { panel: string }) => b.panel)).toEqual(['t2o', 'mfr', 'mho', 'kidz']);
    const conns = await request(t.server).get('/api/v1/panel-connections').set(as(boss)).expect(200);
    expect(conns.body.panels.find((p: { panel: string }) => p.panel === 'kidz')).toMatchObject({
      dataMode: 'demo',
      syncBaseUrl: { value: null, source: 'none' },
    });
    expect(t.app.get(ConnectorRegistry).all().map((s) => s.panel)).toContain('kidz');
    const connectors = await request(t.server).get('/api/v1/connectors').set(as(boss)).expect(200);
    expect(connectors.body.find((c: { panel: string }) => c.panel === 'kidz')).toMatchObject({ sourceRepository: null });
  });

  it('edits a panel, and its name follows into Brands & settings', async () => {
    await request(t.server)
      .put('/api/v1/panels/kidz')
      .set(as(boss))
      .send({ name: 'Demo Kidz Rewards', sensitive: true, reason: 'renamed by Kunal' })
      .expect(200);
    const brands = await request(t.server).get('/api/v1/brands').set(as(boss)).expect(200);
    expect(brands.body.brands.find((b: { panel: string }) => b.panel === 'kidz').displayName).toBe('Demo Kidz Rewards');
    // No data yet, so the health flag may still be turned off again.
    await request(t.server)
      .put('/api/v1/panels/kidz')
      .set(as(boss))
      .send({ sensitive: false, reason: 'not a health panel' })
      .expect(200);
  });

  it('archives a panel (no sync, gone from the switcher) and restores it', async () => {
    await request(t.server).post('/api/v1/panels/kidz/archive').set(as(boss)).send({ reason: 'pause the brand' }).expect(200);
    expect(t.app.get(ConnectorRegistry).all().map((s) => s.panel)).not.toContain('kidz');
    expect(t.app.get(SyncScheduler).panels()).not.toContain('kidz');
    const brands = await request(t.server).get('/api/v1/brands').set(as(boss)).expect(200);
    expect(brands.body.brands.map((b: { panel: string }) => b.panel)).not.toContain('kidz');
    const list = await request(t.server).get('/api/v1/panels').set(as(boss)).expect(200);
    expect(list.body.panels.find((p: { code: string }) => p.code === 'kidz').status).toBe('archived');
    await request(t.server).post('/api/v1/panels/kidz/restore').set(as(boss)).send({ reason: 'back again' }).expect(200);
    expect(t.app.get(ConnectorRegistry).all().map((s) => s.panel)).toContain('kidz');
  });

  it('deletes a panel that holds no data', async () => {
    await request(t.server).delete('/api/v1/panels/kidz').set(as(brandAdmin)).send({ reason: 'remove it' }).expect(403);
    await request(t.server).delete('/api/v1/panels/kidz').set(as(boss)).send({ reason: 'created by mistake' }).expect(200);
    const list = await request(t.server).get('/api/v1/panels').set(as(boss)).expect(200);
    expect(list.body.panels.map((p: { code: string }) => p.code)).toEqual(['t2o', 'mfr', 'mho']);
    // The audit trail still holds the panel's history, and the chain still verifies.
    const v = await request(t.server).get('/api/v1/audit/verify').set(as(boss)).expect(200);
    expect(v.body.ok).toBe(true);
  });
});

describe('migration 0022 (panels as data)', () => {
  it('keeps an audit chain written before it valid', async () => {
    const name = `madp_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: TEST_PG });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(TEST_PG);
    url.pathname = `/${name}`;
    // A copy of the migrations up to 0021, i.e. the schema before panels became data.
    const dir = mkdtempSync(path.join(tmpdir(), 'madp-mig-'));
    cpSync(DRIZZLE, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag < '0022');
    writeFileSync(journalPath, JSON.stringify(journal));
    const db = new pg.Client({ connectionString: url.toString() });
    try {
      const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
      await migrate(drizzle(pool), { migrationsFolder: dir });
      await pool.end();
      await db.connect();
      await db.query(`insert into panel (code, name, sensitive) values ('t2o','Turn2Opinion',false),('mfr','MyFrequentRewards',false),('mho','MyHealthOpinions',true)`);
      for (const p of ['t2o', 'mfr', 'mho', null])
        await db.query(
          `insert into audit_event (actor_type, panel, action, target_type, metadata) values ('system', $1, 'test.before', 'x', '{}')`,
          [p],
        );
      await runMigrations(url.toString());
      const bad = await db.query(
        `select count(*)::int as n from audit_event a where a.hash <> madp_audit_hash(a.prev_hash, a)`,
      );
      expect(bad.rows[0].n).toBe(0);
      const panels = await db.query(`select code, short_name, built_in, sensitive from panel order by sort`);
      expect(panels.rows).toEqual([
        { code: 't2o', short_name: 'T2O', built_in: true, sensitive: false },
        { code: 'mfr', short_name: 'MFR', built_in: true, sensitive: false },
        { code: 'mho', short_name: 'MHO', built_in: true, sensitive: true },
      ]);
      await expect(db.query(`update panel set sensitive = false where code = 'mho'`)).rejects.toThrow(/MHO stays sensitive/);
      await expect(db.query(`delete from panel where code = 't2o'`)).rejects.toThrow(/cannot be deleted/);
    } finally {
      await db.end().catch(() => {});
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });
});
