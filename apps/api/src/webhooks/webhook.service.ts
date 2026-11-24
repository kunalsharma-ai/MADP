import { Inject, Injectable, Logger } from '@nestjs/common';
import { and, desc, eq, isNull, lte, sql } from 'drizzle-orm';
import type { ApiEnv } from '@madp/config';
import type { PanelCode, WebhookEventType } from '@madp/contracts';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import { webhookInbox } from '../db/schema.js';
import { SyncScheduler } from '../ingestion/sync-scheduler.js';

/**
 * Webhook events are nudges: each one asks for a sync of its panel, and the sync reads what changed from the
 * panel's changes feed. Bursts are coalesced: at most one webhook-started sync runs per panel, and events that
 * arrive while it runs start one more run afterwards. The scheduled sync still runs, so a lost webhook only delays
 * a change until the next scheduled run.
 */
@Injectable()
export class WebhookService {
  private readonly log = new Logger(WebhookService.name);
  private readonly running = new Map<PanelCode, Promise<void>>();
  private readonly again = new Set<PanelCode>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly scheduler: SyncScheduler,
  ) {}

  secretsFor(panel: PanelCode): string[] {
    return {
      t2o: this.env.WEBHOOK_SECRETS_T2O,
      mfr: this.env.WEBHOOK_SECRETS_MFR,
      mho: this.env.WEBHOOK_SECRETS_MHO,
    }[panel] ?? [];
  }

  /** Stores the event once. Returns false for a repeat of an event id already received. */
  async record(panel: PanelCode, eventId: string, type: WebhookEventType, bodySha256: string): Promise<boolean> {
    const rows = await this.database.db
      .insert(webhookInbox)
      .values({
        panel,
        idempotencyKey: eventId,
        eventType: type,
        signatureValid: true,
        payloadRef: `sha256:${bodySha256}`,
      })
      .onConflictDoNothing({ target: [webhookInbox.panel, webhookInbox.idempotencyKey] })
      .returning({ id: webhookInbox.id });
    return rows.length > 0;
  }

  /** Starts (or queues) a sync for the panel. Returns the run's promise, for tests. */
  kick(panel: PanelCode): Promise<void> {
    const current = this.running.get(panel);
    if (current) {
      this.again.add(panel);
      return current;
    }
    const run = this.drain(panel).finally(() => this.running.delete(panel));
    this.running.set(panel, run);
    return run;
  }

  private async drain(panel: PanelCode) {
    do {
      this.again.delete(panel);
      const startedAt = new Date();
      try {
        const res = await this.scheduler.runLocked(panel, null);
        if (!res) {
          // Another instance or a manual run holds the lock: that run, or the next scheduled one, picks it up.
          await this.mark(panel, startedAt, 'sync already running elsewhere; left for the next run');
          return;
        }
        if (res.status === 'succeeded') await this.mark(panel, startedAt, null);
        else await this.mark(panel, startedAt, `sync ${res.status}: ${String(res.error ?? '').slice(0, 300)}`);
      } catch (e) {
        this.log.error(`Webhook sync of ${panel} failed: ${(e as Error).message}`);
        await this.mark(panel, startedAt, (e as Error).message.slice(0, 300)).catch(() => undefined);
        return;
      }
    } while (this.again.has(panel));
  }

  /** Events received before the run started are covered by it. */
  private async mark(panel: PanelCode, before: Date, error: string | null) {
    await this.database.db
      .update(webhookInbox)
      .set(error ? { error } : { processedAt: new Date(), error: null })
      .where(and(eq(webhookInbox.panel, panel), isNull(webhookInbox.processedAt), lte(webhookInbox.receivedAt, before)));
  }

  async inbox(panel?: PanelCode) {
    const db = this.database.db;
    const items = await db
      .select({
        id: webhookInbox.id,
        panel: webhookInbox.panel,
        eventType: webhookInbox.eventType,
        receivedAt: webhookInbox.receivedAt,
        processedAt: webhookInbox.processedAt,
        error: webhookInbox.error,
      })
      .from(webhookInbox)
      .where(panel ? eq(webhookInbox.panel, panel) : sql`true`)
      .orderBy(desc(webhookInbox.receivedAt))
      .limit(100);
    const totals = await db.execute<{ panel: string; received: string; open: string; last: string | null }>(
      sql`select panel::text, count(*) as received, count(*) filter (where processed_at is null) as open,
          max(received_at) as last from webhook_inbox group by 1`,
    );
    return {
      configured: { t2o: this.secretsFor('t2o').length > 0, mfr: this.secretsFor('mfr').length > 0, mho: this.secretsFor('mho').length > 0 },
      totals: Object.fromEntries(
        totals.rows.map((r) => [r.panel, { received: Number(r.received), open: Number(r.open), last: r.last }]),
      ),
      items,
    };
  }
}
