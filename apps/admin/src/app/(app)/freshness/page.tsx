import type { Metadata } from 'next';
import { PANELS, type DataMode, type PanelCode } from '@madp/contracts';
import { api } from '@/lib/api';
import { Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, Stat, Table, btn, fmt, fmtDate, input } from '@/components/ui';

export const metadata: Metadata = { title: 'Profile freshness' };

interface PanelFreshness {
  panel: PanelCode;
  activeMemberships: number;
  questionBank: number;
  membersWithAnswers: number;
  neverProfiled: number;
  dueForCheck: number;
  completeness: { band: string; members: number }[];
  leastAnswered: { sourceQuestionId: string; label: string; answered: number; stale: number; coverage: number }[];
  attributes: { key: string; label: string; sensitivity: string; members: number; coverage: number; stale: number }[];
  hiddenSensitiveQuestions: number;
  lastSync: string | null;
}

const pct = (x: number) => `${Math.round(x * 100)}%`;

export default async function FreshnessPage({ searchParams }: { searchParams: Promise<{ staleDays?: string }> }) {
  const sp = await searchParams;
  const days = /^\d+$/.test(sp.staleDays ?? '') ? sp.staleDays : '180';
  const r = await api<{ dataMode: DataMode; staleDays: number; asOf: string; panels: PanelFreshness[] }>(`/profiles/freshness?staleDays=${days}`);
  return (
    <>
      <PageHeader
        eyebrow="Data"
        title="Profile freshness"
        description="How complete and how recent each panel's profiles are, which members are due for their 6-month check, and which questions and attributes are answered least. Counts only, panel by panel."
        actions={<DataModeBadge mode={r.dataMode} />}
      />
      <DemoBanner mode={r.dataMode} />
      <form className="mb-4 flex items-end gap-2 text-[13px]">
        <label>
          An answer is stale after (days)
          <input name="staleDays" type="number" min={7} max={730} defaultValue={r.staleDays} className={`${input} w-32`} />
        </label>
        <button className={btn.secondary}>Apply</button>
        <span className="text-fg-3">The 6-month recheck rule uses 180 days.</span>
      </form>
      <div className="space-y-4">
        {r.panels.map((p) => {
          const max = Math.max(1, ...p.completeness.map((b) => b.members));
          return (
            <Card key={p.panel}>
              <CardHeader
                title={PANELS[p.panel].name}
                hint={`${fmt(p.questionBank)} questions in the bank · last import ${p.lastSync ? fmtDate(p.lastSync) : 'never'}`}
              />
              <div className="grid grid-cols-2 gap-3 px-5 py-4 md:grid-cols-4">
                <Stat label="Active accounts" value={fmt(p.activeMemberships)} />
                <Stat label="With any answer" value={fmt(p.membersWithAnswers)} />
                <Stat label="Never profiled" value={fmt(p.neverProfiled)} />
                <Stat label={`Due for check (${r.staleDays} days)`} value={fmt(p.dueForCheck)} />
              </div>
              <div className="grid gap-4 border-t border-border px-5 py-4 lg:grid-cols-3">
                <div>
                  <h3 className="mb-2 text-[12px] font-medium text-fg-2">Share of the question bank answered</h3>
                  <ul className="space-y-1.5 text-[12px]">
                    {p.completeness.map((b) => (
                      <li key={b.band} className="grid grid-cols-[90px_1fr_48px] items-center gap-2">
                        <span className="text-fg-2">{b.band}</span>
                        <span className="h-2 rounded bg-surface-2">
                          <span className="block h-2 rounded bg-accent" style={{ width: `${(b.members / max) * 100}%` }} />
                        </span>
                        <span className="text-right font-mono">{fmt(b.members)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="lg:col-span-2">
                  <h3 className="mb-2 text-[12px] font-medium text-fg-2">Canonical attributes (approved mappings only)</h3>
                  {p.attributes.length === 0 ? (
                    <EmptyState title="No approved mappings yet">Approve mappings in the mapping workbench to see coverage here.</EmptyState>
                  ) : (
                    <Table head={['Attribute', 'Members', 'Coverage', 'Stale']}>
                      {p.attributes.map((a) => (
                        <tr key={a.key}>
                          <td className="px-5 py-1.5">
                            {a.label} <span className="font-mono text-[11px] text-fg-3">{a.key}</span>
                          </td>
                          <td className="px-5 py-1.5">{fmt(a.members)}</td>
                          <td className="px-5 py-1.5">{pct(a.coverage)}</td>
                          <td className="px-5 py-1.5">{fmt(a.stale)}</td>
                        </tr>
                      ))}
                    </Table>
                  )}
                </div>
              </div>
              <div className="border-t border-border">
                <Table head={['Least-answered question', 'Answered', 'Coverage', 'Stale answers']}>
                  {p.leastAnswered.map((q) => (
                    <tr key={q.sourceQuestionId}>
                      <td className="px-5 py-1.5">
                        {q.label} <span className="font-mono text-[11px] text-fg-3">{q.sourceQuestionId}</span>
                      </td>
                      <td className="px-5 py-1.5">{fmt(q.answered)}</td>
                      <td className="px-5 py-1.5">{pct(q.coverage)}</td>
                      <td className="px-5 py-1.5">{fmt(q.stale)}</td>
                    </tr>
                  ))}
                </Table>
                {p.hiddenSensitiveQuestions ? (
                  <p className="px-5 py-2 text-[12px] text-fg-3">
                    {fmt(p.hiddenSensitiveQuestions)} health questions are left out because you do not have health access.
                  </p>
                ) : null}
              </div>
            </Card>
          );
        })}
      </div>
    </>
  );
}
