'use client';

import { useMemo, useState, useTransition } from 'react';
import { toast } from 'sonner';
import { TEEN_BLOCKED_WORDS } from '@madp/contracts';
import { translationSaveAction } from '@/app/panel-actions';
import { Badge, Card, CardHeader, btn, input } from '@/components/ui';
import type { QuestionData } from './question-editor';

const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;

/**
 * One language's wording for a question and its option labels. English is the question itself. On a question teens
 * can see, the panel refuses the teen guardrail words in any of these texts; the same check runs here first as a
 * warning, and the panel's own message is shown if it refuses.
 */
export function TranslationEditor({ question }: { question: QuestionData }) {
  const known = useMemo(() => {
    const set = new Set(Object.keys(question.translations ?? {}));
    for (const o of question.options) for (const l of Object.keys(o.translations ?? {})) set.add(l);
    return [...set].filter((l) => l !== 'en').sort();
  }, [question]);
  const [lang, setLang] = useState(known[0] ?? 'hi');
  const [pending, start] = useTransition();
  const teen =
    question.category.some((c) => c.includes('minor')) || question.profiles.some((p) => p.category.includes('minor'));
  const valid = LANG.test(lang) && lang !== 'en';
  const fill = (l: string) => ({
    label: question.translations?.[l]?.label ?? '',
    description: question.translations?.[l]?.description ?? '',
    options: Object.fromEntries(question.options.map((o) => [o.value, o.translations?.[l] ?? ''])),
  });
  const [form, setForm] = useState(() => fill(lang));
  const pick = (l: string) => {
    setLang(l);
    if (LANG.test(l)) setForm(fill(l));
  };
  const blocked = teen
    ? [
        ['label', form.label],
        ['description', form.description],
        ...Object.entries(form.options).map(([v, t]) => [`option ${v}`, t]),
      ]
        .map(([where, t]) => [where, t?.match(TEEN_BLOCKED_WORDS)?.[0]] as const)
        .filter(([, w]) => w)
    : [];
  const save = () =>
    start(async () => {
      const options = Object.entries(form.options)
        .filter(([, t]) => t.trim())
        .map(([value, label]) => ({ value, label: label.trim() }));
      const r = await translationSaveAction(question.name, {
        lang,
        ...(form.label.trim() ? { label: form.label.trim() } : {}),
        ...(form.description.trim() ? { description: form.description } : {}),
        ...(options.length ? { options } : {}),
      });
      if (!r.ok) return void toast.error(r.error);
      toast.success(`Saved the ${lang} wording${r.data.optionsSet ? ` and ${r.data.optionsSet} option labels` : ''}`);
    });
  const empty = !form.label.trim() && !form.description.trim() && !Object.values(form.options).some((t) => t.trim());
  return (
    <Card>
      <CardHeader
        title="Translations"
        hint="One language at a time. English is the question itself. Blank fields are left as they are."
        action={teen ? <Badge tone="accent">Teens see this question</Badge> : undefined}
      />
      <div className="grid gap-4 px-5 py-4">
        <div className="flex flex-wrap items-center gap-2">
          <label className="text-[13px] text-fg-2" htmlFor="tr-lang">
            Language
          </label>
          <div className="w-28">
            <input
              id="tr-lang"
              className={`${input} font-mono`}
              value={lang}
              onChange={(e) => pick(e.target.value.trim())}
              placeholder="hi or pt-BR"
              aria-invalid={!valid}
            />
          </div>
          {known.map((l) => (
            <button key={l} type="button" className={btn.ghost} onClick={() => pick(l)}>
              {l}
            </button>
          ))}
          {!valid ? <span className="text-[12px] text-danger">A code like hi or pt-BR, not en.</span> : null}
        </div>
        <label className="grid gap-1 text-[13px]">
          <span className="text-fg-2">
            Wording <span className="text-fg-3">· English: {question.label}</span>
          </span>
          <input
            className={input}
            maxLength={500}
            value={form.label}
            onChange={(e) => setForm({ ...form, label: e.target.value })}
          />
        </label>
        <label className="grid gap-1 text-[13px]">
          <span className="text-fg-2">Help text</span>
          <textarea
            className={`${input} min-h-[64px]`}
            maxLength={2000}
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </label>
        {question.options.length ? (
          <div className="grid gap-2">
            <span className="text-[13px] text-fg-2">Option labels</span>
            {question.options.map((o) => (
              <label key={o.value} className="grid grid-cols-[120px_1fr_1fr] items-center gap-2 text-[13px]">
                <span className="truncate font-mono text-fg-3">{o.value}</span>
                <span className="truncate text-fg-2">{o.label}</span>
                <input
                  className={input}
                  maxLength={500}
                  value={form.options[o.value] ?? ''}
                  onChange={(e) => setForm({ ...form, options: { ...form.options, [o.value]: e.target.value } })}
                />
              </label>
            ))}
          </div>
        ) : null}
        {blocked.length ? (
          <p className="text-[13px] text-danger" role="alert">
            Teens see this question, so the panel will refuse{' '}
            {blocked.map(([where, w]) => `“${w}” in the ${where}`).join(', ')}.
          </p>
        ) : null}
        <div>
          <button className={btn.primary} disabled={pending || !valid || empty || blocked.length > 0} onClick={save}>
            Save {valid ? lang : ''} translation
          </button>
        </div>
      </div>
    </Card>
  );
}
