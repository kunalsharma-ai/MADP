import ExcelJS from 'exceljs';
import JSZip from 'jszip';
import { PDFDocument } from 'pdf-lib';
import { describe, expect, it } from 'vitest';
import { TableExportRequest } from '@madp/contracts';
import {
  ansi,
  documentToDocx,
  documentToPdf,
  fileName,
  tableToCsv,
  writeTable,
  type ExportTable,
} from './writers.js';
import { parseDocx, parseTable } from './parse.js';

const T: ExportTable = {
  title: 'Ticket desk',
  subtitle: 'Status: open · Search: refund',
  brand: 'mfr',
  dataMode: 'demo',
  generatedAt: '2026-11-26T10:00:00.000Z',
  columns: [
    { key: 'no', label: 'Ticket' },
    { key: 'subject', label: 'Subject' },
    { key: 'points', label: 'Points', type: 'number' },
    { key: 'vip', label: 'VIP' },
  ],
  rows: [
    { no: 'demo-T1', subject: '=HYPERLINK("http://x")', points: 1200, vip: true },
    { no: 'demo-T2', subject: 'Payout "late", again\nsecond line', points: null, vip: false },
    { no: 'demo-T3', subject: 'नमस्ते ₹500 café', points: 5, vip: null },
  ],
};

describe('console downloads', () => {
  it('CSV: data mode on every row, formulas defused, quotes and new lines escaped', () => {
    const csv = tableToCsv(T);
    const lines = csv.replace(/^﻿/, '').trim().split('\r\n');
    expect(lines[0]).toBe('data_mode,Ticket,Subject,Points,VIP');
    expect(lines[1]).toBe(`demo,demo-T1,"'=HYPERLINK(""http://x"")",1200,Yes`);
    expect(csv).toContain('"Payout ""late"", again\nsecond line"');
  });

  it('Excel: DEMO sheet name, data mode column, formulas defused, an About sheet', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await writeTable(T, 'xlsx')) as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    expect(ws.name).toContain('DEMO');
    expect(ws.getRow(1).values).toEqual([undefined, 'Data mode', 'Ticket', 'Subject', 'Points', 'VIP']);
    expect(ws.getRow(2).getCell(3).value).toBe(`'=HYPERLINK("http://x")`);
    expect(ws.getRow(2).getCell(4).value).toBe(1200);
    const about = wb.getWorksheet('About')!;
    const text = about.getSheetValues().flat().join(' ');
    expect(text).toContain('DEMO DATA');
    expect(text).toContain('Status: open');
  });

  it('PDF: opens, has pages, survives non-Latin text, many rows spill onto more pages', async () => {
    const many = {
      ...T,
      rows: Array.from({ length: 400 }, (_, i) => ({
        no: `demo-T${i}`,
        subject: 'x '.repeat(i % 50),
        points: i,
        vip: i % 2 === 0,
      })),
    };
    const pdf = await PDFDocument.load(await writeTable(many, 'pdf'));
    expect(pdf.getPageCount()).toBeGreaterThan(3);
    const small = await PDFDocument.load(await writeTable(T, 'pdf'));
    expect(small.getPageCount()).toBe(1);
    expect(small.getTitle()).toBe('Ticket desk');
    expect(ansi('नमस्ते ₹500 café')).toBe('?????? Rs 500 café');
  });

  it('Word: a valid package with the table, header row repeated, DEMO line', async () => {
    const zip = await JSZip.loadAsync(await writeTable(T, 'docx'));
    const doc = await zip.file('word/document.xml')!.async('string');
    expect(doc).toContain('<w:tblHeader/>');
    expect(doc).toContain('DEMO DATA');
    expect(doc).toContain('=HYPERLINK(&quot;http://x&quot;)');
    expect(doc).toContain('नमस्ते ₹500 café');
    expect(zip.file('[Content_Types].xml')).toBeTruthy();
  });

  it('file names: screen, brand, DEMO and date, nothing else', () => {
    expect(fileName('Ticket desk', 'mfr', 'demo', T.generatedAt, 'pdf')).toBe(
      'madp-ticket-desk-mfr-DEMO-2026-11-26.pdf',
    );
    expect(fileName('../../etc', 'all', 'live', T.generatedAt, 'csv')).toBe('madp-etc-all-2026-11-26.csv');
  });

  it('the request contract caps rows and columns and refuses unknown screens', () => {
    const ok = {
      screen: 'tickets',
      format: 'xlsx',
      title: 'x',
      columns: [{ key: 'a', label: 'A' }],
      rows: [{ a: 1 }],
    };
    expect(TableExportRequest.safeParse(ok).success).toBe(true);
    expect(TableExportRequest.safeParse({ ...ok, screen: 'nope' }).success).toBe(false);
    expect(
      TableExportRequest.safeParse({ ...ok, rows: Array.from({ length: 10_001 }, () => ({ a: 1 })) }).success,
    ).toBe(false);
    expect(TableExportRequest.safeParse({ ...ok, columns: [ok.columns[0], ok.columns[0]] }).success).toBe(
      false,
    );
    expect(TableExportRequest.safeParse({ ...ok, rows: [{ a: { nested: true } }] }).success).toBe(false);
  });
});

