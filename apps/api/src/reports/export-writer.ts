import type { ExportFormat, ReportResult } from '@madp/contracts';
import { writeTable, type ExportTable } from '../exports/writers.js';

/** A report as the shared export table: same columns, the report's period as the scope, its notes on the file. */
function asTable(r: ReportResult, brand: string): ExportTable {
  return {
    title: r.title,
    subtitle: r.period ? `Period: ${r.period.from} to ${r.period.to}` : 'As of generation time',
    brand,
    dataMode: r.dataMode,
    generatedAt: r.generatedAt,
    columns: r.columns,
    rows: r.rows,
    notes: r.notes,
    sheet: 'Report',
  };
}

/** CSV, Excel (with an About sheet), PDF or Word. */
export function writeReport(r: ReportResult, brand: string, format: ExportFormat): Promise<Buffer> {
  return writeTable(asTable(r, brand), format);
}
