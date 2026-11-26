import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument, StandardFonts, rgb, type PDFFont, type PDFPage } from 'pdf-lib';
import type { DataMode, FileFormat, ParsedBlock } from '@madp/contracts';

/**
 * File writers for every console download: CSV, Excel, PDF and Word. One shape in (a titled table, or a page of
 * blocks), the data mode printed on every file, and the legal entity in the footer. No templates or macros: plain
 * values only, and text a spreadsheet would run as a formula is prefixed with '.
 */
export interface ExportTable {
  title: string;
  subtitle?: string | undefined;
  brand: string;
  dataMode: DataMode;
  generatedAt: string;
  columns: { key: string; label: string; type?: 'text' | 'number' | 'date' | 'money' | undefined }[];
  rows: Record<string, unknown>[];
  notes?: string[] | undefined;
  /** Excel sheet name; the title (shortened) by default. */
  sheet?: string | undefined;
}
export interface ExportDocument {
  title: string;
  subtitle?: string | undefined;
  brand: string;
  dataMode: DataMode;
  generatedAt: string;
  blocks: ParsedBlock[];
}

export const LEGAL_ENTITY = 'FREQUENT RESEARCH FIELDWORK SOLUTIONS PRIVATE LIMITED';
export const CONTENT_TYPE: Record<FileFormat, string> = {
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};
const DEMO_LINE = 'DEMO DATA: synthetic fixtures, not panel data';

/** A cell a spreadsheet would run as a formula is prefixed with ' (CSV/formula injection). */
export function safe(v: string): string {
  return /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
}
const text = (v: unknown): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

/** A file name: madp-<screen>-<brand>[-DEMO]-<date>.<ext>, letters, digits and dashes only. */
export function fileName(
  base: string,
  brand: string,
  dataMode: DataMode,
  at: string,
  format: FileFormat,
): string {
  const slug = (s: string) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'export';
  return `madp-${slug(base)}-${slug(brand)}${dataMode === 'demo' ? '-DEMO' : ''}-${at.slice(0, 10)}.${format}`;
}

/** Dates read as "2026-11-26 19:29 UTC" in PDF and Word; Excel and CSV keep the exact value. */
function shown(v: unknown, type?: string): string {
  if (type === 'date' && typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v))
    return `${v.slice(0, 10)} ${v.slice(11, 16)} UTC`;
  return text(v);
}

// ---- CSV -------------------------------------------------------------------------------------------------------------
function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = typeof v === 'number' ? String(v) : safe(text(v));
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV with a data_mode column on every row, so DEMO rows stay labelled wherever the file goes. BOM for Excel. */
export function tableToCsv(t: ExportTable): string {
  const head = ['data_mode', ...t.columns.map((c) => c.label)];
  const lines = [head.map(csvCell).join(',')];
  for (const row of t.rows)
    lines.push([t.dataMode, ...t.columns.map((c) => row[c.key])].map(csvCell).join(','));
  return `﻿${lines.join('\r\n')}\r\n`;
}

