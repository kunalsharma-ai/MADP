import { loadApiEnv } from '@madp/config';
import { PANEL_CODES } from '@madp/contracts';
import { createApp } from '../bootstrap.js';
import { IngestionService } from '../ingestion/ingestion.service.js';
import { ConnectorRegistry } from '../connectors/connector-registry.js';

// Loads DEMO data for every panel whose connector is in DEMO mode. Never touches a LIVE connector.
const app = await createApp(loadApiEnv(), { logger: false });
const registry = app.get(ConnectorRegistry);
const ingestion = app.get(IngestionService);
for (const panel of PANEL_CODES) {
  if (registry.get(panel).dataMode !== 'demo') {
    console.log(`${panel}: LIVE connector - skipped`);
    continue;
  }
  const r = await ingestion.runImport(panel, { dryRun: false });
  console.log(
    `${panel}: ${r.status} people=${r.counts.respondentsSeen} questions=${r.counts.questions} answers=${r.counts.answersChanged}${r.status === 'failed' ? ` error=${(r as { error?: string }).error}` : ''}`,
  );
}
await app.close();
