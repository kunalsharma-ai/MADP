import { describe, expect, it } from 'vitest';
import {
  checkDraft,
  liveRule,
  planWrites,
  simulate,
  specFromSource,
  type BuilderQuestion,
  type BuilderSource,
  type DraftSpec,
} from './questionnaire.js';

const q = (name: string, type: string, extra: Partial<BuilderQuestion> = {}): BuilderQuestion => ({
  name,
  label: name,
  type,
  parent: null,
  isRequired: true,
  category: ['b2c'],
  topic: null,
  options: [],
  ...extra,
});
const opts = (vals: string[], parentValue: string[] = []) => vals.map((v) => ({ value: v, label: v, parentValue }));

function source(category = 'b2c'): BuilderSource {
  return {
    panel: 'mfr',
    profileId: 'a'.repeat(24),
    slug: 'household',
    category,
    name: 'household',
    isActive: true,
    pages: [
      { title: 'Home', questions: ['has-children', 'children-count', 'children-ages'] },
      { title: 'Car', questions: ['owns-car', 'car-brand'] },
    ],
    questions: {
      'has-children': q('has-children', 'radio', { options: opts(['yes', 'no']) }),
      'children-count': q('children-count', 'open end single line', { parent: 'has-children' }),
      'children-ages': q('children-ages', 'checkbox', { parent: 'has-children', options: opts(['0-5', '6-12'], ['yes']) }),
      'owns-car': q('owns-car', 'radio', { options: opts(['yes', 'no']) }),
      'car-brand': q('car-brand', 'select', { options: opts(['a', 'b']) }),
      country: q('country', 'select', { options: opts(['in', 'us']) }),
      state: q('state', 'select', {
        parent: 'country',
        options: [...opts(['dl', 'mh'], ['in']), ...opts(['ca', 'ny'], ['us'])],
      }),
      vape: q('vape', 'radio', { topic: 'nicotine', options: opts(['yes', 'no']) }),
    },
    bank: [],
    exportedAt: null,
  };
}

describe('questionnaire builder: the panel rule', () => {
  it('reads the live rule from parent and option parentValue', () => {
    const s = source();
    expect(liveRule(s.questions['children-ages']!)).toEqual({ parent: 'has-children', values: ['yes'] });
    expect(liveRule(s.questions['children-count']!)).toEqual({ parent: 'has-children', values: [] });
    expect(liveRule(s.questions['car-brand']!)).toEqual({ parent: null, values: [] });
    expect(liveRule(s.questions.state!)).toBe('dependent');
  });

  it('preview: hidden until the parent is answered, then by value for choice questions', () => {
    const s = source();
    const spec = specFromSource(s);
    const shown = (a: Record<string, string | string[]>) =>
      Object.fromEntries(simulate(s, spec, a).map((x) => [x.question, x.shown]));
    expect(shown({})).toMatchObject({ 'has-children': true, 'children-count': false, 'children-ages': false });
    expect(shown({ 'has-children': 'no' })).toMatchObject({ 'children-count': true, 'children-ages': false });
    expect(shown({ 'has-children': 'yes' })).toMatchObject({ 'children-count': true, 'children-ages': true });
  });

  it('a draft rule "car-brand when owns-car is yes" previews and plans one options write', () => {
    const s = source();
    const spec: DraftSpec = { ...specFromSource(s), rules: { 'car-brand': { parent: 'owns-car', values: ['yes'] } } };
    expect(checkDraft(s, spec).filter((p) => p.level === 'error')).toEqual([]);
    const sim = (a: Record<string, string>) => simulate(s, spec, a).find((x) => x.question === 'car-brand')!;
    expect(sim({ 'owns-car': 'no' })).toMatchObject({ shown: false, reason: 'value_not_matched' });
    expect(sim({ 'owns-car': 'yes' })).toMatchObject({ shown: true, options: ['a', 'b'] });
    const w = planWrites(s, spec);
    expect(w.map((x) => [x.kind, x.target])).toEqual([
      ['question', 'car-brand'],
      ['options', 'car-brand'],
    ]);
    expect(w[0]!.body).toEqual({ parent: 'owns-car' });
    expect(w[1]!.body.options).toEqual([
      { value: 'a', label: 'a', parentValue: ['yes'] },
      { value: 'b', label: 'b', parentValue: ['yes'] },
    ]);
  });

  it('removing a rule clears the parent and the option conditions', () => {
    const s = source();
    const spec: DraftSpec = { ...specFromSource(s), rules: { 'children-ages': { parent: null, values: [] } } };
    const w = planWrites(s, spec);
    expect(w[0]).toMatchObject({ kind: 'question', target: 'children-ages', body: { parent: '' } });
    expect((w[1]!.body.options as { parentValue: string[] }[]).every((o) => o.parentValue.length === 0)).toBe(true);
  });

  it('plans nothing for an unchanged draft, and pages last when they change', () => {
    const s = source();
    expect(planWrites(s, specFromSource(s))).toEqual([]);
    const spec = specFromSource(s);
    spec.pages[1]!.questions.reverse();
    spec.required = { 'owns-car': false };
    const w = planWrites(s, spec);
    expect(w.map((x) => x.kind)).toEqual(['question', 'profile_pages']);
    expect(w[0]!.body).toEqual({ isRequired: false });
    expect(w[1]!.body.pages).toEqual([
      ['Home', 'has-children', 'children-count', 'children-ages'],
      ['Car', 'car-brand', 'owns-car'],
    ]);
  });
});

