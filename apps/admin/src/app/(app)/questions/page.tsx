import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type DataMode, type SegmentRuleInfo } from '@madp/contracts';
import { api } from '@/lib/api';
import type { Attribute, QuestionRow } from '@/lib/types';
import { AttributeMatrix, GroupedQuestions } from './grouped';
import { cn } from '@/lib/cn';
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
  Pager,
} from '@/components/ui';

export const metadata: Metadata = { title: 'Question registry' };

export default async function QuestionsPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; search?: string; page?: string; view?: string }>;
}) {
  const panelList = await getPanels();
  const sp = await searchParams;
  const qs = new URLSearchParams();
  if (sp.panel && panelList.map((x) => x.code).includes(sp.panel)) qs.set('panel', sp.panel);
  if (sp.search) qs.set('search', sp.search.slice(0, 100));
  const view = sp.view === 'list' ? 'list' : sp.view === 'attributes' ? 'attributes' : 'grouped';
  const [data, seg, attrs] = await Promise.all([
    api<{ dataMode: DataMode; items: QuestionRow[] }>(`/questions?${qs}`),
    // Both lists only label the grouping; an admin without access to them still sees every question.
    api<{ segments: { key: string; label: string }[]; rules: SegmentRuleInfo[] }>('/audience-segments').catch(() => ({ segments: [], rules: [] })),
    api<{ attributes: Attribute[] }>('/audience/attributes').catch(() => ({ attributes: [] })),
  ]);
  const SIZE = 50;
  const pages = Math.max(1, Math.ceil(data.items.length / SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const shown = data.items.slice((page - 1) * SIZE, page * SIZE);
  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="Question registry"
        description="Every question each panel asks, grouped by segment and profile. The coloured chip on each question shows the shared attribute it feeds: green is linked, purple is a suggestion waiting for approval."
        actions={<DataModeBadge mode={data.dataMode} />}
      />
      <DemoBanner mode={data.dataMode} />
      <form method="get" className="mb-4 flex flex-wrap items-center gap-2">
        <select
          name="panel"
          defaultValue={sp.panel ?? ''}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Panel"
        >
          <option value="">All panels</option>
          {panelList.map((x) => x.code).map((p) => (
            <option key={p} value={p}>
              {panelName(p, panelList)}
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
        <input type="hidden" name="view" value={view} />
        <button className={btn.secondary}>Filter</button>
        <nav aria-label="View" className="inline-flex gap-1 rounded-xl bg-surface-2 p-1 text-[13px]">
          {(['grouped', 'attributes', 'list'] as const).map((v) => (
            <Link
              key={v}
              href={`/questions?${new URLSearchParams({ ...(sp.panel ? { panel: sp.panel } : {}), ...(sp.search ? { search: sp.search } : {}), view: v })}`}
              aria-current={view === v ? 'page' : undefined}
              className={cn('rounded-lg px-3 py-1.5 font-semibold', view === v ? 'bg-surface text-fg shadow-soft' : 'text-fg-2 hover:text-fg')}
            >
              {v === 'grouped' ? 'By segment & profile' : v === 'attributes' ? 'By attribute, all panels' : 'Plain list'}
            </Link>
          ))}
        </nav>
        <span className="ml-auto text-xs text-fg-3">{fmt(data.items.length)} questions</span>
      </form>
      {view === 'attributes' && data.items.length ? (
        <AttributeMatrix
          items={data.items}
          attributes={attrs.attributes}
          panels={panelList.filter((x) => !sp.panel || x.code === sp.panel).map(({ code, name }) => ({ code, name }))}
          segmentLabel={Object.fromEntries(seg.segments.map((x) => [x.key, x.label]))}
        />
      ) : view === 'grouped' && data.items.length ? (
        <GroupedQuestions
          items={data.items}
          rules={seg.rules}
          segmentLabel={Object.fromEntries(seg.segments.map((x) => [x.key, x.label]))}
          attributes={attrs.attributes}
        />
      ) : (
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
            {shown.map((q) => (
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
        <Pager total={data.items.length} page={page} size={SIZE} path="/questions" params={sp} />
      </Card>
      )}
    </>
  );
}
