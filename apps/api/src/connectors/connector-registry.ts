import { Inject, Injectable, Logger } from '@nestjs/common';
import type { ApiEnv } from '@madp/config';
import { PANEL_CODES, PANELS, type DataMode, type PanelCode } from '@madp/contracts';
import { DemoConnector, PanelApiConnector, type PanelConnector } from '@madp/connectors';
import { API_ENV } from '../common/tokens.js';

export interface ConnectorSlot {
  panel: PanelCode;
  connector: PanelConnector;
  dataMode: DataMode;
  /** Why the connector is in this mode. Shown on the connector health screen. */
  reason: string;
}

/**
 * Builds one connector per panel. A panel runs LIVE only when (a) it is listed in
 * LIVE_SOURCE_APPROVED_PANELS, i.e. access to production personal data has been explicitly approved, and
 * (b) its base URL and integration credential are configured. Otherwise it runs on DEMO fixtures.
 */
@Injectable()
export class ConnectorRegistry {
  private readonly log = new Logger(ConnectorRegistry.name);
  private readonly slots = new Map<PanelCode, ConnectorSlot>();

  constructor(@Inject(API_ENV) env: ApiEnv) {
    const cfg: Record<PanelCode, { url?: string | undefined; token?: string | undefined }> = {
      t2o: { url: env.T2O_API_BASE_URL, token: env.T2O_API_TOKEN },
      mfr: { url: env.MFR_API_BASE_URL, token: env.MFR_API_TOKEN },
      mho: { url: env.MHO_API_BASE_URL, token: env.MHO_API_TOKEN },
    };
    for (const panel of PANEL_CODES) {
      const approved = env.LIVE_SOURCE_APPROVED_PANELS.includes(panel);
      const { url, token } = cfg[panel];
      if (approved && url && token) {
        this.slots.set(panel, {
          panel,
          dataMode: 'live',
          reason: 'Live read-only access approved and configured',
          connector: new PanelApiConnector(panel, {
            baseUrl: url,
            tenantHost: new URL(url).host,
            bearerToken: token,
          }),
        });
      } else {
        const reason = !approved
          ? 'Live access to production personal data not yet approved'
          : 'Approved, but base URL or integration credential is not configured';
        this.slots.set(panel, {
          panel,
          dataMode: 'demo',
          reason,
          connector: new DemoConnector(panel, env.DEMO_POPULATION_SIZE),
        });
      }
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
