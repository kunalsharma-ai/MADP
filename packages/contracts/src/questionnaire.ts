import { z } from 'zod';

/**
 * Questionnaire builder (spec screens 11 and 12). MADP edits a panel profile (its pages of questions) and the show
 * logic of those questions as a draft, a second admin approves it, and only then MADP writes it to the panel through
 * the existing signed /api/v1/admin routes (profile pages, question, question options).
 *
 * The logic is the panel's own rule, not a new one. A question with a `parent` is hidden until the parent is answered.
 * For a choice question the panel then shows only the options whose `parentValue` holds the parent's answer, and hides
 * the question when none match. So "show X when P is one of V" is X.parent = P with every option of X carrying
 * parentValue = V. A typed question (text, number, date) with a parent shows once the parent has any answer: the panel
 * cannot limit it to some values, and the builder says so instead of pretending.
 */

/** Question types whose answers are picked from options (the panel's OPTION_TYPES). */
// Exactly the member profile flow's OPTION_TYPES (MFR web PsFlow.jsx): other types are not asked from options.
export const CHOICE_TYPES = ['select', 'multiselect', 'checkbox', 'radio'] as const;
export const isChoiceType = (type: string | null | undefined) =>
  !!type && (CHOICE_TYPES as readonly string[]).includes(type.toLowerCase());

const Key = z
  .string()
  .trim()
  .toLowerCase()
  .regex(/^[a-z0-9][a-z0-9_.-]{0,79}$/, 'a question key');

export const BuilderOption = z.object({
  value: z.string(),
  label: z.string(),
  parentValue: z.array(z.string()).default([]),
  isExclusive: z.boolean().optional(),
  describeLabel: z.string().optional(),
  countries: z.array(z.string()).optional(),
});
export type BuilderOption = z.infer<typeof BuilderOption>;

export const BuilderQuestion = z.object({
  name: z.string(),
  label: z.string(),
  type: z.string(),
  parent: z.string().nullable(),
  isRequired: z.boolean(),
  category: z.array(z.string()),
  topic: z.string().nullable(),
  options: z.array(BuilderOption),
});
export type BuilderQuestion = z.infer<typeof BuilderQuestion>;

/** A panel profile as the builder sees it: its pages, and every question it asks or depends on. */
export const BuilderSource = z.object({
  panel: z.enum(['t2o', 'mfr', 'mho']),
  profileId: z.string(),
  slug: z.string(),
  category: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  pages: z.array(z.object({ title: z.string(), questions: z.array(z.string()) })),
  questions: z.record(z.string(), BuilderQuestion),
  /** Questions not on any page of this profile, offered in "Add a question". */
  bank: z.array(z.object({ name: z.string(), label: z.string(), type: z.string() })),
  exportedAt: z.string().nullable(),
});
export type BuilderSource = z.infer<typeof BuilderSource>;

/** Show logic for one question. `values` empty means "once the parent has any answer". */
export const ShowRule = z.object({
  parent: Key.nullable(),
  values: z.array(z.string().trim().min(1).max(200)).max(200).default([]),
});
export type ShowRule = z.infer<typeof ShowRule>;

export const DraftSpec = z
  .object({
    pages: z
      .array(
        z.object({
          title: z.string().trim().min(1).max(120),
          questions: z.array(Key).max(500),
        }),
      )
      .min(1)
      .max(50),
    /** Only the questions whose logic or required flag the draft changes. */
    rules: z.record(Key, ShowRule).default({}),
    required: z.record(Key, z.boolean()).default({}),
  })
  .strict();
export type DraftSpec = z.infer<typeof DraftSpec>;

export const DraftCreate = z
  .object({
    category: z.string().trim().toLowerCase().min(1).max(40),
    slug: z.string().trim().toLowerCase().min(1).max(120),
    note: z.string().trim().max(500).optional(),
    spec: DraftSpec.optional(),
  })
  .strict();
