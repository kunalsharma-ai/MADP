import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import type { ParsedBlock, ParsedDocument, ParsedTable } from '@madp/contracts';
import { cellText, parseCsv } from '../networks/file-parse.js';

/**
 * Upload parsing for the console: spreadsheets to rows of text and Word files to page blocks. Pure functions, nothing
 * is stored or written; the screen shows a preview and applies it through its own audited route.
 */
export class FileProblem extends Error {}

const MAX_SHEET_ROWS = 20_000;
const MAX_COLS = 60;

export async function parseTable(name: string, file: Buffer): Promise<ParsedTable> {
  if (/\.csv$/i.test(name) || /\.txt$/i.test(name)) {
    const rows = parseCsv(file.toString('utf8'));
    if (rows.length > MAX_SHEET_ROWS)
      throw new FileProblem(`The file has ${rows.length} rows; the limit is ${MAX_SHEET_ROWS}.`);
    return {
      kind: 'table',
      sheets: [
        {
          name: name.replace(/\.[^.]+$/, ''),
          rows: rows.map((r) => r.slice(0, MAX_COLS).map((v) => v.trim())),
        },
      ],
    };
  }
  if (!/\.xlsx$/i.test(name)) throw new FileProblem('Upload an Excel (.xlsx) or CSV (.csv) file.');
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(file as unknown as ArrayBuffer);
  } catch {
    throw new FileProblem(
      'That file could not be opened as an Excel workbook. Save it as .xlsx and try again.',
    );
  }
  const sheets: ParsedTable['sheets'] = [];
  for (const ws of wb.worksheets) {
    const rows: string[][] = [];
    const cols = Math.min(MAX_COLS, ws.columnCount);
    ws.eachRow({ includeEmpty: false }, (r) => {
      const values: string[] = [];
      for (let c = 1; c <= cols; c++) values.push(cellText(r.getCell(c).value).trim());
      if (values.some((v) => v !== '')) rows.push(values);
    });
    if (rows.length > MAX_SHEET_ROWS)
      throw new FileProblem(`Sheet "${ws.name}" has ${rows.length} rows; the limit is ${MAX_SHEET_ROWS}.`);
    sheets.push({ name: ws.name, rows });
  }
  return { kind: 'table', sheets };
}

// ---- Word ------------------------------------------------------------------------------------------------------------
const decode = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n: string) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n: string) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&amp;/g, '&');

/** The visible text of a paragraph or cell: runs, tabs and line breaks. Deleted (tracked) text is left out. */
function textOf(x: string): string {
  const clean = x
    .replace(/<w:del\b[\s\S]*?<\/w:del>/g, '')
    .replace(/<w:instrText\b[\s\S]*?<\/w:instrText>/g, '');
  let out = '';
  const re = /<w:t(?:\s[^>]*)?>([\s\S]*?)<\/w:t>|<w:tab\/>|<w:br\/>|<w:cr\/>/g;
  for (let m = re.exec(clean); m; m = re.exec(clean))
    out += m[1] !== undefined ? decode(m[1]) : m[0] === '<w:tab/>' ? '\t' : ' ';
  return out.replace(/\s+/g, ' ').trim();
}

/** Top-level children of an element body: paragraphs and tables, with nested tables kept whole. */
function children(body: string): { tag: 'p' | 'tbl'; xml: string }[] {
  const out: { tag: 'p' | 'tbl'; xml: string }[] = [];
  const open = /<w:(p|tbl)(?=[\s>/])/g;
  let i = 0;
  while (i < body.length) {
    open.lastIndex = i;
    const m = open.exec(body);
    if (!m) break;
    const tag = m[1] as 'p' | 'tbl';
    const start = m.index;
    const selfClose = body.indexOf('>', start);
    if (body[selfClose - 1] === '/') {
      i = selfClose + 1;
      continue;
    }
    // find the matching close, counting nested elements of the same tag
    const re = new RegExp(`<w:${tag}(?=[\\s>/])|</w:${tag}>`, 'g');
    re.lastIndex = selfClose + 1;
    let depth = 1;
    let end = -1;
    for (let n = re.exec(body); n; n = re.exec(body)) {
      if (n[0].startsWith('</')) depth--;
      else if (body[body.indexOf('>', n.index) - 1] !== '/') depth++;
      if (depth === 0) {
        end = n.index + n[0].length;
        break;
      }
    }
    if (end < 0) break;
    out.push({ tag, xml: body.slice(start, end) });
    i = end;
  }
  return out;
}

function tableRows(tbl: string): string[][] {
  const rows: string[][] = [];
  for (const tr of tbl.match(/<w:tr[\s>][\s\S]*?<\/w:tr>/g) ?? []) {
    const cells = (tr.match(/<w:tc[\s>][\s\S]*?<\/w:tc>/g) ?? []).map(textOf);
    if (cells.some((c) => c)) rows.push(cells);
  }
  return rows;
}

const clip = (s: string, max: number, warn: string[], what: string) => {
  if (s.length <= max) return s;
  warn.push(`${what} was longer than ${max} characters and was shortened.`);
  return `${s.slice(0, max - 1)}…`;
};

/**
 * A Word file as page blocks: Title (or the first Heading 1) becomes the title, Heading 1/2 become h2, Heading 3+
 * become h3, Quote becomes a note, bulleted and numbered lists become ul / ol, tables become tables. MADP's own Word
 * downloads upload back unchanged (their Brand / Data / DEMO lines are skipped).
 */
