import path from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { withSecretFiles } from '@madp/config';
import { PANELS, PANEL_CODES } from '@madp/contracts';
import { attributeDefinitions, panels } from '../db/schema.js';
import { SEED_ATTRIBUTES } from '../ingestion/canonical.js';

/** One fixed key, so every process that migrates this database waits for the others (two api replicas, a job). */
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
        const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
        await migrate(db, { migrationsFolder: folder });
        for (const code of PANEL_CODES) {
          await db
            .insert(panels)
            .values({ code, name: PANELS[code].name, sensitive: PANELS[code].sensitive })
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

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = withSecretFiles().DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await runMigrations(url, { log: console.log });
  console.log('Migrations applied');
}
