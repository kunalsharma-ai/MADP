import { describe, expect, it } from 'vitest';
import { generateDemoPopulation } from './demo-population.js';

describe('generateDemoPopulation', () => {
  it('is deterministic and clearly synthetic', () => {
    const a = generateDemoPopulation({ people: 200 });
    const b = generateDemoPopulation({ people: 200 });
    expect(a).toEqual(b);
    for (const r of a.respondents) {
      expect(r.sourceMemberId.startsWith('demo-')).toBe(true);
      expect(r.email?.endsWith('@example.invalid')).toBe(true);
    }
  });

  it('creates every panel and some cross-panel overlaps', () => {
    const { respondents, answers } = generateDemoPopulation({ people: 300 });
    const panels = new Set(respondents.map((r) => r.panel));
    expect([...panels].sort()).toEqual(['mfr', 'mho', 't2o']);
    const emails = respondents.map((r) => r.email);
    expect(emails.length).toBeGreaterThan(new Set(emails).size);
    expect(answers.length).toBeGreaterThan(0);
  });
});
