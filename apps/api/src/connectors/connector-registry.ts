import { Inject, Injectable, Logger, type OnModuleInit } from '@nestjs/common';
import type { ApiEnv } from '@madp/config';
import { PANEL_CODES, PANELS, type DataMode, type PanelCode } from '@madp/contracts';
import { DemoConnector, PanelApiConnector, type PanelConnector } from '@madp/connectors';
import { API_ENV } from '../common/tokens.js';
import { Database } from '../db/database.js';
import { panelConnections } from '../db/schema.js';
import { FieldCrypto } from '../crypto/field-crypto.js';

export interface ConnectorSlot {
  panel: PanelCode;
  connector: PanelConnector;
  dataMode: DataMode;
  /** Why the connector is in this mode. Shown on the connector health screen. */
  reason: string;
}

/** Where a value comes from: the Panel connections screen, the environment, or nowhere yet. */
export type ConfigSource = 'console' | 'env' | 'none';

/** The settings a panel runs with after console values and environment fallbacks are combined. */
export interface EffectiveConnection {
  panel: PanelCode;
  syncBaseUrl?: string | undefined;
  syncToken?: string | undefined;
  adminBaseUrl?: string | undefined;
  adminSecret?: string | undefined;
  /** 0 means the automatic schedule is off for this panel. */
  syncIntervalMinutes: number;
  liveApproved: boolean;
  source: {
    syncBaseUrl: ConfigSource;
    syncToken: ConfigSource;
    adminBaseUrl: ConfigSource;
    adminSecret: ConfigSource;
    syncIntervalMinutes: ConfigSource;
    liveApproved: ConfigSource;
  };
}

type Row = typeof panelConnections.$inferSelect;

const ENV_KEYS = {
  t2o: { url: 'T2O_API_BASE_URL', token: 'T2O_API_TOKEN', admin: 'T2O_ADMIN_API_BASE_URL' },
  mfr: { url: 'MFR_API_BASE_URL', token: 'MFR_API_TOKEN', admin: 'MFR_ADMIN_API_BASE_URL' },
  mho: { url: 'MHO_API_BASE_URL', token: 'MHO_API_TOKEN', admin: 'MHO_ADMIN_API_BASE_URL' },
} as const satisfies Record<PanelCode, { url: keyof ApiEnv; token: keyof ApiEnv; admin: keyof ApiEnv }>;

function pick<T>(console: T | null | undefined, env: T | undefined): [T | undefined, ConfigSource] {
  if (console !== null && console !== undefined && console !== '') return [console, 'console'];
  if (env !== undefined && env !== '') return [env, 'env'];
  return [undefined, 'none'];
}

/**
 * Builds one connector per panel. A panel runs LIVE only when (a) live access to its production personal data has
 * been approved, on the Panel connections screen or through LIVE_SOURCE_APPROVED_PANELS, and (b) its base URL and
 * integration token are set. Otherwise it runs on DEMO fixtures. Values saved on the Panel connections screen win
 * over environment values; `reload()` applies a saved change without a restart.
 */
@Injectable()
export class ConnectorRegistry implements OnModuleInit {
  private readonly log = new Logger(ConnectorRegistry.name);
  private readonly slots = new Map<PanelCode, ConnectorSlot>();
  private readonly effective = new Map<PanelCode, EffectiveConnection>();

  constructor(
    @Inject(API_ENV) private readonly env: ApiEnv,
    private readonly database: Database,
    private readonly crypto: FieldCrypto,
  ) {
    this.apply(new Map(), false);
  }

  async onModuleInit() {
    await this.reload();
  }

  /** Re-reads the Panel connections rows and rebuilds every connector whose settings changed. */
  async reload() {
    let rows: Row[] = [];
    try {
      rows = await this.database.db.select().from(panelConnections);
    } catch (e) {
      // Before the first migration the table doesn't exist yet: run on the environment alone.
      this.log.warn(`Panel connections not read (${(e as Error).message}); using environment values`);
    }
    this.apply(new Map(rows.map((r) => [r.panel, r])), true);
  }

  /** The combined settings for a panel. Holds secrets: never return it from a route. */
  connection(panel: PanelCode): EffectiveConnection {
    return this.effective.get(panel)!;
  }

