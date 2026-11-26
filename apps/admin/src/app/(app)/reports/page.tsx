import { panelName, panelShort } from '@/lib/panel-names';
import { getPanels } from '@/lib/panels';
import type { Metadata } from 'next';
import Link from 'next/link';
import { type PanelCode, type ReportResult } from '@madp/contracts';
import { api } from '@/lib/api';
import { Country } from '@/components/country';
import { Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, PanelChip, Table, btn, fmt, fmtDate, input } from '@/components/ui';
import { cn } from '@/lib/cn';

export const metadata: Metadata = { title: 'Reports & exports' };

interface CatalogueItem {
  key: string;
  title: string;
  description: string;
  group: string;
  period: boolean;
  pii: boolean;
  canView: boolean;
  canExport: boolean;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;

function cell(v: string | number | null, type: string, key: string) {
  if (v === '') return <span className="text-fg-3">—</span>;
  if (key === 'panel' && typeof v === 'string' && /^[a-z][a-z0-9_]{1,15}$/.test(v)) return <PanelChip panel={v as PanelCode} />;
  if (key === 'country' && typeof v === 'string') return <Country code={v} />;
  if (v === null) return <span className="text-fg-3" title="Suppressed: too few people">&lt; min</span>;
  if (type === 'money' && typeof v === 'number') return v.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (type === 'number' && typeof v === 'number') return fmt(v);
  if (type === 'date' && typeof v === 'string') return fmtDate(v);
  return String(v);
}

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ key?: string; panel?: string; from?: string; to?: string }> }) {
  const panelList = await getPanels();
  const sp = await searchParams;
  const { reports } = await api<{ reports: CatalogueItem[] }>('/reports');
  const visible = reports.filter((r) => r.canView);
  const selected = visible.find((r) => r.key === sp.key) ?? visible[0];
  const params = new URLSearchParams();
  if (sp.panel && /^(t2o|mfr|mho)$/.test(sp.panel)) params.set('panel', sp.panel);
  if (selected?.period && sp.from && DAY.test(sp.from)) params.set('from', sp.from);
  if (selected?.period && sp.to && DAY.test(sp.to)) params.set('to', sp.to);
  const r = selected ? await api<ReportResult>(`/reports/${selected.key}?${params}`) : null;
  const groups = [...new Set(visible.map((x) => x.group))];
  const dl = (format: string) => `/reports/${selected!.key}/export?${new URLSearchParams({ ...Object.fromEntries(params), format })}`;
  return (
    <>
      <PageHeader
        eyebrow="Overview"
        title="Reports & exports"
        description="Every report is one table per panel, never added across panels. Downloads are CSV or Excel, carry the data mode on every row, and are recorded in the security audit."
        actions={r ? <DataModeBadge mode={r.dataMode} /> : null}
      />
      {r ? <DemoBanner mode={r.dataMode} /> : null}
      {!selected ? (
        <Card>
          <EmptyState title="No reports for your role">Ask a super admin for reports access.</EmptyState>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
          <Card className="h-fit">
            <nav aria-label="Reports" className="py-2">
              {groups.map((g) => (
                <div key={g} className="px-3 py-1.5">
                  <p className="px-2 pb-1 text-[11px] font-medium uppercase tracking-wider text-fg-3">{g}</p>
                  {visible
                    .filter((x) => x.group === g)
                    .map((x) => (
                      <Link
                        key={x.key}
                        href={`/reports?key=${x.key}`}
                        aria-current={x.key === selected.key ? 'page' : undefined}
                        className={cn(
                          'block rounded-md px-2 py-1.5 text-[13px]',
                          x.key === selected.key ? 'bg-accent-soft font-medium text-accent' : 'text-fg-2 hover:bg-surface-2',
                        )}
                      >
                        {x.title}
                      </Link>
                    ))}
                </div>
              ))}
            </nav>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader
                title={selected.title}
                hint={selected.description}
                action={
                  selected.canExport ? (
                    <div className="flex gap-2">
                      <a className={`${btn.secondary} whitespace-nowrap`} href={dl('csv')}>
                        Download CSV
                      </a>
                      <a className={`${btn.secondary} whitespace-nowrap`} href={dl('xlsx')}>
                        Download Excel
                      </a>
                    </div>
                  ) : (
                    <span className="text-[12px] text-fg-3">Your role can view but not download this report.</span>
                  )
                }
              />
              <form className="flex flex-wrap items-end gap-3 border-b border-border px-5 py-3 text-[13px]">
                <input type="hidden" name="key" value={selected.key} />
                <label>
                  Panel
                  <select name="panel" defaultValue={sp.panel ?? ''} className={`${input} w-44`}>
                    <option value="">Every panel</option>
                    {(['t2o', 'mfr', 'mho'] as const).map((p) => (
                      <option key={p} value={p}>
                        {panelName(p, panelList)}
                      </option>
                    ))}
                  </select>
                </label>
                {selected.period ? (
                  <>
                    <label>
                      From
                      <input type="date" name="from" defaultValue={r?.period?.from} className={`${input} w-40`} />
                    </label>
                    <label>
                      To
                      <input type="date" name="to" defaultValue={r?.period?.to} className={`${input} w-40`} />
                    </label>
                  </>
                ) : null}
                <button className={btn.secondary}>Apply</button>
                <span className="ml-auto text-[12px] text-fg-3">
                  Generated {fmtDate(r!.generatedAt)}
                  {r!.period ? ` · ${r!.period.from} to ${r!.period.to}` : ''}
                </span>
              </form>
              {r!.rows.length === 0 ? (
                <EmptyState title="Nothing in this report yet">Try another panel or a longer period.</EmptyState>
              ) : (
                <Table head={r!.columns.map((c) => c.label)}>
                  {r!.rows.map((row, i) => (
                    <tr key={i}>
                      {r!.columns.map((c) => (
                        <td key={c.key} className={cn('px-5 py-1.5', c.type !== 'text' && 'font-mono text-[12px]')}>
                          {cell(row[c.key] ?? null, c.type, c.key)}
                        </td>
                      ))}
                    </tr>
                  ))}
                </Table>
              )}
              {r!.notes.length ? (
                <ul className="space-y-1 border-t border-border px-5 py-3 text-[12px] text-fg-3">
                  {r!.notes.map((n) => (
                    <li key={n}>{n}</li>
                  ))}
                </ul>
              ) : null}
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
