import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { runMigrations } from '../src/scripts/migrate.js';
import { TEST_PG } from './helpers.js';

// Issue #67: on a fresh Swarm deploy nothing had migrated, so create-admin failed with "admin_user does not exist".
// Every api replica and create-admin now migrate first, so these runs can overlap.
describe('runMigrations', () => {
  it('migrates a fresh database once when several processes start together', async () => {
    const name = `madp_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: TEST_PG });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(TEST_PG);
    url.pathname = `/${name}`;
    try {
      await Promise.all([1, 2, 3].map(() => runMigrations(url.toString())));
      await runMigrations(url.toString());
      const db = new pg.Client({ connectionString: url.toString() });
      await db.connect();
      try {
        const { rows } = await db.query(`select to_regclass('public.admin_user') as t`);
        expect(rows[0].t).toBe('admin_user');
        const journal = await db.query(
          'select count(*)::int as n, count(distinct hash)::int as d from drizzle.__drizzle_migrations',
        );
        expect(journal.rows[0].n).toBe(journal.rows[0].d);
        expect(journal.rows[0].n).toBeGreaterThan(20);
        const panels = await db.query('select count(*)::int as n from panel');
        expect(panels.rows[0].n).toBe(3);
      } finally {
        await db.end();
      }
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });

  it('gives up with the connection error when the database never becomes reachable', async () => {
    await expect(
      runMigrations('postgres://madp:madp@127.0.0.1:1/madp', { waitMs: 300, retryEveryMs: 100 }),
    ).rejects.toMatchObject({ code: 'ECONNREFUSED' });
  });
});
