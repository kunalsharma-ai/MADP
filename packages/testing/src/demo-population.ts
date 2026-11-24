import type { PanelCode, SourceAnswer, SourceConsent, SourceRespondent } from '@madp/contracts';
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
  t2o: ['b2c', 'b2c', 'b2c', 'b2b', 'b2c', 'b2c', 'b2b', 'b2c', 'b2c', 'minor'],
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

/** Guardian consent outcomes for DEMO teen members, weighted roughly like a live sign-up funnel. */
const GUARDIAN_OUTCOMES = [
  ['approved', 'granted'],
  ['approved', 'granted'],
  ['approved', 'granted'],
  ['pending', 'unknown'],
  ['declined', 'denied'],
  ['withdrawn', 'withdrawn'],
] as const;

function demoConsents(r: () => number, rm: () => number, sourceCategory: string, created: Date): SourceConsent[] {
  const out: SourceConsent[] = [
    {
      purpose: 'terms',
      status: 'granted',
      capturedAt: null,
      evidence: { field: 'terms', value: null, version: 'demo-terms-v1' },
    },
  ];
  if (sourceCategory.includes('minor')) {
    const [value, status] = pick(r, GUARDIAN_OUTCOMES);
    out.push({
      purpose: 'guardian_consent',
      status,
      capturedAt: status === 'unknown' ? null : new Date(created.getTime() + 2 * 86_400_000).toISOString(),
      evidence: { field: 'parent.consentStatus', value, version: 'demo-guardian-v1' },
    });
  }
  // Marketing e-mail opt-in ("Send me news and offers"): about a third never asked (no record), and teens never opt
  // in. Only this record counts as email_marketing; the "news-letter" profile answer never does.
  const m = rm();
  if (!sourceCategory.includes('minor') && m < 0.66) {
    const status: SourceConsent['status'] = m < 0.3 ? 'granted' : m < 0.55 ? 'denied' : 'withdrawn';
    out.push({
      purpose: 'email_marketing',
      status,
      capturedAt: new Date(created.getTime() + (status === 'withdrawn' ? 40 : 0) * 86_400_000).toISOString(),
      evidence: {
        field: 'marketingOptIn.granted',
        value: String(status === 'granted'),
        version: `news-offers-v1@${status === 'withdrawn' ? 'profile' : 'signup'}`,
      },
    });
  }
  const push = r() < 0.6;
  out.push({
    purpose: 'push_notifications',
    status: push ? 'granted' : 'denied',
    capturedAt: null,
    evidence: { field: 'consent.canAcceptPushNotification', value: String(push), version: null },
  });
  return out;
}

