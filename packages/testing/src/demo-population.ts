import type { PanelCode, SourceAnswer, SourceRespondent } from '@madp/contracts';
import { PANELS } from '@madp/contracts';
import { loadSourceSample } from './samples.js';
import { pick, rng } from './random.js';

/**
 * DEMO population generator. Every record is synthetic: names are "Demo Member NNNN", e-mail addresses
 * use the reserved `.invalid` TLD, and IDs start with "demo-". These records must only ever be stored
 * with data_mode = 'demo' and must never be mixed into live counts.
 */
export interface DemoPopulation {
  respondents: SourceRespondent[];
  answers: SourceAnswer[];
}

const COUNTRIES = [
  {
    code: 'IN',
    states: ['maharashtra', 'karnataka', 'delhi'],
    cities: ['mumbai', 'bengaluru', 'new delhi'],
    tz: 'Asia/Kolkata',
  },
  {
    code: 'US',
    states: ['california', 'texas', 'new york'],
    cities: ['los angeles', 'austin', 'new york'],
    tz: 'America/New_York',
  },
  { code: 'GB', states: ['england', 'scotland'], cities: ['london', 'edinburgh'], tz: 'Europe/London' },
  { code: 'CA', states: ['ontario', 'quebec'], cities: ['toronto', 'montreal'], tz: 'America/Toronto' },
  {
    code: 'AU',
    states: ['new south wales', 'victoria'],
    cities: ['sydney', 'melbourne'],
    tz: 'Australia/Sydney',
  },
  { code: 'AE', states: ['dubai'], cities: ['dubai'], tz: 'Asia/Dubai' },
  { code: 'DE', states: ['bavaria', 'berlin'], cities: ['munich', 'berlin'], tz: 'Europe/Berlin' },
] as const;

const SOURCE_CATEGORIES: Record<PanelCode, string[]> = {
  t2o: ['b2c', 'b2c', 'b2c', 'b2b'],
  mfr: ['b2c', 'b2c', 'b2b'],
  mho: ['healthcare professional', 'patient', 'patient', 'care giver'],
};

export interface DemoOptions {
  people: number;
  seed?: number;
  /** Share of people who also hold an account on a second panel (same e-mail) - exercises identity resolution. */
  overlapRate?: number;
  now?: Date;
}

export function generateDemoPopulation({
  people,
  seed = 20261123,
  overlapRate = 0.18,
  now = new Date('2026-11-01T00:00:00Z'),
}: DemoOptions): DemoPopulation {
  const r = rng(seed);
  const respondents: SourceRespondent[] = [];
  const answers: SourceAnswer[] = [];
  const panels: PanelCode[] = ['t2o', 'mfr', 'mho'];
  const samples = Object.fromEntries(panels.map((p) => [p, loadSourceSample(p)])) as Record<
    PanelCode,
    ReturnType<typeof loadSourceSample>
  >;

  for (let i = 1; i <= people; i++) {
    const n = String(i).padStart(5, '0');
    const home = pick(r, panels);
    const memberOf = new Set<PanelCode>([home]);
    if (r() < overlapRate)
      memberOf.add(
        pick(
          r,
          panels.filter((p) => p !== home),
        ),
      );
    const country = pick(r, COUNTRIES);
    const si = Math.floor(r() * country.states.length);
    const gender = pick(r, ['Male', 'Female', 'Other'] as const);
    const age = 18 + Math.floor(r() * 60);
    const dob = new Date(
      Date.UTC(now.getUTCFullYear() - age, Math.floor(r() * 12), 1 + Math.floor(r() * 28)),
    );
    const created = new Date(now.getTime() - Math.floor(r() * 900) * 86_400_000);

    for (const panel of memberOf) {
      const sourceCategory = pick(r, SOURCE_CATEGORIES[panel]);
      const id = `demo-${panel}-${n}`;
      respondents.push({
        panel,
        sourceMemberId: id,
        sourceRespondentRef: `${PANELS[panel].shortName}-DEMO-${n}`,
        sourceCategory,
        email: `demo.member.${n}@example.invalid`,
        phone: null,
        firstName: 'Demo',
        lastName: `Member ${n}`,
        gender,
        dateOfBirth: dob.toISOString().slice(0, 10),
        country: country.code.toLowerCase(),
        state: country.states[si] ?? null,
        city: country.cities[si] ?? null,
        timezone: country.tz,
        emailVerification: r() < 0.82 ? 'verified' : 'unverified',
        phoneVerification: r() < 0.4 ? 'verified' : 'unverified',
        qualityScore: 60 + Math.floor(r() * 140),
        isActive: r() > 0.07,
        sourceCreatedAt: created.toISOString(),
        sourceUpdatedAt: new Date(created.getTime() + Math.floor(r() * 60) * 86_400_000).toISOString(),
      });

      // answer a random subset of that panel's sampled questions for the respondent's category
      const sample = samples[panel];
      const given = new Map<string, string[]>();
      for (const q of sample.questions) {
        const cats = ([] as string[]).concat(q.category);
        if (!cats.includes(sourceCategory) || r() < 0.35) continue;
        const parentAnswer = q.parent ? given.get(q.parent) : undefined;
        const opts = sample.options.filter(
          (o) =>
            o.question === q.name &&
            (o.parentValue.length === 0 || (parentAnswer ?? []).some((v) => o.parentValue.includes(v))),
        );
        if (opts.length === 0) continue;
        const multi = q.type === 'multiselect' && opts.length > 1;
        const values = multi
          ? [...new Set([pick(r, opts).value, pick(r, opts).value])]
          : [pick(r, opts).value];
        given.set(q.name, values);
        answers.push({
          panel,
          sourceMemberId: id,
          sourceQuestionId: q.name,
          values,
          sourceUpdatedAt: created.toISOString(),
        });
      }
    }
  }
  return { respondents, answers };
}
