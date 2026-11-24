import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { bankToXlsx, xlsxToBank } from './bank-workbook.js';

const BANK = {
  exportedAt: '2026-11-24T00:00:00.000Z',
  Profile: [{ slug: 'demo-household', category: 'b2c', name: 'household', isActive: true, pages: [['Household', 'demo-size']] }],
  Question: [
    { name: 'demo-size', label: 'How many people?', type: 'radio', category: ['b2c'], parent: null },
    { name: 'demo-formula', label: '=HYPERLINK("x")', type: 'text', category: ['b2c'], minAge: 18 },
  ],
  Option: [
    { question: 'demo-size', value: '1', label: '1', parentValue: [], sortOrder: 1 },
    { question: 'demo-size', value: '5+', label: '5 or more', parentValue: [], sortOrder: 2 },
  ],
};

async function edit(file: Buffer, fn: (wb: ExcelJS.Workbook) => void) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(file as unknown as ArrayBuffer);
  fn(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('question bank workbook', () => {
  it('round-trips the export shape, lists as JSON, nulls left out', async () => {
    const file = await bankToXlsx(BANK, { brand: 'mfr', dataMode: 'demo' });
    const { bank, problems } = await xlsxToBank(file);
    expect(problems).toEqual([]);
    expect(bank.Profile).toEqual(BANK.Profile);
    expect(bank.Option).toEqual(BANK.Option);
    expect(bank.Question![0]).toEqual({ name: 'demo-size', label: 'How many people?', type: 'radio', category: ['b2c'] });
    // A label that looks like a formula is stored as text and comes back unchanged.
    expect(bank.Question![1]!.label).toBe('=HYPERLINK("x")');
  });

  it('labels DEMO, hides the type sheet, and stores formula-like text with a prefix', async () => {
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await bankToXlsx(BANK, { brand: 'mho', dataMode: 'demo' })) as unknown as ArrayBuffer);
    expect(wb.getWorksheet('_columns')!.state).toBe('veryHidden');
    expect(String(wb.getWorksheet('About')!.getRow(3).getCell(2).value)).toContain('DEMO');
    const q = wb.getWorksheet('Question')!;
    expect(q.getRow(1).values).toContain('category [json]');
    expect(q.getRow(3).getCell(2).value).toBe(`'=HYPERLINK("x")`);
  });

  it('keeps exported types when an editor retypes a value, and refuses formulas and broken JSON', async () => {
    const file = await bankToXlsx(BANK, { brand: 't2o', dataMode: 'demo' });
    const retyped = await edit(file, (wb) => {
      const o = wb.getWorksheet('Option')!;
      o.getRow(2).getCell(2).value = 7; // value "1" retyped as a number
      o.getRow(2).getCell(5).value = '3'; // sortOrder typed as text
    });
    const r = await xlsxToBank(retyped);
    expect(r.bank.Option![0]).toMatchObject({ value: '7', sortOrder: 3 });

    const broken = await edit(file, (wb) => {
      wb.getWorksheet('Question')!.getRow(2).getCell(2).value = { formula: 'A1&"x"', result: 'demo-sizex' };
      wb.getWorksheet('Option')!.getRow(3).getCell(4).value = '[not json';
    });
    const b = await xlsxToBank(broken);
    expect(b.problems).toEqual([
      'Question row 2, label: formulas are not imported; type the value.',
      'Option row 3, parentValue: not valid JSON.',
    ]);
  });

  it('refuses a file that is not a workbook, or has no bank rows', async () => {
    expect((await xlsxToBank(Buffer.from('not a zip'))).problems).toEqual(['That file is not an Excel workbook (.xlsx).']);
    const empty = new ExcelJS.Workbook();
    empty.addWorksheet('Sheet1').addRow(['x']);
    expect((await xlsxToBank(Buffer.from(await empty.xlsx.writeBuffer()))).problems).toEqual(['No Profile, Question or Option rows found.']);
  });
});
