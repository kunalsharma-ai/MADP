import { describe, expect, it } from 'vitest';
import { categoriesFor, nativeType, QUESTION_TYPES, QUESTION_TYPE_GROUPS, segmentsFor, typeInfo } from './question-types.js';

const segments = [
  { key: 'consumer', minors: false },
  { key: 'teen', minors: true },
  { key: 'patient', minors: false },
  { key: 'healthcare_professional', minors: false },
];
const rule = (panel: string, sourceValue: string, segment: string, minor = false) => ({ panel, sourceValue, segment, minor, status: 'active' as const });
const rules = [
  rule('t2o', 'b2c', 'consumer'),
  rule('t2o', 'minor', 'consumer', true),
  rule('t2o', 'minor', 'teen', true),
  rule('mho', 'patient', 'patient'),
  rule('mho', 'minor patient', 'patient', true),
  rule('mho', 'minor patient', 'teen', true),
  rule('mho', 'healthcare professional', 'healthcare_professional'),
];

describe('question type catalogue', () => {
  it('puts every type in a known group with a unique key', () => {
    const groups = new Set(QUESTION_TYPE_GROUPS.map((g) => g.key));
    expect(new Set(QUESTION_TYPES.map((t) => t.key)).size).toBe(QUESTION_TYPES.length);
    for (const t of QUESTION_TYPES) {
      expect(groups.has(t.group)).toBe(true);
      expect(t.settings).toContain('isRequired');
      // Other / None / Skip only make sense with an answer list.
      if (!t.choice) expect(t.settings.some((s) => s === 'hasOthers' || s === 'hasNone' || s === 'hasSkip')).toBe(false);
    }
  });

  it('reads each panel’s own type words', () => {
    expect(typeInfo('open end single line')?.key).toBe('text');
    expect(typeInfo('TEXT')?.key).toBe('text');
    expect(typeInfo('open end multiline')?.key).toBe('textarea');
    expect(typeInfo('document')?.key).toBe('document');
    expect(typeInfo('hologram')).toBeUndefined();
  });

  it('writes the word each panel already uses, and flags a new one', () => {
    expect(nativeType('text', 'mfr')).toEqual({ type: 'open end single line', known: true });
    expect(nativeType('text', 't2o')).toEqual({ type: 'text', known: true });
    expect(nativeType('multiselect', 'mho')).toEqual({ type: 'multiselect', known: false });
  });
});

describe('segments to panel categories', () => {
  it('uses adult rules for adult segments and minor rules for Teens', () => {
    expect(categoriesFor('t2o', ['consumer'], segments, rules)).toEqual({ categories: ['b2c'], missing: [] });
    expect(categoriesFor('t2o', ['consumer', 'teen'], segments, rules).categories).toEqual(['b2c', 'minor']);
    expect(categoriesFor('mho', ['teen'], segments, rules).categories).toEqual(['minor patient']);
  });

  it('lists segments a panel does not have', () => {
    expect(categoriesFor('t2o', ['healthcare_professional'], segments, rules)).toEqual({ categories: [], missing: ['healthcare_professional'] });
  });

  it('reads segments back from categories', () => {
    expect(segmentsFor('t2o', ['b2c', 'minor'], segments, rules).sort()).toEqual(['consumer', 'teen']);
    expect(segmentsFor('mho', ['minor patient'], segments, rules)).toEqual(['teen']);
    expect(segmentsFor('t2o', ['b2c-minor'], segments, rules)).toEqual([]);
  });

  it('ignores archived rules', () => {
    expect(categoriesFor('t2o', ['consumer'], segments, [{ ...rules[0]!, status: 'archived' }]).missing).toEqual(['consumer']);
  });
});
