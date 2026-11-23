import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import pg from 'pg';
import { API_ENV } from '../common/tokens.js';
import type { ApiEnv } from '@madp/config';
import * as schema from './schema.js';

export type Db = NodePgDatabase<typeof schema>;

@Injectable()
export class Database implements OnModuleDestroy {
  readonly pool: pg.Pool;
  readonly db: Db;

  constructor(@Inject(API_ENV) env: ApiEnv) {
    this.pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 10 });
    this.db = drizzle(this.pool, { schema });
  }

  async onModuleDestroy() {
    await this.pool.end();
  }
}
