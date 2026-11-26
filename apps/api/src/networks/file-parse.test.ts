import { describe, expect, it } from 'vitest';
import { mapColumns, parseCsv, readRows } from './file-parse.js';

describe('network files', () => {
  it('reads quoted CSV fields, CRLF and a BOM', () => {
    expect(parseCsv('﻿a,b\r\n"x, y","say ""hi"""\r\n\r\n1,\n')).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', ''],
    ]);
  });

  it('matches headers by name or alias, ignoring case, spaces, - and _', () => {
    expect(mapColumns('members', ['Member ID', 'E-mail', 'DOB', 'favourite colour'])).toEqual([
      { column: 'Member ID', field: 'memberId' },
      { column: 'E-mail', field: 'email' },
      { column: 'DOB', field: 'dateOfBirth' },
      { column: 'favourite colour', field: null },
    ]);
  });

  it('reports a missing required column and bad rows without echoing values', () => {
    expect(readRows('members', [['email'], ['a@example.invalid']]).problems).toEqual([
      { row: 1, message: 'Missing columns: memberId, category' },
    ]);
    const r = readRows('members', [
      ['member_id', 'category', 'active', 'date_of_birth', 'country'],
      ['demo-1', 'b2c', 'yes', '1990-04-12T00:00:00.000Z', 'in'],
      ['demo-2', 'b2c', 'maybe', '', ''],
      ['demo-3', 'b2c', 'yes', '12/04/1990', ''],
    ]);
    expect(r.items).toMatchObject([{ memberId: 'demo-1', active: true, dateOfBirth: '1990-04-12', country: 'in' }]);
    // An unclear yes/no and a day-month date are reported, not guessed.
    expect(r.problems.map((p) => p.row)).toEqual([3, 4]);
    expect(r.problems[1]!.message).toContain('YYYY-MM-DD');
    expect(JSON.stringify(r.problems)).not.toContain('maybe');
  });

  it('splits multi-value answers and question options', () => {
    const a = readRows('answers', [['member_id', 'question_id', 'value'], ['demo-1', 'pets', 'cat | dog']]);
    expect(a.items).toEqual([{ memberId: 'demo-1', questionId: 'pets', values: ['cat', 'dog'], updatedAt: null }]);
    const q = readRows('questions', [['question_id', 'label', 'options'], ['pets', 'Your pets?', 'cat=Cat|dog']]);
    expect(q.items).toMatchObject([{ options: [{ value: 'cat', label: 'Cat' }, { value: 'dog', label: 'dog' }] }]);
  });
});
