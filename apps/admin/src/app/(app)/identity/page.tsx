import { cn } from '@/lib/cn';
import Link from 'next/link';
import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import { SOURCE_PRECEDENCE, type DataMode } from '@madp/contracts';
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
  const panelList = await getPanels();
  const sp = await searchParams;
  const status = (STATUSES as readonly string[]).includes(sp.status ?? '') ? sp.status! : 'pending';
  const qs = new URLSearchParams({ status, limit: '100' });
  if (sp.panel && panelList.map((x) => x.code).includes(sp.panel)) qs.set('panel', sp.panel);
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
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Status" className="inline-flex flex-wrap gap-1 rounded-xl bg-surface-2 p-1 text-[13px]">
          {STATUSES.map((s) => (
            <Link
              key={s}
              href={`/identity?status=${s}${sp.panel ? `&panel=${sp.panel}` : ''}`}
              aria-current={status === s ? 'page' : undefined}
              className={cn(
                'rounded-lg px-3.5 py-1.5 font-semibold capitalize transition',
                status === s ? 'bg-surface text-fg shadow-soft' : 'text-fg-2 hover:text-fg',
              )}
            >
              {s} <span className="ml-1 rounded-full bg-accent-soft px-1.5 text-[11px] text-accent">{fmt(queue.totals[s] ?? 0)}</span>
            </Link>
          ))}
        </nav>
        <nav aria-label="Panel" className="flex flex-wrap gap-1.5 text-[13px]">
          {[{ code: '', name: 'All panels' }, ...panelList].map((x) => (
            <Link
              key={x.code || 'all'}
              href={`/identity?status=${status}${x.code ? `&panel=${x.code}` : ''}`}
              aria-current={(sp.panel ?? '') === x.code ? 'page' : undefined}
              className={cn(
                'rounded-full border px-3 py-1 font-medium transition',
                (sp.panel ?? '') === x.code
                  ? 'border-transparent bg-gradient-to-r from-[#4f5bd5] to-[#8b5cf6] text-white'
                  : 'border-border bg-surface text-fg-2 hover:border-accent/50',
              )}
            >
              {x.code ? panelName(x.code, panelList) : x.name}
            </Link>
          ))}
        </nav>
      </div>
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
