'use client';

import { useMemo, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  checkDraft,
  isChoiceType,
  liveRule,
  planWrites,
  simulate,
  type DraftSpec,
  type ShowRule,
} from '@madp/contracts';
import { saveDraftAction } from '@/app/questionnaire-actions';
import { Badge, Card, CardHeader, btn, input } from '@/components/ui';
import { cn } from '@/lib/cn';
import type { DraftDetail } from '../shared';

const REASON: Record<string, string> = {
  always: 'always shown',
  parent_answered: 'shown: its condition holds',
  parent_unanswered: 'hidden: waits for its parent',
  value_not_matched: 'hidden: the answer does not match',
  no_options: 'hidden: no options',
  unknown: 'not in the bank yet (save to load it)',
};

const move = <T,>(list: T[], i: number, by: number) => {
  const j = i + by;
  if (j < 0 || j >= list.length) return list;
  const next = [...list];
  [next[i], next[j]] = [next[j]!, next[i]!];
  return next;
};

/** Screen 11: pages, questions, show logic, required, and a preview by the panel's own rule. */
export function Builder({ draft }: { draft: DraftDetail }) {
  const router = useRouter();
  const src = draft.base;
  const [spec, setSpec] = useState<DraftSpec>(draft.spec);
  const [note, setNote] = useState(draft.note ?? '');
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const [adding, setAdding] = useState<{ page: number; name: string }>({ page: 0, name: '' });
  const [pending, start] = useTransition();
  const dirty = JSON.stringify(spec) !== JSON.stringify(draft.spec) || note !== (draft.note ?? '');

  const problems = useMemo(() => checkDraft(src, spec), [src, spec]);
  const writes = useMemo(() => planWrites(src, spec), [src, spec]);
  const sim = useMemo(() => simulate(src, spec, answers), [src, spec, answers]);
  const order = spec.pages.flatMap((p) => p.questions);
  const used = new Set(order);

  const setPages = (pages: DraftSpec['pages']) => setSpec((s) => ({ ...s, pages }));
  const setRule = (name: string, rule: ShowRule | null) =>
    setSpec((s) => {
      const rules = { ...s.rules };
      if (rule) rules[name] = rule;
      else delete rules[name];
      return { ...s, rules };
    });
  const setRequired = (name: string, value: boolean) =>
    setSpec((s) => {
      const required = { ...s.required };
      if (src.questions[name]?.isRequired === value) delete required[name];
      else required[name] = value;
      return { ...s, required };
    });
  const save = () =>
    start(async () => {
      const r = await saveDraftAction(draft.id, spec, note || undefined);
      if (!r.ok) return void toast.error(r.error);
      toast.success('Draft saved');
      router.refresh();
    });

  return (
    <>
      <Card>
        <CardHeader
          title="Pages and questions"
          hint="Order the pages and questions, set when each one shows, and whether an answer is required."
          action={
            <button className={btn.primary} disabled={pending || !dirty} onClick={save}>
              {pending ? 'Saving…' : dirty ? 'Save draft' : 'Saved'}
            </button>
          }
        />
        <div className="grid gap-3 px-5 py-4 text-[13px]">
          <label>
            What it is for
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} className={input} />
          </label>
          {spec.pages.map((page, pi) => (
            <section key={pi} className="rounded-lg border border-border">
              <header className="flex items-center gap-2 border-b border-border bg-surface-2 px-3 py-2">
                <span className="text-fg-3">Page {pi + 1}</span>
                <input
                  aria-label={`Page ${pi + 1} title`}
                  value={page.title}
                  onChange={(e) => setPages(spec.pages.map((p, i) => (i === pi ? { ...p, title: e.target.value } : p)))}
                  className={cn(input, 'mt-0 max-w-xs py-1')}
                />
                <span className="flex-1" />
                <IconButton label="Move page up" onClick={() => setPages(move(spec.pages, pi, -1))} icon={ArrowUp} />
                <IconButton label="Move page down" onClick={() => setPages(move(spec.pages, pi, 1))} icon={ArrowDown} />
                <IconButton
                  label="Remove page"
                  onClick={() => setPages(spec.pages.filter((_, i) => i !== pi))}
                  icon={Trash2}
                  disabled={spec.pages.length === 1}
                />
              </header>
              <ol className="divide-y divide-border">
                {page.questions.map((name, qi) => {
                  const q = src.questions[name];
                  const draftRule = spec.rules[name];
                  const live = q ? liveRule(q) : null;
                  const rule = draftRule ?? (live === 'dependent' ? null : live);
                  const earlier = order.slice(0, order.indexOf(name)).filter((n) => src.questions[n]);
                  const parents = [...new Set([...earlier, ...(rule?.parent && !earlier.includes(rule.parent) ? [rule.parent] : [])])];
                  const parentQ = rule?.parent ? src.questions[rule.parent] : undefined;
                  const required = spec.required[name] ?? q?.isRequired ?? true;
                  const step = sim.find((s) => s.question === name);
                  const mine = problems.filter((p) => p.question === name);
                  return (
                    <li key={name} className="grid gap-2 px-3 py-2.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-[12px] text-fg-3">{name}</span>
                        <span className="font-medium">{q?.label ?? 'Not loaded yet'}</span>
                        {q ? <Badge tone="neutral">{q.type}</Badge> : null}
                        <span className="flex-1" />
                        <label className="flex items-center gap-1 text-fg-2">
                          <input
                            type="checkbox"
                            checked={required}
                            disabled={!q}
                            onChange={(e) => setRequired(name, e.target.checked)}
                          />
                          Required
                        </label>
                        <select
                          aria-label={`Move ${name} to page`}
                          value={pi}
                          onChange={(e) => {
                            const to = Number(e.target.value);
                            setPages(
                              spec.pages.map((p, i) =>
                                i === pi
                                  ? { ...p, questions: p.questions.filter((x) => x !== name) }
                                  : i === to
                                    ? { ...p, questions: [...p.questions, name] }
                                    : p,
                              ),
                            );
                          }}
                          className={cn(input, 'mt-0 w-auto py-1')}
                        >
                          {spec.pages.map((p, i) => (
                            <option key={i} value={i}>
                              Page {i + 1}
                            </option>
                          ))}
                        </select>
                        <IconButton
                          label={`Move ${name} up`}
                          onClick={() => setPages(spec.pages.map((p, i) => (i === pi ? { ...p, questions: move(p.questions, qi, -1) } : p)))}
                          icon={ArrowUp}
                        />
                        <IconButton
                          label={`Move ${name} down`}
                          onClick={() => setPages(spec.pages.map((p, i) => (i === pi ? { ...p, questions: move(p.questions, qi, 1) } : p)))}
                          icon={ArrowDown}
                        />
                        <IconButton
                          label={`Remove ${name}`}
                          onClick={() => {
                            setPages(spec.pages.map((p, i) => (i === pi ? { ...p, questions: p.questions.filter((x) => x !== name) } : p)));
                            setRule(name, null);
                          }}
                          icon={Trash2}
                        />
                      </div>
                      {q ? (
                        <div className="flex flex-wrap items-center gap-2 text-fg-2">
                          <span>Show</span>
                          {live === 'dependent' && !draftRule ? (
                            <>
                              <span>
                                with options that follow the answer to <b className="font-mono">{q.parent}</b> (kept as it is)
                              </span>
                              <button
                                className={btn.ghost}
                                onClick={() => setRule(name, { parent: null, values: [] })}
                                title="Replaces the per-answer option lists"
                              >
                                Make it always shown
                              </button>
                            </>
                          ) : (
                            <>
                              <select
                                aria-label={`When ${name} shows`}
                                value={rule?.parent ?? ''}
                                onChange={(e) => setRule(name, { parent: e.target.value || null, values: [] })}
                                className={cn(input, 'mt-0 w-auto py-1')}
                              >
                                <option value="">always</option>
                                {parents.map((p) => (
                                  <option key={p} value={p}>
                                    when {p} …
                                  </option>
                                ))}
                              </select>
                              {rule?.parent && parentQ && isChoiceType(q.type) && isChoiceType(parentQ.type) ? (
                                <span className="flex flex-wrap items-center gap-2">
                                  is
                                  {parentQ.options.map((o) => (
                                    <label key={o.value} className="flex items-center gap-1">
                                      <input
                                        type="checkbox"
                                        checked={rule.values.includes(o.value)}
                                        onChange={(e) =>
                                          setRule(name, {
                                            parent: rule.parent,
                                            values: e.target.checked
                                              ? [...rule.values, o.value]
                                              : rule.values.filter((v) => v !== o.value),
                                          })
                                        }
                                      />
                                      {o.label}
                                    </label>
                                  ))}
                                </span>
                              ) : rule?.parent ? (
                                <span>is answered (the panel can&apos;t limit a {q.type} question to some answers)</span>
                              ) : null}
                            </>
                          )}
                        </div>
                      ) : null}
                      {mine.length ? (
                        <ul className="grid gap-1">
                          {mine.map((p, i) => (
                            <li key={i} className={p.level === 'error' ? 'text-danger' : 'text-warn'}>
                              {p.message}
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      {step ? (
                        <p className="text-[12px] text-fg-3">
                          Preview: {REASON[step.reason]}
                          {step.shown && step.options.length ? `, options ${step.options.join(', ')}` : ''}
                        </p>
                      ) : null}
                    </li>
                  );
                })}
                {page.questions.length === 0 ? <li className="px-3 py-2.5 text-fg-3">No questions on this page.</li> : null}
              </ol>
            </section>
          ))}
          <div className="flex flex-wrap items-end gap-2">
            <button
              className={btn.secondary}
              onClick={() => setPages([...spec.pages, { title: `Page ${spec.pages.length + 1}`, questions: [] }])}
            >
              <Plus className="mr-1 inline size-3.5" aria-hidden /> Add a page
            </button>
            <label className="min-w-64 flex-1">
              Add a question from the {src.category} bank
              <select
                value={adding.name}
                onChange={(e) => setAdding((a) => ({ ...a, name: e.target.value }))}
                className={input}
              >
                <option value="">Pick a question…</option>
                {src.bank
                  .filter((b) => !used.has(b.name))
                  .map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}: {b.label} ({b.type})
                    </option>
                  ))}
              </select>
            </label>
            <label>
              to
              <select
                value={adding.page}
                onChange={(e) => setAdding((a) => ({ ...a, page: Number(e.target.value) }))}
                className={input}
              >
                {spec.pages.map((p, i) => (
                  <option key={i} value={i}>
                    Page {i + 1}
                  </option>
                ))}
              </select>
            </label>
            <button
              className={btn.secondary}
              disabled={!adding.name}
              onClick={() => {
                setPages(spec.pages.map((p, i) => (i === adding.page ? { ...p, questions: [...p.questions, adding.name] } : p)));
                setAdding((a) => ({ ...a, name: '' }));
              }}
            >
              Add
            </button>
          </div>
          <p className="text-[12px] text-fg-3">
            {writes.length} change{writes.length === 1 ? '' : 's'} to write ·{' '}
            {problems.filter((p) => p.level === 'error').length} to fix · new questions from the bank load their options
            when you save.
          </p>
        </div>
      </Card>
      <Card>
        <CardHeader
          title="Preview"
          hint="Pick answers as a member would. Questions show and hide by the same rule the panel uses."
          action={
            <button className={btn.ghost} onClick={() => setAnswers({})}>
              Clear answers
            </button>
          }
        />
        <ol className="grid gap-2 px-5 py-4 text-[13px]">
          {sim.map((s) => {
            const q = src.questions[s.question];
            return (
              <li key={s.question} className={s.shown ? '' : 'opacity-50'}>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={s.shown ? 'teal' : 'neutral'}>{s.shown ? 'Shown' : 'Hidden'}</Badge>
                  <span className="font-medium">{q?.label ?? s.question}</span>
                  <span className="text-[12px] text-fg-3">{REASON[s.reason]}</span>
                </div>
                {s.shown && q && isChoiceType(q.type) ? (
                  <div className="mt-1 flex flex-wrap gap-3 pl-1">
                    {q.options
                      .filter((o) => s.options.includes(o.value))
                      .filter((o, i, all) => all.findIndex((x) => x.value === o.value) === i)
                      .map((o) => {
                        const multi = q.type === 'checkbox' || q.type === 'multiselect';
                        const picked = answers[s.question] ?? [];
                        return (
                          <label key={o.value} className="flex items-center gap-1">
                            <input
                              type={multi ? 'checkbox' : 'radio'}
                              name={`sim-${s.question}`}
                              checked={picked.includes(o.value)}
                              onChange={(e) =>
                                setAnswers((a) => ({
                                  ...a,
                                  [s.question]: multi
                                    ? e.target.checked
                                      ? [...picked, o.value]
                                      : picked.filter((v) => v !== o.value)
                                    : [o.value],
                                }))
                              }
                            />
                            {o.label}
                          </label>
                        );
                      })}
                  </div>
                ) : s.shown && q ? (
                  <label className="mt-1 flex items-center gap-1 pl-1 text-fg-2">
                    <input
                      type="checkbox"
                      checked={(answers[s.question] ?? []).length > 0}
                      onChange={(e) => setAnswers((a) => ({ ...a, [s.question]: e.target.checked ? ['answered'] : [] }))}
                    />
                    Answered
                  </label>
                ) : null}
              </li>
            );
          })}
        </ol>
      </Card>
    </>
  );
}

function IconButton({
  label,
  onClick,
  icon: Icon,
  disabled,
}: {
  label: string;
  onClick: () => void;
  icon: typeof ArrowUp;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className="rounded-md p-1 text-fg-3 hover:bg-surface-2 hover:text-fg disabled:opacity-40"
    >
      <Icon className="size-3.5" aria-hidden />
    </button>
  );
}
