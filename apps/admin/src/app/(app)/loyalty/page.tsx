import type { Metadata } from 'next';
import { PANELS, type DataMode, type PanelCode, type SessionUser } from '@madp/contracts';
import { api } from '@/lib/api';
import { Badge, Card, CardHeader, DataModeBadge, DemoBanner, EmptyState, PageHeader, PanelChip, Stat, fmt, fmtDate } from '@/components/ui';
import { ApproveSurvey, PanelButtons } from './loyalty-forms';

export const metadata: Metadata = { title: 'Loyalty ledger' };

interface PanelLiability {
  panel: PanelCode;
  accounts: number;
  approved: number;
  pending: number;
  reversed: number;
  redeemed: number;
  approvedByCategory: Record<string, number>;
  pendingBySurvey: { survey: string; completes: number; points: number }[];
  lastSync: Record<string, string | null>;
}
interface Reconciliation {
  id: string;
  panel: PanelCode;
  repaired: boolean;
  at: string;
  report: {
    matches: boolean;
    missing: number;
    different: number;
    onlyInMadp: number;
    unmatched: number;
    panelBalance: number;
    madpApproved: number;
    madpPending: number;
    balanceDifference: number;
    sourceRewards: number;
    sourceResponses: number;
    repairedLines: number;
  };
}

export default async function LoyaltyPage() {
  const [me, l, recs] = await Promise.all([
    api<SessionUser>('/auth/me'),
    api<{ dataMode: DataMode; unit: string; note: string; panels: PanelLiability[] }>('/loyalty/liability'),
    api<Reconciliation[]>('/loyalty/reconciliations'),
  ]);
  const canRun = me.permissions.includes('loyalty.reconcile');
  const canApprove = me.permissions.includes('loyalty.approve');
  return (
    <>
      <PageHeader
        eyebrow="Loyalty"
        title="Loyalty ledger"
        description="Each panel's reward wallets, mirrored read-only into an append-only ledger. Panels are never added together. Survey completes stay pending until the client's approval is recorded here. Nothing here changes a panel wallet."
        actions={<DataModeBadge mode={l.dataMode} />}
      />
      <DemoBanner mode={l.dataMode} />
      <p className="mb-4 rounded-lg bg-surface-2 px-3 py-2 text-[13px] text-fg-2">{l.note}</p>
      {l.panels.length === 0 ? (
        <EmptyState title="No wallets mirrored yet">Run an import or sync of a panel that serves the rewards feed.</EmptyState>
      ) : (
        <div className="grid gap-4 xl:grid-cols-3">
          {l.panels.map((p) => (
            <Card key={p.panel}>
              <CardHeader title={PANELS[p.panel].name} hint={`${fmt(p.accounts)} wallets`} action={<PanelButtons panel={p.panel} canRun={canRun} />} />
              <div className="grid grid-cols-2 gap-3 px-5 py-4">
                <Stat label="Approved (outstanding)" value={fmt(p.approved)} />
                <Stat label="Pending client approval" value={fmt(p.pending)} />
                <Stat label="Reversed" value={fmt(p.reversed)} />
                <Stat label="Redeemed" value={fmt(p.redeemed)} />
              </div>
              <div className="px-5 pb-3 text-[12px] text-fg-2">
                Approved by category:{' '}
                {Object.entries(p.approvedByCategory).map(([k, v]) => `${k} ${fmt(v)}`).join(', ') || 'none'}
                <br />
                Last mirror: rewards {p.lastSync.rewards ? fmtDate(p.lastSync.rewards) : 'never'}, responses{' '}
                {p.lastSync.responses ? fmtDate(p.lastSync.responses) : 'never'}
              </div>
              {p.pendingBySurvey.length ? (
                <ul className="divide-y divide-border border-t border-border">
                  {p.pendingBySurvey.map((s) => (
                    <li key={s.survey} className="flex flex-wrap items-center gap-2 px-5 py-2 text-[13px]">
                      <span className="font-mono text-[12px]">{s.survey}</span>
                      <span className="text-fg-3">
                        {fmt(s.completes)} completes · {fmt(s.points)} points
                      </span>
                      {canApprove ? (
                        <span className="ml-auto">
                          <ApproveSurvey panel={p.panel} survey={s.survey} />
                        </span>
                      ) : null}
                    </li>
                  ))}
                </ul>
              ) : null}
            </Card>
          ))}
        </div>
      )}
      <Card className="mt-4">
        <CardHeader title="Reconciliations" hint="A full read of the panel's feeds compared with the ledger, line by line" />
        {recs.length === 0 ? (
          <EmptyState title="No reconciliations yet" />
        ) : (
          <ul className="divide-y divide-border">
            {recs.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center gap-2 px-5 py-2 text-[13px]">
                <PanelChip panel={r.panel} />
                <span className="text-fg-3">{fmtDate(r.at)}</span>
                <Badge tone={r.report.matches ? 'teal' : 'warn'}>{r.report.matches ? 'matches' : 'differences'}</Badge>
                {r.repaired ? <Badge>repaired ({fmt(r.report.repairedLines)} lines)</Badge> : null}
                <span className="text-fg-2">
                  {fmt(r.report.sourceRewards)} rewards and {fmt(r.report.sourceResponses)} responses read · missing {r.report.missing} ·
                  different {r.report.different} · only in MADP {r.report.onlyInMadp} · unknown members {r.report.unmatched}
                </span>
                <span className="ml-auto text-[12px] text-fg-3">
                  Panel balance {fmt(r.report.panelBalance)} vs MADP {fmt(r.report.madpApproved + r.report.madpPending)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
