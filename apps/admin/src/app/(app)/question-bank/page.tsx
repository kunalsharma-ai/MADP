import type { Metadata } from 'next';
import Link from 'next/link';
import { api } from '@/lib/api';
import { withPanel } from '@/lib/panel';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Table, btn, fmt, input } from '@/components/ui';
import { BankImport } from './bank-import';

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
interface Rules {
  checked: number;
  broken: number;
  rules: { question: string; parent: string; problem: string; values?: string[] }[];
}

const TABS = [
  ['questions', 'Questions'],
  ['rules', 'Show-when rules'],
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
      <nav className="mb-4 flex gap-1 border-b border-border text-[13px]">
        {TABS.map(([k, label]) => (
          <Link
            key={k}
            href={`/question-bank?tab=${k}`}
            className={`-mb-px border-b-2 px-3 py-2 font-medium ${tab === k ? 'border-accent text-fg' : 'border-transparent text-fg-3 hover:text-fg'}`}
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
              hint={`Page ${data.page}, ${data.pageSize} a page`}
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
