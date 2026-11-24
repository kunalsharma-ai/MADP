import type { Metadata } from 'next';
import { PANEL_CODES, PANELS, SOURCE_PRECEDENCE, type DataMode } from '@madp/contracts';
import { api } from '@/lib/api';
import { Card, DataModeBadge, DemoBanner, EmptyState, PageHeader, btn, fmt } from '@/components/ui';
import { MatchRow, type Match } from './match-row';

export const metadata: Metadata = { title: 'Identity review' };
const STATUSES = ['pending', 'approved', 'rejected'] as const;

export default async function IdentityPage({
  searchParams,
}: {
  searchParams: Promise<{ panel?: string; status?: string }>;
}) {
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'pending';
  const qs = new URLSearchParams({ status, limit: '100' });
  if (sp.panel && (PANEL_CODES as readonly string[]).includes(sp.panel)) qs.set('panel', sp.panel);
  const queue = await api<{ dataMode: DataMode; totals: Record<string, number>; items: Match[] }>(
    `/identity/candidates?${qs}`,
  );
  return (
    <>
      <PageHeader
        eyebrow="Audience"
        title="Identity review"
        description="Accounts on different panels that look like the same person. A match is only a suggestion: merging joins the people, never the panels. Each panel keeps its own membership, consents, rewards and messages, and every merge can be undone."
        actions={<DataModeBadge mode={queue.dataMode} />}
      />
      <DemoBanner mode={queue.dataMode} />
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
        <select
          name="status"
          defaultValue={status}
          className="rounded-lg border border-border bg-surface px-3 py-2 text-sm"
          aria-label="Status"
        >
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {s} ({fmt(queue.totals[s] ?? 0)})
            </option>
          ))}
        </select>
        <button className={btn.secondary}>Show</button>
      </form>
      <Card>
        {queue.items.length === 0 ? (
          <EmptyState title={`No ${status} matches`}>The queue is clear for this filter.</EmptyState>
        ) : (
          <ul className="divide-y divide-border">
            {queue.items.map((m) => (
              <MatchRow key={m.id} m={m} />
            ))}
          </ul>
        )}
      </Card>
      <p className="mt-4 text-[12px] text-fg-3">
        Person fields (country, state, city, gender, birth year) come from the person&apos;s panel accounts in this
        order: {SOURCE_PRECEDENCE.join(', ')}. No panel outranks another.
      </p>
    </>
  );
}