describe('questionnaire builder: checks', () => {
  const codes = (s: BuilderSource, spec: DraftSpec) => checkDraft(s, spec).map((p) => `${p.level}:${p.code}:${p.question}`);

  it('refuses a parent that comes later, a value that is not an answer, and values on a typed question', () => {
    const s = source();
    const spec = specFromSource(s);
    spec.rules = {
      'has-children': { parent: 'owns-car', values: ['yes'] },
      'car-brand': { parent: 'owns-car', values: ['maybe'] },
      'children-count': { parent: 'has-children', values: ['yes'] },
    };
    expect(codes(s, spec)).toEqual(
      expect.arrayContaining([
        'error:parent_later:has-children',
        'error:value_not_an_option:car-brand',
        'error:typed_values:children-count',
      ]),
    );
  });

  it('finds loops, duplicates and unknown questions', () => {
    const s = source();
    const spec = specFromSource(s);
    spec.pages[0]!.questions.push('owns-car', 'nope');
    spec.rules = { 'owns-car': { parent: 'car-brand', values: ['a'] }, 'car-brand': { parent: 'owns-car', values: ['yes'] } };
    const c = codes(s, spec);
    expect(c).toEqual(expect.arrayContaining(['error:duplicate:owns-car', 'error:unknown_question:nope', 'error:cycle:owns-car']));
  });

  it('keeps dependent lists as they are, and warns about a parent outside the profile', () => {
    const s = source();
    const spec = specFromSource(s);
    spec.pages[1]!.questions.push('state');
    expect(codes(s, spec)).toEqual(['warning:dependent_list:state']);
    spec.pages[1]!.questions.pop();
    spec.pages[1]!.questions.push('car-brand-2');
    s.questions['car-brand-2'] = q('car-brand-2', 'radio', { parent: 'country', options: opts(['x'], ['in']) });
    expect(codes(s, spec)).toEqual(['warning:unreachable:car-brand-2']);
  });

  it('applies the teen guardrails on Teen Panel profiles', () => {
    const s = source('b2c-minor');
    const spec = specFromSource(s);
    spec.pages[1]!.questions.push('vape');
    expect(codes(s, spec)).toContain('error:teen_topic:vape');
    const adult = source();
    const a = specFromSource(adult);
    a.pages[1]!.questions.push('vape');
    expect(codes(adult, a)).toEqual([]);
  });
});
