'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { toast } from 'sonner';
import { optionsSaveAction, questionSaveAction } from '@/app/panel-actions';
import { Card, CardHeader, btn, input } from '@/components/ui';

export interface QuestionData {
  name: string;
  label: string;
  type: string;
  category: string[];
  parent?: string;
  description?: string;
  adminLabel?: string;
  topic?: string;
  answeredBy?: 'teen' | 'parent' | 'both';
  isRequired?: boolean;
  isEditable?: boolean;
  hasOthers?: boolean;
  hasNone?: boolean;
  hasSkip?: boolean;
  isMoney?: boolean;
  translations?: Record<string, { label?: string; description?: string }>;
  options: {
    value: string;
    label: string;
    translations?: Record<string, string>;
    isExclusive?: boolean;
    parentValue?: string[];
    countries?: string[];
  }[];
  profiles: { slug: string; category: string }[];
}

const FLAGS = [
  ['isRequired', 'Required'],
  ['isEditable', 'Member can edit'],
  ['hasOthers', 'Has "Other"'],
  ['hasNone', 'Has "None"'],
  ['hasSkip', 'Has "Skip"'],
  ['isMoney', 'Money question'],
] as const;
const TYPES = [
  'radio',
  'checkbox',
  'select',
  'multiselect',
  'text',
  'textarea',
  'number',
  'date',
  'grid',
  'slider',
];

/** One option per line: value | label | exclusive | shown for (parent answers, comma-separated) | countries */
const toLines = (o: QuestionData['options']) =>
  o
    .map((x) =>
      [
        x.value,
        x.label,
        x.isExclusive ? 'exclusive' : '',
        (x.parentValue ?? []).join(','),
        (x.countries ?? []).join(','),
      ]
        .join(' | ')
        .replace(/( \| )+$/, ''),
    )
    .join('\n');
const fromLines = (s: string) =>
  s
    .split('\n')
    .map((l) => l.split('|').map((x) => x.trim()))
    .filter((p) => p[0])
    .map(([value, label, ex, parents, countries]) => ({
      value: value!,
      label: label || value!,
      isExclusive: ex === 'exclusive',
      parentValue: parents
        ? parents
            .split(',')
            .map((x) => x.trim())
            .filter(Boolean)
        : [],
      ...(countries
        ? {
            countries: countries
              .split(',')
              .map((x) => x.trim())
              .filter(Boolean),
          }
        : {}),
    }));

export function QuestionEditor({ question }: { question: QuestionData | null }) {
  const router = useRouter();
  const isNew = !question;
  const [pending, start] = useTransition();
  const [opts, setOpts] = useState(toLines(question?.options ?? []));
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <Card>
        <CardHeader title="Question" />
        <form
          className="grid gap-3 px-5 py-4 text-[13px]"
          action={(f) =>
            start(async () => {
              const patch: Record<string, unknown> = {
                label: String(f.get('label')),
                type: String(f.get('type')),
                category: String(f.get('category'))
                  .split(',')
                  .map((s) => s.trim())
                  .filter(Boolean),
                parent: String(f.get('parent') ?? ''),
                adminLabel: String(f.get('adminLabel') ?? ''),
                description: String(f.get('description') ?? ''),
                ...(f.get('topic') ? { topic: String(f.get('topic')) } : {}),
                ...(f.get('answeredBy') ? { answeredBy: String(f.get('answeredBy')) } : {}),
                ...Object.fromEntries(FLAGS.map(([k]) => [k, f.get(k) === 'on'])),
              };
              const reason = String(f.get('reason') ?? '').trim();
              if (reason) patch.reason = reason;
              const name = isNew ? String(f.get('name')).trim().toLowerCase() : question.name;
              const r = await questionSaveAction(name, patch, isNew);
              if (!r.ok) return void toast.error(r.error);
              toast.success('Saved');
              if (isNew) router.push(`/question-bank/${name}`);
            })
          }
        >
          {isNew ? (
            <label>
              Key (lower case, never changes)
              <input name="name" required pattern="[a-z0-9][a-z0-9_.\-]{0,79}" className={input} />
            </label>
          ) : null}
          <label>
            Wording
            <textarea name="label" required defaultValue={question?.label} className={input} rows={2} />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label>
              Type
              <select name="type" defaultValue={question?.type ?? 'radio'} className={input}>
                {[...new Set([question?.type, ...TYPES].filter(Boolean))].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Segments (comma-separated)
              <input
                name="category"
                required
                defaultValue={question?.category.join(', ') ?? 'b2c'}
                className={input}
              />
            </label>
            <label>
              Shown under (parent key)
              <input name="parent" defaultValue={question?.parent ?? ''} className={input} />
            </label>
            <label>
              Admin label
              <input name="adminLabel" defaultValue={question?.adminLabel ?? ''} className={input} />
            </label>
            <label>
              Subject (for teen guardrails)
              <select name="topic" defaultValue={question?.topic ?? ''} className={input}>
                <option value="">Not set</option>
                {['tobacco', 'nicotine', 'alcohol', 'health', 'cosmetic', 'vehicle'].map((t) => (
                  <option key={t}>{t}</option>
                ))}
              </select>
            </label>
            <label>
              Teen Panel: answered by
              <select name="answeredBy" defaultValue={question?.answeredBy ?? ''} className={input}>
                <option value="">Not set</option>
                <option value="teen">Teen</option>
                <option value="parent">Parent</option>
                <option value="both">Both</option>
              </select>
            </label>
          </div>
          <label>
            Description
            <textarea
              name="description"
              defaultValue={question?.description ?? ''}
              className={input}
              rows={2}
            />
          </label>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {FLAGS.map(([k, label]) => (
              <label key={k} className="inline-flex items-center gap-1.5">
                <input
                  type="checkbox"
                  name={k}
                  defaultChecked={
                    question
                      ? Boolean(question[k] ?? (k === 'isRequired' || k === 'isEditable'))
                      : k === 'isRequired' || k === 'isEditable'
                  }
                />
                {label}
              </label>
            ))}
          </div>
          <label>
            Reason (optional, kept in the audit log)
            <input name="reason" className={input} />
          </label>
          <div>
            <button className={btn.primary} disabled={pending}>
              {isNew ? 'Create question' : 'Save question'}
            </button>
          </div>
        </form>
      </Card>
      {!isNew ? (
        <Card>
          <CardHeader
            title="Options"
            hint="One per line: value | label | exclusive | shown for parent answers | countries. Options you remove are retired, not deleted, so old answers keep their meaning."
          />
          <div className="grid gap-3 px-5 py-4 text-[13px]">
            <textarea
              className={`${input} font-mono text-[12px]`}
              rows={16}
              value={opts}
              onChange={(e) => setOpts(e.target.value)}
            />
            <div>
              <button
                className={btn.primary}
                disabled={pending}
                onClick={() =>
                  start(async () => {
                    const r = await optionsSaveAction(question.name, fromLines(opts));
                    if (!r.ok) return void toast.error(r.error);
                    toast.success(`Options saved: ${r.data.added} added, ${r.data.retired} retired`);
                  })
                }
              >
                Save options
              </button>
            </div>
          </div>
        </Card>
      ) : null}
    </div>
  );
}
