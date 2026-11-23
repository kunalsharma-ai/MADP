import { Controller, Get } from '@nestjs/common';
import { sql } from 'drizzle-orm';
import { Public } from '../auth/decorators.js';
import { Database } from '../db/database.js';
import { Mongo } from '../mongo/mongo.js';

@Controller('health')
export class HealthController {
  constructor(
    private readonly database: Database,
    private readonly mongo: Mongo,
  ) {}

  @Public()
  @Get()
  async health() {
    const pg = await this.database.db
      .execute(sql`select 1`)
      .then(() => 'up')
      .catch(() => 'down');
    const mongo = await this.mongo.db
      .command({ ping: 1 })
      .then(() => 'up')
      .catch(() => 'down');
    return { status: pg === 'up' && mongo === 'up' ? 'ok' : 'degraded', postgres: pg, mongodb: mongo };
  }
}
