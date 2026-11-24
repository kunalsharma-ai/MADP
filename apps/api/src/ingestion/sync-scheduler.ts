import {
  Inject,
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { ApiEnv } from '@madp/config';
import type { PanelCode } from '@madp/contracts';
import { API_ENV } from '../common/tokens.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';
import { Database } from '../db/database.js';
import { IngestionService } from './ingestion.service.js';

/** How long to wait before asking again a panel that does not serve its changes feed yet. */
const NOT_SUPPORTED_BACKOFF_MS = 60 * 60_000;

/**
 * Runs the automatic sync of each live panel every SYNC_INTERVAL_MINUTES (off when 0, the default). Only panels
 * whose live access was approved (LIVE_SOURCE_APPROVED_PANELS) and that run LIVE are scheduled; DEMO panels are
 * synced on request only. A Postgres advisory lock per panel keeps two API instances from syncing the same
 * panel at once, and a run never starts while the previous one for that panel is still going.
 */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly busy = new Set<PanelCode>();
  private readonly notSupportedUntil = new Map<PanelCode, number>();
  private stopped = false;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly registry: ConnectorRegistry,
    private readonly database: Database,
    private readonly ingestion: IngestionService,
  ) {}

  /** Panels the schedule covers. */
  panels(): PanelCode[] {
    return this.registry
      .all()
      .filter((s) => s.dataMode === 'live' && this.env.LIVE_SOURCE_APPROVED_PANELS.includes(s.panel))
      .map((s) => s.panel);
  }

  get intervalMinutes() {
    return this.env.SYNC_INTERVAL_MINUTES;
  }

  onApplicationBootstrap() {
    if (!this.env.SYNC_INTERVAL_MINUTES) return;
    const panels = this.panels();
    if (!panels.length) {
      this.log.log('Automatic sync is on, but no panel runs LIVE; nothing is scheduled');
      return;
    }
    this.log.log(`Automatic sync every ${this.env.SYNC_INTERVAL_MINUTES} min for ${panels.join(', ')}`);
    this.timer = setInterval(() => void this.tick(), this.env.SYNC_INTERVAL_MINUTES * 60_000);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** One round over every scheduled panel. Exposed for tests. */
  async tick(now = Date.now()) {
    for (const panel of this.panels()) {
      if (this.stopped) return;
      if ((this.notSupportedUntil.get(panel) ?? 0) > now) continue;
      await this.runLocked(panel);
    }
  }

  /** Runs one sync of a panel under the cluster-wide lock. Returns null when another run holds the lock. */
  async runLocked(panel: PanelCode, requestedBy: string | null = null) {
    if (this.busy.has(panel)) return null;
    this.busy.add(panel);
    const client = await this.database.pool.connect();
    try {
      const key = `madp.sync.${panel}`;
      const got = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [
        key,
      ]);
      if (!got.rows[0]?.ok) return null;
      try {
        const res = await this.ingestion.runSync(panel, {
          requestedBy,
          maxPages: this.env.SYNC_MAX_PAGES,
        });
        if (res.status === 'not_supported') {
          this.notSupportedUntil.set(panel, Date.now() + NOT_SUPPORTED_BACKOFF_MS);
          this.log.warn(`${panel}: ${res.error}. Asking again in an hour.`);
        } else this.notSupportedUntil.delete(panel);
        return res;
      } finally {
        await client.query('select pg_advisory_unlock(hashtext($1))', [key]);
      }
    } catch (e) {
      this.log.error(`Sync of ${panel} failed to start: ${(e as Error).message}`);
      throw e;
    } finally {
      client.release();
      this.busy.delete(panel);
    }
  }
}
