import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { PANELS, PANEL_CODES } from '@madp/contracts';
import { attributeDefinitions, panels } from '../db/schema.js';
import { SEED_ATTRIBUTES } from '../ingestion/canonical.js';

/** Applies SQL migrations, then upserts reference data (panels, canonical attributes). Idempotent. */
export async function runMigrations(databaseUrl: string) {
  const pool = new pg.Pool({ connectionString: databaseUrl });
  try {
    const db = drizzle(pool);
    const folder = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../drizzle');
    await migrate(db, { migrationsFolder: folder });
    for (const code of PANEL_CODES) {
      await db
        .insert(panels)
        .values({ code, name: PANELS[code].name, sensitive: PANELS[code].sensitive })
        .onConflictDoNothing();
    }
    for (const a of SEED_ATTRIBUTES) await db.insert(attributeDefinitions).values(a).onConflictDoNothing();
  } finally {
    await pool.end();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  await runMigrations(url);
  console.log('Migrations applied');
}
