import type { Metadata } from 'next';
import Link from 'next/link';
import { PANEL_CODES, PANELS, type DataMode } from '@madp/contracts';
import { api } from '@/lib/api';
import type { QuestionRow } from '@/lib/types';
import {
  Badge,
  Card,
  DataModeBadge,
  DemoBanner,
  EmptyState,
  PageHeader,
  PanelChip,
  Table,
  btn,
  fmt,
  input,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Question registry' };

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; search?: string }>;
}) {
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.panel && (PANEL_CODES as readonly string[]).includes(sp.panel)) qs.set('panel', sp.panel);
  if (sp.search) qs.set('search', sp.search.slice(0, 100));
  const data = await api<{ dataMode: DataMode; items: QuestionRow[] }>(`/questions?${qs}`);
  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="Question registry"
        description="Every source question, kept per panel and versioned whenever its wording, options or logic change. Nothing is merged across panels without an approved mapping."
        actions={<DataModeBadge mode={data.dataMode} />}
      />
      <DemoBanner mode={data.dataMode} />
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select
          name="panel"
          defaultValue={sp.panel ?? ''}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Panel"
        >
          <option value="">All panels</option>
          {PANEL_CODES.map((p) => (
            <option key={p} value={p}>
              {PANELS[p].name}
            </option>
          ))}
        </select>
        <input
          name="search"
          defaultValue={sp.search ?? ''}
          placeholder="Search name or wording"
          className={`${input} max-w-xs`}
          aria-label="Search"
        />
        <button className={btn.secondary}>Filter</button>
        <span className="ml-auto text-xs text-fg-3">{fmt(data.items.length)} questions</span>
      </form>
      <Card>
        {data.items.length === 0 ? (
          <EmptyState title="No questions imported yet">Run an import from Connectors &amp; sync.</EmptyState>
        ) : (
          <Table
            head={[
              'Panel',
              'Source question',
              'Wording',
              'Depends on',
              'Options',
              'Version',
              'Sensitivity',
              'Mapping',
            ]}
          >
            {data.items.map((q) => (
              <tr key={`${q.panel}-${q.sourceQuestionId}`} className="align-top">
                <td className="px-5 py-2.5">
                  <PanelChip panel={q.panel} />
                </td>
                <td className="px-5 py-2.5 font-mono text-xs">{q.sourceQuestionId}</td>
                <td className="max-w-md px-5 py-2.5">
                  {q.label}
                  <div className="mt-0.5 text-[11px] text-fg-3">
                    {q.sourceCategories.join(', ')}
                    {q.questionnaires.length ? ` · in ${q.questionnaires.join(', ')}` : ''}
                  </div>
                </td>
                <td className="px-5 py-2.5 font-mono text-xs text-fg-3">{q.parent ?? '—'}</td>
                <td className="num px-5 py-2.5">{fmt(q.optionCount)}</td>
                <td className="px-5 py-2.5">
                  v{q.version}
                  {q.versions > 1 ? <span className="text-fg-3"> · {q.versions} total</span> : null}
                </td>
                <td className="px-5 py-2.5">
                  {q.sensitivity === 'special_category' ? (
                    <Badge tone="danger">{q.panel === 'mho' ? 'health / special' : 'special category'}</Badge>
                  ) : (
                    <Badge>standard</Badge>
                  )}
                </td>
                <td className="px-5 py-2.5">
                  {q.mapping?.status === 'approved' ? (
                    <Badge tone="teal">{q.mapping.attributeKey}</Badge>
                  ) : q.mapping ? (
                    <Link href={`/mappings?panel=${q.panel}`} className="text-xs text-accent hover:underline">
                      {q.mapping.status}
                    </Link>
                  ) : (
                    '—'
                  )}
                </td>
              </tr>
            ))}
          </Table>
        )}
      </Card>
    </>
  );
}
