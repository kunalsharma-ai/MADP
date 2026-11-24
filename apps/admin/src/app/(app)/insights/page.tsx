import type { Metadata } from 'next';
import Link from 'next/link';
import type { DataMode, PanelCode, SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, PanelChip, fmtDate } from '@/components/ui';
import { cn } from '@/lib/cn';
import { InsightDecide, RefreshInsights } from './insight-forms';

export const metadata: Metadata = { title: 'AI insights' };

interface Insight {
  id: string;
  panel: PanelCode;
  rule: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  detail: string;
  recommendation: string;
  link: string | null;
  evidence: Record<string, number | string | null>;
  status: string;
  firstSeenAt: string;
  lastSeenAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

const TONE = { critical: 'danger', warning: 'warn', info: 'accent' } as const;
const human = (k: string) => k.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').toLowerCase();

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status === 'all' ? 'all' : 'open';
  const [me, r] = await Promise.all([
    api<SessionUser>('/auth/me'),
    api<{ dataMode: DataMode; lastRefreshedAt: string | null; rules: Record<string, string>; items: Insight[] }>(
      `/insights${status === 'open' ? '?status=open' : ''}`,
    ),
  ]);
  const canReview = me.permissions.includes('insights.review');
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="AI insights"
        description="Recommendations from fixed, documented rules over MADP's own counts, panel by panel. Nothing is acted on automatically: a person accepts or dismisses each one, and every decision is audited."
        actions={<DataModeBadge mode={r.dataMode} />}
      />
      <DemoBanner mode={r.dataMode} />
      <div className="mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-border bg-surface px-5 py-3 text-[13px]">
        <span className="text-fg-2">
          No AI model is called. A language model can be added later only with the owner&apos;s approval, and it would see counts only.
        </span>
        <span className="ml-auto text-fg-3">Last refreshed {r.lastRefreshedAt ? fmtDate(r.lastRefreshedAt) : 'never'}</span>
        {canReview ? <RefreshInsights /> : null}
      </div>
      <div className="mb-3 flex gap-1 text-[13px]" role="tablist">
        {(['open', 'all'] as const).map((s) => (
          <Link
            key={s}
            role="tab"
            aria-selected={status === s}
            href={`/insights?status=${s}`}
            className={cn('rounded-md px-3 py-1.5', status === s ? 'bg-accent-soft font-medium text-accent' : 'text-fg-2 hover:bg-surface-2')}
          >
            {s === 'open' ? 'Open' : 'All, including decided'}
          </Link>
        ))}
      </div>
      <div className="space-y-3">
        {r.items.length === 0 ? (
          <Card>
            <EmptyState title={r.lastRefreshedAt ? 'Nothing needs attention' : 'No insights yet'}>
              {r.lastRefreshedAt ? 'Every rule is quiet for the panels you can see.' : 'Refresh to run the rules for the first time.'}
            </EmptyState>
          </Card>
        ) : (
          r.items.map((i) => (
            <Card key={i.id}>
              <div className="flex flex-wrap items-start gap-4 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <div className="mb-1.5 flex flex-wrap items-center gap-2">
                    <Badge tone={TONE[i.severity]}>{i.severity}</Badge>
                    <PanelChip panel={i.panel} />
                    {i.status !== 'open' ? <Badge>{i.status}</Badge> : null}
                    <span className="font-mono text-[11px] text-fg-3">{i.rule}</span>
                  </div>
                  <h3 className="text-[15px] font-semibold text-fg">{i.title}</h3>
                  <p className="mt-1 text-[13px] text-fg-2">{i.detail}</p>
                  <p className="mt-2 text-[13px]">
                    <span className="font-medium text-fg">Recommendation: </span>
                    <span className="text-fg-2">{i.recommendation}</span>
                    {i.link ? (
                      <>
                        {' '}
                        <Link className="text-accent underline" href={i.link}>
                          Open
                        </Link>
                      </>
                    ) : null}
                  </p>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {Object.entries(i.evidence).map(([k, v]) => (
                      <span key={k} className="rounded-md bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-2">
                        {human(k)}: {v ?? '—'}
                      </span>
                    ))}
                  </div>
                  <p className="mt-2 text-[11px] text-fg-3">
                    First seen {fmtDate(i.firstSeenAt)} · last seen {fmtDate(i.lastSeenAt)}
                    {i.decisionNote ? ` · ${i.decisionNote}` : ''}
                  </p>
                </div>
                {canReview && i.status === 'open' ? <InsightDecide id={i.id} /> : null}
              </div>
            </Card>
          ))
        )}
        <Card>
          <CardHeader title="The rules" hint="Each insight comes from one of these. They run on demand, per panel." />
          <ul className="divide-y divide-border text-[13px]">
            {Object.entries(r.rules).map(([k, v]) => (
              <li key={k} className="grid grid-cols-[220px_1fr] gap-3 px-5 py-2">
                <span className="font-mono text-[12px] text-fg-3">{k}</span>
                <span className="text-fg-2">{v}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
    </>
  );
}