export function generateDemoPopulation({
  people,
  seed = 20261123,
  overlapRate = 0.18,
  now = new Date('2026-11-01T00:00:00Z'),
}: DemoOptions): DemoPopulation {
  const r = rng(seed);
  // A separate stream for the marketing opt-in, so adding it left every other DEMO value unchanged.
  const rm = rng(seed + 1);
  const respondents: SourceRespondent[] = [];
  const answers: SourceAnswer[] = [];
  const panels: PanelCode[] = ['t2o', 'mfr', 'mho'];
  const samples = Object.fromEntries(panels.map((p) => [p, loadSourceSample(p)])) as Record<
    PanelCode,
    ReturnType<typeof loadSourceSample>
  >;
  // Pre-index each sample once: options by question, and questions by questionnaire.
  const index = Object.fromEntries(
    panels.map((p) => {
      const sample = samples[p];
      const optionsByQuestion = new Map<string, (typeof sample.options)[number][]>();
      for (const o of sample.options) {
        const list = optionsByQuestion.get(o.question) ?? [];
        list.push(o);
        optionsByQuestion.set(o.question, list);
      }
      const questionByName = new Map(sample.questions.map((q) => [q.name, q]));
      return [p, { optionsByQuestion, questionByName }];
    }),
  ) as Record<
    PanelCode,
    {
      optionsByQuestion: Map<string, ReturnType<typeof loadSourceSample>['options']>;
      questionByName: Map<string, ReturnType<typeof loadSourceSample>['questions'][number]>;
    }
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
        // A teen account gets a 13-17 birth date so the record is internally consistent.
        dateOfBirth: sourceCategory.includes('minor')
          ? `${now.getUTCFullYear() - 13 - (Number(n) % 5)}-06-15`
          : dob.toISOString().slice(0, 10),
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
        consents: demoConsents(r, rm, sourceCategory, created),
      });

      // Answer like a real member: the basic questionnaire plus a few other sections (all sections when the
      // sample has only a handful), most questions within each chosen section.
      const sample = samples[panel];
      const { optionsByQuestion, questionByName } = index[panel];
      // A section belongs to the member's category when its own category matches or any of its questions do
      // (MHO's caregiver export labels caregiver sections "healthcare professional"; see the MHO audit).
      const sections = sample.profiles.filter(
        (qn) =>
          qn.sourceCategory === sourceCategory ||
          qn.pages.some((pg) =>
            pg
              .slice(1)
              .some((n) =>
                ([] as string[]).concat(questionByName.get(n)?.category ?? []).includes(sourceCategory),
              ),
          ),
      );
      const chosen =
        sections.length <= 4 ? sections : sections.filter((qn) => qn.slug === 'basic' || r() < 0.1);
      const given = new Map<string, string[]>();
      for (const name of new Set(chosen.flatMap((qn) => qn.pages.flatMap((pg) => pg.slice(1))))) {
        const q = questionByName.get(name);
        if (!q || !([] as string[]).concat(q.category).includes(sourceCategory) || r() < 0.35) continue;
        const parentAnswer = q.parent ? given.get(q.parent) : undefined;
        const opts = (optionsByQuestion.get(q.name) ?? []).filter(
          (o) => o.parentValue.length === 0 || (parentAnswer ?? []).some((v) => o.parentValue.includes(v)),
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

/**
 * DEMO reward rows and survey responses for a population, from their own seed so the people stay the same.
 * Profile credits look like the panel's (50 points per finished profile); survey responses mix completes,
 * terminates and invitations, and a few completes are later reversed to `terminate` by the panel.
 */
export function generateDemoLoyalty(pop: DemoPopulation, seed = 20261124) {
  const r = rng(seed);
  const rewards: import('@madp/contracts').SourceReward[] = [];
  const responses: import('@madp/contracts').SourceResponse[] = [];
  const surveys = ['demo-survey-a', 'demo-survey-b', 'demo-survey-c', 'demo-survey-d'];
  for (const m of pop.respondents) {
    if (m.isStaff) continue;
    const created = m.sourceCreatedAt ?? '2026-01-01T00:00:00.000Z';
    const at = (days: number) => new Date(Date.parse(created) + days * 86_400_000).toISOString();
    for (const [k, slug] of ['basic', 'household'].entries()) {
      if (k > 0 && r() < 0.5) continue;
      rewards.push({
        panel: m.panel,
        sourceRewardId: `demo-rw-${m.sourceMemberId}-${slug}`,
        sourceMemberId: m.sourceMemberId,
        category: 'profile',
        points: 50,
        title: slug,
        status: 'credited',
        profileSlug: slug,
        sourceCreatedAt: at(k + 1),
        sourceUpdatedAt: at(k + 1),
      });
    }
    const taken = surveys.filter(() => r() < 0.4);
    for (const [k, slug] of taken.entries()) {
      const roll = r();
      const status = roll < 0.55 ? 'complete' : roll < 0.8 ? 'terminate' : 'invited';
      responses.push({
        panel: m.panel,
        sourceResponseId: `demo-rs-${m.sourceMemberId}-${slug}`,
        sourceMemberId: m.sourceMemberId,
        surveySlug: slug,
        status,
        points: status === 'complete' ? 100 + 20 * k : 0,
        loi: 10 + k * 5,
        source: 'demo',
        startedAt: at(10 + k),
        endedAt: status === 'invited' ? null : at(10 + k),
        isDeleted: false,
        sourceUpdatedAt: at(10 + k),
      });
    }
  }
  return { rewards, responses };
}
