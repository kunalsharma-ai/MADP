import { randomBytes } from 'node:crypto';
import pg from 'pg';
import { describe, expect, it } from 'vitest';
import { MIGRATIONS_FOLDER, migrationFiles, migrationStatus, runMigrations } from '../src/scripts/migrate.js';
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

// Issue #95: drizzle skips a file whose journal time is older than the newest row in its log, so panel_connection
// (and every later table) was never created and the Panel connections screen failed with "Failed query".
describe('runMigrations with an out-of-order migration log', () => {
  it('applies the migrations drizzle skipped and reports nothing pending', async () => {
    const name = `madp_test_${randomBytes(4).toString('hex')}`;
    const admin = new pg.Client({ connectionString: TEST_PG });
    await admin.connect();
    await admin.query(`create database ${name}`);
    const url = new URL(TEST_PG);
    url.pathname = `/${name}`;
    try {
      await runMigrations(url.toString());
      const files = migrationFiles();
      const cut = files.findIndex((m) => m.tag.startsWith('0021_'));
      const db = new pg.Client({ connectionString: url.toString() });
      await db.connect();
      try {
        // Undo 0021 onwards, then leave a log row newer than all of them, as a database migrated by another build has.
        await db.query('drop schema public cascade; create schema public');
        await db.query('delete from drizzle.__drizzle_migrations');
        await db.end();
        // Re-create the database up to 0020 only, using a folder that holds just those files.
        const { mkdtempSync, cpSync, writeFileSync, readFileSync } = await import('node:fs');
        const { tmpdir } = await import('node:os');
        const pathMod = await import('node:path');
        const partial = mkdtempSync(pathMod.join(tmpdir(), 'madp-mig-'));
        cpSync(MIGRATIONS_FOLDER, partial, { recursive: true });
        const journal = JSON.parse(readFileSync(pathMod.join(partial, 'meta/_journal.json'), 'utf8'));
        journal.entries = journal.entries.slice(0, cut);
        writeFileSync(pathMod.join(partial, 'meta/_journal.json'), JSON.stringify(journal));
        const { drizzle } = await import('drizzle-orm/node-postgres');
        const { migrate } = await import('drizzle-orm/node-postgres/migrator');
        const c = new pg.Client({ connectionString: url.toString() });
        await c.connect();
        await migrate(drizzle(c), { migrationsFolder: partial });
        await c.query(
          'update drizzle.__drizzle_migrations set created_at = $1 where id = (select max(id) from drizzle.__drizzle_migrations)',
          [files.at(-1)!.when + 1],
        );
        expect((await migrationStatus(url.toString())).pending.length).toBe(files.length - cut);

        await runMigrations(url.toString());

        const { rows } = await c.query(`select to_regclass('public.panel_connection')::text as t`);
        expect(rows[0].t).toBe('panel_connection');
        expect(await migrationStatus(url.toString())).toMatchObject({ pending: [], unknown: 0 });
        await c.end();
      } finally {
        await db.end().catch(() => {});
      }
    } finally {
      await admin.query(`drop database if exists ${name} with (force)`);
      await admin.end();
    }
  });
});
