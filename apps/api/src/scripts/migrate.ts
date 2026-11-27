import { readFileSync } from 'node:fs';
import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { readMigrationFiles } from 'drizzle-orm/migrator';
import pg from 'pg';
import { withSecretFiles } from '@madp/config';
import { PANELS, BUILT_IN_PANEL_CODES } from '@madp/contracts';
import { attributeDefinitions, panels } from '../db/schema.js';
import { SEED_ATTRIBUTES } from '../ingestion/canonical.js';

/** One fixed key, so every process that migrates this database waits for the others (api replicas, create-admin). */
const MIGRATION_LOCK_KEY = 4_206_742_001;

/** Errors that mean the database isn't reachable yet (Swarm starts every service at once), not that it is wrong. */
const NOT_READY_CODES = new Set([
  'ECONNREFUSED',
  'ENOTFOUND',
  'EAI_AGAIN',
  'ETIMEDOUT',
  'ECONNRESET',
  '57P03',
]);

export function isDatabaseNotReady(err: unknown): boolean {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' && NOT_READY_CODES.has(code);
}

/** Where the SQL migrations live: apps/api/drizzle in the repository, /app/drizzle in the image. */
export const MIGRATIONS_FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');

export interface MigrationFile {
  tag: string;
  when: number;
  hash: string;
  sql: string[];
}

/** The migration files in journal order, with the tag name drizzle's reader leaves out. */
export function migrationFiles(folder = MIGRATIONS_FOLDER): MigrationFile[] {
  const files = readMigrationFiles({ migrationsFolder: folder });
  const journal = JSON.parse(readFileSync(path.join(folder, 'meta/_journal.json'), 'utf8')) as {
    entries: { tag: string; when: number }[];
  };
  return files.map((f, i) => ({
    tag: journal.entries[i]!.tag,
    when: f.folderMillis,
    hash: f.hash,
    sql: f.sql,
  }));
}

interface Queryable {
  query<R extends pg.QueryResultRow = pg.QueryResultRow>(
    text: string,
    values?: unknown[],
  ): Promise<pg.QueryResult<R>>;
}

/** Hashes of the migrations this database has applied (none before the first run). */
async function appliedHashes(client: Queryable): Promise<Set<string>> {
  const { rows } = await client.query<{ t: string | null }>(
    `select to_regclass('drizzle.__drizzle_migrations')::text as t`,
  );
  if (!rows[0]?.t) return new Set();
  const applied = await client.query<{ hash: string }>('select hash from drizzle.__drizzle_migrations');
  return new Set(applied.rows.map((r) => r.hash));
}

/** The migrations in the folder that this database has not applied yet. */
export async function pendingMigrations(
  client: Queryable,
  folder = MIGRATIONS_FOLDER,
): Promise<MigrationFile[]> {
  const applied = await appliedHashes(client);
  return migrationFiles(folder).filter((m) => !applied.has(m.hash));
}

/**
 * Issue #95. drizzle's migrator only applies files whose journal time is later than the newest row in its log, so a
 * file with an older time (a branch merged out of order, or a database first migrated from another build) is skipped
 * without a word, and the api then fails on the missing table. This applies every file the log doesn't hold, in
 * journal order and in one transaction, and records it the way drizzle does. A file that can't be applied stops the
 * deploy with its name, instead of an api that answers "Failed query".
 */
async function applySkipped(client: Queryable, folder: string, log: (line: string) => void) {
  const missing = await pendingMigrations(client, folder);
  if (!missing.length) return [];
  log(
    `Applying ${missing.length} migration(s) the migrator skipped: ${missing.map((m) => m.tag).join(', ')}`,
  );
  await client.query('begin');
  let current = '';
  try {
    for (const m of missing) {
      current = m.tag;
      for (const stmt of m.sql) if (stmt.trim()) await client.query(stmt);
      await client.query('insert into drizzle.__drizzle_migrations ("hash", "created_at") values ($1, $2)', [
        m.hash,
        m.when,
      ]);
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw new Error(
      `Migration ${current} is missing from this database and could not be applied: ${(err as Error).message}`,
      { cause: err },
    );
  }
  return missing.map((m) => m.tag);
}

export interface MigrateOptions {
  /** How long to keep retrying while the database is not reachable yet. Default 120 s. */
  waitMs?: number;
  /** Pause between attempts. Default 2 s. */
  retryEveryMs?: number;
  log?: (line: string) => void;
}

async function connectWhenReady(pool: pg.Pool, opts: Required<MigrateOptions>): Promise<pg.PoolClient> {
  const deadline = Date.now() + opts.waitMs;
  for (;;) {
    try {
      return await pool.connect();
    } catch (err) {
      if (!isDatabaseNotReady(err) || Date.now() + opts.retryEveryMs > deadline) throw err;
      opts.log(`Database not reachable yet (${(err as { code: string }).code}), retrying`);
      await sleep(opts.retryEveryMs);
    }
  }
}

/**
 * Applies SQL migrations, then upserts reference data (panels, canonical attributes). Idempotent, and safe to run from
 * several processes at once: it waits for the database to accept connections, then holds a Postgres advisory lock
 * while it migrates.
 */
export async function runMigrations(databaseUrl: string, options: MigrateOptions = {}) {
  const opts: Required<MigrateOptions> = {
    waitMs: options.waitMs ?? 120_000,
    retryEveryMs: options.retryEveryMs ?? 2_000,
    log: options.log ?? (() => {}),
  };
  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  try {
    const client = await connectWhenReady(pool, opts);
    try {
      await client.query('select pg_advisory_lock($1)', [MIGRATION_LOCK_KEY]);
      try {
        const db = drizzle(client);
        const folder = MIGRATIONS_FOLDER;
        await migrate(db, { migrationsFolder: folder });
        await applySkipped(client, folder, opts.log);
        // The built-in panels are seeded by migration 0022; this keeps an older database in step. Panels added on
        // the Panels screen are never touched here.
        for (const [i, code] of BUILT_IN_PANEL_CODES.entries()) {
          const d = PANELS[code];
          await db
            .insert(panels)
            .values({
              code,
              name: d.name,
              shortName: d.shortName,
              siteUrl: d.siteUrl,
              sensitive: d.sensitive,
              builtIn: true,
              sort: i + 1,
            })
            .onConflictDoNothing();
        }
        for (const a of SEED_ATTRIBUTES)
          await db.insert(attributeDefinitions).values(a).onConflictDoNothing();
      } finally {
        await client.query('select pg_advisory_unlock($1)', [MIGRATION_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  } finally {
    await pool.end();
  }
}

/** `migrate.js --status`: what this database has applied and what is still pending. Changes nothing. */
export async function migrationStatus(databaseUrl: string, folder = MIGRATIONS_FOLDER) {
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const applied = await appliedHashes(client);
    const files = migrationFiles(folder);
    return {
      applied: files.filter((m) => applied.has(m.hash)).map((m) => m.tag),
      pending: files.filter((m) => !applied.has(m.hash)).map((m) => m.tag),
      /** Rows in the log that match no file here: the database was migrated by another build. */
      unknown: applied.size - files.filter((m) => applied.has(m.hash)).length,
    };
  } finally {
    await client.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = withSecretFiles().DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  if (process.argv.includes('--status')) {
    const s = await migrationStatus(url);
    console.log(
      `Applied: ${s.applied.length}, pending: ${s.pending.length}, unknown rows in the log: ${s.unknown}`,
    );
    for (const tag of s.pending) console.log(`  pending ${tag}`);
    process.exit(s.pending.length ? 1 : 0);
  }
  await runMigrations(url, { log: console.log });
  console.log('Migrations applied');
}