export async function parseDocx(file: Buffer): Promise<ParsedDocument> {
  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(file);
  } catch {
    throw new FileProblem(
      'That file could not be opened as a Word document. Save it as .docx and try again.',
    );
  }
  const docXml = await zip.file('word/document.xml')?.async('string');
  if (!docXml) throw new FileProblem('That file is not a Word (.docx) document.');
  // style id -> lower-case style name, so localised ids still map ("berschrift1" is named "heading 1")
  const styles = new Map<string, string>();
  const stylesXml = (await zip.file('word/styles.xml')?.async('string')) ?? '';
  for (const s of stylesXml.match(/<w:style\b[\s\S]*?<\/w:style>/g) ?? []) {
    const id = /w:styleId="([^"]+)"/.exec(s)?.[1];
    const nm = /<w:name w:val="([^"]+)"/.exec(s)?.[1];
    if (id) styles.set(id, (nm ?? id).toLowerCase());
  }
  // numbering id -> is it a bullet list?
  const bullets = new Map<string, boolean>();
  const numXml = (await zip.file('word/numbering.xml')?.async('string')) ?? '';
  const abstract = new Map<string, boolean>();
  for (const a of numXml.match(/<w:abstractNum\b[\s\S]*?<\/w:abstractNum>/g) ?? []) {
    const id = /w:abstractNumId="(\d+)"/.exec(a)?.[1];
    const fmt = /<w:lvl w:ilvl="0"[\s\S]*?<w:numFmt w:val="([^"]+)"/.exec(a)?.[1];
    if (id) abstract.set(id, fmt === 'bullet' || fmt === undefined);
  }
  for (const n of numXml.match(/<w:num w:numId="\d+"[\s\S]*?<\/w:num>/g) ?? []) {
    const id = /w:numId="(\d+)"/.exec(n)?.[1];
    const abs = /<w:abstractNumId w:val="(\d+)"/.exec(n)?.[1];
    if (id && abs) bullets.set(id, abstract.get(abs) ?? true);
  }

  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(docXml)?.[1] ?? '';
  const blocks: ParsedBlock[] = [];
  const warnings: string[] = [];
  let title: string | null = null;
  let list: { kind: 'ul' | 'ol'; items: string[] } | null = null;
  const flush = () => {
    if (list)
      blocks.push(list.kind === 'ul' ? { ul: list.items.slice(0, 100) } : { ol: list.items.slice(0, 100) });
    if (list && list.items.length > 100)
      warnings.push('A list had more than 100 items; the rest were left out.');
    list = null;
  };
  for (const c of children(body)) {
    if (c.tag === 'tbl') {
      flush();
      const rows = tableRows(c.xml);
      if (!rows.length) continue;
      const width = Math.min(12, Math.max(...rows.map((r) => r.length)));
      if (Math.max(...rows.map((r) => r.length)) > 12)
        warnings.push('A table had more than 12 columns; the extra columns were left out.');
      const fit = (r: string[]) =>
        Array.from({ length: width }, (_, i) => clip(r[i] ?? '', 1000, warnings, 'A table cell'));
      const [head, ...rest] = rows;
      if (!rest.length) {
        blocks.push(head!.filter(Boolean).join(' · '));
        continue;
      }
      if (rest.length > 300) warnings.push('A table had more than 300 rows; the rest were left out.');
      blocks.push({
        table: { head: fit(head!).map((h, i) => h || `Column ${i + 1}`), rows: rest.slice(0, 300).map(fit) },
      });
      continue;
    }
    const t = textOf(c.xml);
    if (!t) continue;
    const styleId = /<w:pStyle w:val="([^"]+)"/.exec(c.xml)?.[1] ?? '';
    const style = styles.get(styleId) ?? styleId.toLowerCase();
    const numId = /<w:numId w:val="(\d+)"/.exec(c.xml)?.[1];
    // MADP's own download header lines
    if (
      /^Brand: \S+ · Data: (DEMO|live) · Generated /.test(t) ||
      t.startsWith('DEMO DATA: synthetic fixtures')
    )
      continue;
    const heading = /^heading\s*(\d)$/.exec(style.replace(/^heading(\d)$/, 'heading $1'));
    if (style === 'title') {
      flush();
      if (!title) title = clip(t, 200, warnings, 'The title');
      else blocks.push({ h2: clip(t, 200, warnings, 'A heading') });
      continue;
    }
    if (heading) {
      flush();
      const level = Number(heading[1]);
      if (level === 1 && !title && !blocks.length) title = clip(t, 200, warnings, 'The title');
      else
        blocks.push(
          level <= 2
            ? { h2: clip(t, 200, warnings, 'A heading') }
            : { h3: clip(t, 200, warnings, 'A heading') },
        );
      continue;
    }
    if (style.includes('quote')) {
      flush();
      blocks.push({ note: clip(t, 5000, warnings, 'A note') });
      continue;
    }
    const isList = numId !== undefined && numId !== '0' ? true : style.startsWith('list');
    if (isList) {
      const kind: 'ul' | 'ol' =
        numId !== undefined && numId !== '0'
          ? bullets.get(numId) === false
            ? 'ol'
            : 'ul'
          : style.includes('number')
            ? 'ol'
            : 'ul';
      // MADP writes the bullet or number into the text; drop it
      const item = clip(t.replace(/^(•|\d+\.)\s*/, ''), 5000, warnings, 'A list item');
      if (list && list.kind !== kind) flush();
      if (!list) list = { kind, items: [] };
      list.items.push(item);
      continue;
    }
    flush();
    blocks.push(clip(t, 5000, warnings, 'A paragraph'));
  }
  flush();
  if (blocks.length > 400) {
    warnings.push(`The document has ${blocks.length} parts; only the first 400 were kept.`);
    blocks.length = 400;
  }
  if (!blocks.length) throw new FileProblem('No text was found in that Word file.');
  return { kind: 'document', title, blocks, warnings: [...new Set(warnings)] };
}
