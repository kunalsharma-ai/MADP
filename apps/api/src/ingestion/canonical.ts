import type { AudienceCategory, PanelCode } from '@madp/contracts';
import { SOURCE_CATEGORY_PROPOSALS } from '@madp/contracts';

/**
 * Source category -> canonical category. Only the reviewed proposals in @madp/contracts are applied;
 * an unknown source category produces no category membership and is reported in the import counts.
 */
export function categoryFor(
  panel: PanelCode,
  sourceCategory: string,
): { category: AudienceCategory; minor: boolean } | null {
  const p = SOURCE_CATEGORY_PROPOSALS.find(
    (x) => x.panel === panel && x.sourceValue === sourceCategory.trim().toLowerCase(),
  );
  return p?.proposed ? { category: p.proposed, minor: p.minor } : null;
}

/** Canonical attributes seeded in M1. Mapping source questions to them always goes through review. */
export const SEED_ATTRIBUTES: {
  key: string;
  label: string;
  category: AudienceCategory | null;
  valueType: string;
  sensitivity: 'standard' | 'personal' | 'special_category';
  description: string;
}[] = [
  {
    key: 'demographics.gender',
    label: 'Gender (self-reported)',
    category: null,
    valueType: 'enum',
    sensitivity: 'personal',
    description: 'Voluntarily provided gender.',
  },
  {
    key: 'demographics.date_of_birth',
    label: 'Date of birth',
    category: null,
    valueType: 'date',
    sensitivity: 'personal',
    description: 'Stored encrypted; counts use birth year only.',
  },
  {
    key: 'demographics.ethnicity',
    label: 'Ethnicity (self-reported)',
    category: null,
    valueType: 'enum',
    sensitivity: 'special_category',
    description: 'Country-specific lists; purpose-limited.',
  },
  {
    key: 'demographics.religion',
    label: 'Religion (self-reported)',
    category: null,
    valueType: 'enum',
    sensitivity: 'special_category',
    description: 'Never inferred; never used to target festival messages without consent.',
  },
  {
    key: 'demographics.relationship_status',
    label: 'Relationship status',
    category: null,
    valueType: 'enum',
    sensitivity: 'personal',
    description: '',
  },
  {
    key: 'household.income_band',
    label: 'Household income band',
    category: null,
    valueType: 'enum',
    sensitivity: 'personal',
    description: 'Country-specific bands; keep source currency.',
  },
  {
    key: 'household.personal_income_band',
    label: 'Personal income band',
    category: null,
    valueType: 'enum',
    sensitivity: 'personal',
    description: '',
  },
  {
    key: 'household.children_count',
    label: 'Number of children',
    category: null,
    valueType: 'enum',
    sensitivity: 'personal',
    description: '',
  },
  {
    key: 'location.country',
    label: 'Country',
    category: null,
    valueType: 'iso3166',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'location.state',
    label: 'State / province',
    category: null,
    valueType: 'text',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'location.city',
    label: 'City',
    category: null,
    valueType: 'text',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'location.urbanicity',
    label: 'Urban / rural',
    category: null,
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'b2b.employment_status',
    label: 'Employment status',
    category: 'business_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'b2b.industry',
    label: 'Industry',
    category: 'business_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'b2b.sector',
    label: 'Sector / specialisation',
    category: 'business_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'b2b.department',
    label: 'Department / function',
    category: 'business_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'b2b.job_role',
    label: 'Job title / role',
    category: 'business_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'b2b.org_size',
    label: 'Organisation size',
    category: 'business_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'b2b.decision_authority',
    label: 'Purchase decision authority',
    category: 'business_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'b2b.experience_years',
    label: 'Professional experience',
    category: 'business_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'hcp.education',
    label: 'Medical education',
    category: 'healthcare_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'hcp.expertise',
    label: 'Area of expertise',
    category: 'healthcare_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'hcp.specialty',
    label: 'Medical specialty',
    category: 'healthcare_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'hcp.job_level',
    label: 'Job level',
    category: 'healthcare_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'hcp.license_registration',
    label: 'Registration / licence held',
    category: 'healthcare_professional',
    valueType: 'enum',
    sensitivity: 'standard',
    description: 'Self-reported unless verification evidence exists.',
  },
  {
    key: 'patient.diet',
    label: 'Diet plan',
    category: 'patient',
    valueType: 'enum',
    sensitivity: 'special_category',
    description: 'Health-related; restricted.',
  },
  {
    key: 'patient.food_allergy',
    label: 'Food allergy',
    category: 'patient',
    valueType: 'enum',
    sensitivity: 'special_category',
    description: 'Health data; restricted.',
  },
  {
    key: 'patient.smoking',
    label: 'Smoking',
    category: 'patient',
    valueType: 'enum',
    sensitivity: 'special_category',
    description: 'Health data; restricted.',
  },
  {
    key: 'patient.alcohol',
    label: 'Alcohol consumption',
    category: 'patient',
    valueType: 'enum',
    sensitivity: 'special_category',
    description: 'Health data; restricted.',
  },
  {
    key: 'patient.exercise',
    label: 'Exercise',
    category: 'patient',
    valueType: 'enum',
    sensitivity: 'special_category',
    description: 'Health data; restricted.',
  },
  {
    key: 'patient.sleep_duration',
    label: 'Sleep duration',
    category: 'patient',
    valueType: 'enum',
    sensitivity: 'special_category',
    description: 'Health data; restricted.',
  },
  {
    key: 'consumer.hobbies',
    label: 'Hobbies & interests',
    category: 'consumer',
    valueType: 'multi_enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'consumer.education_level',
    label: 'Education level',
    category: null,
    valueType: 'enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'contact.preferred_channels',
    label: 'Preferred communication channels',
    category: null,
    valueType: 'multi_enum',
    sensitivity: 'standard',
    description: '',
  },
  {
    key: 'consent.marketing_newsletter',
    label: 'Marketing newsletter consent',
    category: null,
    valueType: 'boolean',
    sensitivity: 'standard',
    description: 'Consent evidence, not a profile attribute.',
  },
  {
    key: 'consent.terms',
    label: 'Terms accepted',
    category: null,
    valueType: 'boolean',
    sensitivity: 'standard',
    description: 'Consent evidence.',
  },
];

