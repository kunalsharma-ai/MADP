import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import { type DataMode } from '@madp/contracts';
import { api } from '@/lib/api';
import type { Attribute, MappingRow } from '@/lib/types';
import { Card, DataModeBadge, DemoBanner, EmptyState, PageHeader, Pager } from '@/components/ui';
import { PanelPills, StatusTabs } from '@/components/filters';
import { MappingRowView } from './mapping-row';

export const metadata: Metadata = { title: 'Mapping workbench' };
const STATUSES = ['pending', 'needs_info', 'approved', 'rejected'] as const;
const LABEL: Record<(typeof STATUSES)[number], string> = {
  pending: 'To review',
  needs_info: 'Needs info',
  approved: 'Approved',
  rejected: 'Not mappable',
};

export default async function MappingsPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; status?: string; page?: string }>;
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
  const SIZE = 25;
  const pages = Math.max(1, Math.ceil(queue.items.length / SIZE));
  const page = Math.min(pages, Math.max(1, Number(sp.page) || 1));
  const shown = queue.items.slice((page - 1) * SIZE, page * SIZE);
  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="Mapping workbench"
        description="Link each panel question to a shared profile question, so its answers can be used in audience counts. Check the suggestion, change it if needed, and press Approve. Nothing is linked until a person approves it."
        actions={<DataModeBadge mode={queue.dataMode} />}
      />
      <DemoBanner mode={queue.dataMode} />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <StatusTabs
          path="/mappings"
          current={status}
          params={{ panel: sp.panel }}
          tabs={STATUSES.map((k) => ({ key: k, label: LABEL[k], count: queue.totals[k] ?? 0 }))}
        />
        <PanelPills path="/mappings" current={sp.panel ?? ''} params={{ status }} panels={panelList} />
      </div>
      <Card>
        {queue.items.length === 0 ? (
          <EmptyState title="All done here">
            Nothing in this list for the panel you picked.
          </EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {shown.map((m) => (
              <MappingRowView key={m.id} m={m} attributes={attrs.attributes} />
            ))}
          </ul>
        )}
        <Pager total={queue.items.length} page={page} size={SIZE} path="/mappings" params={sp} />
      </Card>
    </>
  );
}
