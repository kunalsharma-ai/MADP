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
import { categoriesFor } from '../src/ingestion/canonical.js';
import { runMigrations } from '../src/scripts/migrate.js';
import { TEST_PG, startTestApp } from './helpers.js';

const DRIZZLE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../drizzle');

/** Audience segments are data: a Super Admin adds, edits, archives, restores and deletes them, Teens included. */
describe('audience segments', () => {
  let t: Awaited<ReturnType<typeof startTestApp>>;
  let boss: string;
  let brandAdmin: string;
  const as = (token: string) => ({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    t = await startTestApp();
    boss = (await t.adminToken('super_admin', 'seg-boss@example.invalid')).token;
    brandAdmin = (await t.adminToken('brand_admin', 'seg-ba@example.invalid')).token;
  }, 120_000);
  afterAll(async () => t?.stop());

  it('lists the five original segments plus Teens, and the seeded rules', async () => {
    const r = await request(t.server).get('/api/v1/audience-segments').set(as(boss)).expect(200);
    expect(r.body.segments.map((s: { key: string }) => s.key)).toEqual([
      'consumer',
      'business_professional',
      'healthcare_professional',
      'patient',
      'caregiver',
      'teen',
    ]);
    expect(r.body.segments.find((s: { key: string }) => s.key === 'teen')).toMatchObject({
      label: 'Teens',
      minors: true,
      builtIn: true,
    });
    // A minor joins the adult segment and Teens, on all three panels.
    for (const [panel, value] of [
      ['t2o', 'minor'],
      ['mfr', 'minor'],
      ['mho', 'minor patient'],
    ] as const)
      expect(categoriesFor(panel, value).map((c) => c.category)).toContain('teen');
    expect(categoriesFor('t2o', 'b2c')).toEqual([{ category: 'consumer', minor: false }]);
  });

  it('keeps Teens a minors segment and built-in segments undeletable', async () => {
    await request(t.server).put('/api/v1/audience-segments/teen').set(as(boss)).send({ minors: false, reason: 'try it' }).expect(400);
    await request(t.server).delete('/api/v1/audience-segments/consumer').set(as(boss)).send({ reason: 'try it' }).expect(400);
  });

  it('only a Super Admin on every brand adds a segment, and its rules apply to sync', async () => {
    const body = { key: 'students', label: 'Students', description: 'In full-time education', reason: 'new segment for Kunal' };
    await request(t.server).post('/api/v1/audience-segments').set(as(brandAdmin)).send(body).expect(403);
    await request(t.server).post('/api/v1/audience-segments').set(as(boss)).send({ ...body, key: 'Bad Key' }).expect(400);
    await request(t.server).post('/api/v1/audience-segments').set(as(boss)).send({ ...body, label: 'Teens' }).expect(409);
    const r = await request(t.server).post('/api/v1/audience-segments').set(as(boss)).send(body).expect(201);
    expect(r.body).toMatchObject({ key: 'students', builtIn: false, status: 'active', minors: false });

    const rule = await request(t.server)
      .post('/api/v1/audience-segments/rules')
      .set(as(boss))
      .send({ panel: 'mfr', sourceValue: 'Student', segment: 'students', reason: 'MFR student sign-ups' })
      .expect(201);
    expect(rule.body).toMatchObject({ panel: 'mfr', sourceValue: 'student', segment: 'students', status: 'active' });
    expect(categoriesFor('mfr', 'student')).toEqual([{ category: 'students', minor: false }]);
    await request(t.server)
      .post('/api/v1/audience-segments/rules')
      .set(as(boss))
      .send({ panel: 'mfr', sourceValue: 'student', segment: 'students', reason: 'twice' })
      .expect(409);

    // The new segment is accepted in audience filters.
    await request(t.server)
      .post('/api/v1/audience/counts')
      .set(as(boss))
      .send({ categories: ['students'] })
      .expect((res) => expect(res.status).toBeLessThan(400));
    await request(t.server)
      .post('/api/v1/audience/counts')
      .set(as(boss))
      .send({ categories: ['nope'] })
      .expect(400);

    // Archive the rule: it stops applying; restore brings it back.
    await request(t.server)
      .post(`/api/v1/audience-segments/rules/${rule.body.id}/archive`)
      .set(as(boss))
      .send({ reason: 'pause it' })
      .expect(200);
    expect(categoriesFor('mfr', 'student')).toEqual([]);
    await request(t.server)
      .post(`/api/v1/audience-segments/rules/${rule.body.id}/restore`)
      .set(as(boss))
      .send({ reason: 'back again' })
      .expect(200);
    expect(categoriesFor('mfr', 'student')).toHaveLength(1);
  });

  it('edits, archives and restores a segment', async () => {
    await request(t.server)
      .put('/api/v1/audience-segments/students')
      .set(as(boss))
      .send({ label: 'Students (18+)', reason: 'clearer name' })
      .expect(200);
    await request(t.server)
      .put('/api/v1/audience-segments/consumer')
      .set(as(boss))
      .send({ label: 'Consumers (adults)', reason: 'built-in may be renamed' })
      .expect(200);
    await request(t.server).post('/api/v1/audience-segments/students/archive').set(as(boss)).send({ reason: 'pause' }).expect(200);
    // An archived segment's rules don't apply, and only admins with connectors.read see it.
    expect(categoriesFor('mfr', 'student')).toEqual([]);
    const list = await request(t.server).get('/api/v1/audience-segments').set(as(boss)).expect(200);
    expect(list.body.segments.find((s: { key: string }) => s.key === 'students').status).toBe('archived');
    await request(t.server).post('/api/v1/audience-segments/students/restore').set(as(boss)).send({ reason: 'bring it back' }).expect(200);
    expect(categoriesFor('mfr', 'student')).toHaveLength(1);
  });

  it('deletes a segment without members, with its rules, and the audit chain still verifies', async () => {
    await request(t.server).delete('/api/v1/audience-segments/students').set(as(brandAdmin)).send({ reason: 'remove' }).expect(403);
    await request(t.server).delete('/api/v1/audience-segments/students').set(as(boss)).send({ reason: 'made by mistake' }).expect(200);
    const list = await request(t.server).get('/api/v1/audience-segments').set(as(boss)).expect(200);
    expect(list.body.segments.map((s: { key: string }) => s.key)).not.toContain('students');
    expect(list.body.rules.some((r: { segment: string }) => r.segment === 'students')).toBe(false);
    expect(categoriesFor('mfr', 'student')).toEqual([]);
    const v = await request(t.server).get('/api/v1/audit/verify').set(as(boss)).expect(200);
    expect(v.body.ok).toBe(true);
  });
});

