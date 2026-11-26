import type { SegmentRuleInfo, AudienceSegmentInfo } from './panels.js';

/**
 * Every kind of profile question the three panels ask, grouped the way an admin thinks about them. `native` is the
 * type word each panel already stores (from the real Question exports in the project's question-bank folder:
 * T2O 819, MFR 961, MHO 600 questions). A panel that has never stored a type gets the fallback word and the editor
 * warns that its member app may not show it yet. Nothing here is a new panel field: the settings map to the
 * panel's existing Question fields (isRequired, isEditable, hasOthers, hasNone, hasSkip, isMoney, parent).
 * Layout fields (size, icon, sortOrder) are never written here, so a member site's design never changes; and a kind
 * a panel has never stored can't be saved to it (`nativeType(...).known`).
 */
export type QuestionTypeGroup = 'choice' | 'text' | 'contact' | 'number_date' | 'upload';
export type QuestionSetting = 'isRequired' | 'isEditable' | 'hasOthers' | 'hasNone' | 'hasSkip' | 'isMoney';

export interface QuestionTypeInfo {
  key: string;
  label: string;
  group: QuestionTypeGroup;
  /** What the member sees and what kind of answer is expected. */
  hint: string;
  /** The answer it expects, shown as the built-in check. */
  expects: string;
  /** Answers come from an option list. */
  choice: boolean;
  multi: boolean;
  /** The panel's own type word, per panel. Missing = never used on that panel; `fallback` is written. */
  native: Partial<Record<string, string>>;
  fallback: string;
  settings: QuestionSetting[];
}

export const QUESTION_TYPE_GROUPS: { key: QuestionTypeGroup; label: string; hint: string }[] = [
  { key: 'choice', label: 'Pick from answers', hint: 'The member picks one or more answers from your list.' },
  { key: 'text', label: 'Type an answer', hint: 'The member writes the answer in a box.' },
  { key: 'contact', label: 'Contact details', hint: 'E-mail or phone, kept in the panel’s own format.' },
  { key: 'number_date', label: 'Number and date', hint: 'A number or a date.' },
  { key: 'upload', label: 'File upload', hint: 'The member uploads a document.' },
];

const BASE: QuestionSetting[] = ['isRequired', 'isEditable'];
const CHOICE: QuestionSetting[] = [...BASE, 'hasOthers', 'hasNone', 'hasSkip', 'isMoney'];

export const QUESTION_TYPES: QuestionTypeInfo[] = [
  {
    key: 'radio',
    label: 'Single choice (round buttons)',
    group: 'choice',
    hint: 'All answers are shown; the member picks one.',
    expects: 'Exactly one answer from the list',
    choice: true,
    multi: false,
    native: { t2o: 'radio', mfr: 'radio', mho: 'radio' },
    fallback: 'radio',
    settings: CHOICE,
  },
  {
    key: 'checkbox',
    label: 'Multiple choice (tick boxes)',
    group: 'choice',
    hint: 'All answers are shown; the member ticks as many as apply.',
    expects: 'One or more answers from the list. An “exclusive” answer (like “None of these”) clears the others',
    choice: true,
    multi: true,
    native: { t2o: 'checkbox', mfr: 'checkbox', mho: 'checkbox' },
    fallback: 'checkbox',
    settings: CHOICE,
  },
  {
    key: 'select',
    label: 'Dropdown, one answer',
    group: 'choice',
    hint: 'A dropdown list, good for long lists such as countries or cities.',
    expects: 'Exactly one answer from the list',
    choice: true,
    multi: false,
    native: { t2o: 'select', mfr: 'select', mho: 'select' },
    fallback: 'select',
    settings: CHOICE,
  },
  {
    key: 'multiselect',
    label: 'Dropdown, several answers',
    group: 'choice',
    hint: 'A dropdown where the member can pick several answers.',
    expects: 'One or more answers from the list',
    choice: true,
    multi: true,
    native: { mfr: 'multiselect' },
    fallback: 'multiselect',
    settings: CHOICE,
  },
  {
    key: 'text',
    label: 'Short text (one line)',
    group: 'text',
    hint: 'A one-line box, for a name, a job title or a short answer.',
    expects: 'Any short text',
    choice: false,
    multi: false,
    native: { t2o: 'text', mfr: 'open end single line', mho: 'text' },
    fallback: 'text',
    settings: BASE,
  },
  {
    key: 'textarea',
    label: 'Long text (paragraph)',
    group: 'text',
    hint: 'A larger box for a longer answer.',
    expects: 'Any text, several lines allowed',
    choice: false,
    multi: false,
    native: { mfr: 'textarea' },
    fallback: 'textarea',
    settings: BASE,
  },
  {
    key: 'email',
    label: 'E-mail address',
    group: 'contact',
    hint: 'An e-mail box, for example a work e-mail.',
    expects: 'An e-mail address, like name@example.com',
    choice: false,
    multi: false,
    native: { t2o: 'email', mho: 'email' },
    fallback: 'email',
    settings: BASE,
  },
  {
    key: 'phone',
    label: 'Phone number',
    group: 'contact',
    hint: 'A phone number box.',
    expects: 'A phone number',
    choice: false,
    multi: false,
    native: { t2o: 'phone', mho: 'phone' },
    fallback: 'phone',
    settings: BASE,
  },
  {
    key: 'number',
    label: 'Number',
    group: 'number_date',
    hint: 'A number box, for example years of experience or number of children.',
    expects: 'A number',
    choice: false,
    multi: false,
    native: { mho: 'number' },
    fallback: 'number',
    settings: [...BASE, 'isMoney'],
  },
  {
    key: 'date',
    label: 'Date',
    group: 'number_date',
    hint: 'A date picker, for example date of birth.',
    expects: 'A date',
    choice: false,
    multi: false,
    native: { t2o: 'date', mho: 'date' },
    fallback: 'date',
    settings: BASE,
  },
  {
    key: 'document',
    label: 'Document upload',
    group: 'upload',
    hint: 'The member uploads a file, for example a licence for a healthcare professional.',
    expects: 'An uploaded file',
    choice: false,
    multi: false,
    native: { mho: 'document' },
    fallback: 'document',
    settings: BASE,
  },
];