const PAGE = {
  title: 'Privacy policy',
  brand: 'mho',
  dataMode: 'demo' as const,
  generatedAt: T.generatedAt,
  blocks: [
    { h2: 'What we collect' },
    'We collect the answers you give & nothing <else>.',
    { ul: ['Your e-mail', 'Your answers'] },
    { h3: 'Health answers' },
    { note: 'Health answers are special-category data.' },
    { ol: ['Ask us', 'We reply in 30 days'] },
    {
      table: {
        head: ['Data', 'Kept for'],
        rows: [
          ['Answers', '2 years'],
          ['E-mail', 'While you are a member'],
        ],
      },
    },
  ],
};

describe('console uploads', () => {
  it('a MADP Word download uploads back to the same blocks', async () => {
    const back = await parseDocx(await documentToDocx(PAGE));
    expect(back.title).toBe('Privacy policy');
    expect(back.blocks).toEqual(PAGE.blocks);
    expect(back.warnings).toEqual([]);
  });

  it('a page also downloads as PDF', async () => {
    const pdf = await PDFDocument.load(await documentToPdf(PAGE));
    expect(pdf.getPageCount()).toBe(1);
  });

  it('Word lists made with real numbering (numbering.xml) become ul and ol', async () => {
    const zip = await JSZip.loadAsync(await documentToDocx({ ...PAGE, blocks: ['x'] }));
    const p = (t: string, num?: string, style?: string) =>
      `<w:p><w:pPr>${style ? `<w:pStyle w:val="${style}"/>` : ''}${num ? `<w:numPr><w:ilvl w:val="0"/><w:numId w:val="${num}"/></w:numPr>` : ''}</w:pPr><w:r><w:t>${t}</w:t></w:r></w:p>`;
    zip.file(
      'word/document.xml',
      `<w:document xmlns:w="w"><w:body>${p('Guide', undefined, 'Heading1')}${p('One', '1')}${p('Two', '1')}${p('First', '2')}${p('Plain')}<w:p/></w:body></w:document>`,
    );
    zip.file(
      'word/numbering.xml',
      `<w:numbering><w:abstractNum w:abstractNumId="0"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num><w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num></w:numbering>`,
    );
    zip.remove('word/styles.xml');
    const r = await parseDocx(await zip.generateAsync({ type: 'nodebuffer' }));
    expect(r.title).toBe('Guide');
    expect(r.blocks).toEqual([{ ul: ['One', 'Two'] }, { ol: ['First'] }, 'Plain']);
  });

  it('refuses a file that is not Word, and an empty one', async () => {
    await expect(parseDocx(Buffer.from('hello'))).rejects.toThrow(/Word/);
    const zip = await JSZip.loadAsync(await documentToDocx({ ...PAGE, blocks: ['x'] }));
    zip.file('word/document.xml', '<w:document><w:body><w:p/></w:body></w:document>');
    await expect(parseDocx(await zip.generateAsync({ type: 'nodebuffer' }))).rejects.toThrow(/No text/);
  });

  it('spreadsheets: CSV and every Excel sheet as rows of text', async () => {
    const csv = await parseTable('t.csv', Buffer.from('﻿name,label\r\ndemo-a,"Hello, ""you"""\r\n\r\n'));
    expect(csv.sheets[0]!.rows).toEqual([
      ['name', 'label'],
      ['demo-a', 'Hello, "you"'],
    ]);
    const xlsx = await parseTable('t.xlsx', await writeTable(T, 'xlsx'));
    expect(xlsx.sheets.map((s) => s.name)).toEqual(['Ticket desk (DEMO)', 'About']);
    expect(xlsx.sheets[0]!.rows[1]!.slice(0, 3)).toEqual(['demo', 'demo-T1', `'=HYPERLINK("http://x")`]);
    await expect(parseTable('t.pdf', Buffer.from('x'))).rejects.toThrow(/Excel/);
    await expect(parseTable('t.xlsx', Buffer.from('x'))).rejects.toThrow(/could not be opened/);
  });
});
