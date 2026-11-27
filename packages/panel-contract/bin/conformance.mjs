#!/usr/bin/env node
/**
 * MADP Panel API conformance kit. Read-only: it never calls a route that writes.
 *
 *   PANEL_BASE_URL=https://www.example-panel.com \
 *   PANEL_SYNC_TOKEN=... PANEL_ADMIN_SECRET=... PANEL_ORIGIN=www.example-panel.com \
 *   node packages/panel-contract/bin/conformance.mjs [--allow-personal-data] [--json]
 *
 * --allow-personal-data also probes routes that return member data (with limit 1-2; nothing is kept). Use it only
 * with the panel owner's approval. Exit code 0 when conformant, 1 when a check failed, 2 on bad arguments.
 */
import { runConformance } from '../dist/index.js';

const args = new Set(process.argv.slice(2));
const env = process.env;
if (!env.PANEL_BASE_URL) {
  console.error('Set PANEL_BASE_URL, and PANEL_SYNC_TOKEN and/or PANEL_ADMIN_SECRET with PANEL_ORIGIN.');
  process.exit(2);
}
const report = await runConformance({
  baseUrl: env.PANEL_BASE_URL,
  syncToken: env.PANEL_SYNC_TOKEN || undefined,
  adminSecret: env.PANEL_ADMIN_SECRET || undefined,
  origin: env.PANEL_ORIGIN || undefined,
  allowPersonalData: args.has('--allow-personal-data'),
});
if (args.has('--json')) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const icon = { pass: 'PASS', fail: 'FAIL', warn: 'WARN', skip: 'skip' };
  console.log(`MADP Panel API contract ${report.contract} against ${report.baseHost}`);
  if (report.discovery)
    console.log(
      `Panel speaks ${report.discovery.version}, ${report.discovery.capabilities.length} capabilities`,
    );
  for (const r of report.results) console.log(`${icon[r.status]}  ${r.title}  ${r.detail}`);
  const c = report.counts;
  console.log(
    `\n${c.pass} passed, ${c.fail} failed, ${c.warn} warnings, ${c.skip} skipped: ${report.conformant ? 'CONFORMANT' : 'NOT CONFORMANT'}`,
  );
}
process.exit(report.conformant ? 0 : 1);
