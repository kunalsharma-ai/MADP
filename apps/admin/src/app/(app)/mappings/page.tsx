import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import { type DataMode } from '@madp/contracts';
import { api } from '@/lib/api';
import type { Attribute, MappingRow } from '@/lib/types';
import { Card, DataModeBadge, DemoBanner, EmptyState, PageHeader, btn, fmt } from '@/components/ui';
import { MappingRowView } from './mapping-row';

export const metadata: Metadata = { title: 'Mapping workbench' };
const STATUSES = ['pending', 'needs_info', 'approved', 'rejected'] as const;

export default async function MappingsPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; status?: string }>;
}) {
  const panelList = await getPanels();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'pending';
  const qs = new URLSearchParams({ status });
  if (sp.panel && panelList.map((x) => x.code).includes(sp.panel)) qs.set('panel', sp.panel);
  const [queue, attrs] = await Promise.all([
    api<{ dataMode: DataMode; totals: Record<string, number>; items: MappingRow[] }>(
      `/mappings/review?${qs}`,
    ),
    api<{ attributes: Attribute[] }>('/audience/attributes'),
  ]);
  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="Mapping workbench"
        description="Map each panel's source question to a canonical attribute. Suggestions only match the source question name, so a person must confirm every one; questions with the same wording are never merged automatically."
        actions={<DataModeBadge mode={queue.dataMode} />}
      />
      <DemoBanner mode={queue.dataMode} />
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
        <select
          name="status"
          defaultValue={status}
          className="rounded-xl border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s.replace('_', ' ')} ({fmt(queue.totals[s] ?? 0)})
            </option>
          ))}
        </select>
        <button className={btn.secondary}>Show</button>
      </form>
      <Card>
        {queue.items.length === 0 ? (
          <EmptyState title={`Nothing ${status.replace('_', ' ')}`}>
            The queue is clear for this filter.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {queue.items.map((m) => (
              <MappingRowView key={m.id} m={m} attributes={attrs.attributes} />
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