describe('migration 0023 (segments as data)', () => {
  it('puts members already marked as minors into Teens, next to their adult segment', async () => {
    const name = `madp_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: TEST_PG });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(TEST_PG);
    url.pathname = `/${name}`;
    const dir = mkdtempSync(path.join(tmpdir(), 'madp-mig-'));
    cpSync(DRIZZLE, dir, { recursive: true });
    const journalPath = path.join(dir, 'meta/_journal.json');
    const journal = JSON.parse(readFileSync(journalPath, 'utf8')) as { entries: { tag: string }[] };
    journal.entries = journal.entries.filter((e) => e.tag < '0023');
    writeFileSync(journalPath, JSON.stringify(journal));
    const db = new pg.Client({ connectionString: url.toString() });
    try {
      const pool = new pg.Pool({ connectionString: url.toString(), max: 1 });
      await migrate(drizzle(pool), { migrationsFolder: dir });
      await pool.end();
      await db.connect();
      const p = await db.query(`insert into master_person (data_mode) values ('demo'), ('demo') returning id`);
      const [teen, adult] = p.rows.map((r: { id: string }) => r.id);
      await db.query(
        `insert into category_membership (data_mode, master_person_id, category, panel, basis, is_minor) values
         ('demo', $1, 'consumer', 't2o', 'source_category:minor', true),
         ('demo', $2, 'consumer', 't2o', 'source_category:b2c', false)`,
        [teen, adult],
      );
      await runMigrations(url.toString());
      const rows = await db.query(
        `select master_person_id as id, category, is_minor from category_membership order by category`,
      );
      expect(rows.rows).toEqual(
        expect.arrayContaining([
          { id: teen, category: 'consumer', is_minor: true },
          { id: teen, category: 'teen', is_minor: true },
          { id: adult, category: 'consumer', is_minor: false },
        ]),
      );
      expect(rows.rows).toHaveLength(3);
      await expect(db.query(`update audience_segment set minors = false where key = 'teen'`)).rejects.toThrow(
        /Teens stays a minors segment/,
      );
      await expect(db.query(`delete from audience_segment where key = 'patient'`)).rejects.toThrow(/cannot be deleted/);
    } finally {
      await db.end().catch(() => {});
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });
});