export type DraftCreate = z.infer<typeof DraftCreate>;
export const DraftUpdate = z.object({ spec: DraftSpec, note: z.string().trim().max(500).optional() }).strict();
export type DraftUpdate = z.infer<typeof DraftUpdate>;
export const DraftReview = z
  .object({ decision: z.enum(['approve', 'reject']), note: z.string().trim().max(500).optional() })
  .strict();
export type DraftReview = z.infer<typeof DraftReview>;
export const DraftStatus = z.enum(['draft', 'review', 'approved', 'rejected', 'applied', 'discarded']);
export type DraftStatus = z.infer<typeof DraftStatus>;
export const BuilderQuery = z.object({
  category: z.string().trim().toLowerCase().min(1).max(40),
  slug: z.string().trim().toLowerCase().min(1).max(120),
});

/** The draft as it would look on the panel: the live profile with the draft's pages, rules and required flags. */
export function specFromSource(src: BuilderSource): DraftSpec {
  return { pages: src.pages.map((p) => ({ title: p.title, questions: [...p.questions] })), rules: {}, required: {} };
}

/** The show rule a question has on the panel today, or `dependent` when its options follow the parent value by value. */
export function liveRule(q: BuilderQuestion): ShowRule | 'dependent' {
  if (!q.parent) return { parent: null, values: [] };
  if (!isChoiceType(q.type)) return { parent: q.parent, values: [] };
  const sets = new Set(q.options.map((o) => JSON.stringify([...o.parentValue].sort())));
  if (sets.size > 1) return 'dependent';
  return { parent: q.parent, values: q.options[0] ? [...q.options[0].parentValue].sort() : [] };
}

export const ruleOf = (src: BuilderSource, spec: DraftSpec, name: string): ShowRule | 'dependent' | null => {
  if (spec.rules[name]) return spec.rules[name]!;
  const q = src.questions[name];
  return q ? liveRule(q) : null;
};

export interface DraftProblem {
  level: 'error' | 'warning';
  question: string | null;
  code:
    | 'unknown_question'
    | 'duplicate'
    | 'empty_page'
    | 'parent_missing'
    | 'parent_later'
    | 'cycle'
    | 'value_not_an_option'
    | 'typed_values'
    | 'dependent_list'
    | 'parent_not_choice'
    | 'teen_topic'
    | 'unreachable';
  message: string;
}

const TEEN_TOPICS = ['tobacco', 'nicotine', 'alcohol', 'health', 'cosmetic', 'vehicle'];

