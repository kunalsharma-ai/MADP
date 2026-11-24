import ExcelJS from 'exceljs';
import type { ReportResult } from '@madp/contracts';

/** A cell a spreadsheet would run as a formula is prefixed with ' (CSV/formula injection). */
function safe(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : safe(String(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a data_mode column on every row, so DEMO rows stay labelled wherever the file goes. */
export function toCsv(r: ReportResult): string {
  const head = ['data_mode', ...r.columns.map((c) => c.label)];
  const lines = [head.map(csvCell).join(',')];
  for (const row of r.rows) lines.push([r.dataMode, ...r.columns.map((c) => row[c.key])].map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

/** XLSX: the report sheet, plus an "About" sheet with the data mode, brand, period, notes and generation time. */
export async function toXlsx(r: ReportResult, brand: string): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MADP';
  wb.created = new Date(r.generatedAt);
  const ws = wb.addWorksheet(r.dataMode === 'demo' ? 'Report (DEMO)' : 'Report', { views: [{ state: 'frozen', ySplit: 1 }] });
  ws.columns = [
    { header: 'Data mode', key: '__mode', width: 10 },
    ...r.columns.map((c) => ({
      header: c.label,
      key: c.key,
      width: Math.min(40, Math.max(12, c.label.length + 2)),
      style: c.type === 'money' ? { numFmt: '#,##0.00' } : c.type === 'number' ? { numFmt: '#,##0' } : {},
    })),
  ];
  ws.getRow(1).font = { bold: true };
  for (const row of r.rows) {
    const out: Record<string, unknown> = { __mode: r.dataMode };
    for (const c of r.columns) {
      const v = row[c.key];
      out[c.key] = typeof v === 'string' ? safe(v) : v;
    }
    ws.addRow(out);
  }
  const about = wb.addWorksheet('About');
  about.columns = [{ width: 18 }, { width: 100 }];
  const lines: [string, string][] = [
    ['Report', r.title],
    ['Data mode', r.dataMode === 'demo' ? 'DEMO: synthetic fixtures, not panel data' : 'live'],
    ['Brand', brand],
    ['Period', r.period ? `${r.period.from} to ${r.period.to}` : 'As of generation time'],
    ['Generated at', r.generatedAt],
    ...r.notes.map((n, i): [string, string] => [i === 0 ? 'Notes' : '', n]),
  ];
  for (const l of lines) about.addRow(l.map(safe));
  about.getColumn(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}
