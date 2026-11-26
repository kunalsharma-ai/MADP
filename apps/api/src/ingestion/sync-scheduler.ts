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

/** How often the scheduler checks which panels are due. */
const CHECK_EVERY_MS = 60_000;

/**
 * Runs the automatic sync of each live panel at its own interval: the one set on Panel connections, else
 * SYNC_INTERVAL_MINUTES (off when 0, the default). Only panels whose live access was approved and that run LIVE
 * are scheduled; DEMO panels are synced on request only. A change on Panel connections takes effect at the next
 * check, without a restart. A Postgres advisory lock per panel keeps two API instances from syncing the same
 * panel at once, and a run never starts while the previous one for that panel is still going.
 */
@Injectable()
export class SyncScheduler implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly log = new Logger(SyncScheduler.name);
  private timer: NodeJS.Timeout | null = null;
  private readonly busy = new Set<PanelCode>();
  private readonly notSupportedUntil = new Map<PanelCode, number>();
  private readonly lastStarted = new Map<PanelCode, number>();
  private startedAt = Date.now();
  private stopped = false;

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly registry: ConnectorRegistry,
    private readonly database: Database,
    private readonly ingestion: IngestionService,
  ) {}

  /** Panels the schedule covers: live, approved, with an interval above 0. */
  panels(): PanelCode[] {
    return this.registry
      .all()
      .filter((s) => s.dataMode === 'live' && this.registry.connection(s.panel).liveApproved)
      .filter((s) => this.intervalFor(s.panel) > 0)
      .map((s) => s.panel);
  }

  intervalFor(panel: PanelCode): number {
    return this.registry.connection(panel).syncIntervalMinutes;
  }

  /** The environment default; each panel may override it on Panel connections. */
  get intervalMinutes() {
    return this.env.SYNC_INTERVAL_MINUTES;
  }

  onApplicationBootstrap() {
    this.startedAt = Date.now();
    const panels = this.panels();
    if (panels.length)
      this.log.log(
        `Automatic sync for ${panels.map((p) => `${p} every ${this.intervalFor(p)} min`).join(', ')}`,
      );
    this.timer = setInterval(() => void this.tick(), CHECK_EVERY_MS);
    this.timer.unref();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
  }

  /** One round over every scheduled panel that is due. Exposed for tests. */
  async tick(now = Date.now()) {
    try {
      await this.registry.reload();
    } catch (e) {
      this.log.warn(`Panel connections not reloaded: ${(e as Error).message}`);
    }
    for (const panel of this.panels()) {
      if (this.stopped) return;
      if ((this.notSupportedUntil.get(panel) ?? 0) > now) continue;
      const last = this.lastStarted.get(panel) ?? this.startedAt;
      if (now - last < this.intervalFor(panel) * 60_000) continue;
      this.lastStarted.set(panel, now);
      try {
        await this.runLocked(panel);
      } catch {
        // runLocked logged it; the next panel still runs.
      }
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