/** Everything that would stop the draft from applying, or that an approver should see first. */
export function checkDraft(src: BuilderSource, spec: DraftSpec): DraftProblem[] {
  const out: DraftProblem[] = [];
  const order = spec.pages.flatMap((p) => p.questions);
  const pos = new Map(order.map((n, i) => [n, i]));
  const seen = new Set<string>();
  for (const p of spec.pages)
    if (!p.questions.length)
      out.push({ level: 'warning', question: null, code: 'empty_page', message: `Page "${p.title}" has no questions.` });
  for (const n of order) {
    if (seen.has(n)) out.push({ level: 'error', question: n, code: 'duplicate', message: `${n} is listed twice.` });
    seen.add(n);
    const q = src.questions[n];
    if (!q) {
      out.push({ level: 'error', question: n, code: 'unknown_question', message: `${n} is not in the panel's question bank.` });
      continue;
    }
    if (src.category.includes('minor') && q.topic && TEEN_TOPICS.includes(q.topic))
      out.push({
        level: 'error',
        question: n,
        code: 'teen_topic',
        message: `${n} is about ${q.topic}: the teen guardrails keep it off Teen Panel profiles.`,
      });
    const rule = ruleOf(src, spec, n);
    if (rule === 'dependent') {
      if (spec.rules[n] === undefined)
        out.push({
          level: 'warning',
          question: n,
          code: 'dependent_list',
          message: `${n} shows different options for each answer to ${q.parent}. The builder keeps that list as it is.`,
        });
      continue;
    }
    if (!rule?.parent) continue;
    const parent = src.questions[rule.parent];
    if (!parent) {
      out.push({ level: 'error', question: n, code: 'parent_missing', message: `${n} depends on ${rule.parent}, which is not a question.` });
      continue;
    }
    const pp = pos.get(rule.parent);
    if (pp !== undefined && pp > pos.get(n)!)
      out.push({ level: 'error', question: n, code: 'parent_later', message: `${n} depends on ${rule.parent}, which comes after it.` });
    if (pp === undefined)
      out.push({
        level: 'warning',
        question: n,
        code: 'unreachable',
        message: `${n} depends on ${rule.parent}, which is not in this profile: members who never answered it elsewhere never see ${n}.`,
      });
    if (rule.values.length) {
      if (!isChoiceType(q.type))
        out.push({
          level: 'error',
          question: n,
          code: 'typed_values',
          message: `${n} is a ${q.type} question: the panel shows it once ${rule.parent} has any answer and cannot limit it to some answers.`,
        });
      if (!isChoiceType(parent.type))
        out.push({
          level: 'error',
          question: n,
          code: 'parent_not_choice',
          message: `${rule.parent} is a ${parent.type} question, so there are no answers to pick from.`,
        });
      else {
        const vals = new Set(parent.options.map((o) => o.value));
        for (const v of rule.values)
          if (!vals.has(v))
            out.push({ level: 'error', question: n, code: 'value_not_an_option', message: `"${v}" is not an answer of ${rule.parent}.` });
      }
    } else if (isChoiceType(q.type) && spec.rules[n])
      out.push({
        level: 'error',
        question: n,
        code: 'typed_values',
        message: `${n} is a choice question: pick the answers of ${rule.parent} that show it.`,
      });
  }
  // A cycle through parents (A needs B, B needs A) means neither is ever shown.
  for (const n of order) {
    const path = new Set<string>([n]);
    let cur: string | null = n;
    while (cur) {
      const r = ruleOf(src, spec, cur);
      const next: string | null = r && r !== 'dependent' ? r.parent : (src.questions[cur]?.parent ?? null);
      if (!next) break;
      if (path.has(next)) {
        out.push({ level: 'error', question: n, code: 'cycle', message: `${n} is in a loop of questions that depend on each other.` });
        break;
      }
      path.add(next);
      cur = next;
    }
  }
  return out;
}

export interface SimStep {
  question: string;
  page: string;
  shown: boolean;
  reason: 'always' | 'parent_answered' | 'parent_unanswered' | 'value_not_matched' | 'no_options' | 'unknown';
  options: string[];
}

/**
 * What a member sees for a set of answers, by the panel's rule. `answers` holds option values (several for a
 * multiple-choice parent). Used by the preview and by tests, so the preview and the apply step agree.
 */
export function simulate(src: BuilderSource, spec: DraftSpec, answers: Record<string, string | string[]>): SimStep[] {
  const out: SimStep[] = [];
  const has = (name: string) => {
    const v = answers[name];
    return Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '';
  };
  const values = (name: string) => {
    const v = answers[name];
    return Array.isArray(v) ? v : v === undefined ? [] : [v];
  };
  for (const page of spec.pages)
    for (const name of page.questions) {
      const q = src.questions[name];
      if (!q) {
        out.push({ question: name, page: page.title, shown: false, reason: 'unknown', options: [] });
        continue;
      }
      const rule = ruleOf(src, spec, name);
      const parent = rule === 'dependent' ? q.parent : (rule?.parent ?? null);
      const opts = optionsAfter(q, spec.rules[name]);
      if (!parent) {
        const list = opts.map((o) => o.value);
        const shown = !isChoiceType(q.type) || list.length > 0;
        out.push({ question: name, page: page.title, shown, reason: shown ? 'always' : 'no_options', options: list });
        continue;
      }
      if (!has(parent)) {
        out.push({ question: name, page: page.title, shown: false, reason: 'parent_unanswered', options: [] });
        continue;
      }
      if (!isChoiceType(q.type)) {
        out.push({ question: name, page: page.title, shown: true, reason: 'parent_answered', options: [] });
        continue;
      }
      // The panel asks for the options of one parent answer; a multiple-choice parent sends each of them.
      const pv = values(parent);
      const list = [...new Set(opts.filter((o) => o.parentValue.some((x) => pv.includes(x))).map((o) => o.value))];
      out.push({
        question: name,
        page: page.title,
        shown: list.length > 0,
        reason: list.length ? 'parent_answered' : 'value_not_matched',
        options: list,
      });
    }
  return out;
}

