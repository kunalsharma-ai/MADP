import { z } from 'zod';

/** The three source panels. All three are mandatory, equal-priority integrations. */
export const PanelCode = z.enum(['t2o', 'mfr', 'mho']);
export type PanelCode = z.infer<typeof PanelCode>;
export const PANEL_CODES: readonly PanelCode[] = PanelCode.options;

export interface PanelDescriptor {
  code: PanelCode;
  name: string;
  shortName: string;
  /** Public site. */
  siteUrl: string;
  /** Source repository that was audited (read-only). */
  sourceRepository: string;
  /**
   * Host values the shared panel backend uses as the tenant key (`req.headers.host` -> `origin`).
   * Verified from the backend CORS allow-list and docs/openapi.yaml in the T2O repo. The production
   * value actually stored in `origin` still has to be confirmed against a live, authorised read.
   */
  knownHosts: string[];
  /** Audience categories this panel is expected to recruit (canonical codes). */
  expectedCategories: AudienceCategory[];
  /** Panel handles health data: enhanced, purpose-limited controls apply. */
  sensitive: boolean;
}

/** Canonical, overlapping audience categories. A person may hold several. */
export const AudienceCategory = z.enum([
  'consumer',
  'business_professional',
  'healthcare_professional',
  'patient',
  'caregiver',
]);
export type AudienceCategory = z.infer<typeof AudienceCategory>;
export const AUDIENCE_CATEGORIES: readonly AudienceCategory[] = AudienceCategory.options;

export const AUDIENCE_CATEGORY_LABELS: Record<AudienceCategory, string> = {
  consumer: 'Consumers',
  business_professional: 'Business Professionals',
  healthcare_professional: 'Healthcare Professionals',
  patient: 'Patients',
  caregiver: 'Caregivers',
};

export const PANELS: Record<PanelCode, PanelDescriptor> = {
  t2o: {
    code: 't2o',
    name: 'Turn2Opinion',
    shortName: 'T2O',
    siteUrl: 'https://www.turn2opinion.com/',
    sourceRepository: 'github.com/kunalsharma-ai/turn2opinion',
    knownHosts: ['www.turn2opinion.com', 'turn2opinion.com', 't2o.sampledge.duckdns.org', 't2o.localhost'],
    expectedCategories: ['consumer', 'business_professional'],
    sensitive: false,
  },
  mfr: {
    code: 'mfr',
    name: 'MyFrequentRewards',
    shortName: 'MFR',
    siteUrl: 'https://www.myfrequentrewards.com/',
    sourceRepository: 'github.com/kunalsharma-ai/MFR',
    knownHosts: ['www.myfrequentrewards.com', 'myfrequentrewards.com', 'mfr.sampledge.duckdns.org', 'mfr.localhost'],
    expectedCategories: ['consumer', 'business_professional'],
    sensitive: false,
  },
  mho: {
    code: 'mho',
    name: 'MyHealthOpinions',
    shortName: 'MHO',
    siteUrl: 'https://www.myhealthopinions.com/',
    sourceRepository: 'github.com/kunalsharma-ai/MHO',
    knownHosts: ['www.myhealthopinions.com', 'mho.sampledge.duckdns.org', 'mho.localhost'],
    expectedCategories: ['healthcare_professional', 'patient', 'caregiver'],
    sensitive: true,
  },
};

/**
 * Source `User.category` values observed in the audited code and data exports, and the canonical
 * category each one *proposes*. These are proposals for the human review queue, never applied blindly:
 * `minor` / `minor patient` describe an age status, not an audience, so they map to the adult
 * category plus a `minor` flag and always require review.
 */
export interface SourceCategoryProposal {
  panel: PanelCode;
  sourceValue: string;
  proposed: AudienceCategory | null;
  minor: boolean;
  evidence: string;
}

export const SOURCE_CATEGORY_PROPOSALS: SourceCategoryProposal[] = [
  { panel: 't2o', sourceValue: 'b2c', proposed: 'consumer', minor: false, evidence: 'User.category default "b2c" (backend/app/model/User.js)' },
  { panel: 't2o', sourceValue: 'b2b', proposed: 'business_professional', minor: false, evidence: 'Category lookup {name: {$in: ["b2c","b2b"]}} in integrationRoutes.js' },
  { panel: 't2o', sourceValue: 'minor', proposed: 'consumer', minor: true, evidence: 'User.registrationStatus virtual treats category "minor" as Teen' },
  { panel: 'mfr', sourceValue: 'b2c', proposed: 'consumer', minor: false, evidence: 'User.category default "b2c" (api/app/model/User.js)' },
  { panel: 'mfr', sourceValue: 'b2b', proposed: 'business_professional', minor: false, evidence: 'frontend-1 WORLD_QUESTIONS comment: "category b2b / b2c"' },
  { panel: 'mfr', sourceValue: 'minor', proposed: 'consumer', minor: true, evidence: 'User.name.last required unless category includes "minor"' },
  { panel: 'mho', sourceValue: 'healthcare professional', proposed: 'healthcare_professional', minor: false, evidence: 'sections/hcp/data-source/*.Question.json category values' },
  { panel: 'mho', sourceValue: 'patient', proposed: 'patient', minor: false, evidence: 'sections/hcp/data-source/*.Question.json category values' },
  { panel: 'mho', sourceValue: 'care giver', proposed: 'caregiver', minor: false, evidence: 'sections/hcp/data-source/*.Question.json category values' },
  { panel: 'mho', sourceValue: 'minor patient', proposed: 'patient', minor: true, evidence: 'sections/hcp/data-source/*.Question.json category values' },
];
