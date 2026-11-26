import ExcelJS from 'exceljs';
import {
  NETWORK_FILE_COLUMNS,
  NetworkAnswer,
  NetworkMember,
  NetworkQuestion,
  type NetworkFileKind,
} from '@madp/contracts';

export type Row = Record<string, string>;

/** RFC 4180 CSV: commas, double-quoted fields, "" inside quotes, CRLF or LF. A leading BOM is dropped. */
export function parseCsv(text: string): string[][] {
  const s = text.replace(/^﻿/, '');
  const out: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!;
    if (quoted) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && s[i + 1] === '\n') i++;
      row.push(field);
      out.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  if (field !== '' || row.length) {
    row.push(field);
    out.push(row);
  }
  return out.filter((r) => r.some((v) => v.trim() !== ''));
}

export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') {
    if ('text' in v && typeof v.text === 'string') return v.text;
    if ('result' in v) return cellText(v.result as ExcelJS.CellValue);
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    return '';
  }
  return String(v);
}

/** The first worksheet of an .xlsx file as rows of text. */
export async function parseXlsx(file: Buffer): Promise<string[][] | null> {
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    return null;
  }
  const ws = wb.worksheets[0];
  if (!ws) return [];
  const out: string[][] = [];
  ws.eachRow({ includeEmpty: false }, (r) => {
    const values: string[] = [];
    for (let c = 1; c <= ws.columnCount; c++) values.push(cellText(r.getCell(c).value).trim());
    out.push(values);
  });
  return out.filter((r) => r.some((v) => v !== ''));
}

const norm = (h: string) => h.toLowerCase().replace(/[\s_-]+/g, '');

/** Matches each header to a field by name or alias. */
export function mapColumns(kind: NetworkFileKind, header: string[]) {
  const cols = NETWORK_FILE_COLUMNS[kind];
  return header.map((h) => {
    const n = norm(h);
    const hit = cols.find((c) => norm(c.field) === n || c.aliases.some((a) => norm(a) === n));
    return { column: h, field: hit?.field ?? null };
  });
}

const YES = new Set(['yes', 'y', 'true', '1', 'active', 'verified']);
const NO = new Set(['no', 'n', 'false', '0', 'inactive', 'unverified', '']);

function bool(v: string): boolean | string {
  const x = v.trim().toLowerCase();
  if (YES.has(x)) return true;
  if (NO.has(x)) return false;
  return v; // left as text so validation reports it
}

/**
 * A date or date-time cell as an ISO date-time; a bare date becomes midnight UTC. Only year-first dates are read
 * (Excel date cells arrive that way): 04/05/1990 could be April or May, so it is reported instead of guessed.
 */
function when(v: string): string | null | undefined {
  const x = v.trim();
  if (!x) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return `${x}T00:00:00.000Z`;
  if (!/^\d{4}-\d{2}-\d{2}[T ]/.test(x)) return x;
  const t = Date.parse(x);
  return Number.isNaN(t) ? x : new Date(t).toISOString();
}

function dateOnly(v: string): string | null | undefined {
  const x = v.trim();
  if (!x) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(x)) return x;
  // An Excel date cell (read as an ISO date-time at midnight UTC).
  if (/^\d{4}-\d{2}-\d{2}T00:00:00(\.000)?Z$/.test(x)) return x.slice(0, 10);
  return x;
}

/** One file row (field -> text) as the push API's object for that kind, before validation. */
export function toObject(kind: NetworkFileKind, r: Row): Record<string, unknown> {
  const o: Record<string, unknown> = {};
  const put = (k: string, v: unknown) => {
    if (v !== undefined && v !== '') o[k] = v;
  };
  if (kind === 'members') {
    for (const k of [
      'memberId',
      'category',
      'email',
      'phone',
      'firstName',
      'lastName',
      'gender',
      'country',
      'state',
      'city',
    ])
      put(k, r[k]?.trim());
    put('dateOfBirth', r.dateOfBirth !== undefined ? dateOnly(r.dateOfBirth) : undefined);
    for (const k of ['emailVerified', 'phoneVerified', 'active'])
      if (r[k] !== undefined && r[k].trim() !== '') o[k] = bool(r[k]);
    put('marketingConsent', r.marketingConsent?.trim().toLowerCase());
    put('createdAt', r.createdAt !== undefined ? when(r.createdAt) : undefined);
    put('updatedAt', r.updatedAt !== undefined ? when(r.updatedAt) : undefined);
  } else if (kind === 'answers') {
    put('memberId', r.memberId?.trim());
    put('questionId', r.questionId?.trim());
    if (r.values !== undefined)
      o.values = r.values
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean);
    put('updatedAt', r.updatedAt !== undefined ? when(r.updatedAt) : undefined);
  } else {
    put('questionId', r.questionId?.trim());
    put('label', r.label?.trim());
    put('type', r.type?.trim());
    if (r.options?.trim())
      o.options = r.options
        .split('|')
        .map((x) => x.trim())
        .filter(Boolean)
        .map((x) => {
          const i = x.indexOf('=');
          return i > 0
            ? { value: x.slice(0, i).trim(), label: x.slice(i + 1).trim() }
            : { value: x, label: x };
        });
  }
  return o;
}

export const SCHEMA = { members: NetworkMember, answers: NetworkAnswer, questions: NetworkQuestion } as const;

/** Rows of a file, validated. Problems name the row and the field, never the value (it may be personal data). */
export function readRows(kind: NetworkFileKind, table: string[][]) {
  const [header = [], ...body] = table;
  const columns = mapColumns(kind, header);
  const problems: { row: number; message: string }[] = [];
  const missing = NETWORK_FILE_COLUMNS[kind]
    .filter((c) => c.required && !columns.some((x) => x.field === c.field))
    .map((c) => c.field);
  if (missing.length) {
    problems.push({
      row: 1,
      message: `Missing column${missing.length > 1 ? 's' : ''}: ${missing.join(', ')}`,
    });
    return { columns, rows: body.length, items: [] as unknown[], problems };
  }
  const items: unknown[] = [];
  body.forEach((cells, i) => {
    const r: Row = {};
    columns.forEach((c, j) => {
      if (c.field) r[c.field] = cells[j] ?? '';
    });
    const parsed = SCHEMA[kind].safeParse(toObject(kind, r));
    if (parsed.success) items.push(parsed.data);
    else if (problems.length < 50)
      problems.push({
        row: i + 2,
        message: parsed.error.issues
          .slice(0, 3)
          .map((x) => `${x.path.join('.') || 'row'}: ${x.message}`)
          .join('; '),
      });
  });
  return { columns, rows: body.length, items, problems };
}