/** The options of a question once a draft rule is applied: every option gets parentValue = the rule's values. */
export function optionsAfter(q: BuilderQuestion, rule: ShowRule | undefined): BuilderOption[] {
  if (!rule) return q.options;
  if (!rule.parent) return q.options.map((o) => ({ ...o, parentValue: [] }));
  if (!isChoiceType(q.type)) return q.options;
  return q.options.map((o) => ({ ...o, parentValue: [...rule.values] }));
}

export interface PlannedWrite {
  kind: 'profile_pages' | 'question' | 'options';
  target: string;
  summary: string;
  body: Record<string, unknown>;
}

/** The panel writes the draft needs, in order, and nothing for what is unchanged. */
export function planWrites(src: BuilderSource, spec: DraftSpec): PlannedWrite[] {
  const out: PlannedWrite[] = [];
  const live = JSON.stringify(src.pages.map((p) => [p.title, ...p.questions]));
  const next = spec.pages.map((p) => [p.title, ...p.questions]);
  // In page order, so the writes (and the reviewer's list) don't depend on how the draft was stored.
  const order = spec.pages.flatMap((p) => p.questions);
  const rank = (n: string) => (order.includes(n) ? order.indexOf(n) : order.length);
  const byPage = (a: string, b: string) => rank(a) - rank(b) || a.localeCompare(b);
  for (const name of Object.keys(spec.rules).sort(byPage)) {
    const rule = spec.rules[name]!;
    const q = src.questions[name];
    if (!q) continue;
    const body: Record<string, unknown> = {};
    if ((q.parent ?? null) !== rule.parent) body.parent = rule.parent ?? '';
    if (Object.keys(body).length)
      out.push({
        kind: 'question',
        target: name,
        summary: rule.parent ? `${name}: depends on ${rule.parent}` : `${name}: always shown`,
        body,
      });
    const opts = optionsAfter(q, rule);
    const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((x, i) => x === b[i]);
    if (isChoiceType(q.type) && opts.some((o, i) => !sameList(o.parentValue, q.options[i]!.parentValue)))
      out.push({
        kind: 'options',
        target: name,
        summary:
          rule.parent && rule.values.length
            ? `${name}: shown when ${rule.parent} is ${rule.values.join(' or ')}`
            : `${name}: options no longer depend on another answer`,
        body: {
          options: opts.map((o) => ({
            value: o.value,
            label: o.label,
            parentValue: o.parentValue,
            ...(o.isExclusive !== undefined ? { isExclusive: o.isExclusive } : {}),
            ...(o.describeLabel ? { describeLabel: o.describeLabel } : {}),
            ...(o.countries?.length ? { countries: o.countries } : {}),
          })),
        },
      });
  }
  for (const name of Object.keys(spec.required).sort(byPage)) {
    const req = spec.required[name]!;
    const q = src.questions[name];
    if (!q || q.isRequired === req) continue;
    const existing = out.find((w) => w.kind === 'question' && w.target === name);
    if (existing) {
      existing.body.isRequired = req;
      existing.summary += req ? ', required' : ', optional';
    } else
      out.push({ kind: 'question', target: name, summary: `${name}: ${req ? 'required' : 'optional'}`, body: { isRequired: req } });
  }
  // The pages go last, so every question they ask already has its logic.
  if (JSON.stringify(next) !== live)
    out.push({
      kind: 'profile_pages',
      target: src.slug,
      summary: `${src.slug}: ${spec.pages.length} pages, ${spec.pages.reduce((n, p) => n + p.questions.length, 0)} questions`,
      body: { pages: next },
    });
  return out;
}
