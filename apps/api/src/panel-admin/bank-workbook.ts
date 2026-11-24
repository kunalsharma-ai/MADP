import ExcelJS from 'exceljs';
import type { DataMode } from '@madp/contracts';

/**
 * The question bank as an Excel workbook, in the same Profile / Question / Option shape as the JSON export, so a
 * workbook exported, edited and imported again goes through the panel's own import (dry run first) unchanged.
 *
 * - One sheet per part, one row per record, one column per field. Lists and objects (categories, pages, options'
 *   parent values, translations) are JSON in columns marked `[json]`.
 * - A hidden `_columns` sheet records each column's type, so a value an editor retypes (an option value "1" that
 *   Excel turns into the number 1) comes back as the type the panel exported.
 * - Text that a spreadsheet would run as a formula is prefixed with ' on export and the prefix is removed on import.
 *   Formulas typed into the workbook are refused rather than imported as their last result.
 */
export const BANK_SHEETS = ['Profile', 'Question', 'Option'] as const;
type Sheet = (typeof BANK_SHEETS)[number];
type Row = Record<string, unknown>;
type ColType = 'string' | 'number' | 'boolean' | 'json' | 'mixed';
const JSON_MARK = ' [json]';
const MAX_ROWS = 50_000;

const FORMULA_START = /^[=+\-@\t\r]/;
const safe = (v: string) => (FORMULA_START.test(v) ? `'${v}` : v);
const unsafe = (v: string) => (v.startsWith("'") && FORMULA_START.test(v.slice(1)) ? v.slice(1) : v);

function typeOf(v: unknown): ColType | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return 'string';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'boolean') return 'boolean';
  return 'json';
}

function columnsOf(rows: Row[]) {
  const seen = new Map<string, Set<ColType>>();
  for (const r of rows)
    for (const [k, v] of Object.entries(r)) {
      const set = seen.get(k) ?? new Set<ColType>();
      const t = typeOf(v);
      if (t) set.add(t);
      seen.set(k, set);
    }
  return [...seen.entries()].map(([key, set]) => ({
    key,
    type: (set.has('json') ? 'json' : set.size === 0 ? 'string' : set.size === 1 ? [...set][0]! : 'mixed') as ColType,
  }));
}