  /** Signed admin API settings for a brand, or null while its URL or secret is missing. */
  adminConfig(panel: PanelCode): { baseUrl: string; secret: string } | null {
    const c = this.connection(panel);
    return c.adminBaseUrl && c.adminSecret ? { baseUrl: c.adminBaseUrl, secret: c.adminSecret } : null;
  }

  /** Combines a console row with the environment. Exposed for the connection test. */
  combine(
    panel: PanelCode,
    row: Partial<Row> | undefined,
    decrypted?: { syncToken?: string; adminSecret?: string },
  ) {
    const k = ENV_KEYS[panel];
    const env = this.env as unknown as Record<string, string | undefined>;
    const [syncBaseUrl, s1] = pick(row?.syncBaseUrl, env[k.url]);
    const [syncToken, s2] = pick(
      decrypted?.syncToken ?? (row?.syncTokenEnc ? this.crypto.decrypt(row.syncTokenEnc) : null),
      env[k.token],
    );
    const [adminBaseUrl, s3] = pick(row?.adminBaseUrl, env[k.admin]);
    const [adminSecret, s4] = pick(
      decrypted?.adminSecret ?? (row?.adminSecretEnc ? this.crypto.decrypt(row.adminSecretEnc) : null),
      this.env.PANEL_ADMIN_API_SECRET,
    );
    const [interval, s5] = pick(row?.syncIntervalMinutes, this.env.SYNC_INTERVAL_MINUTES || undefined);
    const envLive = this.env.LIVE_SOURCE_APPROVED_PANELS.includes(panel);
    const liveApproved = Boolean(row?.liveApproved) || envLive;
    const eff: EffectiveConnection = {
      panel,
      syncBaseUrl,
      syncToken,
      adminBaseUrl,
      adminSecret,
      syncIntervalMinutes: interval ?? 0,
      liveApproved,
      source: {
        syncBaseUrl: s1,
        syncToken: s2,
        adminBaseUrl: s3,
        adminSecret: s4,
        syncIntervalMinutes: s5,
        liveApproved: row?.liveApproved ? 'console' : envLive ? 'env' : 'none',
      },
    };
    return eff;
  }

  /** A live connector for given settings, without registering it (used to test before saving). */
  liveConnector(panel: PanelCode, url: string, token: string): PanelConnector {
    return new PanelApiConnector(panel, { baseUrl: url, tenantHost: new URL(url).host, bearerToken: token });
  }

  private apply(rows: Map<PanelCode, Row>, logChanges: boolean) {
    for (const panel of PANEL_CODES) {
      const eff = this.combine(panel, rows.get(panel));
      const prev = this.effective.get(panel);
      this.effective.set(panel, eff);
      const same =
        prev &&
        prev.liveApproved === eff.liveApproved &&
        prev.syncBaseUrl === eff.syncBaseUrl &&
        prev.syncToken === eff.syncToken;
      if (same && this.slots.has(panel)) continue;
      if (eff.liveApproved && eff.syncBaseUrl && eff.syncToken) {
        this.slots.set(panel, {
          panel,
          dataMode: 'live',
          reason: 'Live read-only access approved and configured',
          connector: this.liveConnector(panel, eff.syncBaseUrl, eff.syncToken),
        });
      } else {
        const reason = !eff.liveApproved
          ? 'Live access to production personal data not yet approved'
          : 'Approved, but base URL or integration credential is not configured';
        // Keep the same DEMO connector when the panel stays on DEMO, so its fixtures don't change.
        const old = this.slots.get(panel);
        this.slots.set(panel, {
          panel,
          dataMode: 'demo',
          reason,
          connector:
            old?.dataMode === 'demo'
              ? old.connector
              : new DemoConnector(panel, this.env.DEMO_POPULATION_SIZE),
        });
      }
      if (logChanges || !prev)
        this.log.log(
          `${PANELS[panel].shortName}: ${this.slots.get(panel)!.dataMode.toUpperCase()} (${this.slots.get(panel)!.reason})`,
        );
    }
  }

  get(panel: PanelCode): ConnectorSlot {
    return this.slots.get(panel)!;
  }

  all(): ConnectorSlot[] {
    return PANEL_CODES.map((p) => this.get(p));
  }
}