// ---- Excel -----------------------------------------------------------------------------------------------------------
/** The table sheet (frozen header, filters on), plus an "About" sheet with data mode, brand, scope and notes. */
export async function tableToXlsx(t: ExportTable): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'MADP';
  wb.created = new Date(t.generatedAt);
  const sheet = (t.sheet ?? t.title).replace(/[\\/?*[\]:]/g, ' ').slice(0, 24) || 'Export';
  const ws = wb.addWorksheet(t.dataMode === 'demo' ? `${sheet} (DEMO)` : sheet, {
    views: [{ state: 'frozen', ySplit: 1 }],
  });
  ws.columns = [
    { header: 'Data mode', key: '__mode', width: 10 },
    ...t.columns.map((c) => {
      const longest = Math.max(c.label.length, ...t.rows.slice(0, 200).map((r) => text(r[c.key]).length));
      return {
        header: c.label,
        key: c.key,
        width: Math.min(50, Math.max(10, longest + 2)),
        style: c.type === 'money' ? { numFmt: '#,##0.00' } : c.type === 'number' ? { numFmt: '#,##0' } : {},
      };
    }),
  ];
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  head.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  for (const row of t.rows) {
    const out: Record<string, unknown> = { __mode: t.dataMode };
    for (const c of t.columns) {
      const v = row[c.key];
      out[c.key] =
        typeof v === 'string' ? safe(v) : typeof v === 'boolean' ? (v ? 'Yes' : 'No') : (v ?? null);
    }
    ws.addRow(out);
  }
  if (t.rows.length)
    ws.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: t.rows.length + 1, column: t.columns.length + 1 },
    };
  const about = wb.addWorksheet('About');
  about.columns = [{ width: 18 }, { width: 100 }];
  const lines: [string, string][] = [
    ['File', t.title],
    ['Data mode', t.dataMode === 'demo' ? DEMO_LINE : 'live'],
    ['Brand', t.brand],
    ...(t.subtitle ? [['Scope', t.subtitle] as [string, string]] : []),
    ['Rows', String(t.rows.length)],
    ['Generated at', t.generatedAt],
    ...(t.notes ?? []).map((n, i): [string, string] => [i === 0 ? 'Notes' : '', n]),
    ['Made by', `MADP for ${LEGAL_ENTITY}`],
  ];
  for (const l of lines) about.addRow(l.map(safe));
  about.getColumn(1).font = { bold: true };
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---- PDF -------------------------------------------------------------------------------------------------------------
const CP1252_EXTRA = '€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ';
/** The standard PDF fonts only cover Windows-1252. Other characters become ?, rupee becomes Rs. */
export function ansi(s: string): string {
  let out = '';
  for (const ch of s.replace(/\r?\n|\t/g, ' ').replace(/₹/g, 'Rs ')) {
    const c = ch.codePointAt(0)!;
    out += (c >= 0x20 && c < 0x7f) || (c >= 0xa0 && c <= 0xff) || CP1252_EXTRA.includes(ch) ? ch : '?';
  }
  return out;
}

function wrap(s: string, font: PDFFont, size: number, width: number, maxLines: number): string[] {
  const words = ansi(s).split(/ +/);
  const lines: string[] = [];
  let line = '';
  const fits = (x: string) => font.widthOfTextAtSize(x, size) <= width;
  for (let w of words) {
    while (!fits(w) && w.length > 1) {
      // a word longer than the column: break it
      let cut = w.length - 1;
      while (cut > 1 && !fits(w.slice(0, cut))) cut--;
      if (line) {
        lines.push(line);
        line = '';
      }
      lines.push(w.slice(0, cut));
      w = w.slice(cut);
    }
    const next = line ? `${line} ${w}` : w;
    if (fits(next)) line = next;
    else {
      lines.push(line);
      line = w;
    }
  }
  if (line || !lines.length) lines.push(line);
  if (lines.length > maxLines) {
    const kept = lines.slice(0, maxLines);
    let last = kept[maxLines - 1]!;
    while (last && !fits(`${last}…`)) last = last.slice(0, -1);
    kept[maxLines - 1] = `${last}…`;
    return kept;
  }
  return lines;
}

const INK = rgb(0.11, 0.12, 0.2);
const MUTED = rgb(0.42, 0.45, 0.55);
const ACCENT = rgb(0.31, 0.27, 0.9);
const ZEBRA = rgb(0.96, 0.96, 0.99);
const DANGER = rgb(0.8, 0.15, 0.2);

