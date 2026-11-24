import { z } from 'zod';
import { PanelCode } from './panels.js';

/**
 * Reports, analytics and data exports (screens 23 and 29). Every report is a table with one row per panel (and
 * per breakdown), never added across panels. Exports are CSV or XLSX, need `export.read`, carry the data mode on
 * every row and are audited. A report that holds personal data would also need `export.pii`; none does today.
 */
export const REPORT_KEYS = [
  'audience_by_category',
  'audience_by_country',
  'consent_funnel',
  'data_quality',
  'profile_freshness',
  'loyalty_liability',
  'communication_delivery',
  'privacy_sla',
  'sync_health',
] as const;
export const ReportKey = z.enum(REPORT_KEYS);
export type ReportKey = z.infer<typeof ReportKey>;

export const ExportFormat = z.enum(['csv', 'xlsx']);
export type ExportFormat = z.infer<typeof ExportFormat>;

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export const ReportParams = z
  .object({
    panel: PanelCode.optional(),
    /** For reports over a period (deliveries, privacy requests, syncs). Defaults to the last 30 days. */
    from: day.optional(),
    to: day.optional(),
  })
  .refine((p) => !p.from || !p.to || p.from <= p.to, { message: '`from` must not be after `to`' });
export type ReportParams = z.infer<typeof ReportParams>;

export const ReportExportQuery = z.object({ format: ExportFormat.default('csv') });
export type ReportExportQuery = z.infer<typeof ReportExportQuery>;

export interface ReportColumn {
  key: string;
  label: string;
  type: 'text' | 'number' | 'date' | 'money';
}

export interface ReportResult {
  key: ReportKey;
  title: string;
  dataMode: 'demo' | 'live';
  generatedAt: string;
  period: { from: string; to: string } | null;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
  notes: string[];
}
