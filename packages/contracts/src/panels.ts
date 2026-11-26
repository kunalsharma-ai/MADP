import { z } from 'zod';

/**
 * A panel's code. Panels are data (the `panel` table): T2O, MFR and MHO are built in, mandatory and equal; a Super
 * Admin adds others on the Panels screen. Code format: a letter, then letters, digits or _, 2 to 16 characters.
 */
export const NewPanelCode = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,15}$/, 'a panel code: a letter, then letters, digits or _ (2 to 16)');

/**
 * Panel codes the running API knows (set by its panel directory). Empty means "not loaded", e.g. in the admin
 * app or a unit test, where only the format is checked.
 */
const knownPanels = new Set<string>();
export function setKnownPanels(codes: Iterable<string>) {
  knownPanels.clear();
  for (const c of codes) knownPanels.add(c);
}

/** An existing panel's code. Inside the API an unknown code is refused (400). */
export const PanelCode = NewPanelCode.refine((c) => knownPanels.size === 0 || knownPanels.has(c), {
  message: 'unknown panel',
});
export type PanelCode = string;

/** The three built-in source panels. All three are mandatory, equal-priority integrations. */
export const BuiltInPanelCode = z.enum(['t2o', 'mfr', 'mho']);
export type BuiltInPanelCode = z.infer<typeof BuiltInPanelCode>;
export const BUILT_IN_PANEL_CODES: readonly BuiltInPanelCode[] = BuiltInPanelCode.options;
export const isBuiltInPanel = (code: string): code is BuiltInPanelCode =>
  (BUILT_IN_PANEL_CODES as readonly string[]).includes(code);

/** A panel as the API returns it (GET /panels). */
export interface PanelInfo {
  code: PanelCode;
  name: string;
  shortName: string;
  siteUrl: string | null;
  description: string;
  sensitive: boolean;
  builtIn: boolean;
  status: 'active' | 'archived';
  sort: number;
}

export interface PanelDescriptor {
  code: BuiltInPanelCode;
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
  expectedCategories: BuiltInSegment[];
  /** Panel handles health data: enhanced, purpose-limited controls apply. */
  sensitive: boolean;
}

/** Format of a segment key: a letter, then lowercase letters, digits or _ (2 to 32). */
export const NewSegmentKey = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z][a-z0-9_]{1,31}$/, 'a segment key: a letter, then letters, digits or _ (2 to 32)');

/** The segments MADP shipped with. Teens was added on 26 Nov 2026 at Kunal's request. */
export const BuiltInSegment = z.enum([
  'consumer',
  'business_professional',
  'healthcare_professional',
  'patient',
  'caregiver',
  'teen',
]);
export type BuiltInSegment = z.infer<typeof BuiltInSegment>;
export const BUILT_IN_SEGMENTS: readonly BuiltInSegment[] = BuiltInSegment.options;

const knownSegments = new Set<string>();
/** Segment keys the running API knows (set by its segment directory). Empty means only the format is checked. */
export function setKnownSegments(keys: Iterable<string>) {
  knownSegments.clear();
  for (const k of keys) knownSegments.add(k);
}

/**
 * Canonical, overlapping audience segments ("categories" in the data). A person may hold several. They are data:
 * a Super Admin adds, edits, archives and restores them on the Audience segments screen.
 */
export const AudienceCategory = NewSegmentKey.refine((k) => knownSegments.size === 0 || knownSegments.has(k), {
  message: 'unknown segment',
});
export type AudienceCategory = string;
/** The built-in segments, for code that runs before the segment list is read (seeding, fixtures). */
export const AUDIENCE_CATEGORIES: readonly string[] = BUILT_IN_SEGMENTS;

export const AUDIENCE_CATEGORY_LABELS: Record<string, string> = {
  consumer: 'Consumers',
  business_professional: 'Business Professionals',
  healthcare_professional: 'Healthcare Professionals',
  patient: 'Patients',
  caregiver: 'Caregivers',
  teen: 'Teens',
};

export const BUILT_IN_SEGMENT_INFO: Record<BuiltInSegment, { description: string; minors: boolean }> = {
  consumer: { description: 'Adults answering consumer surveys (source category b2c).', minors: false },
  business_professional: { description: 'Working professionals (source category b2b).', minors: false },
  healthcare_professional: { description: 'Doctors, nurses and other healthcare workers on MHO.', minors: false },
  patient: { description: 'People answering about their own health on MHO.', minors: false },
  caregiver: { description: 'People caring for a patient, on MHO.', minors: false },
  teen: {
    description: 'Members under 18 (source categories minor and minor patient). Minor rules always apply.',
    minors: true,
  },
};

export interface AudienceSegmentInfo {
  key: string;
  label: string;
  description: string;
  /** Every member of this segment is a minor: minor protections always apply. */
  minors: boolean;
  builtIn: boolean;
  status: 'active' | 'archived';
  sort: number;
}

/** How a panel's own category value becomes a MADP segment. */
export interface SegmentRuleInfo {
  id: string;
  panel: PanelCode;
  sourceValue: string;
  segment: string;
  minor: boolean;
  evidence: string;
  status: 'active' | 'archived';
}

const SegmentLabel = z.string().trim().min(2).max(60);
const Reason = z.string().trim().min(5).max(500);

export const AudienceSegmentCreate = z
  .object({
    key: NewSegmentKey,
    label: SegmentLabel,
    description: z.string().trim().max(1000).optional(),
    minors: z.boolean().default(false),
    reason: Reason,
  })
  .strict();