interface Pdf {
  doc: PDFDocument;
  regular: PDFFont;
  bold: PDFFont;
  size: [number, number];
}
async function pdfStart(landscape: boolean, title: string): Promise<Pdf> {
  const doc = await PDFDocument.create();
  doc.setTitle(ansi(title));
  doc.setCreator('MADP');
  doc.setProducer('MADP');
  return {
    doc,
    regular: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    size: landscape ? [841.89, 595.28] : [595.28, 841.89],
  };
}
/** The band at the top of every page: title, scope, brand, data mode. Returns the y where content starts. */
function pdfHeader(
  p: Pdf,
  page: PDFPage,
  h: { title: string; subtitle?: string | undefined; brand: string; dataMode: DataMode; generatedAt: string },
): number {
  const [w, ht] = p.size;
  page.drawRectangle({ x: 0, y: ht - 6, width: w, height: 6, color: ACCENT });
  let y = ht - 40;
  page.drawText(ansi(h.title).slice(0, 110), { x: 36, y, size: 16, font: p.bold, color: INK });
  y -= 16;
  const meta = `Brand: ${h.brand.toUpperCase()}  ·  Data: ${h.dataMode === 'demo' ? 'DEMO' : 'live'}  ·  Generated ${h.generatedAt.slice(0, 16).replace('T', ' ')} UTC`;
  page.drawText(ansi(meta), { x: 36, y, size: 8.5, font: p.regular, color: MUTED });
  if (h.subtitle) {
    for (const l of wrap(h.subtitle, p.regular, 8.5, w - 72, 2)) {
      y -= 12;
      page.drawText(l, { x: 36, y, size: 8.5, font: p.regular, color: MUTED });
    }
  }
  if (h.dataMode === 'demo') {
    const t = DEMO_LINE;
    const tw = p.bold.widthOfTextAtSize(t, 8.5);
    page.drawRectangle({
      x: w - 36 - tw - 12,
      y: ht - 46,
      width: tw + 12,
      height: 16,
      color: rgb(1, 0.93, 0.94),
      borderColor: DANGER,
      borderWidth: 0.8,
    });
    page.drawText(t, { x: w - 36 - tw - 6, y: ht - 41, size: 8.5, font: p.bold, color: DANGER });
  }
  return y - 18;
}
function pdfFooters(p: Pdf) {
  const pages = p.doc.getPages();
  pages.forEach((page, i) => {
    const [w] = p.size;
    page.drawText(ansi(`${LEGAL_ENTITY}  ·  made with MADP`), {
      x: 36,
      y: 20,
      size: 7,
      font: p.regular,
      color: MUTED,
    });
    const n = `Page ${i + 1} of ${pages.length}`;
    page.drawText(n, {
      x: w - 36 - p.regular.widthOfTextAtSize(n, 7),
      y: 20,
      size: 7,
      font: p.regular,
      color: MUTED,
    });
  });
}

/** A table across as many pages as it needs; the header row repeats on every page. Long cells wrap (6 lines max). */
export async function tableToPdf(t: ExportTable): Promise<Buffer> {
  const p = await pdfStart(t.columns.length > 4, t.title);
  const [w] = p.size;
  const size = t.columns.length > 10 ? 6.5 : 7.5;
  const pad = 4;
  const avail = w - 72;
  // column widths from the longest of header and (sampled) cells, then scaled to the page
  const want = t.columns.map((c) => {
    const sample = t.rows.slice(0, 300).map((r) => Math.min(60, text(r[c.key]).length));
    const avg = sample.length ? sample.reduce((a, b) => a + b, 0) / sample.length : 0;
    const word = Math.max(
      ...c.label.split(/\s+/).map((w) => w.length),
      ...t.rows.slice(0, 300).map((r) =>
        Math.min(
          14,
          Math.max(
            0,
            ...shown(r[c.key], c.type)
              .split(/\s+/)
              .map((w) => w.length),
          ),
        ),
      ),
    );
    return Math.max(
      c.label.length * 0.9,
      word + 1.5,
      Math.min(60, Math.max(avg * 1.3, Math.max(0, ...sample) * 0.6)),
      4,
    );
  });
  // every column at least fits its longest header word; the rest of the page is shared by how much text it holds
  const floor = t.columns.map((c) =>
    Math.min(
      avail / t.columns.length,
      Math.max(...c.label.split(/\s+/).map((w) => p.bold.widthOfTextAtSize(w, size))) + pad * 2 + 1,
    ),
  );
  const spare = Math.max(0, avail - floor.reduce((a, b) => a + b, 0));
  const total = want.reduce((a, b) => a + b, 0);
  const widths = want.map((x, i) => floor[i]! + (x / total) * spare);
  const right = (i: number) => t.columns[i]!.type === 'number' || t.columns[i]!.type === 'money';

  let page = p.doc.addPage(p.size);
  let y = pdfHeader(p, page, t);
  const drawHead = () => {
    const lines = t.columns.map((c, i) => wrap(c.label, p.bold, size, widths[i]! - pad * 2, 3));
    const hh = Math.max(...lines.map((l) => l.length)) * (size + 2) + pad * 2;
    page.drawRectangle({ x: 36, y: y - hh, width: avail, height: hh, color: ACCENT });
    let x = 36;
    lines.forEach((ls, i) => {
      ls.forEach((l, j) =>
        page.drawText(l, {
          x: x + pad,
          y: y - pad - size - j * (size + 2),
          size,
          font: p.bold,
          color: rgb(1, 1, 1),
        }),
      );
      x += widths[i]!;
    });
    y -= hh;
  };
  drawHead();
  if (!t.rows.length) page.drawText('No rows.', { x: 40, y: y - 16, size: 9, font: p.regular, color: MUTED });
  t.rows.forEach((row, ri) => {
    const cells = t.columns.map((c, i) =>
      wrap(shown(row[c.key], c.type), p.regular, size, widths[i]! - pad * 2, 6),
    );
    const rh = Math.max(...cells.map((l) => l.length)) * (size + 2) + pad * 2;
    if (y - rh < 40) {
      page = p.doc.addPage(p.size);
      y = pdfHeader(p, page, { ...t, subtitle: undefined });
      drawHead();
    }
    if (ri % 2 === 1) page.drawRectangle({ x: 36, y: y - rh, width: avail, height: rh, color: ZEBRA });
    let x = 36;
    cells.forEach((ls, i) => {
      ls.forEach((l, j) => {
        const tw = p.regular.widthOfTextAtSize(l, size);
        page.drawText(l, {
          x: right(i) ? x + widths[i]! - pad - tw : x + pad,
          y: y - pad - size - j * (size + 2),
          size,
          font: p.regular,
          color: INK,
        });
      });
      x += widths[i]!;
    });
    y -= rh;
    page.drawLine({
      start: { x: 36, y },
      end: { x: 36 + avail, y },
      thickness: 0.3,
      color: rgb(0.85, 0.86, 0.9),
    });
  });
  if (t.notes?.length) {
    for (const n of t.notes) {
      const ls = wrap(n, p.regular, 8, avail, 4);
      if (y - ls.length * 11 - 10 < 40) {
        page = p.doc.addPage(p.size);
        y = pdfHeader(p, page, { ...t, subtitle: undefined });
      }
      y -= 6;
      for (const l of ls) {
        y -= 11;
        page.drawText(l, { x: 36, y, size: 8, font: p.regular, color: MUTED });
      }
    }
  }
  pdfFooters(p);
  return Buffer.from(await p.doc.save());
}

