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

  it('gives DEMO teen members a guardian consent status and a teen birth date', () => {
    const { respondents } = generateDemoPopulation({ people: 400 });
    const teens = respondents.filter((r) => r.sourceCategory === 'minor');
    expect(teens.length).toBeGreaterThan(0);
    for (const r of teens) {
      expect(r.consents.find((c) => c.purpose === 'guardian_consent')).toBeDefined();
      const age = 2026 - Number(r.dateOfBirth!.slice(0, 4));
      expect(age).toBeGreaterThanOrEqual(13);
      expect(age).toBeLessThanOrEqual(17);
    }
    const adults = respondents.filter((r) => !r.sourceCategory.includes('minor'));
    expect(adults.every((r) => !r.consents.some((c) => c.purpose === 'guardian_consent'))).toBe(true);
  });
});
