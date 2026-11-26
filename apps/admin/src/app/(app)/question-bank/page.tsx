import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, btn, fmt, input } from '@/components/ui';
import { BankImport } from './bank-import';
import { VersionActions, type Version } from './versions';
import { TranslationUpload } from './translation-upload';
import { DownloadMenu } from '@/components/files';
import { translationSheetAction } from '@/app/panel-actions';

export const metadata: Metadata = { title: 'Question bank' };

interface Q {
  id: string;
  name: string;
  label: string;
  type: string;
  category: string[];
  parent?: string;
  isRequired?: boolean;
  isActive?: boolean;
  topic?: string;
}
interface Missing {
  lang: string;
  questions: number;
  complete: number;
  missing: number;
  missingOptions: number;
  items: { name: string; label: string; missingLabel: boolean; missingOptions: number }[];
}
const LANG = /^[a-z]{2}(-[A-Z]{2})?$/;
interface Rules {
  checked: number;
  broken: number;
  rules: { question: string; parent: string; problem: string; values?: string[] }[];
}

const TABS = [
  ['questions', 'Questions'],
  ['rules', 'Show-when rules'],
  ['versions', 'Versions'],
  ['translations', 'Translations'],
  ['import', 'Import and export'],
] as const;

export default async function QuestionBankPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const sp = await searchParams;
  const tab = TABS.some(([k]) => k === sp.tab) ? sp.tab! : 'questions';
  return (
    <>
      <PageHeader
        eyebrow="Panel"
        title="Question bank"
        description="One question library for the brand picked at the top. Questions are keyed by name, so answers stay linked when wording changes. Teen guardrails are enforced on the server: tobacco, nicotine, alcohol, health, cosmetic and vehicle questions can never reach a teen profile."
      />
      <nav className="mb-4 flex gap-1 flex-wrap border-b border-border text-[13px]">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={`/question-bank?tab=${k}`}
            className={`-mb-px shrink-0 whitespace-nowrap border-b-2 px-3 py-2 font-medium ${tab === k ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg'}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {await withPanel(async () => {
        if (tab === 'rules') {
          const r = await api<Rules>('/panel/qb/rules/check');
          return (
            <Card>
              <CardHeader
                title={`${fmt(r.broken)} broken rules`}
                hint={`${fmt(r.checked)} questions have a show-when rule. A broken rule points at a question or answer that doesn't exist, so the question never shows.`}
                action={
                  <DownloadMenu
                    screen="question_bank"
                    title="Broken show-when rules"
                    columns={[
                      { key: 'question', label: 'Question' },
                      { key: 'parent', label: 'Shown under' },
                      { key: 'problem', label: 'Problem' },
                      { key: 'values', label: 'Answers that do not exist' },
                    ]}
                    rows={r.rules.map((x) => ({
                      question: x.question,
                      parent: x.parent,
                      problem: x.problem,
                      values: x.values?.join(', ') ?? '',
                    }))}
                  />
                }
              />
              {r.rules.length === 0 ? (
                <EmptyState title="Every show-when rule points at a real question and answer" />
              ) : (
                <Table head={['Question', 'Shown under', 'Problem', 'Answers that do not exist']}>
                  {r.rules.map((x) => (
                    <tr key={x.question}>
                      <td className="px-5 py-2">
                        <Link
                          className="font-mono text-accent hover:underline"
                          href={`/question-bank/${x.question}`}
                        >
                          {x.question}
                        </Link>
                      </td>
                      <td className="px-5 py-2 font-mono">{x.parent}</td>
                      <td className="px-5 py-2">{x.problem}</td>
                      <td className="px-5 py-2 text-fg-2">{x.values?.join(', ') ?? ''}</td>
                    </tr>
                  ))}
                </Table>
              )}
            </Card>
          );
        }
        if (tab === 'import') return <BankImport />;
        if (tab === 'translations') {
          const lang = LANG.test(sp.lang ?? '') && sp.lang !== 'en' ? sp.lang! : 'hi';
          const category = /^[a-z0-9_-]{1,60}$/.test(sp.category ?? '') ? sp.category : undefined;
          const r = await api<Missing>(
            `/panel/qb/translations/missing?${new URLSearchParams({ lang, ...(category ? { category } : {}) })}`,
          );
          return (
            <Card>
              <CardHeader
                title={`${fmt(r.complete)} of ${fmt(r.questions)} questions are fully translated into ${r.lang}`}
                hint={`${fmt(r.missing)} questions miss their wording or option labels, ${fmt(r.missingOptions)} option labels in all. Open a question to translate it, or fill the sheet in Excel and upload it.`}
                action={
                  <DownloadMenu
                    screen="translations"
                    label="Download sheet"
                    title={`Translations to fill (${r.lang})`}
                    subtitle={`Fill the Translation column in ${r.lang}, then upload it on this tab. Blank cells are skipped.${category ? ` Segment: ${category}.` : ''}`}
                    formats={['xlsx', 'csv']}
                    columns={[
                      { key: 'question', label: 'Question key' },
                      { key: 'part', label: 'Part' },
                      { key: 'value', label: 'Option value' },
                      { key: 'english', label: 'English' },
                      { key: 'translation', label: 'Translation' },
                      { key: 'teens', label: 'Teens see it' },
                    ]}
                    rows={[]}
                    load={translationSheetAction.bind(
                      null,
                      r.lang,
                      r.items.map((x) => x.name),
                    )}
                  />
                }
              />
              <TranslationUpload lang={r.lang} />
              <form
                className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3"
                action="/question-bank"
              >
                <input type="hidden" name="tab" value="translations" />
                <div className="w-28">
                  <input
                    className={`${input} font-mono`}
                    name="lang"
                    defaultValue={lang}
                    placeholder="hi"
                    aria-label="Language"
                  />
                </div>
                <div className="w-56">
                  <input
                    className={input}
                    name="category"
                    defaultValue={category ?? ''}
                    placeholder="Segment, e.g. b2c-minor"
                    aria-label="Segment category"
                  />
                </div>
                <button className={btn.ghost}>Show</button>
              </form>
              {r.items.length === 0 ? (
                <EmptyState title="Nothing missing">
                  Every question here has its wording and option labels in {r.lang}.
                </EmptyState>
              ) : (
                <Table head={['Question', 'English wording', 'Wording', 'Option labels missing']}>
                  {r.items.map((x) => (
                    <tr key={x.name}>
                      <td className="px-5 py-2">
                        <Link
                          className="font-mono text-accent hover:underline"
                          href={`/question-bank/${x.name}`}
                        >
                          {x.name}
                        </Link>
                      </td>
                      <td className="max-w-md truncate px-5 py-2 text-fg-2">{x.label}</td>
                      <td className="px-5 py-2">
                        {x.missingLabel ? (
                          <Badge tone="warn">missing</Badge>
                        ) : (
                          <Badge tone="teal">done</Badge>
                        )}
                      </td>
                      <td className="num px-5 py-2">{fmt(x.missingOptions)}</td>
                    </tr>
                  ))}
                </Table>
              )}
              {r.missing > r.items.length ? (
                <p className="px-5 py-3 text-[12px] text-fg-3">
                  The panel lists the first {fmt(r.items.length)}.
                </p>
              ) : null}
            </Card>
          );
        }
        if (tab === 'versions') {
          const [list, me] = await Promise.all([
            api<Version[]>('/panel/qb/versions'),
            api<{ id: string }>('/auth/me'),
          ]);
          return <VersionActions versions={list} me={me.id} />;
        }
        const qs = new URLSearchParams();
        for (const k of ['q', 'category', 'page']) if (sp[k]) qs.set(k, sp[k]!);
        const data = await api<{ items: Q[]; total: number; page: number; pageSize: number }>(
          `/panel/questions?${qs}`,
        );
        return (
          <Card>
            <form className="flex flex-wrap items-end gap-3 px-5 py-4 text-[13px]" method="get">
              <input type="hidden" name="tab" value="questions" />
              <label className="min-w-64 flex-1">
                Search
                <input name="q" defaultValue={sp.q} placeholder="Key or wording" className={input} />
              </label>
              <label>
                Segment
                <select name="category" defaultValue={sp.category ?? ''} className={input}>
                  <option value="">Any</option>
                  <option value="b2c">Consumer (b2c)</option>
                  <option value="b2b">Business Professional (b2b)</option>
                  <option value="b2c-minor">Teen (b2c-minor)</option>
                </select>
              </label>
              <button className={btn.primary}>Search</button>
              <Link href="/question-bank/new" className={btn.secondary}>
                New question
              </Link>
            </form>
            <CardHeader
              title={`${fmt(data.total)} questions`}
              hint={`Page ${data.page}, ${data.pageSize} a page. For the whole bank with options and profiles, use Import & export.`}
              action={
                <DownloadMenu
                  screen="question_bank"
                  title="Question bank (this page)"
                  subtitle={[
                    sp.q ? `Search: ${sp.q}` : '',
                    sp.category ? `Segment: ${sp.category}` : '',
                    `Page ${data.page}`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  columns={[
                    { key: 'name', label: 'Key' },
                    { key: 'label', label: 'Wording' },
                    { key: 'type', label: 'Type' },
                    { key: 'segments', label: 'Segments' },
                    { key: 'parent', label: 'Shown under' },
                    { key: 'required', label: 'Required' },
                    { key: 'active', label: 'Active' },
                    { key: 'topic', label: 'Topic' },
                  ]}
                  rows={data.items.map((q) => ({
                    name: q.name,
                    label: q.label,
                    type: q.type,
                    segments: q.category.join(', '),
                    parent: q.parent ?? '',
                    required: q.isRequired !== false,
                    active: q.isActive !== false,
                    topic: q.topic ?? '',
                  }))}
                />
              }
            />
            {data.items.length === 0 ? (
              <EmptyState title="No questions match" />
            ) : (
              <Table head={['Key', 'Wording', 'Type', 'Segments', 'Shown under', 'Required']}>
                {data.items.map((q) => (
                  <tr key={q.id} className="hover:bg-surface-2">
                    <td className="px-5 py-2">
                      <Link
                        className="font-mono text-accent hover:underline"
                        href={`/question-bank/${q.name}`}
                      >
                        {q.name}
                      </Link>
                    </td>
                    <td className="max-w-md px-5 py-2">{q.label}</td>
                    <td className="px-5 py-2">{q.type}</td>
                    <td className="px-5 py-2">
                      <div className="flex flex-wrap gap-1">
                        {q.category.map((c) => (
                          <Badge key={c} tone={c.includes('minor') ? 'accent' : 'neutral'}>
                            {c}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-5 py-2 font-mono text-fg-2">{q.parent || ''}</td>
                    <td className="px-5 py-2">{q.isRequired === false ? 'No' : 'Yes'}</td>
                  </tr>
                ))}
              </Table>
            )}
            {data.total > data.page * data.pageSize ? (
              <div className="flex justify-end border-t border-border px-5 py-3">
                <Link
                  className={btn.secondary}
                  href={`/question-bank?${new URLSearchParams({ ...Object.fromEntries(qs), tab: 'questions', page: String(data.page + 1) })}`}
                >
                  Next
                </Link>
              </div>
            ) : null}
          </Card>
        );
      })}
    </>
  );
}