/** A page of headings, paragraphs, lists, notes and tables (a content page or help article) as an A4 PDF. */
export async function documentToPdf(d: ExportDocument): Promise<Buffer> {
  const p = await pdfStart(false, d.title);
  const [w] = p.size;
  const avail = w - 72;
  let page = p.doc.addPage(p.size);
  let y = pdfHeader(p, page, d);
  const need = (h: number) => {
    if (y - h < 44) {
      page = p.doc.addPage(p.size);
      y = pdfHeader(p, page, { ...d, subtitle: undefined });
    }
  };
  const para = (
    s: string,
    o: { font?: PDFFont; size?: number; indent?: number; bullet?: string; color?: typeof INK } = {},
  ) => {
    const size = o.size ?? 10;
    const font = o.font ?? p.regular;
    const indent = o.indent ?? 0;
    const lines = wrap(s, font, size, avail - indent, 400);
    lines.forEach((l, i) => {
      need(size + 4);
      y -= size + 4;
      if (i === 0 && o.bullet)
        page.drawText(o.bullet, { x: 36 + indent - 12, y, size, font, color: o.color ?? INK });
      page.drawText(l, { x: 36 + indent, y, size, font, color: o.color ?? INK });
    });
    y -= 6;
  };
  for (const b of d.blocks) {
    if (typeof b === 'string') para(b);
    else if ('h2' in b) {
      need(30);
      y -= 6;
      para(b.h2, { font: p.bold, size: 14, color: ACCENT });
    } else if ('h3' in b) {
      need(24);
      para(b.h3, { font: p.bold, size: 11.5 });
    } else if ('note' in b) {
      const lines = wrap(b.note, p.regular, 9.5, avail - 20, 400);
      const h = lines.length * 13.5 + 12;
      need(Math.min(h, 200));
      page.drawRectangle({
        x: 36,
        y: y - h,
        width: avail,
        height: h,
        color: rgb(0.95, 0.96, 1),
        borderColor: ACCENT,
        borderWidth: 0.6,
      });
      y -= 6;
      for (const l of lines) {
        need(14);
        y -= 13.5;
        page.drawText(l, { x: 46, y, size: 9.5, font: p.regular, color: INK });
      }
      y -= 12;
    } else if ('ul' in b) for (const it of b.ul) para(it, { indent: 16, bullet: '•' });
    else if ('ol' in b) b.ol.forEach((it, i) => para(it, { indent: 18, bullet: `${i + 1}.` }));
    else if ('table' in b) {
      const cols = b.table.head.length;
      const cw = avail / cols;
      const row = (cells: string[], bold: boolean, shade: boolean) => {
        const ls = cells.map((c) => wrap(c, bold ? p.bold : p.regular, 8.5, cw - 8, 8));
        const h = Math.max(...ls.map((l) => l.length)) * 11 + 8;
        need(h);
        if (shade)
          page.drawRectangle({ x: 36, y: y - h, width: avail, height: h, color: rgb(0.93, 0.93, 0.99) });
        ls.forEach((l, i) =>
          l.forEach((t, j) =>
            page.drawText(t, {
              x: 36 + i * cw + 4,
              y: y - 4 - 8.5 - j * 11,
              size: 8.5,
              font: bold ? p.bold : p.regular,
              color: INK,
            }),
          ),
        );
        y -= h;
        page.drawLine({
          start: { x: 36, y },
          end: { x: 36 + avail, y },
          thickness: 0.3,
          color: rgb(0.8, 0.8, 0.88),
        });
      };
      row(b.table.head, true, true);
      for (const r of b.table.rows) row(r, false, false);
      y -= 8;
    }
  }
  pdfFooters(p);
  return Buffer.from(await p.doc.save());
}