export async function bankToXlsx(
  bank: Partial<Record<Sheet, Row[]>> & { exportedAt?: string },
  meta: { brand: string; dataMode: DataMode },
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MADP';
  const types = wb.addWorksheet('_columns', { state: 'veryHidden' });
  types.addRow(['sheet', 'column', 'type']);
  for (const name of BANK_SHEETS) {
    const rows = bank[name] ?? [];
    const cols = columnsOf(rows);
    const ws = wb.addWorksheet(name, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = cols.map((c) => ({
      header: c.type === 'json' ? `${c.key}${JSON_MARK}` : c.key,
      key: c.key,
      width: Math.min(50, Math.max(12, c.key.length + 4)),
    }));
    ws.getRow(1).font = { bold: true };
    for (const r of rows) {
      const out: Row = {};
      for (const c of cols) {
        const v = r[c.key];
        if (v === null || v === undefined) continue;
        out[c.key] = c.type === 'json' ? JSON.stringify(v) : typeof v === 'string' ? safe(v) : v;
      }
      ws.addRow(out);
    }
    for (const c of cols) types.addRow([name, c.key, c.type]);
  }
  const about = wb.addWorksheet('About');
  about.columns = [{ width: 18 }, { width: 100 }];
  const lines: [string, string][] = [
    ['What', 'Question bank: profiles, questions and options'],
    ['Brand', meta.brand],
    ['Data mode', meta.dataMode === 'demo' ? 'DEMO: synthetic fixtures, not panel data' : 'live'],
    ['Exported at', bank.exportedAt ?? new Date().toISOString()],
    ['Counts', BANK_SHEETS.map((s) => `${s} ${(bank[s] ?? []).length}`).join(' · ')],
    ['Editing', 'Edit cells, add rows. Keep the header row. Columns marked [json] hold lists as JSON. Do not use formulas.'],
    ['Importing', 'Question bank > Import and export. Every import is a dry run first; nothing is ever deleted.'],
  ];
  for (const l of lines) about.addRow(l.map(safe));
  about.getColumn(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** A cell as the plain value it shows; formulas are reported, not evaluated. */
function cellValue(v: ExcelJS.CellValue): { value?: unknown; formula?: true } {
  if (v === null || v === undefined || v === '') return {};
  if (v instanceof Date) return { value: v.toISOString() };
  if (typeof v === 'object') {
    if ('formula' in v || 'sharedFormula' in v) return { formula: true };
    if ('richText' in v) return { value: v.richText.map((t) => t.text).join('') };
    if ('text' in v) return { value: String((v as { text: unknown }).text) };
    if ('error' in v) return {};
  }
  return { value: v };
}

function coerce(v: unknown, type: ColType | undefined): unknown {
  if (type === 'string' && typeof v !== 'string') return String(v);
  if (type === 'number' && typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  if (type === 'boolean' && typeof v === 'string' && /^(true|false)$/i.test(v.trim())) return v.trim().toLowerCase() === 'true';
  return v;
}

/**
 * Reads a workbook back into the bank shape. Problems (a formula, broken JSON, a missing sheet, too many rows) are
 * returned with their sheet and row so the admin can fix the file; nothing is sent to the panel while there are any.
 */
export async function xlsxToBank(file: Buffer): Promise<{ bank: Partial<Record<Sheet, Row[]>>; problems: string[] }> {
  const wb = new ExcelJS.Workbook();
  const problems: string[] = [];
  try {
    await wb.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    return { bank: {}, problems: ['That file is not an Excel workbook (.xlsx).'] };
  }
  const typeSheet = wb.getWorksheet('_columns');
  const types = new Map<string, ColType>();
  typeSheet?.eachRow((row, n) => {
    if (n === 1) return;
    const [, sheet, column, type] = row.values as unknown[];
    types.set(`${String(sheet)}|${String(column)}`, String(type) as ColType);
  });
  const bank: Partial<Record<Sheet, Row[]>> = {};
  for (const name of BANK_SHEETS) {
    const ws = wb.getWorksheet(name);
    if (!ws) continue;
    if (ws.rowCount - 1 > MAX_ROWS) {
      problems.push(`${name}: more than ${MAX_ROWS.toLocaleString('en')} rows.`);
      continue;
    }
    const header: { key: string; json: boolean }[] = [];
    ws.getRow(1).eachCell({ includeEmpty: true }, (c, col) => {
      const h = String(cellValue(c.value).value ?? '').trim();
      header[col] = { key: h.endsWith(JSON_MARK) ? h.slice(0, -JSON_MARK.length) : h, json: h.endsWith(JSON_MARK) };
    });
    const rows: Row[] = [];
    ws.eachRow((row, n) => {
      if (n === 1) return;
      const out: Row = {};
      row.eachCell((c, col) => {
        const h = header[col];
        if (!h?.key) return;
        const cv = cellValue(c.value);
        if (cv.formula) return void problems.push(`${name} row ${n}, ${h.key}: formulas are not imported; type the value.`);
        if (cv.value === undefined) return;
        if (h.json) {
          try {
            out[h.key] = JSON.parse(String(cv.value));
          } catch {
            problems.push(`${name} row ${n}, ${h.key}: not valid JSON.`);
          }
          return;
        }
        const v = typeof cv.value === 'string' ? unsafe(cv.value) : cv.value;
        out[h.key] = coerce(v, types.get(`${name}|${h.key}`));
      });
      if (Object.keys(out).length) rows.push(out);
    });
    bank[name] = rows;
  }
  if (!BANK_SHEETS.some((s) => bank[s]?.length)) problems.push('No Profile, Question or Option rows found.');
  return { bank, problems };
}