export type AudienceSegmentCreate = z.infer<typeof AudienceSegmentCreate>;

export const AudienceSegmentUpdate = z
  .object({
    label: SegmentLabel.optional(),
    description: z.string().trim().max(1000).optional(),
    minors: z.boolean().optional(),
    sort: z.number().int().min(1).max(999).optional(),
    reason: Reason,
  })
  .strict();
export type AudienceSegmentUpdate = z.infer<typeof AudienceSegmentUpdate>;

export const SegmentRuleCreate = z
  .object({
    panel: PanelCode,
    sourceValue: z.string().trim().toLowerCase().min(1).max(80),
    segment: AudienceCategory,
    minor: z.boolean().default(false),
    evidence: z.string().trim().max(500).optional(),
    reason: Reason,
  })
  .strict();
export type SegmentRuleCreate = z.infer<typeof SegmentRuleCreate>;

/** Audited facts about the built-in panels. Panels added in the console are described by their `panel` row. */
export const PANELS: Record<BuiltInPanelCode, PanelDescriptor> = {
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
    knownHosts: [
      'www.myfrequentrewards.com',
      'myfrequentrewards.com',
      'mfr.sampledge.duckdns.org',
      'mfr.localhost',
    ],
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
  proposed: string | null;
  minor: boolean;
  evidence: string;
}

export const SOURCE_CATEGORY_PROPOSALS: SourceCategoryProposal[] = [
  {
    panel: 't2o',
    sourceValue: 'b2c',
    proposed: 'consumer',
    minor: false,
    evidence: 'User.category default "b2c" (backend/app/model/User.js)',
  },
  {
    panel: 't2o',
    sourceValue: 'b2b',
    proposed: 'business_professional',
    minor: false,
    evidence: 'Category lookup {name: {$in: ["b2c","b2b"]}} in integrationRoutes.js',
  },
  {
    panel: 't2o',
    sourceValue: 'minor',
    proposed: 'consumer',
    minor: true,
    evidence: 'User.registrationStatus virtual treats category "minor" as Teen',
  },
  {
    panel: 'mfr',
    sourceValue: 'b2c',
    proposed: 'consumer',
    minor: false,
    evidence: 'User.category default "b2c" (api/app/model/User.js)',
  },
  {
    panel: 'mfr',
    sourceValue: 'b2b',
    proposed: 'business_professional',
    minor: false,
    evidence: 'frontend-1 WORLD_QUESTIONS comment: "category b2b / b2c"',
  },
  {
    panel: 'mfr',
    sourceValue: 'minor',
    proposed: 'consumer',
    minor: true,
    evidence: 'User.name.last required unless category includes "minor"',
  },
  {
    panel: 'mho',
    sourceValue: 'healthcare professional',
    proposed: 'healthcare_professional',
    minor: false,
    evidence: 'sections/hcp/data-source/*.Question.json category values',
  },
  {
    panel: 'mho',
    sourceValue: 'patient',
    proposed: 'patient',
    minor: false,
    evidence: 'sections/hcp/data-source/*.Question.json category values',
  },
  {
    panel: 'mho',
    sourceValue: 'care giver',
    proposed: 'caregiver',
    minor: false,
    evidence: 'sections/hcp/data-source/*.Question.json category values',
  },
  {
    panel: 'mho',
    sourceValue: 'minor patient',
    proposed: 'patient',
    minor: true,
    evidence: 'sections/hcp/data-source/*.Question.json category values',
  },
  // Teens (added 26 Nov 2026): a minor also joins the Teens segment, next to the adult segment above.
  { panel: 't2o', sourceValue: 'minor', proposed: 'teen', minor: true, evidence: 'Teens segment (Kunal, 26 Nov 2026)' },
  { panel: 'mfr', sourceValue: 'minor', proposed: 'teen', minor: true, evidence: 'Teens segment (Kunal, 26 Nov 2026)' },
  {
    panel: 'mho',
    sourceValue: 'minor patient',
    proposed: 'teen',
    minor: true,
    evidence: 'Teens segment (Kunal, 26 Nov 2026)',
  },
];

const PanelHost = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^(?=.{1,253}$)([a-z0-9-]{1,63}\.)+[a-z]{2,63}$/, 'a hostname such as www.example.com');

/** Add a panel (Super Admin on every brand). Its hostnames are the brand key on the shared panel backend. */
export const PanelCreate = z
  .object({
    code: NewPanelCode,
    name: z.string().trim().min(2).max(80),
    shortName: z.string().trim().min(2).max(12),
    siteUrl: z.string().trim().url().startsWith('https://').max(400).optional(),
    description: z.string().trim().max(1000).optional(),
    /** Holds special-category (health) data: enhanced controls apply. */
    sensitive: z.boolean().default(false),
    origins: z.array(PanelHost).min(1).max(10),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type PanelCreate = z.infer<typeof PanelCreate>;

export const PanelUpdate = z
  .object({
    name: z.string().trim().min(2).max(80).optional(),
    shortName: z.string().trim().min(2).max(12).optional(),
    siteUrl: z.string().trim().url().startsWith('https://').max(400).nullable().optional(),
    description: z.string().trim().max(1000).optional(),
    sensitive: z.boolean().optional(),
    sort: z.number().int().min(1).max(999).optional(),
    reason: z.string().trim().min(5).max(500),
  })
  .strict();
export type PanelUpdate = z.infer<typeof PanelUpdate>;

export const PanelReason = z.object({ reason: z.string().trim().min(5).max(500) }).strict();
export type PanelReason = z.infer<typeof PanelReason>;