// ---- Word ------------------------------------------------------------------------------------------------------------
const xml = (s: string) =>
  s
    // characters XML 1.0 cannot hold
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
const run = (t: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  `<w:r><w:rPr>${o.bold ? '<w:b/>' : ''}${o.color ? `<w:color w:val="${o.color}"/>` : ''}${o.size ? `<w:sz w:val="${o.size}"/>` : ''}</w:rPr><w:t xml:space="preserve">${xml(t)}</w:t></w:r>`;
const p = (body: string, style?: string, extra = '') =>
  `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${extra}</w:pPr>${body}</w:p>`;

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:cs="Calibri" w:eastAsia="Calibri"/><w:sz w:val="21"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="80"/></w:pPr><w:rPr><w:b/><w:color w:val="1E1B4B"/><w:sz w:val="40"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:color w:val="4F46E5"/><w:sz w:val="30"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:pPr><w:keepNext/><w:spacing w:before="160" w:after="60"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:sz w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Quote"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="4F46E5"/></w:pBdr><w:shd w:val="clear" w:color="auto" w:fill="EEF2FF"/><w:ind w:left="200"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListBullet"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="240"/><w:spacing w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="ListNumber"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360" w:hanging="300"/><w:spacing w:after="40"/></w:pPr></w:style>
</w:styles>`;

function tableXml(head: string[], rows: string[][], widthTwips: number): string {
  const cw = Math.floor(widthTwips / Math.max(1, head.length));
  const border =
    '<w:top w:val="single" w:sz="4" w:color="D4D4E8"/><w:left w:val="single" w:sz="4" w:color="D4D4E8"/><w:bottom w:val="single" w:sz="4" w:color="D4D4E8"/><w:right w:val="single" w:sz="4" w:color="D4D4E8"/><w:insideH w:val="single" w:sz="4" w:color="D4D4E8"/><w:insideV w:val="single" w:sz="4" w:color="D4D4E8"/>';
  const cell = (t: string, headRow: boolean, zebra: boolean) =>
    `<w:tc><w:tcPr><w:tcW w:w="${cw}" w:type="dxa"/>${headRow ? '<w:shd w:val="clear" w:color="auto" w:fill="4F46E5"/>' : zebra ? '<w:shd w:val="clear" w:color="auto" w:fill="F5F5FC"/>' : ''}</w:tcPr>${p(run(t, headRow ? { bold: true, color: 'FFFFFF', size: 18 } : { size: 18 }), undefined, '<w:spacing w:after="0"/>')}</w:tc>`;
  return `<w:tbl><w:tblPr><w:tblW w:w="${widthTwips}" w:type="dxa"/><w:tblBorders>${border}</w:tblBorders><w:tblCellMar><w:top w:w="40" w:type="dxa"/><w:left w:w="80" w:type="dxa"/><w:bottom w:w="40" w:type="dxa"/><w:right w:w="80" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${head.map(() => `<w:gridCol w:w="${cw}"/>`).join('')}</w:tblGrid>
<w:tr><w:trPr><w:tblHeader/></w:trPr>${head.map((h) => cell(h, true, false)).join('')}</w:tr>
${rows.map((r, i) => `<w:tr><w:trPr><w:cantSplit/></w:trPr>${head.map((_, j) => cell(r[j] ?? '', false, i % 2 === 1)).join('')}</w:tr>`).join('\n')}</w:tbl>`;
}

async function docx(bodyXml: string, landscape: boolean, title: string): Promise<Buffer> {
  // A4; landscape for wide tables
  const [wd, ht] = landscape ? [16838, 11906] : [11906, 16838];
  const footer = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${p(run(`${LEGAL_ENTITY} · made with MADP · page `, { size: 14, color: '6B7280' }) + '<w:r><w:rPr><w:sz w:val="14"/><w:color w:val="6B7280"/></w:rPr><w:fldSimple w:instr="PAGE"><w:r><w:t>1</w:t></w:r></w:fldSimple></w:r>')}</w:ftr>`;
  const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><w:body>${bodyXml}
<w:sectPr><w:footerReference w:type="default" r:id="rIdFooter"/><w:pgSz w:w="${wd}" w:h="${ht}"${landscape ? ' w:orient="landscape"' : ''}/><w:pgMar w:top="900" w:right="900" w:bottom="900" w:left="900" w:header="400" w:footer="400" w:gutter="0"/></w:sectPr></w:body></w:document>`;
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`,
  );
  zip.file(
    '_rels/.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`,
  );
  zip.file(
    'docProps/core.xml',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml(title)}</dc:title><dc:creator>MADP</dc:creator></cp:coreProperties>`,
  );
  zip.file(
    'word/_rels/document.xml.rels',
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rIdStyles" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rIdFooter" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/></Relationships>`,
  );
  zip.file('word/document.xml', doc);
  zip.file('word/styles.xml', STYLES);
  zip.file('word/footer1.xml', footer);
  return zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function wordHeader(h: {
  title: string;
  subtitle?: string | undefined;
  brand: string;
  dataMode: DataMode;
  generatedAt: string;
}) {
  return [
    p(run(h.title), 'Title'),
    p(
      run(
        `Brand: ${h.brand.toUpperCase()} · Data: ${h.dataMode === 'demo' ? 'DEMO' : 'live'} · Generated ${h.generatedAt.slice(0, 16).replace('T', ' ')} UTC`,
        { size: 17, color: '6B7280' },
      ),
    ),
    ...(h.subtitle ? [p(run(h.subtitle, { size: 17, color: '6B7280' }))] : []),
    ...(h.dataMode === 'demo' ? [p(run(DEMO_LINE, { bold: true, color: 'C81E3C' }))] : []),
  ].join('');
}

