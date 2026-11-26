import type { Metadata } from 'next';
import Link from 'next/link';
import type { DataMode, PanelCode, SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { AlertOctagon, AlertTriangle, ArrowRight, CheckCircle2, HelpCircle, Lightbulb, PartyPopper, Sparkles, type LucideIcon } from 'lucide-react';
import { Card, DataModeBadge, DemoBanner, PageHeader, fmtDate } from '@/components/ui';
import { BrandLogo } from '@/components/brand-logo';
import { getPanels } from '@/lib/panels';
import { panelName } from '@/lib/panel-names';
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

/** Plain words and one colour per level, so the page reads at a glance. */
const LEVEL: Record<Insight['severity'], { label: string; Icon: LucideIcon; from: string; to: string; soft: string }> = {
  critical: { label: 'Urgent', Icon: AlertOctagon, from: '#f43f5e', to: '#e11d48', soft: 'rgba(244,63,94,0.08)' },
  warning: { label: 'Important', Icon: AlertTriangle, from: '#f59e0b', to: '#ea580c', soft: 'rgba(245,158,11,0.09)' },
  info: { label: 'Good to know', Icon: Lightbulb, from: '#60a5fa', to: '#4f5bd5', soft: 'rgba(79,91,213,0.07)' },
};
const human = (k: string) => {
  const s = k.replace(/([A-Z])/g, ' $1').replaceAll('_', ' ').toLowerCase().trim();
  return s.charAt(0).toUpperCase() + s.slice(1);
};
const nf = new Intl.NumberFormat('en-IN');

export default async function InsightsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const sp = await searchParams;
  const status = sp.status === 'all' ? 'all' : 'open';
  const [me, r, panels] = await Promise.all([
    api<SessionUser>('/auth/me'),
    api<{ dataMode: DataMode; lastRefreshedAt: string | null; rules: Record<string, string>; items: Insight[] }>(
      `/insights${status === 'open' ? '?status=open' : ''}`,
    ),
    getPanels(),
  ]);
  const canReview = me.permissions.includes('insights.review');
  const open = r.items.filter((i) => i.status === 'open');
  const count = (s: Insight['severity']) => open.filter((i) => i.severity === s).length;
  const order = { critical: 0, warning: 1, info: 2 } as const;
  const items = [...r.items].sort((a, b) => (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) || order[a.severity] - order[b.severity]);
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="AI insights"
        description="Things that need your attention, found automatically in your panel numbers. Open one to fix it, or tell us it is not needed."
        actions={
          <>
            <DataModeBadge mode={r.dataMode} />
            {canReview ? <RefreshInsights /> : null}
          </>
        }
      />
      <DemoBanner mode={r.dataMode} />

      <div className="mb-5 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {(['critical', 'warning', 'info'] as const).map((s) => {
          const L = LEVEL[s];
          return (
            <div key={s} className="rise flex items-center gap-4 rounded-2xl border border-border/80 bg-surface p-4 shadow-soft">
              <span
                className="grid size-12 place-items-center rounded-2xl text-white"
                style={{ backgroundImage: `linear-gradient(135deg, ${L.from}, ${L.to})`, boxShadow: `0 10px 20px -10px ${L.to}` }}
              >
                <L.Icon className="size-6" aria-hidden />
              </span>
              <div>
                <p className="text-[28px] font-bold leading-none" style={{ color: L.to }}>
                  {count(s)}
                </p>
                <p className="mt-1 text-[13px] font-medium text-fg-2">{L.label}</p>
              </div>
            </div>
          );
        })}
        <div className="rise flex items-center gap-4 rounded-2xl border border-border/80 bg-surface p-4 shadow-soft">
          <span className="grid size-12 place-items-center rounded-2xl bg-gradient-to-br from-[#a855f7] to-[#6366f1] text-white">
            <Sparkles className="size-6" aria-hidden />
          </span>
          <div className="text-[13px]">
            <p className="font-semibold text-fg">Last checked</p>
            <p className="text-fg-3">{r.lastRefreshedAt ? fmtDate(r.lastRefreshedAt) : 'Never. Press “Check again”.'}</p>
          </div>
        </div>
      </div>

      <div className="mb-4 inline-flex gap-1 rounded-xl bg-surface-2 p-1 text-[13px]" role="tablist">
        {(['open', 'all'] as const).map((s) => (
          <Link
            key={s}
            role="tab"
            aria-selected={status === s}
            href={`/insights?status=${s}`}
            className={cn(
              'rounded-lg px-4 py-1.5 font-semibold transition',
              status === s ? 'bg-surface text-fg shadow-soft' : 'text-fg-2 hover:text-fg',
            )}
          >
            {s === 'open' ? `To do (${open.length})` : 'History'}
          </Link>
        ))}
      </div>

      <div className="space-y-4">
        {items.length === 0 ? (
          <Card className="px-6 py-12 text-center">
            <PartyPopper className="mx-auto size-10 text-[#a855f7]" aria-hidden />
            <p className="mt-3 text-base font-semibold text-fg">
              {r.lastRefreshedAt ? 'All clear. Nothing needs your attention.' : 'No checks yet'}
            </p>
            <p className="mt-1 text-sm text-fg-3">
              {r.lastRefreshedAt ? 'We will show a card here as soon as something does.' : 'Press “Check again” to run the checks for the first time.'}
            </p>
          </Card>
        ) : (
          items.map((i) => {
            const L = LEVEL[i.severity];
            const done = i.status !== 'open';
            return (
              <Card key={i.id} className={cn('relative overflow-hidden', done && 'opacity-70')}>
                <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundImage: `linear-gradient(${L.from}, ${L.to})` }} aria-hidden />
                <div className="flex flex-wrap gap-4 py-5 pl-6 pr-5">
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-2xl text-white"
                    style={{ backgroundImage: `linear-gradient(135deg, ${L.from}, ${L.to})` }}
                  >
                    <L.Icon className="size-5" aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2 text-[12px]">
                      <span className="rounded-full px-2 py-0.5 font-bold" style={{ background: L.soft, color: L.to }}>
                        {L.label}
                      </span>
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 font-medium text-fg-2">
                        <BrandLogo panel={i.panel} size={16} label={i.panel} />
                        {panelName(i.panel, panels)}
                      </span>
                      {done ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 font-medium text-fg-2">
                          <CheckCircle2 className="size-3" aria-hidden />
                          {i.status === 'accepted' ? 'Being handled' : i.status === 'dismissed' ? 'Not needed' : human(i.status)}
                        </span>
                      ) : null}
                    </div>
                    <h3 className="mt-2 text-[17px] font-bold text-fg">{i.title}</h3>
                    <p className="mt-1 text-[14px] text-fg-2">{i.detail}</p>
                    <div className="mt-3 flex gap-2.5 rounded-xl p-3 text-[13.5px]" style={{ background: L.soft }}>
                      <Lightbulb className="mt-0.5 size-4 shrink-0" style={{ color: L.to }} aria-hidden />
                      <p>
                        <span className="font-semibold text-fg">What to do: </span>
                        <span className="text-fg-2">{i.recommendation}</span>
                      </p>
                    </div>
                    {Object.keys(i.evidence).length ? (
                      <div className="mt-3 flex flex-wrap gap-2">
                        {Object.entries(i.evidence).map(([k, v]) => (
                          <span key={k} className="rounded-lg border border-border bg-surface-2/60 px-2.5 py-1 text-[12px] text-fg-2">
                            {human(k)}: <strong className="text-fg">{typeof v === 'number' ? nf.format(v) : (v ?? '—')}</strong>
                          </span>
                        ))}
                      </div>
                    ) : null}
                    <div className="mt-4 flex flex-wrap items-center gap-3">
                      {i.link && !done ? (
                        <Link
                          href={i.link}
                          className="inline-flex items-center gap-2 rounded-xl px-4 py-2 text-[13px] font-semibold text-white shadow-md transition hover:-translate-y-px hover:brightness-110"
                          style={{ backgroundImage: `linear-gradient(135deg, ${L.from}, ${L.to})` }}
                        >
                          Fix it now <ArrowRight className="size-4" aria-hidden />
                        </Link>
                      ) : null}
                      {canReview && !done ? <InsightDecide id={i.id} /> : null}
                    </div>
                    <p className="mt-3 text-[11.5px] text-fg-3">
                      Found {fmtDate(i.firstSeenAt)}
                      {i.decisionNote ? ` · Note: ${i.decisionNote}` : ''}
                    </p>
                  </div>
                </div>
              </Card>
            );
          })
        )}

        <details className="group rounded-2xl border border-border/80 bg-surface shadow-soft">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-4 text-sm font-semibold text-fg">
            <HelpCircle className="size-5 text-[#a855f7]" aria-hidden />
            How does this page work?
            <span className="ml-auto text-xs font-medium text-fg-3 group-open:hidden">Show</span>
            <span className="ml-auto hidden text-xs font-medium text-fg-3 group-open:inline">Hide</span>
          </summary>
          <div className="border-t border-border px-5 py-4 text-[13.5px] text-fg-2">
            <ol className="grid gap-3 sm:grid-cols-3">
              {[
                ['1. We check', 'MADP checks each panel’s numbers against the simple rules below. No outside AI is used, and no member data leaves MADP.'],
                ['2. You see a card', 'Every rule that needs attention becomes a card: what is wrong, how serious it is, and what to do.'],
                ['3. You decide', '“Fix it now” takes you to the right screen. Then choose “I’ll handle it” or “Not needed” with a short note. Your choice is recorded.'],
              ].map(([t, d]) => (
                <li key={t} className="rounded-xl bg-surface-2/60 p-3">
                  <p className="font-semibold text-fg">{t}</p>
                  <p className="mt-1">{d}</p>
                </li>
              ))}
            </ol>
            <p className="mt-4 font-semibold text-fg">What we check</p>
            <ul className="mt-2 grid gap-1.5 sm:grid-cols-2">
              {Object.values(r.rules).map((v) => (
                <li key={v} className="flex gap-2">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#10b981]" aria-hidden />
                  {v}
                </li>
              ))}
            </ul>
          </div>
        </details>
      </div>
    </>
  );
}