export const QUESTION_SETTINGS: Record<QuestionSetting, { label: string; hint: string }> = {
  isRequired: { label: 'Required', hint: 'The member must answer before going on. Off means the question can be left empty.' },
  isEditable: { label: 'Member can change it later', hint: 'Off locks the answer once given.' },
  hasOthers: { label: 'Add “Other (please specify)”', hint: 'Adds an Other answer with a text box.' },
  hasNone: { label: 'Add “None of these”', hint: 'Adds a None answer.' },
  hasSkip: { label: 'Add “Prefer not to say”', hint: 'Lets the member skip without answering.' },
  isMoney: { label: 'Money question', hint: 'Marks an income or spend question, so amounts show in the member’s currency.' },
};

export const DEFAULT_SETTINGS = { isRequired: true, isEditable: true, hasOthers: false, hasNone: false, hasSkip: false, isMoney: false };

/** The catalogue entry for a stored type word, from any panel (e.g. MFR's "open end single line" is short text). */
export function typeInfo(stored: string | null | undefined): QuestionTypeInfo | undefined {
  const t = (stored ?? '').trim().toLowerCase();
  if (!t) return undefined;
  return (
    QUESTION_TYPES.find((x) => x.key === t) ??
    QUESTION_TYPES.find((x) => Object.values(x.native).includes(t)) ??
    (t === 'open end multiline' ? QUESTION_TYPES.find((x) => x.key === 'textarea') : undefined) ??
    (t === 'select-single' ? QUESTION_TYPES.find((x) => x.key === 'select') : undefined) ??
    (t === 'select-multiple' ? QUESTION_TYPES.find((x) => x.key === 'multiselect') : undefined)
  );
}

/** The type word to write on a panel, and whether that panel has used it before. */
export function nativeType(typeKey: string, panel: string): { type: string; known: boolean } {
  const info = QUESTION_TYPES.find((x) => x.key === typeKey);
  if (!info) return { type: typeKey, known: false };
  const n = info.native[panel];
  return n ? { type: n, known: true } : { type: info.fallback, known: false };
}

/**
 * The panel's own category words for a set of MADP segments, from the segment rules on the Audience segments
 * screen. A minors segment (Teens) takes the minor rules; an adult segment takes the adult rules only, so picking
 * Consumer on T2O writes "b2c", not "minor". Segments without a rule on the panel are listed in `missing`.
 */
export function categoriesFor(
  panel: string,
  segmentKeys: string[],
  segments: Pick<AudienceSegmentInfo, 'key' | 'minors'>[],
  rules: Pick<SegmentRuleInfo, 'panel' | 'sourceValue' | 'segment' | 'minor' | 'status'>[],
): { categories: string[]; missing: string[] } {
  const out = new Set<string>();
  const missing: string[] = [];
  for (const key of segmentKeys) {
    const minors = segments.find((s) => s.key === key)?.minors ?? false;
    const hits = rules.filter((r) => r.status === 'active' && r.panel === panel && r.segment === key && r.minor === minors);
    if (!hits.length) missing.push(key);
    for (const r of hits) out.add(r.sourceValue.toLowerCase());
  }
  return { categories: [...out], missing };
}

/** The MADP segments a panel's category words stand for (the reverse of categoriesFor). */
export function segmentsFor(
  panel: string,
  categories: string[],
  segments: Pick<AudienceSegmentInfo, 'key' | 'minors'>[],
  rules: Pick<SegmentRuleInfo, 'panel' | 'sourceValue' | 'segment' | 'minor' | 'status'>[],
): string[] {
  const cats = new Set(categories.map((c) => c.toLowerCase()));
  const keys = new Set<string>();
  for (const r of rules) {
    if (r.status !== 'active' || r.panel !== panel || !cats.has(r.sourceValue.toLowerCase())) continue;
    const minors = segments.find((s) => s.key === r.segment)?.minors ?? false;
    if (r.minor === minors) keys.add(r.segment);
  }
  return [...keys];
}