/** The table as a Word document: title, scope, data mode, then a table whose header repeats on every page. */
export async function tableToDocx(t: ExportTable): Promise<Buffer> {
  const landscape = t.columns.length > 4;
  const width = (landscape ? 16838 : 11906) - 1800;
  const rows = t.rows.map((r) => t.columns.map((c) => shown(r[c.key], c.type)));
  const body =
    wordHeader(t) +
    (rows.length
      ? tableXml(
          t.columns.map((c) => c.label),
          rows,
          width,
        )
      : p(run('No rows.', { color: '6B7280' }))) +
    (t.notes ?? []).map((n) => p(run(n, { size: 17, color: '6B7280' }))).join('');
  return docx(body, landscape, t.title);
}

/** A content page or help article as Word, using real Heading 2 / Heading 3 / list styles so it uploads back cleanly. */
export async function documentToDocx(d: ExportDocument): Promise<Buffer> {
  const parts: string[] = [wordHeader(d)];
  for (const b of d.blocks) {
    if (typeof b === 'string') parts.push(p(run(b)));
    else if ('h2' in b) parts.push(p(run(b.h2), 'Heading2'));
    else if ('h3' in b) parts.push(p(run(b.h3), 'Heading3'));
    else if ('note' in b) parts.push(p(run(b.note), 'Quote'));
    else if ('ul' in b) for (const it of b.ul) parts.push(p(run(`•\t${it}`), 'ListBullet'));
    else if ('ol' in b) b.ol.forEach((it, i) => parts.push(p(run(`${i + 1}.\t${it}`), 'ListNumber')));
    else if ('table' in b) parts.push(tableXml(b.table.head, b.table.rows, 11906 - 1800), p(''));
  }
  return docx(parts.join(''), false, d.title);
}

export async function writeTable(t: ExportTable, format: FileFormat): Promise<Buffer> {
  if (format === 'csv') return Buffer.from(tableToCsv(t), 'utf8');
  if (format === 'xlsx') return tableToXlsx(t);
  if (format === 'pdf') return tableToPdf(t);
  return tableToDocx(t);
}