/**
 * Suggestions shown in the mapping workbench. Based on the source question *name* only, so they are
 * suggestions: a data steward must approve each one (status stays 'pending' until then).
 */
export const NAME_SUGGESTIONS: Record<string, string> = {
  gender: 'demographics.gender',
  dob: 'demographics.date_of_birth',
  ethnicity: 'demographics.ethnicity',
  religion: 'demographics.religion',
  relationship: 'demographics.relationship_status',
  'relationship-status': 'demographics.relationship_status',
  'household-income': 'household.income_band',
  'personal-income': 'household.personal_income_band',
  'children-num': 'household.children_count',
  children: 'household.children_count',
  country: 'location.country',
  state: 'location.state',
  city: 'location.city',
  rural: 'location.urbanicity',
  empstat: 'b2b.employment_status',
  industry: 'b2b.industry',
  sector: 'b2b.sector',
  department: 'b2b.department',
  jobrole: 'b2b.job_role',
  orgsize: 'b2b.org_size',
  orgdecision: 'b2b.decision_authority',
  experience: 'b2b.experience_years',
  'doc-education': 'hcp.education',
  'doc-expertise': 'hcp.expertise',
  'doc-specialization': 'hcp.specialty',
  'doc-joblevel': 'hcp.job_level',
  'diet-plan': 'patient.diet',
  'have-food-allergy': 'patient.food_allergy',
  smoke: 'patient.smoking',
  alcohol: 'patient.alcohol',
  'do-exercise': 'patient.exercise',
  'sleep-duration': 'patient.sleep_duration',
  hobbies: 'consumer.hobbies',
  education: 'consumer.education_level',
  'communication-methods': 'contact.preferred_channels',
  'news-letter': 'consent.marketing_newsletter',
  'terms-consent': 'consent.terms',
};

/**
 * Questions whose answers are direct identifiers. The panels store contact details as profile questions too,
 * so their answers would otherwise land unencrypted in MongoDB. MADP never requests or stores them as answers;
 * the encrypted copies on source_identity (from the member record) are the only ones kept.
 */
export const DIRECT_IDENTIFIER_QUESTIONS = new Set([
  'firstname',
  'lastname',
  'fullname',
  'mail',
  'alternate-email',
  'workemail',
  'phone',
  'alternate-phone',
  'dob',
  'zipcode',
]);

/** MHO answers default to special-category (health) unless the question is in this demographic allow-list. */
const MHO_STANDARD = new Set([
  'fullname',
  'mail',
  'gender',
  'dob',
  'country',
  'state',
  'city',
  'zipcode',
  'website',
  'education',
  'education-diploma',
  'education-associate-degree',
  'education-ug',
  'education-pg',
  'education-doctorate',
]);
export function sensitivityFor(
  panel: PanelCode,
  sourceQuestionId: string,
  categories: string[],
): 'standard' | 'special_category' {
  if (panel !== 'mho')
    return ['ethnicity', 'religion'].includes(sourceQuestionId) ? 'special_category' : 'standard';
  if (MHO_STANDARD.has(sourceQuestionId)) return 'standard';
  // HCP-only professional questions are not health data about the respondent.
  if (categories.length > 0 && categories.every((c) => c === 'healthcare professional')) return 'standard';
  return 'special_category';
}
